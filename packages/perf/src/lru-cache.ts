// ============================================================================
// @claude-agent/perf - LRUCache
// 泛型 LRU 缓存，支持 TTL 过期、内存大小限制、命中率统计
// ============================================================================

interface CacheEntry<V> {
  value: V;
  key: string;
  expiresAt: number | null;
  size: number;
  prev: CacheEntry<V> | null;
  next: CacheEntry<V> | null;
}

export interface LRUCacheOptions<V> {
  /** 最大条目数 */
  maxSize?: number;
  /** 最大内存大小（字节） */
  maxMemoryBytes?: number;
  /** 默认 TTL（ms），0 表示永不过期 */
  defaultTTL?: number;
  /** 估算单个条目大小的函数 */
  sizeEstimator?: (value: V) => number;
  /** 是否在 get 时更新访问顺序 */
  updateAgeOnGet?: boolean;
  /** 过期条目清理间隔（ms） */
  cleanupInterval?: number;
}

export interface LRUCacheStats {
  /** 当前条目数 */
  size: number;
  /** 当前估算内存使用（字节） */
  memoryUsage: number;
  /** 最大条目数 */
  maxSize: number;
  /** 最大内存大小（字节） */
  maxMemoryBytes: number | undefined;
  /** 缓存命中次数 */
  hits: number;
  /** 缓存未命中次数 */
  misses: number;
  /** 命中率 */
  hitRate: number;
  /** 过期淘汰次数 */
  evictions: number;
  /** 容量淘汰次数 */
  capacityEvictions: number;
}

export class LRUCache<V = unknown> {
  private map = new Map<string, CacheEntry<V>>();
  private head: CacheEntry<V> | null = null;
  private tail: CacheEntry<V> | null = null;
  private options: Required<LRUCacheOptions<V>>;
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    capacityEvictions: 0,
  };
  private currentMemory = 0;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: LRUCacheOptions<V>) {
    this.options = {
      maxSize: options?.maxSize ?? 1000,
      maxMemoryBytes: options?.maxMemoryBytes,
      defaultTTL: options?.defaultTTL ?? 0,
      sizeEstimator: options?.sizeEstimator ?? (() => 256),
      updateAgeOnGet: options?.updateAgeOnGet ?? true,
      cleanupInterval: options?.cleanupInterval ?? 60_000,
    };

    if (this.options.cleanupInterval > 0) {
      this.cleanupTimer = setInterval(() => this.cleanup(), this.options.cleanupInterval);
    }
  }

  /** 获取缓存值 */
  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // Check TTL
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.removeEntry(entry);
      this.stats.misses++;
      this.stats.evictions++;
      return undefined;
    }

    if (this.options.updateAgeOnGet) {
      this.moveToHead(entry);
    }

    this.stats.hits++;
    return entry.value;
  }

  /** 设置缓存值 */
  set(key: string, value: V, ttl?: number): void {
    const existing = this.map.get(key);
    if (existing) {
      // Update existing entry
      this.currentMemory -= existing.size;
      existing.value = value;
      existing.size = this.options.sizeEstimator(value);
      existing.expiresAt = ttl !== undefined
        ? Date.now() + ttl
        : this.options.defaultTTL > 0
          ? Date.now() + this.options.defaultTTL
          : null;
      this.currentMemory += existing.size;
      this.moveToHead(existing);
      this.evictIfNeeded();
      return;
    }

    // Create new entry
    const size = this.options.sizeEstimator(value);
    const entry: CacheEntry<V> = {
      value,
      key,
      size,
      expiresAt: ttl !== undefined
        ? Date.now() + ttl
        : this.options.defaultTTL > 0
          ? Date.now() + this.options.defaultTTL
          : null,
      prev: null,
      next: null,
    };

    this.map.set(key, entry);
    this.addToHead(entry);
    this.currentMemory += size;
    this.evictIfNeeded();
  }

  /** 检查 key 是否存在且未过期 */
  has(key: string): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.removeEntry(entry);
      this.stats.evictions++;
      return false;
    }
    return true;
  }

  /** 删除指定 key */
  delete(key: string): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    this.removeEntry(entry);
    return true;
  }

  /** 获取并删除 */
  pop(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    const value = entry.value;
    this.removeEntry(entry);
    return value;
  }

  /** 清空缓存 */
  clear(): void {
    this.map.clear();
    this.head = null;
    this.tail = null;
    this.currentMemory = 0;
  }

  /** 获取缓存统计 */
  getStats(): LRUCacheStats {
    return {
      size: this.map.size,
      memoryUsage: this.currentMemory,
      maxSize: this.options.maxSize,
      maxMemoryBytes: this.options.maxMemoryBytes,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: this.stats.hits + this.stats.misses > 0
        ? this.stats.hits / (this.stats.hits + this.stats.misses)
        : 0,
      evictions: this.stats.evictions,
      capacityEvictions: this.stats.capacityEvictions,
    };
  }

  /** 遍历所有有效条目 */
  forEach(callback: (value: V, key: string) => void): void {
    const now = Date.now();
    let current = this.head;
    while (current) {
      if (current.expiresAt === null || now <= current.expiresAt) {
        callback(current.value, current.key);
      }
      current = current.next;
    }
  }

  /** 获取所有有效 key */
  keys(): string[] {
    const result: string[] = [];
    const now = Date.now();
    let current = this.head;
    while (current) {
      if (current.expiresAt === null || now <= current.expiresAt) {
        result.push(current.key);
      }
      current = current.next;
    }
    return result;
  }

  /** 销毁缓存 */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.clear();
  }

  private addToHead(entry: CacheEntry<V>): void {
    entry.prev = null;
    entry.next = this.head;
    if (this.head) {
      this.head.prev = entry;
    }
    this.head = entry;
    if (!this.tail) {
      this.tail = entry;
    }
  }

  private removeEntry(entry: CacheEntry<V>): void {
    this.map.delete(entry.key);
    this.currentMemory -= entry.size;

    if (entry.prev) {
      entry.prev.next = entry.next;
    } else {
      this.head = entry.next;
    }

    if (entry.next) {
      entry.next.prev = entry.prev;
    } else {
      this.tail = entry.prev;
    }

    entry.prev = null;
    entry.next = null;
  }

  private moveToHead(entry: CacheEntry<V>): void {
    if (entry === this.head) return;
    this.removeEntry(entry);
    this.addToHead(entry);
    this.map.set(entry.key, entry);
    this.currentMemory += entry.size;
  }

  private evictIfNeeded(): void {
    // Evict by count
    while (this.map.size > this.options.maxSize && this.tail) {
      this.removeEntry(this.tail);
      this.stats.capacityEvictions++;
    }

    // Evict by memory
    if (this.options.maxMemoryBytes !== undefined) {
      while (this.currentMemory > this.options.maxMemoryBytes && this.tail) {
        this.removeEntry(this.tail);
        this.stats.capacityEvictions++;
      }
    }
  }

  private cleanup(): void {
    const now = Date.now();
    let current = this.tail;
    while (current) {
      const prev = current.prev;
      if (current.expiresAt !== null && now > current.expiresAt) {
        this.removeEntry(current);
        this.stats.evictions++;
      }
      current = prev;
    }
  }
}
