// TimeHelpers: Time manipulation for tests

export class MockClock {
  private currentTime: number;
  private realDateNow: () => number;
  private realPerformanceNow: () => number;
  private active: boolean = false;

  constructor() {
    this.currentTime = Date.now();
    this.realDateNow = Date.now;
    this.realPerformanceNow = performance.now.bind(performance);
  }

  now(): number {
    return this.currentTime;
  }

  advance(ms: number): void {
    this.currentTime += ms;
  }

  set(time: number | Date): void {
    this.currentTime = typeof time === 'number' ? time : time.getTime();
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    Date.now = () => this.currentTime;
    performance.now = () => this.currentTime;
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    Date.now = this.realDateNow;
    performance.now = this.realPerformanceNow;
  }

  reset(): void {
    this.currentTime = this.realDateNow();
  }

  isActive(): boolean {
    return this.active;
  }
}

let activeFreezeTime: number | null = null;
let realDateNow: () => number = Date.now;

export function freezeTime(time: number | Date): void {
  const targetTime = typeof time === 'number' ? time : time.getTime();
  activeFreezeTime = targetTime;
  realDateNow = Date.now;
  Date.now = () => activeFreezeTime!;
}

export function advanceTime(ms: number): void {
  if (activeFreezeTime === null) {
    throw new Error('Time is not frozen. Call freezeTime() first.');
  }
  activeFreezeTime += ms;
}

export function unfreezeTime(): void {
  activeFreezeTime = null;
  Date.now = realDateNow;
}

export function createTimestamp(offsetMs: number = 0): number {
  return Date.now() + offsetMs;
}
