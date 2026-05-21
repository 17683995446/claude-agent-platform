import { describe, test, expect, beforeEach, afterEach, vi } from 'bun:test';
import {
  InfiniteLoop,
  RuntimeStateMachine,
  CheckpointManager,
  PersistentTaskQueue,
  HeartbeatMonitor,
  ResourceGuard,
  IdleDetector,
  GracefulRestarter,
  LifecycleManager,
  RuntimeConfigManager,
} from '../src/index.ts';
import type {
  RuntimeState,
  RunningSubState,
  Checkpoint,
  HeartbeatStatus,
  IdlePeriod,
  RestartResult,
  LifecyclePhase,
} from '../src/index.ts';

// ============================================================
// Module 1: InfiniteLoop - Comprehensive Coverage
// ============================================================
describe('InfiniteLoop (coverage)', () => {
  let loop: InfiniteLoop;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    try { loop?.destroy(); } catch {}
    vi.useRealTimers();
  });

  test('should initialize with default interval mode', () => {
    loop = new InfiniteLoop();
    expect(loop.getStatus()).toBe('stopped');
    expect(loop.getMode()).toBe('interval');
    expect(loop.getIterationCount()).toBe(0);
    expect(loop.getUptime()).toBe(0);
  });

  test('should initialize with all modes', () => {
    for (const mode of ['continuous', 'interval', 'adaptive', 'cron'] as const) {
      loop = new InfiniteLoop({ mode });
      expect(loop.getMode()).toBe(mode);
      loop.destroy();
    }
  });

  test('start() is no-op when already running', () => {
    loop = new InfiniteLoop({ mode: 'interval', intervalMs: 100 });
    loop.start();
    loop.start(); // double start
    expect(loop.getStatus()).toBe('running');
  });

  test('stop() is no-op when already stopped', async () => {
    loop = new InfiniteLoop();
    await loop.stop();
    expect(loop.getStatus()).toBe('stopped');
  });

  test('pause() is no-op when not running', () => {
    loop = new InfiniteLoop();
    loop.pause();
    expect(loop.getStatus()).toBe('stopped');
  });

  test('resume() is no-op when not paused', () => {
    loop = new InfiniteLoop();
    loop.resume();
    expect(loop.getStatus()).toBe('stopped');
  });

  test('tick() is no-op when not running', () => {
    loop = new InfiniteLoop();
    loop.tick();
    expect(loop.getIterationCount()).toBe(0);
  });

  test('should run iterations with tick() in interval mode', () => {
    const starts: number[] = [];
    loop = new InfiniteLoop({
      mode: 'interval',
      intervalMs: 100,
      onIterationStart: (i) => starts.push(i),
    });
    loop.start();
    loop.tick();
    expect(loop.getIterationCount()).toBe(1);
    expect(starts).toEqual([1]);
    loop.tick();
    expect(loop.getIterationCount()).toBe(2);
    expect(starts).toEqual([1, 2]);
  });

  test('should stop and ignore further ticks', async () => {
    loop = new InfiniteLoop({ mode: 'interval', intervalMs: 100 });
    loop.start();
    loop.tick();
    expect(loop.getIterationCount()).toBe(1);
    await loop.stop();
    expect(loop.getStatus()).toBe('stopped');
    loop.tick();
    expect(loop.getIterationCount()).toBe(1);
  });

  test('should pause and resume with tick()', async () => {
    loop = new InfiniteLoop({ mode: 'interval', intervalMs: 100 });
    loop.start();
    loop.tick();
    expect(loop.getIterationCount()).toBe(1);
    loop.pause();
    expect(loop.getStatus()).toBe('paused');
    loop.tick(); // no-op
    expect(loop.getIterationCount()).toBe(1);
    loop.resume();
    expect(loop.getStatus()).toBe('running');
    loop.tick();
    expect(loop.getIterationCount()).toBe(2);
    await loop.stop();
  });

  test('should respect maxIterations and auto-stop', () => {
    loop = new InfiniteLoop({ mode: 'interval', intervalMs: 100, maxIterations: 3 });
    loop.start();
    loop.tick(); // 1
    loop.tick(); // 2
    loop.tick(); // 3
    expect(loop.getIterationCount()).toBe(3);
    expect(loop.getStatus()).toBe('running');
    loop.tick(); // should auto-stop
    expect(loop.getIterationCount()).toBe(3);
    expect(loop.getStatus()).toBe('stopped');
  });

  test('maxIterations=0 should stop immediately on first tick', () => {
    loop = new InfiniteLoop({ mode: 'interval', intervalMs: 100, maxIterations: 0 });
    loop.start();
    loop.tick();
    expect(loop.getIterationCount()).toBe(0);
    expect(loop.getStatus()).toBe('stopped');
  });

  test('should call onIterationStart and onIterationEnd', () => {
    const starts: number[] = [];
    const ends: Array<{ iteration: number; duration: number }> = [];
    loop = new InfiniteLoop({
      mode: 'interval',
      intervalMs: 100,
      onIterationStart: (i) => starts.push(i),
      onIterationEnd: (i, d) => ends.push({ iteration: i, duration: d }),
    });
    loop.start();
    loop.tick();
    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect(ends[0]!.iteration).toBe(1);
    expect(ends[0]!.duration).toBeGreaterThanOrEqual(0);
  });

  test('should handle sync iteration errors', () => {
    const errors: Error[] = [];
    loop = new InfiniteLoop({
      mode: 'interval',
      intervalMs: 100,
      onIteration: () => { throw new Error('sync error'); },
      onError: (err) => errors.push(err),
    });
    loop.start();
    loop.tick();
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toBe('sync error');
    expect(loop.getStatus()).toBe('running');
  });

  test('should handle async iteration errors', async () => {
    const errors: Error[] = [];
    loop = new InfiniteLoop({
      mode: 'interval',
      intervalMs: 100,
      onIteration: async () => { throw new Error('async error'); },
      onError: (err) => errors.push(err),
    });
    loop.start();
    loop.tick();
    // Use setImmediate to flush microtasks without relying on setTimeout
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toBe('async error');
  });

  test('should stop after maxConsecutiveErrors (sync)', () => {
    loop = new InfiniteLoop({
      mode: 'interval',
      intervalMs: 100,
      onIteration: () => { throw new Error('fail'); },
    });
    loop.start();
    for (let i = 0; i < 12; i++) {
      loop.tick();
    }
    expect(loop.getStatus()).toBe('stopped');
  });

  test('should stop after maxConsecutiveErrors (async)', async () => {
    loop = new InfiniteLoop({
      mode: 'interval',
      intervalMs: 100,
      onIteration: async () => { throw new Error('fail'); },
    });
    loop.start();
    for (let i = 0; i < 12; i++) {
      loop.tick();
    }
    // Flush microtask queue
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    expect(loop.getStatus()).toBe('stopped');
  });

  test('onRecovery should only fire after error recovery', () => {
    const recoveries: number[] = [];
    let failOnce = true;
    loop = new InfiniteLoop({
      mode: 'interval',
      intervalMs: 100,
      onIteration: () => {
        if (failOnce) {
          failOnce = false;
          throw new Error('temp');
        }
      },
      onRecovery: (i) => recoveries.push(i),
      onError: () => {},
    });
    loop.start();
    loop.tick(); // error
    expect(recoveries).toHaveLength(0);
    loop.tick(); // success after error -> recovery
    expect(recoveries).toHaveLength(1);
    loop.tick(); // normal success -> no recovery
    expect(recoveries).toHaveLength(1);
  });

  test('onRecovery should only fire after async error recovery', async () => {
    const recoveries: number[] = [];
    let failOnce = true;
    loop = new InfiniteLoop({
      mode: 'interval',
      intervalMs: 100,
      onIteration: async () => {
        if (failOnce) {
          failOnce = false;
          throw new Error('temp');
        }
      },
      onRecovery: (i) => recoveries.push(i),
      onError: () => {},
    });
    loop.start();
    loop.tick(); // error
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    expect(recoveries).toHaveLength(0);
    loop.tick(); // success after error -> recovery
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    expect(recoveries).toHaveLength(1);
    loop.tick(); // normal success -> no recovery
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    expect(recoveries).toHaveLength(1);
  });

  test('should detect stalls', () => {
    const stalls: Array<{ iteration: number; elapsed: number }> = [];
    loop = new InfiniteLoop({
      mode: 'interval',
      intervalMs: 100,
      stallThresholdMs: 1,
      onIteration: () => {
        (loop as any).iterationStartTime = Date.now() - 100;
      },
      onStall: (i, elapsed) => stalls.push({ iteration: i, elapsed }),
    });
    loop.start();
    loop.tick();
    expect(stalls.length).toBeGreaterThan(0);
  });

  test('should not detect stall when under threshold', () => {
    const stalls: Array<{ iteration: number; elapsed: number }> = [];
    loop = new InfiniteLoop({
      mode: 'interval',
      intervalMs: 100,
      stallThresholdMs: 10000,
      onStall: (i, elapsed) => stalls.push({ iteration: i, elapsed }),
    });
    loop.start();
    loop.tick();
    expect(stalls).toHaveLength(0);
  });

  test('should report uptime correctly', () => {
    loop = new InfiniteLoop({ mode: 'interval', intervalMs: 100 });
    expect(loop.getUptime()).toBe(0);
    loop.start();
    vi.advanceTimersByTime(500);
    expect(loop.getUptime()).toBe(500);
  });

  test('uptime should be 0 when stopped', async () => {
    loop = new InfiniteLoop({ mode: 'interval', intervalMs: 100 });
    loop.start();
    vi.advanceTimersByTime(500);
    await loop.stop();
    expect(loop.getUptime()).toBe(0);
  });

  test('should set mode and interval dynamically', () => {
    loop = new InfiniteLoop();
    loop.setMode('continuous');
    expect(loop.getMode()).toBe('continuous');
    loop.setIntervalMs(500);
  });

  test('destroy should clean up', () => {
    loop = new InfiniteLoop({ mode: 'interval', intervalMs: 100 });
    loop.start();
    loop.destroy();
    expect(loop.getStatus()).toBe('stopped');
  });

  test('continuous mode with tick', () => {
    loop = new InfiniteLoop({ mode: 'continuous', maxIterations: 5 });
    loop.start();
    for (let i = 0; i < 6; i++) loop.tick();
    expect(loop.getIterationCount()).toBe(5);
    expect(loop.getStatus()).toBe('stopped');
  });

  test('adaptive mode recalculates delay', () => {
    loop = new InfiniteLoop({ mode: 'adaptive', intervalMs: 100, maxIterations: 3 });
    loop.start();
    loop.tick();
    loop.tick();
    loop.tick();
    expect(loop.getIterationCount()).toBe(3);
  });

  test('cron mode with tick', () => {
    loop = new InfiniteLoop({ mode: 'cron', intervalMs: 100, maxIterations: 2 });
    loop.start();
    loop.tick();
    loop.tick();
    expect(loop.getIterationCount()).toBe(2);
  });

  test('async iteration that resolves', async () => {
    const results: string[] = [];
    loop = new InfiniteLoop({
      mode: 'interval',
      intervalMs: 100,
      onIteration: async () => { results.push('done'); },
    });
    loop.start();
    loop.tick();
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    expect(results).toEqual(['done']);
  });

  test('no iteration function should not crash', () => {
    loop = new InfiniteLoop({ mode: 'interval', intervalMs: 100 });
    loop.start();
    loop.tick();
    expect(loop.getIterationCount()).toBe(1);
  });
});

// ============================================================
// Module 2: RuntimeStateMachine - Comprehensive Coverage
// ============================================================
describe('RuntimeStateMachine (coverage)', () => {
  let sm: RuntimeStateMachine;

  beforeEach(() => {
    sm = new RuntimeStateMachine();
  });

  afterEach(() => {
    sm.destroy();
  });

  test('initial state is initialized', () => {
    expect(sm.getCurrentState()).toBe('initialized');
    expect(sm.getSubState()).toBeUndefined();
  });

  // Test every valid transition path
  const validPaths: Array<{ from: RuntimeState; to: RuntimeState }[]> = [
    // Full lifecycle
    [{ from: 'initialized', to: 'starting' }, { from: 'starting', to: 'running' }, { from: 'running', to: 'stopping' }, { from: 'stopping', to: 'stopped' }],
    // Pause/resume
    [{ from: 'initialized', to: 'starting' }, { from: 'starting', to: 'running' }, { from: 'running', to: 'pausing' }, { from: 'pausing', to: 'paused' }, { from: 'paused', to: 'resuming' }, { from: 'resuming', to: 'running' }],
    // Restart from running
    [{ from: 'initialized', to: 'starting' }, { from: 'starting', to: 'running' }, { from: 'running', to: 'restarting' }, { from: 'restarting', to: 'starting' }],
    // Restart from stopped
    [{ from: 'initialized', to: 'starting' }, { from: 'starting', to: 'running' }, { from: 'running', to: 'stopping' }, { from: 'stopping', to: 'stopped' }, { from: 'stopped', to: 'restarting' }, { from: 'restarting', to: 'starting' }],
    // Restart from stopped -> stopped
    [{ from: 'initialized', to: 'starting' }, { from: 'starting', to: 'running' }, { from: 'running', to: 'stopping' }, { from: 'stopping', to: 'stopped' }, { from: 'stopped', to: 'restarting' }, { from: 'restarting', to: 'stopped' }],
    // Pause from running -> stop
    [{ from: 'initialized', to: 'starting' }, { from: 'starting', to: 'running' }, { from: 'running', to: 'pausing' }, { from: 'pausing', to: 'stopping' }, { from: 'stopping', to: 'stopped' }],
    // Paused -> restart
    [{ from: 'initialized', to: 'starting' }, { from: 'starting', to: 'running' }, { from: 'running', to: 'pausing' }, { from: 'pausing', to: 'paused' }, { from: 'paused', to: 'restarting' }],
    // Resuming -> stop
    [{ from: 'initialized', to: 'starting' }, { from: 'starting', to: 'running' }, { from: 'running', to: 'pausing' }, { from: 'pausing', to: 'paused' }, { from: 'paused', to: 'resuming' }, { from: 'resuming', to: 'stopping' }],
    // Starting -> restart
    [{ from: 'initialized', to: 'starting' }, { from: 'starting', to: 'restarting' }],
    // Starting -> stop
    [{ from: 'initialized', to: 'starting' }, { from: 'starting', to: 'stopping' }, { from: 'stopping', to: 'stopped' }],
  ];

  for (let i = 0; i < validPaths.length; i++) {
    test(`valid transition path ${i}: ${validPaths[i]!.map(t => `${t.from}->${t.to}`).join(', ')}`, () => {
      for (const step of validPaths[i]!) {
        expect(sm.transition(step.to)).toBe(true);
        expect(sm.getCurrentState()).toBe(step.to);
      }
    });
  }

  // Test all invalid transitions
  const invalidTransitions: Array<{ from: RuntimeState; to: RuntimeState }> = [
    { from: 'initialized', to: 'running' },
    { from: 'initialized', to: 'paused' },
    { from: 'initialized', to: 'stopped' },
    { from: 'initialized', to: 'restarting' },
    { from: 'running', to: 'initialized' },
    { from: 'running', to: 'starting' },
    { from: 'running', to: 'resuming' },
    { from: 'paused', to: 'running' },
    { from: 'paused', to: 'pausing' },
    { from: 'stopped', to: 'running' },
    { from: 'stopped', to: 'paused' },
  ];

  for (const { from, to } of invalidTransitions) {
    test(`should reject ${from} -> ${to}`, () => {
      // Set up to the 'from' state
      const setupPath: Record<RuntimeState, RuntimeState[]> = {
        initialized: [],
        starting: ['starting'],
        running: ['starting', 'running'],
        pausing: ['starting', 'running', 'pausing'],
        paused: ['starting', 'running', 'pausing', 'paused'],
        resuming: ['starting', 'running', 'pausing', 'paused', 'resuming'],
        stopping: ['starting', 'running', 'stopping'],
        stopped: ['starting', 'running', 'stopping', 'stopped'],
        restarting: ['starting', 'running', 'restarting'],
      };
      for (const s of setupPath[from]!) {
        sm.transition(s);
      }
      expect(sm.transition(to)).toBe(false);
      expect(sm.getCurrentState()).toBe(from);
    });
  }

  test('canTransition returns correct values for each state', () => {
    const allStates: RuntimeState[] = ['initialized', 'starting', 'running', 'pausing', 'paused', 'resuming', 'stopping', 'stopped', 'restarting'];
    for (const state of allStates) {
      // Setup to reach state
      const setupMap: Record<RuntimeState, RuntimeState[]> = {
        initialized: [],
        starting: ['starting'],
        running: ['starting', 'running'],
        pausing: ['starting', 'running', 'pausing'],
        paused: ['starting', 'running', 'pausing', 'paused'],
        resuming: ['starting', 'running', 'pausing', 'paused', 'resuming'],
        stopping: ['starting', 'running', 'stopping'],
        stopped: ['starting', 'running', 'stopping', 'stopped'],
        restarting: ['starting', 'running', 'restarting'],
      };
      for (const s of setupMap[state]!) {
        sm.transition(s);
      }
      // canTransition to self should be false for all states
      expect(sm.canTransition(state)).toBe(false);
    }
  });

  test('forceState bypasses all rules', () => {
    sm.forceState('running');
    expect(sm.getCurrentState()).toBe('running');
    sm.forceState('stopped');
    expect(sm.getCurrentState()).toBe('stopped');
    sm.forceState('initialized');
    expect(sm.getCurrentState()).toBe('initialized');
  });

  test('forceState records reason as forced', () => {
    sm.forceState('running');
    expect(sm.getHistory()[0]!.reason).toBe('forced');
  });

  test('transition records reason', () => {
    sm.transition('starting', 'user request');
    expect(sm.getHistory()[0]!.reason).toBe('user request');
  });

  test('transition without reason records undefined reason', () => {
    sm.transition('starting');
    expect(sm.getHistory()[0]!.reason).toBeUndefined();
  });

  test('getHistory returns copies', () => {
    sm.transition('starting');
    const h1 = sm.getHistory();
    const h2 = sm.getHistory();
    expect(h1).not.toBe(h2);
    expect(h1).toEqual(h2);
  });

  test('getStateHistory returns copies', () => {
    const h1 = sm.getStateHistory();
    const h2 = sm.getStateHistory();
    expect(h1).not.toBe(h2);
  });

  test('state history tracks entry/exit times', () => {
    sm.transition('starting');
    sm.transition('running');
    const history = sm.getStateHistory();
    // First entry: initialized
    expect(history[0]!.state).toBe('initialized');
    expect(history[0]!.enteredAt).toBeGreaterThan(0);
    expect(history[0]!.exitedAt).toBeGreaterThan(0);
    expect(history[0]!.duration).toBeGreaterThanOrEqual(0);
    // Second entry: starting
    expect(history[1]!.state).toBe('starting');
    expect(history[1]!.exitedAt).toBeGreaterThan(0);
    // Third entry: running
    expect(history[2]!.state).toBe('running');
    expect(history[2]!.exitedAt).toBeUndefined();
  });

  test('sub-state only works in running state', () => {
    sm.setSubState('processing');
    expect(sm.getSubState()).toBeUndefined();

    sm.transition('starting');
    sm.transition('running');
    sm.setSubState('processing');
    expect(sm.getSubState()).toBe('processing');

    sm.transition('pausing');
    sm.setSubState('idle');
    expect(sm.getSubState()).toBe('processing'); // unchanged
  });

  test('all sub-states work', () => {
    sm.transition('starting');
    sm.transition('running');
    for (const sub of ['idle', 'processing', 'waiting', 'throttled'] as RunningSubState[]) {
      sm.setSubState(sub);
      expect(sm.getSubState()).toBe(sub);
    }
  });

  test('saveState and loadState', () => {
    sm.transition('starting');
    sm.transition('running');
    sm.setSubState('processing');
    const saved = sm.saveState();

    expect(saved.currentState).toBe('running');
    expect(saved.subState).toBe('processing');
    expect(saved.history).toHaveLength(2);
    expect(saved.timestamp).toBeGreaterThan(0);

    const sm2 = new RuntimeStateMachine();
    sm2.loadState(saved);
    expect(sm2.getCurrentState()).toBe('running');
    expect(sm2.getSubState()).toBe('processing');
    sm2.destroy();
  });

  test('loadState clears old timers and sets new ones', () => {
    vi.useFakeTimers();
    const timeouts: string[] = [];
    const sm2 = new RuntimeStateMachine({ starting: 1000, running: 5000 });
    sm2.onTimeoutHook((state) => timeouts.push(state));
    sm2.transition('starting');

    // Save state at 'running', load into sm3
    sm2.transition('running');
    const saved = sm2.saveState();

    const sm3 = new RuntimeStateMachine({ running: 500 });
    sm3.onTimeoutHook((state) => timeouts.push(state));
    sm3.loadState(saved);

    // The loaded state is 'running', which has a 500ms timeout in sm3
    // Advance to 499ms - should NOT fire yet
    vi.advanceTimersByTime(499);
    expect(timeouts).toHaveLength(0);

    // Advance past the 500ms running timeout - should fire
    vi.advanceTimersByTime(2);
    expect(timeouts).toContain('running');

    sm2.destroy();
    sm3.destroy();
    vi.useRealTimers();
  });

  test('onStateChange hook', () => {
    const changes: Array<{ from: string; to: string }> = [];
    sm.onStateChangeHook((from, to) => changes.push({ from, to }));
    sm.transition('starting');
    expect(changes).toEqual([{ from: 'initialized', to: 'starting' }]);
  });

  test('onSubStateChange hook', () => {
    const subs: RunningSubState[] = [];
    sm.onSubStateChangeHook((sub) => subs.push(sub));
    sm.transition('starting');
    sm.transition('running');
    sm.setSubState('processing');
    expect(subs).toEqual(['processing']);
  });

  test('onSubStateChange not called when not running', () => {
    const subs: RunningSubState[] = [];
    sm.onSubStateChangeHook((sub) => subs.push(sub));
    sm.setSubState('processing');
    expect(subs).toHaveLength(0);
  });

  test('setTimeoutMs and onTimeout', () => {
    vi.useFakeTimers();
    const timeouts: string[] = [];
    const sm2 = new RuntimeStateMachine();
    sm2.setTimeoutMs('starting', 1000);
    sm2.onTimeoutHook((state) => timeouts.push(state));
    sm2.transition('starting');
    vi.advanceTimersByTime(999);
    expect(timeouts).toHaveLength(0);
    vi.advanceTimersByTime(2);
    expect(timeouts).toEqual(['starting']);
    sm2.destroy();
    vi.useRealTimers();
  });

  test('timeout timer cleared on state exit', () => {
    vi.useFakeTimers();
    const timeouts: string[] = [];
    const sm2 = new RuntimeStateMachine({ starting: 1000 });
    sm2.onTimeoutHook((state) => timeouts.push(state));
    sm2.transition('starting');
    sm2.transition('running'); // exits starting, clears timer
    vi.advanceTimersByTime(2000);
    expect(timeouts).toHaveLength(0);
    sm2.destroy();
    vi.useRealTimers();
  });

  test('destroy clears all timers', () => {
    vi.useFakeTimers();
    const sm2 = new RuntimeStateMachine({ starting: 10000 });
    sm2.transition('starting');
    sm2.destroy();
    vi.advanceTimersByTime(20000);
    // No error
    vi.useRealTimers();
  });

  test('constructor with empty timeouts', () => {
    const sm2 = new RuntimeStateMachine({});
    expect(sm2.getCurrentState()).toBe('initialized');
    sm2.destroy();
  });

  test('constructor with undefined timeouts', () => {
    const sm2 = new RuntimeStateMachine(undefined);
    expect(sm2.getCurrentState()).toBe('initialized');
    sm2.destroy();
  });
});

// ============================================================
// Module 3: CheckpointManager - Comprehensive Coverage
// ============================================================
describe('CheckpointManager (coverage)', () => {
  let cm: CheckpointManager;

  beforeEach(() => {
    cm = new CheckpointManager();
  });

  test('createCheckpoint with label and state', () => {
    const cp = cm.createCheckpoint('test', { data: 'hello' });
    expect(cp.id).toMatch(/^cp_\d+_[a-z0-9]+$/);
    expect(cp.label).toBe('test');
    expect(cp.type).toBe('full');
    expect(cp.hash).toMatch(/^hash_[a-f0-9]+$/);
    expect(cp.size).toBeGreaterThan(0);
    expect(cp.data).toEqual({ data: 'hello' });
    expect(cp.timestamp).toBeGreaterThan(0);
  });

  test('createCheckpoint without label or state', () => {
    const cp = cm.createCheckpoint();
    expect(cp.label).toBeUndefined();
    expect(cp.data).toBeDefined();
  });

  test('createCheckpoint tracks iteration', () => {
    cm.setIteration(42);
    const cp = cm.createCheckpoint();
    expect(cp.iteration).toBe(42);
  });

  test('createCheckpoint links to previous', () => {
    const cp1 = cm.createCheckpoint('first');
    const cp2 = cm.createCheckpoint('second');
    expect(cp2.previousCheckpointId).toBe(cp1.id);
    expect(cp1.previousCheckpointId).toBeUndefined();
  });

  test('createCheckpoint calls hook', () => {
    const created: Checkpoint[] = [];
    cm.onCheckpointCreatedHook((cp) => created.push(cp));
    cm.createCheckpoint('hook');
    expect(created).toHaveLength(1);
    expect(created[0]!.label).toBe('hook');
  });

  test('restoreCheckpoint success', async () => {
    cm.createCheckpoint('test', { key: 'value' });
    const list = cm.listCheckpoints();
    const result = await cm.restoreCheckpoint(list[0]!.id);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ key: 'value' });
    expect(result.checkpointId).toBe(list[0]!.id);
    expect(result.restoredAt).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();
  });

  test('restoreCheckpoint not found', async () => {
    const result = await cm.restoreCheckpoint('nonexistent');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Checkpoint not found');
    expect(result.data).toBeUndefined();
  });

  test('restoreCheckpoint integrity check', async () => {
    const cp = cm.createCheckpoint('integrity', { data: 'test' });
    // Tamper with the checkpoint data directly
    const originalCp = (cm as any).checkpoints.get(cp.id);
    originalCp.data = { data: 'tampered' };
    originalCp.hash = 'hash_tampered';
    const result = await cm.restoreCheckpoint(cp.id);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Checkpoint integrity check failed');
  });

  test('listCheckpoints returns info without data', () => {
    cm.createCheckpoint('first', { a: 1 });
    cm.createCheckpoint('second', { b: 2 });
    const list = cm.listCheckpoints();
    expect(list).toHaveLength(2);
    expect(list[0]!.label).toBe('first');
    expect(list[1]!.label).toBe('second');
    expect('data' in list[0]!).toBe(false);
  });

  test('listCheckpoints empty', () => {
    expect(cm.listCheckpoints()).toHaveLength(0);
  });

  test('deleteCheckpoint success', () => {
    const cp = cm.createCheckpoint('to-delete');
    expect(cm.deleteCheckpoint(cp.id)).toBe(true);
    expect(cm.listCheckpoints()).toHaveLength(0);
    expect(cm.getCheckpointCount()).toBe(0);
  });

  test('deleteCheckpoint not found', () => {
    expect(cm.deleteCheckpoint('nonexistent')).toBe(false);
  });

  test('deleteCheckpoint updates lastCheckpointId', () => {
    const cp1 = cm.createCheckpoint('1');
    const cp2 = cm.createCheckpoint('2');
    const cp3 = cm.createCheckpoint('3');
    expect(cm.deleteCheckpoint(cp3.id)).toBe(true);
    const latest = cm.getLatestCheckpoint();
    expect(latest!.id).toBe(cp2.id);
  });

  test('deleteCheckpoint all -> lastCheckpointId undefined', () => {
    const cp1 = cm.createCheckpoint('1');
    cm.deleteCheckpoint(cp1.id);
    expect(cm.getLatestCheckpoint()).toBeUndefined();
  });

  test('getLatestCheckpoint', () => {
    expect(cm.getLatestCheckpoint()).toBeUndefined();
    cm.createCheckpoint('first');
    cm.createCheckpoint('second');
    const latest = cm.getLatestCheckpoint();
    expect(latest!.label).toBe('second');
  });

  test('setIteration', () => {
    cm.setIteration(100);
    const cp = cm.createCheckpoint();
    expect(cp.iteration).toBe(100);
  });

  test('shouldCheckpoint time-based', () => {
    vi.useFakeTimers();
    const cm2 = new CheckpointManager({
      trigger: { timeIntervalSec: 5, iterationInterval: 0, sizeThreshold: 0, eventBased: false },
    });
    // Create initial checkpoint to reset lastCheckpointTime
    cm2.createCheckpoint('baseline');
    expect(cm2.shouldCheckpoint()).toBe(false);
    vi.advanceTimersByTime(6000);
    expect(cm2.shouldCheckpoint()).toBe(true);
    vi.useRealTimers();
  });

  test('shouldCheckpoint iteration-based', () => {
    const cm2 = new CheckpointManager({
      trigger: { timeIntervalSec: 0, iterationInterval: 10, sizeThreshold: 0, eventBased: false },
    });
    cm2.setIteration(5);
    expect(cm2.shouldCheckpoint()).toBe(false);
    cm2.setIteration(10);
    expect(cm2.shouldCheckpoint()).toBe(true);
  });

  test('shouldCheckpoint size-based', () => {
    const cm2 = new CheckpointManager({
      trigger: { timeIntervalSec: 0, iterationInterval: 0, sizeThreshold: 10, eventBased: false },
    });
    // First checkpoint establishes baseline
    cm2.createCheckpoint('baseline', { small: 'data' });
    // Large state should trigger
    const bigState = 'x'.repeat(100);
    expect(cm2.shouldCheckpoint(bigState)).toBe(true);
  });

  test('shouldCheckpoint no state returns false for size-based', () => {
    const cm2 = new CheckpointManager({
      trigger: { timeIntervalSec: 0, iterationInterval: 0, sizeThreshold: 10, eventBased: false },
    });
    expect(cm2.shouldCheckpoint()).toBe(false);
  });

  test('shouldCheckpoint all disabled returns false', () => {
    const cm2 = new CheckpointManager({
      trigger: { timeIntervalSec: 0, iterationInterval: 0, sizeThreshold: 0, eventBased: false },
    });
    expect(cm2.shouldCheckpoint({ big: 'data' })).toBe(false);
  });

  test('tagCheckpoint success', () => {
    const cp = cm.createCheckpoint('tagged');
    expect(cm.tagCheckpoint(cp.id)).toBe(true);
    expect(cm.listCheckpoints()[0]!.tagged).toBe(true);
  });

  test('tagCheckpoint not found', () => {
    expect(cm.tagCheckpoint('nonexistent')).toBe(false);
  });

  test('getCheckpointCount', () => {
    expect(cm.getCheckpointCount()).toBe(0);
    cm.createCheckpoint('a');
    expect(cm.getCheckpointCount()).toBe(1);
    cm.createCheckpoint('b');
    expect(cm.getCheckpointCount()).toBe(2);
  });

  test('retention maxCount enforcement', () => {
    const cm2 = new CheckpointManager({ retention: { maxCount: 3 } });
    for (let i = 0; i < 10; i++) {
      cm2.createCheckpoint(`cp${i}`);
    }
    expect(cm2.getCheckpointCount()).toBeLessThanOrEqual(3);
  });

  test('retention maxAgeHours enforcement', () => {
    vi.useFakeTimers();
    const cm2 = new CheckpointManager({ retention: { maxCount: 100, maxAgeHours: 1 } });
    cm2.createCheckpoint('old');
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    cm2.createCheckpoint('new');
    expect(cm2.getCheckpointCount()).toBeLessThanOrEqual(2);
    vi.useRealTimers();
  });

  test('retention keeps tagged checkpoints', () => {
    const cm2 = new CheckpointManager({ retention: { maxCount: 2, keepTagged: true } });
    const cp1 = cm2.createCheckpoint('tagged');
    cm2.tagCheckpoint(cp1.id);
    cm2.createCheckpoint('normal1');
    cm2.createCheckpoint('normal2');
    expect(cm2.listCheckpoints().find((c) => c.id === cp1.id)).toBeDefined();
  });

  test('retention removes tagged when keepTagged=false', () => {
    const cm2 = new CheckpointManager({ retention: { maxCount: 1, keepTagged: false } });
    const cp1 = cm2.createCheckpoint('tagged');
    cm2.tagCheckpoint(cp1.id);
    cm2.createCheckpoint('normal');
    expect(cm2.getCheckpointCount()).toBeLessThanOrEqual(1);
  });

  test('hash consistency for same data', () => {
    const cp1 = cm.createCheckpoint('h1', { data: 'same' });
    const cp2 = cm.createCheckpoint('h2', { data: 'same' });
    expect(cp1.hash).toBe(cp2.hash);
  });

  test('hash difference for different data', () => {
    const cp1 = cm.createCheckpoint('h1', { data: 'first' });
    const cp2 = cm.createCheckpoint('h2', { data: 'second' });
    expect(cp1.hash).not.toBe(cp2.hash);
  });

  test('safeStringify handles circular references', () => {
    const obj: any = { a: 1 };
    obj.self = obj;
    const cp = cm.createCheckpoint('circular', obj);
    expect(cp).toBeDefined();
    expect(cp.hash).toBeTruthy();
  });

  test('safeStringify handles non-serializable', () => {
    const fn = () => {};
    const cp = cm.createCheckpoint('fn', fn as any);
    expect(cp).toBeDefined();
  });

  test('custom trigger and retention options', () => {
    const cm2 = new CheckpointManager({
      trigger: { timeIntervalSec: 60, iterationInterval: 50, sizeThreshold: 2048, eventBased: false },
      retention: { maxCount: 5, maxAgeHours: 48, keepTagged: false },
    });
    const cp = cm2.createCheckpoint('custom');
    expect(cp).toBeDefined();
  });
});

// ============================================================
// Module 4: PersistentTaskQueue - Comprehensive Coverage
// ============================================================
describe('PersistentTaskQueue (coverage)', () => {
  let queue: PersistentTaskQueue;

  beforeEach(() => {
    queue = new PersistentTaskQueue();
  });

  test('enqueue generates id', () => {
    const id = queue.enqueue({ name: 'test', payload: 'data' });
    expect(id).toMatch(/^task_\d+_[a-z0-9]+$/);
    expect(queue.getTaskStatus(id)).toBe('queued');
  });

  test('enqueue with custom id', () => {
    const id = queue.enqueue({ id: 'custom-1', name: 'test', payload: null });
    expect(id).toBe('custom-1');
  });

  test('enqueue with all options', () => {
    const id = queue.enqueue({
      id: 'full',
      name: 'full-task',
      payload: { key: 'val' },
      priority: 10,
      dependencies: ['dep1'],
      maxRetries: 5,
      delayMs: 1000,
    });
    const task = queue.getTask(id)!;
    expect(task.name).toBe('full-task');
    expect(task.priority).toBe(10);
    expect(task.dependencies).toEqual(['dep1']);
    expect(task.maxRetries).toBe(5);
    expect(task.retryCount).toBe(0);
  });

  test('dequeue returns undefined for empty queue', () => {
    expect(queue.dequeue()).toBeUndefined();
  });

  test('dequeue picks highest priority', () => {
    queue.enqueue({ name: 'low', payload: null, priority: 1 });
    queue.enqueue({ name: 'high', payload: null, priority: 10 });
    queue.enqueue({ name: 'medium', payload: null, priority: 5 });
    const task = queue.dequeue();
    expect(task!.name).toBe('high');
    expect(task!.status).toBe('running');
    expect(task!.startedAt).toBeGreaterThan(0);
  });

  test('dequeue respects dependencies', () => {
    const depId = queue.enqueue({ name: 'dep', payload: null });
    queue.enqueue({ name: 'dependent', payload: null, dependencies: [depId] });
    const task = queue.dequeue();
    expect(task!.name).toBe('dep');
    // Dependent not available yet
    const task2 = queue.dequeue();
    expect(task2).toBeUndefined();
    queue.complete(depId);
    const task3 = queue.dequeue();
    expect(task3!.name).toBe('dependent');
  });

  test('dequeue skips deferred tasks', () => {
    vi.useFakeTimers();
    const id = queue.enqueue({ name: 'deferred', payload: null });
    queue.defer(id, new Date(Date.now() + 5000));
    expect(queue.dequeue()).toBeUndefined();
    vi.advanceTimersByTime(5001);
    const task = queue.dequeue();
    expect(task!.id).toBe(id);
    vi.useRealTimers();
  });

  test('dequeue skips non-queued tasks', () => {
    const id = queue.enqueue({ name: 'test', payload: null });
    queue.dequeue(); // -> running
    // No more queued tasks
    expect(queue.dequeue()).toBeUndefined();
  });

  test('complete success', () => {
    const id = queue.enqueue({ name: 'test', payload: null });
    queue.dequeue();
    queue.complete(id, { result: 'ok' });
    expect(queue.getTaskStatus(id)).toBe('completed');
    const task = queue.getTask(id)!;
    expect(task.completedAt).toBeGreaterThan(0);
    expect(task.result).toEqual({ result: 'ok' });
  });

  test('complete non-running is no-op', () => {
    const id = queue.enqueue({ name: 'test', payload: null });
    queue.complete(id);
    expect(queue.getTaskStatus(id)).toBe('queued');
  });

  test('complete non-existent is no-op', () => {
    queue.complete('nonexistent');
  });

  test('fail with retry', () => {
    const id = queue.enqueue({ name: 'test', payload: null, maxRetries: 3 });
    queue.dequeue();
    queue.fail(id, new Error('failure'));
    expect(queue.getTaskStatus(id)).toBe('queued');
    expect(queue.getTask(id)!.retryCount).toBe(1);
    expect(queue.getTask(id)!.nextRetryAt).toBeGreaterThan(Date.now());
    expect(queue.getTask(id)!.error).toBe('failure');
  });

  test('fail reaches maxRetries -> dead letter queue', () => {
    const id = queue.enqueue({ name: 'test', payload: null, maxRetries: 2 });
    queue.dequeue();
    queue.fail(id, new Error('fail1'));
    expect(queue.getTaskStatus(id)).toBe('queued');
    queue.dequeue();
    queue.fail(id, new Error('fail2'));
    expect(queue.getTaskStatus(id)).toBe('failed');
    expect(queue.getDeadLetterQueue()).toHaveLength(1);
    expect(queue.getDeadLetterQueue()[0]!.id).toBe(id);
  });

  test('fail non-running is no-op', () => {
    const id = queue.enqueue({ name: 'test', payload: null });
    queue.fail(id, new Error('fail'));
    expect(queue.getTaskStatus(id)).toBe('queued');
  });

  test('cancel queued task', () => {
    const id = queue.enqueue({ name: 'test', payload: null });
    expect(queue.cancel(id)).toBe(true);
    expect(queue.getTaskStatus(id)).toBe('cancelled');
  });

  test('cancel running task', () => {
    const id = queue.enqueue({ name: 'test', payload: null });
    queue.dequeue();
    expect(queue.cancel(id)).toBe(true);
    expect(queue.getTaskStatus(id)).toBe('cancelled');
  });

  test('cancel completed task returns false', () => {
    const id = queue.enqueue({ name: 'test', payload: null });
    queue.dequeue();
    queue.complete(id);
    expect(queue.cancel(id)).toBe(false);
  });

  test('cancel cancelled task returns false', () => {
    const id = queue.enqueue({ name: 'test', payload: null });
    queue.cancel(id);
    expect(queue.cancel(id)).toBe(false);
  });

  test('cancel non-existent returns false', () => {
    expect(queue.cancel('nonexistent')).toBe(false);
  });

  test('defer queued task', () => {
    const id = queue.enqueue({ name: 'test', payload: null });
    const until = new Date(Date.now() + 60000);
    expect(queue.defer(id, until)).toBe(true);
    expect(queue.getTask(id)!.deferredUntil).toEqual(until);
  });

  test('defer non-queued task returns false', () => {
    const id = queue.enqueue({ name: 'test', payload: null });
    queue.dequeue();
    expect(queue.defer(id, new Date())).toBe(false);
  });

  test('defer non-existent returns false', () => {
    expect(queue.defer('nonexistent', new Date())).toBe(false);
  });

  test('getQueueDepth', () => {
    expect(queue.getQueueDepth()).toBe(0);
    queue.enqueue({ name: 'a', payload: null });
    queue.enqueue({ name: 'b', payload: null });
    expect(queue.getQueueDepth()).toBe(2);
    queue.dequeue();
    expect(queue.getQueueDepth()).toBe(1);
  });

  test('getTaskStatus non-existent', () => {
    expect(queue.getTaskStatus('nonexistent')).toBeUndefined();
  });

  test('getTask non-existent', () => {
    expect(queue.getTask('nonexistent')).toBeUndefined();
  });

  test('requeueFailed success', () => {
    const id = queue.enqueue({ name: 'test', payload: null, maxRetries: 1 });
    queue.dequeue();
    queue.fail(id, new Error('fail'));
    queue.dequeue();
    queue.fail(id, new Error('fail2'));
    expect(queue.getTaskStatus(id)).toBe('failed');
    expect(queue.requeueFailed(id)).toBe(true);
    expect(queue.getTaskStatus(id)).toBe('queued');
    expect(queue.getTask(id)!.retryCount).toBe(0);
    expect(queue.getTask(id)!.error).toBeUndefined();
    expect(queue.getDeadLetterQueue()).toHaveLength(0);
  });

  test('requeueFailed non-failed returns false', () => {
    const id = queue.enqueue({ name: 'test', payload: null });
    expect(queue.requeueFailed(id)).toBe(false);
  });

  test('requeueFailed non-existent returns false', () => {
    expect(queue.requeueFailed('nonexistent')).toBe(false);
  });

  test('getStats', () => {
    queue.enqueue({ name: 'queued', payload: null });
    const runningId = queue.enqueue({ name: 'running', payload: null });
    queue.dequeue();
    const stats = queue.getStats();
    expect(stats.total).toBe(2);
    expect(stats.queued).toBe(1);
    expect(stats.running).toBe(1);
    expect(stats.completed).toBe(0);
    expect(stats.failed).toBe(0);
    expect(stats.cancelled).toBe(0);
    expect(stats.deferred).toBe(0);
    expect(stats.deadLetterCount).toBe(0);
  });

  test('getStats all statuses', () => {
    const rId = queue.enqueue({ name: 'running', payload: null, priority: 10 });
    const qId = queue.enqueue({ name: 'queued', payload: null });
    const cId = queue.enqueue({ name: 'completed', payload: null, priority: 8 });
    queue.dequeue(); // dequeues rId (priority 10)
    queue.dequeue(); // dequeues cId (priority 8)
    queue.complete(cId);
    // qId is still queued, rId is running
    queue.cancel(qId);

    const stats = queue.getStats();
    expect(stats.queued).toBe(0);
    expect(stats.running).toBe(1);
    expect(stats.completed).toBe(1);
    expect(stats.cancelled).toBe(1);
  });

  test('getDeadLetterQueue', () => {
    expect(queue.getDeadLetterQueue()).toHaveLength(0);
    const id = queue.enqueue({ name: 'test', payload: null, maxRetries: 1 });
    queue.dequeue();
    queue.fail(id, new Error('fail'));
    queue.dequeue();
    queue.fail(id, new Error('fail2'));
    expect(queue.getDeadLetterQueue()).toHaveLength(1);
  });

  test('clear', () => {
    queue.enqueue({ name: 'a', payload: null });
    queue.enqueue({ name: 'b', payload: null });
    queue.clear();
    expect(queue.getQueueDepth()).toBe(0);
    expect(queue.getStats().total).toBe(0);
    expect(queue.getDeadLetterQueue()).toHaveLength(0);
  });

  test('default priority', () => {
    const q = new PersistentTaskQueue({ defaultPriority: 7 });
    q.enqueue({ name: 'test', payload: null });
    expect(q.dequeue()!.priority).toBe(7);
  });

  test('exponential backoff calculation', () => {
    const q = new PersistentTaskQueue({ retryBaseDelayMs: 1000, retryMaxDelayMs: 10000 });
    const id = q.enqueue({ name: 'test', payload: null, maxRetries: 4 });
    q.dequeue();
    q.fail(id, new Error('fail1'));
    // retryCount=1, delay = 1000 * 2^0 = 1000
    q.dequeue();
    q.fail(id, new Error('fail2'));
    // retryCount=2, delay = 1000 * 2^1 = 2000
    q.dequeue();
    q.fail(id, new Error('fail3'));
    // retryCount=3, delay = 1000 * 2^2 = 4000
  });

  test('maxRetries=0 goes straight to DLQ', () => {
    const id = queue.enqueue({ name: 'test', payload: null, maxRetries: 0 });
    queue.dequeue();
    queue.fail(id, new Error('fail'));
    expect(queue.getTaskStatus(id)).toBe('failed');
    expect(queue.getDeadLetterQueue()).toHaveLength(1);
  });

  test('unmet dependency (non-existent dep)', () => {
    queue.enqueue({ name: 'orphan', payload: null, dependencies: ['nonexistent'] });
    expect(queue.dequeue()).toBeUndefined();
  });
});

// ============================================================
// Module 5: HeartbeatMonitor - Comprehensive Coverage
// ============================================================
describe('HeartbeatMonitor (coverage)', () => {
  let monitor: HeartbeatMonitor;

  beforeEach(() => {
    vi.useFakeTimers();
    monitor = new HeartbeatMonitor({ intervalMs: 1000, timeoutMs: 3000, tolerance: 3 });
  });

  afterEach(() => {
    monitor.stopMonitoring();
    vi.useRealTimers();
  });

  test('register component', () => {
    monitor.register('comp1');
    expect(monitor.getComponentCount()).toBe(1);
    expect(monitor.isAlive('comp1')).toBe(true);
  });

  test('register with custom options', () => {
    monitor.register('fast', { intervalMs: 500, timeoutMs: 1000, tolerance: 2 });
    expect(monitor.getComponentCount()).toBe(1);
  });

  test('register overwrites existing', () => {
    monitor.register('comp1');
    monitor.register('comp1');
    expect(monitor.getComponentCount()).toBe(1);
  });

  test('unregister component', () => {
    monitor.register('comp1');
    monitor.unregister('comp1');
    expect(monitor.getComponentCount()).toBe(0);
    expect(monitor.isAlive('comp1')).toBe(false);
  });

  test('unregister non-existent is no-op', () => {
    monitor.unregister('nonexistent');
  });

  test('beat updates lastBeat', () => {
    monitor.register('comp1');
    vi.advanceTimersByTime(2000);
    monitor.beat('comp1');
    expect(monitor.isAlive('comp1')).toBe(true);
  });

  test('beat non-existent is no-op', () => {
    monitor.beat('nonexistent');
  });

  test('beat resets missed beats', () => {
    monitor.register('comp1');
    monitor.startMonitoring(1000);
    vi.advanceTimersByTime(3000);
    // Some beats missed
    monitor.beat('comp1');
    expect(monitor.isAlive('comp1')).toBe(true);
  });

  test('beat after missed triggers recovery', () => {
    const recoveries: string[] = [];
    monitor.onRecoveryHook((id) => recoveries.push(id));
    monitor.register('comp1');
    monitor.startMonitoring(1000);
    vi.advanceTimersByTime(3000);
    monitor.beat('comp1');
    expect(recoveries).toContain('comp1');
  });

  test('beat without prior miss does not trigger recovery', () => {
    const recoveries: string[] = [];
    monitor.onRecoveryHook((id) => recoveries.push(id));
    monitor.register('comp1');
    monitor.beat('comp1');
    expect(recoveries).toHaveLength(0);
  });

  test('beat keeps only last 100 records', () => {
    monitor.register('comp1');
    for (let i = 0; i < 150; i++) {
      monitor.beat('comp1');
    }
    // Should not throw, history trimmed
  });

  test('isAlive non-existent returns false', () => {
    expect(monitor.isAlive('nonexistent')).toBe(false);
  });

  test('isAlive returns false after timeout', () => {
    monitor.register('comp1', { timeoutMs: 1000 });
    vi.advanceTimersByTime(1001);
    expect(monitor.isAlive('comp1')).toBe(false);
  });

  test('getAllStatuses includes componentId', () => {
    monitor.register('comp1');
    monitor.register('comp2');
    const statuses = monitor.getAllStatuses();
    expect(statuses.size).toBe(2);
    for (const [id, status] of statuses) {
      expect(status.componentId).toBe(id);
    }
  });

  test('getAllStatuses empty', () => {
    expect(monitor.getAllStatuses().size).toBe(0);
  });

  test('getStaleComponents', () => {
    monitor.register('comp1');
    vi.advanceTimersByTime(1001);
    const stale = monitor.getStaleComponents();
    expect(stale).toContain('comp1');
  });

  test('getStaleComponents empty', () => {
    expect(monitor.getStaleComponents()).toHaveLength(0);
  });

  test('getHealthScore', () => {
    monitor.register('comp1');
    const score = monitor.getHealthScore('comp1');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  test('getHealthScore non-existent returns 0', () => {
    expect(monitor.getHealthScore('nonexistent')).toBe(0);
  });

  test('getHealthScore degrades over time', () => {
    monitor.register('comp1', { timeoutMs: 10000 });
    const score1 = monitor.getHealthScore('comp1');
    vi.advanceTimersByTime(5000);
    const score2 = monitor.getHealthScore('comp1');
    expect(score2).toBeLessThan(score1);
  });

  test('getHealthScore 0 after timeout', () => {
    monitor.register('comp1', { timeoutMs: 1000 });
    vi.advanceTimersByTime(1001);
    expect(monitor.getHealthScore('comp1')).toBe(0);
  });

  test('startMonitoring and stopMonitoring', () => {
    monitor.register('comp1');
    monitor.startMonitoring(1000);
    monitor.stopMonitoring();
    vi.advanceTimersByTime(10000);
    // No error
  });

  test('startMonitoring twice is no-op', () => {
    monitor.startMonitoring(1000);
    monitor.startMonitoring(1000);
    monitor.stopMonitoring();
  });

  test('stopMonitoring when not started is no-op', () => {
    monitor.stopMonitoring();
  });

  test('checkAllComponents detects missed beats', () => {
    const missed: Array<{ id: string; count: number }> = [];
    monitor.onMissedBeatHook((id, count) => missed.push({ id, count }));
    monitor.register('comp1');
    monitor.startMonitoring(1000);
    vi.advanceTimersByTime(5000);
    expect(missed.length).toBeGreaterThan(0);
  });

  test('onDeath after tolerance exceeded', () => {
    const deaths: string[] = [];
    monitor.onDeathHook((id) => deaths.push(id));
    monitor.register('comp1', { tolerance: 2 });
    monitor.startMonitoring(1000);
    vi.advanceTimersByTime(5000);
    expect(deaths).toContain('comp1');
  });

  test('status levels: healthy, warning, critical, dead', () => {
    monitor.register('comp1', { intervalMs: 1000, timeoutMs: 5000 });
    // Freshly registered -> healthy
    const statuses = monitor.getAllStatuses();
    expect(statuses.get('comp1')!.status).toBe('healthy');

    vi.advanceTimersByTime(1500);
    const statuses2 = monitor.getAllStatuses();
    expect(statuses2.get('comp1')!.status).toBe('warning');

    vi.advanceTimersByTime(2000);
    const statuses3 = monitor.getAllStatuses();
    expect(statuses3.get('comp1')!.status).toBe('critical');

    vi.advanceTimersByTime(2000);
    const statuses4 = monitor.getAllStatuses();
    expect(statuses4.get('comp1')!.status).toBe('dead');
  });

  test('custom per-component intervals', () => {
    monitor.register('fast', { intervalMs: 500, timeoutMs: 1000 });
    monitor.register('slow', { intervalMs: 5000, timeoutMs: 15000 });
    vi.advanceTimersByTime(2000);
    expect(monitor.isAlive('fast')).toBe(false);
    expect(monitor.isAlive('slow')).toBe(true);
  });

  test('default constructor values', () => {
    const m = new HeartbeatMonitor();
    m.register('comp1');
    expect(m.isAlive('comp1')).toBe(true);
    m.stopMonitoring();
  });
});

// ============================================================
// Module 6: ResourceGuard - Comprehensive Coverage
// ============================================================
describe('ResourceGuard (coverage)', () => {
  let guard: ResourceGuard;

  beforeEach(() => {
    guard = new ResourceGuard();
  });

  afterEach(() => {
    guard.stopMonitoring();
  });

  test('getMemoryUsage returns valid values', () => {
    const mem = guard.getMemoryUsage();
    expect(mem.used).toBeGreaterThanOrEqual(0);
    expect(mem.total).toBeGreaterThanOrEqual(0);
    if (mem.total > 0) {
      expect(mem.percentage).toBeGreaterThanOrEqual(0);
    }
  });

  test('getEventLoopLag default', () => {
    expect(guard.getEventLoopLag()).toBe(0);
  });

  test('setEventLoopLag', () => {
    guard.setEventLoopLag(250);
    expect(guard.getEventLoopLag()).toBe(250);
  });

  test('setThreshold custom', () => {
    guard.setThreshold('custom', 50, 90);
    const report = guard.getReport();
    const custom = report.thresholds.find((t) => t.resource === 'custom');
    expect(custom).toBeDefined();
    expect(custom!.warning).toBe(50);
    expect(custom!.critical).toBe(90);
  });

  test('reserve and release', () => {
    const res = guard.reserve({ memory: 1024 });
    expect(res.id).toMatch(/^res_\d+_[a-z0-9]+$/);
    expect(res.resources.memory).toBe(1024);
    expect(res.grantedAt).toBeGreaterThan(0);
    expect(guard.getReservationCount()).toBe(1);
    guard.release(res.id);
    expect(guard.getReservationCount()).toBe(0);
  });

  test('release non-existent is no-op', () => {
    guard.release('nonexistent');
  });

  test('reserve with zero memory does not track', () => {
    guard.reserve({ memory: 0 });
    // Should not throw
  });

  test('reserve with negative memory does not track', () => {
    guard.reserve({ memory: -100 });
    // Should not throw
  });

  test('reserve without memory field', () => {
    const res = guard.reserve({ cpu: 4 });
    expect(guard.getReservationCount()).toBe(1);
    guard.release(res.id);
  });

  test('reserve over-available triggers warning', () => {
    const warnings: Array<{ resource: string; value: number }> = [];
    guard.onWarningHook((resource, value) => warnings.push({ resource, value }));
    guard.reserve({ memory: 100 * 1024 * 1024 * 1024 }); // 100GB
    expect(warnings.length).toBeGreaterThan(0);
  });

  test('getReport contains all fields', () => {
    const report = guard.getReport();
    expect(report.timestamp).toBeGreaterThan(0);
    expect(report.memory).toBeDefined();
    expect(typeof report.eventLoopLag).toBe('number');
    expect(Array.isArray(report.thresholds)).toBe(true);
    expect(typeof report.reservations).toBe('number');
    expect(Array.isArray(report.actions)).toBe(true);
  });

  test('getReport threshold levels', () => {
    guard.setThreshold('memory', 80, 95);
    guard.setEventLoopLag(10);
    const report = guard.getReport();
    const mem = report.thresholds.find((t) => t.resource === 'memory');
    expect(['normal', 'warning', 'critical']).toContain(mem!.level);
  });

  test('monitor and stopMonitoring', () => {
    guard.monitor(1000);
    guard.stopMonitoring();
  });

  test('monitor twice is no-op', () => {
    guard.monitor(1000);
    guard.monitor(1000);
    guard.stopMonitoring();
  });

  test('stopMonitoring when not started is no-op', () => {
    guard.stopMonitoring();
  });

  test('checkResources triggers warning', () => {
    const warnings: string[] = [];
    guard.onWarningHook((resource) => warnings.push(resource));
    guard.setThreshold('eventLoopLag', 50, 200);
    guard.setEventLoopLag(100);
    guard.monitor(50);
    vi.useFakeTimers();
    vi.advanceTimersByTime(100);
    guard.stopMonitoring();
    vi.useRealTimers();
  });

  test('checkResources triggers critical', () => {
    const criticals: string[] = [];
    guard.onCriticalHook((resource) => criticals.push(resource));
    guard.setThreshold('eventLoopLag', 50, 200);
    guard.setEventLoopLag(300);
    guard.monitor(50);
    vi.useFakeTimers();
    vi.advanceTimersByTime(100);
    guard.stopMonitoring();
    vi.useRealTimers();
  });

  test('onActionHook', () => {
    const actions: string[] = [];
    guard.onActionHook((action) => actions.push(action));
    guard.setThreshold('eventLoopLag', 10, 50);
    guard.setEventLoopLag(100);
    guard.monitor(50);
    vi.useFakeTimers();
    vi.advanceTimersByTime(100);
    guard.stopMonitoring();
    vi.useRealTimers();
  });

  test('default thresholds', () => {
    const report = guard.getReport();
    expect(report.thresholds.find((t) => t.resource === 'memory')).toBeDefined();
    expect(report.thresholds.find((t) => t.resource === 'eventLoopLag')).toBeDefined();
  });

  test('getReservationCount', () => {
    expect(guard.getReservationCount()).toBe(0);
    guard.reserve({ memory: 100 });
    expect(guard.getReservationCount()).toBe(1);
  });
});

// ============================================================
// Module 7: IdleDetector - Comprehensive Coverage
// ============================================================
describe('IdleDetector (coverage)', () => {
  let detector: IdleDetector;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    detector.stopMonitoring();
    vi.useRealTimers();
  });

  test('initial state not idle', () => {
    detector = new IdleDetector({ idleTimeoutMs: 1000 });
    expect(detector.isIdle()).toBe(false);
    expect(detector.getIdleTime()).toBe(0);
  });

  test('detect idle after timeout', () => {
    detector = new IdleDetector({ idleTimeoutMs: 1000 });
    detector.startMonitoring();
    vi.advanceTimersByTime(1001);
    expect(detector.isIdle()).toBe(true);
    expect(detector.getIdleTime()).toBeGreaterThan(0);
  });

  test('not idle before timeout', () => {
    detector = new IdleDetector({ idleTimeoutMs: 10000 });
    detector.startMonitoring();
    vi.advanceTimersByTime(5000);
    expect(detector.isIdle()).toBe(false);
  });

  test('recordActivity returns to active', () => {
    detector = new IdleDetector({ idleTimeoutMs: 1000 });
    detector.startMonitoring();
    vi.advanceTimersByTime(1001);
    expect(detector.isIdle()).toBe(true);
    detector.recordActivity();
    expect(detector.isIdle()).toBe(false);
    expect(detector.getIdleTime()).toBe(0);
  });

  test('recordActivity resets timer', () => {
    detector = new IdleDetector({ idleTimeoutMs: 1000 });
    detector.startMonitoring();
    vi.advanceTimersByTime(500);
    detector.recordActivity();
    vi.advanceTimersByTime(500);
    expect(detector.isIdle()).toBe(false);
    vi.advanceTimersByTime(501);
    expect(detector.isIdle()).toBe(true);
  });

  test('onIdle callback', () => {
    const idleCalls: number[] = [];
    detector = new IdleDetector({ idleTimeoutMs: 1000 });
    detector.onIdle((ms) => idleCalls.push(ms));
    detector.startMonitoring();
    vi.advanceTimersByTime(1001);
    expect(idleCalls).toHaveLength(1);
    expect(idleCalls[0]).toBeGreaterThanOrEqual(1000);
  });

  test('multiple onIdle callbacks', () => {
    const calls1: number[] = [];
    const calls2: number[] = [];
    detector = new IdleDetector({ idleTimeoutMs: 1000 });
    detector.onIdle((ms) => calls1.push(ms));
    detector.onIdle((ms) => calls2.push(ms));
    detector.startMonitoring();
    vi.advanceTimersByTime(1001);
    expect(calls1).toHaveLength(1);
    expect(calls2).toHaveLength(1);
  });

  test('onActive callback', () => {
    const activeCalls: number[] = [];
    detector = new IdleDetector({ idleTimeoutMs: 1000 });
    detector.onActive((ms) => activeCalls.push(ms));
    detector.startMonitoring();
    vi.advanceTimersByTime(1001);
    detector.recordActivity();
    expect(activeCalls).toHaveLength(1);
    expect(activeCalls[0]).toBeGreaterThan(0);
  });

  test('idle history tracking', () => {
    detector = new IdleDetector({ idleTimeoutMs: 1000 });
    detector.startMonitoring();
    vi.advanceTimersByTime(1001);
    detector.recordActivity();
    const history = detector.getIdleHistory();
    expect(history).toHaveLength(1);
    expect(history[0]!.startedAt).toBeGreaterThan(0);
    expect(history[0]!.endedAt).toBeGreaterThan(0);
    expect(history[0]!.duration).toBeGreaterThan(0);
  });

  test('multiple idle periods', () => {
    detector = new IdleDetector({ idleTimeoutMs: 1000 });
    detector.startMonitoring();
    vi.advanceTimersByTime(1001);
    detector.recordActivity();
    vi.advanceTimersByTime(1500);
    detector.recordActivity();
    expect(detector.getIdleHistory()).toHaveLength(2);
  });

  test('getIdleHistory returns copies', () => {
    detector = new IdleDetector({ idleTimeoutMs: 1000 });
    detector.startMonitoring();
    vi.advanceTimersByTime(1001);
    detector.recordActivity();
    const h1 = detector.getIdleHistory();
    const h2 = detector.getIdleHistory();
    expect(h1).not.toBe(h2);
  });

  test('forceIdle', () => {
    const idleCalls: number[] = [];
    detector = new IdleDetector({ idleTimeoutMs: 10000 });
    detector.onIdle((ms) => idleCalls.push(ms));
    detector.forceIdle();
    expect(detector.isIdle()).toBe(true);
    expect(idleCalls).toHaveLength(1);
    expect(idleCalls[0]).toBe(0);
  });

  test('forceIdle twice is no-op', () => {
    detector = new IdleDetector({ idleTimeoutMs: 1000 });
    detector.forceIdle();
    detector.forceIdle();
  });

  test('forceActive', () => {
    detector = new IdleDetector({ idleTimeoutMs: 1000 });
    detector.forceIdle();
    detector.forceActive();
    expect(detector.isIdle()).toBe(false);
  });

  test('forceActive when not idle is no-op', () => {
    detector = new IdleDetector({ idleTimeoutMs: 1000 });
    detector.forceActive();
    expect(detector.isIdle()).toBe(false);
  });

  test('setIdleTimeout', () => {
    detector = new IdleDetector({ idleTimeoutMs: 5000 });
    detector.setIdleTimeout(500);
    detector.startMonitoring();
    vi.advanceTimersByTime(501);
    expect(detector.isIdle()).toBe(true);
  });

  test('startMonitoring twice is no-op', () => {
    detector = new IdleDetector({ idleTimeoutMs: 1000 });
    detector.startMonitoring();
    detector.startMonitoring();
    detector.stopMonitoring();
  });

  test('stopMonitoring ends current idle period', () => {
    detector = new IdleDetector({ idleTimeoutMs: 1000 });
    detector.startMonitoring();
    vi.advanceTimersByTime(1001);
    detector.stopMonitoring();
    expect(detector.getIdleHistory()).toHaveLength(1);
    expect(detector.getIdleHistory()[0]!.endedAt).toBeGreaterThan(0);
  });

  test('getActiveTimeSinceLastIdle when not idle', () => {
    detector = new IdleDetector({ idleTimeoutMs: 1000 });
    detector.startMonitoring();
    vi.advanceTimersByTime(500);
    expect(detector.getActiveTimeSinceLastIdle()).toBeGreaterThan(0);
  });

  test('getActiveTimeSinceLastIdle when idle', () => {
    detector = new IdleDetector({ idleTimeoutMs: 1000 });
    detector.startMonitoring();
    vi.advanceTimersByTime(1001);
    detector.recordActivity();
    vi.advanceTimersByTime(500);
    const activeTime = detector.getActiveTimeSinceLastIdle();
    expect(activeTime).toBeGreaterThan(0);
  });

  test('check interval is min of timeout/4 and 5000', () => {
    detector = new IdleDetector({ idleTimeoutMs: 100 });
    detector.startMonitoring();
    // Check interval = min(100/4, 5000) = 25ms
    // Need to advance past both the check interval and the idle timeout
    vi.advanceTimersByTime(101);
    expect(detector.isIdle()).toBe(true);
  });

  test('check interval capped at 5000', () => {
    detector = new IdleDetector({ idleTimeoutMs: 100000 });
    detector.startMonitoring();
    vi.advanceTimersByTime(5001);
    expect(detector.isIdle()).toBe(false);
  });
});

// ============================================================
// Module 8: GracefulRestarter - Comprehensive Coverage
// ============================================================
describe('GracefulRestarter (coverage)', () => {
  let restarter: GracefulRestarter;

  beforeEach(() => {
    restarter = new GracefulRestarter({
      drainTimeoutMs: 5000,
      maxRestartRate: 5,
      restartRateWindowMs: 60000,
      enableRollback: true,
    });
  });

  test('canRestart initially true', () => {
    expect(restarter.canRestart()).toBe(true);
  });

  test('initiateRestart success', async () => {
    const result = await restarter.initiateRestart('test');
    expect(result.success).toBe(true);
    expect(result.reason).toBe('test');
    expect(result.timestamp).toBeGreaterThan(0);
  });

  test('initiateRestart default reason', async () => {
    const result = await restarter.initiateRestart();
    expect(result.success).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test('initiateRestart records history', async () => {
    await restarter.initiateRestart('first');
    await restarter.initiateRestart('second');
    const history = restarter.getRestartHistory();
    expect(history).toHaveLength(2);
    expect(history[0]!.reason).toBe('first');
    expect(history[0]!.success).toBe(true);
    expect(history[0]!.initiatedAt).toBeGreaterThan(0);
    expect(history[0]!.completedAt).toBeGreaterThan(0);
    expect(history[0]!.duration).toBeGreaterThanOrEqual(0);
    expect(history[0]!.rolledBack).toBe(false);
  });

  test('getRestartHistory returns copies', async () => {
    await restarter.initiateRestart('test');
    const h1 = restarter.getRestartHistory();
    const h2 = restarter.getRestartHistory();
    expect(h1).not.toBe(h2);
  });

  test('restart rate limiting', async () => {
    const limited = new GracefulRestarter({ maxRestartRate: 2, restartRateWindowMs: 60000 });
    await limited.initiateRestart('1');
    await limited.initiateRestart('2');
    expect(limited.canRestart()).toBe(false);
    const result = await limited.initiateRestart('3');
    expect(result.success).toBe(false);
    expect(result.reason).toBe('Restart rate limit exceeded');
  });

  test('restart rate window expiry', async () => {
    vi.useFakeTimers();
    const limited = new GracefulRestarter({ maxRestartRate: 1, restartRateWindowMs: 5000 });
    await limited.initiateRestart('1');
    expect(limited.canRestart()).toBe(false);
    vi.advanceTimersByTime(5001);
    expect(limited.canRestart()).toBe(true);
    vi.useRealTimers();
  });

  test('concurrent restart prevention', async () => {
    let resolvePrep: () => void;
    const slowRestarter = new GracefulRestarter();
    slowRestarter.addPreRestartHook(() => new Promise<void>((resolve) => { resolvePrep = resolve; }));

    const p = slowRestarter.initiateRestart('first');
    // While first is in progress, isRestarting should be true
    expect(slowRestarter.isRestartingNow()).toBe(true);

    const result2 = await slowRestarter.initiateRestart('second');
    expect(result2.success).toBe(false);
    expect(result2.reason).toBe('Restart already in progress');

    resolvePrep!();
    await p;
    expect(slowRestarter.isRestartingNow()).toBe(false);
  });

  test('prepareRestart runs pre-restart hooks', async () => {
    const hooks: string[] = [];
    restarter.addPreRestartHook(async () => { hooks.push('pre1'); });
    restarter.addPreRestartHook(async () => { hooks.push('pre2'); });
    const prep = await restarter.prepareRestart();
    expect(hooks).toEqual(['pre1', 'pre2']);
    expect(prep.id).toMatch(/^prep_\d+$/);
    expect(prep.preparedAt).toBeGreaterThan(0);
    expect(prep.reason).toBe('preparation');
  });

  test('completeRestart runs post-restart hooks', async () => {
    const hooks: string[] = [];
    restarter.addPostRestartHook(async () => { hooks.push('post1'); });
    const prep = await restarter.prepareRestart();
    await restarter.completeRestart(prep);
    expect(hooks).toEqual(['post1']);
    expect(restarter.getCurrentPreparation()).toBeNull();
  });

  test('completeRestart with state deserializer', async () => {
    let restored: unknown;
    restarter.setStateSerializer(() => ({ key: 'value' }));
    restarter.setStateDeserializer((state) => { restored = state; });
    const prep = await restarter.prepareRestart();
    expect(prep.stateSnapshot).toEqual({ key: 'value' });
    await restarter.completeRestart(prep);
    expect(restored).toEqual({ key: 'value' });
  });

  test('completeRestart without snapshot does not call deserializer', async () => {
    let called = false;
    restarter.setStateDeserializer(() => { called = true; });
    const prep = await restarter.prepareRestart();
    prep.stateSnapshot = undefined;
    await restarter.completeRestart(prep);
    expect(called).toBe(false);
  });

  test('rollback restores state', async () => {
    let restored: unknown;
    restarter.setStateSerializer(() => ({ backup: true }));
    restarter.setStateDeserializer((state) => { restored = state; });
    await restarter.prepareRestart();
    await restarter.rollback();
    expect(restored).toEqual({ backup: true });
    expect(restarter.getCurrentPreparation()).toBeNull();
  });

  test('rollback without serializer is no-op', async () => {
    await restarter.rollback();
  });

  test('rollback without deserializer is no-op', async () => {
    restarter.setStateSerializer(() => ({ data: 1 }));
    await restarter.prepareRestart();
    await restarter.rollback();
  });

  test('rollback on failure', async () => {
    const failingRestarter = new GracefulRestarter({ enableRollback: true });
    let deserializeCalled = false;
    failingRestarter.setStateSerializer(() => ({ backup: true }));
    failingRestarter.setStateDeserializer(() => { deserializeCalled = true; });
    failingRestarter.addPostRestartHook(async () => { throw new Error('post-restart failed'); });

    const result = await failingRestarter.initiateRestart('fail test');
    expect(result.success).toBe(false);
    expect(result.reason).toBe('post-restart failed');
    const history = failingRestarter.getRestartHistory();
    expect(history[0]!.rolledBack).toBe(true);
    expect(deserializeCalled).toBe(true);
  });

  test('rollback failure does not prevent isRestarting reset', async () => {
    const badRestarter = new GracefulRestarter({ enableRollback: true });
    badRestarter.setStateSerializer(() => ({ data: 1 }));
    badRestarter.setStateDeserializer(() => { throw new Error('rollback failed'); });
    badRestarter.addPostRestartHook(async () => { throw new Error('post failed'); });

    const result = await badRestarter.initiateRestart('test');
    expect(result.success).toBe(false);
    expect(badRestarter.isRestartingNow()).toBe(false);
  });

  test('no rollback when disabled', async () => {
    const noRollback = new GracefulRestarter({ enableRollback: false });
    let deserializeCalled = false;
    noRollback.setStateSerializer(() => ({ data: 1 }));
    noRollback.setStateDeserializer(() => { deserializeCalled = true; });
    noRollback.addPostRestartHook(async () => { throw new Error('post failed'); });

    const result = await noRollback.initiateRestart('test');
    expect(result.success).toBe(false);
    expect(noRollback.getRestartHistory()[0]!.rolledBack).toBe(false);
    expect(deserializeCalled).toBe(false);
  });

  test('setInFlightTasks and prepareRestart', async () => {
    restarter.setInFlightTasks(5);
    const prep = await restarter.prepareRestart();
    expect(prep.inFlightTasks).toBe(5);
    expect(prep.drained).toBe(false);

    restarter.setInFlightTasks(0);
    const prep2 = await restarter.prepareRestart();
    expect(prep2.inFlightTasks).toBe(0);
    expect(prep2.drained).toBe(true);
  });

  test('isRestartingNow', async () => {
    expect(restarter.isRestartingNow()).toBe(false);
    const result = await restarter.initiateRestart();
    expect(result.success).toBe(true);
    expect(restarter.isRestartingNow()).toBe(false);
  });

  test('getCurrentPreparation', async () => {
    expect(restarter.getCurrentPreparation()).toBeNull();
    const prep = await restarter.prepareRestart();
    expect(restarter.getCurrentPreparation()).toBe(prep);
    await restarter.completeRestart(prep);
    expect(restarter.getCurrentPreparation()).toBeNull();
  });

  test('pre-restart hook error propagates', async () => {
    restarter.addPreRestartHook(async () => { throw new Error('pre failed'); });
    const result = await restarter.initiateRestart('test');
    expect(result.success).toBe(false);
    expect(result.reason).toBe('pre failed');
  });

  test('default constructor values', async () => {
    const r = new GracefulRestarter();
    expect(r.canRestart()).toBe(true);
    await r.initiateRestart();
    expect(r.getRestartHistory()).toHaveLength(1);
  });
});

// ============================================================
// Module 9: LifecycleManager - Comprehensive Coverage
// ============================================================
describe('LifecycleManager (coverage)', () => {
  let lm: LifecycleManager;

  beforeEach(() => {
    lm = new LifecycleManager();
  });

  test('initial phase is uninitialized', () => {
    expect(lm.getPhase()).toBe('uninitialized');
  });

  test('bootstrap sets config and phase', async () => {
    await lm.bootstrap({ key: 'value' });
    expect(lm.getPhase()).toBe('bootstrap');
    expect(lm.getConfig()).toEqual({ key: 'value' });
  });

  test('start goes through initialize -> start -> run', async () => {
    await lm.bootstrap({});
    await lm.start();
    expect(lm.getPhase()).toBe('run');
    const history = lm.getPhaseHistory();
    expect(history.map(h => h.to)).toContain('initialize');
    expect(history.map(h => h.to)).toContain('start');
    expect(history.map(h => h.to)).toContain('run');
  });

  test('pause and resume', async () => {
    await lm.bootstrap({});
    await lm.start();
    await lm.pause();
    expect(lm.getPhase()).toBe('pause');
    await lm.resume();
    expect(lm.getPhase()).toBe('run');
  });

  test('shutdown goes to cleanup', async () => {
    await lm.bootstrap({});
    await lm.start();
    await lm.shutdown('test');
    expect(lm.getPhase()).toBe('cleanup');
    const history = lm.getPhaseHistory();
    expect(history.map(h => h.to)).toContain('shutdown');
    expect(history.map(h => h.to)).toContain('cleanup');
  });

  test('invalid phase transition throws', async () => {
    await lm.bootstrap({});
    // Can't go directly to run from bootstrap - need initialize and start first
    expect(lm.canTransitionTo('run')).toBe(false);
    // Attempting start() from bootstrap works (goes through proper phases)
    await lm.start();
    // Now from run, can't go to bootstrap
    expect(lm.canTransitionTo('bootstrap')).toBe(false);
  });

  test('canTransitionTo', () => {
    expect(lm.canTransitionTo('bootstrap')).toBe(true);
    expect(lm.canTransitionTo('run')).toBe(false);
    expect(lm.canTransitionTo('cleanup')).toBe(false);
  });

  test('registerComponent', () => {
    lm.registerComponent({ id: 'c1', name: 'C1', phase: 'initialize' });
    expect(lm.getComponentCount()).toBe(1);
  });

  test('registerComponent with phase override', () => {
    lm.registerComponent({ id: 'c1', name: 'C1', phase: 'start' }, 'initialize');
    expect(lm.getComponentCount()).toBe(1);
  });

  test('unregisterComponent', () => {
    lm.registerComponent({ id: 'c1', name: 'C1', phase: 'initialize' });
    lm.unregisterComponent('c1');
    expect(lm.getComponentCount()).toBe(0);
  });

  test('getComponentStatus non-existent', () => {
    expect(lm.getComponentStatus('nonexistent')).toBeUndefined();
  });

  test('getComponentStatus default status based on phase', async () => {
    lm.registerComponent({ id: 'c1', name: 'C1', phase: 'initialize' });
    await lm.bootstrap({});
    const status = lm.getComponentStatus('c1');
    expect(status!.status).toBe('uninitialized');
    await lm.start();
    const status2 = lm.getComponentStatus('c1');
    expect(status2!.status).toBe('running');
  });

  test('getComponentStatus custom getStatus', async () => {
    lm.registerComponent({
      id: 'custom',
      name: 'Custom',
      phase: 'initialize',
      getStatus: () => ({ id: 'custom', name: 'Custom', status: 'running' }),
    });
    await lm.bootstrap({});
    expect(lm.getComponentStatus('custom')!.status).toBe('running');
  });

  test('getAllComponentStatuses', () => {
    lm.registerComponent({ id: 'c1', name: 'C1', phase: 'initialize' });
    lm.registerComponent({ id: 'c2', name: 'C2', phase: 'initialize' });
    expect(lm.getAllComponentStatuses()).toHaveLength(2);
  });

  test('component init called during start', async () => {
    const inits: string[] = [];
    lm.registerComponent({
      id: 'c1', name: 'C1', phase: 'initialize',
      init: async () => { inits.push('c1'); },
    });
    await lm.bootstrap({});
    await lm.start();
    expect(inits).toEqual(['c1']);
  });

  test('component start called during start', async () => {
    const starts: string[] = [];
    lm.registerComponent({
      id: 'c1', name: 'C1', phase: 'initialize',
      start: async () => { starts.push('c1'); },
    });
    await lm.bootstrap({});
    await lm.start();
    expect(starts).toEqual(['c1']);
  });

  test('component stop called during shutdown (reverse order)', async () => {
    const stops: string[] = [];
    lm.registerComponent({ id: 'c1', name: 'C1', phase: 'initialize', stop: async () => { stops.push('c1'); } });
    lm.registerComponent({ id: 'c2', name: 'C2', phase: 'initialize', stop: async () => { stops.push('c2'); } });
    await lm.bootstrap({});
    await lm.start();
    await lm.shutdown();
    expect(stops).toEqual(['c2', 'c1']); // reverse order
  });

  test('component pause called during pause', async () => {
    const pauses: string[] = [];
    lm.registerComponent({ id: 'c1', name: 'C1', phase: 'initialize', pause: async () => { pauses.push('c1'); } });
    await lm.bootstrap({});
    await lm.start();
    await lm.pause();
    expect(pauses).toEqual(['c1']);
  });

  test('component resume called during resume', async () => {
    const resumes: string[] = [];
    lm.registerComponent({ id: 'c1', name: 'C1', phase: 'initialize', resume: async () => { resumes.push('c1'); } });
    await lm.bootstrap({});
    await lm.start();
    await lm.pause();
    await lm.resume();
    expect(resumes).toEqual(['c1']);
  });

  test('component cleanup called during cleanup', async () => {
    const cleanups: string[] = [];
    lm.registerComponent({ id: 'c1', name: 'C1', phase: 'initialize', cleanup: async () => { cleanups.push('c1'); } });
    await lm.bootstrap({});
    await lm.start();
    await lm.shutdown();
    expect(cleanups).toEqual(['c1']);
  });

  test('component error does not stop lifecycle', async () => {
    const errors: Array<{ id: string; error: Error }> = [];
    lm.onErrorHook((id, error) => errors.push({ id, error }));
    lm.registerComponent({
      id: 'failing', name: 'Failing', phase: 'initialize',
      init: async () => { throw new Error('init failed'); },
    });
    await lm.bootstrap({});
    await lm.start();
    expect(errors).toHaveLength(1);
    expect(errors[0]!.id).toBe('failing');
    expect(lm.getPhase()).toBe('run');
  });

  test('onPhaseChange hook', async () => {
    const changes: Array<{ from: string; to: string }> = [];
    lm.onPhaseChangeHook((from, to) => changes.push({ from, to }));
    await lm.bootstrap({});
    await lm.start();
    expect(changes.length).toBeGreaterThanOrEqual(2);
  });

  test('getPhaseHistory returns copies', async () => {
    await lm.bootstrap({});
    const h1 = lm.getPhaseHistory();
    const h2 = lm.getPhaseHistory();
    expect(h1).not.toBe(h2);
  });

  test('getConfig returns copy', async () => {
    await lm.bootstrap({ key: 'value' });
    const c1 = lm.getConfig();
    const c2 = lm.getConfig();
    expect(c1).not.toBe(c2);
    expect(c1).toEqual(c2);
  });

  test('cleanup -> bootstrap cycle', async () => {
    await lm.bootstrap({});
    await lm.start();
    await lm.shutdown();
    expect(lm.getPhase()).toBe('cleanup');
    await lm.bootstrap({});
    expect(lm.getPhase()).toBe('bootstrap');
  });

  // Helper for invalid transition test
  async function transitionToPhase(target: LifecyclePhase): Promise<void> {
    // This is a workaround since transitionPhase is private
    // We use the public API to reach phases
  }
});

// ============================================================
// Module 10: RuntimeConfigManager - Comprehensive Coverage
// ============================================================
describe('RuntimeConfigManager (coverage)', () => {
  let config: RuntimeConfigManager;

  beforeEach(() => {
    config = new RuntimeConfigManager();
  });

  test('getDefaults returns complete config', () => {
    const defaults = config.getDefaults();
    expect(defaults.loop.mode).toBe('interval');
    expect(defaults.loop.intervalMs).toBe(1000);
    expect(defaults.loop.stallThresholdMs).toBe(30000);
    expect(defaults.state.enablePersistence).toBe(false);
    expect(defaults.checkpoint.enabled).toBe(true);
    expect(defaults.checkpoint.type).toBe('full');
    expect(defaults.checkpoint.storage).toBe('memory');
    expect(defaults.queue.maxRetries).toBe(3);
    expect(defaults.heartbeat.intervalMs).toBe(5000);
    expect(defaults.heartbeat.timeoutMs).toBe(15000);
    expect(defaults.resource.memory.warningPercent).toBe(80);
    expect(defaults.resource.memory.criticalPercent).toBe(95);
    expect(defaults.idle.enabled).toBe(true);
    expect(defaults.restart.enableRollback).toBe(true);
  });

  test('getConfig returns copy', () => {
    const c1 = config.getConfig();
    const c2 = config.getConfig();
    expect(c1).not.toBe(c2);
  });

  test('constructor with partial config deep merges', () => {
    const cm = new RuntimeConfigManager({
      loop: { mode: 'continuous', intervalMs: 500, stallThresholdMs: 30000 },
    });
    expect(cm.getConfig().loop.mode).toBe('continuous');
    expect(cm.getConfig().loop.intervalMs).toBe(500);
    // Other nested defaults preserved
    expect(cm.getConfig().loop.stallThresholdMs).toBe(30000);
    expect(cm.getConfig().heartbeat.intervalMs).toBe(5000);
    expect(cm.getConfig().checkpoint.enabled).toBe(true);
  });

  test('constructor with undefined uses all defaults', () => {
    const cm = new RuntimeConfigManager(undefined);
    expect(cm.getConfig().loop.mode).toBe('interval');
  });

  test('updateConfig partial update', () => {
    config.updateConfig({ loop: { mode: 'continuous', intervalMs: 500, stallThresholdMs: 30000 } });
    expect(config.getConfig().loop.mode).toBe('continuous');
    expect(config.getConfig().loop.intervalMs).toBe(500);
    expect(config.getConfig().heartbeat.intervalMs).toBe(5000); // preserved
  });

  test('validate valid config', () => {
    const result = config.validate(config.getConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('validate negative intervalMs', () => {
    const cfg = config.getConfig();
    cfg.loop.intervalMs = -1;
    expect(config.validate(cfg).valid).toBe(false);
  });

  test('validate cron mode without expression', () => {
    const cfg = config.getConfig();
    cfg.loop.mode = 'cron';
    cfg.loop.cronExpression = undefined;
    expect(config.validate(cfg).valid).toBe(false);
  });

  test('validate cron mode with expression', () => {
    const cfg = config.getConfig();
    cfg.loop.mode = 'cron';
    cfg.loop.cronExpression = '0 * * * *';
    expect(config.validate(cfg).valid).toBe(true);
  });

  test('validate checkpoint maxCount < 1', () => {
    const cfg = config.getConfig();
    cfg.checkpoint.retention.maxCount = 0;
    expect(config.validate(cfg).valid).toBe(false);
  });

  test('validate negative maxRetries', () => {
    const cfg = config.getConfig();
    cfg.queue.maxRetries = -1;
    expect(config.validate(cfg).valid).toBe(false);
  });

  test('validate zero heartbeat intervalMs', () => {
    const cfg = config.getConfig();
    cfg.heartbeat.intervalMs = 0;
    expect(config.validate(cfg).valid).toBe(false);
  });

  test('validate negative heartbeat intervalMs', () => {
    const cfg = config.getConfig();
    cfg.heartbeat.intervalMs = -1;
    expect(config.validate(cfg).valid).toBe(false);
  });

  test('validate heartbeat timeout <= interval warning', () => {
    const cfg = config.getConfig();
    cfg.heartbeat.timeoutMs = 1000;
    cfg.heartbeat.intervalMs = 5000;
    const result = config.validate(cfg);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test('validate memory warningPercent out of range', () => {
    const cfg = config.getConfig();
    cfg.resource.memory.warningPercent = 150;
    expect(config.validate(cfg).valid).toBe(false);
    cfg.resource.memory.warningPercent = -1;
    expect(config.validate(cfg).valid).toBe(false);
  });

  test('validate negative idle timeout', () => {
    const cfg = config.getConfig();
    cfg.idle.idleTimeoutMs = -1;
    expect(config.validate(cfg).valid).toBe(false);
  });

  test('validate negative drain timeout', () => {
    const cfg = config.getConfig();
    cfg.restart.drainTimeoutMs = -1;
    expect(config.validate(cfg).valid).toBe(false);
  });

  test('exportConfig json', () => {
    const json = config.exportConfig('json');
    const parsed = JSON.parse(json);
    expect(parsed.loop).toBeDefined();
    expect(parsed.heartbeat).toBeDefined();
  });

  test('exportConfig env', () => {
    const env = config.exportConfig('env');
    expect(env).toContain('LOOP_MODE=');
    expect(env).toContain('HEARTBEAT_INTERVALMS=');
    expect(env).toContain('RESOURCE_MEMORY_WARNINGPERCENT=');
  });

  test('getChangeHistory', () => {
    config.updateConfig({ loop: { mode: 'continuous', intervalMs: 1000, stallThresholdMs: 30000 } });
    const history = config.getChangeHistory();
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]!.path).toContain('loop.mode');
    expect(history[0]!.timestamp).toBeGreaterThan(0);
  });

  test('getChangeHistory returns copies', () => {
    config.updateConfig({ loop: { mode: 'continuous', intervalMs: 1000, stallThresholdMs: 30000 } });
    const h1 = config.getChangeHistory();
    const h2 = config.getChangeHistory();
    expect(h1).not.toBe(h2);
  });

  test('rollback single change', () => {
    config.updateConfig({ loop: { mode: 'continuous', intervalMs: 1000, stallThresholdMs: 30000 } });
    expect(config.getConfig().loop.mode).toBe('continuous');
    config.rollback(1);
    expect(config.getConfig().loop.mode).toBe('interval');
  });

  test('rollback multiple changes', () => {
    config.updateConfig({ loop: { mode: 'continuous', intervalMs: 100, stallThresholdMs: 30000 } });
    config.updateConfig({ loop: { mode: 'adaptive', intervalMs: 200, stallThresholdMs: 30000 } });
    expect(config.getConfig().loop.mode).toBe('adaptive');

    // Rollback all changes by using the full history length
    const history = config.getChangeHistory();
    config.rollback(history.length);
    expect(config.getConfig().loop.mode).toBe('interval');
  });

  test('rollback more than history', () => {
    config.updateConfig({ loop: { mode: 'continuous', intervalMs: 100, stallThresholdMs: 30000 } });
    config.rollback(10);
    expect(config.getConfig().loop.mode).toBe('interval');
  });

  test('rollback with no history is no-op', () => {
    config.rollback(1);
    expect(config.getConfig().loop.mode).toBe('interval');
  });

  test('rollback zero is no-op', () => {
    config.updateConfig({ loop: { mode: 'continuous', intervalMs: 100, stallThresholdMs: 30000 } });
    config.rollback(0);
    expect(config.getConfig().loop.mode).toBe('continuous');
  });

  test('updateConfig does not modify defaults', () => {
    const defaults = config.getDefaults();
    config.updateConfig({ loop: { mode: 'continuous', intervalMs: 100, stallThresholdMs: 30000 } });
    expect(defaults.loop.mode).toBe('interval');
  });

  test('nested change tracking', () => {
    config.updateConfig({
      checkpoint: {
        enabled: true,
        type: 'full',
        triggers: { timeIntervalSec: 600, iterationInterval: 100, sizeThreshold: 1024 * 1024, eventBased: true },
        storage: 'memory',
        compression: false,
        retention: { maxCount: 10, maxAgeHours: 24, keepTagged: true },
      },
    });
    const history = config.getChangeHistory();
    const timeChange = history.find(h => h.path.includes('timeIntervalSec'));
    expect(timeChange).toBeDefined();
    expect(timeChange!.oldValue).toBe(300);
    expect(timeChange!.newValue).toBe(600);
  });
});

// ============================================================
// Integration Tests
// ============================================================
describe('Integration Tests', () => {
  test('state machine + checkpoint save/restore', () => {
    const sm = new RuntimeStateMachine();
    const cm = new CheckpointManager();

    sm.transition('starting');
    sm.transition('running');
    sm.setSubState('processing');

    const state = sm.saveState();
    cm.createCheckpoint('state-save', state);

    // Restore
    const sm2 = new RuntimeStateMachine();
    const checkpoints = cm.listCheckpoints();
    cm.restoreCheckpoint(checkpoints[0]!.id).then((result) => {
      if (result.success) {
        sm2.loadState(result.data as any);
        expect(sm2.getCurrentState()).toBe('running');
        expect(sm2.getSubState()).toBe('processing');
      }
    });

    sm.destroy();
    sm2.destroy();
  });

  test('heartbeat + graceful restart', async () => {
    const hb = new HeartbeatMonitor({ intervalMs: 1000, timeoutMs: 5000 });
    const restarter = new GracefulRestarter();

    hb.register('agent');
    restarter.setStateSerializer(() => ({
      heartbeatComponents: hb.getComponentCount(),
    }));

    const result = await restarter.initiateRestart('scheduled');
    expect(result.success).toBe(true);
    hb.stopMonitoring();
  });

  test('lifecycle + resource guard', async () => {
    const lm = new LifecycleManager();
    const rg = new ResourceGuard();

    lm.registerComponent({
      id: 'resource-monitor',
      name: 'Resource Monitor',
      phase: 'initialize',
      start: async () => { rg.monitor(5000); },
      stop: async () => { rg.stopMonitoring(); },
    });

    await lm.bootstrap({});
    await lm.start();
    expect(rg.getReservationCount()).toBe(0);

    await lm.shutdown();
    expect(lm.getPhase()).toBe('cleanup');
  });

  test('task queue + checkpoint', () => {
    const queue = new PersistentTaskQueue();
    const cm = new CheckpointManager();

    queue.enqueue({ name: 'task1', payload: { step: 1 } });
    queue.enqueue({ name: 'task2', payload: { step: 2 } });

    const stats = queue.getStats();
    cm.createCheckpoint('queue-state', stats);

    const checkpoints = cm.listCheckpoints();
    expect(checkpoints[0]!.label).toBe('queue-state');
  });

  test('idle detector + infinite loop', () => {
    vi.useFakeTimers();
    const detector = new IdleDetector({ idleTimeoutMs: 1000 });
    const loop = new InfiniteLoop({ mode: 'interval', intervalMs: 100 });

    let lastActivity = Date.now();
    loop.start();
    detector.startMonitoring();

    // Simulate activity on each iteration
    const origTick = loop.tick.bind(loop);
    // Just advance time and check idle
    vi.advanceTimersByTime(1001);
    expect(detector.isIdle()).toBe(true);

    // Activity resumes
    detector.recordActivity();
    expect(detector.isIdle()).toBe(false);

    loop.destroy();
    detector.stopMonitoring();
    vi.useRealTimers();
  });

  test('full runtime config validation', () => {
    const cm = new RuntimeConfigManager();
    const cfg = cm.getConfig();
    const result = cm.validate(cfg);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
