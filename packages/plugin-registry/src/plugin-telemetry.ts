// ============================================================
// Module: plugin-telemetry.ts - 插件遥测
// Execution time, API usage, error rate, health scoring, leaderboard
// ============================================================

export interface ExecutionRecord {
  timestamp: number;
  duration: number;
  success: boolean;
  error?: string;
}

export interface PluginStats {
  pluginName: string;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  avgExecutionTime: number;
  maxExecutionTime: number;
  minExecutionTime: number;
  errorRate: number;
  apiCallCount: number;
  memoryUsageMB: number;
  lastExecutionTime: number;
  uptime: number;
}

export interface PluginRanking {
  pluginName: string;
  rank: number;
  score: number;
  stats: PluginStats;
}

export interface PluginHealthEntry {
  pluginName: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  score: number;
  issues: string[];
}

export interface PluginHealthReport {
  timestamp: number;
  totalPlugins: number;
  healthyCount: number;
  degradedCount: number;
  unhealthyCount: number;
  entries: PluginHealthEntry[];
}

export interface TelemetryAlert {
  timestamp: number;
  pluginName: string;
  type: 'high_error_rate' | 'slow_execution' | 'memory_leak' | 'no_activity';
  message: string;
  severity: 'info' | 'warning' | 'critical';
}

export class PluginTelemetry {
  private executions = new Map<string, ExecutionRecord[]>();
  private apiCalls = new Map<string, number>();
  private memorySnapshots = new Map<string, number[]>();
  private startTimes = new Map<string, number>();
  private alerts: TelemetryAlert[] = [];
  private alertListeners: Array<(alert: TelemetryAlert) => void> = [];
  private maxRecordsPerPlugin = 10000;

  // Thresholds
  private errorRateThreshold = 0.3;
  private slowExecutionThresholdMs = 2000;
  private memoryLeakThresholdMB = 256;
  private inactivityThresholdMs = 300000; // 5 minutes

  setErrorRateThreshold(threshold: number): void {
    this.errorRateThreshold = threshold;
  }

  setSlowExecutionThreshold(ms: number): void {
    this.slowExecutionThresholdMs = ms;
  }

  setMemoryLeakThreshold(mb: number): void {
    this.memoryLeakThresholdMB = mb;
  }

  onAlert(listener: (alert: TelemetryAlert) => void): () => void {
    this.alertListeners.push(listener);
    return () => {
      const index = this.alertListeners.indexOf(listener);
      if (index >= 0) this.alertListeners.splice(index, 1);
    };
  }

  recordStart(pluginName: string): void {
    this.startTimes.set(pluginName, Date.now());
  }

  recordExecution(pluginName: string, duration: number, success: boolean, error?: string): void {
    if (!this.executions.has(pluginName)) {
      this.executions.set(pluginName, []);
    }

    const record: ExecutionRecord = {
      timestamp: Date.now(),
      duration,
      success,
      error,
    };

    this.executions.get(pluginName)!.push(record);

    // Trim old records to prevent unbounded growth
    const records = this.executions.get(pluginName)!;
    if (records.length > this.maxRecordsPerPlugin) {
      this.executions.set(pluginName, records.slice(-this.maxRecordsPerPlugin));
    }

    // Check for slow execution
    if (duration > this.slowExecutionThresholdMs) {
      this.createAlert(pluginName, 'slow_execution', `Execution took ${duration}ms`, 'warning');
    }

    // Check error rate
    const stats = this.getPluginStats(pluginName);
    if (stats.totalExecutions >= 5 && stats.errorRate > this.errorRateThreshold) {
      this.createAlert(pluginName, 'high_error_rate', `Error rate ${(stats.errorRate * 100).toFixed(1)}% exceeds threshold`, 'critical');
    }
  }

  recordApiCall(pluginName: string): void {
    this.apiCalls.set(pluginName, (this.apiCalls.get(pluginName) ?? 0) + 1);
  }

  recordMemory(pluginName: string, memoryMB: number): void {
    if (!this.memorySnapshots.has(pluginName)) {
      this.memorySnapshots.set(pluginName, []);
    }
    this.memorySnapshots.get(pluginName)!.push(memoryMB);

    if (memoryMB > this.memoryLeakThresholdMB) {
      this.createAlert(pluginName, 'memory_leak', `Memory usage ${memoryMB.toFixed(1)}MB exceeds threshold`, 'critical');
    }
  }

  private createAlert(pluginName: string, type: TelemetryAlert['type'], message: string, severity: TelemetryAlert['severity']): void {
    const alert: TelemetryAlert = {
      timestamp: Date.now(),
      pluginName,
      type,
      message,
      severity,
    };

    this.alerts.push(alert);

    for (const listener of this.alertListeners) {
      try {
        listener(alert);
      } catch {
        // Ignore listener errors
      }
    }
  }

  getPluginStats(pluginName: string): PluginStats {
    const records = this.executions.get(pluginName) ?? [];
    const total = records.length;
    const successful = records.filter(r => r.success).length;
    const failed = total - successful;
    const durations = records.map(r => r.duration);
    const avgTime = total > 0 ? durations.reduce((a, b) => a + b, 0) / total : 0;
    let maxTime = 0;
    for (let i = 0; i < durations.length; i++) {
      if (durations[i] > maxTime) maxTime = durations[i];
    }
    let minTime = total > 0 ? durations[0] : 0;
    for (let i = 0; i < durations.length; i++) {
      if (durations[i] < minTime) minTime = durations[i];
    }
    const errorRate = total > 0 ? failed / total : 0;
    const lastExec = total > 0 ? records[records.length - 1].timestamp : 0;
    const startTime = this.startTimes.get(pluginName) ?? lastExec;
    const snapshots = this.memorySnapshots.get(pluginName) ?? [];
    const currentMemory = snapshots.length > 0 ? snapshots[snapshots.length - 1] : 0;

    return {
      pluginName,
      totalExecutions: total,
      successfulExecutions: successful,
      failedExecutions: failed,
      avgExecutionTime: Math.round(avgTime * 100) / 100,
      maxExecutionTime: maxTime,
      minExecutionTime: minTime,
      errorRate: Math.round(errorRate * 1000) / 1000,
      apiCallCount: this.apiCalls.get(pluginName) ?? 0,
      memoryUsageMB: currentMemory,
      lastExecutionTime: lastExec,
      uptime: startTime > 0 ? Date.now() - startTime : 0,
    };
  }

  getLeaderboard(): PluginRanking[] {
    const rankings: PluginRanking[] = [];

    for (const pluginName of this.executions.keys()) {
      const stats = this.getPluginStats(pluginName);
      const score = this.calculateHealthScore(stats);
      rankings.push({ pluginName, rank: 0, score, stats });
    }

    rankings.sort((a, b) => b.score - a.score);
    rankings.forEach((r, i) => (r.rank = i + 1));

    return rankings;
  }

  private calculateHealthScore(stats: PluginStats): number {
    let score = 100;

    // Penalize high error rate
    score -= stats.errorRate * 50;

    // Penalize slow execution
    if (stats.avgExecutionTime > this.slowExecutionThresholdMs) {
      score -= 20;
    }

    // Penalize memory usage
    if (stats.memoryUsageMB > this.memoryLeakThresholdMB) {
      score -= 30;
    }

    // Reward high success rate
    if (stats.totalExecutions > 0) {
      score += (stats.successfulExecutions / stats.totalExecutions) * 10;
    }

    return Math.max(0, Math.min(100, Math.round(score * 100) / 100));
  }

  getHealthReport(): PluginHealthReport {
    const entries: PluginHealthEntry[] = [];
    let healthyCount = 0;
    let degradedCount = 0;
    let unhealthyCount = 0;

    for (const pluginName of this.executions.keys()) {
      const stats = this.getPluginStats(pluginName);
      const score = this.calculateHealthScore(stats);
      const issues: string[] = [];

      if (stats.errorRate > this.errorRateThreshold) {
        issues.push(`High error rate: ${(stats.errorRate * 100).toFixed(1)}%`);
      }
      if (stats.avgExecutionTime > this.slowExecutionThresholdMs) {
        issues.push(`Slow average execution: ${stats.avgExecutionTime}ms`);
      }
      if (stats.memoryUsageMB > this.memoryLeakThresholdMB) {
        issues.push(`High memory usage: ${stats.memoryUsageMB}MB`);
      }

      let status: PluginHealthEntry['status'] = 'healthy';
      if (score < 50) {
        status = 'unhealthy';
        unhealthyCount++;
      } else if (score < 75 || issues.length > 0) {
        status = 'degraded';
        degradedCount++;
      } else {
        healthyCount++;
      }

      entries.push({ pluginName, status, score, issues });
    }

    return {
      timestamp: Date.now(),
      totalPlugins: entries.length,
      healthyCount,
      degradedCount,
      unhealthyCount,
      entries,
    };
  }

  getAlerts(limit?: number, severity?: TelemetryAlert['severity']): TelemetryAlert[] {
    let filtered = [...this.alerts];
    if (severity) {
      filtered = filtered.filter(a => a.severity === severity);
    }
    if (limit) {
      filtered = filtered.slice(-limit);
    }
    return filtered;
  }

  resetPlugin(pluginName: string): void {
    this.executions.delete(pluginName);
    this.apiCalls.delete(pluginName);
    this.memorySnapshots.delete(pluginName);
    this.startTimes.delete(pluginName);
  }

  reset(): void {
    this.executions.clear();
    this.apiCalls.clear();
    this.memorySnapshots.clear();
    this.startTimes.clear();
    this.alerts = [];
  }
}
