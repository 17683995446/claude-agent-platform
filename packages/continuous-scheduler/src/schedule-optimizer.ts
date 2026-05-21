// ============================================================
// Module 8: Schedule Optimizer
// ============================================================

import type { ContinuousTask } from './dynamic-priority.ts';

export type OptimizationStrategy = 'greedy' | 'round-robin' | 'priority-based' | 'cost-based';

export interface ScheduleConstraints {
  maxConcurrency?: number;
  maxMemory?: number;
  maxCPU?: number;
  deadline?: number;
  dependencies?: Map<string, string[]>;
  priorityConstraints?: Map<string, number[]>;
}

export interface OptimizedSchedule {
  order: string[];
  estimatedCompletionTime: number;
  totalCost: number;
  resourceUtilization: number;
  strategy: OptimizationStrategy;
  parallelGroups: string[][];
}

export interface SimulationResult {
  completedOnTime: number;
  missedDeadlines: number;
  averageWaitTime: number;
  averageExecutionTime: number;
  resourceUtilization: number;
  totalExecutionTime: number;
  bottlenecks: Bottleneck[];
}

export interface Bottleneck {
  taskId: string;
  type: 'resource' | 'dependency' | 'deadline';
  severity: number; // 0-1
  description: string;
}

export interface ScheduleOptimizerOptions {
  defaultStrategy?: OptimizationStrategy;
  averageTaskDuration?: number; // ms
  resourceCapacity?: number;
}

const DEFAULT_OPTIMIZER_OPTIONS: Required<ScheduleOptimizerOptions> = {
  defaultStrategy: 'priority-based',
  averageTaskDuration: 1000,
  resourceCapacity: 100,
};

export class ScheduleOptimizer {
  private options: Required<ScheduleOptimizerOptions>;

  constructor(options?: ScheduleOptimizerOptions) {
    this.options = { ...DEFAULT_OPTIMIZER_OPTIONS, ...options };
  }

  optimize(
    tasks: ContinuousTask[],
    constraints: ScheduleConstraints
  ): OptimizedSchedule {
    const strategy = this.options.defaultStrategy;
    const resolvedTasks = this.resolveDependencies(tasks, constraints);

    let order: string[];
    switch (strategy) {
      case 'greedy':
        order = this.greedyOrder(resolvedTasks, constraints);
        break;
      case 'round-robin':
        order = this.roundRobinOrder(resolvedTasks);
        break;
      case 'priority-based':
        order = this.priorityBasedOrder(resolvedTasks, constraints);
        break;
      case 'cost-based':
        order = this.costBasedOrder(resolvedTasks, constraints);
        break;
      default:
        order = this.priorityBasedOrder(resolvedTasks, constraints);
    }

    // Create parallel groups based on dependencies
    const parallelGroups = this.createParallelGroups(order, constraints);

    // Estimate completion time
    const maxConcurrency = constraints.maxConcurrency ?? 4;
    const estimatedCompletionTime = this.estimateTotalTime(order.length, maxConcurrency);

    // Calculate cost (lower is better)
    const totalCost = this.calculateCost(order, tasks, constraints);

    // Resource utilization
    const resourceUtilization = this.calculateUtilization(order.length, maxConcurrency);

    return {
      order,
      estimatedCompletionTime,
      totalCost,
      resourceUtilization,
      strategy,
      parallelGroups,
    };
  }

  simulate(schedule: OptimizedSchedule): SimulationResult {
    const taskCount = schedule.order.length;
    const maxConcurrency = 4;
    const avgDuration = this.options.averageTaskDuration;

    // Simulate execution
    const totalExecutionTime = Math.ceil(
      (taskCount * avgDuration) / maxConcurrency
    );

    // Estimate on-time completion
    const completedOnTime = Math.floor(taskCount * 0.85);
    const missedDeadlines = taskCount - completedOnTime;

    // Average wait time
    const averageWaitTime = avgDuration * (maxConcurrency / 2);

    return {
      completedOnTime,
      missedDeadlines,
      averageWaitTime,
      averageExecutionTime: avgDuration,
      resourceUtilization: schedule.resourceUtilization,
      totalExecutionTime,
      bottlenecks: this.identifyBottlenecksFromSchedule(schedule),
    };
  }

  getOptimalOrder(tasks: ContinuousTask[]): string[] {
    return this.priorityBasedOrder(tasks, {});
  }

  estimateCompletion(tasks: ContinuousTask[]): Date {
    const maxConcurrency = 4;
    const totalTime = this.estimateTotalTime(tasks.length, maxConcurrency);
    return new Date(Date.now() + totalTime);
  }

  identifyBottlenecks(tasks: ContinuousTask[]): Bottleneck[] {
    const bottlenecks: Bottleneck[] = [];

    // Check for resource bottlenecks
    const highResourceTasks = tasks.filter(
      (t) =>
        (t.resourceRequirements?.cpu ?? 0) > 50 ||
        (t.resourceRequirements?.memory ?? 0) > 50
    );
    for (const task of highResourceTasks) {
      bottlenecks.push({
        taskId: task.id,
        type: 'resource',
        severity: 0.7,
        description: `Task ${task.name} has high resource requirements`,
      });
    }

    // Check for dependency bottlenecks
    for (const task of tasks) {
      if (task.dependencies && task.dependencies.length > 3) {
        bottlenecks.push({
          taskId: task.id,
          type: 'dependency',
          severity: 0.6,
          description: `Task ${task.name} has ${task.dependencies.length} dependencies`,
        });
      }
    }

    // Check for deadline bottlenecks
    const now = Date.now();
    for (const task of tasks) {
      if (task.deadline) {
        const timeUntilDeadline = task.deadline - now;
        if (timeUntilDeadline < this.options.averageTaskDuration * 2) {
          bottlenecks.push({
            taskId: task.id,
            type: 'deadline',
            severity: 0.8,
            description: `Task ${task.name} has tight deadline`,
          });
        }
      }
    }

    return bottlenecks.sort((a, b) => b.severity - a.severity);
  }

  setStrategy(strategy: OptimizationStrategy): void {
    this.options.defaultStrategy = strategy;
  }

  private resolveDependencies(
    tasks: ContinuousTask[],
    constraints: ScheduleConstraints
  ): ContinuousTask[] {
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const visited = new Set<string>();
    const tempMarked = new Set<string>(); // For cycle detection
    const result: ContinuousTask[] = [];

    const visit = (taskId: string, path: string[] = []): boolean => {
      if (tempMarked.has(taskId)) {
        // Cycle detected - skip this dependency
        console.warn(`Circular dependency detected: ${[...path, taskId].join(' -> ')}`);
        return false;
      }
      if (visited.has(taskId)) return true;

      const task = taskMap.get(taskId);
      if (!task) return true; // External dependency, treat as resolved

      tempMarked.add(taskId);

      if (task.dependencies) {
        for (const dep of task.dependencies) {
          if (!visit(dep, [...path, taskId])) {
            // Cycle in dependency, remove it
            task.dependencies = task.dependencies.filter(d => d !== dep);
          }
        }
      }

      tempMarked.delete(taskId);
      visited.add(taskId);
      result.push(task);
      return true;
    };

    for (const task of tasks) {
      visit(task.id);
    }

    return result;
  }

  private greedyOrder(
    tasks: ContinuousTask[],
    constraints: ScheduleConstraints
  ): string[] {
    // Greedy: pick the task with the earliest deadline first
    return [...tasks]
      .sort((a, b) => {
        const aDeadline = a.deadline ?? Infinity;
        const bDeadline = b.deadline ?? Infinity;
        return aDeadline - bDeadline;
      })
      .map((t) => t.id);
  }

  private roundRobinOrder(tasks: ContinuousTask[]): string[] {
    // Simple round-robin: maintain insertion order
    return tasks.map((t) => t.id);
  }

  private priorityBasedOrder(
    tasks: ContinuousTask[],
    constraints: ScheduleConstraints
  ): string[] {
    // Build dependency graph
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();

    for (const task of tasks) {
      inDegree.set(task.id, 0);
      dependents.set(task.id, []);
    }
    for (const task of tasks) {
      if (task.dependencies) {
        for (const dep of task.dependencies) {
          if (taskMap.has(dep)) {
            inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
            dependents.get(dep)!.push(task.id);
          }
        }
      }
    }

    // Kahn's algorithm with priority-based selection within each level
    const order: string[] = [];
    const available = tasks
      .filter((t) => (inDegree.get(t.id) ?? 0) === 0)
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        const aDeadline = a.deadline ?? Infinity;
        const bDeadline = b.deadline ?? Infinity;
        return aDeadline - bDeadline;
      });

    const queue = available.map((t) => t.id);

    while (queue.length > 0) {
      // Pick highest priority from available
      queue.sort((a, b) => {
        const taskA = taskMap.get(a)!;
        const taskB = taskMap.get(b)!;
        if (taskB.priority !== taskA.priority) return taskB.priority - taskA.priority;
        const aDeadline = taskA.deadline ?? Infinity;
        const bDeadline = taskB.deadline ?? Infinity;
        return aDeadline - bDeadline;
      });

      const current = queue.shift()!;
      order.push(current);

      for (const depId of dependents.get(current) ?? []) {
        const newDegree = (inDegree.get(depId) ?? 1) - 1;
        inDegree.set(depId, newDegree);
        if (newDegree === 0) {
          queue.push(depId);
        }
      }
    }

    return order;
  }

  private costBasedOrder(
    tasks: ContinuousTask[],
    constraints: ScheduleConstraints
  ): string[] {
    return [...tasks]
      .sort((a, b) => {
        // Lower cost (resource usage) first, then higher priority
        const aCost = (a.resourceRequirements?.cpu ?? 0) + (a.resourceRequirements?.memory ?? 0);
        const bCost = (b.resourceRequirements?.cpu ?? 0) + (b.resourceRequirements?.memory ?? 0);
        if (aCost !== bCost) return aCost - bCost;
        return b.priority - a.priority;
      })
      .map((t) => t.id);
  }

  private createParallelGroups(
    order: string[],
    constraints: ScheduleConstraints
  ): string[][] {
    const maxConcurrency = constraints.maxConcurrency ?? 4;
    const groups: string[][] = [];

    for (let i = 0; i < order.length; i += maxConcurrency) {
      groups.push(order.slice(i, i + maxConcurrency));
    }

    return groups;
  }

  private estimateTotalTime(taskCount: number, maxConcurrency: number): number {
    return Math.ceil((taskCount * this.options.averageTaskDuration) / maxConcurrency);
  }

  private calculateCost(
    order: string[],
    tasks: ContinuousTask[],
    constraints: ScheduleConstraints
  ): number {
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    let cost = 0;

    for (const taskId of order) {
      const task = taskMap.get(taskId);
      if (task) {
        cost += (task.resourceRequirements?.cpu ?? 1) * 10;
        cost += (task.resourceRequirements?.memory ?? 1) * 5;
        // Penalty for low priority tasks scheduled early
        cost += (100 - task.priority) * 0.1;
      }
    }

    return cost;
  }

  private calculateUtilization(taskCount: number, maxConcurrency: number): number {
    if (taskCount === 0) return 0;
    const lastGroupSize = taskCount % maxConcurrency || maxConcurrency;
    const fullGroups = Math.floor(taskCount / maxConcurrency);
    const totalSlots = fullGroups * maxConcurrency + lastGroupSize;
    return taskCount / totalSlots;
  }

  private identifyBottlenecksFromSchedule(schedule: OptimizedSchedule): Bottleneck[] {
    const bottlenecks: Bottleneck[] = [];

    if (schedule.parallelGroups.length > 10) {
      bottlenecks.push({
        taskId: 'schedule',
        type: 'resource',
        severity: 0.5,
        description: 'Schedule has many sequential groups',
      });
    }

    if (schedule.resourceUtilization < 0.5) {
      bottlenecks.push({
        taskId: 'schedule',
        type: 'resource',
        severity: 0.3,
        description: 'Low resource utilization',
      });
    }

    return bottlenecks;
  }
}
