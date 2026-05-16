// src/config-hotswap.ts - 配置热交换

export interface RuntimeConfig {
  logLevel: string;
  maxWorkers: number;
  memoryLimit: number;
  enableCache: boolean;
  cacheTTL: number;
  apiTimeout: number;
  retryAttempts: number;
  enableMetrics: boolean;
  metricsInterval: number;
  enableTracing: boolean;
}

export const DEFAULT_CONFIG: RuntimeConfig = {
  logLevel: 'info',
  maxWorkers: 4,
  memoryLimit: 512,
  enableCache: true,
  cacheTTL: 300,
  apiTimeout: 30000,
  retryAttempts: 3,
  enableMetrics: true,
  metricsInterval: 5000,
  enableTracing: false,
};

export interface HotSwapResult {
  success: boolean;
  applied: string[];
  rejected: string[];
  previousConfig: Partial<RuntimeConfig>;
  timestamp: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export type ConfigChangeCallback = (changes: Partial<RuntimeConfig>, previous: RuntimeConfig) => void;
export type UnsubscribeFn = () => void;

export interface ConfigChangeRecord {
  id: string;
  changes: Partial<RuntimeConfig>;
  previousValues: Partial<RuntimeConfig>;
  timestamp: number;
  success: boolean;
}

export class ConfigHotSwap {
  private config: RuntimeConfig;
  private subscribers: Map<number, ConfigChangeCallback> = new Map();
  private subscriberId: number = 0;
  private changeHistory: ConfigChangeRecord[] = [];
  private validators: ((config: Partial<RuntimeConfig>) => ValidationResult)[] = [];
  private idCounter: number = 0;

  constructor(initial?: Partial<RuntimeConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...initial };
  }

  getConfig(): RuntimeConfig {
    return { ...this.config };
  }

  validateChanges(changes: Partial<RuntimeConfig>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (changes.maxWorkers !== undefined && (changes.maxWorkers < 1 || changes.maxWorkers > 64)) {
      errors.push('maxWorkers must be between 1 and 64');
    }
    if (changes.memoryLimit !== undefined && changes.memoryLimit < 64) {
      errors.push('memoryLimit must be at least 64MB');
    }
    if (changes.cacheTTL !== undefined && changes.cacheTTL < 0) {
      errors.push('cacheTTL cannot be negative');
    }
    if (changes.apiTimeout !== undefined && changes.apiTimeout < 100) {
      warnings.push('apiTimeout is very low, may cause timeouts');
    }
    if (changes.retryAttempts !== undefined && changes.retryAttempts > 10) {
      warnings.push('retryAttempts is high, may cause long delays');
    }
    if (changes.metricsInterval !== undefined && changes.metricsInterval < 1000) {
      warnings.push('metricsInterval is very low, may impact performance');
    }

    // Run custom validators
    for (const validator of this.validators) {
      const result = validator(changes);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  updateConfig(changes: Partial<RuntimeConfig>): HotSwapResult {
    const validation = this.validateChanges(changes);
    const applied: string[] = [];
    const rejected: string[] = [];
    const previousConfig: Partial<RuntimeConfig> = {};

    for (const [key, value] of Object.entries(changes)) {
      if (validation.errors.some(e => e.includes(key))) {
        rejected.push(key);
        continue;
      }
      previousConfig[key as keyof RuntimeConfig] = this.config[key as keyof RuntimeConfig];
      applied.push(key);
    }

    if (validation.valid) {
      // Apply all changes atomically
      const previous = { ...this.config };
      Object.assign(this.config, changes);

      // Record change
      this.changeHistory.push({
        id: `change-${++this.idCounter}`,
        changes,
        previousValues: previousConfig,
        timestamp: Date.now(),
        success: true,
      });

      // Notify subscribers
      for (const callback of this.subscribers.values()) {
        try {
          callback(changes, previous);
        } catch {
          // Ignore subscriber errors
        }
      }

      return {
        success: true,
        applied,
        rejected,
        previousConfig,
        timestamp: Date.now(),
      };
    }

    // Apply only valid changes
    const validChanges: Partial<RuntimeConfig> = {};
    for (const key of applied) {
      validChanges[key as keyof RuntimeConfig] = changes[key as keyof RuntimeConfig];
    }

    if (Object.keys(validChanges).length > 0) {
      const previous = { ...this.config };
      Object.assign(this.config, validChanges);

      this.changeHistory.push({
        id: `change-${++this.idCounter}`,
        changes: validChanges,
        previousValues: previousConfig,
        timestamp: Date.now(),
        success: true,
      });

      for (const callback of this.subscribers.values()) {
        try {
          callback(validChanges, previous);
        } catch {
          // Ignore
        }
      }
    }

    return {
      success: false,
      applied,
      rejected,
      previousConfig,
      timestamp: Date.now(),
    };
  }

  subscribe(callback: ConfigChangeCallback): UnsubscribeFn {
    const id = ++this.subscriberId;
    this.subscribers.set(id, callback);
    return () => {
      this.subscribers.delete(id);
    };
  }

  getChangeHistory(): ConfigChangeRecord[] {
    return [...this.changeHistory];
  }

  rollback(changeId: string): boolean {
    const idx = this.changeHistory.findIndex(c => c.id === changeId);
    if (idx === -1) return false;

    const record = this.changeHistory[idx];
    if (!record.success) return false;

    const previous = { ...this.config };
    Object.assign(this.config, record.previousValues);

    this.changeHistory.push({
      id: `rollback-${++this.idCounter}`,
      changes: record.previousValues,
      previousValues: record.changes,
      timestamp: Date.now(),
      success: true,
    });

    for (const callback of this.subscribers.values()) {
      try {
        callback(record.previousValues, previous);
      } catch {
        // Ignore
      }
    }

    return true;
  }

  addValidator(validator: (config: Partial<RuntimeConfig>) => ValidationResult): void {
    this.validators.push(validator);
  }

  getSubscriberCount(): number {
    return this.subscribers.size;
  }

  reset(): void {
    this.config = { ...DEFAULT_CONFIG };
    this.changeHistory = [];
  }
}
