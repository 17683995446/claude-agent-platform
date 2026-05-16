// src/file-watcher.ts - 文件监视器

export type FileWatchEvent = 'create' | 'modify' | 'delete' | 'rename' | 'all';

export interface WatchOptions {
  recursive?: boolean;
  debounceMs?: number;
  ignorePatterns?: string[];
  persistent?: boolean;
}

export interface FileChangeEvent {
  type: FileWatchEvent;
  path: string;
  oldPath?: string;
  timestamp: number;
}

export type EventHandler = (event: FileChangeEvent) => void;

export class FileWatcher {
  private watchedPaths: Map<string, { options: WatchOptions; active: boolean }> = new Map();
  private handlers: Map<FileWatchEvent, Set<EventHandler>> = new Map();
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private isPaused: boolean = false;
  private fileStates: Map<string, string> = new Map(); // path -> mtime snapshot

  constructor() {
    for (const event of ['create', 'modify', 'delete', 'rename', 'all'] as FileWatchEvent[]) {
      this.handlers.set(event, new Set());
    }
  }

  watch(path: string, options?: WatchOptions): void {
    const watchOpts: WatchOptions = {
      recursive: true,
      debounceMs: 100,
      ignorePatterns: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/.DS_Store'],
      persistent: true,
      ...options,
    };

    this.watchedPaths.set(path, { options: watchOpts, active: true });
    // Store initial file state for change detection
    this.fileStates.set(path, 'initialized');
  }

  unwatch(path: string): void {
    this.watchedPaths.delete(path);
    this.debounceTimers.delete(path);
    this.fileStates.delete(path);
  }

  on(event: FileWatchEvent, handler: EventHandler): void {
    this.handlers.get(event)?.add(handler);
  }

  off(event: FileWatchEvent, handler: EventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  getWatchedPaths(): string[] {
    return Array.from(this.watchedPaths.keys()).filter(
      path => this.watchedPaths.get(path)?.active
    );
  }

  pause(): void {
    this.isPaused = true;
  }

  resume(): void {
    this.isPaused = false;
  }

  isWatching(path: string): boolean {
    const entry = this.watchedPaths.get(path);
    return entry?.active === true;
  }

  private shouldIgnore(path: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      if (pattern.includes('**')) {
        const parts = pattern.split('**');
        if (parts.length === 2 && path.includes(parts[1].replace(/^\//, ''))) {
          return true;
        }
      } else if (path.includes(pattern)) {
        return true;
      }
    }
    return false;
  }

  // Simulate a file change event (for testing)
  simulateEvent(event: FileChangeEvent): void {
    if (this.isPaused) return;

    const watchedEntry = this.watchedPaths.get(event.path);
    if (watchedEntry && this.shouldIgnore(event.path, watchedEntry.options.ignorePatterns || [])) {
      return;
    }

    // Debounce
    const debounceMs = watchedEntry?.options.debounceMs || 100;
    const existingTimer = this.debounceTimers.get(event.path);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    this.debounceTimers.set(event.path, setTimeout(() => {
      this.emit(event);
      this.debounceTimers.delete(event.path);
    }, debounceMs));
  }

  private emit(event: FileChangeEvent): void {
    // Emit to specific event handlers
    const specificHandlers = this.handlers.get(event.type);
    if (specificHandlers) {
      for (const handler of specificHandlers) {
        try {
          handler(event);
        } catch {
          // Silently handle handler errors
        }
      }
    }

    // Emit to 'all' handlers
    const allHandlers = this.handlers.get('all');
    if (allHandlers) {
      for (const handler of allHandlers) {
        try {
          handler(event);
        } catch {
          // Silently handle handler errors
        }
      }
    }
  }

  close(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.watchedPaths.clear();
    this.fileStates.clear();
  }

  getOptions(path: string): WatchOptions | undefined {
    return this.watchedPaths.get(path)?.options;
  }

  getHandlerCount(event: FileWatchEvent): number {
    return this.handlers.get(event)?.size || 0;
  }
}
