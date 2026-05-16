// src/event-bus-enhanced.ts - Enhanced Event Bus Module

export type EventHandler = (data: unknown, event: string) => void | Promise<void>;

export interface Subscription {
  id: string;
  event: string;
  handler: EventHandler;
  once?: boolean;
}

export interface EventMiddleware {
  name: string;
  pre?: (event: string, data: unknown) => unknown;
  post?: (event: string, data: unknown, result?: unknown) => void;
}

export interface EventRecord {
  event: string;
  data: unknown;
  timestamp: number;
}

export type PersistenceBackend = 'memory' | 'file';

export interface EnhancedEventBusOptions {
  persistence?: PersistenceBackend;
  filePath?: string;
  maxHistorySize?: number;
  asyncQueue?: boolean;
}

export class EnhancedEventBus {
  private listeners: Map<string, Subscription[]> = new Map();
  private middleware: EventMiddleware[] = [];
  private history: EventRecord[] = [];
  private queue: Array<{ event: string; data: unknown }> = [];
  private processing = false;
  private subscriptionCounter = 0;
  private options: EnhancedEventBusOptions;
  private wildcardCache: Map<string, Subscription[]> = new Map();

  constructor(options: EnhancedEventBusOptions = {}) {
    this.options = {
      persistence: 'memory',
      maxHistorySize: 1000,
      asyncQueue: false,
      ...options,
    };
  }

  emit(event: string, data?: unknown): void {
    const processedData = this.applyPreMiddleware(event, data);

    if (this.options.asyncQueue) {
      this.queue.push({ event, data: processedData });
      this.processQueue();
      return;
    }

    this.dispatchEvent(event, processedData);
    this.recordEvent(event, processedData);
    this.applyPostMiddleware(event, processedData);
  }

  on(event: string, handler: EventHandler): Subscription {
    const id = `evt_${++this.subscriptionCounter}`;
    const subscription: Subscription = { id, event, handler };
    const handlers = this.listeners.get(event) || [];
    handlers.push(subscription);
    this.listeners.set(event, handlers);
    this.invalidateWildcardCache();
    return subscription;
  }

  once(event: string, handler: EventHandler): Subscription {
    const id = `evt_${++this.subscriptionCounter}`;
    const subscription: Subscription = { id, event, handler, once: true };
    const handlers = this.listeners.get(event) || [];
    handlers.push(subscription);
    this.listeners.set(event, handlers);
    this.invalidateWildcardCache();
    return subscription;
  }

  off(event: string, handlerId: string): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      const idx = handlers.findIndex(s => s.id === handlerId);
      if (idx !== -1) {
        handlers.splice(idx, 1);
        if (handlers.length === 0) {
          this.listeners.delete(event);
        }
      }
    }
    this.invalidateWildcardCache();
  }

  replay(event: string, count?: number): void {
    const matching = this.history.filter(r => r.event === event);
    const toReplay = count ? matching.slice(-count) : matching;

    for (const record of toReplay) {
      this.dispatchEvent(record.event, record.data);
    }
  }

  use(middleware: EventMiddleware): void {
    this.middleware.push(middleware);
  }

  getHistory(event?: string): EventRecord[] {
    if (event) {
      return this.history.filter(r => r.event === event);
    }
    return [...this.history];
  }

  clearHistory(): void {
    this.history = [];
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    this.invalidateWildcardCache();
  }

  private dispatchEvent(event: string, data: unknown): void {
    // Exact match listeners
    const handlers = this.listeners.get(event) || [];
    const toRemove: number[] = [];

    for (let i = 0; i < handlers.length; i++) {
      const sub = handlers[i];
      sub.handler(data, event);
      if (sub.once) {
        toRemove.push(i);
      }
    }

    // Remove once listeners
    for (let i = toRemove.length - 1; i >= 0; i--) {
      handlers.splice(toRemove[i], 1);
    }
    if (handlers.length === 0) {
      this.listeners.delete(event);
    }

    // Wildcard listeners
    const wildcardHandlers = this.getWildcardHandlers(event);
    for (const sub of wildcardHandlers) {
      sub.handler(data, event);
    }
  }

  private getWildcardHandlers(event: string): Subscription[] {
    const parts = event.split(':');
    const matched: Subscription[] = [];

    for (const [pattern, handlers] of this.listeners) {
      if (pattern.includes('*') && this.matchWildcard(pattern, parts)) {
        matched.push(...handlers);
      }
    }

    return matched;
  }

  private matchWildcard(pattern: string, eventParts: string[]): boolean {
    const patternParts = pattern.split(':');

    if (patternParts.length !== eventParts.length) {
      // Handle ** wildcard
      if (pattern.includes('**')) {
        const doubleStarIdx = patternParts.indexOf('**');
        if (doubleStarIdx === -1) return false;
        // Match prefix
        for (let i = 0; i < doubleStarIdx; i++) {
          if (patternParts[i] !== '*' && patternParts[i] !== eventParts[i]) return false;
        }
        return true;
      }
      return false;
    }

    for (let i = 0; i < patternParts.length; i++) {
      const p = patternParts[i];
      if (p !== '*' && p !== eventParts[i]) return false;
    }

    return true;
  }

  private invalidateWildcardCache(): void {
    this.wildcardCache.clear();
  }

  private applyPreMiddleware(event: string, data: unknown): unknown {
    let result = data;
    for (const mw of this.middleware) {
      if (mw.pre) {
        result = mw.pre(event, result);
      }
    }
    return result;
  }

  private applyPostMiddleware(event: string, data: unknown): void {
    for (const mw of this.middleware) {
      if (mw.post) {
        mw.post(event, data);
      }
    }
  }

  private recordEvent(event: string, data: unknown): void {
    this.history.push({ event, data, timestamp: Date.now() });
    if (this.history.length > (this.options.maxHistorySize || 1000)) {
      this.history.shift();
    }
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.dispatchEvent(item.event, item.data);
      this.recordEvent(item.event, item.data);
      this.applyPostMiddleware(item.event, item.data);
    }

    this.processing = false;
  }
}
