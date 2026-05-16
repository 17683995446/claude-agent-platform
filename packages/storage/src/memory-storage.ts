// src/memory-storage.ts - 内存存储实现

import type {
  IStorage,
  SetOptions,
  StorageEntry,
  StorageStats,
  StorageChangeEvent,
} from './storage-interface.ts';
import { NamespacedStorage } from './storage-interface.ts';

/**
 * MemoryStorage 配置选项
 */
export interface MemoryStorageOptions {
  /** 最大条目数量，超出时触发 LRU 淘汰 */
  maxSize?: number;
  /** 最大内存使用量（字节） */
  maxMemoryBytes?: number;
  /** 默认 TTL（毫秒） */
  defaultTtl?: number;
}

type EventListener<T> = (event: StorageChangeEvent<T>) => void;

/**
 * 内存存储实现
 * - HashMap O(1) get/set/delete
 * - TTL 懒过期
 * - LRU 淘汰
 * - 标签查询
 * - 事件发射
 * - 快照与恢复
 * - 微任务队列保证并发安全
 */
export class MemoryStorage<T> implements IStorage<T> {
  private store = new Map<string, StorageEntry<T>>();
  private accessOrder: string[] = []; // LRU 顺序
  private listeners: EventListener<T>[] = [];
  private operationQueue: Promise<void> = Promise.resolve();
  private _evictionCount = 0;
  private _hits = 0;
  private _misses = 0;

  private readonly maxSize: number;
  private readonly maxMemoryBytes: number;
  private readonly defaultTtl: number | undefined;

  constructor(options: MemoryStorageOptions = {}) {
    this.maxSize = options.maxSize ?? Infinity;
    this.maxMemoryBytes = options.maxMemoryBytes ?? Infinity;
    this.defaultTtl = options.defaultTtl;
  }

  // ---- 并发安全：所有写操作通过微任务队列串行化 ----

  private enqueue<R>(fn: () => Promise<R>): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      this.operationQueue = this.operationQueue
        .then(() => fn())
        .then(resolve, reject);
    });
  }

  // ---- 事件系统 ----

  on(listener: EventListener<T>): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emit(event: StorageChangeEvent<T>): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 忽略监听器错误
      }
    }
  }

  // ---- TTL / 过期检查 ----

  private isExpired(entry: StorageEntry<T>): boolean {
    return entry.expiresAt !== undefined && Date.now() > entry.expiresAt;
  }

  private touchAccessOrder(key: string): void {
    const idx = this.accessOrder.indexOf(key);
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1);
    }
    this.accessOrder.push(key);
  }

  // ---- LRU 淘汰 ----

  private evict(): void {
    while (
      (this.maxSize !== Infinity && this.store.size > this.maxSize) ||
      (this.maxMemoryBytes !== Infinity && this.getMemoryUsage() > this.maxMemoryBytes)
    ) {
      const oldest = this.accessOrder.shift();
      if (oldest === undefined) break;
      const entry = this.store.get(oldest);
      if (entry) {
        this.store.delete(oldest);
        this._evictionCount++;
        this.emit({ type: 'evict', key: oldest, entry, timestamp: Date.now() });
      }
    }
  }

  // ---- 内存估算 ----

  private getMemoryUsage(): number {
    let total = 0;
    for (const [, entry] of this.store) {
      total += estimateEntrySize(entry);
    }
    return total;
  }

  // ---- IStorage 接口实现 ----

  async get(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);
    if (!entry) {
      this._misses++;
      return undefined;
    }
    if (this.isExpired(entry)) {
      await this.delete(key);
      this._misses++;
      return undefined;
    }
    this._hits++;
    this.touchAccessOrder(key);
    return entry.value;
  }

  async set(key: string, value: T, options?: SetOptions): Promise<void> {
    return this.enqueue(async () => {
      const now = Date.now();
      const existing = this.store.get(key);
      const version = existing ? existing.version + 1 : 1;

      const entry: StorageEntry<T> = {
        value,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        expiresAt: options?.ttl ? now + options.ttl : this.defaultTtl ? now + this.defaultTtl : undefined,
        tags: options?.tags ?? existing?.tags ?? [],
        metadata: options?.metadata ?? existing?.metadata ?? {},
        version,
      };

      this.store.set(key, entry);
      this.touchAccessOrder(key);
      this.evict();

      this.emit({ type: 'set', key, entry, timestamp: now });
    });
  }

  async delete(key: string): Promise<boolean> {
    return this.enqueue(async () => {
      const entry = this.store.get(key);
      if (!entry) return false;
      this.store.delete(key);
      const idx = this.accessOrder.indexOf(key);
      if (idx !== -1) this.accessOrder.splice(idx, 1);
      this.emit({ type: 'delete', key, entry, timestamp: Date.now() });
      return true;
    });
  }

  async has(key: string): Promise<boolean> {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (this.isExpired(entry)) {
      await this.delete(key);
      return false;
    }
    return true;
  }

  async keys(pattern?: string): Promise<string[]> {
    const now = Date.now();
    const result: string[] = [];
    for (const [key, entry] of this.store) {
      if (this.isExpired(entry)) continue;
      if (!pattern || matchPattern(key, pattern)) {
        result.push(key);
      }
    }
    return result;
  }

  async clear(): Promise<void> {
    return this.enqueue(async () => {
      this.store.clear();
      this.accessOrder = [];
    });
  }

  async size(): Promise<number> {
    let count = 0;
    for (const [, entry] of this.store) {
      if (!this.isExpired(entry)) count++;
    }
    return count;
  }

  namespace(name: string): IStorage<T> {
    return new NamespacedStorage(this, name);
  }

  async stats(): Promise<StorageStats> {
    const total = this._hits + this._misses;
    return {
      totalKeys: this.store.size,
      totalSize: this.getMemoryUsage(),
      hitRate: total > 0 ? this._hits / total : 0,
      missRate: total > 0 ? this._misses / total : 0,
      evictionCount: this._evictionCount,
    };
  }

  async getEntry(key: string): Promise<StorageEntry<T> | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (this.isExpired(entry)) {
      await this.delete(key);
      return undefined;
    }
    this.touchAccessOrder(key);
    return entry;
  }

  // ---- 扩展功能 ----

  /**
   * 按标签查询条目
   */
  async getByTag(tag: string): Promise<StorageEntry<T>[]> {
    const result: StorageEntry<T>[] = [];
    for (const [, entry] of this.store) {
      if (this.isExpired(entry)) continue;
      if (entry.tags.includes(tag)) {
        result.push(entry);
      }
    }
    return result;
  }

  /**
   * 创建快照
   */
  snapshot(): Record<string, StorageEntry<T>> {
    const snapshot: Record<string, StorageEntry<T>> = {};
    for (const [key, entry] of this.store) {
      snapshot[key] = structuredClone(entry);
    }
    return snapshot;
  }

  /**
   * 从快照恢复
   */
  async restore(snapshot: Record<string, StorageEntry<T>>): Promise<void> {
    return this.enqueue(async () => {
      this.store.clear();
      this.accessOrder = [];
      for (const [key, entry] of Object.entries(snapshot)) {
        this.store.set(key, structuredClone(entry));
        this.accessOrder.push(key);
      }
    });
  }
}

// ---- 工具函数 ----

function estimateEntrySize(entry: StorageEntry<unknown>): number {
  return JSON.stringify(entry).length * 2; // 粗略估算 UTF-16 字节
}

function matchPattern(key: string, pattern: string): boolean {
  const regex = new RegExp(
    '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
  );
  return regex.test(key);
}
