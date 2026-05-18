// ============================================================================
// Module 5: Event System
// ============================================================================

export type EventPriority = 'critical' | 'high' | 'normal' | 'low';

export type EventDomain = 'system' | 'application' | 'user' | 'data' | 'security';

export type EventHandler = (data: unknown) => void | Promise<void>;

export interface Subscription {
  id: string;
  domain: string;
  event: string;
  handler: EventHandler;
  priority: EventPriority;
  once: boolean;
}

export interface EventRecord {
  id: string;
  domain: string;
  event: string;
  data: unknown;
  timestamp: number;
  priority: EventPriority;
  handlerCount: number;
}

export class AppEventSystem {
  private subscriptions: Map<string, Subscription> = new Map();
  private domainSubscriptions: Map<string, Subscription[]> = new Map();
  private eventHistory: EventRecord[] = [];
  private maxHistorySize: number;
  private subscriptionCounter: number = 0;
  private eventCounter: number = 0;

  constructor(maxHistorySize: number = 1000) {
    this.maxHistorySize = maxHistorySize;
  }

  emit(domain: string, event: string, data?: unknown, priority: EventPriority = 'normal'): void {
    const key = `${domain}:${event}`;
    const subs = this.domainSubscriptions.get(key) ?? [];

    const record: EventRecord = {
      id: `evt-${++this.eventCounter}`,
      domain,
      event,
      data,
      timestamp: Date.now(),
      priority,
      handlerCount: subs.length,
    };

    this.eventHistory.push(record);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    // Sort by priority
    const priorityOrder: Record<EventPriority, number> = {
      critical: 0,
      high: 1,
      normal: 2,
      low: 3,
    };
    const sortedSubs = [...subs].sort(
      (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
    );

    for (const sub of sortedSubs) {
      try {
        const result = sub.handler(data);
        if (result instanceof Promise) {
          result.catch(() => {
            // Swallow async handler errors
          });
        }
      } catch {
        // Swallow sync handler errors
      }

      if (sub.once) {
        this.off(sub.id);
      }
    }
  }

  on(domain: string, event: string, handler: EventHandler, priority: EventPriority = 'normal'): Subscription {
    const id = `sub-${++this.subscriptionCounter}`;
    const subscription: Subscription = {
      id,
      domain,
      event,
      handler,
      priority,
      once: false,
    };

    this.subscriptions.set(id, subscription);

    const key = `${domain}:${event}`;
    if (!this.domainSubscriptions.has(key)) {
      this.domainSubscriptions.set(key, []);
    }
    this.domainSubscriptions.get(key)!.push(subscription);

    return subscription;
  }

  once(domain: string, event: string, handler: EventHandler, priority: EventPriority = 'normal'): Subscription {
    const id = `sub-${++this.subscriptionCounter}`;
    const subscription: Subscription = {
      id,
      domain,
      event,
      handler,
      priority,
      once: true,
    };

    this.subscriptions.set(id, subscription);

    const key = `${domain}:${event}`;
    if (!this.domainSubscriptions.has(key)) {
      this.domainSubscriptions.set(key, []);
    }
    this.domainSubscriptions.get(key)!.push(subscription);

    return subscription;
  }

  off(subscriptionId: string): void {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) return;

    const key = `${subscription.domain}:${subscription.event}`;
    const subs = this.domainSubscriptions.get(key);
    if (subs) {
      const index = subs.findIndex((s) => s.id === subscriptionId);
      if (index >= 0) subs.splice(index, 1);
    }

    this.subscriptions.delete(subscriptionId);
  }

  removeAllListeners(domain?: string, event?: string): void {
    if (!domain) {
      this.subscriptions.clear();
      this.domainSubscriptions.clear();
      return;
    }

    if (event) {
      const key = `${domain}:${event}`;
      const subs = this.domainSubscriptions.get(key);
      if (subs) {
        for (const sub of subs) {
          this.subscriptions.delete(sub.id);
        }
      }
      this.domainSubscriptions.delete(key);
      return;
    }

    // Remove all listeners for a domain
    for (const [key, subs] of this.domainSubscriptions) {
      if (key.startsWith(`${domain}:`)) {
        for (const sub of subs) {
          this.subscriptions.delete(sub.id);
        }
      }
    }
    // Clean up domain subscriptions
    for (const [key] of this.domainSubscriptions) {
      if (key.startsWith(`${domain}:`)) {
        this.domainSubscriptions.delete(key);
      }
    }
  }

  getEventHistory(domain?: string): EventRecord[] {
    if (!domain) return [...this.eventHistory];
    return this.eventHistory.filter((r) => r.domain === domain);
  }

  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  getListenerCount(domain: string, event: string): number {
    const key = `${domain}:${event}`;
    return this.domainSubscriptions.get(key)?.length ?? 0;
  }

  clearHistory(): void {
    this.eventHistory = [];
  }
}
