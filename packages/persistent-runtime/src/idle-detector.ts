// src/idle-detector.ts - Idle Detector

export interface IdlePeriod {
  startedAt: number;
  endedAt?: number;
  duration?: number;
  triggeredActions: string[];
}

export type IdleCallback = (idleTimeMs: number) => void;
export type ActiveCallback = (activeTimeMs: number) => void;

export class IdleDetector {
  private idleTimeoutMs: number;
  private lastActivityTime: number;
  private isIdleState = false;
  private idleHistory: IdlePeriod[] = [];
  private currentIdlePeriod: IdlePeriod | null = null;
  private idleCallbacks: IdleCallback[] = [];
  private activeCallbacks: ActiveCallback[] = [];
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private idleActions: string[] = [];
  private activeTimeSinceLastIdle = 0;
  private lastTransitionTime: number;

  constructor(options?: { idleTimeoutMs?: number }) {
    this.idleTimeoutMs = options?.idleTimeoutMs ?? 60000;
    this.lastActivityTime = Date.now();
    this.lastTransitionTime = Date.now();
  }

  startMonitoring(): void {
    if (this.checkTimer !== null) return;
    this.checkTimer = setInterval(() => {
      this.checkIdle();
    }, Math.min(this.idleTimeoutMs / 4, 5000));
  }

  stopMonitoring(): void {
    if (this.checkTimer !== null) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    // End current idle period if any
    if (this.currentIdlePeriod) {
      this.endIdlePeriod();
    }
  }

  recordActivity(): void {
    const now = Date.now();
    this.lastActivityTime = now;

    if (this.isIdleState) {
      this.endIdlePeriod();
      this.isIdleState = false;
      const activeTime = now - this.lastTransitionTime;
      this.activeTimeSinceLastIdle = activeTime;
      this.lastTransitionTime = now;
      for (const cb of this.activeCallbacks) {
        cb(activeTime);
      }
    }
  }

  getIdleTime(): number {
    if (this.isIdleState) {
      return Date.now() - (this.currentIdlePeriod?.startedAt ?? this.lastActivityTime);
    }
    return 0;
  }

  isIdle(): boolean {
    return this.isIdleState;
  }

  onIdle(callback: IdleCallback): void {
    this.idleCallbacks.push(callback);
  }

  onActive(callback: ActiveCallback): void {
    this.activeCallbacks.push(callback);
  }

  getIdleHistory(): IdlePeriod[] {
    return [...this.idleHistory];
  }

  setIdleTimeout(ms: number): void {
    this.idleTimeoutMs = ms;
  }

  forceIdle(): void {
    if (this.isIdleState) return;
    this.isIdleState = true;
    this.currentIdlePeriod = {
      startedAt: Date.now(),
      triggeredActions: [],
    };
    this.lastTransitionTime = Date.now();
    for (const cb of this.idleCallbacks) {
      cb(0);
    }
  }

  forceActive(): void {
    this.recordActivity();
  }

  getActiveTimeSinceLastIdle(): number {
    if (this.isIdleState) return this.activeTimeSinceLastIdle;
    return Date.now() - this.lastTransitionTime;
  }

  private checkIdle(): void {
    const now = Date.now();
    const idleTime = now - this.lastActivityTime;

    if (!this.isIdleState && idleTime >= this.idleTimeoutMs) {
      this.isIdleState = true;
      this.activeTimeSinceLastIdle = now - this.lastTransitionTime;
      this.currentIdlePeriod = {
        startedAt: now - idleTime,
        triggeredActions: [...this.idleActions],
      };
      this.lastTransitionTime = now;

      for (const cb of this.idleCallbacks) {
        cb(idleTime);
      }
    }
  }

  private endIdlePeriod(): void {
    if (!this.currentIdlePeriod) return;
    this.currentIdlePeriod.endedAt = Date.now();
    this.currentIdlePeriod.duration = this.currentIdlePeriod.endedAt - this.currentIdlePeriod.startedAt;
    this.idleHistory.push(this.currentIdlePeriod);
    this.currentIdlePeriod = null;
  }
}
