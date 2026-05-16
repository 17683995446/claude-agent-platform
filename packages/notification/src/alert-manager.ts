// src/alert-manager.ts - Alert Manager Module

export type AlertSeverity = 'info' | 'warning' | 'critical' | 'emergency';
export type AlertState = 'active' | 'acknowledged' | 'resolved' | 'silenced';

export interface MetricData {
  name: string;
  value: number;
  labels?: Record<string, string>;
  timestamp?: number;
}

export interface AlertRule {
  id?: string;
  name: string;
  severity: AlertSeverity;
  condition: (data: MetricData) => boolean;
  threshold?: number;
  metricName: string;
  cooldownMinutes?: number;
  enabled?: boolean;
}

export interface Alert {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: AlertSeverity;
  state: AlertState;
  message: string;
  metricData: MetricData;
  createdAt: number;
  updatedAt: number;
  acknowledgedAt?: number;
  resolvedAt?: number;
  silencedUntil?: number;
  escalationLevel: number;
}

export interface AlertEvaluation {
  triggered: boolean;
  ruleId: string;
  severity: AlertSeverity;
  message: string;
  alertId?: string;
}

export interface AlertStatistics {
  total: number;
  active: number;
  acknowledged: number;
  resolved: number;
  silenced: number;
  bySeverity: Record<AlertSeverity, number>;
  averageResolutionTime?: number;
}

interface EscalationStep {
  level: number;
  delayMinutes: number;
  action: string;
  recipient?: string;
}

export class AlertManager {
  private rules: Map<string, AlertRule> = new Map();
  private alerts: Map<string, Alert> = new Map();
  private alertCounter = 0;
  private ruleCounter = 0;
  private escalationChains: Map<string, EscalationStep[]> = new Map();
  private lastTriggered: Map<string, number> = new Map();

  createRule(rule: AlertRule): string {
    const id = rule.id || `rule_${++this.ruleCounter}`;
    this.rules.set(id, { ...rule, id, enabled: rule.enabled ?? true });
    return id;
  }

  evaluateRule(ruleId: string, data: MetricData): AlertEvaluation {
    const rule = this.rules.get(ruleId);
    if (!rule) {
      return { triggered: false, ruleId, severity: 'info', message: 'Rule not found' };
    }
    if (!rule.enabled) {
      return { triggered: false, ruleId, severity: rule.severity, message: 'Rule is disabled' };
    }

    // Cooldown check
    const lastTrigger = this.lastTriggered.get(ruleId);
    if (lastTrigger && rule.cooldownMinutes) {
      const elapsed = (Date.now() - lastTrigger) / 60000;
      if (elapsed < rule.cooldownMinutes) {
        return { triggered: false, ruleId, severity: rule.severity, message: 'Within cooldown period' };
      }
    }

    const triggered = rule.condition(data);
    if (triggered) {
      this.lastTriggered.set(ruleId, Date.now());
      const alert = this.createAlert(rule, data);
      return {
        triggered: true,
        ruleId,
        severity: rule.severity,
        message: alert.message,
        alertId: alert.id,
      };
    }

    return { triggered: false, ruleId, severity: rule.severity, message: 'Condition not met' };
  }

  acknowledgeAlert(alertId: string): void {
    const alert = this.alerts.get(alertId);
    if (alert && alert.state === 'active') {
      alert.state = 'acknowledged';
      alert.acknowledgedAt = Date.now();
      alert.updatedAt = Date.now();
    }
  }

  resolveAlert(alertId: string): void {
    const alert = this.alerts.get(alertId);
    if (alert && (alert.state === 'active' || alert.state === 'acknowledged')) {
      alert.state = 'resolved';
      alert.resolvedAt = Date.now();
      alert.updatedAt = Date.now();
    }
  }

  silenceAlert(ruleId: string, duration: number): void {
    const silencedUntil = Date.now() + duration;
    for (const [, alert] of this.alerts) {
      if (alert.ruleId === ruleId && alert.state === 'active') {
        alert.state = 'silenced';
        alert.silencedUntil = silencedUntil;
        alert.updatedAt = Date.now();
      }
    }
  }

  setEscalationChain(ruleId: string, steps: EscalationStep[]): void {
    this.escalationChains.set(ruleId, steps);
  }

  getAlert(alertId: string): Alert | undefined {
    return this.alerts.get(alertId);
  }

  getAlerts(filter?: { state?: AlertState; severity?: AlertSeverity }): Alert[] {
    let alerts = Array.from(this.alerts.values());
    if (filter?.state) {
      alerts = alerts.filter(a => a.state === filter.state);
    }
    if (filter?.severity) {
      alerts = alerts.filter(a => a.severity === filter.severity);
    }
    return alerts;
  }

  getRule(ruleId: string): AlertRule | undefined {
    return this.rules.get(ruleId);
  }

  getStatistics(): AlertStatistics {
    const alerts = Array.from(this.alerts.values());
    const stats: AlertStatistics = {
      total: alerts.length,
      active: 0,
      acknowledged: 0,
      resolved: 0,
      silenced: 0,
      bySeverity: { info: 0, warning: 0, critical: 0, emergency: 0 },
    };

    let totalResolutionTime = 0;
    let resolvedCount = 0;

    for (const alert of alerts) {
      stats[alert.state]++;
      stats.bySeverity[alert.severity]++;
      if (alert.resolvedAt && alert.createdAt) {
        totalResolutionTime += alert.resolvedAt - alert.createdAt;
        resolvedCount++;
      }
    }

    if (resolvedCount > 0) {
      stats.averageResolutionTime = totalResolutionTime / resolvedCount;
    }

    return stats;
  }

  private createAlert(rule: AlertRule, data: MetricData): Alert {
    const id = `alert_${++this.alertCounter}`;
    const alert: Alert = {
      id,
      ruleId: rule.id!,
      ruleName: rule.name,
      severity: rule.severity,
      state: 'active',
      message: `Alert: ${rule.name} - ${data.name} = ${data.value}${rule.threshold !== undefined ? ` (threshold: ${rule.threshold})` : ''}`,
      metricData: data,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      escalationLevel: 0,
    };
    this.alerts.set(id, alert);
    return alert;
  }

  clear(): void {
    this.alerts.clear();
    this.rules.clear();
    this.lastTriggered.clear();
    this.escalationChains.clear();
  }
}
