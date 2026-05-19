// retry-with-backoff.ts - 智能重试

export type BackoffStrategy = 'fixed' | 'linear' | 'exponential' | 'exponential_with_jitter' | 'custom';

export interface RetryConfig {
  maxRetries: number;
  strategy: BackoffStrategy;
  baseDelay?: number;
  maxDelay?: number;
  jitterFactor?: number;
  customDelayFn?: (attempt: number) => number;
  retryablePredicate?: (error: Error) => boolean;
  retryableErrorTypes?: string[];
  retryablePatterns?: RegExp[];
  signal?: AbortSignal;
}

export interface RetryEvent {
  attempt: number;
  error: Error;
  delay: number;
  timestamp: number;
}

type RetryCallback = (attempt: number, error: Error, delay: number) => void;

export class RetryWithBackoff {
  private readonly config: Required<Pick<RetryConfig, 'maxRetries' | 'strategy' | 'baseDelay' | 'maxDelay' | 'jitterFactor'>> & RetryConfig;
  private retryCallbacks: RetryCallback[] = [];
  private history: RetryEvent[] = [];

  constructor(config: RetryConfig) {
    this.config = {
      baseDelay: 1000,
      maxDelay: 30000,
      jitterFactor: 0.5,
      ...config,
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;
    let attempt = 0;

    while (attempt <= this.config.maxRetries) {
      if (this.config.signal?.aborted) {
        throw new DOMException('Operation aborted', 'AbortError');
      }

      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        attempt++;

        if (attempt > this.config.maxRetries || !this.isRetryable(lastError)) {
          throw lastError;
        }

        const delay = this.calculateDelay(attempt);
        this.history.push({ attempt, error: lastError, delay, timestamp: Date.now() });
        this.retryCallbacks.forEach(cb => cb(attempt, lastError!, delay));

        await this.sleep(delay);
      }
    }

    throw lastError!;
  }

  onRetry(callback: RetryCallback): void {
    this.retryCallbacks.push(callback);
  }

  removeRetryCallback(callback: RetryCallback): void {
    const index = this.retryCallbacks.indexOf(callback);
    if (index !== -1) {
      this.retryCallbacks.splice(index, 1);
    }
  }

  getHistory(): RetryEvent[] {
    return [...this.history];
  }

  clearHistory(): void {
    this.history = [];
  }

  private calculateDelay(attempt: number): number {
    let delay: number;
    const base = this.config.baseDelay!;

    switch (this.config.strategy) {
      case 'fixed':
        delay = base;
        break;
      case 'linear':
        delay = base * attempt;
        break;
      case 'exponential':
        delay = base * Math.pow(2, attempt - 1);
        break;
      case 'exponential_with_jitter':
        delay = base * Math.pow(2, attempt - 1);
        delay = delay * (1 + (Math.random() * 2 - 1) * this.config.jitterFactor!);
        break;
      case 'custom':
        delay = this.config.customDelayFn ? this.config.customDelayFn(attempt) : base;
        break;
      default:
        delay = base;
    }

    return Math.min(delay, this.config.maxDelay!);
  }

  private isRetryable(error: Error): boolean {
    // If a custom predicate is provided, use it exclusively
    if (this.config.retryablePredicate) {
      return this.config.retryablePredicate(error);
    }

    // OR logic: if any of the configured matchers match, the error is retryable.
    // If no matchers are configured, all errors are considered retryable.
    const hasTypeMatch = this.config.retryableErrorTypes?.length
      ? this.config.retryableErrorTypes.includes(error.constructor.name)
      : false;

    const hasPatternMatch = this.config.retryablePatterns?.length
      ? this.config.retryablePatterns.some(p => p.test(error.message))
      : false;

    // If no matchers are configured at all, default to retryable
    if (!this.config.retryableErrorTypes?.length && !this.config.retryablePatterns?.length) {
      return true;
    }

    return hasTypeMatch || hasPatternMatch;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      // Check synchronously before setting up the timer
      if (this.config.signal?.aborted) {
        reject(new DOMException('Operation aborted', 'AbortError'));
        return;
      }

      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      }, ms);

      const cleanup = () => {
        clearTimeout(timer);
        if (this.config.signal) {
          this.config.signal.removeEventListener('abort', onAbort);
        }
      };

      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new DOMException('Operation aborted', 'AbortError'));
      };

      if (this.config.signal) {
        this.config.signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }
}
