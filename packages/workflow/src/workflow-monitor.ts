// workflow-monitor.ts - 工作流监控

import type { WorkflowStatus } from './workflow-engine.js';

export interface StepMetrics {
  stepId: string;
  executionCount: number;
  successCount: number;
  failureCount: number;
  avgDuration: number;
  maxDuration: number;
  minDuration: number;
  retryCount: number;
  totalDuration: number;
}

export interface WorkflowStats {
  workflowId: string;
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  avgDuration: number;
  successRate: number;
  lastExecutionAt: Date | null;
  stepMetrics: Map<string, StepMetrics>;
}

export interface AlertRule {
  id: string;
  name: string;
  condition: (stats: WorkflowStats) => boolean;
  message: string;
  enabled: boolean;
}

export interface Alert {
  ruleId: string;
  ruleName: string;
  message: string;
  timestamp: Date;
  workflowId: string;
}

export interface WorkflowDashboard {
  activeWorkflows: number;
  completedWorkflows: number;
  failedWorkflows: number;
  totalWorkflows: number;
  successRate: number;
  avgDuration: number;
  bottleneckSteps: { stepId: string; workflowId: string; avgDuration: number }[];
  alerts: Alert[];
}

export interface MonitorRecord {
  workflowId: string;
  instanceId: string;
  status: WorkflowStatus;
  stepId?: string;
  stepStatus?: WorkflowStatus;
  duration?: number;
  timestamp: Date;
}

export class WorkflowMonitor {
  private records: MonitorRecord[] = [];
  private workflowStats = new Map<string, WorkflowStats>();
  private alertRules: AlertRule[] = [];
  private alerts: Alert[] = [];
  private maxRecords: number;

  constructor(maxRecords = 10000) {
    this.maxRecords = maxRecords;
  }

  /**
   * Record a workflow event for monitoring.
   */
  record(record: MonitorRecord): void {
    this.records.push(record);
    if (this.records.length > this.maxRecords) {
      this.records.shift();
    }
    this.updateStats(record);
    this.checkAlerts(record.workflowId);
  }

  /**
   * Get the monitoring dashboard.
   */
  getDashboard(): WorkflowDashboard {
    const active = this.records.filter(r => r.status === 'running' || r.status === 'paused');
    const completed = this.records.filter(r => r.status === 'completed');
    const failed = this.records.filter(r => r.status === 'failed');
    const total = this.workflowStats.size;

    let avgDuration = 0;
    const completedWithDuration = completed.filter(r => r.duration != null);
    if (completedWithDuration.length > 0) {
      avgDuration = completedWithDuration.reduce((sum, r) => sum + (r.duration ?? 0), 0) / completedWithDuration.length;
    }

    const successRate = (completed.length + failed.length) > 0
      ? completed.length / (completed.length + failed.length)
      : 1;

    // Find bottleneck steps
    const bottleneckSteps: { stepId: string; workflowId: string; avgDuration: number }[] = [];
    for (const [wfId, stats] of this.workflowStats) {
      for (const [stepId, metrics] of stats.stepMetrics) {
        if (metrics.executionCount > 0) {
          bottleneckSteps.push({
            stepId,
            workflowId: wfId,
            avgDuration: metrics.avgDuration,
          });
        }
      }
    }
    bottleneckSteps.sort((a, b) => b.avgDuration - a.avgDuration);
    const topBottlenecks = bottleneckSteps.slice(0, 5);

    return {
      activeWorkflows: new Set(active.map(r => r.instanceId)).size,
      completedWorkflows: completed.length,
      failedWorkflows: failed.length,
      totalWorkflows: total,
      successRate,
      avgDuration,
      bottleneckSteps: topBottlenecks,
      alerts: this.getRecentAlerts(),
    };
  }

  /**
   * Get statistics for a specific workflow.
   */
  getWorkflowStats(workflowId: string): WorkflowStats {
    return this.workflowStats.get(workflowId) ?? {
      workflowId,
      totalExecutions: 0,
      successCount: 0,
      failureCount: 0,
      avgDuration: 0,
      successRate: 0,
      lastExecutionAt: null,
      stepMetrics: new Map(),
    };
  }

  /**
   * Add an alert rule.
   */
  addAlertRule(rule: AlertRule): void {
    this.alertRules.push(rule);
  }

  /**
   * Remove an alert rule.
   */
  removeAlertRule(ruleId: string): void {
    this.alertRules = this.alertRules.filter(r => r.id !== ruleId);
  }

  /**
   * Get recent alerts.
   */
  getRecentAlerts(limit = 10): Alert[] {
    return this.alerts.slice(-limit);
  }

  /**
   * Clear all alerts.
   */
  clearAlerts(): void {
    this.alerts = [];
  }

  /**
   * Clear all monitoring data.
   */
  clear(): void {
    this.records = [];
    this.workflowStats.clear();
    this.alerts = [];
  }

  private updateStats(record: MonitorRecord): void {
    let stats = this.workflowStats.get(record.workflowId);
    if (!stats) {
      stats = {
        workflowId: record.workflowId,
        totalExecutions: 0,
        successCount: 0,
        failureCount: 0,
        avgDuration: 0,
        successRate: 0,
        lastExecutionAt: null,
        stepMetrics: new Map(),
      };
      this.workflowStats.set(record.workflowId, stats);
    }

    // Update workflow-level stats
    if (record.status === 'completed' || record.status === 'failed') {
      stats.totalExecutions++;
      stats.lastExecutionAt = record.timestamp;

      if (record.status === 'completed') {
        stats.successCount++;
      } else if (record.status === 'failed') {
        stats.failureCount++;
      }

      if (record.duration != null) {
        const total = stats.avgDuration * (stats.totalExecutions - 1) + record.duration;
        stats.avgDuration = total / stats.totalExecutions;
      }

      stats.successRate = stats.totalExecutions > 0
        ? stats.successCount / stats.totalExecutions
        : 0;
    }

    // Update step-level metrics
    if (record.stepId && record.stepStatus) {
      let metrics = stats.stepMetrics.get(record.stepId);
      if (!metrics) {
        metrics = {
          stepId: record.stepId,
          executionCount: 0,
          successCount: 0,
          failureCount: 0,
          avgDuration: 0,
          maxDuration: 0,
          minDuration: Infinity,
          retryCount: 0,
          totalDuration: 0,
        };
        stats.stepMetrics.set(record.stepId, metrics);
      }

      metrics.executionCount++;
      if (record.stepStatus === 'completed') metrics.successCount++;
      if (record.stepStatus === 'failed') metrics.failureCount++;

      if (record.duration != null) {
        metrics.totalDuration += record.duration;
        metrics.avgDuration = metrics.totalDuration / metrics.executionCount;
        metrics.maxDuration = Math.max(metrics.maxDuration, record.duration);
        metrics.minDuration = Math.min(metrics.minDuration, record.duration);
      }
    }
  }

  private checkAlerts(workflowId: string): void {
    const stats = this.getWorkflowStats(workflowId);
    for (const rule of this.alertRules) {
      if (!rule.enabled) continue;
      try {
        if (rule.condition(stats)) {
          this.alerts.push({
            ruleId: rule.id,
            ruleName: rule.name,
            message: rule.message,
            timestamp: new Date(),
            workflowId,
          });
        }
      } catch {
        // Alert evaluation errors should not break monitoring
      }
    }
  }
}
