// ============================================================
// Module 10: Scheduling Analytics
// ============================================================

export type SchedulingEventType =
  | 'task_queued'
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'task_cancelled'
  | 'task_timeout'
  | 'schedule_rebalance'
  | 'scale_event'
  | 'backpressure_event';

export interface SchedulingEvent {
  type: SchedulingEventType;
  taskId?: string;
  timestamp: number;
  duration?: number;
  priority?: number;
  metadata?: Record<string, unknown>;
}

export interface ThroughputData {
  window: string;
  tasksCompleted: number;
  tasksPerSecond: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  comparisonWithPrevious: number; // percentage change
}

export interface LatencyData {
  p50: number;
  p95: number;
  p99: number;
  average: number;
  min: number;
  max: number;
  count: number;
}

export interface UtilizationData {
  cpu: number;
  memory: number;
  concurrency: number;
  maxConcurrency: number;
  averageConcurrency: number;
  utilizationRate: number;
  timeWindow: string;
}

export interface SLAData {
  totalTasks: number;
  tasksWithinSLA: number;
  complianceRate: number;
  breachedTasks: string[];
  averageBreachAmount: number;
  targetSLA: number;
}

export interface EfficiencyReport {
  schedulingOverhead: number;    // ms
  usefulWorkTime: number;        // ms
  efficiencyRatio: number;       // 0-1
  idleTime: number;              // ms
  totalTime: number;             // ms
  recommendations: string[];
}

export interface SchedulingDashboard {
  throughput: ThroughputData;
  latency: LatencyData;
  utilization: UtilizationData;
  sla: SLAData;
  efficiency: EfficiencyReport;
  activeTasks: number;
  queuedTasks: number;
  timestamp: number;
}

export class SchedulingAnalytics {
  private events: SchedulingEvent[] = [];
  private maxEvents: number = 100000;
  private cpuReadings: Array<{ timestamp: number; value: number }> = [];
  private memoryReadings: Array<{ timestamp: number; value: number }> = [];
  private concurrencyReadings: Array<{ timestamp: number; value: number }> = [];

  recordEvent(event: SchedulingEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }

  recordCPU(timestamp: number, value: number): void {
    this.cpuReadings.push({ timestamp, value });
    if (this.cpuReadings.length > 10000) {
      this.cpuReadings = this.cpuReadings.slice(-10000);
    }
  }

  recordMemory(timestamp: number, value: number): void {
    this.memoryReadings.push({ timestamp, value });
    if (this.memoryReadings.length > 10000) {
      this.memoryReadings = this.memoryReadings.slice(-10000);
    }
  }

  recordConcurrency(timestamp: number, value: number): void {
    this.concurrencyReadings.push({ timestamp, value });
    if (this.concurrencyReadings.length > 10000) {
      this.concurrencyReadings = this.concurrencyReadings.slice(-10000);
    }
  }

  getThroughput(window: string): ThroughputData {
    const windowMs = this.parseWindow(window);
    const cutoff = Date.now() - windowMs;
    const previousCutoff = cutoff - windowMs;

    const currentCompleted = this.events.filter(
      (e) => e.type === 'task_completed' && e.timestamp >= cutoff
    ).length;

    const previousCompleted = this.events.filter(
      (e) => e.type === 'task_completed' && e.timestamp >= previousCutoff && e.timestamp < cutoff
    ).length;

    const windowSeconds = windowMs / 1000;
    const tasksPerSecond = currentCompleted / windowSeconds;

    let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    if (previousCompleted > 0) {
      const change = (currentCompleted - previousCompleted) / previousCompleted;
      if (change > 0.1) trend = 'increasing';
      else if (change < -0.1) trend = 'decreasing';
    }

    const comparisonWithPrevious = previousCompleted > 0
      ? ((currentCompleted - previousCompleted) / previousCompleted) * 100
      : 0;

    return {
      window,
      tasksCompleted: currentCompleted,
      tasksPerSecond,
      trend,
      comparisonWithPrevious,
    };
  }

  getLatencyPercentiles(): LatencyData {
    const completedEvents = this.events.filter(
      (e) => e.type === 'task_completed' && e.duration !== undefined
    );

    if (completedEvents.length === 0) {
      return { p50: 0, p95: 0, p99: 0, average: 0, min: 0, max: 0, count: 0 };
    }

    const durations = completedEvents
      .map((e) => e.duration!)
      .sort((a, b) => a - b);

    const count = durations.length;
    const sum = durations.reduce((a, b) => a + b, 0);

    return {
      p50: this.percentile(durations, 50),
      p95: this.percentile(durations, 95),
      p99: this.percentile(durations, 99),
      average: sum / count,
      min: durations[0]!,
      max: durations[count - 1]!,
      count,
    };
  }

  getResourceUtilization(): UtilizationData {
    const recentCPU = this.getRecentReadings(this.cpuReadings, 100);
    const recentMemory = this.getRecentReadings(this.memoryReadings, 100);
    const recentConcurrency = this.getRecentReadings(this.concurrencyReadings, 100);

    const avgCPU = this.average(recentCPU);
    const avgMemory = this.average(recentMemory);
    const avgConcurrency = this.average(recentConcurrency);
    const maxConcurrency = Math.max(...recentConcurrency, 1);

    return {
      cpu: avgCPU,
      memory: avgMemory,
      concurrency: avgConcurrency,
      maxConcurrency,
      averageConcurrency: avgConcurrency,
      utilizationRate: maxConcurrency > 0 ? avgConcurrency / maxConcurrency : 0,
      timeWindow: 'last_100_readings',
    };
  }

  getSLACompliance(targetSLA?: number): SLAData {
    const slaMs = targetSLA ?? 5000;
    const completedEvents = this.events.filter(
      (e) => e.type === 'task_completed' && e.duration !== undefined
    );

    const totalTasks = completedEvents.length;
    const tasksWithinSLA = completedEvents.filter(
      (e) => (e.duration ?? 0) <= slaMs
    ).length;

    const breached = completedEvents.filter(
      (e) => (e.duration ?? 0) > slaMs
    );

    const averageBreachAmount = breached.length > 0
      ? breached.reduce((sum, e) => sum + ((e.duration ?? 0) - slaMs), 0) / breached.length
      : 0;

    return {
      totalTasks,
      tasksWithinSLA,
      complianceRate: totalTasks > 0 ? tasksWithinSLA / totalTasks : 1,
      breachedTasks: breached.map((e) => e.taskId ?? 'unknown').slice(0, 10),
      averageBreachAmount,
      targetSLA: slaMs,
    };
  }

  getEfficiencyReport(): EfficiencyReport {
    const allEvents = this.events;
    const completedEvents = allEvents.filter((e) => e.type === 'task_completed');
    const scheduledEvents = allEvents.filter((e) => e.type === 'task_queued' || e.type === 'schedule_rebalance');

    const usefulWorkTime = completedEvents.reduce((sum, e) => sum + (e.duration ?? 0), 0);
    const schedulingOverhead = scheduledEvents.reduce((sum, e) => sum + (e.duration ?? 0), 0);
    const totalTime = usefulWorkTime + schedulingOverhead;

    const efficiencyRatio = totalTime > 0 ? usefulWorkTime / totalTime : 1;
    const idleTime = Math.max(0, totalTime - usefulWorkTime - schedulingOverhead);

    const recommendations: string[] = [];
    if (efficiencyRatio < 0.7) {
      recommendations.push('Scheduling overhead is high. Consider batching tasks.');
    }
    if (schedulingOverhead > usefulWorkTime * 0.3) {
      recommendations.push('Reduce rebalance frequency to lower overhead.');
    }
    if (recommendations.length === 0) {
      recommendations.push('System is operating efficiently.');
    }

    return {
      schedulingOverhead,
      usefulWorkTime,
      efficiencyRatio,
      idleTime,
      totalTime,
      recommendations,
    };
  }

  getDashboard(): SchedulingDashboard {
    return {
      throughput: this.getThroughput('5m'),
      latency: this.getLatencyPercentiles(),
      utilization: this.getResourceUtilization(),
      sla: this.getSLACompliance(),
      efficiency: this.getEfficiencyReport(),
      activeTasks: this.events.filter(
        (e) => e.type === 'task_started' && !this.isTaskCompleted(e.taskId)
      ).length,
      queuedTasks: this.events.filter(
        (e) => e.type === 'task_queued' && !this.isTaskStarted(e.taskId)
      ).length,
      timestamp: Date.now(),
    };
  }

  getEventCount(): number {
    return this.events.length;
  }

  clearEvents(): void {
    this.events = [];
    this.cpuReadings = [];
    this.memoryReadings = [];
    this.concurrencyReadings = [];
  }

  private parseWindow(window: string): number {
    const match = window.match(/^(\d+)(m|h|s)$/);
    if (!match) return 5 * 60 * 1000; // default 5 minutes

    const value = parseInt(match[1]!, 10);
    const unit = match[2]!;
    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      default: return 5 * 60 * 1000;
    }
  }

  private percentile(sortedArray: number[], p: number): number {
    if (sortedArray.length === 0) return 0;
    const index = Math.ceil((p / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, index)] ?? 0;
  }

  private getRecentReadings(
    readings: Array<{ timestamp: number; value: number }>,
    count: number
  ): number[] {
    return readings.slice(-count).map((r) => r.value);
  }

  private average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private isTaskCompleted(taskId?: string): boolean {
    if (!taskId) return false;
    // Find the most recent event for this task
    const taskEvents = this.events
      .filter(e => e.taskId === taskId)
      .sort((a, b) => b.timestamp - a.timestamp);
    
    if (taskEvents.length === 0) return false;
    
    const mostRecent = taskEvents[0];
    return mostRecent.type === 'task_completed' || mostRecent.type === 'task_failed' || mostRecent.type === 'task_cancelled';
  }

  private isTaskStarted(taskId?: string): boolean {
    if (!taskId) return false;
    // Find the most recent event for this task
    const taskEvents = this.events
      .filter(e => e.taskId === taskId)
      .sort((a, b) => b.timestamp - a.timestamp);
    
    if (taskEvents.length === 0) return false;
    
    const mostRecent = taskEvents[0];
    return mostRecent.type === 'task_started' || mostRecent.type === 'task_completed' || mostRecent.type === 'task_failed';
  }
}
