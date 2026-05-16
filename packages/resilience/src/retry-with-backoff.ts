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
    if (this.config.retryablePredicate && !this.config.retryablePredicate(error)) {
      return false;
    }

    if (this.config.retryableErrorTypes?.length) {
      if (!this.config.retryableErrorTypes.includes(error.constructor.name)) {
        return false;
      }
    }

    if (this.config.retryablePatterns?.length) {
      if (!this.config.retryablePatterns.some(p => p.test(error.message))) {
        return false;
      }
    }

    return true;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      if (this.config.signal) {
        const onAbort = () => {
          clearTimeout(timer);
          reject(new DOMException('Operation aborted', 'AbortError'));
        };
        this.config.signal.addEventListener('abort', onAbort, { once: true });
        setTimeout(() => this.config.signal!.removeEventListener('abort', onAbort), ms + 100);
      }
    });
  }
}
