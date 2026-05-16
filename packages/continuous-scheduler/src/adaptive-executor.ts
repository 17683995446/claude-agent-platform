// ============================================================
// Module 2: Adaptive Executor
// ============================================================

import type { ContinuousTask } from './dynamic-priority.ts';

export interface ExecutionResult {
  taskId: string;
  success: boolean;
  result?: unknown;
  error?: string;
  executionTime: number;
  resourceUsage: ResourceUsage;
}

export interface ResourceUsage {
  cpuTime: number;
  memoryPeak: number;
  ioWait: number;
}

export interface BatchExecutionResult {
  results: ExecutionResult[];
  totalExecutionTime: number;
  successCount: number;
  failureCount: number;
  batchSize: number;
}

export interface AdaptationRecord {
  timestamp: number;
  type: 'concurrency' | 'batchSize' | 'timeout';
  oldValue: number;
  newValue: number;
  reason: string;
}

export interface OptimalSettings {
  concurrency: number;
  batchSize: number;
  timeout: number;
  confidence: number;
}

export interface AdaptiveExecutorOptions {
  initialConcurrency?: number;
  minConcurrency?: number;
  maxConcurrency?: number;
  initialBatchSize?: number;
  minBatchSize?: number;
  maxBatchSize?: number;
  initialTimeout?: number;
  minTimeout?: number;
  maxTimeout?: number;
  learningRate?: number;
  historyRetention?: number;
}

const DEFAULT_EXECUTOR_OPTIONS: Required<AdaptiveExecutorOptions> = {
  initialConcurrency: 4,
  minConcurrency: 1,
  maxConcurrency: 32,
  initialBatchSize: 10,
  minBatchSize: 1,
  maxBatchSize: 100,
  initialTimeout: 30000,
  minTimeout: 1000,
  maxTimeout: 300000,
  learningRate: 0.1,
  historyRetention: 1000,
};

export class AdaptiveExecutor {
  private concurrency: number;
  private batchSize: number;
  private timeout: number;
  private options: Required<AdaptiveExecutorOptions>;
  private adaptationHistory: AdaptationRecord[] = [];
  private executionHistory: ExecutionResult[] = [];
  private activeExecutions: number = 0;

  constructor(options?: AdaptiveExecutorOptions) {
    this.options = { ...DEFAULT_EXECUTOR_OPTIONS, ...options };
    this.concurrency = this.options.initialConcurrency;
    this.batchSize = this.options.initialBatchSize;
    this.timeout = this.options.initialTimeout;
  }

  async execute(task: ContinuousTask): Promise<ExecutionResult> {
    const startTime = Date.now();
    this.activeExecutions++;

    try {
      // Simulate task execution with timeout awareness
      const result = await this.executeWithTimeout(task, this.timeout);

      const executionTime = Date.now() - startTime;
      const execResult: ExecutionResult = {
        taskId: task.id,
        success: true,
        result,
        executionTime,
        resourceUsage: {
          cpuTime: executionTime * 0.8,
          memoryPeak: 100 + Math.random() * 400,
          ioWait: executionTime * 0.2,
        },
      };

      this.recordExecution(execResult);
      return execResult;
    } catch (err) {
      const executionTime = Date.now() - startTime;
      const execResult: ExecutionResult = {
        taskId: task.id,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        executionTime,
        resourceUsage: {
          cpuTime: executionTime * 0.5,
          memoryPeak: 50,
          ioWait: executionTime * 0.1,
        },
      };

      this.recordExecution(execResult);
      return execResult;
    } finally {
      this.activeExecutions--;
    }
  }

  async executeBatch(tasks: ContinuousTask[]): Promise<BatchExecutionResult> {
    const startTime = Date.now();
    const results: ExecutionResult[] = [];

    // Execute in batches based on current batch size
    for (let i = 0; i < tasks.length; i += this.batchSize) {
      const batch = tasks.slice(i, i + this.batchSize);
      const batchResults = await Promise.all(
        batch.map((task) => this.execute(task))
      );
      results.push(...batchResults);
    }

    const totalExecutionTime = Date.now() - startTime;
    const successCount = results.filter((r) => r.success).length;

    return {
      results,
      totalExecutionTime,
      successCount,
      failureCount: results.length - successCount,
      batchSize: this.batchSize,
    };
  }

  adaptConcurrency(): void {
    const recentExecutions = this.getRecentExecutions(50);
    if (recentExecutions.length < 10) return;

    const avgTime = recentExecutions.reduce((a, r) => a + r.executionTime, 0) / recentExecutions.length;
    const failureRate = recentExecutions.filter((r) => !r.success).length / recentExecutions.length;
    const oldConcurrency = this.concurrency;

    // If avg execution time is increasing, reduce concurrency
    if (avgTime > this.timeout * 0.8) {
      this.concurrency = Math.max(this.options.minConcurrency, this.concurrency - 1);
    } else if (failureRate > 0.2) {
      this.concurrency = Math.max(this.options.minConcurrency, Math.floor(this.concurrency * 0.8));
    } else if (avgTime < this.timeout * 0.3 && failureRate < 0.05) {
      this.concurrency = Math.min(this.options.maxConcurrency, this.concurrency + 1);
    }

    if (this.concurrency !== oldConcurrency) {
      this.adaptationHistory.push({
        timestamp: Date.now(),
        type: 'concurrency',
        oldValue: oldConcurrency,
        newValue: this.concurrency,
        reason: avgTime > this.timeout * 0.8 ? 'high_latency' : failureRate > 0.2 ? 'high_failure' : 'optimal_conditions',
      });
    }
  }

  adaptBatchSize(): void {
    const recentExecutions = this.getRecentExecutions(50);
    if (recentExecutions.length < 10) return;

    const avgTime = recentExecutions.reduce((a, r) => a + r.executionTime, 0) / recentExecutions.length;
    const successRate = recentExecutions.filter((r) => r.success).length / recentExecutions.length;
    const oldBatchSize = this.batchSize;

    if (successRate > 0.95 && avgTime < this.timeout * 0.2) {
      this.batchSize = Math.min(this.options.maxBatchSize, Math.floor(this.batchSize * 1.2));
    } else if (successRate < 0.8) {
      this.batchSize = Math.max(this.options.minBatchSize, Math.floor(this.batchSize * 0.8));
    }

    if (this.batchSize !== oldBatchSize) {
      this.adaptationHistory.push({
        timestamp: Date.now(),
        type: 'batchSize',
        oldValue: oldBatchSize,
        newValue: this.batchSize,
        reason: successRate > 0.95 ? 'high_success' : 'low_success',
      });
    }
  }

  getAdaptationHistory(): AdaptationRecord[] {
    return [...this.adaptationHistory];
  }

  getOptimalSettings(): OptimalSettings {
    const recentExecutions = this.getRecentExecutions(100);
    const successRate = recentExecutions.length > 0
      ? recentExecutions.filter((r) => r.success).length / recentExecutions.length
      : 0.5;

    const confidence = Math.min(recentExecutions.length / 100, 1);

    return {
      concurrency: this.concurrency,
      batchSize: this.batchSize,
      timeout: this.timeout,
      confidence,
    };
  }

  getActiveExecutions(): number {
    return this.activeExecutions;
  }

  private async executeWithTimeout(task: ContinuousTask, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Task ${task.id} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      // Simulate execution - in real use, this would execute the task payload
      try {
        if (task.payload && typeof task.payload === 'object' && 'handler' in task.payload) {
          const handler = (task.payload as { handler: () => unknown }).handler;
          if (typeof handler === 'function') {
            resolve(handler());
          } else {
            resolve(task.payload);
          }
        } else {
          resolve({ executed: task.id, at: Date.now() });
        }
      } catch (err) {
        reject(err);
      } finally {
        clearTimeout(timer);
      }
    });
  }

  private recordExecution(result: ExecutionResult): void {
    this.executionHistory.push(result);
    if (this.executionHistory.length > this.options.historyRetention) {
      this.executionHistory = this.executionHistory.slice(-this.options.historyRetention);
    }
  }

  private getRecentExecutions(count: number): ExecutionResult[] {
    return this.executionHistory.slice(-count);
  }
}
