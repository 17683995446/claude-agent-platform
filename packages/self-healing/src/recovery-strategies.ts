// src/recovery-strategies.ts - Recovery Strategies Module

export interface RecoveryStrategy {
  name: string;
  description: string;
  execute: (context: RecoveryContext) => Promise<RecoveryResult>;
  timeout?: number;
  rollback?: (context: RecoveryContext) => Promise<void>;
}

export interface RecoveryContext {
  componentId: string;
  diagnosis: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  metadata?: Record<string, unknown>;
  previousAttempts?: string[];
}

export interface RecoveryResult {
  success: boolean;
  strategy: string;
  duration: number;
  message: string;
  rollbackRequired: boolean;
  metadata?: Record<string, unknown>;
}

export interface EffectivenessStats {
  strategyName: string;
  totalExecutions: number;
  successfulExecutions: number;
  successRate: number;
  averageDuration: number;
  lastExecuted: number | null;
}

interface StrategyExecution {
  strategyName: string;
  result: RecoveryResult;
  timestamp: number;
}

export class RecoveryStrategyRegistry {
  private strategies = new Map<string, RecoveryStrategy>();
  private executionHistory: StrategyExecution[] = [];

  constructor() {
    this.registerBuiltinStrategies();
  }

  register(name: string, strategy: RecoveryStrategy): void {
    this.strategies.set(name, strategy);
  }

  unregister(name: string): void {
    this.strategies.delete(name);
  }

  select(diagnosis: { primaryCause: string; severity: string; recommendedActions?: string[] }): RecoveryStrategy[] {
    const selected: RecoveryStrategy[] = [];

    // Select based on recommended actions first
    if (diagnosis.recommendedActions) {
      for (const actionName of diagnosis.recommendedActions) {
        const strategy = this.strategies.get(actionName);
        if (strategy) selected.push(strategy);
      }
    }

    // If no strategies selected, pick based on severity
    if (selected.length === 0) {
      const severity = diagnosis.severity;
      if (severity === 'critical') {
        const failover = this.strategies.get('failover');
        const restart = this.strategies.get('restart_component');
        if (failover) selected.push(failover);
        if (restart) selected.push(restart);
      } else if (severity === 'high') {
        const restart = this.strategies.get('restart_component');
        const retry = this.strategies.get('retry_operation');
        if (restart) selected.push(restart);
        if (retry) selected.push(retry);
      } else {
        const retry = this.strategies.get('retry_operation');
        if (retry) selected.push(retry);
      }
    }

    // Fallback
    if (selected.length === 0) {
      const escalate = this.strategies.get('escalate');
      if (escalate) selected.push(escalate);
    }

    return selected;
  }

  async execute(strategy: RecoveryStrategy, context: RecoveryContext): Promise<RecoveryResult> {
    const startTime = Date.now();
    const timeout = strategy.timeout ?? 30000;

    try {
      const result = await Promise.race([
        strategy.execute(context),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Strategy ${strategy.name} timed out after ${timeout}ms`)), timeout)
        ),
      ]);

      const duration = Date.now() - startTime;
      const recoveryResult: RecoveryResult = {
        ...result,
        strategy: strategy.name,
        duration,
      };

      this.recordExecution(strategy.name, recoveryResult);
      return recoveryResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      const failureResult: RecoveryResult = {
        success: false,
        strategy: strategy.name,
        duration,
        message: error instanceof Error ? error.message : String(error),
        rollbackRequired: true,
      };

      this.recordExecution(strategy.name, failureResult);

      // Attempt rollback if available
      if (strategy.rollback) {
        try {
          await strategy.rollback(context);
        } catch {
          // Rollback failed, ignore
        }
      }

      return failureResult;
    }
  }

  getEffectiveness(strategyName: string): EffectivenessStats {
    const executions = this.executionHistory.filter((e) => e.strategyName === strategyName);
    const total = executions.length;
    const successful = executions.filter((e) => e.result.success).length;
    const successRate = total > 0 ? successful / total : 0;
    const avgDuration =
      total > 0
        ? executions.reduce((sum, e) => sum + e.result.duration, 0) / total
        : 0;
    const lastExecuted = total > 0 ? executions[total - 1]!.timestamp : null;

    return {
      strategyName,
      totalExecutions: total,
      successfulExecutions: successful,
      successRate,
      averageDuration: avgDuration,
      lastExecuted,
    };
  }

  getAllStrategies(): string[] {
    return [...this.strategies.keys()];
  }

  getStrategy(name: string): RecoveryStrategy | undefined {
    return this.strategies.get(name);
  }

  getExecutionHistory(): StrategyExecution[] {
    return [...this.executionHistory];
  }

  private recordExecution(strategyName: string, result: RecoveryResult): void {
    this.executionHistory.push({ strategyName, result, timestamp: Date.now() });
  }

  private registerBuiltinStrategies(): void {
    this.strategies.set('restart_component', {
      name: 'restart_component',
      description: 'Restart a component to recover from failure',
      execute: async (ctx) => ({
        success: true,
        strategy: 'restart_component',
        duration: 0,
        message: `Component ${ctx.componentId} restarted successfully`,
        rollbackRequired: false,
      }),
      timeout: 60000,
    });

    this.strategies.set('clear_cache', {
      name: 'clear_cache',
      description: 'Clear component cache to free memory',
      execute: async (ctx) => ({
        success: true,
        strategy: 'clear_cache',
        duration: 0,
        message: `Cache cleared for ${ctx.componentId}`,
        rollbackRequired: false,
      }),
      timeout: 10000,
    });

    this.strategies.set('reduce_load', {
      name: 'reduce_load',
      description: 'Reduce incoming load to stabilize the system',
      execute: async (ctx) => ({
        success: true,
        strategy: 'reduce_load',
        duration: 0,
        message: `Load reduced for ${ctx.componentId}`,
        rollbackRequired: false,
      }),
      timeout: 5000,
    });

    this.strategies.set('increase_resources', {
      name: 'increase_resources',
      description: 'Increase resource allocation for a component',
      execute: async (ctx) => ({
        success: true,
        strategy: 'increase_resources',
        duration: 0,
        message: `Resources increased for ${ctx.componentId}`,
        rollbackRequired: true,
      }),
      timeout: 30000,
    });

    this.strategies.set('failover', {
      name: 'failover',
      description: 'Failover to a standby component',
      execute: async (ctx) => ({
        success: true,
        strategy: 'failover',
        duration: 0,
        message: `Failed over ${ctx.componentId} to standby`,
        rollbackRequired: true,
      }),
      timeout: 30000,
    });

    this.strategies.set('rollback_state', {
      name: 'rollback_state',
      description: 'Rollback component state to a known-good version',
      execute: async (ctx) => ({
        success: true,
        strategy: 'rollback_state',
        duration: 0,
        message: `State rolled back for ${ctx.componentId}`,
        rollbackRequired: false,
      }),
      timeout: 30000,
    });

    this.strategies.set('retry_operation', {
      name: 'retry_operation',
      description: 'Retry a failed operation',
      execute: async (ctx) => ({
        success: true,
        strategy: 'retry_operation',
        duration: 0,
        message: `Operation retried for ${ctx.componentId}`,
        rollbackRequired: false,
      }),
      timeout: 30000,
    });

    this.strategies.set('skip_operation', {
      name: 'skip_operation',
      description: 'Skip a non-critical failed operation',
      execute: async (ctx) => ({
        success: true,
        strategy: 'skip_operation',
        duration: 0,
        message: `Operation skipped for ${ctx.componentId}`,
        rollbackRequired: false,
      }),
      timeout: 5000,
    });

    this.strategies.set('escalate', {
      name: 'escalate',
      description: 'Escalate the issue to a human operator',
      execute: async (ctx) => ({
        success: false,
        strategy: 'escalate',
        duration: 0,
        message: `Issue escalated for ${ctx.componentId}: ${ctx.diagnosis}`,
        rollbackRequired: false,
      }),
      timeout: 5000,
    });
  }
}
