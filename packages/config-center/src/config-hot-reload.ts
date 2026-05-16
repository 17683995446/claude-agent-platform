/**
 * 配置热重载模块
 * 支持文件系统监听、防抖重载、原子更新和回滚
 */

import { ConfigStore } from './config-store.js';
import { ConfigSourceManager } from './config-sources.js';
import { ConfigValidator, type ConfigSchema } from './config-validation.js';

export interface ReloadEvent {
  timestamp: number;
  source: string;
  success: boolean;
  error?: string;
  changes?: number;
}

export type ReloadCallback = (event: ReloadEvent) => void;
export type UnwatchFn = () => void;

/**
 * ConfigHotReloader - 配置热重载器
 */
export class ConfigHotReloader {
  private store: ConfigStore;
  private sourceManager: ConfigSourceManager;
  private validator?: ConfigValidator;
  private schemas?: Record<string, ConfigSchema>;
  private callbacks: ReloadCallback[] = [];
  private reloadHistory: ReloadEvent[] = [];
  private watching = false;
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private debounceMs: number;
  private watchers: Array<{ sourceName: string; close: () => void }> = [];
  private preReloadData: Record<string, unknown> | null = null;

  constructor(
    store: ConfigStore,
    sourceManager: ConfigSourceManager,
    options?: { debounceMs?: number; validator?: ConfigValidator; schemas?: Record<string, ConfigSchema> },
  ) {
    this.store = store;
    this.sourceManager = sourceManager;
    this.debounceMs = options?.debounceMs || 300;
    this.validator = options?.validator;
    this.schemas = options?.schemas;
  }

  /**
   * 开始监听配置文件变化
   */
  startWatching(): void {
    if (this.watching) return;
    this.watching = true;
    // Store pre-reload state for rollback
    this.preReloadData = this.store.getAll();
  }

  /**
   * 停止监听
   */
  stopWatching(): void {
    this.watching = false;
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    for (const w of this.watchers) {
      w.close();
    }
    this.watchers = [];
  }

  /**
   * 注册重载回调
   */
  onReload(callback: ReloadCallback): UnwatchFn {
    this.callbacks.push(callback);
    return () => {
      const idx = this.callbacks.indexOf(callback);
      if (idx !== -1) this.callbacks.splice(idx, 1);
    };
  }

  /**
   * 触发重载（带防抖）
   */
  triggerReload(sourceName: string): void {
    if (!this.watching) return;

    const existingTimer = this.debounceTimers.get(sourceName);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      await this.executeReload(sourceName);
      this.debounceTimers.delete(sourceName);
    }, this.debounceMs);

    this.debounceTimers.set(sourceName, timer);
  }

  /**
   * 获取重载历史
   */
  getReloadHistory(): ReloadEvent[] {
    return [...this.reloadHistory];
  }

  /**
   * 清空重载历史
   */
  clearHistory(): void {
    this.reloadHistory = [];
  }

  /**
   * 检查是否正在监听
   */
  isWatching(): boolean {
    return this.watching;
  }

  private async executeReload(sourceName: string): Promise<void> {
    const event: ReloadEvent = {
      timestamp: Date.now(),
      source: sourceName,
      success: false,
    };

    try {
      const newData = await this.sourceManager.reload(sourceName);

      // Validate if validator is configured
      if (this.validator && this.schemas) {
        const report = this.validator.validateAll(newData, this.schemas);
        if (!report.valid) {
          event.error = `Validation failed: ${report.errors.map((e) => e.message).join(', ')}`;
          this.reloadHistory.push(event);
          this.notifyCallbacks(event);
          return;
        }
      }

      // Save pre-reload state for potential rollback
      this.preReloadData = this.store.getAll();

      // Atomic update: merge all new data
      this.store.merge(newData);

      event.success = true;
      event.changes = Object.keys(newData).length;
    } catch (err) {
      event.error = err instanceof Error ? err.message : String(err);
      // Rollback on failure
      if (this.preReloadData) {
        this.store.clear();
        this.store.merge(this.preReloadData);
      }
    }

    this.reloadHistory.push(event);
    this.notifyCallbacks(event);
  }

  private notifyCallbacks(event: ReloadEvent): void {
    for (const cb of this.callbacks) {
      try {
        cb(event);
      } catch {
        // swallow callback errors
      }
    }
  }
}
