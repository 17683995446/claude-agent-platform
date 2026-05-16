// src/api-cache.ts - API 缓存

export type CacheStrategy = 'no-cache' | 'cache-first' | 'network-first' | 'stale-while-revalidate';

export interface CacheOptions {
  ttl?: number; // Time to live in milliseconds
  tags?: string[];
  strategy?: CacheStrategy;
  methods?: string[];
  condition?: (key: string) => boolean;
}

export interface CachedResponse {
  body: unknown;
  status: number;
  headers: Record<string, string>;
  etag?: string;
  lastModified?: string;
  tags: string[];
  createdAt: number;
  ttl: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRate: number;
  staleHits: number;
}

export class APICache {
  private cache: Map<string, CachedResponse> = new Map();
  private defaultTTL: number;
  private defaultStrategy: CacheStrategy;
  private hits = 0;
  private misses = 0;
  private staleHits = 0;

  constructor(options?: { defaultTTL?: number; defaultStrategy?: CacheStrategy }) {
    this.defaultTTL = options?.defaultTTL ?? 60000;
    this.defaultStrategy = options?.defaultStrategy ?? 'cache-first';
  }

  get(key: string): CachedResponse | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }

    const now = Date.now();
    const isStale = now - entry.createdAt > entry.ttl;

    if (isStale) {
      // For stale-while-revalidate, return stale data but count as stale hit
      if (entry.ttl * 2 > now - entry.createdAt) {
        this.staleHits++;
        return entry;
      }
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }

    this.hits++;
    return entry;
  }

  set(key: string, response: CachedResponse, options?: CacheOptions): void {
    const entry: CachedResponse = {
      ...response,
      tags: options?.tags || response.tags || [],
      createdAt: Date.now(),
      ttl: options?.ttl ?? this.defaultTTL,
    };

    // Generate ETag if not provided
    if (!entry.etag) {
      entry.etag = this.generateETag(response.body);
    }

    // Generate Last-Modified if not provided
    if (!entry.lastModified) {
      entry.lastModified = new Date().toISOString();
    }

    this.cache.set(key, entry);
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  invalidate(pattern: string): number {
    let count = 0;
    const regex = new RegExp(pattern);

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }

    return count;
  }

  invalidateByTag(tag: string): number {
    let count = 0;
    for (const [key, entry] of this.cache) {
      if (entry.tags.includes(tag)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  invalidateByTags(tags: string[]): number {
    let count = 0;
    for (const [key, entry] of this.cache) {
      if (tags.some((tag) => entry.tags.includes(tag))) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      hitRate: total > 0 ? this.hits / total : 0,
      staleHits: this.staleHits,
    };
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.staleHits = 0;
  }

  getSize(): number {
    return this.cache.size;
  }

  generateKey(method: string, path: string, query?: Record<string, string>, headers?: Record<string, string>): string {
    let key = `${method}:${path}`;
    if (query && Object.keys(query).length > 0) {
      const sortedQuery = Object.entries(query)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
      key += `?${sortedQuery}`;
    }
    if (headers) {
      const headerKeys = Object.keys(headers).sort();
      for (const hk of headerKeys) {
        key += `|${hk}:${headers[hk]}`;
      }
    }
    return key;
  }

  checkETag(key: string, ifNoneMatch: string | undefined): boolean {
    if (!ifNoneMatch) return false;
    const entry = this.cache.get(key);
    if (!entry || !entry.etag) return false;
    return ifNoneMatch === entry.etag || ifNoneMatch === `W/${entry.etag}`;
  }

  checkLastModified(key: string, ifModifiedSince: string | undefined): boolean {
    if (!ifModifiedSince) return false;
    const entry = this.cache.get(key);
    if (!entry || !entry.lastModified) return false;
    return new Date(ifModifiedSince) >= new Date(entry.lastModified);
  }

  getCacheHeaders(key: string): Record<string, string> {
    const entry = this.cache.get(key);
    if (!entry) return {};

    const headers: Record<string, string> = {};
    if (entry.etag) headers['ETag'] = entry.etag;
    if (entry.lastModified) headers['Last-Modified'] = entry.lastModified;
    const maxAge = Math.max(0, Math.floor((entry.ttl - (Date.now() - entry.createdAt)) / 1000));
    headers['Cache-Control'] = `max-age=${maxAge}`;
    return headers;
  }

  private generateETag(body: unknown): string {
    const str = typeof body === 'string' ? body : JSON.stringify(body);
    // Simple hash
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `"${Math.abs(hash).toString(16)}"`;
  }
}
