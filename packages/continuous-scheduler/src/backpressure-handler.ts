// ============================================================
// Module 5: Backpressure Handler
// ============================================================

export type BackpressureLevel = 'none' | 'mild' | 'moderate' | 'severe' | 'critical';

export type BackpressureStrategy = 'reject' | 'buffer' | 'throttle' | 'shed';

export interface BackpressureResult {
  level: BackpressureLevel;
  action: BackpressureStrategy;
  accepted: boolean;
  queueSize: number;
  pressure: number;
  message: string;
}

export interface BackpressureConfig {
  mildThreshold: number;      // Queue depth for mild
  moderateThreshold: number;  // Queue depth for moderate
  severeThreshold: number;    // Queue depth for severe
  criticalThreshold: number;  // Queue depth for critical
  strategy: BackpressureStrategy;
  bufferSize: number;         // Max buffer size
  throttleRate: number;       // Requests per second when throttling
  recoveryThreshold: number;  // Queue depth to recover to lower level
}

const DEFAULT_CONFIG: BackpressureConfig = {
  mildThreshold: 50,
  moderateThreshold: 100,
  severeThreshold: 200,
  criticalThreshold: 500,
  strategy: 'shed',
  bufferSize: 1000,
  throttleRate: 10,
  recoveryThreshold: 30,
};

export class BackpressureHandler {
  private config: BackpressureConfig;
  private currentLevel: BackpressureLevel = 'none';
  private queueDepth: number = 0;
  private buffer: unknown[] = [];
  private rejectedCount: number = 0;
  private throttledCount: number = 0;
  private shedCount: number = 0;
  private lastThrottleTime: number = 0;
  private levelHistory: Array<{ timestamp: number; level: BackpressureLevel }> = [];

  constructor(config?: Partial<BackpressureConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  applyBackpressure(level: BackpressureLevel): BackpressureResult {
    this.currentLevel = level;
    this.levelHistory.push({ timestamp: Date.now(), level });

    const action = this.determineAction(level);
    const pressure = this.getQueuePressure();

    return {
      level,
      action,
      accepted: action !== 'reject',
      queueSize: this.queueDepth,
      pressure,
      message: this.getLevelMessage(level, action),
    };
  }

  getCurrentLevel(): BackpressureLevel {
    return this.currentLevel;
  }

  shouldAccept(priority: number): boolean {
    // Use the explicitly set level, not auto-updated level
    switch (this.currentLevel) {
      case 'none':
      case 'mild':
        return true;
      case 'moderate':
        if (this.config.strategy === 'reject') return priority > 50;
        if (this.config.strategy === 'shed') return priority > 30;
        if (this.config.strategy === 'throttle') return this.canThrottle();
        return true; // buffer
      case 'severe':
        if (this.config.strategy === 'reject') return priority > 70;
        if (this.config.strategy === 'shed') return priority > 50;
        if (this.config.strategy === 'throttle') return priority > 60 && this.canThrottle();
        return priority > 40; // buffer
      case 'critical':
        if (this.config.strategy === 'reject') return false;
        if (this.config.strategy === 'shed') return priority > 80;
        if (this.config.strategy === 'throttle') return priority > 90 && this.canThrottle();
        return priority > 70; // buffer
      default:
        return true;
    }
  }

  getQueuePressure(): number {
    if (this.queueDepth >= this.config.criticalThreshold) return 1.0;
    if (this.queueDepth >= this.config.severeThreshold) {
      const range = this.config.criticalThreshold - this.config.severeThreshold;
      return 0.75 + 0.25 * ((this.queueDepth - this.config.severeThreshold) / range);
    }
    if (this.queueDepth >= this.config.moderateThreshold) {
      const range = this.config.severeThreshold - this.config.moderateThreshold;
      return 0.5 + 0.25 * ((this.queueDepth - this.config.moderateThreshold) / range);
    }
    if (this.queueDepth >= this.config.mildThreshold) {
      const range = this.config.moderateThreshold - this.config.mildThreshold;
      return 0.25 + 0.25 * ((this.queueDepth - this.config.mildThreshold) / range);
    }
    return this.queueDepth / this.config.mildThreshold * 0.25;
  }

  configureThresholds(
    mild: number,
    moderate: number,
    severe: number,
    critical: number
  ): void {
    this.config.mildThreshold = mild;
    this.config.moderateThreshold = moderate;
    this.config.severeThreshold = severe;
    this.config.criticalThreshold = critical;
  }

  setStrategy(strategy: BackpressureStrategy): void {
    this.config.strategy = strategy;
  }

  setQueueDepth(depth: number): void {
    this.queueDepth = depth;
    // Directly set level based on queue depth
    if (depth >= this.config.criticalThreshold) {
      this.currentLevel = 'critical';
    } else if (depth >= this.config.severeThreshold) {
      this.currentLevel = 'severe';
    } else if (depth >= this.config.moderateThreshold) {
      this.currentLevel = 'moderate';
    } else if (depth >= this.config.mildThreshold) {
      this.currentLevel = 'mild';
    } else {
      this.currentLevel = 'none';
    }
    this.levelHistory.push({ timestamp: Date.now(), level: this.currentLevel });
  }

  getStats(): {
    rejectedCount: number;
    throttledCount: number;
    shedCount: number;
    bufferSize: number;
    currentLevel: BackpressureLevel;
  } {
    return {
      rejectedCount: this.rejectedCount,
      throttledCount: this.throttledCount,
      shedCount: this.shedCount,
      bufferSize: this.buffer.length,
      currentLevel: this.currentLevel,
    };
  }

  getLevelHistory(): Array<{ timestamp: number; level: BackpressureLevel }> {
    return [...this.levelHistory];
  }

  addToBuffer(item: unknown): boolean {
    if (this.buffer.length >= this.config.bufferSize) return false;
    this.buffer.push(item);
    return true;
  }

  drainBuffer(count?: number): unknown[] {
    const drainCount = count ?? this.buffer.length;
    return this.buffer.splice(0, drainCount);
  }

  private updateLevel(): void {
    let newLevel: BackpressureLevel = 'none';

    if (this.queueDepth >= this.config.criticalThreshold) {
      newLevel = 'critical';
    } else if (this.queueDepth >= this.config.severeThreshold) {
      newLevel = 'severe';
    } else if (this.queueDepth >= this.config.moderateThreshold) {
      newLevel = 'moderate';
    } else if (this.queueDepth >= this.config.mildThreshold) {
      newLevel = 'mild';
    }

    if (newLevel !== this.currentLevel) {
      // Only recover if below recovery threshold
      if (newLevel === 'none' || this.queueDepth < this.config.recoveryThreshold) {
        this.currentLevel = newLevel;
        this.levelHistory.push({ timestamp: Date.now(), level: newLevel });
      }
    }
  }

  private determineAction(level: BackpressureLevel): BackpressureStrategy {
    switch (level) {
      case 'none': return 'buffer';
      case 'mild': return 'buffer';
      case 'moderate': return this.config.strategy;
      case 'severe': return this.config.strategy === 'buffer' ? 'throttle' : this.config.strategy;
      case 'critical': return this.config.strategy === 'buffer' ? 'reject' : this.config.strategy;
      default: return 'buffer';
    }
  }

  private canThrottle(): boolean {
    const now = Date.now();
    const minInterval = 1000 / this.config.throttleRate;
    if (now - this.lastThrottleTime >= minInterval) {
      this.lastThrottleTime = now;
      this.throttledCount++;
      return true;
    }
    return false;
  }

  private getLevelMessage(level: BackpressureLevel, action: BackpressureStrategy): string {
    const messages: Record<BackpressureLevel, string> = {
      none: 'System operating normally',
      mild: 'Mild pressure detected, buffering excess requests',
      moderate: `Moderate pressure, applying ${action} strategy`,
      severe: `Severe pressure, applying ${action} strategy`,
      critical: `Critical pressure! Applying ${action} strategy`,
    };
    return messages[level];
  }
}
