// src/circuit-breaker-enhanced.ts - Enhanced Circuit Breaker Module

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeout: number;
  halfOpenMaxCalls: number;
  monitoringWindow: number;
  adaptiveThresholds: boolean;
}

export interface CircuitDiagnostics {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  totalCalls: number;
  failureRate: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  lastStateChange: number | null;
  tripCount: number;
  recoveryTime: number;
  currentThreshold: number;
  perErrorStats: Record<string, { count: number; lastSeen: number }>;
}

interface CallRecord {
  success: boolean;
  timestamp: number;
  errorType?: string;
  duration: number;
}

export class EnhancedCircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private totalCalls = 0;
  private callHistory: CallRecord[] = [];
  private halfOpenCalls = 0;
  private halfOpenSuccesses = 0;
  private tripCount = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private lastStateChange: number | null = null;
  private openSince: number | null = null;
  private lastOpenSince: number | null = null; // Preserved for recovery time calculation
  private config: CircuitBreakerConfig;
  private perErrorStats: Record<string, { count: number; lastSeen: number }> = {};
  private stateChangeCallbacks: ((state: CircuitState) => void)[] = [];

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = {
      failureThreshold: 5,
      recoveryTimeout: 30000,
      halfOpenMaxCalls: 3,
      monitoringWindow: 60000,
      adaptiveThresholds: true,
      ...config,
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.checkStateTransition();

    if (this.state === 'open') {
      throw new Error('Circuit breaker is open');
    }

    if (this.state === 'half-open' && this.halfOpenCalls >= this.config.halfOpenMaxCalls) {
      throw new Error('Circuit breaker is half-open and probe limit reached');
    }

    this.totalCalls++;
    if (this.state === 'half-open') {
      this.halfOpenCalls++;
    }

    const startTime = Date.now();
    try {
      const result = await fn();
      this.recordSuccess(Date.now() - startTime);
      return result;
    } catch (error) {
      const errorType = error instanceof Error ? error.constructor.name : 'UnknownError';
      this.recordFailure(errorType, Date.now() - startTime);
      throw error;
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  /** Check and transition state if needed (called internally before execute) */
  private checkStateTransition(): void {
    if (this.state === 'open' && this.openSince) {
      if (Date.now() - this.openSince >= this.config.recoveryTimeout) {
        this.transitionTo('half-open');
      }
    }
  }

  getDiagnostics(): CircuitDiagnostics {
    const windowStart = Date.now() - this.config.monitoringWindow;
    const recentCalls = this.callHistory.filter((c) => c.timestamp >= windowStart);
    const recentFailures = recentCalls.filter((c) => !c.success).length;
    const failureRate = recentCalls.length > 0 ? recentFailures / recentCalls.length : 0;

    const recoveryTime = (this.openSince || this.lastOpenSince) && this.lastStateChange && this.state !== 'open'
      ? this.lastStateChange - (this.openSince ?? this.lastOpenSince!)
      : 0;

    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      totalCalls: this.totalCalls,
      failureRate,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      lastStateChange: this.lastStateChange,
      tripCount: this.tripCount,
      recoveryTime,
      currentThreshold: this.config.failureThreshold,
      perErrorStats: { ...this.perErrorStats },
    };
  }

  adaptThresholds(): void {
    if (!this.config.adaptiveThresholds) return;

    const windowStart = Date.now() - this.config.monitoringWindow;
    const recentCalls = this.callHistory.filter((c) => c.timestamp >= windowStart);
    const recentFailures = recentCalls.filter((c) => !c.success).length;
    const failureRate = recentCalls.length > 0 ? recentFailures / recentCalls.length : 0;

    // If failure rate is consistently low, increase threshold (more tolerant)
    if (failureRate < 0.05 && recentCalls.length > 20) {
      this.config.failureThreshold = Math.min(
        this.config.failureThreshold + 1,
        20,
      );
    }
    // If failure rate is high, decrease threshold (less tolerant)
    else if (failureRate > 0.3 && recentCalls.length > 10) {
      this.config.failureThreshold = Math.max(
        this.config.failureThreshold - 1,
        2,
      );
    }
  }

  forceState(state: CircuitState): void {
    this.transitionTo(state);
  }

  onStateChange(callback: (state: CircuitState) => void): void {
    this.stateChangeCallbacks.push(callback);
  }

  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.totalCalls = 0;
    this.halfOpenCalls = 0;
    this.halfOpenSuccesses = 0;
    this.tripCount = 0;
    this.lastFailureTime = null;
    this.lastSuccessTime = null;
    this.lastStateChange = null;
    this.openSince = null;
    this.lastOpenSince = null;
    this.callHistory = [];
    this.perErrorStats = {};
  }

  private recordSuccess(duration: number): void {
    this.successCount++;
    this.lastSuccessTime = Date.now();
    this.callHistory.push({ success: true, timestamp: Date.now(), duration });

    if (this.state === 'half-open') {
      this.halfOpenSuccesses++;
      // If enough successful calls in half-open, close the circuit
      if (this.halfOpenSuccesses >= this.config.halfOpenMaxCalls) {
        this.transitionTo('closed');
      }
    }

    // Clean old history
    this.cleanHistory();
  }

  private recordFailure(errorType: string, duration: number): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.callHistory.push({ success: false, timestamp: Date.now(), errorType, duration });

    // Track per-error stats
    if (!this.perErrorStats[errorType]) {
      this.perErrorStats[errorType] = { count: 0, lastSeen: 0 };
    }
    this.perErrorStats[errorType]!.count++;
    this.perErrorStats[errorType]!.lastSeen = Date.now();

    if (this.state === 'half-open') {
      this.transitionTo('open');
    } else if (this.state === 'closed') {
      const windowStart = Date.now() - this.config.monitoringWindow;
      const recentFailures = this.callHistory.filter(
        (c) => !c.success && c.timestamp >= windowStart,
      ).length;
      if (recentFailures >= this.config.failureThreshold) {
        this.transitionTo('open');
      }
    }

    this.cleanHistory();
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state === newState) return;

    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();

    if (newState === 'open') {
      this.openSince = Date.now();
      this.tripCount++;
      this.halfOpenCalls = 0;
      this.halfOpenSuccesses = 0;
    } else if (newState === 'half-open') {
      this.halfOpenCalls = 0;
      this.halfOpenSuccesses = 0;
    } else if (newState === 'closed') {
      this.failureCount = 0;
      this.halfOpenCalls = 0;
      this.halfOpenSuccesses = 0;
      this.lastOpenSince = this.openSince;
      this.openSince = null;
    }

    for (const cb of this.stateChangeCallbacks) {
      try {
        cb(newState);
      } catch {
        // Ignore callback errors
      }
    }
  }

  private cleanHistory(): void {
    const cutoff = Date.now() - this.config.monitoringWindow * 2;
    this.callHistory = this.callHistory.filter((c) => c.timestamp >= cutoff);
  }
}
