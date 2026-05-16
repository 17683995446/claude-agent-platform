// ============================================================================
// @claude-agent/decorators - Decorator Pattern
// ============================================================================

import type { LoggerInterface } from '@claude-agent/types';
import { Logger } from '@claude-agent/logger';

// ---- Decoratable Interface ----
export interface IDecoratable<TFunc extends (...args: any[]) => any> {
  readonly name: string;
  execute: TFunc;
}

// ---- Base Decorator ----
export abstract class BaseDecorator<TFunc extends (...args: any[]) => any> implements IDecoratable<TFunc> {
  protected inner: IDecoratable<TFunc>;

  constructor(inner: IDecoratable<TFunc>) {
    this.inner = inner;
  }

  get name(): string {
    return this.inner.name;
  }

  abstract execute: TFunc;
}

// ---- Logging Decorator ----
export class LoggingDecorator<TFunc extends (...args: any[]) => any> extends BaseDecorator<TFunc> {
  private logger: LoggerInterface;

  constructor(inner: IDecoratable<TFunc>, logger?: LoggerInterface) {
    super(inner);
    this.logger = logger ?? new Logger();
  }

  execute = (...args: Parameters<TFunc>): ReturnType<TFunc> => {
    this.logger.info(`Executing: ${this.name}`, { args: args.length });
    const start = Date.now();
    try {
      const result = this.inner.execute(...args);
      this.logger.info(`Completed: ${this.name} [${Date.now() - start}ms]`);
      return result;
    } catch (error) {
      this.logger.error(`Failed: ${this.name} [${Date.now() - start}ms]`, { error: String(error) });
      throw error;
    }
  };
}

// ---- Caching Decorator ----
export class CachingDecorator<TFunc extends (...args: any[]) => Promise<any>> extends BaseDecorator<TFunc> {
  private cache: Map<string, { result: any; expiry: number }> = new Map();
  private ttl: number;
  private keyGenerator: (args: Parameters<TFunc>) => string;

  constructor(
    inner: IDecoratable<TFunc>,
    options?: {
      ttl?: number;
      keyGenerator?: (args: Parameters<TFunc>) => string;
    },
  ) {
    super(inner);
    this.ttl = options?.ttl ?? 60000;
    this.keyGenerator = options?.keyGenerator ?? ((args) => JSON.stringify(args));
  }

  execute = async (...args: Parameters<TFunc>): Promise<ReturnType<TFunc>> => {
    const key = this.keyGenerator(args);
    const cached = this.cache.get(key);
    if (cached && Date.now() < cached.expiry) {
      return cached.result as ReturnType<TFunc>;
    }
    const result = await this.inner.execute(...args);
    this.cache.set(key, { result, expiry: Date.now() + this.ttl });
    return result;
  };

  clearCache(): void {
    this.cache.clear();
  }

  getCacheSize(): number {
    return this.cache.size;
  }
}

// ---- Retry Decorator ----
export class RetryDecorator<TFunc extends (...args: any[]) => Promise<any>> extends BaseDecorator<TFunc> {
  private maxRetries: number;
  private delay: number;
  private backoff: 'linear' | 'exponential';
  private logger: LoggerInterface;

  constructor(
    inner: IDecoratable<TFunc>,
    options?: {
      maxRetries?: number;
      delay?: number;
      backoff?: 'linear' | 'exponential';
      logger?: LoggerInterface;
    },
  ) {
    super(inner);
    this.maxRetries = options?.maxRetries ?? 3;
    this.delay = options?.delay ?? 1000;
    this.backoff = options?.backoff ?? 'exponential';
    this.logger = options?.logger ?? new Logger();
  }

  execute = async (...args: Parameters<TFunc>): Promise<ReturnType<TFunc>> => {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.inner.execute(...args);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < this.maxRetries) {
          const waitTime = this.backoff === 'exponential'
            ? this.delay * Math.pow(2, attempt)
            : this.delay * (attempt + 1);
          this.logger.warn(`Retry ${attempt + 1}/${this.maxRetries} for ${this.name} in ${waitTime}ms`);
          await new Promise(r => setTimeout(r, waitTime));
        }
      }
    }
    throw lastError;
  };
}

// ---- Timing Decorator ----
export class TimingDecorator<TFunc extends (...args: any[]) => any> extends BaseDecorator<TFunc> {
  private timings: { start: number; end: number; duration: number }[] = [];

  execute = (...args: Parameters<TFunc>): ReturnType<TFunc> => {
    const start = Date.now();
    try {
      const result = this.inner.execute(...args);
      if (result instanceof Promise) {
        return result.then((r: any) => {
          this.timings.push({ start, end: Date.now(), duration: Date.now() - start });
          return r;
        }) as any;
      }
      this.timings.push({ start, end: Date.now(), duration: Date.now() - start });
      return result;
    } catch (error) {
      this.timings.push({ start, end: Date.now(), duration: Date.now() - start });
      throw error;
    }
  };

  getTimings(): { avg: number; min: number; max: number; count: number } {
    if (this.timings.length === 0) return { avg: 0, min: 0, max: 0, count: 0 };
    const durations = this.timings.map(t => t.duration);
    return {
      avg: durations.reduce((a, b) => a + b, 0) / durations.length,
      min: Math.min(...durations),
      max: Math.max(...durations),
      count: durations.length,
    };
  }

  clearTimings(): void {
    this.timings = [];
  }
}

// ---- Rate Limit Decorator ----
export class RateLimitDecorator<TFunc extends (...args: any[]) => any> extends BaseDecorator<TFunc> {
  private calls: number[] = [];
  private maxCalls: number;
  private windowMs: number;

  constructor(inner: IDecoratable<TFunc>, options?: { maxCalls?: number; windowMs?: number }) {
    super(inner);
    this.maxCalls = options?.maxCalls ?? 10;
    this.windowMs = options?.windowMs ?? 1000;
  }

  execute = (...args: Parameters<TFunc>): ReturnType<TFunc> => {
    const now = Date.now();
    this.calls = this.calls.filter(t => now - t < this.windowMs);
    if (this.calls.length >= this.maxCalls) {
      throw new Error(`Rate limit exceeded for ${this.name}: ${this.maxCalls} calls per ${this.windowMs}ms`);
    }
    this.calls.push(now);
    return this.inner.execute(...args);
  };
}

// ---- Simple Service Wrapper ----
export class Service<TFunc extends (...args: any[]) => any> implements IDecoratable<TFunc> {
  readonly name: string;
  execute: TFunc;

  constructor(name: string, fn: TFunc) {
    this.name = name;
    this.execute = fn;
  }
}

// ---- Decorator Builder ----
export function decorate<TFunc extends (...args: any[]) => any>(
  name: string,
  fn: TFunc,
): Service<TFunc> {
  return new Service(name, fn);
}
