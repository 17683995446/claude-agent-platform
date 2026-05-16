// src/realtime-monitor.ts - 实时监控器

export interface MetricSnapshot {
  name: string;
  value: number;
  unit: string;
  timestamp: number;
}

export interface MetricPoint {
  value: number;
  timestamp: number;
}

export interface AlertCondition {
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  threshold: number;
  durationMs?: number;
}

export type AlertAction = (metric: string, value: number, threshold: number) => void;

export interface AlertEntry {
  id: string;
  metric: string;
  condition: AlertCondition;
  action: AlertAction;
  triggered: boolean;
  lastTriggered?: number;
  triggerCount: number;
}

export class RealtimeMonitor {
  private metrics: Map<string, MetricSnapshot> = new Map();
  private history: Map<string, MetricPoint[]> = new Map();
  private alerts: Map<string, AlertEntry> = new Map();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private maxHistoryPoints: number;
  private collectCallback?: () => Map<string, number>;

  constructor(maxHistoryPoints: number = 1000) {
    this.maxHistoryPoints = maxHistoryPoints;
  }

  setCollectCallback(cb: () => Map<string, number>): void {
    this.collectCallback = cb;
  }

  startMonitoring(intervalMs: number = 5000): void {
    if (this.intervalId !== null) return;
    this.intervalId = setInterval(() => {
      this.collect();
    }, intervalMs);
  }

  stopMonitoring(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private collect(): void {
    if (this.collectCallback) {
      const values = this.collectCallback();
      for (const [name, value] of values) {
        this.recordMetric(name, value);
      }
    }
  }

  recordMetric(name: string, value: number, unit: string = ''): void {
    const snapshot: MetricSnapshot = {
      name,
      value,
      unit,
      timestamp: Date.now(),
    };
    this.metrics.set(name, snapshot);

    let hist = this.history.get(name);
    if (!hist) {
      hist = [];
      this.history.set(name, hist);
    }
    hist.push({ value, timestamp: snapshot.timestamp });
    if (hist.length > this.maxHistoryPoints) {
      hist.shift();
    }

    this.checkAlerts(name, value);
  }

  getMetric(name: string): MetricSnapshot | undefined {
    return this.metrics.get(name);
  }

  getMetrics(): Map<string, MetricSnapshot> {
    return new Map(this.metrics);
  }

  getHistory(name: string, points?: number): MetricPoint[] {
    const hist = this.history.get(name);
    if (!hist) return [];
    if (points !== undefined) {
      return hist.slice(-points);
    }
    return [...hist];
  }

  setAlert(name: string, condition: AlertCondition, action: AlertAction): void {
    this.alerts.set(name, {
      id: name,
      metric: name,
      condition,
      action,
      triggered: false,
      triggerCount: 0,
    });
  }

  removeAlert(name: string): boolean {
    return this.alerts.delete(name);
  }

  private checkAlerts(metricName: string, value: number): void {
    const alert = this.alerts.get(metricName);
    if (!alert) return;

    const { operator, threshold } = alert.condition;
    let triggered = false;

    switch (operator) {
      case '>': triggered = value > threshold; break;
      case '<': triggered = value < threshold; break;
      case '>=': triggered = value >= threshold; break;
      case '<=': triggered = value <= threshold; break;
      case '==': triggered = value === threshold; break;
      case '!=': triggered = value !== threshold; break;
    }

    if (triggered && !alert.triggered) {
      alert.triggered = true;
      alert.lastTriggered = Date.now();
      alert.triggerCount++;
      alert.action(metricName, value, threshold);
    } else if (!triggered) {
      alert.triggered = false;
    }
  }

  getAlerts(): AlertEntry[] {
    return [...this.alerts.values()];
  }

  isMonitoring(): boolean {
    return this.intervalId !== null;
  }

  clearHistory(name?: string): void {
    if (name) {
      this.history.delete(name);
    } else {
      this.history.clear();
    }
  }

  clearMetrics(): void {
    this.metrics.clear();
  }
}
