// observability.ts - 可观测性集成

import type { CircuitBreaker } from './circuit-breaker.ts';
import type { Bulkhead } from './bulkhead.ts';
import type { RetryWithBackoff } from './retry-with-backoff.ts';
import type { HealthChecker } from './health-checker.ts';

export interface CircuitBreakerSnapshot {
  name: string;
  state: string;
  failureCount: number;
  successCount: number;
  lastFailureTime: number | null;
}

export interface BulkheadSnapshot {
  name: string;
  activeCount: number;
  availableSlots: number;
  queueSize: number;
}

export interface RetrySnapshot {
  name: string;
  historyLength: number;
  lastRetryAttempt: number | null;
  lastRetryDelay: number | null;
}

export interface HealthSnapshot {
  name: string;
  status: string;
  componentCount: number;
  healthyCount: number;
}

export interface Alert {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  source: string;
  message: string;
  timestamp: number;
  resolved: boolean;
}

export interface AlertRule {
  id: string;
  name: string;
  severity: 'info' | 'warning' | 'critical';
  evaluate: (dashboard: ResilienceDashboard) => boolean;
  message: string;
}

export interface ResilienceDashboard {
  timestamp: number;
  circuitBreakers: CircuitBreakerSnapshot[];
  bulkheads: BulkheadSnapshot[];
  retries: RetrySnapshot[];
  healthChecks: HealthSnapshot[];
  alerts: Alert[];
  summary: {
    totalCircuitBreakers: number;
    openCircuitBreakers: number;
    totalBulkheads: number;
    saturatedBulkheads: number;
    totalRetries: number;
    totalAlerts: number;
    criticalAlerts: number;
  };
}

export interface ObservabilityConfig {
  retentionPeriod: number; // ms
  alertRules: AlertRule[];
}

interface HistoricalDataPoint {
  timestamp: number;
  data: Record<string, unknown>;
}

export class ResilienceObservability {
  private circuitBreakers = new Map<string, CircuitBreaker>();
  private bulkheads = new Map<string, Bulkhead>();
  private retries = new Map<string, RetryWithBackoff>();
  private healthCheckers = new Map<string, HealthChecker>();
  private alerts: Alert[] = [];
  private alertRules: AlertRule[] = [];
  private historicalData: HistoricalDataPoint[] = [];
  private readonly retentionPeriod: number;
  private alertIdCounter = 0;

  constructor(config?: Partial<ObservabilityConfig>) {
    this.retentionPeriod = config?.retentionPeriod ?? 3600000; // 1 hour default
    this.alertRules = config?.alertRules ?? [];
  }

  registerCircuitBreaker(name: string, cb: CircuitBreaker): void {
    this.circuitBreakers.set(name, cb);
  }

  registerBulkhead(name: string, bulkhead: Bulkhead): void {
    this.bulkheads.set(name, bulkhead);
  }

  registerRetry(name: string, retry: RetryWithBackoff): void {
    this.retries.set(name, retry);
  }

  registerHealthChecker(name: string, checker: HealthChecker): void {
    this.healthCheckers.set(name, checker);
  }

  unregisterCircuitBreaker(name: string): void {
    this.circuitBreakers.delete(name);
  }

  unregisterBulkhead(name: string): void {
    this.bulkheads.delete(name);
  }

  unregisterRetry(name: string): void {
    this.retries.delete(name);
  }

  unregisterHealthChecker(name: string): void {
    this.healthCheckers.delete(name);
  }

  addAlertRule(rule: AlertRule): void {
    this.alertRules.push(rule);
  }

  getDashboard(): ResilienceDashboard {
    const now = Date.now();
    this.pruneHistory();

    const circuitBreakers: CircuitBreakerSnapshot[] = [];
    let openCircuitBreakers = 0;

    for (const [name, cb] of this.circuitBreakers) {
      const metrics = cb.getMetrics();
      const state = cb.getState();
      if (state === 'open') openCircuitBreakers++;
      circuitBreakers.push({
        name,
        state,
        failureCount: metrics.failureCount,
        successCount: metrics.successCount,
        lastFailureTime: metrics.lastFailureTime,
      });
    }

    const bulkheads: BulkheadSnapshot[] = [];
    let saturatedBulkheads = 0;

    for (const [name, bh] of this.bulkheads) {
      const active = bh.getActiveCount();
      const available = bh.getAvailableSlots();
      const queued = bh.getQueueSize();
      if (available === 0 && queued > 0) saturatedBulkheads++;
      bulkheads.push({
        name,
        activeCount: active,
        availableSlots: available,
        queueSize: queued,
      });
    }

    const retries: RetrySnapshot[] = [];
    let totalRetries = 0;

    for (const [name, retry] of this.retries) {
      const history = retry.getHistory();
      totalRetries += history.length;
      const lastEvent = history[history.length - 1];
      retries.push({
        name,
        historyLength: history.length,
        lastRetryAttempt: lastEvent?.timestamp ?? null,
        lastRetryDelay: lastEvent?.delay ?? null,
      });
    }

    const healthChecks: HealthSnapshot[] = [];

    for (const [name, checker] of this.healthCheckers) {
      const health = checker.getComponentHealth(name);
      healthChecks.push({
        name,
        status: health.level,
        componentCount: 1,
        healthyCount: health.level === 'healthy' ? 1 : 0,
      });
    }

    // Evaluate alert rules first (before building dashboard)
    // Create a temporary dashboard for evaluation
    const tempDashboard: ResilienceDashboard = {
      timestamp: now,
      circuitBreakers,
      bulkheads,
      retries,
      healthChecks,
      alerts: this.alerts.filter(a => !a.resolved),
      summary: {
        totalCircuitBreakers: circuitBreakers.length,
        openCircuitBreakers,
        totalBulkheads: bulkheads.length,
        saturatedBulkheads,
        totalRetries,
        totalAlerts: this.alerts.filter(a => !a.resolved).length,
        criticalAlerts: this.alerts.filter(a => a.severity === 'critical' && !a.resolved).length,
      },
    };

    this.evaluateAlertRules(tempDashboard);

    // Now build the final dashboard with updated alerts
    const dashboard: ResilienceDashboard = {
      timestamp: now,
      circuitBreakers,
      bulkheads,
      retries,
      healthChecks,
      alerts: this.alerts.filter(a => !a.resolved),
      summary: {
        totalCircuitBreakers: circuitBreakers.length,
        openCircuitBreakers,
        totalBulkheads: bulkheads.length,
        saturatedBulkheads,
        totalRetries,
        totalAlerts: this.alerts.filter(a => !a.resolved).length,
        criticalAlerts: this.alerts.filter(a => a.severity === 'critical' && !a.resolved).length,
      },
    };

    // Store historical data
    this.historicalData.push({
      timestamp: now,
      data: {
        openCircuitBreakers,
        saturatedBulkheads,
        totalRetries,
      },
    });

    return dashboard;
  }

  getAlerts(): Alert[] {
    return [...this.alerts].filter(a => !a.resolved);
  }

  getAllAlerts(): Alert[] {
    return [...this.alerts];
  }

  resolveAlert(alertId: string): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.resolved = true;
    }
  }

  getPrometheusMetrics(): string {
    const dashboard = this.getDashboard();
    const lines: string[] = [];

    lines.push('# HELP claude_circuit_breaker_state Circuit breaker state (0=closed, 1=open, 2=half-open)');
    lines.push('# TYPE claude_circuit_breaker_state gauge');
    for (const cb of dashboard.circuitBreakers) {
      const value = cb.state === 'closed' ? 0 : cb.state === 'open' ? 1 : 2;
      lines.push(`claude_circuit_breaker_state{name="${cb.name}"} ${value}`);
    }

    lines.push('# HELP claude_circuit_breaker_failures Total circuit breaker failures');
    lines.push('# TYPE claude_circuit_breaker_failures counter');
    for (const cb of dashboard.circuitBreakers) {
      lines.push(`claude_circuit_breaker_failures{name="${cb.name}"} ${cb.failureCount}`);
    }

    lines.push('# HELP claude_bulkhead_active Active executions in bulkhead');
    lines.push('# TYPE claude_bulkhead_active gauge');
    for (const bh of dashboard.bulkheads) {
      lines.push(`claude_bulkhead_active{name="${bh.name}"} ${bh.activeCount}`);
    }

    lines.push('# HELP claude_bulkhead_queue_size Queue size in bulkhead');
    lines.push('# TYPE claude_bulkhead_queue_size gauge');
    for (const bh of dashboard.bulkheads) {
      lines.push(`claude_bulkhead_queue_size{name="${bh.name}"} ${bh.queueSize}`);
    }

    lines.push('# HELP claude_retry_total Total retry attempts');
    lines.push('# TYPE claude_retry_total counter');
    for (const r of dashboard.retries) {
      lines.push(`claude_retry_total{name="${r.name}"} ${r.historyLength}`);
    }

    lines.push('# HELP claude_alerts_total Total active alerts');
    lines.push('# TYPE claude_alerts_total gauge');
    lines.push(`claude_alerts_total ${dashboard.summary.totalAlerts}`);

    lines.push('# HELP claude_critical_alerts_total Total critical alerts');
    lines.push('# TYPE claude_critical_alerts_total gauge');
    lines.push(`claude_critical_alerts_total ${dashboard.summary.criticalAlerts}`);

    return lines.join('\n') + '\n';
  }

  getHistoricalData(since?: number): HistoricalDataPoint[] {
    const cutoff = since ?? Date.now() - this.retentionPeriod;
    return this.historicalData.filter(d => d.timestamp >= cutoff);
  }

  clearHistory(): void {
    this.historicalData = [];
  }

  private evaluateAlertRules(dashboard: ResilienceDashboard): void {
    for (const rule of this.alertRules) {
      const triggered = rule.evaluate(dashboard);
      const existingAlert = this.alerts.find(
        a => a.source === rule.name && !a.resolved,
      );

      if (triggered && !existingAlert) {
        this.alertIdCounter++;
        this.alerts.push({
          id: `alert_${this.alertIdCounter}`,
          severity: rule.severity,
          source: rule.name,
          message: rule.message,
          timestamp: Date.now(),
          resolved: false,
        });
      } else if (!triggered && existingAlert) {
        existingAlert.resolved = true;
      }
    }
  }

  private pruneHistory(): void {
    const cutoff = Date.now() - this.retentionPeriod;
    this.historicalData = this.historicalData.filter(d => d.timestamp >= cutoff);
  }
}
