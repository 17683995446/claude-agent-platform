// src/task-runner.ts - 任务运行器

export type TaskHandler = () => Promise<unknown> | unknown;

export interface TaskOptions {
  description?: string;
  dependencies?: string[];
  timeout?: number;
  retryCount?: number;
  continueOnError?: boolean;
}

export interface TaskResult {
  taskName: string;
  success: boolean;
  duration: number;
  output?: string;
  error?: string;
  dependencies?: string[];
}

export interface TaskInfo {
  name: string;
  description?: string;
  dependencies: string[];
  hasHandler: boolean;
}

export interface TaskGraphData {
  nodes: { name: string; description?: string }[];
  edges: { from: string; to: string }[];
}

export class TaskRunner {
  private tasks: Map<string, { handler: TaskHandler; options: TaskOptions }> = new Map();
  private results: Map<string, TaskResult> = new Map();
  private running: boolean = false;

  define(name: string, handler: TaskHandler, options?: TaskOptions): void {
    this.tasks.set(name, {
      handler,
      options: {
        description: '',
        dependencies: [],
        timeout: 30000,
        retryCount: 0,
        continueOnError: false,
        ...options,
      },
    });
  }

  async run(taskName: string): Promise<TaskResult> {
    const task = this.tasks.get(taskName);
    if (!task) {
      return {
        taskName,
        success: false,
        duration: 0,
        error: `Task '${taskName}' not found`,
      };
    }

    // Check for circular dependencies
    if (this.hasCircularDependency(taskName)) {
      return {
        taskName,
        success: false,
        duration: 0,
        error: `Circular dependency detected for task '${taskName}'`,
      };
    }

    // Run dependencies first
    const deps = task.options.dependencies || [];
    for (const dep of deps) {
      const depResult = await this.run(dep);
      if (!depResult.success && !task.options.continueOnError) {
        return {
          taskName,
          success: false,
          duration: 0,
          error: `Dependency '${dep}' failed`,
          dependencies: deps,
        };
      }
    }

    // Run the task
    const start = performance.now();
    let output = '';
    let error: string | undefined;

    try {
      const timeout = task.options.timeout || 30000;
      let timeoutId: ReturnType<typeof setTimeout>;
      const result = await Promise.race([
        Promise.resolve(task.handler()),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(`Task '${taskName}' timed out after ${timeout}ms`)), timeout);
        }),
      ]);
      clearTimeout(timeoutId!);
      output = result !== undefined ? String(result) : '';
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const duration = performance.now() - start;
    const result: TaskResult = {
      taskName,
      success: error === undefined,
      duration,
      output,
      error,
      dependencies: deps,
    };

    this.results.set(taskName, result);
    return result;
  }

  async runParallel(taskNames: string[]): Promise<TaskResult[]> {
    return Promise.all(taskNames.map(name => this.run(name)));
  }

  listTasks(): TaskInfo[] {
    return Array.from(this.tasks.entries()).map(([name, { options }]) => ({
      name,
      description: options.description,
      dependencies: options.dependencies || [],
      hasHandler: true,
    }));
  }

  getTaskGraph(): TaskGraphData {
    const nodes: TaskGraphData['nodes'] = [];
    const edges: TaskGraphData['edges'] = [];

    for (const [name, { options }] of this.tasks) {
      nodes.push({ name, description: options.description });
      for (const dep of options.dependencies || []) {
        edges.push({ from: name, to: dep });
      }
    }

    return { nodes, edges };
  }

  getResult(taskName: string): TaskResult | undefined {
    return this.results.get(taskName);
  }

  clearResults(): void {
    this.results.clear();
  }

  removeTask(name: string): boolean {
    return this.tasks.delete(name);
  }

  hasTask(name: string): boolean {
    return this.tasks.has(name);
  }

  private hasCircularDependency(taskName: string, path: string[] = []): boolean {
    if (path.includes(taskName)) return true;

    const task = this.tasks.get(taskName);
    if (!task) return false;

    const newPath = [...path, taskName];
    for (const dep of task.options.dependencies || []) {
      if (this.hasCircularDependency(dep, newPath)) {
        return true;
      }
    }

    return false;
  }

  getDependencyOrder(): string[] {
    const order: string[] = [];
    const visited = new Set<string>();

    const visit = (name: string) => {
      if (visited.has(name)) return;
      visited.add(name);

      const task = this.tasks.get(name);
      if (task) {
        for (const dep of task.options.dependencies || []) {
          visit(dep);
        }
      }

      order.push(name);
    };

    for (const name of this.tasks.keys()) {
      visit(name);
    }

    return order;
  }
}
