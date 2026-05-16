// src/dependency-resolver.ts - 依赖解析器

export interface TaskNode {
  id: string;
  name: string;
  estimatedDuration?: number;
  dependencies?: string[];
  metadata?: Record<string, unknown>;
}

export interface ExecutionPlan {
  orderedTasks: string[];
  parallelGroups: string[][];
  criticalPath: string[];
  totalEstimatedDuration: number;
  hasCircularDependency: boolean;
  circularDependencies: string[][];
}

export class DependencyResolver {
  private tasks: Map<string, TaskNode> = new Map();
  private adjacencyList: Map<string, Set<string>> = new Map();
  private reverseAdjacencyList: Map<string, Set<string>> = new Map();

  addTask(task: TaskNode): void {
    this.tasks.set(task.id, task);
    if (!this.adjacencyList.has(task.id)) {
      this.adjacencyList.set(task.id, new Set());
    }
    if (!this.reverseAdjacencyList.has(task.id)) {
      this.reverseAdjacencyList.set(task.id, new Set());
    }
    if (task.dependencies) {
      for (const dep of task.dependencies) {
        this.addDependency(task.id, dep);
      }
    }
  }

  addDependency(from: string, to: string): void {
    if (!this.adjacencyList.has(from)) {
      this.adjacencyList.set(from, new Set());
    }
    if (!this.reverseAdjacencyList.has(to)) {
      this.reverseAdjacencyList.set(to, new Set());
    }
    this.adjacencyList.get(from)!.add(to);
    this.reverseAdjacencyList.get(to)!.add(from);
  }

  resolve(): ExecutionPlan {
    const circularDeps = this.detectCircularDependencies();
    if (circularDeps.length > 0) {
      return {
        orderedTasks: [],
        parallelGroups: [],
        criticalPath: [],
        totalEstimatedDuration: 0,
        hasCircularDependency: true,
        circularDependencies: circularDeps,
      };
    }

    const orderedTasks = this.topologicalSort();
    const parallelGroups = this.getParallelGroupsInternal(orderedTasks);
    const criticalPath = this.getCriticalPathInternal();
    const totalDuration = this.calculateTotalDuration(criticalPath);

    return {
      orderedTasks,
      parallelGroups,
      criticalPath,
      totalEstimatedDuration: totalDuration,
      hasCircularDependency: false,
      circularDependencies: [],
    };
  }

  getCriticalPath(): string[] {
    const circular = this.detectCircularDependencies();
    if (circular.length > 0) return [];
    return this.getCriticalPathInternal();
  }

  getParallelGroups(): string[][] {
    const circular = this.detectCircularDependencies();
    if (circular.length > 0) return [];
    const ordered = this.topologicalSort();
    return this.getParallelGroupsInternal(ordered);
  }

  private topologicalSort(): string[] {
    // adjacencyList: from -> set of deps (from depends on deps)
    // So deps must come before from. In-degree = number of dependencies.
    const inDegree: Map<string, number> = new Map();
    for (const [id] of this.tasks) {
      inDegree.set(id, 0);
    }
    for (const [from, deps] of this.adjacencyList) {
      if (inDegree.has(from)) {
        inDegree.set(from, (inDegree.get(from) ?? 0) + deps.size);
      }
    }

    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id);
    }

    const result: string[] = [];
    while (queue.length > 0) {
      const node = queue.shift()!;
      result.push(node);

      // reverseAdjacencyList: to -> set of froms (who depends on 'to')
      for (const dependent of this.reverseAdjacencyList.get(node) ?? []) {
        if (inDegree.has(dependent)) {
          const newDegree = (inDegree.get(dependent) ?? 1) - 1;
          inDegree.set(dependent, newDegree);
          if (newDegree === 0) {
            queue.push(dependent);
          }
        }
      }
    }

    return result;
  }

  private getParallelGroupsInternal(orderedTasks: string[]): string[][] {
    const completed = new Set<string>();
    const groups: string[][] = [];
    let remaining = [...orderedTasks];

    while (remaining.length > 0) {
      const group: string[] = [];
      const nextRemaining: string[] = [];

      for (const taskId of remaining) {
        const deps = this.adjacencyList.get(taskId) ?? new Set();
        // All deps must be completed before this task can run
        const allDepsCompleted = Array.from(deps).every((d) => completed.has(d));
        if (allDepsCompleted) {
          group.push(taskId);
        } else {
          nextRemaining.push(taskId);
        }
      }

      if (group.length === 0) break;
      groups.push(group);
      for (const id of group) {
        completed.add(id);
      }
      remaining = nextRemaining;
    }

    return groups;
  }

  private getCriticalPathInternal(): string[] {
    // Calculate earliest start and finish times
    const earliestStart: Map<string, number> = new Map();
    const earliestFinish: Map<string, number> = new Map();

    const ordered = this.topologicalSort();

    for (const taskId of ordered) {
      const task = this.tasks.get(taskId);
      // adjacencyList: taskId -> its dependencies (must complete before taskId)
      const deps = this.adjacencyList.get(taskId) ?? new Set();
      const depArray = Array.from(deps).filter((d) => this.tasks.has(d));

      let maxDepFinish = 0;
      for (const dep of depArray) {
        maxDepFinish = Math.max(maxDepFinish, earliestFinish.get(dep) ?? 0);
      }

      const duration = task?.estimatedDuration ?? 0;
      earliestStart.set(taskId, maxDepFinish);
      earliestFinish.set(taskId, maxDepFinish + duration);
    }

    // Backtrack to find critical path
    const latestFinish: Map<string, number> = new Map();
    const maxFinish = Math.max(0, ...Array.from(earliestFinish.values()));

    for (const taskId of [...ordered].reverse()) {
      // reverseAdjacencyList: taskId -> tasks that depend on taskId
      const dependents = this.reverseAdjacencyList.get(taskId) ?? new Set();
      const depArray = Array.from(dependents).filter((d) => this.tasks.has(d));

      if (depArray.length === 0) {
        latestFinish.set(taskId, maxFinish);
      } else {
        const minLatestStart = Math.min(
          ...depArray.map((d) => earliestStart.get(d) ?? Infinity)
        );
        latestFinish.set(taskId, minLatestStart);
      }
    }

    // Tasks on critical path have slack = 0
    const criticalPath: string[] = [];
    for (const taskId of ordered) {
      const es = earliestStart.get(taskId) ?? 0;
      const ls = (latestFinish.get(taskId) ?? 0) - (this.tasks.get(taskId)?.estimatedDuration ?? 0);
      if (Math.abs(es - ls) < 0.001) {
        criticalPath.push(taskId);
      }
    }

    return criticalPath;
  }

  private calculateTotalDuration(criticalPath: string[]): number {
    return criticalPath.reduce((sum, id) => {
      return sum + (this.tasks.get(id)?.estimatedDuration ?? 0);
    }, 0);
  }

  private detectCircularDependencies(): string[][] {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const cycles: string[][] = [];

    const dfs = (node: string, path: string[]): void => {
      visited.add(node);
      recursionStack.add(node);
      path.push(node);

      for (const dep of this.adjacencyList.get(node) ?? []) {
        if (!this.tasks.has(dep)) continue;
        if (!visited.has(dep)) {
          dfs(dep, path);
        } else if (recursionStack.has(dep)) {
          const cycleStart = path.indexOf(dep);
          if (cycleStart !== -1) {
            cycles.push(path.slice(cycleStart).concat(dep));
          }
        }
      }

      path.pop();
      recursionStack.delete(node);
    };

    for (const [id] of this.tasks) {
      if (!visited.has(id)) {
        dfs(id, []);
      }
    }

    return cycles;
  }

  removeTask(taskId: string): boolean {
    if (!this.tasks.has(taskId)) return false;

    // Remove from adjacency lists
    for (const dep of this.adjacencyList.get(taskId) ?? []) {
      this.reverseAdjacencyList.get(dep)?.delete(taskId);
    }
    for (const dep of this.reverseAdjacencyList.get(taskId) ?? []) {
      this.adjacencyList.get(dep)?.delete(taskId);
    }

    this.tasks.delete(taskId);
    this.adjacencyList.delete(taskId);
    this.reverseAdjacencyList.delete(taskId);
    return true;
  }

  getTransitiveDependencies(taskId: string): Set<string> {
    const result = new Set<string>();
    const stack = Array.from(this.adjacencyList.get(taskId) ?? []);

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (!result.has(current)) {
        result.add(current);
        for (const dep of this.adjacencyList.get(current) ?? []) {
          if (!result.has(dep)) {
            stack.push(dep);
          }
        }
      }
    }

    return result;
  }

  getTaskCount(): number {
    return this.tasks.size;
  }
}
