/**
 * Backoff strategies for retry mechanisms.
 */

export interface BackoffStrategy {
  getDelay(attempt: number): number;
  reset(): void;
}

/**
 * Exponential backoff: delay = base * 2^attempt, capped at maxMs.
 * Optional jitter adds randomness to prevent thundering herd.
 */
export class ExponentialBackoff implements BackoffStrategy {
  private readonly baseMs: number;
  private readonly maxMs: number;
  private readonly jitter: boolean;
  private attemptCount: number = 0;

  constructor(options?: { baseMs?: number; maxMs?: number; jitter?: boolean }) {
    this.baseMs = options?.baseMs ?? 100;
    this.maxMs = options?.maxMs ?? 30000;
    this.jitter = options?.jitter ?? false;
  }

  getDelay(attempt: number): number {
    this.attemptCount = attempt;
    let delay = this.baseMs * Math.pow(2, attempt);
    if (delay > this.maxMs) {
      delay = this.maxMs;
    }
    if (this.jitter) {
      delay = Math.floor(delay * (0.5 + Math.random() * 0.5));
    }
    return delay;
  }

  reset(): void {
    this.attemptCount = 0;
  }
}

/**
 * Fixed backoff: always returns the same delay.
 */
export class FixedBackoff implements BackoffStrategy {
  private readonly delayMs: number;

  constructor(delayMs: number) {
    this.delayMs = delayMs;
  }

  getDelay(_attempt: number): number {
    return this.delayMs;
  }

  reset(): void {
    // No-op for fixed backoff
  }
}

/**
 * Linear backoff: delay = start + increment * attempt, capped at maxMs.
 */
export class LinearBackoff implements BackoffStrategy {
  private readonly startMs: number;
  private readonly incrementMs: number;
  private readonly maxMs: number;

  constructor(startMs: number, incrementMs: number, maxMs: number) {
    this.startMs = startMs;
    this.incrementMs = incrementMs;
    this.maxMs = maxMs;
  }

  getDelay(attempt: number): number {
    const delay = this.startMs + this.incrementMs * attempt;
    return delay > this.maxMs ? this.maxMs : delay;
  }

  reset(): void {
    // No-op for linear backoff
  }
}
