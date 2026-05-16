// src/adaptive-scheduler.ts - 自适应调度器

export type SchedulingStrategy = 'fifo' | 'priority' | 'deadline-first' | 'shortest-job-first' | 'weighted-fair';

export interface TaskOutcome {
  taskId: string;
  taskType: string;
  strategy: SchedulingStrategy;
  waitTime: number;
  executionTime: number;
  success: boolean;
  deadlineMet?: boolean;
  timestamp: number;
}

export interface SchedulingStrategyScore {
  strategy: SchedulingStrategy;
  score: number;
  sampleCount: number;
  avgWaitTime: number;
  avgExecutionTime: number;
  successRate: number;
}

export interface PerformanceReport {
  totalTasksTracked: number;
  strategyScores: SchedulingStrategyScore[];
  bestStrategy: SchedulingStrategy;
  taskTypeBreakdown: Record<string, { count: number; avgWaitTime: number; avgExecutionTime: number }>;
  improvementTrend: number;
}

export interface TuningResult {
  previousStrategy: SchedulingStrategy;
  newStrategy: SchedulingStrategy;
  reason: string;
  expectedImprovement: number;
}

interface StrategyStats {
  waitTimes: number[];
  executionTimes: number[];
  successes: number;
  failures: number;
  deadlineMet: number;
  deadlineMissed: number;
}

interface TaskTypeStats {
  strategies: Map<SchedulingStrategy, StrategyStats>;
}

export class AdaptiveScheduler {
  private outcomes: TaskOutcome[] = [];
  private taskTypeStats: Map<string, TaskTypeStats> = new Map();
  private currentStrategy: SchedulingStrategy = 'priority';
  private abTestGroups: Map<string, SchedulingStrategy> = new Map();
  private maxHistorySize: number;

  constructor(options?: { maxHistorySize?: number }) {
    this.maxHistorySize = options?.maxHistorySize ?? 10000;
  }

  recordOutcome(outcome: TaskOutcome): void {
    this.outcomes.push(outcome);
    if (this.outcomes.length > this.maxHistorySize) {
      this.outcomes.shift();
    }

    let typeStats = this.taskTypeStats.get(outcome.taskType);
    if (!typeStats) {
      typeStats = { strategies: new Map() };
      this.taskTypeStats.set(outcome.taskType, typeStats);
    }

    let strategyStats = typeStats.strategies.get(outcome.strategy);
    if (!strategyStats) {
      strategyStats = {
        waitTimes: [],
        executionTimes: [],
        successes: 0,
        failures: 0,
        deadlineMet: 0,
        deadlineMissed: 0,
      };
      typeStats.strategies.set(outcome.strategy, strategyStats);
    }

    strategyStats.waitTimes.push(outcome.waitTime);
    strategyStats.executionTimes.push(outcome.executionTime);
    if (outcome.success) strategyStats.successes++;
    else strategyStats.failures++;
    if (outcome.deadlineMet === true) strategyStats.deadlineMet++;
    if (outcome.deadlineMet === false) strategyStats.deadlineMissed++;

    // Trim stats
    if (strategyStats.waitTimes.length > 1000) {
      strategyStats.waitTimes.shift();
      strategyStats.executionTimes.shift();
    }
  }

  getOptimalStrategy(taskType: string): SchedulingStrategy {
    const typeStats = this.taskTypeStats.get(taskType);
    if (!typeStats || typeStats.strategies.size === 0) {
      return this.currentStrategy;
    }

    let bestStrategy = this.currentStrategy;
    let bestScore = -Infinity;

    for (const [strategy, stats] of typeStats.strategies) {
      const total = stats.successes + stats.failures;
      if (total < 3) continue; // Need minimum samples

      const successRate = stats.successes / total;
      const avgWait = stats.waitTimes.reduce((a, b) => a + b, 0) / stats.waitTimes.length;
      const avgExec = stats.executionTimes.reduce((a, b) => a + b, 0) / stats.executionTimes.length;

      // Score: higher success rate and lower wait time is better
      const score = successRate * 0.5 + (1 / (1 + avgWait / 1000)) * 0.3 + (1 / (1 + avgExec / 1000)) * 0.2;

      if (score > bestScore) {
        bestScore = score;
        bestStrategy = strategy;
      }
    }

    return bestStrategy;
  }

  tuneParameters(): TuningResult {
    const previousStrategy = this.currentStrategy;

    // Aggregate scores across all task types
    const globalScores: Map<SchedulingStrategy, { totalScore: number; count: number }> = new Map();

    for (const [, typeStats] of this.taskTypeStats) {
      for (const [strategy, stats] of typeStats.strategies) {
        const total = stats.successes + stats.failures;
        if (total < 3) continue;

        const successRate = stats.successes / total;
        const avgWait = stats.waitTimes.reduce((a, b) => a + b, 0) / stats.waitTimes.length;
        const score = successRate * 0.5 + (1 / (1 + avgWait / 1000)) * 0.5;

        const existing = globalScores.get(strategy) ?? { totalScore: 0, count: 0 };
        existing.totalScore += score;
        existing.count++;
        globalScores.set(strategy, existing);
      }
    }

    let bestStrategy = previousStrategy;
    let bestAvgScore = -Infinity;

    for (const [strategy, data] of globalScores) {
      const avgScore = data.totalScore / data.count;
      if (avgScore > bestAvgScore) {
        bestAvgScore = avgScore;
        bestStrategy = strategy;
      }
    }

    const previousScore = globalScores.get(previousStrategy);
    const previousAvg = previousScore ? previousScore.totalScore / previousScore.count : 0;
    const improvement = previousAvg > 0 ? ((bestAvgScore - previousAvg) / previousAvg) * 100 : 0;

    this.currentStrategy = bestStrategy;

    return {
      previousStrategy,
      newStrategy: bestStrategy,
      reason: bestStrategy !== previousStrategy
        ? `${bestStrategy} has higher average score (${bestAvgScore.toFixed(3)}) vs ${previousStrategy} (${previousAvg.toFixed(3)})`
        : `No better strategy found, keeping ${previousStrategy}`,
      expectedImprovement: Math.max(0, improvement),
    };
  }

  getPerformanceReport(): PerformanceReport {
    const strategyScores: SchedulingStrategyScore[] = [];
    const allStrategies: SchedulingStrategy[] = ['fifo', 'priority', 'deadline-first', 'shortest-job-first', 'weighted-fair'];

    for (const strategy of allStrategies) {
      let totalWait = 0;
      let totalExec = 0;
      let totalSuccess = 0;
      let totalSamples = 0;

      for (const [, typeStats] of this.taskTypeStats) {
        const stats = typeStats.strategies.get(strategy);
        if (!stats) continue;
        totalWait += stats.waitTimes.reduce((a, b) => a + b, 0);
        totalExec += stats.executionTimes.reduce((a, b) => a + b, 0);
        totalSuccess += stats.successes;
        totalSamples += stats.successes + stats.failures;
      }

      if (totalSamples > 0) {
        strategyScores.push({
          strategy,
          score: totalSamples > 0 ? totalSuccess / totalSamples : 0,
          sampleCount: totalSamples,
          avgWaitTime: totalSamples > 0 ? totalWait / totalSamples : 0,
          avgExecutionTime: totalSamples > 0 ? totalExec / totalSamples : 0,
          successRate: totalSamples > 0 ? totalSuccess / totalSamples : 0,
        });
      }
    }

    const bestStrategy = strategyScores.length > 0
      ? strategyScores.reduce((best, s) => s.score > best.score ? s : best, strategyScores[0]).strategy
      : this.currentStrategy;

    const taskTypeBreakdown: Record<string, { count: number; avgWaitTime: number; avgExecutionTime: number }> = {};
    for (const [type, typeStats] of this.taskTypeStats) {
      let totalWait = 0;
      let totalExec = 0;
      let totalCount = 0;
      for (const [, stats] of typeStats.strategies) {
        totalWait += stats.waitTimes.reduce((a, b) => a + b, 0);
        totalExec += stats.executionTimes.reduce((a, b) => a + b, 0);
        totalCount += stats.successes + stats.failures;
      }
      taskTypeBreakdown[type] = {
        count: totalCount,
        avgWaitTime: totalCount > 0 ? totalWait / totalCount : 0,
        avgExecutionTime: totalCount > 0 ? totalExec / totalCount : 0,
      };
    }

    // Calculate improvement trend (compare first half vs second half)
    let improvementTrend = 0;
    if (this.outcomes.length >= 10) {
      const mid = Math.floor(this.outcomes.length / 2);
      const firstHalf = this.outcomes.slice(0, mid);
      const secondHalf = this.outcomes.slice(mid);
      const firstSuccessRate = firstHalf.filter((o) => o.success).length / firstHalf.length;
      const secondSuccessRate = secondHalf.filter((o) => o.success).length / secondHalf.length;
      improvementTrend = firstSuccessRate > 0 ? ((secondSuccessRate - firstSuccessRate) / firstSuccessRate) * 100 : 0;
    }

    return {
      totalTasksTracked: this.outcomes.length,
      strategyScores,
      bestStrategy,
      taskTypeBreakdown,
      improvementTrend,
    };
  }

  getCurrentStrategy(): SchedulingStrategy {
    return this.currentStrategy;
  }

  setStrategy(strategy: SchedulingStrategy): void {
    this.currentStrategy = strategy;
  }

  startAbTest(taskType: string, strategy: SchedulingStrategy): void {
    this.abTestGroups.set(taskType, strategy);
  }

  getAbTestStrategy(taskType: string): SchedulingStrategy | undefined {
    return this.abTestGroups.get(taskType);
  }

  getOutcomeCount(): number {
    return this.outcomes.length;
  }
}
