// fallback-provider.ts - 降级策略

export type FallbackStrategy = 'cached_value' | 'default_value' | 'alternative_function' | 'throw_custom_error';

export interface Fallback<T> {
  strategy: FallbackStrategy;
  value?: T;
  alternativeFn?: () => Promise<T>;
  errorType?: string;
  errorPattern?: RegExp;
  customError?: Error;
  priority?: number;
}

export interface FallbackMetrics {
  primarySuccessCount: number;
  primaryFailureCount: number;
  fallbackTriggeredCount: number;
  fallbackSuccessCount: number;
  fallbackFailureCount: number;
  lastFallbackUsed: string | null;
}

export class FallbackProvider<T> {
  private fallbacks: Fallback<T>[] = [];
  private cachedValue: T | undefined;
  private hasCachedValue = false;
  private metrics: FallbackMetrics = {
    primarySuccessCount: 0,
    primaryFailureCount: 0,
    fallbackTriggeredCount: 0,
    fallbackSuccessCount: 0,
    fallbackFailureCount: 0,
    lastFallbackUsed: null,
  };

  async execute(fn: () => Promise<T>, fallbacks?: Fallback<T>[]): Promise<T> {
    const allFallbacks = fallbacks ?? this.fallbacks;
    const sorted = [...allFallbacks].sort((a, b) => (a.priority ?? 10) - (b.priority ?? 10));

    try {
      const result = await fn();
      this.metrics.primarySuccessCount++;
      this.cachedValue = result;
      this.hasCachedValue = true;
      return result;
    } catch (error) {
      this.metrics.primaryFailureCount++;
      const err = error instanceof Error ? error : new Error(String(error));

      for (const fallback of sorted) {
        if (!this.matchesFallback(err, fallback)) continue;

        this.metrics.fallbackTriggeredCount++;
        if (fallback.strategy === 'throw_custom_error') {
          this.metrics.lastFallbackUsed = fallback.strategy;
          throw fallback.customError ?? new Error('Custom fallback error');
        }
        try {
          const result = await this.executeFallback(fallback);
          this.metrics.fallbackSuccessCount++;
          this.metrics.lastFallbackUsed = fallback.strategy;
          return result;
        } catch (fallbackError) {
          this.metrics.fallbackFailureCount++;
          continue;
        }
      }

      throw error;
    }
  }

  addFallback(fallback: Fallback<T>): void {
    this.fallbacks.push(fallback);
  }

  removeFallback(strategy: FallbackStrategy): void {
    this.fallbacks = this.fallbacks.filter(f => f.strategy !== strategy);
  }

  getMetrics(): FallbackMetrics {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = {
      primarySuccessCount: 0,
      primaryFailureCount: 0,
      fallbackTriggeredCount: 0,
      fallbackSuccessCount: 0,
      fallbackFailureCount: 0,
      lastFallbackUsed: null,
    };
  }

  setCachedValue(value: T): void {
    this.cachedValue = value;
    this.hasCachedValue = true;
  }

  getCachedValue(): T | undefined {
    return this.cachedValue;
  }

  private matchesFallback(error: Error, fallback: Fallback<T>): boolean {
    // OR logic: if any of the configured matchers match, the fallback applies.
    // If no matchers are configured, the fallback applies to all errors.
    const hasTypeMatch = fallback.errorType
      ? error.constructor.name === fallback.errorType
      : false;

    const hasPatternMatch = fallback.errorPattern
      ? fallback.errorPattern.test(error.message)
      : false;

    // If no matchers configured, fallback applies to everything
    if (!fallback.errorType && !fallback.errorPattern) {
      return true;
    }

    return hasTypeMatch || hasPatternMatch;
  }

  private async executeFallback(fallback: Fallback<T>): Promise<T> {
    switch (fallback.strategy) {
      case 'cached_value':
        if (!this.hasCachedValue) {
          throw new Error('No cached value available');
        }
        return this.cachedValue!;
      case 'default_value':
        if (fallback.value === undefined) {
          throw new Error('No default value configured');
        }
        return fallback.value;
      case 'alternative_function':
        if (!fallback.alternativeFn) {
          throw new Error('No alternative function configured');
        }
        return fallback.alternativeFn();
      case 'throw_custom_error':
        throw fallback.customError ?? new Error('Custom fallback error');
      default:
        throw new Error(`Unknown fallback strategy: ${fallback.strategy}`);
    }
  }
}
