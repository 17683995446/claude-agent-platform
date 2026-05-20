// ============================================================================
// @claude-agent/perf - LazyLoader
// 模块延迟加载，支持按需初始化、超时控制和失败回退
// ============================================================================

export interface LazyLoaderOptions<T> {
  /** 加载函数 */
  loader: () => Promise<T> | T;
  /** 加载超时时间（ms） */
  timeout?: number;
  /** 加载失败时的回退值 */
  fallback?: T | (() => T);
  /** 最大重试次数 */
  maxRetries?: number;
  /** 重试间隔（ms） */
  retryDelay?: number;
  /** 是否在首次访问时自动加载 */
  autoLoad?: boolean;
  /** 加载成功回调 */
  onLoad?: (value: T) => void;
  /** 加载失败回调 */
  onError?: (error: Error) => void;
  /** 缓存 TTL（ms），0 表示永不过期 */
  ttl?: number;
}

export type LazyState = 'pending' | 'loading' | 'loaded' | 'error';

export interface LazyLoaderStats {
  state: LazyState;
  loadTime: number | null;
  retryCount: number;
  accessCount: number;
  lastAccessTime: number | null;
}

export class LazyLoader<T> {
  private value: T | undefined;
  private error: Error | undefined;
  private state: LazyState = 'pending';
  private options: Required<
    Omit<LazyLoaderOptions<T>, 'fallback'> & {
      fallback: T | (() => T) | undefined;
    }
  >;
  private loadPromise: Promise<T> | null = null;
  private stats = {
    loadTime: 0,
    retryCount: 0,
    accessCount: 0,
    lastAccessTime: 0,
  };
  private loadedAt: number = 0;

  constructor(options: LazyLoaderOptions<T>) {
    this.options = {
      loader: options.loader,
      timeout: options.timeout ?? 30_000,
      fallback: options.fallback,
      maxRetries: options.maxRetries ?? 3,
      retryDelay: options.retryDelay ?? 1000,
      autoLoad: options.autoLoad ?? false,
      onLoad: options.onLoad,
      onError: options.onError,
      ttl: options.ttl ?? 0,
    };
  }

  /** 获取加载的值，如果尚未加载则触发加载 */
  async get(): Promise<T> {
    this.stats.accessCount++;
    this.stats.lastAccessTime = Date.now();

    if (this.state === 'loaded' && this.value !== undefined) {
      // Check TTL
      if (this.options.ttl > 0 && Date.now() - this.loadedAt > this.options.ttl) {
        // TTL expired, reset and reload
        this.reset();
      } else {
        return this.value;
      }
    }

    if (this.state === 'error') {
      // Try to reload on error state
      return this.load();
    }

    return this.load();
  }

  /** 同步获取值（仅在已加载时有效） */
  getSync(): T | undefined {
    this.stats.accessCount++;
    this.stats.lastAccessTime = Date.now();

    if (this.state === 'loaded') {
      return this.value;
    }

    if (this.state === 'error' && this.options.fallback !== undefined) {
      return typeof this.options.fallback === 'function'
        ? (this.options.fallback as () => T)()
        : this.options.fallback;
    }

    return undefined;
  }

  /** 手动触发加载 */
  async load(): Promise<T> {
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.state = 'loading';
    const startTime = Date.now();

    this.loadPromise = this.loadWithRetry();

    try {
      const result = await this.loadPromise;
      this.value = result;
      this.state = 'loaded';
      this.loadedAt = Date.now();
      this.stats.loadTime = Date.now() - startTime;
      this.options.onLoad?.(result);
      return result;
    } catch (err) {
      this.error = err instanceof Error ? err : new Error(String(err));
      this.state = 'error';
      this.stats.loadTime = Date.now() - startTime;
      this.options.onError?.(this.error);

      if (this.options.fallback !== undefined) {
        const fallback =
          typeof this.options.fallback === 'function'
            ? (this.options.fallback as () => T)()
            : this.options.fallback;
        return fallback;
      }

      throw this.error;
    } finally {
      this.loadPromise = null;
    }
  }

  /** 重置加载器，允许重新加载 */
  reset(): void {
    this.value = undefined;
    this.error = undefined;
    this.state = 'pending';
    this.loadPromise = null;
    this.stats.retryCount = 0;
  }

  /** 检查是否已加载 */
  isLoaded(): boolean {
    return this.state === 'loaded';
  }

  /** 检查是否正在加载 */
  isLoading(): boolean {
    return this.state === 'loading';
  }

  /** 获取当前状态 */
  getState(): LazyState {
    return this.state;
  }

  /** 获取统计信息 */
  getStats(): LazyLoaderStats {
    return {
      state: this.state,
      loadTime: this.state === 'loaded' ? this.stats.loadTime : null,
      retryCount: this.stats.retryCount,
      accessCount: this.stats.accessCount,
      lastAccessTime: this.stats.lastAccessTime || null,
    };
  }

  /** 预加载（不等待结果） */
  preload(): void {
    if (this.state === 'pending' || this.state === 'error') {
      this.load().catch(() => {
        // Silently ignore preload errors
      });
    }
  }

  /** 预取（返回 Promise，可用于等待加载完成） */
  async prefetch(): Promise<T> {
    return this.load();
  }

  private async loadWithRetry(): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          this.stats.retryCount = attempt;
          await this.delay(this.options.retryDelay * attempt);
        }

        const result = await this.withTimeout(this.options.loader(), this.options.timeout);
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    throw lastError ?? new Error('LazyLoader: max retries exceeded');
  }

  private withTimeout(promise: Promise<T> | T, timeout: number): Promise<T> {
    if (timeout <= 0) return Promise.resolve(promise);

    return Promise.race([
      Promise.resolve(promise),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`LazyLoader: timeout after ${timeout}ms`)), timeout),
      ),
    ]);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** 创建多个延迟加载器的管理器 */
export class LazyLoaderRegistry {
  private loaders = new Map<string, LazyLoader<unknown>>();

  register<T>(name: string, options: LazyLoaderOptions<T>): LazyLoader<T> {
    const loader = new LazyLoader<T>(options);
    this.loaders.set(name, loader as LazyLoader<unknown>);
    return loader;
  }

  get<T>(name: string): LazyLoader<T> | undefined {
    return this.loaders.get(name) as LazyLoader<T> | undefined;
  }

  async getAll(): Promise<Map<string, unknown>> {
    const results = new Map<string, unknown>();
    const entries = Array.from(this.loaders.entries());
    const loaded = await Promise.all(
      entries.map(async ([name, loader]) => {
        const value = await loader.get();
        return [name, value] as const;
      }),
    );
    for (const [name, value] of loaded) {
      results.set(name, value);
    }
    return results;
  }

  async preloadAll(): Promise<void> {
    await Promise.all(Array.from(this.loaders.values()).map((loader) => loader.preload()));
  }

  getStats(): Record<string, LazyLoaderStats> {
    const result: Record<string, LazyLoaderStats> = {};
    for (const [name, loader] of this.loaders) {
      result[name] = loader.getStats();
    }
    return result;
  }

  reset(name?: string): void {
    if (name) {
      this.loaders.get(name)?.reset();
    } else {
      for (const loader of this.loaders.values()) {
        loader.reset();
      }
    }
  }
}
