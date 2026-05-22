// event-stream.ts - Core event stream with backpressure support

export interface Subscription {
  id: string;
  handler: (event: unknown) => void | Promise<void>;
  active: boolean;
  unsubscribe: () => void;
}

let subscriptionCounter = 0;

export class EventStream<T> {
  private events: Array<{ event: T; timestamp: number }> = [];
  private subscriptions: Map<string, Subscription> = new Map();
  private maxSize: number;
  private retentionMs: number;

  constructor(options?: { maxSize?: number; retentionMs?: number }) {
    this.maxSize = options?.maxSize ?? Infinity;
    this.retentionMs = options?.retentionMs ?? Infinity;
  }

  publish(event: T): void {
    this.events.push({ event, timestamp: Date.now() });
    this.evict();
    for (const sub of this.subscriptions.values()) {
      if (sub.active) {
        try {
          void sub.handler(event);
        } catch {
          // Subscriber errors should not break the publish loop
        }
      }
    }
  }

  subscribe(handler: (event: T) => void | Promise<void>): Subscription {
    const id = `sub-${++subscriptionCounter}`;
    const stream = this;
    const subscription: Subscription = {
      id,
      handler: handler as (event: unknown) => void | Promise<void>,
      active: true,
      unsubscribe() {
        stream.unsubscribe(id);
      },
    };
    this.subscriptions.set(id, subscription);
    return subscription;
  }

  unsubscribe(subId: string): void {
    const sub = this.subscriptions.get(subId);
    if (sub) {
      sub.active = false;
      this.subscriptions.delete(subId);
    }
  }

  getEvents(count?: number): T[] {
    this.evict();
    const items = this.events.map((e) => e.event);
    if (count !== undefined && count > 0) {
      return items.slice(-count);
    }
    if (count === 0) return [];
    return items;
  }

  getEventCount(): number {
    this.evict();
    return this.events.length;
  }

  clear(): void {
    this.events = [];
  }

  pipe<U>(stream: EventStream<U>, transform: (event: T) => U | U[]): EventStream<U> {
    this.subscribe((event) => {
      const result = transform(event);
      if (Array.isArray(result)) {
        for (const item of result) {
          stream.publish(item);
        }
      } else {
        stream.publish(result);
      }
    });
    return stream;
  }

  filter(predicate: (event: T) => boolean): EventStream<T> {
    const filtered = new EventStream<T>();
    this.subscribe((event) => {
      if (predicate(event)) {
        filtered.publish(event);
      }
    });
    return filtered;
  }

  map<U>(fn: (event: T) => U): EventStream<U> {
    const mapped = new EventStream<U>();
    this.subscribe((event) => {
      mapped.publish(fn(event));
    });
    return mapped;
  }

  buffer(count: number, timeoutMs?: number): EventStream<T[]> {
    const buffered = new EventStream<T[]>();
    let current: T[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;

    const flush = () => {
      if (current.length > 0) {
        buffered.publish([...current]);
        current = [];
      }
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    this.subscribe((event) => {
      current.push(event);
      if (current.length >= count) {
        flush();
      } else if (timeoutMs !== undefined && timer === undefined) {
        timer = setTimeout(flush, timeoutMs);
      }
    });

    return buffered;
  }

  async reduce<U>(fn: (acc: U, event: T) => U, initial: U): Promise<U> {
    let acc = initial;
    for (const item of this.events) {
      acc = fn(acc, item.event);
    }
    return acc;
  }

  private evict(): void {
    const now = Date.now();
    // Remove expired events
    if (this.retentionMs !== Infinity) {
      while (this.events.length > 0 && now - this.events[0]!.timestamp > this.retentionMs) {
        this.events.shift();
      }
    }
    // Remove oldest if over maxSize
    while (this.events.length > this.maxSize) {
      this.events.shift();
    }
  }
}
