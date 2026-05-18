import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
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
// EventStream Tests
// ============================================================
describe('EventStream', () => {
  let stream: EventStream<number>;

  beforeEach(() => {
    stream = new EventStream<number>();
  });

  it('should create an EventStream with default options', () => {
    expect(stream).toBeDefined();
    expect(stream.getEventCount()).toBe(0);
  });

  it('should create an EventStream with custom maxSize', () => {
    const s = new EventStream<number>({ maxSize: 5 });
    expect(s).toBeDefined();
  });

  it('should create an EventStream with custom retentionMs', () => {
    const s = new EventStream<number>({ retentionMs: 1000 });
    expect(s).toBeDefined();
  });

  it('should publish events', () => {
    stream.publish(1);
    stream.publish(2);
    expect(stream.getEventCount()).toBe(2);
  });

  it('should get all events', () => {
    stream.publish(1);
    stream.publish(2);
    stream.publish(3);
    const events = stream.getEvents();
    expect(events).toEqual([1, 2, 3]);
  });

  it('should get limited number of events', () => {
    stream.publish(1);
    stream.publish(2);
    stream.publish(3);
    const events = stream.getEvents(2);
    expect(events).toEqual([2, 3]);
  });

  it('should get events with count 0', () => {
    stream.publish(1);
    stream.publish(2);
    const events = stream.getEvents(0);
    expect(events).toEqual([]);
  });

  it('should get events without count parameter', () => {
    stream.publish(10);
    stream.publish(20);
    const events = stream.getEvents();
    expect(events).toEqual([10, 20]);
  });

  it('should subscribe and receive events', () => {
    const received: number[] = [];
    stream.subscribe((e) => received.push(e));
    stream.publish(1);
    stream.publish(2);
    expect(received).toEqual([1, 2]);
  });

  it('should return a subscription with id and active flag', () => {
    const sub = stream.subscribe(() => {});
    expect(sub.id).toBeDefined();
    expect(sub.active).toBe(true);
  });

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

  it('should support multiple subscribers', () => {
    const received1: number[] = [];
    const received2: number[] = [];
    stream.subscribe((e) => received1.push(e));
    stream.subscribe((e) => received2.push(e));
    stream.publish(1);
    expect(received1).toEqual([1]);
    expect(received2).toEqual([1]);
  });

  it('should clear events', () => {
    stream.publish(1);
    stream.publish(2);
    stream.clear();
    expect(stream.getEventCount()).toBe(0);
  });

  it('should enforce maxSize', () => {
    const s = new EventStream<number>({ maxSize: 3 });
    s.publish(1);
    s.publish(2);
    s.publish(3);
    s.publish(4);
    expect(s.getEventCount()).toBe(3);
    expect(s.getEvents()).toEqual([2, 3, 4]);
  });

  it('should pipe events to another stream', () => {
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

  it('should filter events', () => {
    const filtered = stream.filter((n) => n % 2 === 0);
    stream.publish(1);
    stream.publish(2);
    stream.publish(3);
    stream.publish(4);
    expect(filtered.getEvents()).toEqual([2, 4]);
  });

  it('should map events', () => {
    const mapped = stream.map((n) => n * 2);
    stream.publish(1);
    stream.publish(2);
    expect(mapped.getEvents()).toEqual([2, 4]);
  });

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

  it('should handle async subscriber', async () => {
    const received: number[] = [];
    stream.subscribe(async (e) => {
      await Promise.resolve();
      received.push(e);
    });
    stream.publish(1);
    stream.publish(2);
    // Allow async to settle
    await new Promise((r) => setTimeout(r, 10));
    expect(received).toEqual([1, 2]);
  });

  it('should publish string events', () => {
    const s = new EventStream<string>();
    s.publish('hello');
    s.publish('world');
    expect(s.getEvents()).toEqual(['hello', 'world']);
  });

  it('should publish object events', () => {
    const s = new EventStream<{ id: number }>();
    s.publish({ id: 1 });
    s.publish({ id: 2 });
    expect(s.getEvents()).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('should getEventCount on empty stream', () => {
    expect(stream.getEventCount()).toBe(0);
  });

  it('should handle retention expiration', async () => {
    const s = new EventStream<number>({ retentionMs: 10 });
    s.publish(1);
    s.publish(2);
    await new Promise((r) => setTimeout(r, 20));
    expect(s.getEventCount()).toBe(0);
  });
});

// ============================================================
// StreamProcessor Tests
// ============================================================
describe('StreamProcessor', () => {
  it('should create a StreamProcessor with default options', () => {
    const proc = new StreamProcessor<number, number>();
    expect(proc).toBeDefined();
  });

  it('should create a StreamProcessor with custom options', () => {
    const errorHandler = (_err: unknown, _event: unknown) => {};
    const proc = new StreamProcessor<number, number>({
      concurrency: 4,
      errorHandler,
    });
    expect(proc).toBeDefined();
  });

  it('should return an output stream', () => {
    const proc = new StreamProcessor<number, number>();
    const output = proc.getOutputStream();
    expect(output).toBeInstanceOf(EventStream);
  });

  it('should start and stop processing', () => {
    const proc = new StreamProcessor<number, number>();
    proc.start();
    proc.stop();
    expect(proc.getStats().processed).toBe(0);
  });

  it('should process events through a stage', async () => {
    const proc = new StreamProcessor<number, number>();
    const input = new EventStream<number>();
    proc.pipe((n) => n * 2);
    proc.input(input);
    proc.start();
    input.publish(5);
    input.publish(10);
    await new Promise((r) => setTimeout(r, 20));
    const output = proc.getOutputStream();
    expect(output.getEvents()).toEqual([10, 20]);
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

  it('should return stats', () => {
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

  it('should handle transform returning array', async () => {
    const proc = new StreamProcessor<number, number>();
    const input = new EventStream<number>();
    proc.pipe((n) => [n, n + 1]);
    proc.input(input);
    proc.start();
    input.publish(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(proc.getOutputStream().getEvents()).toEqual([2]);
    proc.stop();
  });

  it('should pipe multiple stages', () => {
    const proc = new StreamProcessor<number, number>();
    const next = proc.pipe((n) => n * 2);
    expect(next).toBeInstanceOf(StreamProcessor);
  });
});

// ============================================================
// WindowOperator Tests
// ============================================================
describe('WindowOperator', () => {
  it('should create a count-based WindowOperator', () => {
    const op = new WindowOperator<number>(3);
    expect(op).toBeDefined();
  });

  it('should create a WindowOperator with custom slide size', () => {
    const op = new WindowOperator<number>(5, 2);
    expect(op).toBeDefined();
  });

  it('should emit window when full', () => {
    const op = new WindowOperator<number>(3);
    op.add(1);
    op.add(2);
    const windows = op.add(3);
    expect(windows).toEqual([[1, 2, 3]]);
  });

  it('should not emit partial window', () => {
    const op = new WindowOperator<number>(3);
    const w1 = op.add(1);
    const w2 = op.add(2);
    expect(w1).toEqual([]);
    expect(w2).toEqual([]);
  });

  it('should emit multiple windows for tumbling', () => {
    const op = new WindowOperator<number>(2);
    op.add(1);
    op.add(2);
    op.add(3);
    op.add(4);
    const stats = op.getStats();
    expect(stats.windowsEmitted).toBe(2);
  });

  it('should handle sliding windows', () => {
    const op = new WindowOperator<number>(3, 1);
    op.add(1);
    op.add(2);
    const w1 = op.add(3);
    // windowSize=3, slideSize=1
    // After adding 3: window [1,2,3] emitted, slide by 1 => remaining [2,3]
    expect(w1.length).toBe(1);
    expect(w1[0]).toEqual([1, 2, 3]);
  });

  it('should flush remaining events', () => {
    const op = new WindowOperator<number>(5);
    op.add(1);
    op.add(2);
    const remaining = op.flush();
    expect(remaining).toEqual([1, 2]);
  });

  it('should flush empty window', () => {
    const op = new WindowOperator<number>(3);
    const remaining = op.flush();
    expect(remaining).toEqual([]);
  });

  it('should reset operator', () => {
    const op = new WindowOperator<number>(2);
    op.add(1);
    op.add(2);
    op.reset();
    expect(op.getStats().windowsEmitted).toBe(0);
    expect(op.getStats().eventsProcessed).toBe(0);
  });

  it('should return correct stats', () => {
    const op = new WindowOperator<number>(2);
    op.add(1);
    op.add(2);
    const stats = op.getStats();
    expect(stats.windowsEmitted).toBe(1);
    expect(stats.eventsProcessed).toBe(2);
    expect(stats.currentWindowSize).toBe(0);
  });

  it('should create time-based window with static factory', () => {
    const op = WindowOperator.timeWindow<number>(1000);
    expect(op).toBeDefined();
  });

  it('should create time-based window with custom slide', () => {
    const op = WindowOperator.timeWindow<number>(1000, 500);
    expect(op).toBeDefined();
  });

  it('should track currentWindowSize in stats', () => {
    const op = new WindowOperator<number>(5);
    op.add(1);
    op.add(2);
    op.add(3);
    expect(op.getStats().currentWindowSize).toBe(3);
  });

  it('should handle string events in window', () => {
    const op = new WindowOperator<string>(2);
    op.add('a');
    const windows = op.add('b');
    expect(windows).toEqual([['a', 'b']]);
  });
});

// ============================================================
// JoinOperator Tests
// ============================================================
describe('JoinOperator', () => {
  interface LeftEvent {
    id: string;
    value: number;
  }
  interface RightEvent {
    id: string;
    label: string;
  }

  it('should create a JoinOperator', () => {
    const op = new JoinOperator<LeftEvent, RightEvent>({
      leftKey: (e) => e.id,
      rightKey: (e) => e.id,
    });
    expect(op).toBeDefined();
  });

  it('should create a JoinOperator with windowMs', () => {
    const op = new JoinOperator<LeftEvent, RightEvent>({
      leftKey: (e) => e.id,
      rightKey: (e) => e.id,
      windowMs: 1000,
    });
    expect(op).toBeDefined();
  });

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
    const joins = op.getJoins();
    expect(joins.length).toBe(1);
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

// ============================================================
// AggregationOperator Tests
// ============================================================
describe('AggregationOperator', () => {
  let agg: AggregationOperator<number>;

  beforeEach(() => {
    agg = new AggregationOperator<number>();
  });

  it('should create an AggregationOperator', () => {
    expect(agg).toBeDefined();
  });

  it('should add events', () => {
    agg.add(1);
    agg.add(2);
    agg.add(3);
    expect(agg.count()).toBe(3);
  });

  it('should count events', () => {
    agg.add(1);
    agg.add(2);
    expect(agg.count()).toBe(2);
  });

  it('should count zero events', () => {
    expect(agg.count()).toBe(0);
  });

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

  it('should average events', () => {
    agg.add(10);
    agg.add(20);
    agg.add(30);
    expect(agg.avg((n) => n)).toBe(20);
  });

  it('should average zero events', () => {
    expect(agg.avg((n) => n)).toBe(0);
  });

  it('should find min', () => {
    agg.add(5);
    agg.add(1);
    agg.add(9);
    expect(agg.min((n) => n)).toBe(1);
  });

  it('should find min of zero events', () => {
    expect(agg.min((n) => n)).toBe(0);
  });

  it('should find max', () => {
    agg.add(5);
    agg.add(1);
    agg.add(9);
    expect(agg.max((n) => n)).toBe(9);
  });

  it('should find max of zero events', () => {
    expect(agg.max((n) => n)).toBe(0);
  });

  it('should groupBy', () => {
    agg.add(1);
    agg.add(2);
    agg.add(3);
    agg.add(4);
    const groups = agg.groupBy((n) => (n % 2 === 0 ? 'even' : 'odd'));
    expect(groups.get('odd')).toEqual([1, 3]);
    expect(groups.get('even')).toEqual([2, 4]);
  });

  it('should return empty groupBy for no events', () => {
    const groups = agg.groupBy((n) => n);
    expect(groups.size).toBe(0);
  });

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

  it('should return topN', () => {
    agg.add(3);
    agg.add(1);
    agg.add(4);
    agg.add(1);
    agg.add(5);
    const top = agg.topN(3, (n) => n);
    expect(top).toEqual([5, 4, 3]);
  });

  it('should return topN with fewer elements', () => {
    agg.add(1);
    agg.add(2);
    const top = agg.topN(5, (n) => n);
    expect(top).toEqual([2, 1]);
  });

  it('should calculate percentile', () => {
    for (let i = 1; i <= 100; i++) {
      agg.add(i);
    }
    expect(agg.percentile(50, (n) => n)).toBeCloseTo(50.5, 0);
  });

  it('should calculate p0 percentile', () => {
    agg.add(10);
    agg.add(20);
    agg.add(30);
    expect(agg.percentile(0, (n) => n)).toBe(10);
  });

  it('should calculate p100 percentile', () => {
    agg.add(10);
    agg.add(20);
    agg.add(30);
    expect(agg.percentile(100, (n) => n)).toBe(30);
  });

  it('should return 0 for percentile of empty', () => {
    expect(agg.percentile(50, (n) => n)).toBe(0);
  });

  it('should create histogram', () => {
    for (let i = 0; i < 10; i++) {
      agg.add(i * 10);
    }
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

  it('should reset aggregation', () => {
    agg.add(1);
    agg.add(2);
    agg.reset();
    expect(agg.count()).toBe(0);
  });

  it('should handle object events', () => {
    const objAgg = new AggregationOperator<{ val: number }>();
    objAgg.add({ val: 10 });
    objAgg.add({ val: 20 });
    objAgg.add({ val: 30 });
    expect(objAgg.sum((o) => o.val)).toBe(60);
    expect(objAgg.avg((o) => o.val)).toBe(20);
  });
});

// ============================================================
// StreamScheduler Tests
// ============================================================
describe('StreamScheduler', () => {
  let scheduler: StreamScheduler;

  beforeEach(() => {
    scheduler = new StreamScheduler();
  });

  afterEach(() => {
    scheduler.stop();
  });

  it('should create a StreamScheduler', () => {
    expect(scheduler).toBeDefined();
  });

  it('should schedule a stream', () => {
    const source = new EventStream<number>();
    const proc = new StreamProcessor<number, number>();
    const id = scheduler.scheduleStream('test', source, proc);
    expect(id).toBeDefined();
  });

  it('should schedule a stream with custom interval', () => {
    const source = new EventStream<number>();
    const proc = new StreamProcessor<number, number>();
    const id = scheduler.scheduleStream('test', source, proc, 500);
    expect(id).toBeDefined();
  });

  it('should unschedule a stream', () => {
    const source = new EventStream<number>();
    const proc = new StreamProcessor<number, number>();
    const id = scheduler.scheduleStream('test', source, proc);
    const result = scheduler.unschedule(id);
    expect(result).toBe(true);
  });

  it('should return false for unscheduling invalid id', () => {
    expect(scheduler.unschedule('invalid')).toBe(false);
  });

  it('should pause a scheduled stream', () => {
    const source = new EventStream<number>();
    const proc = new StreamProcessor<number, number>();
    const id = scheduler.scheduleStream('test', source, proc);
    scheduler.start();
    scheduler.pause(id);
    const streams = scheduler.getScheduledStreams();
    expect(streams[0]).toHaveProperty('paused', true);
  });

  it('should resume a paused stream', () => {
    const source = new EventStream<number>();
    const proc = new StreamProcessor<number, number>();
    const id = scheduler.scheduleStream('test', source, proc);
    scheduler.start();
    scheduler.pause(id);
    scheduler.resume(id);
    const streams = scheduler.getScheduledStreams();
    expect(streams[0]).toHaveProperty('paused', false);
  });

  it('should get scheduled streams', () => {
    const source = new EventStream<number>();
    const proc = new StreamProcessor<number, number>();
    scheduler.scheduleStream('test1', source, proc);
    scheduler.scheduleStream('test2', source, proc);
    const streams = scheduler.getScheduledStreams();
    expect(streams.length).toBe(2);
  });

  it('should return empty scheduled streams initially', () => {
    expect(scheduler.getScheduledStreams()).toEqual([]);
  });

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

  it('should return stats', () => {
    const stats = scheduler.getStats();
    expect(stats).toHaveProperty('activeStreams');
    expect(stats).toHaveProperty('totalProcessed');
    expect(stats).toHaveProperty('errors');
  });

  it('should handle pause with invalid id', () => {
    expect(() => scheduler.pause('invalid')).not.toThrow();
  });

  it('should handle resume with invalid id', () => {
    expect(() => scheduler.resume('invalid')).not.toThrow();
  });
});

// ============================================================
// BackpressureHandler Tests
// ============================================================
describe('BackpressureHandler', () => {
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

  it('should push events', () => {
    const bp = new BackpressureHandler({ maxPending: 100 });
    expect(bp.push('event1')).toBe(true);
    expect(bp.push('event2')).toBe(true);
    expect(bp.getPendingCount()).toBe(2);
  });

  it('should pull events', () => {
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
    expect(bp.push('d')).toBe(false); // dropped
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

  it('should detect under pressure state', () => {
    const bp = new BackpressureHandler({
      maxPending: 10,
      highWatermark: 5,
      lowWatermark: 2,
      strategy: 'drop',
    });
    for (let i = 0; i < 5; i++) {
      bp.push(i);
    }
    expect(bp.isUnderPressure()).toBe(true);
  });

  it('should recover from pressure state', () => {
    const bp = new BackpressureHandler({
      maxPending: 10,
      highWatermark: 5,
      lowWatermark: 2,
      strategy: 'drop',
    });
    for (let i = 0; i < 5; i++) {
      bp.push(i);
    }
    expect(bp.isUnderPressure()).toBe(true);
    bp.pull();
    bp.pull();
    bp.pull();
    expect(bp.isUnderPressure()).toBe(false);
  });

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

  it('should track dropped events in stats', () => {
    const bp = new BackpressureHandler({ maxPending: 2, strategy: 'drop' });
    bp.push('a');
    bp.push('b');
    bp.push('c');
    const stats = bp.getStats();
    expect(stats.dropped).toBe(1);
  });

  it('should calculate pressureRatio', () => {
    const bp = new BackpressureHandler({ maxPending: 10 });
    bp.push('a');
    bp.push('b');
    const stats = bp.getStats();
    expect(stats.pressureRatio).toBeCloseTo(0.2);
  });

  it('should not be under pressure initially', () => {
    const bp = new BackpressureHandler({ maxPending: 100 });
    expect(bp.isUnderPressure()).toBe(false);
  });
});

// ============================================================
// StreamReplay Tests
// ============================================================
describe('StreamReplay', () => {
  let replay: StreamReplay<number>;

  beforeEach(() => {
    replay = new StreamReplay<number>();
  });

  it('should create a StreamReplay', () => {
    expect(replay).toBeDefined();
  });

  it('should record events from a stream', () => {
    const stream = new EventStream<number>();
    replay.record(stream);
    stream.publish(1);
    stream.publish(2);
    stream.publish(3);
    expect(replay.getRecordedEvents()).toEqual([1, 2, 3]);
  });

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

  it('should replay events', () => {
    const events = [1, 2, 3];
    const stream = replay.replay(events);
    expect(stream.getEvents()).toEqual([1, 2, 3]);
  });

  it('should replay empty events', () => {
    const stream = replay.replay([]);
    expect(stream.getEventCount()).toBe(0);
  });

  it('should replay events with speed', () => {
    const events = [1, 2, 3];
    const stream = replay.replay(events, 2);
    expect(stream.getEvents()).toEqual([1, 2, 3]);
  });

  it('should replay range of events', () => {
    const stream = new EventStream<number>();
    replay.record(stream);
    for (let i = 0; i < 10; i++) {
      stream.publish(i);
    }
    replay.stopRecording();
    const range = replay.replayRange(3, 7);
    expect(range).toEqual([3, 4, 5, 6]);
  });

  it('should replay range with out of bounds', () => {
    const stream = new EventStream<number>();
    replay.record(stream);
    stream.publish(1);
    stream.publish(2);
    replay.stopRecording();
    const range = replay.replayRange(1, 10);
    expect(range).toEqual([2]);
  });

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
    const seeked = replay.seek(Date.now() + 100000);
    expect(seeked).toEqual([]);
  });

  it('should return stats', () => {
    const stream = new EventStream<number>();
    replay.record(stream);
    stream.publish(1);
    stream.publish(2);
    const stats = replay.getStats();
    expect(stats.totalRecorded).toBe(2);
    expect(stats.replayCount).toBe(0);
  });

  it('should track replayCount in stats', () => {
    const stream = replay.replay([1, 2, 3]);
    const stats = replay.getStats();
    expect(stats.replayCount).toBe(3);
  });

  it('should get recorded events', () => {
    const stream = new EventStream<number>();
    replay.record(stream);
    stream.publish(10);
    stream.publish(20);
    expect(replay.getRecordedEvents()).toEqual([10, 20]);
  });

  it('should handle string events in replay', () => {
    const strReplay = new StreamReplay<string>();
    const stream = new EventStream<string>();
    strReplay.record(stream);
    stream.publish('hello');
    stream.publish('world');
    expect(strReplay.getRecordedEvents()).toEqual(['hello', 'world']);
  });
});

// ============================================================
// StreamCircuitBreaker Tests
// ============================================================
describe('StreamCircuitBreaker', () => {
  let cb: StreamCircuitBreaker;

  beforeEach(() => {
    cb = new StreamCircuitBreaker({ failureThreshold: 3, recoveryTimeout: 100 });
  });

  it('should create with default options', () => {
    const breaker = new StreamCircuitBreaker();
    expect(breaker).toBeDefined();
  });

  it('should create with custom options', () => {
    const breaker = new StreamCircuitBreaker({
      failureThreshold: 5,
      recoveryTimeout: 1000,
      halfOpenMaxCalls: 2,
    });
    expect(breaker).toBeDefined();
  });

  it('should start in closed state', () => {
    expect(cb.getState()).toBe('closed');
  });

  it('should process events in closed state', async () => {
    const result = await cb.process('event', async (e) => `processed-${e}`);
    expect(result).toBe('processed-event');
  });

  it('should transition to open after failures', async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await cb.process('event', async () => {
          throw new Error('fail');
        });
      } catch {
        // expected
      }
    }
    expect(cb.getState()).toBe('open');
  });

  it('should reject events in open state', async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await cb.process('event', async () => {
          throw new Error('fail');
        });
      } catch {
        // expected
      }
    }
    await expect(
      cb.process('event', async () => 'ok')
    ).rejects.toThrow('Circuit breaker is open');
  });

  it('should transition to half-open after recovery timeout', async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await cb.process('event', async () => {
          throw new Error('fail');
        });
      } catch {
        // expected
      }
    }
    await new Promise((r) => setTimeout(r, 150));
    expect(cb.getState()).toBe('half-open');
  });

  it('should transition back to closed after successful half-open calls', async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await cb.process('event', async () => {
          throw new Error('fail');
        });
      } catch {
        // expected
      }
    }
    await new Promise((r) => setTimeout(r, 150));
    // halfOpenMaxCalls defaults to 3
    await cb.process('event', async () => 'ok');
    await cb.process('event', async () => 'ok');
    await cb.process('event', async () => 'ok');
    expect(cb.getState()).toBe('closed');
  });

  it('should transition back to open on half-open failure', async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await cb.process('event', async () => {
          throw new Error('fail');
        });
      } catch {
        // expected
      }
    }
    await new Promise((r) => setTimeout(r, 150));
    try {
      await cb.process('event', async () => {
        throw new Error('fail again');
      });
    } catch {
      // expected
    }
    expect(cb.getState()).toBe('open');
  });

  it('should return stats', async () => {
    await cb.process('event', async () => 'ok');
    const stats = cb.getStats();
    expect(stats.state).toBe('closed');
    expect(stats.successes).toBe(1);
    expect(stats.failures).toBe(0);
  });

  it('should track lastFailure', async () => {
    try {
      await cb.process('event', async () => {
        throw new Error('test');
      });
    } catch {
      // expected
    }
    const stats = cb.getStats();
    expect(stats.lastFailure).toBeDefined();
    expect(stats.lastFailure).toBeGreaterThan(0);
  });

  it('should track lastSuccess', async () => {
    await cb.process('event', async () => 'ok');
    const stats = cb.getStats();
    expect(stats.lastSuccess).toBeDefined();
    expect(stats.lastSuccess).toBeGreaterThan(0);
  });

  it('should reset the circuit breaker', async () => {
    try {
      await cb.process('event', async () => {
        throw new Error('fail');
      });
    } catch {
      // expected
    }
    cb.reset();
    expect(cb.getState()).toBe('closed');
    expect(cb.getStats().failures).toBe(0);
    expect(cb.getStats().successes).toBe(0);
  });

  it('should call state change handlers', async () => {
    const states: string[] = [];
    cb.onStateChange((state) => states.push(state));
    for (let i = 0; i < 3; i++) {
      try {
        await cb.process('event', async () => {
          throw new Error('fail');
        });
      } catch {
        // expected
      }
    }
    expect(states).toContain('open');
  });

  it('should reset failures on success in closed state', async () => {
    try {
      await cb.process('event', async () => {
        throw new Error('fail');
      });
    } catch {
      // expected
    }
    expect(cb.getStats().failures).toBe(1);
    await cb.process('event', async () => 'ok');
    expect(cb.getStats().failures).toBe(0);
  });
});

// ============================================================
// StreamMetrics Tests
// ============================================================
describe('StreamMetrics', () => {
  let metrics: StreamMetrics;

  beforeEach(() => {
    metrics = new StreamMetrics();
  });

  it('should create a StreamMetrics', () => {
    expect(metrics).toBeDefined();
  });

  it('should record processing', () => {
    metrics.recordProcessing('stream1', 10, true);
    metrics.recordProcessing('stream1', 20, true);
    const m = metrics.getStreamMetrics('stream1');
    expect(m.totalProcessed).toBe(2);
  });

  it('should record processing failures', () => {
    metrics.recordProcessing('stream1', 10, false);
    const m = metrics.getStreamMetrics('stream1');
    expect(m.errorRate).toBe(1);
  });

  it('should record throughput', () => {
    metrics.recordThroughput('stream1', 100, 1000);
    const m = metrics.getStreamMetrics('stream1');
    expect(m.throughput).toBe(100);
  });

  it('should record latency', () => {
    metrics.recordLatency('stream1', 5);
    metrics.recordLatency('stream1', 15);
    const m = metrics.getStreamMetrics('stream1');
    expect(m.avgLatency).toBe(10);
  });

  it('should record error', () => {
    metrics.recordError('stream1', new Error('test error'));
    const alerts = metrics.getAlerts();
    expect(alerts.length).toBe(1);
    expect(alerts[0]!.type).toBe('error');
    expect(alerts[0]!.streamId).toBe('stream1');
  });

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
    const m = metrics.getStreamMetrics('stream1');
    expect(m.p99Latency).toBeGreaterThanOrEqual(99);
  });

  it('should get all metrics', () => {
    metrics.recordProcessing('stream1', 10, true);
    metrics.recordProcessing('stream2', 20, true);
    const all = metrics.getAllMetrics();
    expect(Object.keys(all).length).toBe(2);
    expect(all['stream1']).toBeDefined();
    expect(all['stream2']).toBeDefined();
  });

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

  it('should get alerts', () => {
    metrics.recordError('stream1', new Error('error1'));
    metrics.recordError('stream2', new Error('error2'));
    const alerts = metrics.getAlerts();
    expect(alerts.length).toBe(2);
  });

  it('should return empty alerts initially', () => {
    expect(metrics.getAlerts()).toEqual([]);
  });

  it('should reset metrics', () => {
    metrics.recordProcessing('stream1', 10, true);
    metrics.recordError('stream1', new Error('test'));
    metrics.reset();
    expect(metrics.getStreamMetrics('stream1').totalProcessed).toBe(0);
    expect(metrics.getAlerts()).toEqual([]);
  });

  it('should calculate average error rate across streams', () => {
    metrics.recordProcessing('s1', 10, true);
    metrics.recordProcessing('s1', 10, false);
    metrics.recordProcessing('s2', 10, true);
    metrics.recordProcessing('s2', 10, true);
    const dashboard = metrics.getDashboard();
    expect(dashboard.avgErrorRate).toBeCloseTo(0.25);
  });

  it('should limit alerts to 100', () => {
    for (let i = 0; i < 110; i++) {
      metrics.recordError('stream1', new Error(`error-${i}`));
    }
    expect(metrics.getAlerts().length).toBeLessThanOrEqual(100);
  });

  it('should track multiple streams independently', () => {
    metrics.recordProcessing('s1', 10, true);
    metrics.recordProcessing('s2', 20, false);
    metrics.recordProcessing('s2', 30, true);
    expect(metrics.getStreamMetrics('s1').totalProcessed).toBe(1);
    expect(metrics.getStreamMetrics('s2').totalProcessed).toBe(2);
  });

  it('should return zero avgLatency for no latency data', () => {
    metrics.recordProcessing('stream1', 10, true);
    expect(metrics.getStreamMetrics('stream1').avgLatency).toBe(0);
  });

  it('should return zero throughput for no throughput data', () => {
    metrics.recordProcessing('stream1', 10, true);
    expect(metrics.getStreamMetrics('stream1').throughput).toBe(0);
  });

  it('should handle alert severity', () => {
    metrics.recordError('stream1', new Error('critical'));
    const alerts = metrics.getAlerts();
    expect(alerts[0]!.severity).toBe('high');
  });

  it('should sort topErrors by error count', () => {
    for (let i = 0; i < 5; i++) {
      metrics.recordError('stream1', new Error('e'));
    }
    for (let i = 0; i < 2; i++) {
      metrics.recordError('stream2', new Error('e'));
    }
    const dashboard = metrics.getDashboard();
    expect(dashboard.topErrors[0]!.streamId).toBe('stream1');
    expect(dashboard.topErrors[0]!.errorCount).toBe(5);
  });

  it('should include timestamp in alerts', () => {
    metrics.recordError('stream1', new Error('test'));
    const alerts = metrics.getAlerts();
    expect(alerts[0]!.timestamp).toBeGreaterThan(0);
  });

  it('should include message in alerts', () => {
    metrics.recordError('stream1', new Error('specific message'));
    const alerts = metrics.getAlerts();
    expect(alerts[0]!.message).toBe('specific message');
  });
});

// ============================================================
// Integration Tests
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
    const output = proc.getOutputStream();
    expect(output.getEvents()).toEqual(['result-1', 'result-2']);
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
    for (let i = 0; i < 10; i++) {
      stream.publish(i);
    }
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

  it('should record and replay with StreamReplay and EventStream', () => {
    const source = new EventStream<string>();
    const replay = new StreamReplay<string>();
    replay.record(source);
    source.publish('hello');
    source.publish('world');
    const recorded = replay.stopRecording();
    const replayStream = replay.replay(recorded);
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
    const dashboard = metrics.getDashboard();
    expect(dashboard.streams).toBe(2);
  });
});
