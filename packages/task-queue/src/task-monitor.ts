/**
 * Monitor and visualize task queue health.
 */

export interface MonitorEvent {
  type: string;
  taskId: string;
  queue: string;
  timestamp: number;
  data?: unknown;
}

export interface Alert {
  id: string;
  condition: string;
  severity: string;
  message: string;
  triggered: boolean;
  triggeredAt?: number;
}

export interface QueueHealth {
  throughput: number;
  avgLatency: number;
  errorRate: number;
  pendingCount: number;
  activeCount: number;
}

export interface Dashboard {
  queues: Record<string, QueueHealth>;
  totalTasks: number;
  successRate: number;
  avgLatency: number;
}

let alertIdCounter = 0;

export class TaskMonitor {
  private events: MonitorEvent[] = [];
  private alertRules: Alert[] = [];
  private alerts: Alert[] = [];
  private static readonly MAX_EVENTS = 10000;

  recordEvent(event: MonitorEvent): void {
    this.events.push(event);
    if (this.events.length > TaskMonitor.MAX_EVENTS) {
      this.events = this.events.slice(-TaskMonitor.MAX_EVENTS);
    }
    this.checkAlertRules(event);
  }

  getQueueHealth(queueName: string): QueueHealth {
    const now = Date.now();
    const windowMs = 60000; // 1 minute window
    const windowStart = now - windowMs;

    const queueEvents = this.events.filter(
      (e) => e.queue === queueName && e.timestamp >= windowStart
    );

    const completed = queueEvents.filter((e) => e.type === 'complete').length;
    const failed = queueEvents.filter((e) => e.type === 'fail').length;
    const total = completed + failed;

    // Calculate throughput (tasks per minute)
    const throughput = total;

    // Calculate average latency
    const enqueueEvents = queueEvents.filter((e) => e.type === 'enqueue');
    const completeEvents = queueEvents.filter((e) => e.type === 'complete');
    let avgLatency = 0;
    if (completeEvents.length > 0) {
      const latencies: number[] = [];
      for (const ce of completeEvents) {
        const matchingEnqueue = enqueueEvents.find((ee) => ee.taskId === ce.taskId);
        if (matchingEnqueue) {
          latencies.push(ce.timestamp - matchingEnqueue.timestamp);
        }
      }
      if (latencies.length > 0) {
        avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      }
    }

    // Error rate
    const errorRate = total > 0 ? failed / total : 0;

    // Current pending and active
    const pendingCount = queueEvents.filter(
      (e) => e.type === 'enqueue' && !queueEvents.some((ce) => ce.taskId === e.taskId && (ce.type === 'complete' || ce.type === 'fail'))
    ).length;
    const activeCount = queueEvents.filter(
      (e) => e.type === 'start' && !queueEvents.some((ce) => ce.taskId === e.taskId && (ce.type === 'complete' || ce.type === 'fail'))
    ).length;

    return {
      throughput,
      avgLatency,
      errorRate,
      pendingCount,
      activeCount,
    };
  }

  getDashboard(): Dashboard {
    const queueNames = new Set(this.events.map((e) => e.queue));
    const queues: Record<string, QueueHealth> = {};

    for (const name of queueNames) {
      queues[name] = this.getQueueHealth(name);
    }

    const now = Date.now();
    const windowMs = 60000;
    const windowStart = now - windowMs;
    const recentEvents = this.events.filter((e) => e.timestamp >= windowStart);
    const completed = recentEvents.filter((e) => e.type === 'complete').length;
    const failed = recentEvents.filter((e) => e.type === 'fail').length;
    const total = completed + failed;

    // Average latency across all queues
    let totalLatency = 0;
    let latencyCount = 0;
    for (const qh of Object.values(queues)) {
      if (qh.avgLatency > 0) {
        totalLatency += qh.avgLatency;
        latencyCount++;
      }
    }

    return {
      queues,
      totalTasks: recentEvents.filter((e) => e.type === 'enqueue').length,
      successRate: total > 0 ? completed / total : 1,
      avgLatency: latencyCount > 0 ? totalLatency / latencyCount : 0,
    };
  }

  getAlerts(): Alert[] {
    return this.alerts.filter((a) => a.triggered);
  }

  addAlertRule(rule: { condition: string; severity: string; message: string }): void {
    const alert: Alert = {
      id: `alert_${++alertIdCounter}`,
      condition: rule.condition,
      severity: rule.severity,
      message: rule.message,
      triggered: false,
    };
    this.alertRules.push(alert);
  }

  getHistory(timeWindow?: number): object[] {
    if (!timeWindow) return [...this.events];
    const cutoff = Date.now() - timeWindow;
    return this.events.filter((e) => e.timestamp >= cutoff);
  }

  getStats(): {
    totalEvents: number;
    eventsByType: Record<string, number>;
    eventsByQueue: Record<string, number>;
  } {
    const eventsByType: Record<string, number> = {};
    const eventsByQueue: Record<string, number> = {};

    for (const event of this.events) {
      eventsByType[event.type] = (eventsByType[event.type] ?? 0) + 1;
      eventsByQueue[event.queue] = (eventsByQueue[event.queue] ?? 0) + 1;
    }

    return {
      totalEvents: this.events.length,
      eventsByType,
      eventsByQueue,
    };
  }

  private checkAlertRules(event: MonitorEvent): void {
    for (const rule of this.alertRules) {
      // Simple condition matching
      if (rule.condition === 'error' && event.type === 'fail') {
        rule.triggered = true;
        rule.triggeredAt = event.timestamp;
        if (!this.alerts.find((a) => a.id === rule.id)) {
          this.alerts.push(rule);
        }
      }
    }
  }
}
