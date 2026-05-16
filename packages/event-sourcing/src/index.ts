// ============================================================================
// @claude-agent/event-sourcing - Event Sourcing System
// ============================================================================

import type { LoggerInterface } from '@claude-agent/types';
import { Logger } from '@claude-agent/logger';

// ---- Domain Event ----
export interface DomainEvent<T = unknown> {
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly timestamp: Date;
  readonly data: T;
  readonly metadata?: Record<string, unknown>;
}

// ---- Event Store ----
export interface EventStore {
  append(event: DomainEvent): Promise<void>;
  appendBatch(events: DomainEvent[]): Promise<void>;
  getEvents(aggregateId: string): Promise<DomainEvent[]>;
  getEventsByType(eventType: string): Promise<DomainEvent[]>;
  getAllEvents(): Promise<DomainEvent[]>;
  getEventsFromVersion(aggregateId: string, version: number): Promise<DomainEvent[]>;
}

// ---- In-Memory Event Store ----
export class InMemoryEventStore implements EventStore {
  private events: Map<string, DomainEvent[]> = new Map();
  private allEvents: DomainEvent[] = [];
  private typeIndex: Map<string, DomainEvent[]> = new Map();

  async append(event: DomainEvent): Promise<void> {
    const aggregateEvents = this.events.get(event.aggregateId) ?? [];
    aggregateEvents.push(event);
    this.events.set(event.aggregateId, aggregateEvents);
    this.allEvents.push(event);

    const typeEvents = this.typeIndex.get(event.eventType) ?? [];
    typeEvents.push(event);
    this.typeIndex.set(event.eventType, typeEvents);
  }

  async appendBatch(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.append(event);
    }
  }

  async getEvents(aggregateId: string): Promise<DomainEvent[]> {
    return this.events.get(aggregateId) ?? [];
  }

  async getEventsByType(eventType: string): Promise<DomainEvent[]> {
    return this.typeIndex.get(eventType) ?? [];
  }

  async getAllEvents(): Promise<DomainEvent[]> {
    return [...this.allEvents];
  }

  async getEventsFromVersion(aggregateId: string, version: number): Promise<DomainEvent[]> {
    const events = this.events.get(aggregateId) ?? [];
    return events.filter(e => e.aggregateVersion >= version);
  }
}

// ---- Aggregate Root ----
export abstract class AggregateRoot<TState> {
  protected state: TState;
  protected version: number = 0;
  protected pendingEvents: DomainEvent[] = [];
  readonly aggregateId: string;

  constructor(aggregateId: string, initialState: TState) {
    this.aggregateId = aggregateId;
    this.state = initialState;
  }

  getState(): TState {
    return { ...this.state } as TState;
  }

  getVersion(): number {
    return this.version;
  }

  getPendingEvents(): DomainEvent[] {
    return [...this.pendingEvents];
  }

  clearPendingEvents(): void {
    this.pendingEvents = [];
  }

  protected applyEvent<T>(eventType: string, data: T, metadata?: Record<string, unknown>): void {
    this.version++;
    const event: DomainEvent<T> = {
      eventId: `evt-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
      eventType,
      aggregateId: this.aggregateId,
      aggregateVersion: this.version,
      timestamp: new Date(),
      data,
      metadata,
    };
    this.pendingEvents.push(event);
    this.handleEvent(event);
  }

  loadFromHistory(events: DomainEvent[]): void {
    for (const event of events) {
      this.handleEvent(event);
      this.version = event.aggregateVersion;
    }
  }

  protected abstract handleEvent(event: DomainEvent): void;
}

// ---- Snapshot ----
export interface Snapshot<TState> {
  readonly aggregateId: string;
  readonly version: number;
  readonly state: TState;
  readonly timestamp: Date;
}

export interface SnapshotStore<TState> {
  saveSnapshot(snapshot: Snapshot<TState>): Promise<void>;
  getSnapshot(aggregateId: string): Promise<Snapshot<TState> | null>;
  getLatestSnapshot(aggregateId: string): Promise<Snapshot<TState> | null>;
}

export class InMemorySnapshotStore<TState> implements SnapshotStore<TState> {
  private snapshots: Map<string, Snapshot<TState>[]> = new Map();

  async saveSnapshot(snapshot: Snapshot<TState>): Promise<void> {
    const list = this.snapshots.get(snapshot.aggregateId) ?? [];
    list.push(snapshot);
    this.snapshots.set(snapshot.aggregateId, list);
  }

  async getSnapshot(aggregateId: string, version?: number): Promise<Snapshot<TState> | null> {
    const list = this.snapshots.get(aggregateId) ?? [];
    if (version !== undefined) {
      return list.find(s => s.version <= version) ?? null;
    }
    return list[list.length - 1] ?? null;
  }

  async getLatestSnapshot(aggregateId: string): Promise<Snapshot<TState> | null> {
    return this.getSnapshot(aggregateId);
  }
}

// ---- Snapshot Strategy ----
export class SnapshotStrategy<TState> {
  private snapshotStore: SnapshotStore<TState>;
  private eventStore: EventStore;
  private interval: number;

  constructor(options: {
    snapshotStore: SnapshotStore<TState>;
    eventStore: EventStore;
    interval?: number;
  }) {
    this.snapshotStore = options.snapshotStore;
    this.eventStore = options.eventStore;
    this.interval = options.interval ?? 10;
  }

  async shouldSnapshot(aggregateId: string): Promise<boolean> {
    const snapshot = await this.snapshotStore.getLatestSnapshot(aggregateId);
    const events = await this.eventStore.getEvents(aggregateId);
    const currentVersion = events.length;
    const lastSnapshotVersion = snapshot?.version ?? 0;
    return (currentVersion - lastSnapshotVersion) >= this.interval;
  }

  async createSnapshot<TAggregate extends AggregateRoot<TState>>(aggregate: TAggregate): Promise<void> {
    const snapshot: Snapshot<TState> = {
      aggregateId: aggregate.aggregateId,
      version: aggregate.getVersion(),
      state: aggregate.getState(),
      timestamp: new Date(),
    };
    await this.snapshotStore.saveSnapshot(snapshot);
  }

  async restoreAggregate<TAggregate extends AggregateRoot<TState>>(
    aggregateId: string,
    createEmpty: (id: string) => TAggregate,
  ): Promise<TAggregate | null> {
    const snapshot = await this.snapshotStore.getLatestSnapshot(aggregateId);
    const aggregate = createEmpty(aggregateId);

    if (snapshot) {
      aggregate.loadFromHistory([]);
      const eventsAfterSnapshot = await this.eventStore.getEventsFromVersion(aggregateId, snapshot.version + 1);
      aggregate.loadFromHistory(eventsAfterSnapshot);
    } else {
      const events = await this.eventStore.getEvents(aggregateId);
      aggregate.loadFromHistory(events);
    }

    return aggregate;
  }
}

// ---- Projection ----
export interface Projection<TView = unknown> {
  readonly name: string;
  handle(event: DomainEvent): void;
  getView(): TView;
  reset(): void;
}

export class ProjectionManager {
  private projections: Map<string, Projection> = new Map();

  register(projection: Projection): void {
    this.projections.set(projection.name, projection);
  }

  unregister(name: string): void {
    this.projections.delete(name);
  }

  get(name: string): Projection | undefined {
    return this.projections.get(name);
  }

  async project(event: DomainEvent): Promise<void> {
    for (const projection of this.projections.values()) {
      projection.handle(event);
    }
  }

  async projectAll(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.project(event);
    }
  }

  list(): string[] {
    return Array.from(this.projections.keys());
  }
}

// ---- Event Replay ----
export class EventReplayer {
  private eventStore: EventStore;
  private projectionManager: ProjectionManager;
  private logger: LoggerInterface;

  constructor(eventStore: EventStore, projectionManager: ProjectionManager, logger?: LoggerInterface) {
    this.eventStore = eventStore;
    this.projectionManager = projectionManager;
    this.logger = logger ?? new Logger();
  }

  async replayAll(): Promise<number> {
    const events = await this.eventStore.getAllEvents();
    for (const projection of this.projectionManager.list()) {
      const p = this.projectionManager.get(projection)!;
      p.reset();
    }
    await this.projectionManager.projectAll(events);
    this.logger.info(`Replayed ${events.length} events`);
    return events.length;
  }

  async replayAggregate(aggregateId: string): Promise<number> {
    const events = await this.eventStore.getEvents(aggregateId);
    await this.projectionManager.projectAll(events);
    return events.length;
  }

  async replayFrom(timestamp: Date): Promise<number> {
    const allEvents = await this.eventStore.getAllEvents();
    const events = allEvents.filter(e => e.timestamp >= timestamp);
    await this.projectionManager.projectAll(events);
    return events.length;
  }
}
