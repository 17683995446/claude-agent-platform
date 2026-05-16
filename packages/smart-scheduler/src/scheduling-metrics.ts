// src/scheduling-metrics.ts - 调度指标系统

export type TaskEventType = 'queued' | 'started' | 'completed' | 'failed' | 'cancelled' | 'retried' | 'deadline-missed';

export interface SchedulingEvent {
  taskId: string;
  taskType?: string;
  eventType: TaskEventType;
  timestamp: number;
  queueName?: string;
  workerId?: string;
  duration?: number;
  metadata?: Record<string, unknown>;
}

export interface SchedulingDashboard {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  pendingTasks: number;
  runningTasks: number;
  avgWaitTime: number;
  avgExecutionTime: number;
  avgTurnaroundTime: number;
  throughputPerMinute: number;
  successRate: number;
  slaComplianceRate: number;
  schedulingOverheadRatio: number;
  topFailingTaskTypes: { type: string; count: number }[];
  hourlyDistribution: { hour: number; count: number }[];
}

export interface TaskEvent {
  taskId: string;
  events: SchedulingEvent[];
}

export interface EfficiencyReport {
  schedulingOverheadMs: number;
  avgWaitTimeMs: number;
  avgExecutionTimeMs: number;
  efficiencyScore: number;
  resourceUtilization: number;
  throughputPerSecond: number;
  recommendations: string[];
}

export class SchedulingMetrics {
  private events: SchedulingEvent[] = [];
  private taskEvents: Map<string, SchedulingEvent[]> = new Map();
  private maxEvents: number;

  constructor(options?: { maxEvents?: number }) {
    this.maxEvents = options?.maxEvents ?? 100000;
  }

  recordEvent(event: SchedulingEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    let taskEventList = this.taskEvents.get(event.taskId);
    if (!taskEventList) {
      taskEventList = [];
      this.taskEvents.set(event.taskId, taskEventList);
    }
    taskEventList.push(event);
  }

  getDashboard(): SchedulingDashboard {
    const now = Date.now();
    const oneHourAgo = now - 3600_000;

    const completed = this.events.filter((e) => e.eventType === 'completed');
    const failed = this.events.filter((e) => e.eventType === 'failed');
    const started = this.events.filter((e) => e.eventType === 'started');
    const queued = this.events.filter((e) => e.eventType === 'queued');

    const completedTasks = completed.length;
    const failedTasks = failed.length;
    const totalTasks = completedTasks + failedTasks;

    // Calculate average wait time (time between queued and started)
    const waitTimes: number[] = [];
    for (const [, events] of this.taskEvents) {
      const queuedEvent = events.find((e) => e.eventType === 'queued');
      const startedEvent = events.find((e) => e.eventType === 'started');
      if (queuedEvent && startedEvent) {
        waitTimes.push(startedEvent.timestamp - queuedEvent.timestamp);
      }
    }
    const avgWaitTime = waitTimes.length > 0
      ? waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length
      : 0;

    // Calculate average execution time
    const execTimes = completed.filter((e) => e.duration).map((e) => e.duration!);
    const avgExecutionTime = execTimes.length > 0
      ? execTimes.reduce((a, b) => a + b, 0) / execTimes.length
      : 0;

    const avgTurnaroundTime = avgWaitTime + avgExecutionTime;

    // Throughput (tasks per minute in last hour)
    const recentCompleted = completed.filter((e) => e.timestamp >= oneHourAgo);
    const throughputPerMinute = recentCompleted.length / 60;

    // Success rate
    const successRate = totalTasks > 0 ? completedTasks / totalTasks : 1;

    // SLA compliance (tasks completed without deadline-missed event)
    const deadlineMissed = new Set(
      this.events.filter((e) => e.eventType === 'deadline-missed').map((e) => e.taskId)
    );
    const slaComplianceRate = totalTasks > 0
      ? (completedTasks - deadlineMissed.size) / totalTasks
      : 1;

    // Scheduling overhead (time between queued and started as ratio of execution time)
    const schedulingOverheadRatio = avgExecutionTime > 0 ? avgWaitTime / avgExecutionTime : 0;

    // Top failing task types
    const failingTypes: Record<string, number> = {};
    for (const event of failed) {
      const type = event.taskType ?? 'unknown';
      failingTypes[type] = (failingTypes[type] ?? 0) + 1;
    }
    const topFailingTaskTypes = Object.entries(failingTypes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type, count]) => ({ type, count }));

    // Hourly distribution
    const hourlyDistribution: { hour: number; count: number }[] = [];
    for (let h = 0; h < 24; h++) {
      const count = completed.filter((e) => new Date(e.timestamp).getHours() === h).length;
      hourlyDistribution.push({ hour: h, count });
    }

    // Count running tasks (started but not completed/failed)
    const startedTaskIds = new Set(started.map((e) => e.taskId));
    const finishedTaskIds = new Set([...completed, ...failed].map((e) => e.taskId));
    const runningTasks = startedTaskIds.size - new Set([...startedTaskIds].filter((id) => finishedTaskIds.has(id))).size;

    // Pending tasks (queued but not started)
    const queuedTaskIds = new Set(queued.map((e) => e.taskId));
    const pendingTasks = queuedTaskIds.size - new Set([...queuedTaskIds].filter((id) => startedTaskIds.has(id))).size;

    return {
      totalTasks,
      completedTasks,
      failedTasks,
      pendingTasks: Math.max(0, pendingTasks),
      runningTasks: Math.max(0, runningTasks),
      avgWaitTime,
      avgExecutionTime,
      avgTurnaroundTime,
      throughputPerMinute,
      successRate,
      slaComplianceRate: Math.max(0, slaComplianceRate),
      schedulingOverheadRatio,
      topFailingTaskTypes,
      hourlyDistribution,
    };
  }

  getTaskHistory(taskId: string): TaskEvent[] {
    const events = this.taskEvents.get(taskId);
    if (!events) return [];
    return [{ taskId, events: [...events] }];
  }

  getEfficiencyReport(): EfficiencyReport {
    const dashboard = this.getDashboard();

    // Calculate scheduling overhead
    const overheadMs = dashboard.avgWaitTime;

    // Efficiency score (0-100): higher is better
    const waitScore = Math.max(0, 100 - (dashboard.avgWaitTime / 100)); // Deduct for long waits
    const successScore = dashboard.successRate * 100;
    const slaScore = dashboard.slaComplianceRate * 100;
    const efficiencyScore = (waitScore * 0.3 + successScore * 0.4 + slaScore * 0.3);

    const recommendations: string[] = [];
    if (dashboard.avgWaitTime > 5000) {
      recommendations.push('Average wait time is high (>5s). Consider adding more workers or optimizing scheduling.');
    }
    if (dashboard.successRate < 0.95) {
      recommendations.push('Success rate is below 95%. Investigate failure patterns.');
    }
    if (dashboard.slaComplianceRate < 0.99) {
      recommendations.push('SLA compliance is below 99%. Review deadline management.');
    }
    if (dashboard.schedulingOverheadRatio > 2) {
      recommendations.push('Scheduling overhead is high relative to execution time. Optimize scheduler.');
    }
    if (recommendations.length === 0) {
      recommendations.push('Scheduling performance is within acceptable parameters.');
    }

    return {
      schedulingOverheadMs: overheadMs,
      avgWaitTimeMs: dashboard.avgWaitTime,
      avgExecutionTimeMs: dashboard.avgExecutionTime,
      efficiencyScore: Math.min(100, Math.max(0, efficiencyScore)),
      resourceUtilization: 0, // Would need resource allocator integration
      throughputPerSecond: dashboard.throughputPerMinute / 60,
      recommendations,
    };
  }

  exportPrometheus(): string {
    const dashboard = this.getDashboard();
    const lines: string[] = [];

    lines.push('# HELP scheduler_tasks_total Total number of tasks');
    lines.push('# TYPE scheduler_tasks_total counter');
    lines.push(`scheduler_tasks_total{status="completed"} ${dashboard.completedTasks}`);
    lines.push(`scheduler_tasks_total{status="failed"} ${dashboard.failedTasks}`);
    lines.push(`scheduler_tasks_total{status="pending"} ${dashboard.pendingTasks}`);
    lines.push(`scheduler_tasks_total{status="running"} ${dashboard.runningTasks}`);

    lines.push('');
    lines.push('# HELP scheduler_avg_wait_time_ms Average task wait time in milliseconds');
    lines.push('# TYPE scheduler_avg_wait_time_ms gauge');
    lines.push(`scheduler_avg_wait_time_ms ${dashboard.avgWaitTime.toFixed(2)}`);

    lines.push('');
    lines.push('# HELP scheduler_avg_execution_time_ms Average task execution time in milliseconds');
    lines.push('# TYPE scheduler_avg_execution_time_ms gauge');
    lines.push(`scheduler_avg_execution_time_ms ${dashboard.avgExecutionTime.toFixed(2)}`);

    lines.push('');
    lines.push('# HELP scheduler_success_rate Task success rate (0-1)');
    lines.push('# TYPE scheduler_success_rate gauge');
    lines.push(`scheduler_success_rate ${dashboard.successRate.toFixed(4)}`);

    lines.push('');
    lines.push('# HELP scheduler_sla_compliance_rate SLA compliance rate (0-1)');
    lines.push('# TYPE scheduler_sla_compliance_rate gauge');
    lines.push(`scheduler_sla_compliance_rate ${dashboard.slaComplianceRate.toFixed(4)}`);

    lines.push('');
    lines.push('# HELP scheduler_throughput_per_minute Tasks completed per minute');
    lines.push('# TYPE scheduler_throughput_per_minute gauge');
    lines.push(`scheduler_throughput_per_minute ${dashboard.throughputPerMinute.toFixed(4)}`);

    return lines.join('\n');
  }

  getEventCount(): number {
    return this.events.length;
  }

  clear(): void {
    this.events = [];
    this.taskEvents.clear();
  }
}
