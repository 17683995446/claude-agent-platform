// ============================================================================
// @claude-agent/perf - StartupOptimizer
// 依赖图分析、关键路径并行加载、启动时间测量、启动缓存
// ============================================================================

export interface StartupTask {
  /** 任务名称 */
  name: string;
  /** 任务执行函数 */
  execute: () => Promise<void>;
  /** 依赖的其他任务名称 */
  dependencies?: string[];
  /** 预估执行时间（ms） */
  estimatedTime?: number;
  /** 是否为关键路径任务 */
  critical?: boolean;
  /** 超时时间（ms） */
  timeout?: number;
}

export interface StartupTaskResult {
  name: string;
  status: 'completed' | 'failed' | 'skipped' | 'timeout';
  duration: number;
  error?: string;
  startTime: number;
  endTime: number;
}

export interface StartupOptimizerOptions {
  /** 最大并行任务数 */
  maxParallel?: number;
  /** 任务超时（ms） */
  defaultTimeout?: number;
  /** 是否启用启动缓存 */
  enableCache?: boolean;
  /** 缓存目录 */
  cacheDir?: string;
  /** 缓存有效期（ms） */
  cacheTTL?: number;
}

export interface StartupReport {
  totalDuration: number;
  criticalPathDuration: number;
  taskResults: StartupTaskResult[];
  dependencyGraph: DependencyGraphNode[];
  cacheHit: boolean;
  cacheSavedTime: number;
}

export interface DependencyGraphNode {
  name: string;
  dependencies: string[];
  dependents: string[];
  depth: number;
  criticalPath: boolean;
  estimatedTime: number;
}

export class StartupOptimizer {
  private tasks = new Map<string, StartupTask>();
  private options: Required<StartupOptimizerOptions>;
  private cache = new Map<string, { result: StartupTaskResult; timestamp: number }>();

  constructor(options?: StartupOptimizerOptions) {
    this.options = {
      maxParallel: options?.maxParallel ?? 10,
      defaultTimeout: options?.defaultTimeout ?? 30_000,
      enableCache: options?.enableCache ?? false,
      cacheDir: options?.cacheDir ?? '.startup-cache',
      cacheTTL: options?.cacheTTL ?? 300_000, // 5 minutes
    };
  }

  /** 注册启动任务 */
  registerTask(task: StartupTask): void {
    this.tasks.set(task.name, task);
  }

  /** 批量注册启动任务 */
  registerTasks(tasks: StartupTask[]): void {
    for (const task of tasks) {
      this.registerTask(task);
    }
  }

  /** 分析依赖图 */
  analyzeDependencies(): DependencyGraphNode[] {
    const nodes: DependencyGraphNode[] = [];
    const dependents = new Map<string, string[]>();

    // Initialize dependents map
    for (const name of this.tasks.keys()) {
      dependents.set(name, []);
    }

    // Build dependency relationships
    for (const [name, task] of this.tasks) {
      const deps = task.dependencies ?? [];
      for (const dep of deps) {
        dependents.get(dep)?.push(name);
      }
    }

    // Calculate depths using topological sort
    const depths = new Map<string, number>();
    const visiting = new Set<string>();
    const calculateDepth = (name: string): number => {
      if (depths.has(name)) return depths.get(name)!;
      if (visiting.has(name)) return 0; // Circular dependency
      visiting.add(name);
      const task = this.tasks.get(name);
      if (!task) { visiting.delete(name); return 0; }
      const deps = task.dependencies ?? [];
      if (deps.length === 0) {
        depths.set(name, 0);
        visiting.delete(name);
        return 0;
      }
      const maxDepDepth = Math.max(...deps.map(calculateDepth));
      depths.set(name, maxDepDepth + 1);
      visiting.delete(name);
      return maxDepDepth + 1;
    };

    for (const name of this.tasks.keys()) {
      calculateDepth(name);
    }

    // Find critical path
    const criticalPath = this.findCriticalPath();

    // Build nodes
    for (const [name, task] of this.tasks) {
      nodes.push({
        name,
        dependencies: task.dependencies ?? [],
        dependents: dependents.get(name) ?? [],
        depth: depths.get(name) ?? 0,
        criticalPath: criticalPath.has(name),
        estimatedTime: task.estimatedTime ?? 100,
      });
    }

    return nodes.sort((a, b) => a.depth - b.depth);
  }

  /** 执行启动流程 */
  async execute(): Promise<StartupReport> {
    const totalStart = Date.now();
    const results: StartupTaskResult[] = [];

    // Check cache
    if (this.options.enableCache) {
      const cacheResult = this.checkCache();
      if (cacheResult) {
        return {
          totalDuration: Date.now() - totalStart,
          criticalPathDuration: 0,
          taskResults: cacheResult,
          dependencyGraph: this.analyzeDependencies(),
          cacheHit: true,
          cacheSavedTime: this.estimateCacheSavedTime(cacheResult),
        };
      }
    }

    // Build execution plan
    const graph = this.analyzeDependencies();
    const executed = new Set<string>();
    const semaphore = new SimpleSemaphore(this.options.maxParallel);

    const executeTask = async (name: string): Promise<StartupTaskResult> => {
      const task = this.tasks.get(name)!;
      const startTime = Date.now();

      try {
        await semaphore.acquire();
        const result = await this.withTimeout(
          task.execute(),
          task.timeout ?? this.options.defaultTimeout,
        );
        const endTime = Date.now();

        const taskResult: StartupTaskResult = {
          name,
          status: 'completed',
          duration: endTime - startTime,
          startTime,
          endTime,
        };

        executed.add(name);
        results.push(taskResult);

        // Cache result
        if (this.options.enableCache) {
          this.cache.set(name, { result: taskResult, timestamp: Date.now() });
        }

        return taskResult;
      } catch (error) {
        const endTime = Date.now();
        const taskResult: StartupTaskResult = {
          name,
          status: error instanceof TimeoutError ? 'timeout' : 'failed',
          duration: endTime - startTime,
          error: error instanceof Error ? error.message : String(error),
          startTime,
          endTime,
        };

        executed.add(name);
        results.push(taskResult);
        return taskResult;
      } finally {
        semaphore.release();
      }
    };

    // Execute tasks in dependency order with parallelism
    const pending = new Set(this.tasks.keys());

    while (pending.size > 0) {
      const ready: string[] = [];

      for (const name of pending) {
        const task = this.tasks.get(name)!;
        const deps = task.dependencies ?? [];
        if (deps.every((d) => executed.has(d))) {
          ready.push(name);
        }
      }

      if (ready.length === 0) {
        // Circular dependency or all remaining tasks have unmet dependencies
        for (const name of pending) {
          results.push({
            name,
            status: 'skipped',
            duration: 0,
            startTime: Date.now(),
            endTime: Date.now(),
            error: 'Unmet dependencies',
          });
        }
        break;
      }

      // Execute ready tasks in parallel
      await Promise.all(ready.map(executeTask));

      for (const name of ready) {
        pending.delete(name);
      }
    }

    const totalDuration = Date.now() - totalStart;
    const criticalPathDuration = this.calculateCriticalPathDuration(results);

    return {
      totalDuration,
      criticalPathDuration,
      taskResults: results,
      dependencyGraph: graph,
      cacheHit: false,
      cacheSavedTime: 0,
    };
  }

  /** 获取统计信息 */
  getStats(): {
    totalTasks: number;
    criticalTasks: number;
    maxDepth: number;
    cachedTasks: number;
  } {
    const graph = this.analyzeDependencies();
    return {
      totalTasks: this.tasks.size,
      criticalTasks: graph.filter((n) => n.criticalPath).length,
      maxDepth: Math.max(0, ...graph.map((n) => n.depth)),
      cachedTasks: this.cache.size,
    };
  }

  /** 清除缓存 */
  clearCache(): void {
    this.cache.clear();
  }

  /** 重置优化器 */
  reset(): void {
    this.tasks.clear();
    this.cache.clear();
  }

  private findCriticalPath(): Set<string> {
    // Find the longest path through the dependency graph
    const taskTimes = new Map<string, number>();
    const criticalPath = new Set<string>();
    const visiting = new Set<string>();

    const getLongestPath = (name: string): number => {
      if (taskTimes.has(name)) return taskTimes.get(name)!;
      if (visiting.has(name)) return 0; // Circular dependency
      visiting.add(name);

      const task = this.tasks.get(name);
      if (!task) { visiting.delete(name); return 0; }
      const deps = task.dependencies ?? [];
      const myTime = task.estimatedTime ?? 100;

      if (deps.length === 0) {
        taskTimes.set(name, myTime);
        visiting.delete(name);
        return myTime;
      }

      const maxDepTime = Math.max(...deps.map(getLongestPath));
      const totalTime = myTime + maxDepTime;
      taskTimes.set(name, totalTime);
      visiting.delete(name);
      return totalTime;
    };

    for (const name of this.tasks.keys()) {
      getLongestPath(name);
    }

    // Trace back from the task with the longest total time
    let maxTime = 0;
    let maxTask = '';
    for (const [name, time] of taskTimes) {
      if (time > maxTime) {
        maxTime = time;
        maxTask = name;
      }
    }

    // Trace the critical path
    let current = maxTask;
    const traced = new Set<string>();
    while (current && !traced.has(current)) {
      traced.add(current);
      criticalPath.add(current);
      const task = this.tasks.get(current);
      if (!task) break;
      const deps = task.dependencies ?? [];

      if (deps.length === 0) break;

      let maxDepTime = -1;
      let maxDep = '';
      for (const dep of deps) {
        const depTime = taskTimes.get(dep) ?? 0;
        if (depTime > maxDepTime) {
          maxDepTime = depTime;
          maxDep = dep;
        }
      }
      current = maxDep;
    }

    return criticalPath;
  }

  private calculateCriticalPathDuration(results: StartupTaskResult[]): number {
    const graph = this.analyzeDependencies();
    const criticalTasks = graph.filter((n) => n.criticalPath);
    const criticalResults = results.filter((r) => criticalTasks.some((t) => t.name === r.name));
    return criticalResults.reduce((sum, r) => sum + r.duration, 0);
  }

  private checkCache(): StartupTaskResult[] | null {
    if (!this.options.enableCache || this.cache.size === 0) return null;
    if (this.cache.size !== this.tasks.size) return null;

    const now = Date.now();
    for (const [, cached] of this.cache) {
      if (now - cached.timestamp > this.options.cacheTTL) return null;
    }

    return Array.from(this.cache.values()).map((c) => c.result);
  }

  private estimateCacheSavedTime(results: StartupTaskResult[]): number {
    return results.reduce((sum, r) => sum + r.duration, 0);
  }

  private withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new TimeoutError(`Task timeout after ${timeout}ms`)), timeout),
      ),
    ]);
  }
}

// Simple semaphore for internal use
class SimpleSemaphore {
  private current = 0;
  private queue: Array<() => void> = [];
  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      this.queue.shift()!();
    } else {
      this.current = Math.max(0, this.current - 1);
    }
  }
}

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}
