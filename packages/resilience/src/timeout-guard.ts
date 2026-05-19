// timeout-guard.ts - 超时守卫

export type TimeoutStrategy = 'reject' | 'resolve_with_default' | 'cancel';

export interface TimeoutConfig {
  defaultTimeoutMs: number;
  strategy: TimeoutStrategy;
  warningPercentage?: number;
  defaultReturnValue?: unknown;
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export class TimeoutTimer {
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private startTime: number;
  private remaining: number;
  private onTimeout: () => void;
  private warningTimerId: ReturnType<typeof setTimeout> | null = null;
  private onWarning?: () => void;

  constructor(timeoutMs: number, onTimeout: () => void, onWarning?: () => void, warningPercentage?: number) {
    this.remaining = timeoutMs;
    this.startTime = Date.now();
    this.onTimeout = onTimeout;
    this.onWarning = onWarning;

    this.timerId = setTimeout(() => {
      this.onTimeout();
      this.timerId = null;
    }, timeoutMs);

    if (onWarning && warningPercentage && warningPercentage > 0 && warningPercentage < 100) {
      const warningMs = timeoutMs * (warningPercentage / 100);
      this.warningTimerId = setTimeout(() => {
        this.onWarning?.();
        this.warningTimerId = null;
      }, warningMs);
    }
  }

  extend(additionalMs: number): void {
    if (this.timerId === null) return; // already timed out

    clearTimeout(this.timerId);
    if (this.warningTimerId) clearTimeout(this.warningTimerId);

    const elapsed = Date.now() - this.startTime;
    const remaining = Math.max(0, this.remaining - elapsed);
    this.remaining = remaining + additionalMs;
    this.startTime = Date.now();

    this.timerId = setTimeout(() => {
      this.onTimeout();
      this.timerId = null;
    }, this.remaining);

    // Re-create warning timer if originally configured
    if (this.onWarning) {
      const warningMs = this.remaining * 0.8; // Use 80% as default warning threshold
      this.warningTimerId = setTimeout(() => {
        this.onWarning?.();
        this.warningTimerId = null;
      }, warningMs);
    }
  }

  cancel(): void {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.warningTimerId) {
      clearTimeout(this.warningTimerId);
      this.warningTimerId = null;
    }
  }

  getRemaining(): number {
    if (this.timerId === null) return 0;
    return Math.max(0, this.remaining - (Date.now() - this.startTime));
  }

  isExpired(): boolean {
    return this.timerId === null;
  }
}

export class TimeoutGuard {
  private readonly config: Required<Pick<TimeoutConfig, 'warningPercentage'>> & TimeoutConfig;
  private activeTimers = new Map<string, TimeoutTimer>();
  private warningCallbacks: Array<(name: string, remainingMs: number) => void> = [];
  private timerCounter = 0;

  constructor(config: TimeoutConfig) {
    this.config = {
      warningPercentage: 80,
      ...config,
    };
  }

  async wrap<T>(fn: () => Promise<T>, timeoutMs?: number, name?: string): Promise<T> {
    const ms = timeoutMs ?? this.config.defaultTimeoutMs;
    this.timerCounter++;
    const timerName = name ?? `timer_${this.timerCounter}_${Date.now()}`;
    let settled = false;

    return new Promise<T>((resolve, reject) => {
      const timerId = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.activeTimers.delete(timerName);
        switch (this.config.strategy) {
          case 'reject':
            reject(new TimeoutError(`Operation '${timerName}' timed out after ${ms}ms`));
            break;
          case 'resolve_with_default':
            resolve(this.config.defaultReturnValue as T);
            break;
          case 'cancel':
            reject(new TimeoutError(`Operation '${timerName}' was cancelled after ${ms}ms`));
            break;
        }
      }, ms);

      // Warning timer
      const warningMs = ms * (this.config.warningPercentage / 100);
      const warningTimerId = setTimeout(() => {
        const remaining = ms - warningMs;
        this.warningCallbacks.forEach(cb => cb(timerName, remaining));
      }, warningMs);

      this.activeTimers.set(timerName, {
        cancel: () => { clearTimeout(timerId); clearTimeout(warningTimerId); },
        isExpired: () => settled,
        getRemaining: () => 0,
        extend: () => {},
      } as unknown as TimeoutTimer);

      fn()
        .then(result => {
          if (settled) return;
          settled = true;
          clearTimeout(timerId);
          clearTimeout(warningTimerId);
          this.activeTimers.delete(timerName);
          resolve(result);
        })
        .catch(error => {
          if (settled) return;
          settled = true;
          clearTimeout(timerId);
          clearTimeout(warningTimerId);
          this.activeTimers.delete(timerName);
          reject(error);
        });
    });
  }

  createTimer(timeoutMs: number | string, name?: string): TimeoutTimer {
    const ms = typeof timeoutMs === 'string' ? parseInt(timeoutMs, 10) : timeoutMs;
    this.timerCounter++;
    const timerName = name ?? `timer_${this.timerCounter}_${Date.now()}`;

    const timer = new TimeoutTimer(
      ms,
      () => {
        this.activeTimers.delete(timerName);
      },
      () => {
        const remaining = ms * (1 - this.config.warningPercentage / 100);
        this.warningCallbacks.forEach(cb => cb(timerName, remaining));
      },
      this.config.warningPercentage,
    );

    // Wrap cancel to also remove from activeTimers map
    const originalCancel = timer.cancel.bind(timer);
    timer.cancel = () => {
      originalCancel();
      this.activeTimers.delete(timerName);
    };

    this.activeTimers.set(timerName, timer);
    return timer;
  }

  getTimer(name: string): TimeoutTimer | undefined {
    return this.activeTimers.get(name);
  }

  cancelTimer(name: string): void {
    this.activeTimers.get(name)?.cancel();
    this.activeTimers.delete(name);
  }

  cancelAll(): void {
    this.activeTimers.forEach(timer => timer.cancel());
    this.activeTimers.clear();
  }

  onWarning(callback: (name: string, remainingMs: number) => void): void {
    this.warningCallbacks.push(callback);
  }

  removeWarningCallback(callback: (name: string, remainingMs: number) => void): void {
    const index = this.warningCallbacks.indexOf(callback);
    if (index !== -1) {
      this.warningCallbacks.splice(index, 1);
    }
  }

  getActiveTimerCount(): number {
    return this.activeTimers.size;
  }
}
