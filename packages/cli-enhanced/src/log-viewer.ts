// src/log-viewer.ts - 日志查看器模块

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  source?: string;
  data?: unknown;
  raw: string;
}

export interface LogSource {
  name: string;
  type: 'file' | 'stream' | 'memory';
  path?: string;
  entries?: LogEntry[];
}

export interface ViewOptions {
  level?: LogLevel;
  format?: 'plain' | 'json' | 'colored';
  timestampFormat?: string;
  filter?: string;
  follow?: boolean;
  tail?: number;
}

export interface SearchOptions {
  pattern: string;
  caseSensitive?: boolean;
  level?: LogLevel;
  source?: string;
  startDate?: Date;
  endDate?: Date;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m',    // cyan
  info: '\x1b[32m',     // green
  warn: '\x1b[33m',     // yellow
  error: '\x1b[31m',    // red
};

const RESET = '\x1b[0m';

export class LogViewer {
  private entries: LogEntry[] = [];
  private sources: Map<string, LogSource> = new Map();
  private followInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * 查看日志
   */
  view(logSource: LogSource, options?: ViewOptions): void {
    this.sources.set(logSource.name, logSource);

    if (logSource.entries) {
      this.entries = [...logSource.entries];
    }

    const filtered = this.applyFilters(this.entries, options);
    const formatted = this.formatEntries(filtered, options?.format ?? 'colored', options?.timestampFormat);

    console.log(formatted);
  }

  /**
   * 搜索日志
   */
  search(pattern: string, options?: SearchOptions): LogEntry[] {
    const caseSensitive = options?.caseSensitive ?? false;
    const searchFn = caseSensitive
      ? (entry: LogEntry) => entry.message.includes(pattern) || entry.raw.includes(pattern)
      : (entry: LogEntry) => entry.message.toLowerCase().includes(pattern.toLowerCase()) || entry.raw.toLowerCase().includes(pattern.toLowerCase());

    return this.entries.filter(entry => {
      if (!searchFn(entry)) return false;

      if (options?.level && LOG_LEVEL_PRIORITY[entry.level] < LOG_LEVEL_PRIORITY[options.level]) {
        return false;
      }

      if (options?.source && entry.source !== options.source) {
        return false;
      }

      if (options?.startDate && entry.timestamp < options.startDate) {
        return false;
      }

      if (options?.endDate && entry.timestamp > options.endDate) {
        return false;
      }

      return true;
    });
  }

  /**
   * 按级别过滤日志
   */
  filter(level: LogLevel): LogEntry[] {
    const minPriority = LOG_LEVEL_PRIORITY[level];
    return this.entries.filter(entry => LOG_LEVEL_PRIORITY[entry.level] >= minPriority);
  }

  /**
   * 获取最后 N 条日志
   */
  tail(count: number): LogEntry[] {
    return this.entries.slice(-count);
  }

  /**
   * 导出日志
   */
  export(format: 'json' | 'text'): string {
    if (format === 'json') {
      return JSON.stringify(this.entries.map(entry => ({
        timestamp: entry.timestamp.toISOString(),
        level: entry.level,
        message: entry.message,
        source: entry.source,
        data: entry.data,
      })), null, 2);
    }

    return this.entries.map(entry =>
      `[${entry.timestamp.toISOString()}] [${entry.level.toUpperCase()}] ${entry.source ? `[${entry.source}] ` : ''}${entry.message}`
    ).join('\n');
  }

  /**
   * 添加日志条目
   */
  addEntry(entry: LogEntry): void {
    this.entries.push(entry);
  }

  /**
   * 加载日志源
   */
  loadSource(source: LogSource): void {
    this.sources.set(source.name, source);
    if (source.entries) {
      this.entries.push(...source.entries);
    }
  }

  /**
   * 清除所有日志
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * 获取日志统计
   */
  getStats(): { total: number; byLevel: Record<LogLevel, number>; sources: string[] } {
    const byLevel: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 };

    for (const entry of this.entries) {
      byLevel[entry.level]++;
    }

    return {
      total: this.entries.length,
      byLevel,
      sources: [...this.sources.keys()],
    };
  }

  /**
   * 实时跟踪日志（模拟）
   */
  startFollow(callback: (entry: LogEntry) => void): void {
    this.followInterval = setInterval(() => {
      // In a real implementation, this would poll for new entries
    }, 1000);
  }

  /**
   * 停止实时跟踪
   */
  stopFollow(): void {
    if (this.followInterval) {
      clearInterval(this.followInterval);
      this.followInterval = null;
    }
  }

  /**
   * 格式化时间戳
   */
  formatTimestamp(date: Date, format?: string): string {
    if (!format || format === 'iso') {
      return date.toISOString();
    }

    if (format === 'unix') {
      return String(Math.floor(date.getTime() / 1000));
    }

    if (format === 'relative') {
      const diff = Date.now() - date.getTime();
      if (diff < 1000) return 'just now';
      if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
      if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
      return `${Math.floor(diff / 86400000)}d ago`;
    }

    // Simple format: YYYY-MM-DD HH:mm:ss
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  /**
   * 获取所有条目
   */
  getAllEntries(): LogEntry[] {
    return [...this.entries];
  }

  /**
   * 获取所有日志源
   */
  getSources(): LogSource[] {
    return [...this.sources.values()];
  }

  private applyFilters(entries: LogEntry[], options?: ViewOptions): LogEntry[] {
    let filtered = [...entries];

    if (options?.level) {
      const minPriority = LOG_LEVEL_PRIORITY[options.level];
      filtered = filtered.filter(e => LOG_LEVEL_PRIORITY[e.level] >= minPriority);
    }

    if (options?.filter) {
      const pattern = options.filter.toLowerCase();
      filtered = filtered.filter(e =>
        e.message.toLowerCase().includes(pattern) ||
        (e.source && e.source.toLowerCase().includes(pattern))
      );
    }

    if (options?.tail) {
      filtered = filtered.slice(-options.tail);
    }

    return filtered;
  }

  private formatEntries(entries: LogEntry[], format: string, timestampFormat?: string): string {
    return entries.map(entry => {
      const ts = this.formatTimestamp(entry.timestamp, timestampFormat);

      switch (format) {
        case 'json':
          return JSON.stringify({
            timestamp: ts,
            level: entry.level,
            message: entry.message,
            source: entry.source,
          });

        case 'plain':
          return `[${ts}] [${entry.level.toUpperCase()}] ${entry.source ? `[${entry.source}] ` : ''}${entry.message}`;

        case 'colored':
        default: {
          const color = LOG_LEVEL_COLORS[entry.level];
          return `[${ts}] ${color}[${entry.level.toUpperCase().padEnd(5)}]${RESET} ${entry.source ? `[${entry.source}] ` : ''}${entry.message}`;
        }
      }
    }).join('\n');
  }
}
