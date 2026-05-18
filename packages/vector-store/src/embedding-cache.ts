/**
 * EmbeddingCache - LRU cache with TTL for embedding vectors
 */

interface CacheEntry {
  value: number[];
  expiresAt: number;
}

export class EmbeddingCache {
  private maxSize: number;
  private ttlMs: number;
  private cache: Map<string, CacheEntry> = new Map();
  private hits = 0;
  private misses = 0;

  constructor(maxSize: number, ttlMs: number) {
    if (maxSize <= 0) throw new Error('maxSize must be positive');
    if (ttlMs <= 0) throw new Error('ttlMs must be positive');
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: string): number[] | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.hits++;
    return entry.value;
  }

  set(key: string, value: number[]): void {
    // Remove if already exists
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    // Evict oldest if at capacity
    while (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  compute(key: string, fn: () => number[]): number[] {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const value = fn();
    this.set(key, value);
    return value;
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  getStats(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }
}
