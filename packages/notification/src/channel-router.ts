// src/channel-router.ts - Channel Router Module

import type { Notification, NotificationChannel, NotificationPriority, NotificationType } from './notification-center.ts';

export interface RoutingRule {
  id?: string;
  name: string;
  condition: (notification: Notification) => boolean;
  channels: NotificationChannel[];
  priority?: number;
  enabled?: boolean;
}

export interface ChannelHealth {
  channel: string;
  available: boolean;
  lastCheck: number;
  failureCount: number;
  latencyMs?: number;
}

export interface RoutingResult {
  channels: NotificationChannel[];
  primary: NotificationChannel;
  fallbacks: NotificationChannel[];
}

export class ChannelRouter {
  private rules: RoutingRule[] = [];
  private failovers: Map<string, NotificationChannel> = new Map();
  private channelHealth: Map<string, ChannelHealth> = new Map();
  private channelInstances: Map<string, { channel: NotificationChannel; weight: number }[]> = new Map();
  private ruleCounter = 0;
  private roundRobinCounters: Map<string, number> = new Map();

  addRoute(rule: RoutingRule): void {
    const id = rule.id || `route_${++this.ruleCounter}`;
    this.rules.push({ ...rule, id, enabled: rule.enabled ?? true });
    // Sort by priority (higher priority first)
    this.rules.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  route(notification: Notification): NotificationChannel[] {
    const channels = new Set<NotificationChannel>();

    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      if (rule.condition(notification)) {
        for (const ch of rule.channels) {
          if (this.checkChannelAvailability(ch)) {
            channels.add(ch);
          } else {
            // Try failover
            const fallback = this.failovers.get(ch);
            if (fallback && this.checkChannelAvailability(fallback)) {
              channels.add(fallback);
            }
          }
        }
        break; // First matching rule wins
      }
    }

    // Default routing if no rules matched
    if (channels.size === 0) {
      const defaultChannel = this.getDefaultChannel(notification);
      if (this.checkChannelAvailability(defaultChannel)) {
        channels.add(defaultChannel);
      }
    }

    return Array.from(channels);
  }

  checkChannelAvailability(channel: string): boolean {
    const health = this.channelHealth.get(channel);
    if (!health) return true; // Assume available if no health data
    return health.available && health.failureCount < 5;
  }

  setFailover(channel: string, fallback: string): void {
    this.failovers.set(channel, fallback as NotificationChannel);
  }

  updateChannelHealth(channel: string, available: boolean, latencyMs?: number): void {
    const existing = this.channelHealth.get(channel);
    if (existing) {
      existing.available = available;
      existing.lastCheck = Date.now();
      existing.latencyMs = latencyMs;
      if (!available) {
        existing.failureCount++;
      } else {
        existing.failureCount = 0;
      }
    } else {
      this.channelHealth.set(channel, {
        channel,
        available,
        lastCheck: Date.now(),
        failureCount: available ? 0 : 1,
        latencyMs,
      });
    }
  }

  addChannelInstance(channel: NotificationChannel, weight: number = 1): void {
    const instances = this.channelInstances.get(channel) || [];
    instances.push({ channel, weight });
    this.channelInstances.set(channel, instances);
  }

  getLoadBalancedChannel(channel: NotificationChannel): NotificationChannel {
    const instances = this.channelInstances.get(channel);
    if (!instances || instances.length <= 1) return channel;

    const counter = (this.roundRobinCounters.get(channel) || 0) % instances.length;
    this.roundRobinCounters.set(channel, counter + 1);

    return instances[counter].channel;
  }

  getChannelHealth(channel: string): ChannelHealth | undefined {
    return this.channelHealth.get(channel);
  }

  getAllChannelHealth(): ChannelHealth[] {
    return Array.from(this.channelHealth.values());
  }

  getRules(): RoutingRule[] {
    return [...this.rules];
  }

  removeRule(ruleId: string): void {
    this.rules = this.rules.filter(r => r.id !== ruleId);
  }

  clear(): void {
    this.rules = [];
    this.failovers.clear();
    this.channelHealth.clear();
    this.channelInstances.clear();
    this.roundRobinCounters.clear();
  }

  private getDefaultChannel(notification: Notification): NotificationChannel {
    switch (notification.type) {
      case 'error':
      case 'warning':
        return 'console';
      case 'success':
        return 'in-app';
      case 'progress':
        return 'in-app';
      default:
        return 'console';
    }
  }
}
