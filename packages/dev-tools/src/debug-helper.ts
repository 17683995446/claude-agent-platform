// src/debug-helper.ts - 调试助手

export type DebugLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface Timer {
  label: string;
  start: number;
  end?: number;
  elapsed?: number;
  stop(): number;
}

export interface ProfileResult {
  name: string;
  duration: number;
  memoryBefore?: number;
  memoryAfter?: number;
  memoryDelta?: number;
}

export interface DiffResult {
  equal: boolean;
  additions: string[];
  deletions: string[];
  changes: { path: string; before: unknown; after: unknown }[];
}

export interface LogEntry {
  level: DebugLevel;
  message: string;
  data?: unknown;
  timestamp: number;
}

export class DebugHelper {
  private level: DebugLevel = 'debug';
  private logs: LogEntry[] = [];
  private timers: Map<string, Timer> = new Map();
  private enabled: boolean = true;
  private maxLogs: number = 1000;

  setLevel(level: DebugLevel): void {
    this.level = level;
  }

  getLevel(): DebugLevel {
    return this.level;
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  log(level: DebugLevel, message: string, data?: unknown): void {
    if (!this.enabled) return;

    const levelOrder: DebugLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];
    const currentIdx = levelOrder.indexOf(this.level);
    const msgIdx = levelOrder.indexOf(level);

    if (msgIdx < currentIdx) return;

    const entry: LogEntry = {
      level,
      message,
      data,
      timestamp: Date.now(),
    };

    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: unknown): void {
    this.log('error', message, data);
  }

  time(label: string): Timer {
    const timer: Timer = {
      label,
      start: performance.now(),
      stop: () => {
        timer.end = performance.now();
        timer.elapsed = timer.end - timer.start;
        return timer.elapsed;
      },
    };
    this.timers.set(label, timer);
    return timer;
  }

  timeEnd(label: string): number | undefined {
    const timer = this.timers.get(label);
    if (!timer) return undefined;
    return timer.stop();
  }

  getTimer(label: string): Timer | undefined {
    return this.timers.get(label);
  }

  profile(fn: () => void): ProfileResult {
    const name = fn.name || 'anonymous';
    const memoryBefore = this.getMemoryUsage();
    const start = performance.now();

    fn();

    const end = performance.now();
    const memoryAfter = this.getMemoryUsage();

    return {
      name,
      duration: end - start,
      memoryBefore,
      memoryAfter,
      memoryDelta: memoryAfter !== undefined && memoryBefore !== undefined
        ? memoryAfter - memoryBefore
        : undefined,
    };
  }

  async profileAsync(fn: () => Promise<void>): Promise<ProfileResult> {
    const name = fn.name || 'anonymous';
    const memoryBefore = this.getMemoryUsage();
    const start = performance.now();

    await fn();

    const end = performance.now();
    const memoryAfter = this.getMemoryUsage();

    return {
      name,
      duration: end - start,
      memoryBefore,
      memoryAfter,
      memoryDelta: memoryAfter !== undefined && memoryBefore !== undefined
        ? memoryAfter - memoryBefore
        : undefined,
    };
  }

  inspect(value: unknown): string {
    return this.formatValue(value);
  }

  diff(before: unknown, after: unknown): DiffResult {
    if (before === after) {
      return { equal: true, additions: [], deletions: [], changes: [] };
    }

    const beforeStr = this.formatValue(before);
    const afterStr = this.formatValue(after);

    const beforeLines = beforeStr.split('\n');
    const afterLines = afterStr.split('\n');

    const additions: string[] = [];
    const deletions: string[] = [];
    const changes: DiffResult['changes'] = [];

    const maxLen = Math.max(beforeLines.length, afterLines.length);
    for (let i = 0; i < maxLen; i++) {
      const b = beforeLines[i];
      const a = afterLines[i];
      if (b !== a) {
        if (b !== undefined) deletions.push(b);
        if (a !== undefined) additions.push(a);
        changes.push({ path: `[${i}]`, before: b, after: a });
      }
    }

    // If both are objects, do deep comparison
    if (typeof before === 'object' && before !== null && typeof after === 'object' && after !== null) {
      const deepChanges = this.deepDiff(
        before as Record<string, unknown>,
        after as Record<string, unknown>,
        ''
      );
      return {
        equal: false,
        additions,
        deletions,
        changes: deepChanges,
      };
    }

    return { equal: false, additions, deletions, changes };
  }

  private deepDiff(before: Record<string, unknown>, after: Record<string, unknown>, path: string): DiffResult['changes'] {
    const changes: DiffResult['changes'] = [];
    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

    for (const key of allKeys) {
      const currentPath = path ? `${path}.${key}` : key;
      const bVal = before[key];
      const aVal = after[key];

      if (bVal === aVal) continue;

      if (typeof bVal === 'object' && bVal !== null && typeof aVal === 'object' && aVal !== null) {
        changes.push(...this.deepDiff(
          bVal as Record<string, unknown>,
          aVal as Record<string, unknown>,
          currentPath
        ));
      } else {
        changes.push({ path: currentPath, before: bVal, after: aVal });
      }
    }

    return changes;
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  getLogsByLevel(level: DebugLevel): LogEntry[] {
    return this.logs.filter(l => l.level === level);
  }

  clearLogs(): void {
    this.logs = [];
  }

  clearTimers(): void {
    this.timers.clear();
  }

  clear(): void {
    this.logs = [];
    this.timers.clear();
  }

  getLogCount(): number {
    return this.logs.length;
  }

  private formatValue(value: unknown, indent: number = 0): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return `"${value}"`;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'function') return `[Function: ${value.name || 'anonymous'}]`;
    if (Array.isArray(value)) {
      if (value.length === 0) return '[]';
      const items = value.map(v => '  '.repeat(indent + 1) + this.formatValue(v, indent + 1));
      return `[\n${items.join(',\n')}\n${'  '.repeat(indent)}]`;
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 0) return '{}';
      const items = entries.map(([k, v]) =>
        `${'  '.repeat(indent + 1)}${k}: ${this.formatValue(v, indent + 1)}`
      );
      return `{\n${items.join(',\n')}\n${'  '.repeat(indent)}}`;
    }
    return String(value);
  }

  private getMemoryUsage(): number | undefined {
    try {
      if (typeof process !== 'undefined' && process.memoryUsage) {
        return process.memoryUsage().heapUsed;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  assert(condition: boolean, message: string): void {
    if (!condition) {
      this.error(`Assertion failed: ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  table(data: Record<string, unknown>[] | Record<string, unknown>): void {
    this.info('Table:', data);
  }
}
