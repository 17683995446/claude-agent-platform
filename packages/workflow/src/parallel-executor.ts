// parallel-executor.ts - 并行执行器

export interface ParallelTask {
  id: string;
  execute: () => Promise<unknown>;
  priority?: number; // higher = more important
  resources?: Record<string, number>; // resource requirements
}

export type ErrorStrategy = 'fail-fast' | 'continue-on-error' | 'retry-failed';
export type ResultAggregation = 'all' | 'first-success' | 'majority-vote';

export interface ParallelOptions {
  concurrency?: number;
  errorStrategy?: ErrorStrategy;
  aggregation?: ResultAggregation;
  taskTimeout?: number;
  overallTimeout?: number;
  maxRetries?: number;
}

export interface TaskResult {
  id: string;
  success: boolean;
  result?: unknown;
  error?: string;
  duration: number;
  retries: number;
}

export interface ParallelProgress {
  total: number;
  completed: number;
  failed: number;
  percentage: number;
}

export interface ParallelResult {
  results: TaskResult[];
  aggregated?: unknown;
  progress: ParallelProgress;
  duration: number;
  success: boolean;
}

export class ParallelExecutor {
  private defaultOptions: Required<ParallelOptions> = {
    concurrency: 10,
    errorStrategy: 'fail-fast',
    aggregation: 'all',
    taskTimeout: 30000,
    overallTimeout: 300000,
    maxRetries: 0,
  };

  /**
   * Execute multiple tasks in parallel with configurable options.
   */
  async execute(tasks: ParallelTask[], options?: ParallelOptions): Promise<ParallelResult> {
    const opts = { ...this.defaultOptions, ...options };
    const startTime = Date.now();
    const results: TaskResult[] = [];

    // Sort by priority (higher priority first)
    const sortedTasks = [...tasks].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    // Progress tracking
    let completedCount = 0;
    let failedCount = 0;

    const updateProgress = (): ParallelProgress => ({
      total: sortedTasks.length,
      completed: completedCount + failedCount,
      failed: failedCount,
      percentage: sortedTasks.length > 0 ? Math.round(((completedCount + failedCount) / sortedTasks.length) * 100) : 100,
    });

    // Overall timeout
    let overallTimer: ReturnType<typeof setTimeout> | null = null;
    let overallTimedOut = false;

    if (opts.overallTimeout > 0) {
      overallTimer = setTimeout(() => { overallTimedOut = true; }, opts.overallTimeout);
    }

    // Queue-based execution with concurrency limit
    const queue = [...sortedTasks];
    const executing = new Set<Promise<void>>();

    const processTask = async (task: ParallelTask): Promise<void> => {
      if (overallTimedOut) return;

      let lastError: string | undefined;
      let retries = 0;
      let success = false;
      let result: unknown;

      for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
        if (overallTimedOut) return;

        try {
          const taskStart = Date.now();
          const taskPromise = task.execute();

          result = await Promise.race([
            taskPromise,
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`Task "${task.id}" timed out`)), opts.taskTimeout)
            ),
          ]);

          success = true;
          lastError = undefined;
          results.push({
            id: task.id,
            success: true,
            result,
            duration: Date.now() - taskStart,
            retries: attempt,
          });
          completedCount++;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          retries = attempt;
          if (attempt < opts.maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
          }
        }
      }

      if (!success) {
        results.push({
          id: task.id,
          success: false,
          error: lastError,
          duration: 0,
          retries,
        });
        failedCount++;

        if (opts.errorStrategy === 'fail-fast') {
          overallTimedOut = true; // Use this flag to stop other tasks
        }
      }
    };

    while (queue.length > 0 || executing.size > 0) {
      if (overallTimedOut) break;

      // Fill up to concurrency limit
      while (queue.length > 0 && executing.size < opts.concurrency && !overallTimedOut) {
        const task = queue.shift()!;
        const promise = processTask(task).then(() => { executing.delete(promise); });
        executing.add(promise);
      }

      if (executing.size > 0) {
        await Promise.race(executing);
      }
    }

    // Wait for all executing tasks to complete
    await Promise.allSettled(executing);

    if (overallTimer) clearTimeout(overallTimer);

    // Sort results by original task order
    const taskOrder = new Map(tasks.map((t, i) => [t.id, i]));
    results.sort((a, b) => (taskOrder.get(a.id) ?? 0) - (taskOrder.get(b.id) ?? 0));

    const duration = Date.now() - startTime;
    const progress = updateProgress();
    const allSuccess = results.every(r => r.success);

    // Aggregate results
    let aggregated: unknown;
    switch (opts.aggregation) {
      case 'all':
        aggregated = results.map(r => r.result);
        break;
      case 'first-success':
        aggregated = results.find(r => r.success)?.result;
        break;
      case 'majority-vote': {
        const votes = results.filter(r => r.success).map(r => r.result);
        const voteCounts = new Map<string, number>();
        for (const vote of votes) {
          const key = JSON.stringify(vote);
          voteCounts.set(key, (voteCounts.get(key) ?? 0) + 1);
        }
        let maxVotes = 0;
        let majorityKey: string | null = null;
        for (const [key, count] of voteCounts) {
          if (count > maxVotes) {
            maxVotes = count;
            majorityKey = key;
          }
        }
        aggregated = majorityKey ? JSON.parse(majorityKey) : undefined;
        break;
      }
    }

    return {
      results,
      aggregated,
      progress,
      duration,
      success: opts.errorStrategy === 'continue-on-error' ? completedCount > 0 : allSuccess,
    };
  }
}
