// src/event-sourcing.ts - 事件溯源存储

export interface DomainEvent {
  eventId: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  version: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface AggregateSnapshot {
  aggregateId: string;
  state: unknown;
  version: number;
  timestamp: number;
}

export interface EventStream {
  aggregateId: string;
  events: DomainEvent[];
  currentVersion: number;
}

export class EventSourcedStore {
  private eventStreams: Map<string, DomainEvent[]> = new Map();
  private snapshots: Map<string, AggregateSnapshot> = new Map();
  private eventCounter = 0;
  private projectors: Map<string, (event: DomainEvent) => void> = new Map();

  append(event: DomainEvent): void {
    this.eventCounter++;
    const stream = this.eventStreams.get(event.aggregateId) ?? [];
    const versionedEvent: DomainEvent = {
      ...event,
      eventId: event.eventId || `evt_${this.eventCounter}_${Date.now()}`,
      version: stream.length + 1,
      timestamp: event.timestamp || Date.now(),
    };
    stream.push(versionedEvent);
    this.eventStreams.set(event.aggregateId, stream);

    // Notify projectors (catch errors to prevent event storage from being affected)
    for (const [name, projector] of this.projectors) {
      try {
        projector(versionedEvent);
      } catch (err) {
        // Log projector error but don't fail the append
        // In production this would use a proper logger
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.warn(`Projector "${name}" error on event ${versionedEvent.eventId}: ${errorMsg}`);
      }
    }
  }

  getEvents(aggregateId: string, fromVersion?: number): DomainEvent[] {
    const stream = this.eventStreams.get(aggregateId) ?? [];
    if (fromVersion === undefined) return [...stream];
    return stream.filter((e) => e.version >= fromVersion);
  }

  getState(aggregateId: string): unknown {
    const snapshot = this.snapshots.get(aggregateId);
    const stream = this.eventStreams.get(aggregateId) ?? [];

    if (snapshot) {
      // Rebuild from snapshot + subsequent events
      let state = structuredClone(snapshot.state);
      const subsequentEvents = stream.filter((e) => e.version > snapshot.version);
      for (const event of subsequentEvents) {
        state = this.applyEvent(state, event);
      }
      return state;
    }

    // Build from all events
    let state: Record<string, unknown> = {};
    for (const event of stream) {
      state = this.applyEvent(state, event) as Record<string, unknown>;
    }
    return state;
  }

  createSnapshot(aggregateId: string): void {
    const state = this.getState(aggregateId);
    const stream = this.eventStreams.get(aggregateId) ?? [];
    const version = stream.length;

    this.snapshots.set(aggregateId, {
      aggregateId,
      state: structuredClone(state),
      version,
      timestamp: Date.now(),
    });
  }

  replay(aggregateId: string): unknown {
    return this.getState(aggregateId);
  }

  registerProjector(name: string, projector: (event: DomainEvent) => void): void {
    this.projectors.set(name, projector);
  }

  removeProjector(name: string): void {
    this.projectors.delete(name);
  }

  getSnapshot(aggregateId: string): AggregateSnapshot | undefined {
    const snap = this.snapshots.get(aggregateId);
    if (!snap) return undefined;
    return { ...snap, state: structuredClone(snap.state) };
  }

  getStreamVersion(aggregateId: string): number {
    return (this.eventStreams.get(aggregateId) ?? []).length;
  }

  getAggregateIds(): string[] {
    return Array.from(this.eventStreams.keys());
  }

  getTotalEventCount(): number {
    let count = 0;
    for (const stream of this.eventStreams.values()) {
      count += stream.length;
    }
    return count;
  }

  private applyEvent(state: unknown, event: DomainEvent): unknown {
    // Default event application logic
    if (typeof state !== 'object' || state === null) {
      return state;
    }

    const s = state as Record<string, unknown>;
    switch (event.eventType) {
      case 'created':
        return { ...event.payload, id: event.aggregateId };
      case 'updated':
        return { ...s, ...event.payload };
      case 'deleted':
        return { ...s, deleted: true };
      default:
        return { ...s, lastEvent: event.eventType, lastPayload: event.payload };
    }
  }

  destroy(): void {
    this.eventStreams.clear();
    this.snapshots.clear();
    this.projectors.clear();
  }
}
