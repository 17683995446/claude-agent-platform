// src/rate-limiter.ts - 高级速率限制

export type RateLimitAlgorithm = 'token-bucket' | 'leaky-bucket' | 'sliding-window' | 'fixed-window';

export interface RateLimitOptions {
  /** Maximum number of requests allowed in the window */
  limit: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Algorithm to use (default: 'token-bucket') */
  algorithm?: RateLimitAlgorithm;
  /** Burst allowance - extra tokens for burst traffic */
  burst?: number;
  /** Key prefix for storage */
  keyPrefix?: string;
}

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Number of remaining requests */
  remaining: number;
  /** Time in ms until the rate limit resets */
  retryAfter: number;
  /** Total limit for the window */
  limit: number;
  /** Current window reset timestamp */
  resetTime: number;
}

export interface RateLimitStorage {
  get(key: string): Promise<{ count: number; lastUpdate: number } | undefined>;
  set(key: string, value: { count: number; lastUpdate: number }): Promise<void>;
  increment(key: string): Promise<{ count: number; lastUpdate: number }>;
  reset(key: string): Promise<void>;
}

class InMemoryStorage implements RateLimitStorage {
  private data: Map<string, { count: number; lastUpdate: number }> = new Map();

  async get(key: string): Promise<{ count: number; lastUpdate: number } | undefined> {
    return this.data.get(key);
  }

  async set(key: string, value: { count: number; lastUpdate: number }): Promise<void> {
    this.data.set(key, value);
  }

  async increment(key: string): Promise<{ count: number; lastUpdate: number }> {
    const existing = this.data.get(key);
    const now = Date.now();
    if (existing) {
      existing.count++;
      existing.lastUpdate = now;
      return existing;
    }
    const entry = { count: 1, lastUpdate: now };
    this.data.set(key, entry);
    return entry;
  }

  async reset(key: string): Promise<void> {
    this.data.delete(key);
  }

  clear(): void {
    this.data.clear();
  }
}

// ============ Token Bucket Algorithm ============
class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private maxTokens: number;
  private refillRate: number; // tokens per ms

  constructor(maxTokens: number, windowMs: number, burst: number = 0) {
    this.maxTokens = maxTokens + burst;
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
    this.refillRate = (maxTokens + burst) / windowMs;
  }

  consume(count: number = 1): { allowed: boolean; remaining: number } {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return { allowed: true, remaining: Math.floor(this.tokens) };
    }
    return { allowed: false, remaining: 0 };
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

// ============ Leaky Bucket Algorithm ============
class LeakyBucket {
  private queue: number;
  private lastLeak: number;
  private capacity: number;
  private leakRate: number; // requests per ms

  constructor(capacity: number, windowMs: number) {
    this.capacity = capacity;
    this.queue = 0;
    this.lastLeak = Date.now();
    this.leakRate = capacity / windowMs;
  }

  consume(count: number = 1): { allowed: boolean; remaining: number } {
    this.leak();
    if (this.queue + count <= this.capacity) {
      this.queue += count;
      return { allowed: true, remaining: Math.floor(this.capacity - this.queue) };
    }
    return { allowed: false, remaining: 0 };
  }

  private leak(): void {
    const now = Date.now();
    const elapsed = now - this.lastLeak;
    const leaked = elapsed * this.leakRate;
    this.queue = Math.max(0, this.queue - leaked);
    this.lastLeak = now;
  }
}

// ============ Sliding Window Log ============
class SlidingWindowLog {
  private timestamps: number[] = [];
  private windowMs: number;
  private limit: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  consume(count: number = 1): { allowed: boolean; remaining: number } {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);

    if (this.timestamps.length + count <= this.limit) {
      for (let i = 0; i < count; i++) {
        this.timestamps.push(now);
      }
      return { allowed: true, remaining: this.limit - this.timestamps.length };
    }
    return { allowed: false, remaining: 0 };
  }
}

// ============ Fixed Window Counter ============
class FixedWindowCounter {
  private count: number;
  private windowStart: number;
  private windowMs: number;
  private limit: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.count = 0;
    this.windowStart = Date.now();
  }

  consume(count: number = 1): { allowed: boolean; remaining: number } {
    const now = Date.now();
    if (now - this.windowStart >= this.windowMs) {
      this.count = 0;
      this.windowStart = now;
    }

    if (this.count + count <= this.limit) {
      this.count += count;
      return { allowed: true, remaining: this.limit - this.count };
    }
    return { allowed: false, remaining: 0 };
  }

  getResetTime(): number {
    return this.windowStart + this.windowMs;
  }
}

// ============ Main Rate Limiter ============

export class AdvancedRateLimiter {
  private options: Required<RateLimitOptions> & { algorithm: RateLimitAlgorithm };
  private buckets: Map<string, TokenBucket | LeakyBucket | SlidingWindowLog | FixedWindowCounter> = new Map();
  private violationCounts: Map<string, number> = new Map();
  private storage: RateLimitStorage;
  private backoffMultipliers: Map<string, number> = new Map();

  constructor(options: RateLimitOptions, storage?: RateLimitStorage) {
    this.options = {
      ...options,
      algorithm: options.algorithm ?? 'token-bucket',
      burst: options.burst ?? 0,
      keyPrefix: options.keyPrefix ?? 'rl',
    };
    this.storage = storage || new InMemoryStorage();
  }

  /**
   * Check if a request is allowed under the rate limit
   */
  async check(key: string): Promise<RateLimitResult> {
    const fullKey = `${this.options.keyPrefix}:${key}`;
    const bucket = this.getOrCreateBucket(fullKey);

    // Apply backoff if there have been violations
    const backoffMultiplier = this.backoffMultipliers.get(fullKey) || 1;
    const effectiveLimit = Math.floor(this.options.limit / backoffMultiplier);

    let result: { allowed: boolean; remaining: number };
    if (bucket instanceof TokenBucket || bucket instanceof LeakyBucket || bucket instanceof SlidingWindowLog || bucket instanceof FixedWindowCounter) {
      result = bucket.consume();
    } else {
      result = { allowed: true, remaining: effectiveLimit };
    }

    // Adjust remaining based on effective limit
    const adjustedRemaining = Math.min(result.remaining, effectiveLimit);

    if (!result.allowed) {
      // Track violation
      const violations = (this.violationCounts.get(fullKey) || 0) + 1;
      this.violationCounts.set(fullKey, violations);

      // Gradual backoff: increase multiplier with repeated violations
      if (violations > 3) {
        this.backoffMultipliers.set(fullKey, Math.min(backoffMultiplier * 1.5, 10));
      }
    } else {
      // Reset violation count on success
      this.violationCounts.set(fullKey, 0);
      // Gradually reduce backoff
      if (backoffMultiplier > 1) {
        this.backoffMultipliers.set(fullKey, Math.max(1, backoffMultiplier * 0.9));
      }
    }

    const resetTime = bucket instanceof FixedWindowCounter
      ? bucket.getResetTime()
      : Date.now() + this.options.windowMs;

    return {
      allowed: result.allowed,
      remaining: adjustedRemaining,
      retryAfter: result.allowed ? 0 : this.options.windowMs,
      limit: effectiveLimit,
      resetTime,
    };
  }

  /**
   * Get rate limit headers for HTTP responses
   */
  async getRateLimitHeaders(key: string): Promise<Record<string, string>> {
    const result = await this.check(key);
    return {
      'X-RateLimit-Limit': String(result.limit),
      'X-RateLimit-Remaining': String(result.remaining),
      'X-RateLimit-Reset': String(Math.ceil(result.resetTime / 1000)),
      ...(result.retryAfter > 0 ? { 'Retry-After': String(Math.ceil(result.retryAfter / 1000)) } : {}),
    };
  }

  /**
   * Reset rate limit for a specific key
   */
  async reset(key: string): Promise<void> {
    const fullKey = `${this.options.keyPrefix}:${key}`;
    this.buckets.delete(fullKey);
    this.violationCounts.delete(fullKey);
    this.backoffMultipliers.delete(fullKey);
    await this.storage.reset(fullKey);
  }

  /**
   * Reset all rate limits
   */
  async resetAll(): Promise<void> {
    this.buckets.clear();
    this.violationCounts.clear();
    this.backoffMultipliers.clear();
  }

  /**
   * Get current status for a key without consuming
   */
  getStatus(key: string): { violations: number; backoffMultiplier: number } {
    const fullKey = `${this.options.keyPrefix}:${key}`;
    return {
      violations: this.violationCounts.get(fullKey) || 0,
      backoffMultiplier: this.backoffMultipliers.get(fullKey) || 1,
    };
  }

  private getOrCreateBucket(key: string): TokenBucket | LeakyBucket | SlidingWindowLog | FixedWindowCounter {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      switch (this.options.algorithm) {
        case 'token-bucket':
          bucket = new TokenBucket(this.options.limit, this.options.windowMs, this.options.burst);
          break;
        case 'leaky-bucket':
          bucket = new LeakyBucket(this.options.limit, this.options.windowMs);
          break;
        case 'sliding-window':
          bucket = new SlidingWindowLog(this.options.limit, this.options.windowMs);
          break;
        case 'fixed-window':
          bucket = new FixedWindowCounter(this.options.limit, this.options.windowMs);
          break;
        default:
          bucket = new TokenBucket(this.options.limit, this.options.windowMs, this.options.burst);
      }
      this.buckets.set(key, bucket);
    }
    return bucket;
  }
}
