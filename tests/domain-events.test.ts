// ============================================================================
// Tests for @claude-agent/domain-events
// ============================================================================
import { describe, test, expect, beforeEach } from 'bun:test';
import { DomainEventBus, EventAggregator, EventVersionManager, EventSerializer, createDomainEvent } from '../packages/domain-events/src/index.js';

describe('@claude-agent/domain-events', () => {
  describe('DomainEventBus', () => {
    let bus: DomainEventBus;

    beforeEach(() => { bus = new DomainEventBus(); });

    test('subscribes and publishes sync events', () => {
      let received = false;
      bus.subscribe('test', () => { received = true; });
      bus.publish(createDomainEvent('test', { key: 'value' }));
      expect(received).toBe(true);
    });

    test('supports wildcard subscribers', () => {
      const types: string[] = [];
      bus.subscribeAll((event) => { types.push(event.eventType); });
      bus.publish(createDomainEvent('a', {}));
      bus.publish(createDomainEvent('b', {}));
      expect(types).toEqual(['a', 'b']);
    });

    test('unsubscribes handlers', () => {
      let received = false;
      const unsub = bus.subscribe('test', () => { received = true; });
      unsub();
      bus.publish(createDomainEvent('test', {}));
      expect(received).toBe(false);
    });

    test('handles async handlers', async () => {
      let received = false;
      bus.subscribe('test', async () => { await new Promise(r => setTimeout(r, 10)); received = true; }, { async: true });
      bus.publish(createDomainEvent('test', {}));
      await new Promise(r => setTimeout(r, 50));
      expect(received).toBe(true);
    });

    test('handles handler errors gracefully', () => {
      bus.subscribe('test', () => { throw new Error('handler error'); });
      expect(() => bus.publish(createDomainEvent('test', {}))).not.toThrow();
    });
  });

  describe('EventAggregator', () => {
    test('buffers events', () => {
      const agg = new EventAggregator({ maxSize: 5 });
      agg.add(createDomainEvent('test', {}));
      expect(agg.size).toBe(1);
    });

    test('flushes buffer', async () => {
      let flushed: any[] = [];
      const agg = new EventAggregator({ maxSize: 5, onFlush: async (events) => { flushed = events; } });
      agg.add(createDomainEvent('test', {}));
      await agg.flush();
      expect(flushed).toHaveLength(1);
    });

    test('auto-flushes at max size', async () => {
      let flushed = false;
      const agg = new EventAggregator({ maxSize: 2, onFlush: async () => { flushed = true; } });
      agg.add(createDomainEvent('a', {}));
      expect(flushed).toBe(false);
      agg.add(createDomainEvent('b', {}));
      expect(flushed).toBe(true);
    });
  });

  describe('EventVersionManager', () => {
    test('registers and gets versions', () => {
      const mgr = new EventVersionManager();
      mgr.registerVersion('test', 3);
      expect(mgr.getCurrentVersion('test')).toBe(3);
    });

    test('returns 1 for unregistered event', () => {
      const mgr = new EventVersionManager();
      expect(mgr.getCurrentVersion('unknown')).toBe(1);
    });

    test('migrates events', () => {
      const mgr = new EventVersionManager();
      mgr.registerVersion('test', 3);
      mgr.registerMigration('test', 1, (event) => ({ ...event, version: 2, payload: { ...(event.payload as any), migrated: true } }));
      mgr.registerMigration('test', 2, (event) => ({ ...event, version: 3, payload: { ...(event.payload as any), migrated2: true } }));
      const event = createDomainEvent('test', { original: true }, { version: 1 });
      const migrated = mgr.migrateEvent(event);
      expect(migrated.version).toBe(3);
      expect((migrated.payload as any).migrated).toBe(true);
      expect((migrated.payload as any).migrated2).toBe(true);
    });

    test('skips migration for current version', () => {
      const mgr = new EventVersionManager();
      mgr.registerVersion('test', 2);
      const event = createDomainEvent('test', {}, { version: 2 });
      const result = mgr.migrateEvent(event);
      expect(result.version).toBe(2);
    });
  });

  describe('EventSerializer', () => {
    test('serializes and deserializes events', () => {
      const serializer = new EventSerializer();
      serializer.register('test', (p) => JSON.stringify(p), (d) => JSON.parse(d));
      const event = createDomainEvent('test', { key: 'value' });
      const serialized = serializer.serialize(event);
      const deserialized = serializer.deserialize(serialized);
      expect(deserialized.eventType).toBe('test');
      expect((deserialized.payload as any).key).toBe('value');
    });

    test('serializes without custom serializer', () => {
      const serializer = new EventSerializer();
      const event = createDomainEvent('test', { key: 'value' });
      const serialized = serializer.serialize(event);
      const deserialized = serializer.deserialize(serialized);
      expect(deserialized.payload).toEqual({ key: 'value' });
    });
  });

  describe('createDomainEvent', () => {
    test('creates event with defaults', () => {
      const event = createDomainEvent('test', { data: 42 });
      expect(event.eventType).toBe('test');
      expect(event.version).toBe(1);
      expect(event.eventId).toMatch(/^de-/);
      expect(event.payload).toEqual({ data: 42 });
    });

    test('creates event with options', () => {
      const event = createDomainEvent('test', {}, { version: 2, correlationId: 'corr-1' });
      expect(event.version).toBe(2);
      expect(event.correlationId).toBe('corr-1');
    });
  });
});
