// src/state-machine.ts - Runtime State Machine

export type RuntimeState =
  | 'initialized'
  | 'starting'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'resuming'
  | 'stopping'
  | 'stopped'
  | 'restarting';

export type RunningSubState = 'idle' | 'processing' | 'waiting' | 'throttled';

export interface StateTransition {
  from: RuntimeState;
  to: RuntimeState;
  timestamp: number;
  reason?: string;
}

export interface StateHistoryEntry {
  state: RuntimeState;
  enteredAt: number;
  exitedAt?: number;
  duration?: number;
}

export interface PersistedState {
  currentState: RuntimeState;
  subState?: RunningSubState;
  history: StateTransition[];
  timestamp: number;
}

const VALID_TRANSITIONS: Record<RuntimeState, RuntimeState[]> = {
  initialized: ['starting'],
  starting: ['running', 'stopping', 'restarting'],
  running: ['pausing', 'stopping', 'restarting'],
  pausing: ['paused', 'stopping'],
  paused: ['resuming', 'stopping', 'restarting'],
  resuming: ['running', 'stopping'],
  stopping: ['stopped', 'restarting'],
  stopped: ['starting', 'restarting'],
  restarting: ['starting', 'stopped'],
};

export class RuntimeStateMachine {
  private currentState: RuntimeState = 'initialized';
  private subState: RunningSubState | undefined;
  private history: StateTransition[] = [];
  private stateHistory: StateHistoryEntry[] = [{ state: 'initialized', enteredAt: Date.now() }];
  private stateTimeouts: Record<string, number> = {};
  private stateTimers: Map<RuntimeState, ReturnType<typeof setTimeout>> = new Map();
  private onStateChange?: (from: RuntimeState, to: RuntimeState) => void;
  private onTimeout?: (state: RuntimeState) => void;
  private onSubStateChange?: (sub: RunningSubState) => void;

  constructor(timeouts?: Record<string, number>) {
    if (timeouts) {
      this.stateTimeouts = { ...timeouts };
    }
  }

  transition(newState: RuntimeState, reason?: string): boolean {
    if (!this.canTransition(newState)) {
      return false;
    }

    const from = this.currentState;
    this.exitState(from);
    this.currentState = newState;
    this.enterState(newState);

    const transition: StateTransition = {
      from,
      to: newState,
      timestamp: Date.now(),
      reason,
    };
    this.history.push(transition);

    this.onStateChange?.(from, newState);
    return true;
  }

  getCurrentState(): RuntimeState {
    return this.currentState;
  }

  getSubState(): RunningSubState | undefined {
    return this.subState;
  }

  setSubState(subState: RunningSubState): void {
    if (this.currentState !== 'running') return;
    this.subState = subState;
    this.onSubStateChange?.(subState);
  }

  getHistory(): StateTransition[] {
    return [...this.history];
  }

  getStateHistory(): StateHistoryEntry[] {
    return [...this.stateHistory];
  }

  canTransition(to: RuntimeState): boolean {
    const allowed = VALID_TRANSITIONS[this.currentState];
    return allowed?.includes(to) ?? false;
  }

  forceState(state: RuntimeState): void {
    const from = this.currentState;
    this.exitState(from);
    this.currentState = state;
    this.enterState(state);
    this.history.push({ from, to: state, timestamp: Date.now(), reason: 'forced' });
    this.onStateChange?.(from, state);
  }

  setTimeoutMs(state: RuntimeState, timeoutMs: number): void {
    this.stateTimeouts[state] = timeoutMs;
  }

  onStateChangeHook(callback: (from: RuntimeState, to: RuntimeState) => void): void {
    this.onStateChange = callback;
  }

  onTimeoutHook(callback: (state: RuntimeState) => void): void {
    this.onTimeout = callback;
  }

  onSubStateChangeHook(callback: (sub: RunningSubState) => void): void {
    this.onSubStateChange = callback;
  }

  saveState(): PersistedState {
    return {
      currentState: this.currentState,
      subState: this.subState,
      history: this.history,
      timestamp: Date.now(),
    };
  }

  loadState(persisted: PersistedState): void {
    // Clear all existing timers to prevent stale timeout callbacks
    for (const timer of this.stateTimers.values()) {
      clearTimeout(timer);
    }
    this.stateTimers.clear();

    this.currentState = persisted.currentState;
    this.subState = persisted.subState;
    this.history = persisted.history;
    this.stateHistory = [{ state: persisted.currentState, enteredAt: persisted.timestamp }];

    // Set up timer for the restored state if applicable
    this.enterState(persisted.currentState);
  }

  destroy(): void {
    for (const timer of this.stateTimers.values()) {
      clearTimeout(timer);
    }
    this.stateTimers.clear();
  }

  private enterState(state: RuntimeState): void {
    const entry: StateHistoryEntry = { state, enteredAt: Date.now() };
    this.stateHistory.push(entry);

    const timeout = this.stateTimeouts[state];
    if (timeout) {
      const timer = setTimeout(() => {
        this.onTimeout?.(state);
      }, timeout);
      this.stateTimers.set(state, timer);
    }
  }

  private exitState(state: RuntimeState): void {
    const lastEntry = this.stateHistory[this.stateHistory.length - 1];
    if (lastEntry && lastEntry.state === state) {
      lastEntry.exitedAt = Date.now();
      lastEntry.duration = lastEntry.exitedAt - lastEntry.enteredAt;
    }

    const timer = this.stateTimers.get(state);
    if (timer) {
      clearTimeout(timer);
      this.stateTimers.delete(state);
    }
  }
}
