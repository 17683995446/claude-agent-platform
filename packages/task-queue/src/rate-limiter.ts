/**
 * Token bucket rate limiter.
 */

export class RateLimiter {
  private rate: number;
  private burst: number;
  private tokens: number;
  private lastRefill: number;
  private totalAcquired: number = 0;
  private totalRejected: number = 0;
  private totalWaitTime: number = 0;
  private waiters: Array<{ count: number; resolve: () => void }> = [];

  constructor(options: { rate: number; burst: number }) {
    this.rate = options.rate;
    this.burst = options.burst;
    this.tokens = options.burst;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.rate);
    this.lastRefill = now;
  }

  async acquire(count: number = 1): Promise<void> {
    this.refill();

    if (this.tokens >= count) {
      this.tokens -= count;
      this.totalAcquired += count;
      return;
    }

    // Calculate wait time
    const needed = count - this.tokens;
    const waitMs = (needed / this.rate) * 1000;

    return new Promise<void>((resolve) => {
      this.waiters.push({ count, resolve });
      this.totalWaitTime += waitMs;

      // Set a timeout to resolve waiters
      setTimeout(() => {
        this.refill();
        this.processWaiters();
      }, waitMs);
    });
  }

  private processWaiters(): void {
    while (this.waiters.length > 0 && this.tokens >= this.waiters[0]!.count) {
      const waiter = this.waiters.shift()!;
      this.tokens -= waiter.count;
      this.totalAcquired += waiter.count;
      waiter.resolve();
    }
  }

  tryAcquire(count: number = 1): boolean {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      this.totalAcquired += count;
      return true;
    }
    this.totalRejected += count;
    return false;
  }

  getAvailableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  getStats(): {
    available: number;
    totalAcquired: number;
    totalRejected: number;
    waitTime: number;
  } {
    this.refill();
    return {
      available: Math.floor(this.tokens),
      totalAcquired: this.totalAcquired,
      totalRejected: this.totalRejected,
      waitTime: this.totalWaitTime,
    };
  }

  reset(): void {
    this.tokens = this.burst;
    this.lastRefill = Date.now();
    this.totalAcquired = 0;
    this.totalRejected = 0;
    this.totalWaitTime = 0;
    this.waiters = [];
  }
}
