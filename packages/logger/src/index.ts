// ============================================================================
// @claude-agent/logger - Structured Logging System
// ============================================================================

import type { LogLevel, LoggerInterface, LogEntry } from '@claude-agent/types';

// ---- Log Level Utilities ----

const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  trace: '\x1b[90m',   // gray
  debug: '\x1b[36m',   // cyan
  info: '\x1b[32m',    // green
  warn: '\x1b[33m',    // yellow
  error: '\x1b[31m',   // red
  fatal: '\x1b[35m',   // magenta
};

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function shouldLog(currentLevel: LogLevel, messageLevel: LogLevel): boolean {
  return LOG_LEVELS[messageLevel] >= LOG_LEVELS[currentLevel];
}

function formatTimestamp(date: Date): string {
  return date.toISOString();
}

function formatColor(level: LogLevel, message: string): string {
  const color = LEVEL_COLORS[level];
  return `${color}${BOLD}${level.toUpperCase().padEnd(5)}${RESET} ${message}`;
}

// ---- Log Transport Interface ----

export interface LogTransport {
  write(entry: LogEntry): void;
  flush?(): Promise<void>;
  close?(): Promise<void>;
}

// ---- Console Transport ----

export class ConsoleTransport implements LogTransport {
  private colorOutput: boolean;

  constructor(options?: { color?: boolean }) {
    this.colorOutput = options?.color ?? true;
  }

  write(entry: LogEntry): void {
    const timestamp = formatTimestamp(new Date(entry.timestamp));
    const levelTag = this.colorOutput
      ? formatColor(entry.level, entry.level.toUpperCase())
      : entry.level.toUpperCase();

    let message = `${timestamp} ${levelTag} ${entry.message}`;

    if (entry.requestId) {
      message += ` [${entry.requestId}]`;
    }

    if (entry.context && Object.keys(entry.context).length > 0) {
      message += ` ${JSON.stringify(entry.context)}`;
    }

    if (entry.meta && Object.keys(entry.meta).length > 0) {
      message += `\n  ${JSON.stringify(entry.meta, null, 2)}`;
    }

    switch (entry.level) {
      case 'fatal':
      case 'error':
        console.error(message);
        break;
      case 'warn':
        console.warn(message);
        break;
      default:
        console.log(message);
    }
  }
}

// ---- JSON Transport ----

export class JsonTransport implements LogTransport {
  write(entry: LogEntry): void {
    const json = JSON.stringify(entry);
    console.log(json);
  }
}

// ---- File Transport with Rotation ----

export class FileTransport implements LogTransport {
  private filePath: string;
  private maxSize: number;
  private maxFiles: number;
  private currentSize: number = 0;

  constructor(options: { filePath: string; maxSize?: number; maxFiles?: number }) {
    this.filePath = options.filePath;
    this.maxSize = options.maxSize ?? 10 * 1024 * 1024; // 10MB
    this.maxFiles = options.maxFiles ?? 5;
  }

  write(entry: LogEntry): void {
    const line = JSON.stringify(entry) + '\n';
    this.currentSize += Buffer.byteLength(line);

    if (this.currentSize > this.maxSize) {
      this.rotate();
    }

    // In a real implementation, we would write to the file
    // For now, we track the size
  }

  private rotate(): void {
    this.currentSize = 0;
    // In a real implementation, we would rotate files
  }

  async flush(): Promise<void> {
    // Flush any buffered writes
  }

  async close(): Promise<void> {
    await this.flush();
  }
}

// ---- Request ID Generator ----

let requestCounter = 0;

export function generateRequestId(): string {
  requestCounter++;
  const timestamp = Date.now().toString(36);
  const counter = requestCounter.toString(36).padStart(4, '0');
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${counter}-${random}`;
}

// ---- Logger Implementation ----

export class Logger implements LoggerInterface {
  private level: LogLevel;
  private transports: LogTransport[];
  private context: Record<string, unknown>;
  private requestId?: string;

  constructor(options?: {
    level?: LogLevel;
    transports?: LogTransport[];
    context?: Record<string, unknown>;
    requestId?: string;
  }) {
    this.level = options?.level ?? 'info';
    this.transports = options?.transports ?? [new ConsoleTransport()];
    this.context = options?.context ?? {};
    this.requestId = options?.requestId;
  }

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (!shouldLog(this.level, level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      requestId: this.requestId,
      meta,
      context: Object.keys(this.context).length > 0 ? { ...this.context } : undefined,
    };

    for (const transport of this.transports) {
      try {
        transport.write(entry);
      } catch {
        // Transport errors should not crash the logger
      }
    }
  }

  trace(message: string, meta?: Record<string, unknown>): void {
    this.log('trace', message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log('debug', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.log('error', message, meta);
  }

  fatal(message: string, meta?: Record<string, unknown>): void {
    this.log('fatal', message, meta);
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  setRequestId(requestId: string): void {
    this.requestId = requestId;
  }

  addTransport(transport: LogTransport): void {
    this.transports.push(transport);
  }

  removeTransport(transport: LogTransport): void {
    const index = this.transports.indexOf(transport);
    if (index !== -1) {
      this.transports.splice(index, 1);
    }
  }

  child(childContext: Record<string, unknown>): LoggerInterface {
    return new Logger({
      level: this.level,
      transports: this.transports,
      context: { ...this.context, ...childContext },
      requestId: this.requestId,
    });
  }

  async flush(): Promise<void> {
    for (const transport of this.transports) {
      if (transport.flush) {
        await transport.flush();
      }
    }
  }

  async close(): Promise<void> {
    for (const transport of this.transports) {
      if (transport.close) {
        await transport.close();
      }
    }
  }
}

// ---- Default Logger Factory ----

let defaultLogger: Logger | null = null;

export function getDefaultLogger(): Logger {
  if (!defaultLogger) {
    defaultLogger = new Logger();
  }
  return defaultLogger;
}

export function setDefaultLogger(logger: Logger): void {
  defaultLogger = logger;
}

export function createLogger(options?: {
  level?: LogLevel;
  json?: boolean;
  context?: Record<string, unknown>;
}): Logger {
  const transports: LogTransport[] = [];

  if (options?.json) {
    transports.push(new JsonTransport());
  } else {
    transports.push(new ConsoleTransport());
  }

  return new Logger({
    level: options?.level ?? 'info',
    transports,
    context: options?.context,
  });
}
