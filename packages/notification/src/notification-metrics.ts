// src/notification-metrics.ts - Notification Metrics Module

export interface DeliveryResult {
  notificationId: string;
  channel: string;
  success: boolean;
  timestamp: number;
  latencyMs: number;
  userId?: string;
  error?: string;
}

export interface NotificationMetricsReport {
  totalSent: number;
  totalDelivered: number;
  totalFailed: number;
  deliveryRate: number;
  averageLatencyMs: number;
  channelMetrics: Record<string, ChannelMetrics>;
  period: string;
}

export interface ChannelMetrics {
  channel: string;
  sent: number;
  delivered: number;
  failed: number;
  deliveryRate: number;
  averageLatencyMs: number;
  lastDelivery?: number;
}

export interface UserNotificationStats {
  userId: string;
  totalReceived: number;
  read: number;
  dismissed: number;
  actedUpon: number;
  byChannel: Record<string, number>;
  byType: Record<string, number>;
}

export interface TrendData {
  metric: string;
  period: string;
  dataPoints: Array<{ timestamp: number; value: number }>;
  trend: 'up' | 'down' | 'stable';
  changePercent: number;
}

export interface EngagementRecord {
  notificationId: string;
  userId: string;
  action: 'read' | 'dismissed' | 'acted_upon';
  timestamp: number;
}

export class NotificationMetrics {
  private deliveries: DeliveryResult[] = [];
  private engagements: EngagementRecord[] = [];
  private alertTimings: Array<{ alertId: string; created: number; resolved: number }> = [];

  recordDelivery(result: DeliveryResult): void {
    this.deliveries.push(result);
  }

  recordEngagement(record: EngagementRecord): void {
    this.engagements.push(record);
  }

  recordAlertResolution(alertId: string, createdAt: number, resolvedAt: number): void {
    this.alertTimings.push({ alertId, created: createdAt, resolved: resolvedAt });
  }

  getMetrics(): NotificationMetricsReport {
    const totalSent = this.deliveries.length;
    const totalDelivered = this.deliveries.filter(d => d.success).length;
    const totalFailed = totalSent - totalDelivered;
    const deliveryRate = totalSent > 0 ? totalDelivered / totalSent : 0;
    const averageLatencyMs = totalSent > 0
      ? this.deliveries.reduce((sum, d) => sum + d.latencyMs, 0) / totalSent
      : 0;

    const channelMetrics: Record<string, ChannelMetrics> = {};
    const channelGroups = new Map<string, DeliveryResult[]>();

    for (const d of this.deliveries) {
      const group = channelGroups.get(d.channel) || [];
      group.push(d);
      channelGroups.set(d.channel, group);
    }

    for (const [channel, group] of channelGroups) {
      const sent = group.length;
      const delivered = group.filter(d => d.success).length;
      channelMetrics[channel] = {
        channel,
        sent,
        delivered,
        failed: sent - delivered,
        deliveryRate: sent > 0 ? delivered / sent : 0,
        averageLatencyMs: sent > 0 ? group.reduce((s, d) => s + d.latencyMs, 0) / sent : 0,
        lastDelivery: group[group.length - 1]?.timestamp,
      };
    }

    return {
      totalSent,
      totalDelivered,
      totalFailed,
      deliveryRate,
      averageLatencyMs,
      channelMetrics,
      period: 'all',
    };
  }

  getChannelMetrics(channel: string): ChannelMetrics {
    const group = this.deliveries.filter(d => d.channel === channel);
    const sent = group.length;
    const delivered = group.filter(d => d.success).length;

    return {
      channel,
      sent,
      delivered,
      failed: sent - delivered,
      deliveryRate: sent > 0 ? delivered / sent : 0,
      averageLatencyMs: sent > 0 ? group.reduce((s, d) => s + d.latencyMs, 0) / sent : 0,
      lastDelivery: group.length > 0 ? group[group.length - 1].timestamp : undefined,
    };
  }

  getUserMetrics(userId: string): UserNotificationStats {
    const userDeliveries = this.deliveries.filter(d => d.userId === userId);
    const userEngagements = this.engagements.filter(e => e.userId === userId);

    const stats: UserNotificationStats = {
      userId,
      totalReceived: userDeliveries.length,
      read: userEngagements.filter(e => e.action === 'read').length,
      dismissed: userEngagements.filter(e => e.action === 'dismissed').length,
      actedUpon: userEngagements.filter(e => e.action === 'acted_upon').length,
      byChannel: {},
      byType: {},
    };

    for (const d of userDeliveries) {
      stats.byChannel[d.channel] = (stats.byChannel[d.channel] || 0) + 1;
    }

    return stats;
  }

  getTrend(metric: string, period: string): TrendData {
    let dataPoints: Array<{ timestamp: number; value: number }> = [];
    const periodMs = this.parsePeriod(period);

    switch (metric) {
      case 'delivery_rate': {
        const grouped = this.groupByPeriod(this.deliveries, periodMs);
        for (const [ts, group] of grouped) {
          const rate = group.length > 0 ? group.filter(d => d.success).length / group.length : 0;
          dataPoints.push({ timestamp: ts, value: rate });
        }
        break;
      }
      case 'latency': {
        const grouped = this.groupByPeriod(this.deliveries, periodMs);
        for (const [ts, group] of grouped) {
          const avg = group.length > 0 ? group.reduce((s, d) => s + d.latencyMs, 0) / group.length : 0;
          dataPoints.push({ timestamp: ts, value: avg });
        }
        break;
      }
      case 'volume': {
        const grouped = this.groupByPeriod(this.deliveries, periodMs);
        for (const [ts, group] of grouped) {
          dataPoints.push({ timestamp: ts, value: group.length });
        }
        break;
      }
      case 'alert_resolution_time': {
        const grouped = this.groupByPeriod(this.alertTimings, periodMs);
        for (const [ts, group] of grouped) {
          const avg = group.length > 0
            ? group.reduce((s, a) => s + (a.resolved - a.created), 0) / group.length
            : 0;
          dataPoints.push({ timestamp: ts, value: avg });
        }
        break;
      }
      default:
        break;
    }

    const trend = this.calculateTrend(dataPoints);

    return {
      metric,
      period,
      dataPoints,
      trend: trend.direction,
      changePercent: trend.changePercent,
    };
  }

  clear(): void {
    this.deliveries = [];
    this.engagements = [];
    this.alertTimings = [];
  }

  private parsePeriod(period: string): number {
    switch (period) {
      case 'hourly': return 3600000;
      case 'daily': return 86400000;
      case 'weekly': return 604800000;
      default: return 86400000;
    }
  }

  private groupByPeriod<T extends { timestamp: number }>(
    items: T[],
    periodMs: number
  ): Map<number, T[]> {
    const groups = new Map<number, T[]>();
    for (const item of items) {
      const periodStart = Math.floor(item.timestamp / periodMs) * periodMs;
      const group = groups.get(periodStart) || [];
      group.push(item);
      groups.set(periodStart, group);
    }
    return groups;
  }

  private calculateTrend(
    dataPoints: Array<{ timestamp: number; value: number }>
  ): { direction: 'up' | 'down' | 'stable'; changePercent: number } {
    if (dataPoints.length < 2) {
      return { direction: 'stable', changePercent: 0 };
    }

    const first = dataPoints[0].value;
    const last = dataPoints[dataPoints.length - 1].value;

    if (first === 0) {
      return last > 0 ? { direction: 'up', changePercent: 100 } : { direction: 'stable', changePercent: 0 };
    }

    const changePercent = ((last - first) / first) * 100;

    if (Math.abs(changePercent) < 5) {
      return { direction: 'stable', changePercent };
    }
    return {
      direction: changePercent > 0 ? 'up' : 'down',
      changePercent,
    };
  }
}
