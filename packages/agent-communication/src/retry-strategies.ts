// src/retry-strategies.ts - 智能重试策略

export type RetryStrategy = 'fixed' | 'exponential_backoff' | 'exponential_with_jitter' | 'circuit_breaker';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface RetryOptions {
  strategy?: RetryStrategy;
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  jitterMax?: number;
  circuitBreakerThreshold?: number;
  circuitBreakerResetTime?: number;
  retryBudget?: number;
  retryBudgetWindow?: number;
  destination?: string;
  onRetry?: (attempt: number, error: Error) => void;
  onFailure?: (error: Error) => void;
  onRecovery?: () => void;
}

interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number;
  successCount: number;
  halfOpenProbes: number; // COMM-26: track probe requests in half-open state
}

interface RetryBudgetState {
  retries: number;
  windowStart: number;
}

export class RetryManager {
  private circuitStates: Map<string, CircuitBreakerState> = new Map();
  private retryBudgets: Map<string, RetryBudgetState> = new Map();
  private defaultOptions: Required<Pick<RetryOptions, 'maxRetries' | 'baseDelay' | 'maxDelay' | 'jitterMax' | 'circuitBreakerThreshold' | 'circuitBreakerResetTime'>> = {
    maxRetries: 3,
    baseDelay: 100,
    maxDelay: 10000,
    jitterMax: 100,
    circuitBreakerThreshold: 5,
    circuitBreakerResetTime: 30000,
  };

  async execute<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
    const opts = {
      strategy: options?.strategy ?? 'exponential_backoff',
      maxRetries: options?.maxRetries ?? this.defaultOptions.maxRetries,
      baseDelay: options?.baseDelay ?? this.defaultOptions.baseDelay,
      maxDelay: options?.maxDelay ?? this.defaultOptions.maxDelay,
      jitterMax: options?.jitterMax ?? this.defaultOptions.jitterMax,
      destination: options?.destination ?? 'default',
      onRetry: options?.onRetry,
      onFailure: options?.onFailure,
      onRecovery: options?.onRecovery,
    };

    // Check circuit breaker - always check regardless of strategy
    // COMM-8: Removed `|| true` hack; circuit breaker protects all strategies
    // BUG-FIX-004 [MEDIUM]: Use per-call threshold and resetTime from options when provided,
    // falling back to defaults otherwise.
    const effectiveThreshold = options?.circuitBreakerThreshold ?? this.defaultOptions.circuitBreakerThreshold;
    const effectiveResetTime = options?.circuitBreakerResetTime ?? this.defaultOptions.circuitBreakerResetTime;
    {
      const circuit = this.getCircuitStateInternal(opts.destination);
      if (circuit.state === 'open') {
        if (Date.now() - circuit.lastFailureTime > effectiveResetTime) {
          circuit.state = 'half-open';
          circuit.halfOpenProbes = 0;
        } else {
          throw new Error(`Circuit breaker open for destination: ${opts.destination}`);
        }
      }
      // COMM-26: Limit probe requests in half-open state
      if (circuit.state === 'half-open' && circuit.halfOpenProbes >= 3) {
        throw new Error(`Circuit breaker half-open: probe limit reached for destination: ${opts.destination}`);
      }
      if (circuit.state === 'half-open') {
        circuit.halfOpenProbes++;
      }
    }

    // COMM-27: Moved retry budget check inside retry loop for atomicity
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
      // COMM-27: Check retry budget atomically inside the loop
      if (attempt > 0 && options?.retryBudget !== undefined) {
        const budget = this.getRetryBudget(opts.destination, options.retryBudget, options.retryBudgetWindow ?? 60000);
        if (budget.retries >= options.retryBudget) {
          throw new Error(`Retry budget exhausted for destination: ${opts.destination}`);
        }
      }
      try {
        const result = await fn();
        this.onSuccess(opts.destination);
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.onFailureInternal(opts.destination, effectiveThreshold);

        if (attempt < opts.maxRetries) {
          opts.onRetry?.(attempt + 1, lastError);
          if (options?.retryBudget !== undefined) {
            this.incrementRetryBudget(opts.destination, options.retryBudget, options.retryBudgetWindow ?? 60000);
          }
          const delay = this.calculateDelay(attempt, opts.strategy!, opts.baseDelay, opts.maxDelay, opts.jitterMax);
          await this.sleep(delay);
        }
      }
    }

    opts.onFailure?.(lastError!);
    throw lastError!;
  }

  getCircuitState(destination: string): CircuitState {
    return this.getCircuitStateInternal(destination).state;
  }

  resetCircuit(destination: string): void {
    this.circuitStates.set(destination, {
      state: 'closed',
      failureCount: 0,
      lastFailureTime: 0,
      successCount: 0,
      halfOpenProbes: 0,
    });
  }

  private getCircuitStateInternal(destination: string): CircuitBreakerState {
    if (!this.circuitStates.has(destination)) {
      this.circuitStates.set(destination, {
        state: 'closed',
        failureCount: 0,
        lastFailureTime: 0,
        successCount: 0,
        halfOpenProbes: 0,
      });
    }
    return this.circuitStates.get(destination)!;
  }

  private getRetryBudget(destination: string, budget: number, window: number): RetryBudgetState {
    const key = `${destination}:${budget}:${window}`;
    if (!this.retryBudgets.has(key)) {
      this.retryBudgets.set(key, { retries: 0, windowStart: Date.now() });
    }
    const state = this.retryBudgets.get(key)!;
    if (Date.now() - state.windowStart > window) {
      state.retries = 0;
      state.windowStart = Date.now();
    }
    return state;
  }

  private incrementRetryBudget(destination: string, budget: number, window: number): void {
    const state = this.getRetryBudget(destination, budget, window);
    state.retries++;
  }

  private onSuccess(destination: string): void {
    const circuit = this.getCircuitStateInternal(destination);
    if (circuit.state === 'half-open') {
      circuit.state = 'closed';
      circuit.failureCount = 0;
      circuit.halfOpenProbes = 0;
    }
    circuit.successCount++;
  }

  private onFailureInternal(destination: string, threshold?: number): void {
    const circuit = this.getCircuitStateInternal(destination);
    circuit.failureCount++;
    circuit.lastFailureTime = Date.now();

    // BUG-FIX-004 [MEDIUM]: Use provided threshold or fall back to default
    const effectiveThreshold = threshold ?? this.defaultOptions.circuitBreakerThreshold;
    if (circuit.failureCount >= effectiveThreshold) {
      circuit.state = 'open';
    }
  }

  private calculateDelay(
    attempt: number,
    strategy: RetryStrategy,
    baseDelay: number,
    maxDelay: number,
    jitterMax: number,
  ): number {
    switch (strategy) {
      case 'fixed':
        return baseDelay;
      case 'exponential_backoff':
        return Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      case 'exponential_with_jitter':
        const exp = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        return exp + Math.random() * jitterMax;
      case 'circuit_breaker':
        return Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      default:
        return baseDelay;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  reset(): void {
    this.circuitStates.clear();
    this.retryBudgets.clear();
  }
}
