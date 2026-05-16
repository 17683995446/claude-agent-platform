// ============================================================================
// @claude-agent/perf - Precomputer
// 启动时预计算、后台预热、预计算缓存、智能失效
// ============================================================================

export interface PrecomputeTask<T> {
  /** 任务名称 */
  name: string;
  /** 计算函数 */
  compute: () => Promise<T> | T;
  /** 依赖的其他任务名称 */
  dependencies?: string[];
  /** 是否在启动时必须完成（阻塞启动） */
  critical?: boolean;
  /** 计算结果大小估算（字节） */
  estimatedSize?: number;
  /** 最大缓存时间（ms），0 表示永不过期 */
  ttl?: number;
  /** 失效条件函数 */
  invalidationCondition?: (value: T) => boolean;
}

export interface PrecomputeResult<T = unknown> {
  name: string;
  value: T;
  computedAt: number;
  computeTime: number;
  size: number;
  expired: boolean;
}

export interface PrecomputerOptions {
  /** 最大缓存大小（字节） */
  maxCacheSize?: number;
  /** 后台预热延迟（ms） */
  backgroundWarmupDelay?: number;
  /** 预计算超时（ms） */
  computeTimeout?: number;
}

export interface PrecomputerStats {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  pendingTasks: number;
  totalComputeTime: number;
  cacheSize: number;
  cacheHitCount: number;
  cacheMissCount: number;
  invalidationCount: number;
}

interface CachedResult<T> {
  value: T;
  computedAt: number;
  computeTime: number;
  ttl: number;
  size: number;
  invalidationCondition?: (value: T) => boolean;
}

export class Precomputer {
  private tasks = new Map<string, PrecomputeTask<unknown>>();
  private cache = new Map<string, CachedResult<unknown>>();
  private options: Required<PrecomputerOptions>;
  private stats = {
    completedTasks: 0,
    failedTasks: 0,
    totalComputeTime: 0,
    cacheHitCount: 0,
    cacheMissCount: 0,
    invalidationCount: 0,
  };
  private computing = new Set<string>();

  constructor(options?: PrecomputerOptions) {
    this.options = {
      maxCacheSize: options?.maxCacheSize ?? 100 * 1024 * 1024, // 100MB
      backgroundWarmupDelay: options?.backgroundWarmupDelay ?? 100,
      computeTimeout: options?.computeTimeout ?? 30_000,
    };
  }

  /** 注册预计算任务 */
  register<T>(task: PrecomputeTask<T>): void {
    this.tasks.set(task.name, task as PrecomputeTask<unknown>);
  }

  /** 获取预计算结果 */
  async get<T>(name: string): Promise<T> {
    // Check cache
    const cached = this.cache.get(name);
    if (cached) {
      // Check TTL
      if (cached.ttl > 0 && Date.now() - cached.computedAt > cached.ttl) {
        this.cache.delete(name);
        this.stats.invalidationCount++;
      } else {
        // Check invalidation condition
        if (cached.invalidationCondition?.(cached.value)) {
          this.cache.delete(name);
          this.stats.invalidationCount++;
        } else {
          this.stats.cacheHitCount++;
          return cached.value as T;
        }
      }
    }

    this.stats.cacheMissCount++;

    // Compute
    const task = this.tasks.get(name);
    if (!task) {
      throw new Error(`Precompute task "${name}" not found`);
    }

    return this.computeTask<T>(name, task as PrecomputeTask<T>);
  }

  /** 同步获取缓存值（仅当已缓存时） */
  getSync<T>(name: string): T | undefined {
    const cached = this.cache.get(name);
    if (!cached) return undefined;

    if (cached.ttl > 0 && Date.now() - cached.computedAt > cached.ttl) {
      return undefined;
    }

    if (cached.invalidationCondition?.(cached.value)) {
      return undefined;
    }

    this.stats.cacheHitCount++;
    return cached.value as T;
  }

  /** 预热所有关键任务（阻塞） */
  async warmupCritical(): Promise<void> {
    const criticalTasks = Array.from(this.tasks.values()).filter((t) => t.critical);
    await this.computeWithDependencies(criticalTasks.map((t) => t.name));
  }

  /** 后台预热所有任务（非阻塞） */
  async warmupBackground(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.options.backgroundWarmupDelay));

    const allTaskNames = Array.from(this.tasks.keys());
    this.computeWithDependencies(allTaskNames).catch(() => {
      // Ignore background warmup errors
    });
  }

  /** 失效指定任务的缓存 */
  invalidate(name: string): boolean {
    return this.cache.delete(name);
  }

  /** 失效所有缓存 */
  invalidateAll(): void {
    this.cache.clear();
  }

  /** 获取所有预计算结果 */
  getAllResults(): PrecomputeResult[] {
    const results: PrecomputeResult[] = [];
    const now = Date.now();

    for (const [name, cached] of this.cache) {
      results.push({
        name,
        value: cached.value,
        computedAt: cached.computedAt,
        computeTime: cached.computeTime,
        size: cached.size,
        expired: cached.ttl > 0 && now - cached.computedAt > cached.ttl,
      });
    }

    return results;
  }

  /** 获取统计信息 */
  getStats(): PrecomputerStats {
    let cacheSize = 0;
    for (const cached of this.cache.values()) {
      cacheSize += cached.size;
    }

    return {
      totalTasks: this.tasks.size,
      completedTasks: this.stats.completedTasks,
      failedTasks: this.stats.failedTasks,
      pendingTasks: this.tasks.size - this.cache.size,
      totalComputeTime: this.stats.totalComputeTime,
      cacheSize,
      cacheHitCount: this.stats.cacheHitCount,
      cacheMissCount: this.stats.cacheMissCount,
      invalidationCount: this.stats.invalidationCount,
    };
  }

  /** 销毁预计算器 */
  dispose(): void {
    this.cache.clear();
    this.tasks.clear();
    this.computing.clear();
  }

  private async computeTask<T>(name: string, task: PrecomputeTask<T>): Promise<T> {
    // Prevent concurrent computation
    if (this.computing.has(name)) {
      // Wait for existing computation
      while (this.computing.has(name)) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const cached = this.cache.get(name);
      return cached!.value as T;
    }

    this.computing.add(name);
    const startTime = Date.now();

    try {
      const result = await this.withTimeout(task.compute(), this.options.computeTimeout);
      const computeTime = Date.now() - startTime;

      const cachedResult: CachedResult<T> = {
        value: result,
        computedAt: Date.now(),
        computeTime,
        ttl: task.ttl ?? 0,
        size: task.estimatedSize ?? this.estimateSize(result),
        invalidationCondition: task.invalidationCondition as ((value: T) => boolean) | undefined,
      };

      this.cache.set(name, cachedResult as CachedResult<unknown>);
      this.stats.completedTasks++;
      this.stats.totalComputeTime += computeTime;

      return result;
    } catch (error) {
      this.stats.failedTasks++;
      throw error;
    } finally {
      this.computing.delete(name);
    }
  }

  private async computeWithDependencies(taskNames: string[]): Promise<void> {
    const computed = new Set<string>();
    const queue = [...taskNames];

    while (queue.length > 0) {
      const name = queue.shift()!;
      if (computed.has(name)) continue;

      const task = this.tasks.get(name);
      if (!task) continue;

      // Check dependencies
      const deps = task.dependencies ?? [];
      const uncomputedDeps = deps.filter((d) => !computed.has(d) && !this.cache.has(d));

      if (uncomputedDeps.length > 0) {
        queue.unshift(name, ...uncomputedDeps);
        continue;
      }

      try {
        await this.computeTask(name, task);
        computed.add(name);
      } catch {
        computed.add(name); // Mark as attempted
      }
    }
  }

  private withTimeout<T>(promise: Promise<T> | T, timeout: number): Promise<T> {
    return Promise.race([
      Promise.resolve(promise),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Precompute timeout after ${timeout}ms`)), timeout),
      ),
    ]);
  }

  private estimateSize(value: unknown): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'string') return value.length * 2;
    if (typeof value === 'number') return 8;
    if (typeof value === 'boolean') return 4;
    try {
      return JSON.stringify(value).length * 2;
    } catch {
      return 256;
    }
  }
}
