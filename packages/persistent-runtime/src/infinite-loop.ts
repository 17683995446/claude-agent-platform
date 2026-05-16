// src/infinite-loop.ts - Infinite Loop Engine

export type LoopMode = 'continuous' | 'interval' | 'adaptive' | 'cron';
export type LoopStatus = 'stopped' | 'running' | 'paused' | 'stopping';

export interface LoopOptions {
  mode?: LoopMode;
  intervalMs?: number;
  cronExpression?: string;
  stallThresholdMs?: number;
  maxIterations?: number;
  onIteration?: () => void | Promise<void>;
  onIterationStart?: (iteration: number) => void;
  onIterationEnd?: (iteration: number, duration: number) => void;
  onError?: (error: Error, iteration: number) => void;
  onStall?: (iteration: number, elapsed: number) => void;
  onRecovery?: (iteration: number) => void;
}

export class InfiniteLoop {
  private mode: LoopMode;
  private intervalMs: number;
  private stallThresholdMs: number;
  private maxIterations: number | undefined;
  private _status: LoopStatus = 'stopped';
  private iterationCount = 0;
  private startTime = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private iterationStartTime = 0;
  private consecutiveErrors = 0;
  private maxConsecutiveErrors = 10;

  // Event hooks
  private onIterationStart?: (iteration: number) => void;
  private onIterationEnd?: (iteration: number, duration: number) => void;
  private onError?: (error: Error, iteration: number) => void;
  private onStall?: (iteration: number, elapsed: number) => void;
  private onRecovery?: (iteration: number) => void;
  private iterationFn?: () => void | Promise<void>;

  // Adaptive delay tracking
  private lastIterationDuration = 0;
  private adaptiveDelay = 0;
  private currentDelay = 0;

  constructor(options: LoopOptions = {}) {
    this.mode = options.mode ?? 'interval';
    this.intervalMs = options.intervalMs ?? 1000;
    this.stallThresholdMs = options.stallThresholdMs ?? 30000;
    this.maxIterations = options.maxIterations;
    this.onIterationStart = options.onIterationStart;
    this.onIterationEnd = options.onIterationEnd;
    this.onError = options.onError;
    this.onStall = options.onStall;
    this.onRecovery = options.onRecovery;
    this.iterationFn = options.onIteration;
    this.currentDelay = this.mode === 'continuous' ? 1 : this.intervalMs;
  }

  start(): void {
    if (this._status === 'running') return;
    this._status = 'running';
    this.startTime = Date.now();
    this.currentDelay = this.getDelay();
    this.intervalId = setInterval(() => {
      this.executeIteration();
    }, this.currentDelay);
  }

  async stop(_reason?: string): Promise<void> {
    if (this._status === 'stopped') return;
    this._status = 'stopping';
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this._status = 'stopped';
  }

  pause(): void {
    if (this._status !== 'running') return;
    this._status = 'paused';
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  resume(): void {
    if (this._status !== 'paused') return;
    this._status = 'running';
    this.currentDelay = this.getDelay();
    this.intervalId = setInterval(() => {
      this.executeIteration();
    }, this.currentDelay);
  }

  getStatus(): LoopStatus {
    return this._status;
  }

  getIterationCount(): number {
    return this.iterationCount;
  }

  getUptime(): number {
    if (this.startTime === 0) return 0;
    if (this._status === 'stopped') return 0;
    return Date.now() - this.startTime;
  }

  getMode(): LoopMode {
    return this.mode;
  }

  setMode(mode: LoopMode): void {
    this.mode = mode;
  }

  setIntervalMs(ms: number): void {
    this.intervalMs = ms;
  }

  private getDelay(): number {
    switch (this.mode) {
      case 'continuous':
        return 1; // minimum delay for setInterval
      case 'interval':
        return this.intervalMs;
      case 'adaptive':
        return this.calculateAdaptiveDelay();
      case 'cron':
        return this.intervalMs;
    }
  }

  private executeIteration(): void {
    if (this._status !== 'running') return;

    if (this.maxIterations !== undefined && this.iterationCount >= this.maxIterations) {
      if (this.intervalId !== null) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
      this._status = 'stopped';
      return;
    }

    this.iterationCount++;
    const currentIteration = this.iterationCount;
    this.iterationStartTime = Date.now();

    this.onIterationStart?.(currentIteration);

    try {
      const result = this.iterationFn?.();
      if (result && typeof result === 'object' && 'then' in result) {
        result.then(() => {
          this.consecutiveErrors = 0;
          this.onRecovery?.(currentIteration);
          this.finalizeIteration(currentIteration);
        }).catch((error: Error) => {
          this.consecutiveErrors++;
          this.onError?.(error, currentIteration);
          if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
            if (this.intervalId !== null) {
              clearInterval(this.intervalId);
              this.intervalId = null;
            }
            this._status = 'stopped';
            return;
          }
          this.finalizeIteration(currentIteration);
        });
        return;
      }
      this.consecutiveErrors = 0;
      this.onRecovery?.(currentIteration);
    } catch (error) {
      this.consecutiveErrors++;
      this.onError?.(error as Error, currentIteration);
      if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
        if (this.intervalId !== null) {
          clearInterval(this.intervalId);
          this.intervalId = null;
        }
        this._status = 'stopped';
        return;
      }
    }

    this.finalizeIteration(currentIteration);
  }

  private finalizeIteration(currentIteration: number): void {
    const duration = Date.now() - this.iterationStartTime;
    this.lastIterationDuration = duration;

    if (duration > this.stallThresholdMs) {
      this.onStall?.(currentIteration, duration);
    }

    this.onIterationEnd?.(currentIteration, duration);

    // For adaptive mode, recalculate delay
    if (this.mode === 'adaptive') {
      const newDelay = this.calculateAdaptiveDelay();
      if (newDelay !== this.currentDelay && this.intervalId !== null) {
        clearInterval(this.intervalId);
        this.currentDelay = newDelay;
        this.intervalId = setInterval(() => {
          this.executeIteration();
        }, this.currentDelay);
      }
    }
  }

  private calculateAdaptiveDelay(): number {
    if (this.lastIterationDuration === 0) return this.intervalMs;
    const ratio = this.lastIterationDuration / this.intervalMs;
    if (ratio > 2) {
      this.adaptiveDelay = Math.max(1, Math.floor(this.intervalMs * 0.5));
    } else if (ratio < 0.5) {
      this.adaptiveDelay = Math.floor(this.intervalMs * 1.5);
    } else {
      this.adaptiveDelay = this.intervalMs;
    }
    return this.adaptiveDelay;
  }

  /** Execute one iteration manually (for testing without timers) */
  tick(): void {
    if (this._status !== 'running') return;
    this.executeIteration();
  }

  destroy(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this._status = 'stopped';
  }
}
