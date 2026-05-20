// ============================================================================
// @claude-agent/perf - ConcurrencyControl
// 信号量、速率限制器、令牌桶算法、滑动窗口
// ============================================================================

// ---- Semaphore ----

export interface SemaphoreOptions {
  /** 最大并发数 */
  maxConcurrency: number;
  /** 等待超时（ms），0 表示不超时 */
  timeout?: number;
}

export class Semaphore {
  private current = 0;
  private queue: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout> | null;
  }> = [];
  private options: Required<SemaphoreOptions>;

  constructor(options: SemaphoreOptions) {
    this.options = {
      maxConcurrency: options.maxConcurrency,
      timeout: options.timeout ?? 0,
    };
  }

  /** 获取一个信号量许可 */
  async acquire(): Promise<void> {
    if (this.current < this.options.maxConcurrency) {
      this.current++;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;

      if (this.options.timeout > 0) {
        timer = setTimeout(() => {
          const index = this.queue.findIndex((w) => w.resolve === resolve);
          if (index !== -1) {
            this.queue.splice(index, 1);
          }
          reject(new Error(`Semaphore acquire timeout after ${this.options.timeout}ms`));
        }, this.options.timeout);
      }

      this.queue.push({ resolve, reject, timer });
    });
  }

  /** 释放一个信号量许可 */
  release(): void {
    if (this.queue.length > 0) {
      const waiter = this.queue.shift()!;
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve();
    } else {
      this.current = Math.max(0, this.current - 1);
    }
  }

  /** 获取当前并发数 */
  getCurrent(): number {
    return this.current;
  }

  /** 获取等待队列长度 */
  getWaiting(): number {
    return this.queue.length;
  }

  /** 使用信号量执行函数 */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** 销毁信号量，等待进行中的操作完成（带超时） */
  async dispose(timeout: number = 5000): Promise<void> {
    const startTime = Date.now();
    // Wait for all acquired permits to be released
    while (this.current > 0) {
      if (Date.now() - startTime > timeout) {
        // Force release: reject all waiters
        for (const waiter of this.queue) {
          if (waiter.timer) clearTimeout(waiter.timer);
          waiter.reject(new Error('Semaphore disposed'));
        }
        this.queue.length = 0;
        this.current = 0;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    // Reject remaining waiters
    for (const waiter of this.queue) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.reject(new Error('Semaphore disposed'));
    }
    this.queue.length = 0;
  }
}

// ---- RateLimiter (Token Bucket) ----

export interface RateLimiterOptions {
  /** 令牌桶容量 */
  maxTokens: number;
  /** 令牌填充速率（个/秒） */
  refillRate: number;
  /** 初始令牌数 */
  initialTokens?: number;
}

export class RateLimiter {
  private tokens: number;
  private lastRefillTime: number;
  private options: Required<RateLimiterOptions>;

  constructor(options: RateLimiterOptions) {
    this.options = {
      maxTokens: options.maxTokens,
      refillRate: options.refillRate,
      initialTokens: options.initialTokens ?? options.maxTokens,
    };
    this.tokens = this.options.initialTokens;
    this.lastRefillTime = Date.now();
  }

  /** 尝试获取一个令牌 */
  tryAcquire(count: number = 1): boolean {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  /** 获取一个令牌，如果不足则等待 */
  async acquire(count: number = 1): Promise<void> {
    while (!this.tryAcquire(count)) {
      const waitTime = Math.ceil((count - this.tokens) / this.options.refillRate * 1000);
      await new Promise((resolve) => setTimeout(resolve, Math.min(waitTime, 1000)));
    }
  }

  /** 获取可用令牌数 */
  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }

  /** 释放令牌回桶中 */
  release(count: number = 1): void {
    this.tokens = Math.min(this.options.maxTokens, this.tokens + count);
  }

  /** 获取下次令牌可用时间（ms） */
  getTimeUntilNextToken(): number {
    if (this.tokens >= 1) return 0;
    return Math.ceil((1 - this.tokens) / this.options.refillRate * 1000);
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefillTime) / 1000;
    const tokensToAdd = elapsed * this.options.refillRate;

    this.tokens = Math.min(this.options.maxTokens, this.tokens + tokensToAdd);
    this.lastRefillTime = now;
  }
}

// ---- SlidingWindowRateLimiter ----

export interface SlidingWindowOptions {
  /** 窗口内最大请求数 */
  maxRequests: number;
  /** 窗口大小（ms） */
  windowSize: number;
}

export class SlidingWindowRateLimiter {
  private timestamps: number[] = [];
  private options: Required<SlidingWindowOptions>;

  constructor(options: SlidingWindowOptions) {
    this.options = {
      maxRequests: options.maxRequests,
      windowSize: options.windowSize,
    };
  }

  /** 尝试通过限流 */
  tryAcquire(): boolean {
    const now = Date.now();
    const windowStart = now - this.options.windowSize;

    // Remove expired timestamps
    this.timestamps = this.timestamps.filter((t) => t > windowStart);

    if (this.timestamps.length < this.options.maxRequests) {
      this.timestamps.push(now);
      return true;
    }

    return false;
  }

  /** 等待直到可以通过限流 */
  async acquire(): Promise<void> {
    while (!this.tryAcquire()) {
      const now = Date.now();
      const oldestInWindow = this.timestamps[0] ?? now;
      const waitTime = oldestInWindow + this.options.windowSize - now + 1;
      await new Promise((resolve) => setTimeout(resolve, Math.max(waitTime, 1)));
    }
  }

  /** 获取当前窗口内的请求数 */
  getCurrentCount(): number {
    const now = Date.now();
    const windowStart = now - this.options.windowSize;
    return this.timestamps.filter((t) => t > windowStart).length;
  }

  /** 获取剩余可用请求数 */
  getRemainingRequests(): number {
    return Math.max(0, this.options.maxRequests - this.getCurrentCount());
  }

  /** 重置限流器 */
  reset(): void {
    this.timestamps.length = 0;
  }
}

// ---- ConcurrencyController (组合控制器) ----

export interface ConcurrencyControllerOptions {
  /** 最大并发数 */
  maxConcurrency: number;
  /** 速率限制（请求/秒） */
  rateLimit?: number;
  /** 滑动窗口配置 */
  slidingWindow?: {
    maxRequests: number;
    windowSize: number;
  };
}

export class ConcurrencyController {
  private semaphore: Semaphore;
  private rateLimiter: RateLimiter | null = null;
  private slidingWindow: SlidingWindowRateLimiter | null = null;

  constructor(options: ConcurrencyControllerOptions) {
    this.semaphore = new Semaphore({ maxConcurrency: options.maxConcurrency });

    if (options.rateLimit) {
      this.rateLimiter = new RateLimiter({
        maxTokens: options.rateLimit,
        refillRate: options.rateLimit,
      });
    }

    if (options.slidingWindow) {
      this.slidingWindow = new SlidingWindowRateLimiter(options.slidingWindow);
    }
  }

  /** 获取执行许可 */
  async acquire(): Promise<void> {
    if (this.slidingWindow) {
      await this.slidingWindow.acquire();
    }
    if (this.rateLimiter) {
      await this.rateLimiter.acquire();
    }
    await this.semaphore.acquire();
  }

  /** 释放执行许可 */
  release(): void {
    this.semaphore.release();
    // Return tokens to rate limiter
    if (this.rateLimiter) {
      this.rateLimiter.release(1);
    }
  }

  /** 使用控制器执行函数 */
  async run<T>(fn: () => Promise<T>, timeout?: number): Promise<T> {
    await this.acquire();
    try {
      if (timeout !== undefined) {
        return await this.withTimeout(fn(), timeout);
      }
      return await fn();
    } finally {
      this.release();
    }
  }

  private withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`ConcurrencyController: timeout after ${timeout}ms`)), timeout);
      }),
    ]).finally(() => {
      clearTimeout(timer!);
    });
  }

  /** 获取状态 */
  getStatus(): {
    currentConcurrency: number;
    waiting: number;
    availableTokens: number | null;
    remainingRequests: number | null;
  } {
    return {
      currentConcurrency: this.semaphore.getCurrent(),
      waiting: this.semaphore.getWaiting(),
      availableTokens: this.rateLimiter?.getAvailableTokens() ?? null,
      remainingRequests: this.slidingWindow?.getRemainingRequests() ?? null,
    };
  }
}
