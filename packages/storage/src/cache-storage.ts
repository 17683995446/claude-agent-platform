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

  private getStorage(level: number): IStorage<T> {
    return this.levels[level].storage as IStorage<T>;
  }

  private isEnabled(level: number): boolean {
    return this.levels[level].enabled !== false;
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
  }

  async set(key: string, value: T, options?: SetOptions): Promise<void> {
    if (this.writePolicy === 'write-through') {
      // Write-through: 写入所有层级
      for (let i = 0; i < this.levels.length; i++) {
        if (this.isEnabled(i)) {
          const levelTtl = this.levels[i].ttl ?? options?.ttl;
          await this.getStorage(i).set(key, value, levelTtl ? { ...options, ttl: levelTtl } : options);
        }
      }
    } else {
      // Write-back: 只写最上层，异步写下层
      const topEnabled = this.levels.findIndex((l) => l.enabled !== false);
      if (topEnabled >= 0) {
        await this.getStorage(topEnabled).set(key, value, options);
        // 异步写入下层
        for (let i = topEnabled + 1; i < this.levels.length; i++) {
          if (this.isEnabled(i)) {
            const levelTtl = this.levels[i].ttl ?? options?.ttl;
            this.getStorage(i)
              .set(key, value, levelTtl ? { ...options, ttl: levelTtl } : options)
              .catch(() => {});
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
    for (let i = 0; i < this.levels.length; i++) {
      if (!this.isEnabled(i)) continue;
      const result = await this.getStorage(i).has(key);
      if (result) return true;
    }
    return false;
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
    return topStats;
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
