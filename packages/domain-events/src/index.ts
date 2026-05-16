// ============================================================================
// @claude-agent/domain-events - Domain Events System
// ============================================================================

import type { LoggerInterface } from '@claude-agent/types';
import { Logger } from '@claude-agent/logger';

// ---- Domain Event Envelope ----
export interface DomainEventEnvelope<T = unknown> {
  readonly eventId: string;
  readonly eventType: string;
  readonly version: number;
  readonly timestamp: Date;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly payload: T;
  readonly metadata: Record<string, unknown>;
}

// ---- Event Handler ----
export type DomainEventHandler<T = unknown> = (event: DomainEventEnvelope<T>) => void | Promise<void>;

// ---- Event Aggregator ----
export class EventAggregator {
  private buffer: DomainEventEnvelope[] = [];
  private maxSize: number;
  private flushCallback?: (events: DomainEventEnvelope[]) => Promise<void>;

  constructor(options?: { maxSize?: number; onFlush?: (events: DomainEventEnvelope[]) => Promise<void> }) {
    this.maxSize = options?.maxSize ?? 100;
    this.flushCallback = options?.onFlush;
  }

  add(event: DomainEventEnvelope): void {
    this.buffer.push(event);
    if (this.buffer.length >= this.maxSize) {
      this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const events = [...this.buffer];
    this.buffer = [];
    if (this.flushCallback) {
      await this.flushCallback(events);
    }
  }

  get size(): number {
    return this.buffer.length;
  }

  get events(): DomainEventEnvelope[] {
    return [...this.buffer];
  }
}

// ---- Event Version Manager ----
export class EventVersionManager {
  private versions: Map<string, number> = new Map();
  private migrations: Map<string, Map<number, (event: any) => any>> = new Map();

  registerVersion(eventType: string, version: number): void {
    this.versions.set(eventType, version);
  }

  registerMigration(eventType: string, fromVersion: number, migrate: (event: any) => any): void {
    const typeMigrations = this.migrations.get(eventType) ?? new Map();
    typeMigrations.set(fromVersion, migrate);
    this.migrations.set(eventType, typeMigrations);
  }

  getCurrentVersion(eventType: string): number {
    return this.versions.get(eventType) ?? 1;
  }

  migrateEvent(event: DomainEventEnvelope): DomainEventEnvelope {
    const currentVersion = this.getCurrentVersion(event.eventType);
    if (event.version >= currentVersion) return event;

    let migrated = { ...event };
    const typeMigrations = this.migrations.get(event.eventType);
    if (!typeMigrations) return event;

    for (let v = event.version; v < currentVersion; v++) {
      const migrateFn = typeMigrations.get(v);
      if (migrateFn) {
        migrated = migrateFn(migrated);
      }
    }

    return { ...migrated, version: currentVersion };
  }
}

// ---- Event Serializer ----
export class EventSerializer {
  private serializers: Map<string, (payload: unknown) => string> = new Map();
  private deserializers: Map<string, (data: string) => unknown> = new Map();

  register<T>(eventType: string, serialize: (payload: T) => string, deserialize: (data: string) => T): void {
    this.serializers.set(eventType, serialize as (payload: unknown) => string);
    this.deserializers.set(eventType, deserialize as (data: string) => unknown);
  }

  serialize(event: DomainEventEnvelope): string {
    const serializer = this.serializers.get(event.eventType);
    const payload = serializer ? serializer(event.payload) : JSON.stringify(event.payload);
    return JSON.stringify({ ...event, payload });
  }

  deserialize<T = unknown>(data: string): DomainEventEnvelope<T> {
    const parsed = JSON.parse(data);
    const deserializer = this.deserializers.get(parsed.eventType);
    let payload: unknown;
    if (deserializer) {
      payload = deserializer(parsed.payload);
    } else {
      // Payload is already a JSON string when no custom serializer
      if (typeof parsed.payload === 'string') {
        try { payload = JSON.parse(parsed.payload); } catch { payload = parsed.payload; }
      } else {
        payload = parsed.payload;
      }
    }
    return { ...parsed, payload };
  }
}

// ---- Domain Event Bus ----
export class DomainEventBus {
  private syncHandlers: Map<string, Set<DomainEventHandler>> = new Map();
  private asyncHandlers: Map<string, Set<DomainEventHandler>> = new Map();
  private versionManager: EventVersionManager;
  private serializer: EventSerializer;
  private aggregator: EventAggregator;
  private logger: LoggerInterface;

  constructor(options?: {
    versionManager?: EventVersionManager;
    serializer?: EventSerializer;
    aggregator?: EventAggregator;
    logger?: LoggerInterface;
  }) {
    this.versionManager = options?.versionManager ?? new EventVersionManager();
    this.serializer = options?.serializer ?? new EventSerializer();
    this.aggregator = options?.aggregator ?? new EventAggregator();
    this.logger = options?.logger ?? new Logger();
  }

  subscribe(eventType: string, handler: DomainEventHandler, options?: { async?: boolean }): () => void {
    const target = options?.async ? this.asyncHandlers : this.syncHandlers;
    if (!target.has(eventType)) target.set(eventType, new Set());
    target.get(eventType)!.add(handler);
    return () => { target.get(eventType)?.delete(handler); };
  }

  subscribeAll(handler: DomainEventHandler, options?: { async?: boolean }): () => void {
    const target = options?.async ? this.asyncHandlers : this.syncHandlers;
    const wildcard = '*';
    if (!target.has(wildcard)) target.set(wildcard, new Set());
    target.get(wildcard)!.add(handler);
    return () => { target.get(wildcard)?.delete(handler); };
  }

  publish<T>(event: DomainEventEnvelope<T>): void {
    const migrated = this.versionManager.migrateEvent(event);
    this.aggregator.add(migrated);

    // Sync handlers
    const syncHandlers = this.syncHandlers.get(event.eventType);
    const wildcardSync = this.syncHandlers.get('*');
    if (syncHandlers) for (const h of syncHandlers) this.safeExecute(h, migrated);
    if (wildcardSync) for (const h of wildcardSync) this.safeExecute(h, migrated);

    // Async handlers
    const asyncHandlers = this.asyncHandlers.get(event.eventType);
    const wildcardAsync = this.asyncHandlers.get('*');
    if (asyncHandlers) for (const h of asyncHandlers) Promise.resolve().then(() => this.safeExecute(h, migrated));
    if (wildcardAsync) for (const h of wildcardAsync) Promise.resolve().then(() => this.safeExecute(h, migrated));
  }

  private safeExecute(handler: DomainEventHandler, event: DomainEventEnvelope): void {
    try {
      const result = handler(event);
      if (result instanceof Promise) {
        result.catch(err => this.logger.error('Async event handler error', { error: String(err) }));
      }
    } catch (err) {
      this.logger.error('Event handler error', { error: String(err) });
    }
  }

  async flush(): Promise<void> {
    await this.aggregator.flush();
  }

  getSerializer(): EventSerializer {
    return this.serializer;
  }

  getVersionManager(): EventVersionManager {
    return this.versionManager;
  }
}

// ---- Event Factory ----
let eventCounter = 0;
export function createDomainEvent<T>(
  eventType: string,
  payload: T,
  options?: { version?: number; correlationId?: string; metadata?: Record<string, unknown> },
): DomainEventEnvelope<T> {
  eventCounter++;
  return {
    eventId: `de-${Date.now().toString(36)}-${eventCounter.toString(36).padStart(4, '0')}`,
    eventType,
    version: options?.version ?? 1,
    timestamp: new Date(),
    correlationId: options?.correlationId,
    payload,
    metadata: options?.metadata ?? {},
  };
}
