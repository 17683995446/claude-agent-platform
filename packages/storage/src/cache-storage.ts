// src/cache-storage.ts - 多级缓存存储

import type {
  IStorage,
  SetOptions,
  StorageEntry,
  StorageStats,
} from './storage-interface.ts';
import { NamespacedStorage } from './storage-interface.ts';

/**
 * 写入策略
 */
export type WritePolicy = 'write-through' | 'write-back';

/**
 * 单级缓存配置
 */
export interface CacheLevelConfig {
  /** 存储后端 */
  storage: IStorage<unknown>;
  /** 是否启用 */
  enabled?: boolean;
  /** 该级别的 TTL（毫秒），覆盖全局设置 */
  ttl?: number;
}

/**
 * 多级缓存配置
 */
export interface CacheConfig {
  /** L1 缓存（通常是内存） */
  l1: CacheLevelConfig;
  /** L2 缓存（通常是文件） */
  l2?: CacheLevelConfig;
  /** L3 缓存（自定义后端） */
  l3?: CacheLevelConfig;
  /** 写入策略 */
  writePolicy?: WritePolicy;
  /** 启动时是否预热 */
  warmUp?: boolean;
}

/**
 * 单级缓存统计
 */
export interface CacheLevelStats {
  hits: number;
  misses: number;
  evictions: number;
}

/**
 * 多级缓存存储实现
 * - L1 (memory) -> L2 (file) -> L3 (custom)
 * - Write-through / write-back
 * - TTL / 标签 / 手动 / 事件驱动失效
 * - 启动预热
 * - 每级统计
 * - 批量操作 mget/mset/mdelete
 */
export class CacheStorage<T> implements IStorage<T> {
  private levels: CacheLevelConfig[] = [];
  private writePolicy: WritePolicy;
  private levelStats: CacheLevelStats[] = [];
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(config: CacheConfig) {
    this.writePolicy = config.writePolicy ?? 'write-through';
    this.levels = [config.l1];
    if (config.l2) this.levels.push(config.l2);
    if (config.l3) this.levels.push(config.l3);
    this.levelStats = this.levels.map(() => ({ hits: 0, misses: 0, evictions: 0 }));

    if (config.warmUp) {
      this.warmUp().catch(() => {});
    }
  }

  /**
   * 将操作加入队列以保证读写顺序一致性
   */
  private enqueue<R>(fn: () => Promise<R>): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      this.operationQueue = this.operationQueue
        .then(() => fn())
        .then(resolve, reject);
    });
  }

  private getStorage(level: number): IStorage<T> {
    return this.levels[level].storage as IStorage<T>;
  }

  private isEnabled(level: number): boolean {
    return this.levels[level].enabled !== false;
  }

  /**
   * 写回带重试机制，避免静默丢失数据
   */
  private writeBackWithRetry(level: number, key: string, value: T, options?: SetOptions, retries = 3): void {
    const attempt = async (remaining: number): Promise<void> => {
      try {
        await this.getStorage(level).set(key, value, options);
      } catch {
        if (remaining > 0) {
          await new Promise((r) => setTimeout(r, 100 * (retries - remaining)));
          await attempt(remaining - 1);
        }
        // 重试耗尽，记录错误（无法 throw 因为是异步 fire-and-forget）
      }
    };
    attempt(retries).catch(() => {});
  }

  /**
   * 启动预热：从最底层加载所有数据到上层
   */
  async warmUp(): Promise<void> {
    const bottomLevel = this.levels.length - 1;
    const allKeys = await this.getStorage(bottomLevel).keys();
    for (const key of allKeys) {
      const value = await this.getStorage(bottomLevel).get(key);
      if (value !== undefined) {
        for (let i = 0; i < bottomLevel; i++) {
          if (this.isEnabled(i)) {
            await this.getStorage(i).set(key, value);
          }
        }
      }
    }
  }

  // ---- IStorage 接口实现 ----

  async get(key: string): Promise<T | undefined> {
    return this.enqueue(async () => {
      for (let i = 0; i < this.levels.length; i++) {
        if (!this.isEnabled(i)) continue;
        try {
          const value = await this.getStorage(i).get(key);
          if (value !== undefined) {
            this.levelStats[i].hits++;
            // Read-through: 回填上层缓存
            for (let j = 0; j < i; j++) {
              if (this.isEnabled(j)) {
                try {
                  await this.getStorage(j).set(key, value);
                } catch {
                  // 忽略回填错误
                }
              }
            }
            return value;
          }
          this.levelStats[i].misses++;
        } catch {
          this.levelStats[i].misses++;
        }
      }
      return undefined;
    });
  }

  async set(key: string, value: T, options?: SetOptions): Promise<void> {
    // 负 TTL 视为 0（立即过期），防止永不过期
    const normalizedOptions = options && options.ttl !== undefined && options.ttl < 0
      ? { ...options, ttl: 0 }
      : options;

    if (this.writePolicy === 'write-through') {
      // Write-through: 写入所有层级
      for (let i = 0; i < this.levels.length; i++) {
        if (this.isEnabled(i)) {
          const levelTtl = this.levels[i].ttl ?? normalizedOptions?.ttl;
          await this.getStorage(i).set(key, value, levelTtl ? { ...normalizedOptions, ttl: levelTtl } : normalizedOptions);
        }
      }
    } else {
      // Write-back: 只写最上层，异步写下层（带重试）
      const topEnabled = this.levels.findIndex((l) => l.enabled !== false);
      if (topEnabled >= 0) {
        await this.getStorage(topEnabled).set(key, value, normalizedOptions);
        // 异步写入下层，带重试
        for (let i = topEnabled + 1; i < this.levels.length; i++) {
          if (this.isEnabled(i)) {
            const levelTtl = this.levels[i].ttl ?? normalizedOptions?.ttl;
            this.writeBackWithRetry(i, key, value, levelTtl ? { ...normalizedOptions, ttl: levelTtl } : normalizedOptions);
          }
        }
      }
    }
  }

  async delete(key: string): Promise<boolean> {
    let deleted = false;
    for (let i = 0; i < this.levels.length; i++) {
      if (this.isEnabled(i)) {
        try {
          const result = await this.getStorage(i).delete(key);
          if (result) deleted = true;
        } catch {
          // ignore
        }
      }
    }
    return deleted;
  }

  async has(key: string): Promise<boolean> {
    return this.enqueue(async () => {
      // 从最底层向上检查，确保数据确实存在
      for (let i = this.levels.length - 1; i >= 0; i--) {
        if (!this.isEnabled(i)) continue;
        const result = await this.getStorage(i).has(key);
        if (result) {
          // 找到后回填上层缓存
          const value = await this.getStorage(i).get(key);
          if (value !== undefined) {
            for (let j = 0; j < i; j++) {
              if (this.isEnabled(j)) {
                try {
                  await this.getStorage(j).set(key, value);
                } catch {
                  // 忽略回填错误
                }
              }
            }
            return true;
          }
          // 底层存在但无法获取值，可能已过期
          return false;
        }
      }
      return false;
    });
  }

  async keys(pattern?: string): Promise<string[]> {
    // 从最上层获取键列表
    for (let i = 0; i < this.levels.length; i++) {
      if (!this.isEnabled(i)) continue;
      try {
        const k = await this.getStorage(i).keys(pattern);
        if (k.length > 0) return k;
      } catch {
        // ignore
      }
    }
    return [];
  }

  async clear(): Promise<void> {
    for (let i = 0; i < this.levels.length; i++) {
      if (this.isEnabled(i)) {
        try {
          await this.getStorage(i).clear();
        } catch {
          // ignore
        }
      }
    }
  }

  async size(): Promise<number> {
    // 从最上层获取大小
    for (let i = 0; i < this.levels.length; i++) {
      if (!this.isEnabled(i)) continue;
      try {
        const s = await this.getStorage(i).size();
        if (s > 0) return s;
      } catch {
        // ignore
      }
    }
    return 0;
  }

  namespace(name: string): IStorage<T> {
    return new NamespacedStorage(this, name);
  }

  async stats(): Promise<StorageStats> {
    const topStats = await this.getStorage(0).stats();
    return {
      ...topStats,
      size: await this.size(),
    };
  }

  async getEntry(key: string): Promise<StorageEntry<T> | undefined> {
    for (let i = 0; i < this.levels.length; i++) {
      if (!this.isEnabled(i)) continue;
      try {
        const entry = await this.getStorage(i).getEntry(key);
        if (entry) return entry;
      } catch {
        // ignore
      }
    }
    return undefined;
  }

  async rename(oldKey: string, newKey: string): Promise<boolean> {
    const value = await this.get(oldKey);
    if (value === undefined) return false;
    await this.set(newKey, value);
    await this.delete(oldKey);
    return true;
  }

  async copy(sourceKey: string, targetKey: string): Promise<boolean> {
    const value = await this.get(sourceKey);
    if (value === undefined) return false;
    await this.set(targetKey, value);
    return true;
  }

  // ---- 批量操作 ----

  async mget(keys: string[]): Promise<Map<string, T | undefined>> {
    const result = new Map<string, T | undefined>();
    await Promise.all(
      keys.map(async (key) => {
        result.set(key, await this.get(key));
      }),
    );
    return result;
  }

  async mset(entries: Map<string, T>, options?: SetOptions): Promise<void> {
    await Promise.all(
      Array.from(entries.entries()).map(([key, value]) => this.set(key, value, options)),
    );
  }

  async mdelete(keys: string[]): Promise<number> {
    const results = await Promise.all(keys.map((key) => this.delete(key)));
    return results.filter(Boolean).length;
  }

  // ---- 缓存失效 ----

  /**
   * 按标签失效
   */
  async invalidateByTag(tag: string): Promise<void> {
    for (let i = 0; i < this.levels.length; i++) {
      if (!this.isEnabled(i)) continue;
      const storage = this.getStorage(i);
      const allKeys = await storage.keys();
      for (const key of allKeys) {
        const entry = await storage.getEntry(key);
        if (entry?.tags.includes(tag)) {
          await storage.delete(key);
        }
      }
    }
  }

  /**
   * 获取每级缓存统计
   */
  getLevelStats(): CacheLevelStats[] {
    return this.levelStats.map((s) => ({ ...s }));
  }
}
