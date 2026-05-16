// src/runtime-config.ts - Runtime Configuration Manager

export interface RuntimeConfig {
  loop: LoopConfig;
  state: StateConfig;
  checkpoint: CheckpointConfig;
  queue: QueueConfig;
  heartbeat: HeartbeatConfig;
  resource: ResourceConfig;
  idle: IdleConfig;
  restart: RestartConfig;
}

export interface LoopConfig {
  mode: 'continuous' | 'interval' | 'adaptive' | 'cron';
  intervalMs: number;
  cronExpression?: string;
  stallThresholdMs: number;
  maxIterations?: number;
}

export interface StateConfig {
  timeoutPerStateMs: Record<string, number>;
  enablePersistence: boolean;
  persistencePath?: string;
}

export interface CheckpointConfig {
  enabled: boolean;
  type: 'full' | 'incremental' | 'differential';
  triggers: {
    timeIntervalSec: number;
    iterationInterval: number;
    sizeThreshold: number;
    eventBased: boolean;
  };
  storage: 'memory' | 'file';
  storagePath?: string;
  compression: boolean;
  retention: {
    maxCount: number;
    maxAgeHours: number;
    keepTagged: boolean;
  };
}

export interface QueueConfig {
  maxRetries: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  deadLetterQueueEnabled: boolean;
  maxQueueSize: number;
  defaultPriority: number;
}

export interface HeartbeatConfig {
  intervalMs: number;
  timeoutMs: number;
  tolerance: number;
  escalationLevels: number;
}

export interface ResourceConfig {
  monitorIntervalMs: number;
  memory: {
    warningPercent: number;
    criticalPercent: number;
  };
  eventLoopLag: {
    warningMs: number;
    criticalMs: number;
  };
  actions: ('log' | 'gc' | 'reject' | 'scaleDown' | 'emergencyStop')[];
}

export interface IdleConfig {
  enabled: boolean;
  idleTimeoutMs: number;
  actions: ('sleep' | 'maintenance' | 'prewarm' | 'optimize')[];
}

export interface RestartConfig {
  drainTimeoutMs: number;
  maxRestartRate: number;
  restartRateWindowMs: number;
  enableRollback: boolean;
  preRestartHooks: string[];
  postRestartHooks: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ConfigChangeRecord {
  timestamp: number;
  path: string;
  oldValue: unknown;
  newValue: unknown;
}

export class RuntimeConfigManager {
  private config: RuntimeConfig;
  private changeHistory: ConfigChangeRecord[] = [];

  constructor(initialConfig?: Partial<RuntimeConfig>) {
    this.config = { ...this.getDefaults(), ...initialConfig } as RuntimeConfig;
  }

  getConfig(): RuntimeConfig {
    return { ...this.config };
  }

  updateConfig(partial: Partial<RuntimeConfig>): void {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...partial } as RuntimeConfig;
    this.recordChanges(oldConfig, this.config);
  }

  validate(config: RuntimeConfig): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (config.loop.intervalMs < 0) {
      errors.push('loop.intervalMs must be non-negative');
    }
    if (config.loop.mode === 'cron' && !config.loop.cronExpression) {
      errors.push('loop.cronExpression is required for cron mode');
    }
    if (config.checkpoint.retention.maxCount < 1) {
      errors.push('checkpoint.retention.maxCount must be at least 1');
    }
    if (config.queue.maxRetries < 0) {
      errors.push('queue.maxRetries must be non-negative');
    }
    if (config.heartbeat.intervalMs <= 0) {
      errors.push('heartbeat.intervalMs must be positive');
    }
    if (config.heartbeat.timeoutMs <= config.heartbeat.intervalMs) {
      warnings.push('heartbeat.timeoutMs should be greater than intervalMs');
    }
    if (config.resource.memory.warningPercent < 0 || config.resource.memory.warningPercent > 100) {
      errors.push('resource.memory.warningPercent must be between 0 and 100');
    }
    if (config.idle.idleTimeoutMs < 0) {
      errors.push('idle.idleTimeoutMs must be non-negative');
    }
    if (config.restart.drainTimeoutMs < 0) {
      errors.push('restart.drainTimeoutMs must be non-negative');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  getDefaults(): RuntimeConfig {
    return {
      loop: {
        mode: 'interval',
        intervalMs: 1000,
        stallThresholdMs: 30000,
      },
      state: {
        timeoutPerStateMs: {
          starting: 30000,
          stopping: 30000,
          pausing: 10000,
          resuming: 10000,
          restarting: 60000,
        },
        enablePersistence: false,
      },
      checkpoint: {
        enabled: true,
        type: 'full',
        triggers: {
          timeIntervalSec: 300,
          iterationInterval: 100,
          sizeThreshold: 1024 * 1024,
          eventBased: true,
        },
        storage: 'memory',
        compression: false,
        retention: {
          maxCount: 10,
          maxAgeHours: 24,
          keepTagged: true,
        },
      },
      queue: {
        maxRetries: 3,
        retryBaseDelayMs: 1000,
        retryMaxDelayMs: 60000,
        deadLetterQueueEnabled: true,
        maxQueueSize: 10000,
        defaultPriority: 5,
      },
      heartbeat: {
        intervalMs: 5000,
        timeoutMs: 15000,
        tolerance: 3,
        escalationLevels: 4,
      },
      resource: {
        monitorIntervalMs: 10000,
        memory: {
          warningPercent: 80,
          criticalPercent: 95,
        },
        eventLoopLag: {
          warningMs: 100,
          criticalMs: 500,
        },
        actions: ['log', 'gc', 'reject'],
      },
      idle: {
        enabled: true,
        idleTimeoutMs: 60000,
        actions: ['maintenance', 'prewarm'],
      },
      restart: {
        drainTimeoutMs: 30000,
        maxRestartRate: 5,
        restartRateWindowMs: 300000,
        enableRollback: true,
        preRestartHooks: [],
        postRestartHooks: [],
      },
    };
  }

  exportConfig(format: 'json' | 'env'): string {
    if (format === 'json') {
      return JSON.stringify(this.config, null, 2);
    }
    const lines: string[] = [];
    const flatten = (obj: Record<string, unknown>, prefix = ''): void => {
      for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}_${key.toUpperCase()}` : key.toUpperCase();
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          flatten(value as Record<string, unknown>, fullKey);
        } else {
          lines.push(`${fullKey}=${JSON.stringify(value)}`);
        }
      }
    };
    flatten(this.config as unknown as Record<string, unknown>);
    return lines.join('\n');
  }

  getChangeHistory(): ConfigChangeRecord[] {
    return [...this.changeHistory];
  }

  rollback(count: number): void {
    const toRemove = Math.min(count, this.changeHistory.length);
    if (toRemove === 0) return;

    const removed = this.changeHistory.splice(-toRemove);
    // Rebuild config from defaults + remaining changes
    let current = this.getDefaults();
    for (const change of this.changeHistory) {
      this.applyChange(current, change.path, change.newValue);
    }
    this.config = current;
  }

  private recordChanges(oldConfig: RuntimeConfig, newConfig: RuntimeConfig): void {
    this.diffConfigs(oldConfig, newConfig, '', this.changeHistory);
  }

  private diffConfigs(old: unknown, current: unknown, path: string, records: ConfigChangeRecord[]): void {
    if (typeof old !== 'object' || old === null || typeof current !== 'object' || current === null) {
      if (old !== current) {
        records.push({ timestamp: Date.now(), path, oldValue: old, newValue: current });
      }
      return;
    }
    const allKeys = new Set([...Object.keys(old as Record<string, unknown>), ...Object.keys(current as Record<string, unknown>)]);
    for (const key of allKeys) {
      const subPath = path ? `${path}.${key}` : key;
      const oldVal = (old as Record<string, unknown>)[key];
      const curVal = (current as Record<string, unknown>)[key];
      if (JSON.stringify(oldVal) !== JSON.stringify(curVal)) {
        if (typeof oldVal === 'object' && oldVal !== null && typeof curVal === 'object' && curVal !== null) {
          this.diffConfigs(oldVal, curVal, subPath, records);
        } else {
          records.push({ timestamp: Date.now(), path: subPath, oldValue: oldVal, newValue: curVal });
        }
      }
    }
  }

  private applyChange(config: RuntimeConfig, path: string, value: unknown): void {
    const keys = path.split('.');
    let target: Record<string, unknown> = config as unknown as Record<string, unknown>;
    for (let i = 0; i < keys.length - 1; i++) {
      target = target[keys[i]!] as Record<string, unknown>;
    }
    target[keys[keys.length - 1]!] = value;
  }
}
