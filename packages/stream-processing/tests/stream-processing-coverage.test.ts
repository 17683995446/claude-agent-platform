import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import {
  EventStream,
  StreamProcessor,
  WindowOperator,
  JoinOperator,
  AggregationOperator,
  StreamScheduler,
  BackpressureHandler,
  StreamReplay,
  StreamCircuitBreaker,
  StreamMetrics,
} from '../src/index.js';
import type { Subscription } from '../src/index.js';

// ============================================================
// EventStream Tests - Comprehensive Coverage
// ============================================================
describe('EventStream', () => {
  let stream: EventStream<number>;

  beforeEach(() => {
    stream = new EventStream<number>();
  });

  // --- Constructor ---
  describe('constructor', () => {
    it('should create with default options (maxSize=Infinity, retentionMs=Infinity)', () => {
      const s = new EventStream<number>();
      expect(s.getEventCount()).toBe(0);
    });

    it('should create with custom maxSize', () => {
      const s = new EventStream<number>({ maxSize: 5 });
      expect(s).toBeDefined();
    });

    it('should create with custom retentionMs', () => {
      const s = new EventStream<number>({ retentionMs: 1000 });
      expect(s).toBeDefined();
    });

    it('should create with both maxSize and retentionMs', () => {
      const s = new EventStream<number>({ maxSize: 10, retentionMs: 5000 });
      expect(s).toBeDefined();
    });

    it('should create with maxSize=0', () => {
      const s = new EventStream<number>({ maxSize: 0 });
      s.publish(1);
      expect(s.getEventCount()).toBe(0);
    });

    it('should create with retentionMs=0', async () => {
      const s = new EventStream<number>({ retentionMs: 0 });
      s.publish(1);
      await new Promise((r) => setTimeout(r, 5));
      expect(s.getEventCount()).toBe(0);
    });
  });

  // --- publish ---
  describe('publish', () => {
    it('should publish single event', () => {
      stream.publish(1);
      expect(stream.getEventCount()).toBe(1);
    });

    it('should publish multiple events', () => {
      stream.publish(1);
      stream.publish(2);
      expect(stream.getEventCount()).toBe(2);
    });

    it('should publish undefined event', () => {
      const s = new EventStream<undefined>();
      s.publish(undefined);
      expect(s.getEventCount()).toBe(1);
    });

    it('should publish null event', () => {
      const s = new EventStream<null>();
      s.publish(null);
      expect(s.getEventCount()).toBe(1);
    });

    it('should publish object events', () => {
      const s = new EventStream<{ id: number }>();
      s.publish({ id: 1 });
      expect(s.getEventCount()).toBe(1);
    });

    it('should notify subscribers on publish', () => {
      const received: number[] = [];
      stream.subscribe((e) => received.push(e));
      stream.publish(42);
      expect(received).toEqual([42]);
    });

    it('should not notify inactive subscribers', () => {
      const received: number[] = [];
      const sub = stream.subscribe((e) => received.push(e));
      sub.active = false;
      stream.publish(42);
      expect(received).toEqual([]);
    });
  });

  // --- subscribe ---
  describe('subscribe', () => {
    it('should return a subscription with id and active flag', () => {
      const sub = stream.subscribe(() => {});
      expect(sub.id).toBeDefined();
      expect(sub.id).toMatch(/^sub-\d+$/);
      expect(sub.active).toBe(true);
      expect(typeof sub.unsubscribe).toBe('function');
    });

    it('should support multiple subscribers', () => {
      const received1: number[] = [];
      const received2: number[] = [];
      stream.subscribe((e) => received1.push(e));
      stream.subscribe((e) => received2.push(e));
      stream.publish(1);
      expect(received1).toEqual([1]);
      expect(received2).toEqual([1]);
    });

    it('should generate unique subscription ids', () => {
      const sub1 = stream.subscribe(() => {});
      const sub2 = stream.subscribe(() => {});
      expect(sub1.id).not.toBe(sub2.id);
    });

    it('should handle async subscriber', async () => {
      const received: number[] = [];
      stream.subscribe(async (e) => {
        await Promise.resolve();
        received.push(e);
      });
      stream.publish(1);
      stream.publish(2);
      await new Promise((r) => setTimeout(r, 10));
      expect(received).toEqual([1, 2]);
    });

    it('should handle subscriber that throws', () => {
      stream.subscribe(() => {
        throw new Error('subscriber error');
      });
      // Should not throw - errors in subscribers are silently ignored (void sub.handler(event))
      expect(() => stream.publish(1)).not.toThrow();
    });
  });

  // --- unsubscribe ---
  describe('unsubscribe', () => {
    it('should unsubscribe from stream', () => {
      const received: number[] = [];
      const sub = stream.subscribe((e) => received.push(e));
      stream.publish(1);
      stream.unsubscribe(sub.id);
      stream.publish(2);
      expect(received).toEqual([1]);
    });

    it('should handle unsubscribe with invalid id', () => {
      expect(() => stream.unsubscribe('invalid')).not.toThrow();
    });

    it('should handle unsubscribe via subscription object', () => {
      const received: number[] = [];
      const sub = stream.subscribe((e) => received.push(e));
      stream.publish(1);
      sub.unsubscribe();
      stream.publish(2);
      expect(received).toEqual([1]);
    });

    it('should set active to false on unsubscribe', () => {
      const sub = stream.subscribe(() => {});
      sub.unsubscribe();
      expect(sub.active).toBe(false);
    });
  });

  // --- getEvents ---
  describe('getEvents', () => {
    it('should get all events', () => {
      stream.publish(1);
      stream.publish(2);
      stream.publish(3);
      expect(stream.getEvents()).toEqual([1, 2, 3]);
    });

    it('should get limited number of events (last N)', () => {
      stream.publish(1);
      stream.publish(2);
      stream.publish(3);
      expect(stream.getEvents(2)).toEqual([2, 3]);
    });

    it('should get events with count 0', () => {
      stream.publish(1);
      expect(stream.getEvents(0)).toEqual([]);
    });

    it('should get events without count parameter', () => {
      stream.publish(10);
      stream.publish(20);
      expect(stream.getEvents()).toEqual([10, 20]);
    });

    it('should get events with count greater than total', () => {
      stream.publish(1);
      stream.publish(2);
      expect(stream.getEvents(10)).toEqual([1, 2]);
    });

    it('should get events with negative count (returns all)', () => {
      stream.publish(1);
      stream.publish(2);
      // BUG-7: negative count returns all events
      expect(stream.getEvents(-1)).toEqual([1, 2]);
    });

    it('should return empty array for empty stream', () => {
      expect(stream.getEvents()).toEqual([]);
    });

    it('should get events with count=1', () => {
      stream.publish(1);
      stream.publish(2);
      expect(stream.getEvents(1)).toEqual([2]);
    });
  });

  // --- getEventCount ---
  describe('getEventCount', () => {
    it('should return 0 for empty stream', () => {
      expect(stream.getEventCount()).toBe(0);
    });

    it('should return correct count after publishes', () => {
      stream.publish(1);
      stream.publish(2);
      expect(stream.getEventCount()).toBe(2);
    });

    it('should reflect eviction', async () => {
      const s = new EventStream<number>({ retentionMs: 10 });
      s.publish(1);
      s.publish(2);
      await new Promise((r) => setTimeout(r, 20));
      expect(s.getEventCount()).toBe(0);
    });
  });

  // --- clear ---
  describe('clear', () => {
    it('should clear all events', () => {
      stream.publish(1);
      stream.publish(2);
      stream.clear();
      expect(stream.getEventCount()).toBe(0);
    });

    it('should not affect subscriptions', () => {
      const received: number[] = [];
      stream.subscribe((e) => received.push(e));
      stream.publish(1);
      stream.clear();
      stream.publish(2);
      expect(received).toEqual([1, 2]);
    });
  });

  // --- pipe ---
  describe('pipe', () => {
    it('should pipe events to another stream with transform', () => {
      const target = new EventStream<string>();
      stream.pipe(target, (n) => `val-${n}`);
      stream.publish(1);
      stream.publish(2);
      expect(target.getEvents()).toEqual(['val-1', 'val-2']);
    });

    it('should pipe events that transform to arrays', () => {
      const target = new EventStream<number>();
      stream.pipe(target, (n) => [n, n * 10]);
      stream.publish(1);
      stream.publish(2);
      expect(target.getEvents()).toEqual([1, 10, 2, 20]);
    });

    it('should pipe empty array (no events published)', () => {
      const target = new EventStream<number>();
      stream.pipe(target, () => []);
      stream.publish(1);
      expect(target.getEventCount()).toBe(0);
    });

    it('should return the target stream', () => {
      const target = new EventStream<string>();
      const result = stream.pipe(target, (n) => String(n));
      expect(result).toBe(target);
    });
  });

  // --- filter ---
  describe('filter', () => {
    it('should filter events matching predicate', () => {
      const filtered = stream.filter((n) => n % 2 === 0);
      stream.publish(1);
      stream.publish(2);
      stream.publish(3);
      stream.publish(4);
      expect(filtered.getEvents()).toEqual([2, 4]);
    });

    it('should filter all events out', () => {
      const filtered = stream.filter(() => false);
      stream.publish(1);
      stream.publish(2);
      expect(filtered.getEventCount()).toBe(0);
    });

    it('should pass all events through', () => {
      const filtered = stream.filter(() => true);
      stream.publish(1);
      stream.publish(2);
      expect(filtered.getEvents()).toEqual([1, 2]);
    });

    it('should return a new EventStream', () => {
      const filtered = stream.filter(() => true);
      expect(filtered).toBeInstanceOf(EventStream);
    });
  });

  // --- map ---
  describe('map', () => {
    it('should map events', () => {
      const mapped = stream.map((n) => n * 2);
      stream.publish(1);
      stream.publish(2);
      expect(mapped.getEvents()).toEqual([2, 4]);
    });

    it('should map to different types', () => {
      const mapped = stream.map((n) => String(n));
      stream.publish(1);
      expect(mapped.getEvents()).toEqual(['1']);
    });

    it('should return a new EventStream', () => {
      const mapped = stream.map((n) => n);
      expect(mapped).toBeInstanceOf(EventStream);
    });
  });

  // --- buffer ---
  describe('buffer', () => {
    it('should buffer events by count', () => {
      const buffered = stream.buffer(3);
      stream.publish(1);
      stream.publish(2);
      expect(buffered.getEventCount()).toBe(0);
      stream.publish(3);
      expect(buffered.getEventCount()).toBe(1);
      expect(buffered.getEvents()).toEqual([[1, 2, 3]]);
    });

    it('should buffer events across multiple buffers', () => {
      const buffered = stream.buffer(2);
      stream.publish(1);
      stream.publish(2);
      stream.publish(3);
      stream.publish(4);
      expect(buffered.getEvents()).toEqual([[1, 2], [3, 4]]);
    });

    it('should handle buffer with timeout', async () => {
      const buffered = stream.buffer(10, 20);
      stream.publish(1);
      expect(buffered.getEventCount()).toBe(0);
      await new Promise((r) => setTimeout(r, 30));
      expect(buffered.getEventCount()).toBe(1);
      expect(buffered.getEvents()).toEqual([[1]]);
    });

    it('should flush buffer when count reached even with timeout', () => {
      const buffered = stream.buffer(2, 10000);
      stream.publish(1);
      stream.publish(2);
      expect(buffered.getEvents()).toEqual([[1, 2]]);
    });

    it('should handle buffer count=1', () => {
      const buffered = stream.buffer(1);
      stream.publish(1);
      stream.publish(2);
      expect(buffered.getEvents()).toEqual([[1], [2]]);
    });
  });

  // --- reduce ---
  describe('reduce', () => {
    it('should reduce events', async () => {
      stream.publish(1);
      stream.publish(2);
      stream.publish(3);
      const result = await stream.reduce((acc, n) => acc + n, 0);
      expect(result).toBe(6);
    });

    it('should reduce events with different accumulator type', async () => {
      stream.publish(1);
      stream.publish(2);
      stream.publish(3);
      const result = await stream.reduce((acc, n) => acc + String(n), '');
      expect(result).toBe('123');
    });

    it('should reduce empty stream', async () => {
      const result = await stream.reduce((acc, n) => acc + n, 0);
      expect(result).toBe(0);
    });

    it('should reduce single event', async () => {
      stream.publish(42);
      const result = await stream.reduce((acc, n) => acc + n, 0);
      expect(result).toBe(42);
    });
  });

  // --- Eviction ---
  describe('eviction', () => {
    it('should enforce maxSize', () => {
      const s = new EventStream<number>({ maxSize: 3 });
      s.publish(1);
      s.publish(2);
      s.publish(3);
      s.publish(4);
      expect(s.getEventCount()).toBe(3);
      expect(s.getEvents()).toEqual([2, 3, 4]);
    });

    it('should enforce maxSize=1', () => {
      const s = new EventStream<number>({ maxSize: 1 });
      s.publish(1);
      s.publish(2);
      expect(s.getEventCount()).toBe(1);
      expect(s.getEvents()).toEqual([2]);
    });

    it('should handle retention expiration', async () => {
      const s = new EventStream<number>({ retentionMs: 10 });
      s.publish(1);
      s.publish(2);
      await new Promise((r) => setTimeout(r, 20));
      expect(s.getEventCount()).toBe(0);
    });

    it('should combine maxSize and retentionMs', async () => {
      const s = new EventStream<number>({ maxSize: 100, retentionMs: 10 });
      for (let i = 0; i < 50; i++) s.publish(i);
      await new Promise((r) => setTimeout(r, 20));
      expect(s.getEventCount()).toBe(0);
    });
  });
});

// ============================================================
// StreamProcessor Tests - Comprehensive Coverage
// ============================================================
describe('StreamProcessor', () => {
  // --- Constructor ---
  describe('constructor', () => {
    it('should create with default options', () => {
      const proc = new StreamProcessor<number, number>();
      expect(proc).toBeDefined();
    });

    it('should create with custom concurrency', () => {
      const proc = new StreamProcessor<number, number>({ concurrency: 4 });
      expect(proc).toBeDefined();
    });

    it('should create with custom errorHandler', () => {
      const errorHandler = (_err: unknown, _event: unknown) => {};
      const proc = new StreamProcessor<number, number>({ errorHandler });
      expect(proc).toBeDefined();
    });
  });

  // --- getOutputStream ---
  describe('getOutputStream', () => {
    it('should return an EventStream', () => {
      const proc = new StreamProcessor<number, number>();
      expect(proc.getOutputStream()).toBeInstanceOf(EventStream);
    });

    it('should return the same stream on multiple calls', () => {
      const proc = new StreamProcessor<number, number>();
      expect(proc.getOutputStream()).toBe(proc.getOutputStream());
    });
  });

  // --- start / stop ---
  describe('start/stop', () => {
    it('should start processing', () => {
      const proc = new StreamProcessor<number, number>();
      proc.start();
      expect(proc.getStats().processed).toBe(0);
    });

    it('should stop processing', () => {
      const proc = new StreamProcessor<number, number>();
      proc.start();
      proc.stop();
      expect(proc.getStats().processed).toBe(0);
    });

    it('should not process events before start', async () => {
      const proc = new StreamProcessor<number, number>();
      const input = new EventStream<number>();
      proc.pipe((n) => n * 2);
      proc.input(input);
      input.publish(5);
      await new Promise((r) => setTimeout(r, 20));
      expect(proc.getOutputStream().getEventCount()).toBe(0);
      proc.stop();
    });
  });

  // --- pipe ---
  describe('pipe', () => {
    it('should return a new StreamProcessor', () => {
      const proc = new StreamProcessor<number, number>();
      const next = proc.pipe((n) => n * 2);
      expect(next).toBeInstanceOf(StreamProcessor);
    });

    it('should chain multiple pipes', () => {
      const proc = new StreamProcessor<number, number>();
      const p2 = proc.pipe((n) => n * 2);
      const p3 = p2.pipe((n) => String(n));
      expect(p3).toBeInstanceOf(StreamProcessor);
    });
  });

  // --- input ---
  describe('input', () => {
    it('should process events through a single stage', async () => {
      const proc = new StreamProcessor<number, number>();
      const input = new EventStream<number>();
      proc.pipe((n) => n * 2);
      proc.input(input);
      proc.start();
      input.publish(5);
      input.publish(10);
      await new Promise((r) => setTimeout(r, 20));
      expect(proc.getOutputStream().getEvents()).toEqual([10, 20]);
      proc.stop();
    });

    it('should handle async transform stages', async () => {
      const proc = new StreamProcessor<number, number>();
      const input = new EventStream<number>();
      proc.pipe(async (n) => n * 3);
      proc.input(input);
      proc.start();
      input.publish(4);
      await new Promise((r) => setTimeout(r, 30));
      expect(proc.getOutputStream().getEvents()).toEqual([12]);
      proc.stop();
    });

    it('should handle transform returning array (last stage)', async () => {
      const proc = new StreamProcessor<number, number>();
      const input = new EventStream<number>();
      proc.pipe((n) => [n, n + 1]);
      proc.input(input);
      proc.start();
      input.publish(1);
      await new Promise((r) => setTimeout(r, 20));
      expect(proc.getOutputStream().getEvents()).toEqual([1, 2]);
      proc.stop();
    });

    it('should handle transform returning empty array', async () => {
      const proc = new StreamProcessor<number, number>();
      const input = new EventStream<number>();
      proc.pipe(() => [] as number[]);
      proc.input(input);
      proc.start();
      input.publish(1);
      await new Promise((r) => setTimeout(r, 20));
      expect(proc.getOutputStream().getEventCount()).toBe(0);
      expect(proc.getStats().processed).toBe(0);
      proc.stop();
    });

    // BUG-1 fix: transform returning undefined is now published (consistent behavior)
    it('should publish undefined when transform returns undefined', async () => {
      const proc = new StreamProcessor<number, number | undefined>();
      const input = new EventStream<number>();
      proc.pipe(() => undefined);
      proc.input(input);
      proc.start();
      input.publish(1);
      await new Promise((r) => setTimeout(r, 20));
      // After fix: undefined is published as a valid output
      expect(proc.getOutputStream().getEvents()).toEqual([undefined]);
      expect(proc.getStats().processed).toBe(1);
      proc.stop();
    });

    // BUG-1: transform returning null WILL be published (null !== undefined)
    it('should publish null when transform returns null', async () => {
      const proc = new StreamProcessor<number, number | null>();
      const input = new EventStream<number>();
      proc.pipe(() => null);
      proc.input(input);
      proc.start();
      input.publish(1);
      await new Promise((r) => setTimeout(r, 20));
      expect(proc.getOutputStream().getEvents()).toEqual([null]);
      proc.stop();
    });

    it('should handle errors in processing', async () => {
      const errors: unknown[] = [];
      const proc = new StreamProcessor<number, number>({
        errorHandler: (err) => errors.push(err),
      });
      const input = new EventStream<number>();
      proc.pipe(() => {
        throw new Error('test error');
      });
      proc.input(input);
      proc.start();
      input.publish(1);
      await new Promise((r) => setTimeout(r, 20));
      expect(proc.getStats().errors).toBe(1);
      expect(errors.length).toBe(1);
      proc.stop();
    });

    it('should handle errors without errorHandler', async () => {
      const proc = new StreamProcessor<number, number>();
      const input = new EventStream<number>();
      proc.pipe(() => {
        throw new Error('test error');
      });
      proc.input(input);
      proc.start();
      input.publish(1);
      await new Promise((r) => setTimeout(r, 20));
      expect(proc.getStats().errors).toBe(1);
      proc.stop();
    });

    it('should process events through multiple stages', async () => {
      const proc = new StreamProcessor<number, string>();
      const input = new EventStream<number>();
      proc.pipe((n) => n * 2);
      proc.pipe((n) => String(n));
      proc.input(input);
      proc.start();
      input.publish(3);
      await new Promise((r) => setTimeout(r, 20));
      expect(proc.getOutputStream().getEvents()).toEqual(['6']);
      proc.stop();
    });

    it('should handle array expansion in non-last stage', async () => {
      const proc = new StreamProcessor<number, number>();
      const input = new EventStream<number>();
      proc.pipe((n) => [n, n * 10]); // array expansion
      proc.pipe((n) => n + 1); // second stage
      proc.input(input);
      proc.start();
      input.publish(1);
      await new Promise((r) => setTimeout(r, 20));
      expect(proc.getOutputStream().getEvents()).toEqual([2, 11]);
      proc.stop();
    });

    it('should unsubscribe on stop', async () => {
      const proc = new StreamProcessor<number, number>();
      const input = new EventStream<number>();
      proc.pipe((n) => n * 2);
      proc.input(input);
      proc.start();
      input.publish(5);
      await new Promise((r) => setTimeout(r, 20));
      proc.stop();
      input.publish(10);
      await new Promise((r) => setTimeout(r, 20));
      expect(proc.getOutputStream().getEvents()).toEqual([10]); // only first event
    });
  });

  // --- getStats ---
  describe('getStats', () => {
    it('should return stats with all fields', () => {
      const proc = new StreamProcessor<number, number>();
      const stats = proc.getStats();
      expect(stats).toHaveProperty('processed');
      expect(stats).toHaveProperty('errors');
      expect(stats).toHaveProperty('avgLatency');
      expect(stats).toHaveProperty('throughput');
    });

    it('should return zero stats initially', () => {
      const proc = new StreamProcessor<number, number>();
      const stats = proc.getStats();
      expect(stats.processed).toBe(0);
      expect(stats.errors).toBe(0);
      expect(stats.avgLatency).toBe(0);
    });

    it('should track processed count', async () => {
      const proc = new StreamProcessor<number, number>();
      const input = new EventStream<number>();
      proc.pipe((n) => n);
      proc.input(input);
      proc.start();
      input.publish(1);
      input.publish(2);
      input.publish(3);
      await new Promise((r) => setTimeout(r, 20));
      expect(proc.getStats().processed).toBe(3);
      proc.stop();
    });

    it('should track error count', async () => {
      const proc = new StreamProcessor<number, number>();
      const input = new EventStream<number>();
      proc.pipe(() => {
        throw new Error('fail');
      });
      proc.input(input);
      proc.start();
      input.publish(1);
      input.publish(2);
      await new Promise((r) => setTimeout(r, 20));
      expect(proc.getStats().errors).toBe(2);
      proc.stop();
    });

    it('should calculate avgLatency', async () => {
      const proc = new StreamProcessor<number, number>();
      const input = new EventStream<number>();
      proc.pipe((n) => n);
      proc.input(input);
      proc.start();
      input.publish(1);
      input.publish(2);
      await new Promise((r) => setTimeout(r, 20));
      const stats = proc.getStats();
      expect(stats.avgLatency).toBeGreaterThanOrEqual(0);
      expect(stats.processed).toBe(2);
      proc.stop();
    });
  });
});

// ============================================================
// WindowOperator Tests - Comprehensive Coverage
// ============================================================
describe('WindowOperator', () => {
  // --- Constructor ---
  describe('constructor', () => {
    it('should create count-based with default slide', () => {
      const op = new WindowOperator<number>(3);
      expect(op).toBeDefined();
    });

    it('should create count-based with custom slide', () => {
      const op = new WindowOperator<number>(5, 2);
      expect(op).toBeDefined();
    });

    it('should create tumbling window (slide = windowSize)', () => {
      const op = new WindowOperator<number>(3, 3);
      op.add(1);
      op.add(2);
      const w = op.add(3);
      expect(w).toEqual([[1, 2, 3]]);
    });
  });

  // --- timeWindow static factory ---
  describe('timeWindow', () => {
    it('should create time-based window with default slide', () => {
      const op = WindowOperator.timeWindow<number>(1000);
      expect(op).toBeDefined();
    });

    it('should create time-based window with custom slide', () => {
      const op = WindowOperator.timeWindow<number>(1000, 500);
      expect(op).toBeDefined();
    });

    it('should emit time window after duration', async () => {
      const op = WindowOperator.timeWindow<number>(30, 30);
      op.add(1);
      op.add(2);
      await new Promise((r) => setTimeout(r, 50));
      const w = op.add(3);
      // After 50ms, both slide and window duration should have elapsed
      expect(w.length).toBeGreaterThanOrEqual(1);
    });
  });

  // --- add (count-based) ---
  describe('add (count-based)', () => {
    it('should emit window when full', () => {
      const op = new WindowOperator<number>(3);
      op.add(1);
      op.add(2);
      const windows = op.add(3);
      expect(windows).toEqual([[1, 2, 3]]);
    });

    it('should not emit partial window', () => {
      const op = new WindowOperator<number>(3);
      expect(op.add(1)).toEqual([]);
      expect(op.add(2)).toEqual([]);
    });

    it('should emit multiple tumbling windows', () => {
      const op = new WindowOperator<number>(2);
      op.add(1);
      op.add(2);
      op.add(3);
      op.add(4);
      expect(op.getStats().windowsEmitted).toBe(2);
    });

    it('should handle sliding windows (slide < window)', () => {
      const op = new WindowOperator<number>(3, 1);
      op.add(1);
      op.add(2);
      const w1 = op.add(3);
      expect(w1.length).toBe(1);
      expect(w1[0]).toEqual([1, 2, 3]);
      // After sliding by 1: currentWindow = [2, 3]
      const w2 = op.add(4);
      expect(w2.length).toBe(1);
      expect(w2[0]).toEqual([2, 3, 4]);
    });

    it('should handle sliding windows (slide = window) - tumbling', () => {
      const op = new WindowOperator<number>(2, 2);
      op.add(1);
      op.add(2);
      expect(op.getStats().windowsEmitted).toBe(1);
      op.add(3);
      op.add(4);
      expect(op.getStats().windowsEmitted).toBe(2);
    });

    // BUG-3: slideSize > windowSize - after fix, slideSize is clamped to windowSize
    it('should handle slideSize > windowSize (BUG-3 fix: slideSize clamped to windowSize)', () => {
      const op = new WindowOperator<number>(2, 3);
      // After fix: effectiveSlide = min(3, 2) = 2, so behaves like tumbling window
      op.add(1);
      const w = op.add(2);
      // windowSize=2, so window [1,2] is emitted when 2nd event is added
      expect(w.length).toBe(1);
      expect(w[0]).toEqual([1, 2]);
      // After fix: currentWindow is empty (slideSize effectively = windowSize = 2)
      expect(op.getStats().currentWindowSize).toBe(0);
    });

    // BUG-4: windowSize <= 0 - after fix, clamped to 1
    it('should handle windowSize=0 safely (BUG-4 fix: clamped to 1)', () => {
      const op = new WindowOperator<number>(0);
      // After fix: windowSize clamped to 1, so each event triggers a window
      const w = op.add(1);
      expect(w).toEqual([[1]]);
    });

    it('should handle windowSize=1', () => {
      const op = new WindowOperator<number>(1);
      const w = op.add(1);
      expect(w).toEqual([[1]]);
    });

    it('should handle negative windowSize safely (clamped to 1)', () => {
      const op = new WindowOperator<number>(-1);
      // After fix: windowSize clamped to 1, so each event triggers a window
      const w = op.add(1);
      expect(w).toEqual([[1]]);
    });

    it('should handle string events', () => {
      const op = new WindowOperator<string>(2);
      const w = op.add('a');
      expect(w).toEqual([]);
      const w2 = op.add('b');
      expect(w2).toEqual([['a', 'b']]);
    });

    it('should handle object events', () => {
      const op = new WindowOperator<{ x: number }>(2);
      op.add({ x: 1 });
      const w = op.add({ x: 2 });
      expect(w).toEqual([[{ x: 1 }, { x: 2 }]]);
    });
  });

  // --- flush ---
  describe('flush', () => {
    it('should flush remaining events', () => {
      const op = new WindowOperator<number>(5);
      op.add(1);
      op.add(2);
      const remaining = op.flush();
      expect(remaining).toEqual([1, 2]);
    });

    it('should flush empty window', () => {
      const op = new WindowOperator<number>(3);
      expect(op.flush()).toEqual([]);
    });

    it('should clear current window after flush', () => {
      const op = new WindowOperator<number>(5);
      op.add(1);
      op.flush();
      expect(op.getStats().currentWindowSize).toBe(0);
    });
  });

  // --- reset ---
  describe('reset', () => {
    it('should reset all state', () => {
      const op = new WindowOperator<number>(2);
      op.add(1);
      op.add(2);
      op.reset();
      expect(op.getStats().windowsEmitted).toBe(0);
      expect(op.getStats().eventsProcessed).toBe(0);
      expect(op.getStats().currentWindowSize).toBe(0);
    });
  });

  // --- getStats ---
  describe('getStats', () => {
    it('should return correct stats', () => {
      const op = new WindowOperator<number>(2);
      op.add(1);
      op.add(2);
      const stats = op.getStats();
      expect(stats.windowsEmitted).toBe(1);
      expect(stats.eventsProcessed).toBe(2);
      expect(stats.currentWindowSize).toBe(0);
    });

    it('should track currentWindowSize', () => {
      const op = new WindowOperator<number>(5);
      op.add(1);
      op.add(2);
      op.add(3);
      expect(op.getStats().currentWindowSize).toBe(3);
    });
  });
});

// ============================================================
// JoinOperator Tests - Comprehensive Coverage
// ============================================================
describe('JoinOperator', () => {
  interface LeftEvent { id: string; value: number; }
  interface RightEvent { id: string; label: string; }

  // --- Constructor ---
  describe('constructor', () => {
    it('should create with default windowMs (Infinity)', () => {
      const op = new JoinOperator<LeftEvent, RightEvent>({
        leftKey: (e) => e.id,
        rightKey: (e) => e.id,
      });
      expect(op).toBeDefined();
    });

    it('should create with custom windowMs', () => {
      const op = new JoinOperator<LeftEvent, RightEvent>({
        leftKey: (e) => e.id,
        rightKey: (e) => e.id,
        windowMs: 1000,
      });
      expect(op).toBeDefined();
    });

    it('should create with windowMs=0', () => {
      const op = new JoinOperator<LeftEvent, RightEvent>({
        leftKey: (e) => e.id,
        rightKey: (e) => e.id,
        windowMs: 0,
      });
      expect(op).toBeDefined();
    });
  });

  // --- addLeft / addRight ---
  describe('join matching', () => {
    it('should join matching events (left first)', () => {
      const op = new JoinOperator<LeftEvent, RightEvent>({
        leftKey: (e) => e.id,
        rightKey: (e) => e.id,
      });
      op.addLeft({ id: '1', value: 10 });
      op.addRight({ id: '1', label: 'a' });
      const joins = op.getJoins();
      expect(joins.length).toBe(1);
      expect(joins[0]!.left.value).toBe(10);
      expect(joins[0]!.right.label).toBe('a');
    });

    it('should join matching events (right first)', () => {
      const op = new JoinOperator<LeftEvent, RightEvent>({
        leftKey: (e) => e.id,
        rightKey: (e) => e.id,
      });
      op.addRight({ id: '1', label: 'a' });
      op.addLeft({ id: '1', value: 10 });
      expect(op.getJoins().length).toBe(1);
    });

    it('should not join non-matching events', () => {
      const op = new JoinOperator<LeftEvent, RightEvent>({
        leftKey: (e) => e.id,
        rightKey: (e) => e.id,
      });
      op.addLeft({ id: '1', value: 10 });
      op.addRight({ id: '2', label: 'b' });
      expect(op.getJoins().length).toBe(0);
    });

    it('should handle multiple joins', () => {
      const op = new JoinOperator<LeftEvent, RightEvent>({
        leftKey: (e) => e.id,
        rightKey: (e) => e.id,
      });
      op.addLeft({ id: '1', value: 10 });
      op.addLeft({ id: '2', value: 20 });
      op.addRight({ id: '1', label: 'a' });
      op.addRight({ id: '2', label: 'b' });
      expect(op.getJoins().length).toBe(2);
    });

    // BUG-6: Only first match is joined, rest remain unmatched
    it('should only join first match (1:1 join behavior)', () => {
      const op = new JoinOperator<LeftEvent, RightEvent>({
        leftKey: (e) => e.id,
        rightKey: (e) => e.id,
      });
      op.addRight({ id: '1', label: 'a' });
      op.addRight({ id: '1', label: 'b' }); // second right with same key
      op.addLeft({ id: '1', value: 10 });
      expect(op.getJoins().length).toBe(1);
      expect(op.getJoins()[0]!.right.label).toBe('a');
      expect(op.getRightUnmatched().length).toBe(1); // 'b' is unmatched
    });
  });

  // --- getLeftUnmatched / getRightUnmatched ---
  describe('unmatched', () => {
    it('should return left unmatched events', () => {
      const op = new JoinOperator<LeftEvent, RightEvent>({
        leftKey: (e) => e.id,
        rightKey: (e) => e.id,
      });
      op.addLeft({ id: '1', value: 10 });
      op.addRight({ id: '2', label: 'b' });
      const unmatched = op.getLeftUnmatched();
      expect(unmatched.length).toBe(1);
      expect(unmatched[0]!.id).toBe('1');
    });

    it('should return right unmatched events', () => {
      const op = new JoinOperator<LeftEvent, RightEvent>({
        leftKey: (e) => e.id,
        rightKey: (e) => e.id,
      });
      op.addRight({ id: '1', label: 'a' });
      op.addLeft({ id: '2', value: 20 });
      const unmatched = op.getRightUnmatched();
      expect(unmatched.length).toBe(1);
      expect(unmatched[0]!.id).toBe('1');
    });

    it('should return empty arrays for no unmatched', () => {
      const op = new JoinOperator<LeftEvent, RightEvent>({
        leftKey: (e) => e.id,
        rightKey: (e) => e.id,
      });
      expect(op.getLeftUnmatched()).toEqual([]);
      expect(op.getRightUnmatched()).toEqual([]);
      expect(op.getJoins()).toEqual([]);
    });
  });

  // --- window expiry ---
  describe('window expiry', () => {
    it('should expire events based on windowMs', async () => {
      const op = new JoinOperator<LeftEvent, RightEvent>({
        leftKey: (e) => e.id,
        rightKey: (e) => e.id,
        windowMs: 10,
      });
      op.addLeft({ id: '1', value: 10 });
      await new Promise((r) => setTimeout(r, 20));
      op.addRight({ id: '1', label: 'a' });
      expect(op.getJoins().length).toBe(0);
    });

    it('should not expire with windowMs=Infinity', async () => {
      const op = new JoinOperator<LeftEvent, RightEvent>({
        leftKey: (e) => e.id,
        rightKey: (e) => e.id,
        windowMs: Infinity,
      });
      op.addLeft({ id: '1', value: 10 });
      await new Promise((r) => setTimeout(r, 5));
      op.addRight({ id: '1', label: 'a' });
      expect(op.getJoins().length).toBe(1);
    });
  });

  // --- flush ---
  describe('flush', () => {
    it('should flush all buffers and joins', () => {
      const op = new JoinOperator<LeftEvent, RightEvent>({
        leftKey: (e) => e.id,
        rightKey: (e) => e.id,
      });
      op.addLeft({ id: '1', value: 10 });
      op.addRight({ id: '2', label: 'b' });
      op.flush();
      expect(op.getJoins().length).toBe(0);
      expect(op.getLeftUnmatched().length).toBe(0);
      expect(op.getRightUnmatched().length).toBe(0);
    });
  });

  // --- getStats ---
  describe('getStats', () => {
    it('should return correct stats', () => {
      const op = new JoinOperator<LeftEvent, RightEvent>({
        leftKey: (e) => e.id,
        rightKey: (e) => e.id,
      });
      op.addLeft({ id: '1', value: 10 });
      op.addRight({ id: '1', label: 'a' });
      op.addLeft({ id: '2', value: 20 });
      const stats = op.getStats();
      expect(stats.leftCount).toBe(2);
      expect(stats.rightCount).toBe(1);
      expect(stats.joinCount).toBe(1);
      expect(stats.leftUnmatched).toBe(1);
    });
  });
});

// ============================================================
// AggregationOperator Tests - Comprehensive Coverage
// ============================================================
describe('AggregationOperator', () => {
  let agg: AggregationOperator<number>;

  beforeEach(() => {
    agg = new AggregationOperator<number>();
  });

  // --- add / count ---
  describe('add/count', () => {
    it('should add and count events', () => {
      agg.add(1);
      agg.add(2);
      agg.add(3);
      expect(agg.count()).toBe(3);
    });

    it('should count zero events', () => {
      expect(agg.count()).toBe(0);
    });
  });

  // --- sum ---
  describe('sum', () => {
    it('should sum events', () => {
      agg.add(10);
      agg.add(20);
      agg.add(30);
      expect(agg.sum((n) => n)).toBe(60);
    });

    it('should sum with transform function', () => {
      agg.add(1);
      agg.add(2);
      agg.add(3);
      expect(agg.sum((n) => n * 10)).toBe(60);
    });

    it('should sum empty events', () => {
      expect(agg.sum((n) => n)).toBe(0);
    });

    it('should sum negative numbers', () => {
      agg.add(-5);
      agg.add(10);
      expect(agg.sum((n) => n)).toBe(5);
    });

    it('should sum floating point numbers', () => {
      agg.add(1.5);
      agg.add(2.5);
      expect(agg.sum((n) => n)).toBeCloseTo(4.0);
    });
  });

  // --- avg ---
  describe('avg', () => {
    it('should average events', () => {
      agg.add(10);
      agg.add(20);
      agg.add(30);
      expect(agg.avg((n) => n)).toBe(20);
    });

    it('should average zero events', () => {
      expect(agg.avg((n) => n)).toBe(0);
    });

    it('should average single event', () => {
      agg.add(42);
      expect(agg.avg((n) => n)).toBe(42);
    });
  });

  // --- min ---
  describe('min', () => {
    it('should find min', () => {
      agg.add(5);
      agg.add(1);
      agg.add(9);
      expect(agg.min((n) => n)).toBe(1);
    });

    it('should find min of zero events', () => {
      expect(agg.min((n) => n)).toBe(0);
    });

    it('should find min of negative numbers', () => {
      agg.add(-5);
      agg.add(-1);
      agg.add(-10);
      expect(agg.min((n) => n)).toBe(-10);
    });
  });

  // --- max ---
  describe('max', () => {
    it('should find max', () => {
      agg.add(5);
      agg.add(1);
      agg.add(9);
      expect(agg.max((n) => n)).toBe(9);
    });

    it('should find max of zero events', () => {
      expect(agg.max((n) => n)).toBe(0);
    });
  });

  // --- groupBy ---
  describe('groupBy', () => {
    it('should groupBy key', () => {
      agg.add(1);
      agg.add(2);
      agg.add(3);
      agg.add(4);
      const groups = agg.groupBy((n) => (n % 2 === 0 ? 'even' : 'odd'));
      expect(groups.get('odd')).toEqual([1, 3]);
      expect(groups.get('even')).toEqual([2, 4]);
    });

    it('should return empty groupBy for no events', () => {
      expect(agg.groupBy((n) => n).size).toBe(0);
    });

    it('should groupBy with string keys', () => {
      agg.add(1);
      agg.add(1);
      agg.add(2);
      const groups = agg.groupBy((n) => String(n));
      expect(groups.get('1')!.length).toBe(2);
      expect(groups.get('2')!.length).toBe(1);
    });
  });

  // --- distinct ---
  describe('distinct', () => {
    it('should return distinct values', () => {
      agg.add(1);
      agg.add(2);
      agg.add(1);
      agg.add(3);
      agg.add(2);
      expect(agg.distinct()).toEqual([1, 2, 3]);
    });

    it('should return distinct with key function', () => {
      agg.add(1);
      agg.add(-1);
      agg.add(2);
      agg.add(-2);
      expect(agg.distinct((n) => String(Math.abs(n)))).toEqual([1, 2]);
    });

    it('should return distinct for empty', () => {
      expect(agg.distinct()).toEqual([]);
    });

    it('should preserve insertion order', () => {
      agg.add(3);
      agg.add(1);
      agg.add(3);
      agg.add(2);
      expect(agg.distinct()).toEqual([3, 1, 2]);
    });
  });

  // --- topN ---
  describe('topN', () => {
    it('should return topN', () => {
      agg.add(3);
      agg.add(1);
      agg.add(4);
      agg.add(1);
      agg.add(5);
      expect(agg.topN(3, (n) => n)).toEqual([5, 4, 3]);
    });

    it('should return topN with fewer elements', () => {
      agg.add(1);
      agg.add(2);
      expect(agg.topN(5, (n) => n)).toEqual([2, 1]);
    });

    // BUG-8: topN with n<=0
    it('should return empty for topN with n=0', () => {
      agg.add(1);
      agg.add(2);
      expect(agg.topN(0, (n) => n)).toEqual([]);
    });

    it('should return all-but-last for topN with negative n (slice behavior)', () => {
      agg.add(1);
      agg.add(2);
      agg.add(3);
      // slice(0, -1) returns [1, 2] (all but last)
      const result = agg.topN(-1, (n) => n);
      expect(result).toEqual([3, 2]); // sorted desc, then slice(0, -1) removes last
    });

    it('should return empty for topN on empty data', () => {
      expect(agg.topN(3, (n) => n)).toEqual([]);
    });
  });

  // --- percentile ---
  describe('percentile', () => {
    it('should calculate p50', () => {
      for (let i = 1; i <= 100; i++) agg.add(i);
      expect(agg.percentile(50, (n) => n)).toBeCloseTo(50.5, 0);
    });

    it('should calculate p0', () => {
      agg.add(10);
      agg.add(20);
      agg.add(30);
      expect(agg.percentile(0, (n) => n)).toBe(10);
    });

    it('should calculate p100', () => {
      agg.add(10);
      agg.add(20);
      agg.add(30);
      expect(agg.percentile(100, (n) => n)).toBe(30);
    });

    it('should return 0 for empty', () => {
      expect(agg.percentile(50, (n) => n)).toBe(0);
    });

    it('should calculate p25', () => {
      agg.add(10);
      agg.add(20);
      agg.add(30);
      agg.add(40);
      expect(agg.percentile(25, (n) => n)).toBeCloseTo(17.5);
    });

    // BUG-9: percentile with p < 0 or p > 100 - after fix, clamped to [0, 100]
    it('should handle p < 0 (BUG-9 fix: clamped to 0)', () => {
      agg.add(10);
      agg.add(20);
      // After fix: p=-1 clamped to 0, so returns min value
      const result = agg.percentile(-1, (n) => n);
      expect(result).toBe(10);
    });

    it('should handle p > 100 (BUG-9 fix: clamped to 100)', () => {
      agg.add(10);
      agg.add(20);
      // After fix: p=101 clamped to 100, so returns max value
      const result = agg.percentile(101, (n) => n);
      expect(result).toBe(20);
    });

    it('should calculate percentile for single element', () => {
      agg.add(42);
      expect(agg.percentile(50, (n) => n)).toBe(42);
    });
  });

  // --- histogram ---
  describe('histogram', () => {
    it('should create histogram', () => {
      for (let i = 0; i < 10; i++) agg.add(i * 10);
      const hist = agg.histogram((n) => n, 5);
      expect(hist.length).toBe(5);
      expect(hist.reduce((sum, b) => sum + b.count, 0)).toBe(10);
    });

    it('should return empty histogram for no events', () => {
      expect(agg.histogram((n) => n, 5)).toEqual([]);
    });

    it('should handle histogram with single value', () => {
      agg.add(5);
      agg.add(5);
      agg.add(5);
      const hist = agg.histogram((n) => n, 3);
      expect(hist.length).toBe(1);
      expect(hist[0]!.count).toBe(3);
    });

    // BUG-10: bins <= 0 - after fix, clamped to 1
    it('should handle bins=0 (BUG-10 fix: clamped to 1)', () => {
      agg.add(1);
      agg.add(2);
      // After fix: bins clamped to 1, so single bin with all values
      const hist = agg.histogram((n) => n, 0);
      expect(hist.length).toBe(1);
      expect(hist[0]!.count).toBe(2);
    });

    it('should handle negative bins (BUG-10 fix: clamped to 1)', () => {
      agg.add(1);
      agg.add(2);
      const hist = agg.histogram((n) => n, -1);
      expect(hist.length).toBe(1);
      expect(hist[0]!.count).toBe(2);
    });

    it('should handle bins=1', () => {
      agg.add(1);
      agg.add(5);
      agg.add(10);
      const hist = agg.histogram((n) => n, 1);
      expect(hist.length).toBe(1);
      expect(hist[0]!.count).toBe(3);
    });

    it('should have correct bin boundaries', () => {
      agg.add(0);
      agg.add(5);
      agg.add(10);
      const hist = agg.histogram((n) => n, 2);
      expect(hist.length).toBe(2);
      expect(hist[0]!.min).toBe(0);
      expect(hist[0]!.max).toBe(5);
      expect(hist[1]!.min).toBe(5);
      expect(hist[1]!.max).toBe(10);
    });
  });

  // --- reset ---
  describe('reset', () => {
    it('should reset aggregation', () => {
      agg.add(1);
      agg.add(2);
      agg.reset();
      expect(agg.count()).toBe(0);
    });
  });

  // --- object events ---
  describe('object events', () => {
    it('should handle object events', () => {
      const objAgg = new AggregationOperator<{ val: number }>();
      objAgg.add({ val: 10 });
      objAgg.add({ val: 20 });
      objAgg.add({ val: 30 });
      expect(objAgg.sum((o) => o.val)).toBe(60);
      expect(objAgg.avg((o) => o.val)).toBe(20);
    });
  });
});

// ============================================================
// BackpressureHandler Tests - Comprehensive Coverage
// ============================================================
describe('BackpressureHandler', () => {
  // --- Constructor ---
  describe('constructor', () => {
    it('should create with default options', () => {
      const bp = new BackpressureHandler({ maxPending: 100 });
      expect(bp).toBeDefined();
    });

    it('should create with custom options', () => {
      const bp = new BackpressureHandler({
        maxPending: 50,
        highWatermark: 40,
        lowWatermark: 10,
        strategy: 'drop',
      });
      expect(bp).toBeDefined();
    });

    it('should calculate default watermarks from maxPending', () => {
      const bp = new BackpressureHandler({ maxPending: 100 });
      // highWatermark = floor(100 * 0.8) = 80
      // lowWatermark = floor(100 * 0.3) = 30
      for (let i = 0; i < 80; i++) bp.push(i);
      expect(bp.isUnderPressure()).toBe(true);
    });

    // BUG-11: maxPending=0 - after fix, clamped to 1
    it('should handle maxPending=0 (BUG-11 fix: clamped to 1)', () => {
      const bp = new BackpressureHandler({ maxPending: 0, strategy: 'drop' });
      // After fix: maxPending clamped to 1, so first push succeeds
      expect(bp.push('a')).toBe(true);
      expect(bp.push('b')).toBe(false); // second push exceeds maxPending=1
      expect(bp.getStats().dropped).toBe(1);
    });
  });

  // --- push / pull ---
  describe('push/pull', () => {
    it('should push events', () => {
      const bp = new BackpressureHandler({ maxPending: 100 });
      expect(bp.push('event1')).toBe(true);
      expect(bp.push('event2')).toBe(true);
      expect(bp.getPendingCount()).toBe(2);
    });

    it('should pull events in FIFO order', () => {
      const bp = new BackpressureHandler({ maxPending: 100 });
      bp.push('event1');
      bp.push('event2');
      expect(bp.pull()).toBe('event1');
      expect(bp.pull()).toBe('event2');
    });

    it('should pull undefined from empty queue', () => {
      const bp = new BackpressureHandler({ maxPending: 100 });
      expect(bp.pull()).toBeUndefined();
    });

    it('should apply backpressure with drop strategy', () => {
      const bp = new BackpressureHandler({ maxPending: 3, strategy: 'drop' });
      expect(bp.push('a')).toBe(true);
      expect(bp.push('b')).toBe(true);
      expect(bp.push('c')).toBe(true);
      expect(bp.push('d')).toBe(false);
      expect(bp.getPendingCount()).toBe(3);
    });

    it('should throw with error strategy', () => {
      const bp = new BackpressureHandler({ maxPending: 2, strategy: 'error' });
      bp.push('a');
      bp.push('b');
      expect(() => bp.push('c')).toThrow('Backpressure: max pending exceeded');
    });

    it('should accept events with buffer strategy beyond max', () => {
      const bp = new BackpressureHandler({ maxPending: 2, strategy: 'buffer' });
      expect(bp.push('a')).toBe(true);
      expect(bp.push('b')).toBe(true);
      expect(bp.push('c')).toBe(true);
      expect(bp.getPendingCount()).toBe(3);
    });

    it('should push null and undefined', () => {
      const bp = new BackpressureHandler({ maxPending: 100 });
      expect(bp.push(null)).toBe(true);
      expect(bp.push(undefined)).toBe(true);
      expect(bp.getPendingCount()).toBe(2);
    });
  });

  // --- pressure state ---
  describe('pressure state', () => {
    it('should not be under pressure initially', () => {
      const bp = new BackpressureHandler({ maxPending: 100 });
      expect(bp.isUnderPressure()).toBe(false);
    });

    it('should detect under pressure state', () => {
      const bp = new BackpressureHandler({
        maxPending: 10,
        highWatermark: 5,
        lowWatermark: 2,
        strategy: 'drop',
      });
      for (let i = 0; i < 5; i++) bp.push(i);
      expect(bp.isUnderPressure()).toBe(true);
    });

    it('should recover from pressure state', () => {
      const bp = new BackpressureHandler({
        maxPending: 10,
        highWatermark: 5,
        lowWatermark: 2,
        strategy: 'drop',
      });
      for (let i = 0; i < 5; i++) bp.push(i);
      expect(bp.isUnderPressure()).toBe(true);
      bp.pull();
      bp.pull();
      bp.pull();
      expect(bp.isUnderPressure()).toBe(false);
    });
  });

  // --- getStats ---
  describe('getStats', () => {
    it('should return correct stats', () => {
      const bp = new BackpressureHandler({ maxPending: 5, strategy: 'drop' });
      bp.push('a');
      bp.push('b');
      bp.pull();
      const stats = bp.getStats();
      expect(stats.pending).toBe(1);
      expect(stats.totalPushed).toBe(2);
      expect(stats.totalPulled).toBe(1);
      expect(stats.dropped).toBe(0);
    });

    it('should track dropped events', () => {
      const bp = new BackpressureHandler({ maxPending: 2, strategy: 'drop' });
      bp.push('a');
      bp.push('b');
      bp.push('c');
      expect(bp.getStats().dropped).toBe(1);
    });

    it('should calculate pressureRatio', () => {
      const bp = new BackpressureHandler({ maxPending: 10 });
      bp.push('a');
      bp.push('b');
      expect(bp.getStats().pressureRatio).toBeCloseTo(0.2);
    });

    it('should handle pressureRatio with maxPending=0', () => {
      const bp = new BackpressureHandler({ maxPending: 0 });
      expect(bp.getStats().pressureRatio).toBe(0);
    });
  });
});

// ============================================================
// StreamReplay Tests - Comprehensive Coverage
// ============================================================
describe('StreamReplay', () => {
  let replay: StreamReplay<number>;

  beforeEach(() => {
    replay = new StreamReplay<number>();
  });

  // --- record ---
  describe('record', () => {
    it('should record events from a stream', () => {
      const stream = new EventStream<number>();
      replay.record(stream);
      stream.publish(1);
      stream.publish(2);
      stream.publish(3);
      expect(replay.getRecordedEvents()).toEqual([1, 2, 3]);
    });

    it('should clear previous recording on new record', () => {
      const stream = new EventStream<number>();
      replay.record(stream);
      stream.publish(1);
      replay.record(stream);
      stream.publish(2);
      expect(replay.getRecordedEvents()).toEqual([2]);
    });
  });

  // --- stopRecording ---
  describe('stopRecording', () => {
    it('should stop recording and return events', () => {
      const stream = new EventStream<number>();
      replay.record(stream);
      stream.publish(1);
      stream.publish(2);
      const events = replay.stopRecording();
      expect(events).toEqual([1, 2]);
    });

    it('should not record after stop', () => {
      const stream = new EventStream<number>();
      replay.record(stream);
      stream.publish(1);
      replay.stopRecording();
      stream.publish(2);
      expect(replay.getRecordedEvents()).toEqual([1]);
    });

    it('should handle stop when not recording', () => {
      expect(replay.stopRecording()).toEqual([]);
    });
  });

  // --- replay ---
  describe('replay', () => {
    it('should replay events', async () => {
      const stream = replay.replay([1, 2, 3]);
      await new Promise((r) => setTimeout(r, 50));
      expect(stream.getEvents()).toEqual([1, 2, 3]);
    });

    it('should replay empty events', () => {
      const stream = replay.replay([]);
      expect(stream.getEventCount()).toBe(0);
    });

    it('should replay events with speed > 1', async () => {
      const stream = replay.replay([1, 2, 3], 2);
      await new Promise((r) => setTimeout(r, 50));
      expect(stream.getEvents()).toEqual([1, 2, 3]);
    });

    it('should replay events with speed < 1', async () => {
      const stream = replay.replay([1, 2], 0.5);
      await new Promise((r) => setTimeout(r, 100));
      expect(stream.getEvents()).toEqual([1, 2]);
    });

    // BUG-12: speed <= 0 publishes synchronously
    it('should handle speed=0 (publishes synchronously)', () => {
      const stream = replay.replay([1, 2, 3], 0);
      expect(stream.getEvents()).toEqual([1, 2, 3]);
    });

    it('should handle negative speed (publishes synchronously)', () => {
      const stream = replay.replay([1, 2, 3], -1);
      expect(stream.getEvents()).toEqual([1, 2, 3]);
    });

    it('should return a new EventStream', () => {
      const stream = replay.replay([1]);
      expect(stream).toBeInstanceOf(EventStream);
    });
  });

  // --- replayRange ---
  describe('replayRange', () => {
    it('should replay range of events', () => {
      const stream = new EventStream<number>();
      replay.record(stream);
      for (let i = 0; i < 10; i++) stream.publish(i);
      replay.stopRecording();
      expect(replay.replayRange(3, 7)).toEqual([3, 4, 5, 6]);
    });

    it('should handle out of bounds range', () => {
      const stream = new EventStream<number>();
      replay.record(stream);
      stream.publish(1);
      stream.publish(2);
      replay.stopRecording();
      expect(replay.replayRange(1, 10)).toEqual([2]);
    });

    it('should handle negative start', () => {
      const stream = new EventStream<number>();
      replay.record(stream);
      stream.publish(1);
      stream.publish(2);
      replay.stopRecording();
      // slice(-1, 2) = [2]
      expect(replay.replayRange(-1, 2)).toEqual([2]);
    });

    it('should handle empty range', () => {
      expect(replay.replayRange(0, 0)).toEqual([]);
    });
  });

  // --- seek ---
  describe('seek', () => {
    it('should seek events by timestamp', async () => {
      const stream = new EventStream<number>();
      replay.record(stream);
      stream.publish(1);
      await new Promise((r) => setTimeout(r, 10));
      const seekTime = Date.now();
      await new Promise((r) => setTimeout(r, 10));
      stream.publish(2);
      stream.publish(3);
      const seeked = replay.seek(seekTime);
      expect(seeked.length).toBeGreaterThanOrEqual(1);
    });

    it('should return empty seek for future timestamp', () => {
      expect(replay.seek(Date.now() + 100000)).toEqual([]);
    });

    it('should return all events for timestamp=0', () => {
      const stream = new EventStream<number>();
      replay.record(stream);
      stream.publish(1);
      stream.publish(2);
      replay.stopRecording();
      expect(replay.seek(0).length).toBe(2);
    });
  });

  // --- getStats ---
  describe('getStats', () => {
    it('should return stats', () => {
      const stream = new EventStream<number>();
      replay.record(stream);
      stream.publish(1);
      stream.publish(2);
      const stats = replay.getStats();
      expect(stats.totalRecorded).toBe(2);
      expect(stats.replayCount).toBe(0);
    });

    it('should track replayCount', async () => {
      const stream = replay.replay([1, 2, 3]);
      await new Promise((r) => setTimeout(r, 50));
      expect(replay.getStats().replayCount).toBe(3);
    });

    it('should track recordingDuration', () => {
      const stream = new EventStream<number>();
      replay.record(stream);
      const stats = replay.getStats();
      expect(stats.recordingDuration).toBeGreaterThanOrEqual(0);
    });
  });

  // --- getRecordedEvents ---
  describe('getRecordedEvents', () => {
    it('should return recorded events', () => {
      const stream = new EventStream<number>();
      replay.record(stream);
      stream.publish(10);
      stream.publish(20);
      expect(replay.getRecordedEvents()).toEqual([10, 20]);
    });

    it('should return empty for no recording', () => {
      expect(replay.getRecordedEvents()).toEqual([]);
    });
  });
});

// ============================================================
// StreamCircuitBreaker Tests - Comprehensive Coverage
// ============================================================
describe('StreamCircuitBreaker', () => {
  let cb: StreamCircuitBreaker;

  beforeEach(() => {
    cb = new StreamCircuitBreaker({ failureThreshold: 3, recoveryTimeout: 100 });
  });

  // --- Constructor ---
  describe('constructor', () => {
    it('should create with default options', () => {
      const breaker = new StreamCircuitBreaker();
      expect(breaker.getState()).toBe('closed');
    });

    it('should create with custom options', () => {
      const breaker = new StreamCircuitBreaker({
        failureThreshold: 5,
        recoveryTimeout: 1000,
        halfOpenMaxCalls: 2,
      });
      expect(breaker).toBeDefined();
    });
  });

  // --- State transitions ---
  describe('state transitions', () => {
    it('should start in closed state', () => {
      expect(cb.getState()).toBe('closed');
    });

    it('should process events in closed state', async () => {
      const result = await cb.process('event', async (e) => `processed-${e}`);
      expect(result).toBe('processed-event');
    });

    it('should transition to open after failures', async () => {
      for (let i = 0; i < 3; i++) {
        try { await cb.process('event', async () => { throw new Error('fail'); }); } catch { /* expected */ }
      }
      expect(cb.getState()).toBe('open');
    });

    it('should reject events in open state', async () => {
      for (let i = 0; i < 3; i++) {
        try { await cb.process('event', async () => { throw new Error('fail'); }); } catch { /* expected */ }
      }
      await expect(cb.process('event', async () => 'ok')).rejects.toThrow('Circuit breaker is open');
    });

    it('should transition to half-open after recovery timeout', async () => {
      for (let i = 0; i < 3; i++) {
        try { await cb.process('event', async () => { throw new Error('fail'); }); } catch { /* expected */ }
      }
      await new Promise((r) => setTimeout(r, 150));
      expect(cb.getState()).toBe('half-open');
    });

    it('should transition back to closed after successful half-open calls', async () => {
      for (let i = 0; i < 3; i++) {
        try { await cb.process('event', async () => { throw new Error('fail'); }); } catch { /* expected */ }
      }
      await new Promise((r) => setTimeout(r, 150));
      await cb.process('event', async () => 'ok');
      await cb.process('event', async () => 'ok');
      await cb.process('event', async () => 'ok');
      expect(cb.getState()).toBe('closed');
    });

    it('should transition back to open on half-open failure', async () => {
      for (let i = 0; i < 3; i++) {
        try { await cb.process('event', async () => { throw new Error('fail'); }); } catch { /* expected */ }
      }
      await new Promise((r) => setTimeout(r, 150));
      try { await cb.process('event', async () => { throw new Error('fail again'); }); } catch { /* expected */ }
      expect(cb.getState()).toBe('open');
    });

    it('should reset failures on success in closed state', async () => {
      try { await cb.process('event', async () => { throw new Error('fail'); }); } catch { /* expected */ }
      expect(cb.getStats().failures).toBe(1);
      await cb.process('event', async () => 'ok');
      expect(cb.getStats().failures).toBe(0);
    });

    it('should not reset failures in half-open state on success', async () => {
      for (let i = 0; i < 3; i++) {
        try { await cb.process('event', async () => { throw new Error('fail'); }); } catch { /* expected */ }
      }
      await new Promise((r) => setTimeout(r, 150));
      await cb.process('event', async () => 'ok');
      // failures should still be 3 (not reset in half-open)
      expect(cb.getStats().failures).toBe(3);
    });
  });

  // --- getStats ---
  describe('getStats', () => {
    it('should return stats', async () => {
      await cb.process('event', async () => 'ok');
      const stats = cb.getStats();
      expect(stats.state).toBe('closed');
      expect(stats.successes).toBe(1);
      expect(stats.failures).toBe(0);
    });

    it('should track lastFailure', async () => {
      try { await cb.process('event', async () => { throw new Error('test'); }); } catch { /* expected */ }
      expect(cb.getStats().lastFailure).toBeGreaterThan(0);
    });

    it('should track lastSuccess', async () => {
      await cb.process('event', async () => 'ok');
      expect(cb.getStats().lastSuccess).toBeGreaterThan(0);
    });

    it('should have undefined lastFailure/lastSuccess initially', () => {
      const breaker = new StreamCircuitBreaker();
      expect(breaker.getStats().lastFailure).toBeUndefined();
      expect(breaker.getStats().lastSuccess).toBeUndefined();
    });
  });

  // --- reset ---
  describe('reset', () => {
    it('should reset the circuit breaker', async () => {
      try { await cb.process('event', async () => { throw new Error('fail'); }); } catch { /* expected */ }
      cb.reset();
      expect(cb.getState()).toBe('closed');
      expect(cb.getStats().failures).toBe(0);
      expect(cb.getStats().successes).toBe(0);
    });
  });

  // --- onStateChange ---
  describe('onStateChange', () => {
    it('should call state change handlers', async () => {
      const states: string[] = [];
      cb.onStateChange((state) => states.push(state));
      for (let i = 0; i < 3; i++) {
        try { await cb.process('event', async () => { throw new Error('fail'); }); } catch { /* expected */ }
      }
      expect(states).toContain('open');
    });

    it('should call multiple handlers', async () => {
      const states1: string[] = [];
      const states2: string[] = [];
      cb.onStateChange((state) => states1.push(state));
      cb.onStateChange((state) => states2.push(state));
      for (let i = 0; i < 3; i++) {
        try { await cb.process('event', async () => { throw new Error('fail'); }); } catch { /* expected */ }
      }
      expect(states1).toContain('open');
      expect(states2).toContain('open');
    });

    it('should track closed -> half-open -> closed transitions', async () => {
      const states: string[] = [];
      cb.onStateChange((state) => states.push(state));
      for (let i = 0; i < 3; i++) {
        try { await cb.process('event', async () => { throw new Error('fail'); }); } catch { /* expected */ }
      }
      await new Promise((r) => setTimeout(r, 150));
      // getState triggers checkStateTransition -> half-open
      cb.getState();
      await cb.process('event', async () => 'ok');
      await cb.process('event', async () => 'ok');
      await cb.process('event', async () => 'ok');
      expect(states).toContain('open');
      expect(states).toContain('half-open');
      expect(states).toContain('closed');
    });
  });

  // --- Edge cases ---
  describe('edge cases', () => {
    it('should handle failureThreshold=1', async () => {
      const breaker = new StreamCircuitBreaker({ failureThreshold: 1, recoveryTimeout: 50 });
      try { await breaker.process('e', async () => { throw new Error('fail'); }); } catch { /* expected */ }
      expect(breaker.getState()).toBe('open');
    });

    it('should handle halfOpenMaxCalls=1', async () => {
      const breaker = new StreamCircuitBreaker({ failureThreshold: 1, recoveryTimeout: 50, halfOpenMaxCalls: 1 });
      try { await breaker.process('e', async () => { throw new Error('fail'); }); } catch { /* expected */ }
      await new Promise((r) => setTimeout(r, 60));
      await breaker.process('e', async () => 'ok');
      expect(breaker.getState()).toBe('closed');
    });

    it('should handle recoveryTimeout=0', async () => {
      const breaker = new StreamCircuitBreaker({ failureThreshold: 1, recoveryTimeout: 0 });
      try { await breaker.process('e', async () => { throw new Error('fail'); }); } catch { /* expected */ }
      // Should immediately transition to half-open
      expect(breaker.getState()).toBe('half-open');
    });
  });
});

// ============================================================
// StreamMetrics Tests - Comprehensive Coverage
// ============================================================
describe('StreamMetrics', () => {
  let metrics: StreamMetrics;

  beforeEach(() => {
    metrics = new StreamMetrics();
  });

  // --- recordProcessing ---
  describe('recordProcessing', () => {
    it('should record processing', () => {
      metrics.recordProcessing('stream1', 10, true);
      metrics.recordProcessing('stream1', 20, true);
      expect(metrics.getStreamMetrics('stream1').totalProcessed).toBe(2);
    });

    it('should record processing failures', () => {
      metrics.recordProcessing('stream1', 10, false);
      expect(metrics.getStreamMetrics('stream1').errorRate).toBe(1);
    });

    it('should keep only last 1000 processing times', () => {
      for (let i = 0; i < 1100; i++) {
        metrics.recordProcessing('stream1', i, true);
      }
      expect(metrics.getStreamMetrics('stream1').totalProcessed).toBe(1100);
      // processingTimes capped at 1000
    });

    it('should handle duration=0', () => {
      metrics.recordProcessing('stream1', 0, true);
      expect(metrics.getStreamMetrics('stream1').totalProcessed).toBe(1);
    });

    it('should handle negative duration', () => {
      metrics.recordProcessing('stream1', -5, true);
      expect(metrics.getStreamMetrics('stream1').totalProcessed).toBe(1);
    });
  });

  // --- recordThroughput ---
  describe('recordThroughput', () => {
    it('should record throughput', () => {
      metrics.recordThroughput('stream1', 100, 1000);
      expect(metrics.getStreamMetrics('stream1').throughput).toBe(100);
    });

    it('should keep only last 100 throughput records', () => {
      for (let i = 0; i < 110; i++) {
        metrics.recordThroughput('stream1', i, 1000);
      }
      // Should not throw
      expect(metrics.getStreamMetrics('stream1').throughput).toBeGreaterThan(0);
    });
  });

  // --- recordLatency ---
  describe('recordLatency', () => {
    it('should record latency', () => {
      metrics.recordLatency('stream1', 5);
      metrics.recordLatency('stream1', 15);
      expect(metrics.getStreamMetrics('stream1').avgLatency).toBe(10);
    });

    it('should keep only last 1000 latencies', () => {
      for (let i = 0; i < 1100; i++) {
        metrics.recordLatency('stream1', i);
      }
      expect(metrics.getStreamMetrics('stream1').avgLatency).toBeGreaterThan(0);
    });
  });

  // --- recordError ---
  describe('recordError', () => {
    it('should record error and create alert', () => {
      metrics.recordError('stream1', new Error('test error'));
      const alerts = metrics.getAlerts();
      expect(alerts.length).toBe(1);
      expect(alerts[0]!.type).toBe('error');
      expect(alerts[0]!.streamId).toBe('stream1');
      expect(alerts[0]!.severity).toBe('high');
    });

    it('should limit alerts to 100', () => {
      for (let i = 0; i < 110; i++) {
        metrics.recordError('stream1', new Error(`error-${i}`));
      }
      expect(metrics.getAlerts().length).toBeLessThanOrEqual(100);
    });

    it('should include timestamp in alerts', () => {
      metrics.recordError('stream1', new Error('test'));
      expect(metrics.getAlerts()[0]!.timestamp).toBeGreaterThan(0);
    });

    it('should include message in alerts', () => {
      metrics.recordError('stream1', new Error('specific message'));
      expect(metrics.getAlerts()[0]!.message).toBe('specific message');
    });
  });

  // --- getStreamMetrics ---
  describe('getStreamMetrics', () => {
    it('should return zero metrics for unknown stream', () => {
      const m = metrics.getStreamMetrics('unknown');
      expect(m.throughput).toBe(0);
      expect(m.avgLatency).toBe(0);
      expect(m.p99Latency).toBe(0);
      expect(m.errorRate).toBe(0);
      expect(m.totalProcessed).toBe(0);
    });

    it('should calculate p99 latency', () => {
      for (let i = 1; i <= 100; i++) {
        metrics.recordLatency('stream1', i);
      }
      expect(metrics.getStreamMetrics('stream1').p99Latency).toBeGreaterThanOrEqual(99);
    });

    it('should return zero avgLatency for no latency data', () => {
      metrics.recordProcessing('stream1', 10, true);
      expect(metrics.getStreamMetrics('stream1').avgLatency).toBe(0);
    });

    it('should return zero throughput for no throughput data', () => {
      metrics.recordProcessing('stream1', 10, true);
      expect(metrics.getStreamMetrics('stream1').throughput).toBe(0);
    });

    // BUG-13: p99 with single latency value
    it('should handle p99 with single latency value', () => {
      metrics.recordLatency('stream1', 42);
      expect(metrics.getStreamMetrics('stream1').p99Latency).toBe(42);
    });
  });

  // --- getAllMetrics ---
  describe('getAllMetrics', () => {
    it('should get all metrics', () => {
      metrics.recordProcessing('stream1', 10, true);
      metrics.recordProcessing('stream2', 20, true);
      const all = metrics.getAllMetrics();
      expect(Object.keys(all).length).toBe(2);
    });

    it('should return empty object for no streams', () => {
      expect(metrics.getAllMetrics()).toEqual({});
    });
  });

  // --- getDashboard ---
  describe('getDashboard', () => {
    it('should get dashboard', () => {
      metrics.recordProcessing('stream1', 10, true);
      metrics.recordProcessing('stream2', 20, false);
      const dashboard = metrics.getDashboard();
      expect(dashboard.streams).toBe(2);
      expect(dashboard.totalThroughput).toBeDefined();
      expect(dashboard.avgErrorRate).toBeDefined();
      expect(dashboard.topErrors).toBeDefined();
    });

    it('should return empty dashboard for no streams', () => {
      const dashboard = metrics.getDashboard();
      expect(dashboard.streams).toBe(0);
      expect(dashboard.topErrors).toEqual([]);
    });

    it('should calculate average error rate across streams', () => {
      metrics.recordProcessing('s1', 10, true);
      metrics.recordProcessing('s1', 10, false);
      metrics.recordProcessing('s2', 10, true);
      metrics.recordProcessing('s2', 10, true);
      expect(metrics.getDashboard().avgErrorRate).toBeCloseTo(0.25);
    });

    it('should sort topErrors by error count', () => {
      for (let i = 0; i < 5; i++) metrics.recordError('stream1', new Error('e'));
      for (let i = 0; i < 2; i++) metrics.recordError('stream2', new Error('e'));
      const dashboard = metrics.getDashboard();
      expect(dashboard.topErrors[0]!.streamId).toBe('stream1');
      expect(dashboard.topErrors[0]!.errorCount).toBe(5);
    });

    it('should limit topErrors to 10', () => {
      for (let i = 0; i < 15; i++) {
        metrics.recordError(`stream${i}`, new Error('e'));
      }
      expect(metrics.getDashboard().topErrors.length).toBe(10);
    });
  });

  // --- getAlerts ---
  describe('getAlerts', () => {
    it('should return empty alerts initially', () => {
      expect(metrics.getAlerts()).toEqual([]);
    });

    it('should return copy of alerts', () => {
      metrics.recordError('stream1', new Error('test'));
      const alerts1 = metrics.getAlerts();
      const alerts2 = metrics.getAlerts();
      expect(alerts1).not.toBe(alerts2);
      expect(alerts1.length).toBe(alerts2.length);
    });
  });

  // --- reset ---
  describe('reset', () => {
    it('should reset metrics', () => {
      metrics.recordProcessing('stream1', 10, true);
      metrics.recordError('stream1', new Error('test'));
      metrics.reset();
      expect(metrics.getStreamMetrics('stream1').totalProcessed).toBe(0);
      expect(metrics.getAlerts()).toEqual([]);
    });
  });

  // --- Multiple streams ---
  describe('multiple streams', () => {
    it('should track streams independently', () => {
      metrics.recordProcessing('s1', 10, true);
      metrics.recordProcessing('s2', 20, false);
      metrics.recordProcessing('s2', 30, true);
      expect(metrics.getStreamMetrics('s1').totalProcessed).toBe(1);
      expect(metrics.getStreamMetrics('s2').totalProcessed).toBe(2);
    });
  });
});

// ============================================================
// StreamScheduler Tests - Comprehensive Coverage
// ============================================================
describe('StreamScheduler', () => {
  let scheduler: StreamScheduler;

  beforeEach(() => {
    scheduler = new StreamScheduler();
  });

  afterEach(() => {
    scheduler.stop();
  });

  // --- scheduleStream ---
  describe('scheduleStream', () => {
    it('should schedule a stream', () => {
      const source = new EventStream<number>();
      const proc = new StreamProcessor<number, number>();
      const id = scheduler.scheduleStream('test', source, proc);
      expect(id).toBeDefined();
      expect(id).toMatch(/^sched-\d+$/);
    });

    it('should schedule with custom interval', () => {
      const source = new EventStream<number>();
      const proc = new StreamProcessor<number, number>();
      const id = scheduler.scheduleStream('test', source, proc, 500);
      expect(id).toBeDefined();
    });

    it('should auto-start scheduled stream if scheduler is running', () => {
      scheduler.start();
      const source = new EventStream<number>();
      const proc = new StreamProcessor<number, number>();
      const id = scheduler.scheduleStream('test', source, proc);
      expect(id).toBeDefined();
      const streams = scheduler.getScheduledStreams();
      expect(streams.length).toBe(1);
    });
  });

  // --- unschedule ---
  describe('unschedule', () => {
    it('should unschedule a stream', () => {
      const source = new EventStream<number>();
      const proc = new StreamProcessor<number, number>();
      const id = scheduler.scheduleStream('test', source, proc);
      expect(scheduler.unschedule(id)).toBe(true);
    });

    it('should return false for invalid id', () => {
      expect(scheduler.unschedule('invalid')).toBe(false);
    });
  });

  // --- pause / resume ---
  describe('pause/resume', () => {
    it('should pause a scheduled stream', () => {
      const source = new EventStream<number>();
      const proc = new StreamProcessor<number, number>();
      const id = scheduler.scheduleStream('test', source, proc);
      scheduler.start();
      scheduler.pause(id);
      expect(scheduler.getScheduledStreams()[0]).toHaveProperty('paused', true);
    });

    it('should resume a paused stream', () => {
      const source = new EventStream<number>();
      const proc = new StreamProcessor<number, number>();
      const id = scheduler.scheduleStream('test', source, proc);
      scheduler.start();
      scheduler.pause(id);
      scheduler.resume(id);
      expect(scheduler.getScheduledStreams()[0]).toHaveProperty('paused', false);
    });

    it('should handle pause with invalid id', () => {
      expect(() => scheduler.pause('invalid')).not.toThrow();
    });

    it('should handle resume with invalid id', () => {
      expect(() => scheduler.resume('invalid')).not.toThrow();
    });

    // BUG-14: multiple pause/resume - after fix, no duplicate subscriptions
    it('should handle multiple pause/resume cycles without duplicate subscriptions', async () => {
      const source = new EventStream<number>();
      const proc = new StreamProcessor<number, number>();
      proc.pipe((n) => n * 2);
      const id = scheduler.scheduleStream('test', source, proc);
      scheduler.start();
      scheduler.pause(id);
      scheduler.resume(id);
      scheduler.pause(id);
      scheduler.resume(id);
      source.publish(1);
      await new Promise((r) => setTimeout(r, 50));
      // After fix: only one subscription, so event processed exactly once
      expect(proc.getOutputStream().getEvents()).toEqual([2]);
    });
  });

  // --- getScheduledStreams ---
  describe('getScheduledStreams', () => {
    it('should return scheduled streams', () => {
      const source = new EventStream<number>();
      const proc = new StreamProcessor<number, number>();
      scheduler.scheduleStream('test1', source, proc);
      scheduler.scheduleStream('test2', source, proc);
      expect(scheduler.getScheduledStreams().length).toBe(2);
    });

    it('should return empty initially', () => {
      expect(scheduler.getScheduledStreams()).toEqual([]);
    });

    it('should include stream metadata', () => {
      const source = new EventStream<number>();
      const proc = new StreamProcessor<number, number>();
      scheduler.scheduleStream('test', source, proc, 500);
      const streams = scheduler.getScheduledStreams();
      expect(streams[0]).toHaveProperty('id');
      expect(streams[0]).toHaveProperty('name', 'test');
      expect(streams[0]).toHaveProperty('intervalMs', 500);
      expect(streams[0]).toHaveProperty('paused', false);
      expect(streams[0]).toHaveProperty('processed');
      expect(streams[0]).toHaveProperty('errors');
    });
  });

  // --- start / stop ---
  describe('start/stop', () => {
    it('should start the scheduler', () => {
      scheduler.start();
      expect(scheduler.getStats().activeStreams).toBe(0);
    });

    it('should stop the scheduler', () => {
      const source = new EventStream<number>();
      const proc = new StreamProcessor<number, number>();
      scheduler.scheduleStream('test', source, proc);
      scheduler.start();
      scheduler.stop();
      expect(scheduler.getStats().activeStreams).toBe(1);
    });

    it('should process events when started', async () => {
      const source = new EventStream<number>();
      const proc = new StreamProcessor<number, number>();
      proc.pipe((n) => n * 2);
      scheduler.scheduleStream('test', source, proc);
      scheduler.start();
      source.publish(5);
      await new Promise((r) => setTimeout(r, 50));
      expect(proc.getOutputStream().getEvents()).toEqual([10]);
    });
  });

  // --- getStats ---
  describe('getStats', () => {
    it('should return stats', () => {
      const stats = scheduler.getStats();
      expect(stats).toHaveProperty('activeStreams');
      expect(stats).toHaveProperty('totalProcessed');
      expect(stats).toHaveProperty('errors');
    });

    it('should return zero stats initially', () => {
      expect(scheduler.getStats()).toEqual({
        activeStreams: 0,
        totalProcessed: 0,
        errors: 0,
      });
    });
  });
});

// ============================================================
// Integration Tests - Comprehensive
// ============================================================
describe('Integration', () => {
  it('should pipe EventStream through StreamProcessor', async () => {
    const input = new EventStream<number>();
    const proc = new StreamProcessor<number, string>();
    proc.pipe((n) => `result-${n}`);
    proc.input(input);
    proc.start();
    input.publish(1);
    input.publish(2);
    await new Promise((r) => setTimeout(r, 20));
    expect(proc.getOutputStream().getEvents()).toEqual(['result-1', 'result-2']);
    proc.stop();
  });

  it('should use AggregationOperator with EventStream', () => {
    const stream = new EventStream<number>();
    const agg = new AggregationOperator<number>();
    stream.subscribe((e) => agg.add(e));
    stream.publish(10);
    stream.publish(20);
    stream.publish(30);
    expect(agg.sum((n) => n)).toBe(60);
    expect(agg.count()).toBe(3);
  });

  it('should use WindowOperator with EventStream', () => {
    const stream = new EventStream<number>();
    const window = new WindowOperator<number>(2);
    stream.subscribe((e) => window.add(e));
    stream.publish(1);
    stream.publish(2);
    stream.publish(3);
    stream.publish(4);
    expect(window.getStats().windowsEmitted).toBe(2);
  });

  it('should use BackpressureHandler with EventStream', () => {
    const stream = new EventStream<number>();
    const bp = new BackpressureHandler({ maxPending: 5, strategy: 'drop' });
    stream.subscribe((e) => bp.push(e));
    for (let i = 0; i < 10; i++) stream.publish(i);
    expect(bp.getStats().totalPushed).toBe(10);
    expect(bp.getStats().dropped).toBe(5);
  });

  it('should chain filter and map on EventStream', () => {
    const stream = new EventStream<number>();
    const filtered = stream.filter((n) => n > 2);
    const mapped = filtered.map((n) => n * 10);
    stream.publish(1);
    stream.publish(2);
    stream.publish(3);
    stream.publish(4);
    expect(mapped.getEvents()).toEqual([30, 40]);
  });

  it('should use StreamCircuitBreaker with StreamProcessor', async () => {
    const cb = new StreamCircuitBreaker({ failureThreshold: 2, recoveryTimeout: 50 });
    let callCount = 0;
    const handler = async (e: unknown) => {
      callCount++;
      if (callCount <= 2) throw new Error('fail');
      return `ok-${e}`;
    };
    try { await cb.process('a', handler); } catch { /* expected */ }
    try { await cb.process('b', handler); } catch { /* expected */ }
    expect(cb.getState()).toBe('open');
    await new Promise((r) => setTimeout(r, 60));
    expect(cb.getState()).toBe('half-open');
    const result = await cb.process('c', handler);
    expect(result).toBe('ok-c');
  });

  it('should record and replay with StreamReplay and EventStream', async () => {
    const source = new EventStream<string>();
    const replay = new StreamReplay<string>();
    replay.record(source);
    source.publish('hello');
    source.publish('world');
    const recorded = replay.stopRecording();
    const replayStream = replay.replay(recorded);
    await new Promise((r) => setTimeout(r, 50));
    expect(replayStream.getEvents()).toEqual(['hello', 'world']);
  });

  it('should use JoinOperator with EventStreams', () => {
    const leftStream = new EventStream<{ id: string; val: number }>();
    const rightStream = new EventStream<{ id: string; label: string }>();
    const join = new JoinOperator(
      { leftKey: (e) => e.id, rightKey: (e) => e.id }
    );
    leftStream.subscribe((e) => join.addLeft(e));
    rightStream.subscribe((e) => join.addRight(e));
    leftStream.publish({ id: '1', val: 100 });
    rightStream.publish({ id: '1', label: 'item' });
    const joins = join.getJoins();
    expect(joins.length).toBe(1);
    expect(joins[0]!.left.val).toBe(100);
    expect(joins[0]!.right.label).toBe('item');
  });

  it('should use StreamMetrics with multiple streams', () => {
    const metrics = new StreamMetrics();
    metrics.recordProcessing('s1', 10, true);
    metrics.recordProcessing('s1', 20, true);
    metrics.recordProcessing('s2', 15, false);
    metrics.recordLatency('s1', 5);
    metrics.recordLatency('s1', 15);
    metrics.recordThroughput('s1', 50, 1000);
    const all = metrics.getAllMetrics();
    expect(all['s1']!.totalProcessed).toBe(2);
    expect(all['s2']!.totalProcessed).toBe(1);
    expect(metrics.getDashboard().streams).toBe(2);
  });

  it('should handle full pipeline: stream -> processor -> aggregation -> metrics', async () => {
    const input = new EventStream<number>();
    const proc = new StreamProcessor<number, number>();
    const agg = new AggregationOperator<number>();
    const metrics = new StreamMetrics();

    proc.pipe((n) => n * 2);
    proc.input(input);
    proc.start();

    proc.getOutputStream().subscribe((e) => {
      agg.add(e);
      metrics.recordProcessing('pipeline', 1, true);
    });

    input.publish(1);
    input.publish(2);
    input.publish(3);
    await new Promise((r) => setTimeout(r, 20));

    expect(agg.sum((n) => n)).toBe(12); // (2+4+6)
    expect(metrics.getStreamMetrics('pipeline').totalProcessed).toBe(3);
    proc.stop();
  });
});
