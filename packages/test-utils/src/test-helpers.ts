// TestHelpers: Utility functions for tests

export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number = 5000,
  intervalMs: number = 50,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await condition();
    if (result) return;
    await delay(intervalMs);
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function repeat<T>(fn: () => T | Promise<T>, times: number): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < times; i++) {
    results.push(await fn());
  }
  return results;
}

export async function measureTime<T>(fn: () => T | Promise<T>): Promise<{ result: T; elapsedMs: number }> {
  const start = performance.now();
  const result = await fn();
  const elapsedMs = performance.now() - start;
  return { result, elapsedMs };
}

let idCounter = 0;

export function generateId(prefix: string = 'id'): string {
  idCounter++;
  return `${prefix}-${idCounter}-${Date.now()}`;
}

export function resetIdCounter(): void {
  idCounter = 0;
}

export interface TempStore {
  data: Map<string, unknown>;
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): boolean;
  has(key: string): boolean;
  clear(): void;
  size(): number;
}

export function createTempStore(): TempStore {
  const data = new Map<string, unknown>();

  return {
    data,
    get(key: string) {
      return data.get(key);
    },
    set(key: string, value: unknown) {
      data.set(key, value);
    },
    delete(key: string) {
      return data.delete(key);
    },
    has(key: string) {
      return data.has(key);
    },
    clear() {
      data.clear();
    },
    size() {
      return data.size;
    },
  };
}

export interface MockConsole {
  logs: string[];
  warns: string[];
  errors: string[];
  infos: string[];
  restore(): void;
}

export function setupMockConsole(): MockConsole {
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
  };

  const mockConsole: MockConsole = {
    logs: [],
    warns: [],
    errors: [],
    infos: [],
    restore() {
      console.log = originalConsole.log;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
      console.info = originalConsole.info;
    },
  };

  console.log = (...args: unknown[]) => {
    mockConsole.logs.push(args.map(String).join(' '));
  };
  console.warn = (...args: unknown[]) => {
    mockConsole.warns.push(args.map(String).join(' '));
  };
  console.error = (...args: unknown[]) => {
    mockConsole.errors.push(args.map(String).join(' '));
  };
  console.info = (...args: unknown[]) => {
    mockConsole.infos.push(args.map(String).join(' '));
  };

  return mockConsole;
}

export interface MockTimer {
  currentTime: number;
  advance(ms: number): void;
  setTime(time: number): void;
  reset(): void;
  restore(): void;
}

export function setupMockTimer(): MockTimer {
  const realDateNow = Date.now;
  const realPerformanceNow = performance.now.bind(performance);
  const mockTimer: MockTimer = {
    currentTime: Date.now(),
    advance(ms: number) {
      mockTimer.currentTime += ms;
    },
    setTime(time: number) {
      mockTimer.currentTime = time;
    },
    reset() {
      mockTimer.currentTime = Date.now();
    },
    restore() {
      Date.now = realDateNow;
      performance.now = realPerformanceNow;
    },
  };

  Date.now = () => mockTimer.currentTime;
  performance.now = () => mockTimer.currentTime;

  return mockTimer;
}

export async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export async function* createAsyncIterator<T>(items: T[]): AsyncIterableIterator<T> {
  for (const item of items) {
    yield item;
  }
}
