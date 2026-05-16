// ============================================================================
// Tests for @claude-agent/event-sourcing
// ============================================================================
import { describe, test, expect, beforeEach } from 'bun:test';
import { InMemoryEventStore, InMemorySnapshotStore, SnapshotStrategy, ProjectionManager, EventReplayer, AggregateRoot, DomainEvent } from '../packages/event-sourcing/src/index.js';

describe('@claude-agent/event-sourcing', () => {
  describe('InMemoryEventStore', () => {
    let store: InMemoryEventStore;

    beforeEach(() => { store = new InMemoryEventStore(); });

    test('appends and retrieves events', async () => {
      const event: DomainEvent = { eventId: 'e1', eventType: 'test', aggregateId: 'a1', aggregateVersion: 1, timestamp: new Date(), data: {} };
      await store.append(event);
      const events = await store.getEvents('a1');
      expect(events).toHaveLength(1);
      expect(events[0]!.eventId).toBe('e1');
    });

    test('appends batch of events', async () => {
      const events: DomainEvent[] = [
        { eventId: 'e1', eventType: 'test', aggregateId: 'a1', aggregateVersion: 1, timestamp: new Date(), data: {} },
        { eventId: 'e2', eventType: 'test', aggregateId: 'a1', aggregateVersion: 2, timestamp: new Date(), data: {} },
      ];
      await store.appendBatch(events);
      expect((await store.getEvents('a1'))).toHaveLength(2);
    });

    test('gets events by type', async () => {
      await store.append({ eventId: 'e1', eventType: 'created', aggregateId: 'a1', aggregateVersion: 1, timestamp: new Date(), data: {} });
      await store.append({ eventId: 'e2', eventType: 'updated', aggregateId: 'a1', aggregateVersion: 2, timestamp: new Date(), data: {} });
      const created = await store.getEventsByType('created');
      expect(created).toHaveLength(1);
    });

    test('gets all events', async () => {
      await store.append({ eventId: 'e1', eventType: 'test', aggregateId: 'a1', aggregateVersion: 1, timestamp: new Date(), data: {} });
      await store.append({ eventId: 'e2', eventType: 'test', aggregateId: 'a2', aggregateVersion: 1, timestamp: new Date(), data: {} });
      expect((await store.getAllEvents())).toHaveLength(2);
    });

    test('gets events from version', async () => {
      await store.append({ eventId: 'e1', eventType: 'test', aggregateId: 'a1', aggregateVersion: 1, timestamp: new Date(), data: {} });
      await store.append({ eventId: 'e2', eventType: 'test', aggregateId: 'a1', aggregateVersion: 2, timestamp: new Date(), data: {} });
      await store.append({ eventId: 'e3', eventType: 'test', aggregateId: 'a1', aggregateVersion: 3, timestamp: new Date(), data: {} });
      const events = await store.getEventsFromVersion('a1', 2);
      expect(events).toHaveLength(2);
    });
  });

  describe('AggregateRoot', () => {
    class TestAggregate extends AggregateRoot<{ value: number }> {
      constructor(id: string) { super(id, { value: 0 }); }
      increment() { this.applyEvent('incremented', { by: 1 }); }
      protected handleEvent(event: DomainEvent): void {
        if (event.eventType === 'incremented') this.state = { value: this.state.value + (event.data as any).by };
      }
    }

    test('applies events', () => {
      const agg = new TestAggregate('agg-1');
      agg.increment();
      expect(agg.getState().value).toBe(1);
      expect(agg.getVersion()).toBe(1);
    });

    test('collects pending events', () => {
      const agg = new TestAggregate('agg-1');
      agg.increment();
      agg.increment();
      expect(agg.getPendingEvents()).toHaveLength(2);
    });

    test('clears pending events', () => {
      const agg = new TestAggregate('agg-1');
      agg.increment();
      agg.clearPendingEvents();
      expect(agg.getPendingEvents()).toHaveLength(0);
    });

    test('loads from history', () => {
      const agg = new TestAggregate('agg-1');
      const events: DomainEvent[] = [
        { eventId: 'e1', eventType: 'incremented', aggregateId: 'agg-1', aggregateVersion: 1, timestamp: new Date(), data: { by: 5 } },
        { eventId: 'e2', eventType: 'incremented', aggregateId: 'agg-1', aggregateVersion: 2, timestamp: new Date(), data: { by: 3 } },
      ];
      agg.loadFromHistory(events);
      expect(agg.getState().value).toBe(8);
      expect(agg.getVersion()).toBe(2);
    });
  });

  describe('InMemorySnapshotStore', () => {
    test('saves and retrieves snapshot', async () => {
      const store = new InMemorySnapshotStore<{ value: number }>();
      await store.saveSnapshot({ aggregateId: 'a1', version: 5, state: { value: 42 }, timestamp: new Date() });
      const snapshot = await store.getLatestSnapshot('a1');
      expect(snapshot).toBeDefined();
      expect(snapshot!.state.value).toBe(42);
    });

    test('returns null for unknown aggregate', async () => {
      const store = new InMemorySnapshotStore<{ value: number }>();
      const snapshot = await store.getLatestSnapshot('unknown');
      expect(snapshot).toBeNull();
    });
  });

  describe('SnapshotStrategy', () => {
    test('should snapshot after interval', async () => {
      const eventStore = new InMemoryEventStore();
      const snapshotStore = new InMemorySnapshotStore<{ value: number }>();
      const strategy = new SnapshotStrategy({ eventStore, snapshotStore, interval: 3 });
      for (let i = 0; i < 5; i++) {
        await eventStore.append({ eventId: `e${i}`, eventType: 'test', aggregateId: 'a1', aggregateVersion: i + 1, timestamp: new Date(), data: {} });
      }
      expect(await strategy.shouldSnapshot('a1')).toBe(true);
    });
  });

  describe('ProjectionManager', () => {
    test('registers and retrieves projections', () => {
      const mgr = new ProjectionManager();
      const proj = { name: 'test', handle: () => {}, getView: () => null, reset: () => {} };
      mgr.register(proj);
      expect(mgr.get('test')).toBeDefined();
      expect(mgr.list()).toContain('test');
    });

    test('unregisters projections', () => {
      const mgr = new ProjectionManager();
      const proj = { name: 'test', handle: () => {}, getView: () => null, reset: () => {} };
      mgr.register(proj);
      mgr.unregister('test');
      expect(mgr.get('test')).toBeUndefined();
    });

    test('projects events to projections', async () => {
      let handled = false;
      const mgr = new ProjectionManager();
      mgr.register({ name: 'test', handle: () => { handled = true; }, getView: () => null, reset: () => {} });
      await mgr.project({ eventId: 'e1', eventType: 'test', aggregateId: 'a1', aggregateVersion: 1, timestamp: new Date(), data: {} });
      expect(handled).toBe(true);
    });
  });

  describe('EventReplayer', () => {
    test('replays all events', async () => {
      const store = new InMemoryEventStore();
      await store.append({ eventId: 'e1', eventType: 'test', aggregateId: 'a1', aggregateVersion: 1, timestamp: new Date(), data: {} });
      await store.append({ eventId: 'e2', eventType: 'test', aggregateId: 'a1', aggregateVersion: 2, timestamp: new Date(), data: {} });
      const projMgr = new ProjectionManager();
      let count = 0;
      projMgr.register({ name: 'counter', handle: () => { count++; }, getView: () => count, reset: () => { count = 0; } });
      const replayer = new EventReplayer(store, projMgr);
      const replayed = await replayer.replayAll();
      expect(replayed).toBe(2);
      expect(count).toBe(2);
    });
  });
});
