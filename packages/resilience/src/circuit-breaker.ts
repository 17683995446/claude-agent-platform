// circuit-breaker.ts - 熔断器

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
  windowType: 'time' | 'count';
  windowSize?: number; // ms for time-based, count for count-based
}

export interface CircuitBreakerMetrics {
  failureCount: number;
  successCount: number;
  lastFailureTime: number | null;
  stateDurations: Record<CircuitState, number>;
}

export interface CircuitBreakerEvents {
  stateChange: (from: CircuitState, to: CircuitState) => void;
  failure: (error: Error) => void;
  success: () => void;
  halfOpenAttempt: () => void;
}

type EventCallback = (...args: unknown[]) => void;

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;
  private stateEnterTime = Date.now();
  private stateDurations: Record<CircuitState, number> = { closed: 0, open: 0, 'half-open': 0 };
  private halfOpenSuccessCount = 0;
  private listeners = new Map<string, Set<EventCallback>>();
  private windowFailures: { time: number }[] = [];

  private readonly config: Required<CircuitBreakerConfig>;

  constructor(config: CircuitBreakerConfig) {
    this.config = {
      windowSize: config.windowType === 'time' ? 60000 : 10,
      ...config,
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.stateEnterTime >= this.config.timeout) {
        this.transitionTo('half-open');
      } else {
        throw new CircuitBreakerOpenError('Circuit breaker is open');
      }
    }

    if (this.state === 'half-open') {
      this.emit('halfOpenAttempt');
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  getState(): CircuitState {
    if (this.state === 'open' && Date.now() - this.stateEnterTime >= this.config.timeout) {
      this.transitionTo('half-open');
    }
    return this.state;
  }

  forceOpen(): void {
    this.transitionTo('open');
  }

  forceClose(): void {
    this.transitionTo('closed');
  }

  reset(): void {
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.halfOpenSuccessCount = 0;
    this.windowFailures = [];
    this.transitionTo('closed');
  }

  getMetrics(): CircuitBreakerMetrics {
    const now = Date.now();
    const currentDuration = now - this.stateEnterTime;
    return {
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      stateDurations: {
        ...this.stateDurations,
        [this.state]: this.stateDurations[this.state] + currentDuration,
      },
    };
  }

  on(event: keyof CircuitBreakerEvents, callback: EventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: keyof CircuitBreakerEvents, callback: EventCallback): void {
    const set = this.listeners.get(event);
    set?.delete(callback);
    if (set && set.size === 0) {
      this.listeners.delete(event);
    }
  }

  private emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach(cb => cb(...args));
  }

  private onSuccess(): void {
    this.successCount++;
    this.emit('success');

    if (this.state === 'half-open') {
      this.halfOpenSuccessCount++;
      if (this.halfOpenSuccessCount >= this.config.successThreshold) {
        this.transitionTo('closed');
      }
    }

    if (this.state === 'closed') {
      // Design decision: successes prune the window (remove stale entries) but do
      // not actively reduce the failure count. The failure window naturally shrinks
      // as old entries age out via pruneWindow(). This avoids masking a high
      // failure rate with a few interleaved successes.
      this.pruneWindow();
    }
  }

  private onFailure(error: Error): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.emit('failure', error);

    if (this.state === 'half-open') {
      this.transitionTo('open');
      return;
    }

    if (this.state === 'closed') {
      const now = Date.now();
      this.windowFailures.push({ time: now });
      this.pruneWindow();

      // Both count-based and time-based windows use the same trip condition:
      // if the number of failures in the window meets the threshold, open the circuit.
      if (this.windowFailures.length >= this.config.failureThreshold) {
        this.transitionTo('open');
      }
    }
  }

  private pruneWindow(): void {
    if (this.config.windowType === 'time') {
      const cutoff = Date.now() - this.config.windowSize;
      this.windowFailures = this.windowFailures.filter(f => f.time >= cutoff);
    } else {
      while (this.windowFailures.length > this.config.windowSize) {
        this.windowFailures.shift();
      }
    }
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state === newState) return;
    const oldState = this.state;
    const now = Date.now();
    this.stateDurations[this.state] += now - this.stateEnterTime;
    this.state = newState;
    this.stateEnterTime = now;
    this.halfOpenSuccessCount = 0;

    // Reset failure counters when transitioning to closed state
    if (newState === 'closed') {
      this.failureCount = 0;
      this.windowFailures = [];
    }

    this.emit('stateChange', oldState, newState);
  }
}

export class CircuitBreakerOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}
