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
  limit: number;
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

    // Deduplication check - eagerly reserve the key to prevent concurrent sends
    // from all passing the check before any sets the cache.
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
      // Reserve the dedup key immediately to prevent race conditions
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
      let channelSuccess = true;
      let channelError: string | undefined;
      try {
        const handlers = this.subscriptions.get(ch) || [];
        for (const sub of handlers) {
          try {
            await sub.handler(notification);
          } catch (handlerErr) {
            channelSuccess = false;
            channelError = handlerErr instanceof Error ? handlerErr.message : String(handlerErr);
            // Continue to next handler
          }
        }
        results.push({
          success: channelSuccess,
          notificationId: notification.id,
          channel: ch,
          timestamp: Date.now(),
          duration: Date.now() - start,
          error: channelError,
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

    // Dedup cache was already set eagerly at the top of send().
    // If all channels failed, remove the reservation so the notification can be retried.
    if (notification.dedupeKey && !results.some(r => r.success)) {
      this.dedupeCache.delete(notification.dedupeKey);
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
    }

    // Sort by notification timestamp ascending (oldest first)
    records.sort((a, b) => a.notification.timestamp - b.notification.timestamp);

    if (filter?.limit) {
      records = records.slice(-filter.limit);
    }

    return records;
  }

  private checkRateLimit(channel: string): boolean {
    const now = Date.now();
    const entry = this.rateLimits.get(channel);

    if (!entry || now > entry.resetTime) {
      const limit = (this as any)[`rateLimit_${channel}`] ?? this.defaultRateLimit;
      this.rateLimits.set(channel, { count: 1, resetTime: now + 60000, limit });
      return true;
    }

    if (entry.count >= entry.limit) {
      return false;
    }

    entry.count++;
    return true;
  }

  setRateLimit(channel: string, limit: number): void {
    this.rateLimits.set(channel, { count: 0, resetTime: Date.now() + 60000, limit });
  }

  clearHistory(): void {
    this.history = [];
    this.dedupeCache.clear();
    this.rateLimits.clear();
  }
}
