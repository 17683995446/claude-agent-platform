// ============================================================
// Module 6: Task Recycling Manager
// ============================================================

export interface RecycledResources {
  connections: number;
  buffers: number;
  parsers: number;
  totalBytesSaved: number;
}

export interface CacheStats {
  hitCount: number;
  missCount: number;
  evictionCount: number;
  totalEntries: number;
  hitRate: number;
  totalBytes: number;
}

export type EvictionPolicy = 'lru' | 'ttl' | 'size';

export interface TaskRecyclingOptions {
  maxCacheSize?: number;
  defaultTTL?: number;        // ms
  evictionPolicy?: EvictionPolicy;
  maxResourcePoolSize?: number;
}

const DEFAULT_RECYCLING_OPTIONS: Required<TaskRecyclingOptions> = {
  maxCacheSize: 10000,
  defaultTTL: 30 * 60 * 1000, // 30 minutes
  evictionPolicy: 'lru',
  maxResourcePoolSize: 100,
};

interface CacheEntry {
  value: unknown;
  createdAt: number;
  lastAccessedAt: number;
  size: number;
  ttl: number;
}

export class TaskRecyclingManager {
  private cache: Map<string, CacheEntry> = new Map();
  private resourcePool: Map<string, unknown[]> = new Map();
  private options: Required<TaskRecyclingOptions>;
  private hitCount: number = 0;
  private missCount: number = 0;
  private evictionCount: number = 0;
  private totalBytes: number = 0;

  constructor(options?: TaskRecyclingOptions) {
    this.options = { ...DEFAULT_RECYCLING_OPTIONS, ...options };
  }

  cacheResult(taskHash: string, result: unknown): void {
    // Check if we need to evict
    if (this.cache.size >= this.options.maxCacheSize) {
      this.evict();
    }

    const serialized = JSON.stringify(result);
    const size = new Blob([serialized]).size;

    this.cache.set(taskHash, {
      value: result,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      size,
      ttl: this.options.defaultTTL,
    });

    this.totalBytes += size;
  }

  getCachedResult(taskHash: string): unknown | undefined {
    const entry = this.cache.get(taskHash);
    if (!entry) {
      this.missCount++;
      return undefined;
    }

    // Check TTL
    if (Date.now() - entry.createdAt > entry.ttl) {
      this.cache.delete(taskHash);
      this.totalBytes -= entry.size;
      this.evictionCount++;
      this.missCount++;
      return undefined;
    }

    // Update access time for LRU
    entry.lastAccessedAt = Date.now();
    this.hitCount++;
    return entry.value;
  }

  recycleResources(taskId: string): RecycledResources {
    // Simulate resource recycling
    const connections = Math.floor(Math.random() * 3) + 1;
    const buffers = Math.floor(Math.random() * 5) + 1;
    const parsers = Math.floor(Math.random() * 2);
    const totalBytesSaved = (connections * 1024) + (buffers * 4096) + (parsers * 512);

    // Store in pool
    if (!this.resourcePool.has(taskId)) {
      this.resourcePool.set(taskId, []);
    }
    const pool = this.resourcePool.get(taskId)!;
    for (let i = 0; i < connections; i++) pool.push({ type: 'connection', recycled: true });
    for (let i = 0; i < buffers; i++) pool.push({ type: 'buffer', recycled: true });
    for (let i = 0; i < parsers; i++) pool.push({ type: 'parser', recycled: true });

    // Limit pool size
    while (pool.length > this.options.maxResourcePoolSize) {
      pool.shift();
    }

    return { connections, buffers, parsers, totalBytesSaved };
  }

  getCacheStats(): CacheStats {
    const total = this.hitCount + this.missCount;
    return {
      hitCount: this.hitCount,
      missCount: this.missCount,
      evictionCount: this.evictionCount,
      totalEntries: this.cache.size,
      hitRate: total > 0 ? this.hitCount / total : 0,
      totalBytes: this.totalBytes,
    };
  }

  invalidateCache(pattern?: string): number {
    if (!pattern) {
      const count = this.cache.size;
      this.cache.clear();
      this.totalBytes = 0;
      return count;
    }

    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        const entry = this.cache.get(key)!;
        this.totalBytes -= entry.size;
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  getResourceFromPool(taskId: string): unknown | undefined {
    const pool = this.resourcePool.get(taskId);
    if (pool && pool.length > 0) {
      return pool.pop();
    }
    return undefined;
  }

  clearResourcePool(taskId?: string): number {
    if (taskId) {
      const pool = this.resourcePool.get(taskId);
      const count = pool?.length ?? 0;
      this.resourcePool.delete(taskId);
      return count;
    }
    let total = 0;
    for (const pool of this.resourcePool.values()) {
      total += pool.length;
    }
    this.resourcePool.clear();
    return total;
  }

  setCacheTTL(taskHash: string, ttl: number): boolean {
    const entry = this.cache.get(taskHash);
    if (!entry) return false;
    entry.ttl = ttl;
    return true;
  }

  private evict(): void {
    switch (this.options.evictionPolicy) {
      case 'lru': {
        // Find least recently used
        let oldestKey: string | undefined;
        let oldestTime = Infinity;
        for (const [key, entry] of this.cache) {
          if (entry.lastAccessedAt < oldestTime) {
            oldestTime = entry.lastAccessedAt;
            oldestKey = key;
          }
        }
        if (oldestKey) {
          const entry = this.cache.get(oldestKey)!;
          this.totalBytes -= entry.size;
          this.cache.delete(oldestKey);
          this.evictionCount++;
        }
        break;
      }
      case 'ttl': {
        // Find expired entries
        const now = Date.now();
        let evicted = false;
        for (const [key, entry] of this.cache) {
          if (now - entry.createdAt > entry.ttl) {
            this.totalBytes -= entry.size;
            this.cache.delete(key);
            this.evictionCount++;
            evicted = true;
            break; // Evict one at a time
          }
        }
        // If no expired entries, fall back to LRU
        if (!evicted) {
          let oldestKey: string | undefined;
          let oldestTime = Infinity;
          for (const [key, entry] of this.cache) {
            if (entry.lastAccessedAt < oldestTime) {
              oldestTime = entry.lastAccessedAt;
              oldestKey = key;
            }
          }
          if (oldestKey) {
            const entry = this.cache.get(oldestKey)!;
            this.totalBytes -= entry.size;
            this.cache.delete(oldestKey);
            this.evictionCount++;
          }
        }
        break;
      }
      case 'size': {
        // Remove largest entry
        let largestKey: string | undefined;
        let largestSize = 0;
        for (const [key, entry] of this.cache) {
          if (entry.size > largestSize) {
            largestSize = entry.size;
            largestKey = key;
          }
        }
        if (largestKey) {
          const entry = this.cache.get(largestKey)!;
          this.totalBytes -= entry.size;
          this.cache.delete(largestKey);
          this.evictionCount++;
        }
        break;
      }
    }
  }
}
