// src/recovery-learning.ts - Recovery Learning System Module

export interface StrategySuggestion {
  strategy: string;
  predictedSuccess: number;
  confidence: number;
  sampleSize: number;
  reason: string;
}

export interface LearnedPattern {
  issuePattern: string;
  bestStrategy: string;
  successRate: number;
  sampleSize: number;
  avgRecoveryTime: number;
}

export interface ModelStats {
  totalRecords: number;
  uniqueIssues: number;
  uniqueStrategies: number;
  overallSuccessRate: number;
  modelAccuracy: number;
  lastUpdated: number;
}

interface RecoveryRecord {
  issue: string;
  strategy: string;
  success: boolean;
  duration: number;
  timestamp: number;
}

interface IssueStrategyStats {
  total: number;
  successes: number;
  totalDuration: number;
  lastTimestamp: number;
}

export class RecoveryLearningSystem {
  private records: RecoveryRecord[] = [];
  private issueStrategyMap = new Map<string, Map<string, IssueStrategyStats>>();
  private maxRecords = 10000;

  recordOutcome(issue: string, strategy: string, success: boolean, duration: number): void {
    const record: RecoveryRecord = {
      issue,
      strategy,
      success,
      duration,
      timestamp: Date.now(),
    };

    this.records.push(record);
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }

    // Update stats map
    if (!this.issueStrategyMap.has(issue)) {
      this.issueStrategyMap.set(issue, new Map());
    }
    const strategyMap = this.issueStrategyMap.get(issue)!;
    if (!strategyMap.has(strategy)) {
      strategyMap.set(strategy, { total: 0, successes: 0, totalDuration: 0, lastTimestamp: 0 });
    }
    const stats = strategyMap.get(strategy)!;
    stats.total++;
    if (success) stats.successes++;
    stats.totalDuration += duration;
    stats.lastTimestamp = Date.now();
  }

  predictSuccess(issue: string, strategy: string): number {
    const strategyMap = this.issueStrategyMap.get(issue);
    if (!strategyMap) return 0.5; // No data, neutral prediction

    const stats = strategyMap.get(strategy);
    if (!stats) return 0.3; // Unknown strategy, low prediction

    return stats.total > 0 ? stats.successes / stats.total : 0.5;
  }

  suggestStrategy(issue: string): StrategySuggestion[] {
    const strategyMap = this.issueStrategyMap.get(issue);
    if (!strategyMap || strategyMap.size === 0) {
      return [{
        strategy: 'unknown',
        predictedSuccess: 0.5,
        confidence: 0,
        sampleSize: 0,
        reason: 'No historical data available for this issue',
      }];
    }

    const suggestions: StrategySuggestion[] = [];
    for (const [strategy, stats] of strategyMap) {
      const successRate = stats.total > 0 ? stats.successes / stats.total : 0;
      const avgDuration = stats.total > 0 ? stats.totalDuration / stats.total : 0;
      const confidence = Math.min(stats.total / 10, 1); // Confidence increases with sample size

      suggestions.push({
        strategy,
        predictedSuccess: successRate,
        confidence,
        sampleSize: stats.total,
        reason: `Success rate: ${(successRate * 100).toFixed(1)}%, Avg recovery: ${avgDuration.toFixed(0)}ms, Samples: ${stats.total}`,
      });
    }

    return suggestions.sort((a, b) => b.predictedSuccess * b.confidence - a.predictedSuccess * a.confidence);
  }

  getLearnedPatterns(): LearnedPattern[] {
    const patterns: LearnedPattern[] = [];

    for (const [issue, strategyMap] of this.issueStrategyMap) {
      let bestStrategy = '';
      let bestSuccessRate = 0;
      let bestSampleSize = 0;
      let bestAvgDuration = 0;

      for (const [strategy, stats] of strategyMap) {
        const successRate = stats.total > 0 ? stats.successes / stats.total : 0;
        const avgDuration = stats.total > 0 ? stats.totalDuration / stats.total : 0;

        if (successRate > bestSuccessRate || (successRate === bestSuccessRate && stats.total > bestSampleSize)) {
          bestStrategy = strategy;
          bestSuccessRate = successRate;
          bestSampleSize = stats.total;
          bestAvgDuration = avgDuration;
        }
      }

      if (bestStrategy) {
        patterns.push({
          issuePattern: issue,
          bestStrategy,
          successRate: bestSuccessRate,
          sampleSize: bestSampleSize,
          avgRecoveryTime: bestAvgDuration,
        });
      }
    }

    return patterns.sort((a, b) => b.sampleSize - a.sampleSize);
  }

  getModelStats(): ModelStats {
    const totalRecords = this.records.length;
    const uniqueIssues = this.issueStrategyMap.size;
    const uniqueStrategies = new Set(this.records.map((r) => r.strategy)).size;
    const successes = this.records.filter((r) => r.success).length;
    const overallSuccessRate = totalRecords > 0 ? successes / totalRecords : 0;

    // Simple model accuracy: compare predictions vs actual outcomes
    let correctPredictions = 0;
    let totalPredictions = 0;
    for (const record of this.records) {
      const prediction = this.predictSuccess(record.issue, record.strategy);
      const predictedOutcome = prediction > 0.5;
      if (predictedOutcome === record.success) {
        correctPredictions++;
      }
      totalPredictions++;
    }
    const modelAccuracy = totalPredictions > 0 ? correctPredictions / totalPredictions : 0;

    const lastUpdated = totalRecords > 0 ? this.records[totalRecords - 1]!.timestamp : 0;

    return {
      totalRecords,
      uniqueIssues,
      uniqueStrategies,
      overallSuccessRate,
      modelAccuracy,
      lastUpdated,
    };
  }

  exportData(): string {
    return JSON.stringify({
      records: this.records,
      issueStrategyMap: Object.fromEntries(
        [...this.issueStrategyMap.entries()].map(([issue, strategyMap]) => [
          issue,
          Object.fromEntries(strategyMap),
        ]),
      ),
    });
  }

  importData(json: string): void {
    try {
      const data = JSON.parse(json);
      if (data.records) {
        this.records = data.records;
      }
      if (data.issueStrategyMap) {
        this.issueStrategyMap = new Map(
          Object.entries(data.issueStrategyMap).map(([issue, strategyMap]) => [
            issue,
            new Map(Object.entries(strategyMap)),
          ]),
        );
      }
    } catch {
      throw new Error('Invalid import data format');
    }
  }

  getRecords(): RecoveryRecord[] {
    return [...this.records];
  }

  clearData(): void {
    this.records = [];
    this.issueStrategyMap.clear();
  }
}
