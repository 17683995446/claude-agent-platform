// src/log-aggregator.ts - 日志聚合器

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  id: string;
  source: string;
  level: LogLevel;
  message: string;
  timestamp: number;
  meta?: Record<string, unknown>;
}

export interface LogQuery {
  source?: string;
  level?: LogLevel;
  message?: string;
  from?: number;
  to?: number;
  limit?: number;
  meta?: Record<string, unknown>;
}

export interface LogStats {
  total: number;
  byLevel: Record<LogLevel, number>;
  bySource: Record<string, number>;
  byTime: { hour: number; count: number }[];
  period: string;
}

export class LogAggregator {
  private logs: LogEntry[] = [];
  private sources: Set<string> = new Set();
  private maxLogs: number;
  private idCounter: number = 0;

  constructor(maxLogs: number = 10000) {
    this.maxLogs = maxLogs;
  }

  collect(source: string, level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const entry: LogEntry = {
      id: `log-${++this.idCounter}`,
      source,
      level,
      message,
      timestamp: Date.now(),
      meta,
    };
    this.logs.push(entry);
    this.sources.add(source);

    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  debug(source: string, message: string, meta?: Record<string, unknown>): void {
    this.collect(source, 'debug', message, meta);
  }

  info(source: string, message: string, meta?: Record<string, unknown>): void {
    this.collect(source, 'info', message, meta);
  }

  warn(source: string, message: string, meta?: Record<string, unknown>): void {
    this.collect(source, 'warn', message, meta);
  }

  error(source: string, message: string, meta?: Record<string, unknown>): void {
    this.collect(source, 'error', message, meta);
  }

  fatal(source: string, message: string, meta?: Record<string, unknown>): void {
    this.collect(source, 'fatal', message, meta);
  }

  search(query: LogQuery): LogEntry[] {
    let results = [...this.logs];

    if (query.source) {
      results = results.filter(e => e.source === query.source);
    }
    if (query.level) {
      results = results.filter(e => e.level === query.level);
    }
    if (query.message) {
      const msgLower = query.message.toLowerCase();
      results = results.filter(e => e.message.toLowerCase().includes(msgLower));
    }
    if (query.from) {
      results = results.filter(e => e.timestamp >= query.from!);
    }
    if (query.to) {
      results = results.filter(e => e.timestamp <= query.to!);
    }
    if (query.meta) {
      for (const [key, value] of Object.entries(query.meta)) {
        results = results.filter(e => e.meta && e.meta[key] === value);
      }
    }
    if (query.limit) {
      results = results.slice(-query.limit);
    }

    return results;
  }

  getStats(period: string = 'all'): LogStats {
    const byLevel: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0, fatal: 0 };
    const bySource: Record<string, number> = {};
    const byTime: { hour: number; count: number }[] = [];

    for (const entry of this.logs) {
      byLevel[entry.level]++;
      bySource[entry.source] = (bySource[entry.source] || 0) + 1;

      const hour = new Date(entry.timestamp).getHours();
      const existing = byTime.find(h => h.hour === hour);
      if (existing) {
        existing.count++;
      } else {
        byTime.push({ hour, count: 1 });
      }
    }

    return {
      total: this.logs.length,
      byLevel,
      bySource,
      byTime,
      period,
    };
  }

  getSources(): string[] {
    return [...this.sources];
  }

  exportLogs(format: 'json' | 'text'): string {
    if (format === 'json') {
      return JSON.stringify(this.logs, null, 2);
    }
    return this.logs.map(e =>
      `[${new Date(e.timestamp).toISOString()}] [${e.level.toUpperCase()}] [${e.source}] ${e.message}`
    ).join('\n');
  }

  getLogCount(): number {
    return this.logs.length;
  }

  clear(): void {
    this.logs = [];
    this.sources.clear();
    this.idCounter = 0;
  }
}
