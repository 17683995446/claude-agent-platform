// src/notification-center.ts - Notification Center Module

export type NotificationType = 'info' | 'success' | 'warning' | 'error' | 'progress';
export type NotificationPriority = 'low' | 'normal' | 'high' | 'critical';
export type NotificationChannel = 'console' | 'file' | 'webhook' | 'email' | 'in-app';

export interface Notification {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  message: string;
  channel: NotificationChannel | NotificationChannel[];
  recipient?: string;
  data?: Record<string, unknown>;
  timestamp: number;
  dedupeKey?: string;
}

export interface SendResult {
  success: boolean;
  notificationId: string;
  channel: string;
  timestamp: number;
  error?: string;
  duration?: number;
}

export interface NotificationHandler {
  (notification: Notification): Promise<void> | void;
}

export interface Subscription {
  id: string;
  channel: string;
  handler: NotificationHandler;
}

export interface NotificationFilter {
  type?: NotificationType;
  priority?: NotificationPriority;
  channel?: string;
  startTime?: number;
  endTime?: number;
  recipient?: string;
  limit?: number;
}

export interface NotificationRecord {
  notification: Notification;
  results: SendResult[];
  timestamp: number;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

export class NotificationCenter {
  private subscriptions: Map<string, Subscription[]> = new Map();
  private history: NotificationRecord[] = [];
  private dedupeCache: Map<string, number> = new Map();
  private rateLimits: Map<string, RateLimitEntry> = new Map();
  private subscriptionCounter = 0;
  private readonly defaultRateLimit = 100;
  private readonly dedupeWindowMs = 60000;

  async send(notification: Notification): Promise<SendResult[]> {
    const results: SendResult[] = [];

    // Deduplication check
    if (notification.dedupeKey) {
      const lastSent = this.dedupeCache.get(notification.dedupeKey);
      if (lastSent && Date.now() - lastSent < this.dedupeWindowMs) {
        return [{
          success: false,
          notificationId: notification.id,
          channel: 'dedupe',
          timestamp: Date.now(),
          error: 'Duplicate notification suppressed',
        }];
      }
      this.dedupeCache.set(notification.dedupeKey, Date.now());
    }

    const channels = Array.isArray(notification.channel)
      ? notification.channel
      : [notification.channel];

    for (const ch of channels) {
      // Rate limit check
      if (!this.checkRateLimit(ch)) {
        results.push({
          success: false,
          notificationId: notification.id,
          channel: ch,
          timestamp: Date.now(),
          error: 'Rate limit exceeded',
        });
        continue;
      }

      const start = Date.now();
      try {
        const handlers = this.subscriptions.get(ch) || [];
        for (const sub of handlers) {
          await sub.handler(notification);
        }
        results.push({
          success: true,
          notificationId: notification.id,
          channel: ch,
          timestamp: Date.now(),
          duration: Date.now() - start,
        });
      } catch (err) {
        results.push({
          success: false,
          notificationId: notification.id,
          channel: ch,
          timestamp: Date.now(),
          error: err instanceof Error ? err.message : String(err),
          duration: Date.now() - start,
        });
      }
    }

    this.history.push({
      notification,
      results,
      timestamp: Date.now(),
    });

    return results;
  }

  subscribe(channel: string, handler: NotificationHandler): Subscription {
    const id = `sub_${++this.subscriptionCounter}`;
    const subscription: Subscription = { id, channel, handler };
    const handlers = this.subscriptions.get(channel) || [];
    handlers.push(subscription);
    this.subscriptions.set(channel, handlers);
    return subscription;
  }

  unsubscribe(subscriptionId: string): void {
    for (const [channel, handlers] of this.subscriptions) {
      const idx = handlers.findIndex(s => s.id === subscriptionId);
      if (idx !== -1) {
        handlers.splice(idx, 1);
        if (handlers.length === 0) {
          this.subscriptions.delete(channel);
        }
        return;
      }
    }
  }

  getHistory(filter?: NotificationFilter): NotificationRecord[] {
    let records = [...this.history];

    if (filter) {
      if (filter.type) {
        records = records.filter(r => r.notification.type === filter.type);
      }
      if (filter.priority) {
        records = records.filter(r => r.notification.priority === filter.priority);
      }
      if (filter.channel) {
        records = records.filter(r =>
          r.results.some(res => res.channel === filter.channel)
        );
      }
      if (filter.startTime) {
        records = records.filter(r => r.timestamp >= filter.startTime!);
      }
      if (filter.endTime) {
        records = records.filter(r => r.timestamp <= filter.endTime!);
      }
      if (filter.recipient) {
        records = records.filter(r => r.notification.recipient === filter.recipient);
      }
      if (filter.limit) {
        records = records.slice(-filter.limit);
      }
    }

    return records;
  }

  private checkRateLimit(channel: string): boolean {
    const now = Date.now();
    const entry = this.rateLimits.get(channel);

    if (!entry || now > entry.resetTime) {
      this.rateLimits.set(channel, { count: 1, resetTime: now + 60000 });
      return true;
    }

    if (entry.count >= this.defaultRateLimit) {
      return false;
    }

    entry.count++;
    return true;
  }

  setRateLimit(channel: string, limit: number): void {
    this.rateLimits.set(channel, { count: 0, resetTime: Date.now() + 60000 });
    (this as any)[`rateLimit_${channel}`] = limit;
  }

  clearHistory(): void {
    this.history = [];
    this.dedupeCache.clear();
    this.rateLimits.clear();
  }
}
