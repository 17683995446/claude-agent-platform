// circuit-breaker-stream.ts - Circuit breaker for stream processing

export class StreamCircuitBreaker {
  private failureThreshold: number;
  private recoveryTimeout: number;
  private halfOpenMaxCalls: number;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failures = 0;
  private successes = 0;
  private lastFailure: number | undefined;
  private lastSuccess: number | undefined;
  private halfOpenCalls = 0;
  private openSince = 0;
  private stateChangeHandlers: Array<(state: 'closed' | 'open' | 'half-open') => void> = [];

  constructor(options?: {
    failureThreshold?: number;
    recoveryTimeout?: number;
    halfOpenMaxCalls?: number;
  }) {
    this.failureThreshold = options?.failureThreshold ?? 5;
    this.recoveryTimeout = options?.recoveryTimeout ?? 30000;
    this.halfOpenMaxCalls = options?.halfOpenMaxCalls ?? 3;
  }

  async process(event: unknown, handler: (e: unknown) => Promise<unknown>): Promise<unknown> {
    this.checkStateTransition();

    if (this.state === 'open') {
      throw new Error('Circuit breaker is open');
    }

    try {
      const result = await handler(event);
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  getState(): 'closed' | 'open' | 'half-open' {
    this.checkStateTransition();
    return this.state;
  }

  getStats(): {
    state: 'closed' | 'open' | 'half-open';
    failures: number;
    successes: number;
    lastFailure: number | undefined;
    lastSuccess: number | undefined;
  } {
    return {
      state: this.getState(),
      failures: this.failures,
      successes: this.successes,
      lastFailure: this.lastFailure,
      lastSuccess: this.lastSuccess,
    };
  }

  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.successes = 0;
    this.lastFailure = undefined;
    this.lastSuccess = undefined;
    this.halfOpenCalls = 0;
    this.openSince = 0;
  }

  onStateChange(handler: (state: 'closed' | 'open' | 'half-open') => void): void {
    this.stateChangeHandlers.push(handler);
  }

  private onSuccess(): void {
    this.successes++;
    this.lastSuccess = Date.now();

    if (this.state === 'half-open') {
      this.halfOpenCalls++;
      if (this.halfOpenCalls >= this.halfOpenMaxCalls) {
        this.transitionTo('closed');
      }
    }

    if (this.state === 'closed') {
      this.failures = 0;
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();

    if (this.state === 'half-open') {
      this.transitionTo('open');
    } else if (this.state === 'closed' && this.failures >= this.failureThreshold) {
      this.transitionTo('open');
    }
  }

  private transitionTo(newState: 'closed' | 'open' | 'half-open'): void {
    this.state = newState;
    if (newState === 'open') {
      this.openSince = Date.now();
    }
    if (newState === 'closed') {
      this.failures = 0;
      this.halfOpenCalls = 0;
    }
    if (newState === 'half-open') {
      this.halfOpenCalls = 0;
    }
    for (const handler of this.stateChangeHandlers) {
      handler(newState);
    }
  }

  private checkStateTransition(): void {
    if (this.state === 'open' && this.openSince > 0) {
      if (Date.now() - this.openSince >= this.recoveryTimeout) {
        this.transitionTo('half-open');
      }
    }
  }
}
