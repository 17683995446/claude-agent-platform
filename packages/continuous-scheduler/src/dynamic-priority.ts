// ============================================================
// Module 1: Dynamic Priority Scheduler
// ============================================================

export interface ContinuousTask {
  id: string;
  name: string;
  priority: number;
  deadline?: number;
  businessValue?: number;
  dependencies?: string[];
  resourceRequirements?: ResourceRequirements;
  createdAt: number;
  payload?: unknown;
}

export interface ResourceRequirements {
  cpu?: number;
  memory?: number;
  gpu?: number;
}

export type PriorityFactor =
  | 'deadline'
  | 'waitTime'
  | 'businessValue'
  | 'dependencies'
  | 'resourceRequirements';

export interface TaskSnapshot {
  id: string;
  name: string;
  currentPriority: number;
  basePriority: number;
  waitTime: number;
  deadlineProximity: number;
  boosted: boolean;
  ageBoost: number;
}

export interface RebalanceResult {
  totalTasks: number;
  adjustedCount: number;
  averagePriority: number;
  starvationPreventions: number;
  changes: PriorityChange[];
}

export interface PriorityChange {
  taskId: string;
  oldPriority: number;
  newPriority: number;
  reason: string;
}

export interface DynamicPriorityOptions {
  agingRate?: number;           // Priority increase per minute of waiting
  agingMaxBoost?: number;       // Maximum boost from aging
  deadlineWeight?: number;      // Weight for deadline proximity (0-1)
  businessValueWeight?: number; // Weight for business value (0-1)
  starvationThreshold?: number; // Min priority for starvation prevention
  boostDuration?: number;       // How long a boost lasts (ms)
  maxQueueSize?: number;        // Maximum queue size
}

const DEFAULT_OPTIONS: Required<DynamicPriorityOptions> = {
  agingRate: 0.5,
  agingMaxBoost: 20,
  deadlineWeight: 0.3,
  businessValueWeight: 0.2,
  starvationThreshold: 10,
  boostDuration: 5 * 60 * 1000, // 5 minutes
  maxQueueSize: 10000,
};

export class DynamicPriorityScheduler {
  private queue: Map<string, InternalTask> = new Map();
  private options: Required<DynamicPriorityOptions>;
  private boostMap: Map<string, number> = new Map(); // taskId -> boost expiry
  private starvationMap: Map<string, number> = new Map(); // taskId -> last execution time

  constructor(options?: DynamicPriorityOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  schedule(task: ContinuousTask): string {
    if (this.queue.size >= this.options.maxQueueSize) {
      throw new Error('Queue is full');
    }
    const internal: InternalTask = {
      ...task,
      basePriority: task.priority,
      currentPriority: task.priority,
      scheduledAt: Date.now(),
      lastAdjustedAt: Date.now(),
    };
    this.queue.set(task.id, internal);
    return task.id;
  }

  adjustPriority(taskId: string, factor: PriorityFactor): void {
    const task = this.queue.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const now = Date.now();
    switch (factor) {
      case 'deadline': {
        if (task.deadline) {
          const timeUntilDeadline = task.deadline - now;
          const maxDeadlineWindow = 24 * 60 * 60 * 1000; // 24 hours
          if (timeUntilDeadline > 0) {
            const proximity = 1 - Math.min(timeUntilDeadline / maxDeadlineWindow, 1);
            task.currentPriority += proximity * 30 * this.options.deadlineWeight;
          } else {
            task.currentPriority += 50 * this.options.deadlineWeight;
          }
        }
        break;
      }
      case 'waitTime': {
        const waitTime = now - task.scheduledAt;
        const minutesWaiting = waitTime / (60 * 1000);
        const agingBoost = Math.min(
          minutesWaiting * this.options.agingRate,
          this.options.agingMaxBoost
        );
        task.currentPriority = task.basePriority + agingBoost;
        break;
      }
      case 'businessValue': {
        if (task.businessValue) {
          task.currentPriority += task.businessValue * this.options.businessValueWeight;
        }
        break;
      }
      case 'dependencies': {
        if (task.dependencies && task.dependencies.length > 0) {
          const resolvedCount = task.dependencies.filter(
            (dep) => !this.queue.has(dep)
          ).length;
          const resolutionRatio = resolvedCount / task.dependencies.length;
          task.currentPriority += resolutionRatio * 15;
        }
        break;
      }
      case 'resourceRequirements': {
        if (task.resourceRequirements) {
          const totalResources =
            (task.resourceRequirements.cpu ?? 0) +
            (task.resourceRequirements.memory ?? 0) +
            (task.resourceRequirements.gpu ?? 0);
          // Lower resource requirements get slight priority boost
          task.currentPriority += Math.max(0, 10 - totalResources);
        }
        break;
      }
    }

    task.lastAdjustedAt = now;
  }

  boostPriority(taskId: string, amount?: number): void {
    if (!this.queue.has(taskId)) {
      throw new Error(`Task ${taskId} not found`);
    }
    const boostAmount = amount ?? 100;
    const task = this.queue.get(taskId)!;
    task.currentPriority += boostAmount;
    this.boostMap.set(taskId, Date.now() + this.options.boostDuration);
  }

  getNextTask(): ContinuousTask | undefined {
    this.preventStarvation();

    let highestPriority = -Infinity;
    let nextTask: InternalTask | undefined;

    for (const task of this.queue.values()) {
      const effectivePriority = this.getEffectivePriority(task);
      if (effectivePriority > highestPriority) {
        highestPriority = effectivePriority;
        nextTask = task;
      }
    }

    if (nextTask) {
      this.queue.delete(nextTask.id);
      this.boostMap.delete(nextTask.id);
      this.starvationMap.set(nextTask.id, Date.now());
      const { scheduledAt, lastAdjustedAt, basePriority, currentPriority, ...rest } = nextTask;
      return { ...rest, priority: currentPriority };
    }

    return undefined;
  }

  getQueueSnapshot(): TaskSnapshot[] {
    const now = Date.now();
    const snapshots: TaskSnapshot[] = [];

    for (const task of this.queue.values()) {
      const waitTime = now - task.scheduledAt;
      let deadlineProximity = 0;
      if (task.deadline) {
        const timeUntilDeadline = task.deadline - now;
        deadlineProximity = timeUntilDeadline > 0
          ? 1 - Math.min(timeUntilDeadline / (24 * 60 * 60 * 1000), 1)
          : 1;
      }

      const isBoosted = this.boostMap.has(task.id) && (this.boostMap.get(task.id) ?? 0) > now;
      const ageBoost = Math.min(
        (waitTime / (60 * 1000)) * this.options.agingRate,
        this.options.agingMaxBoost
      );

      snapshots.push({
        id: task.id,
        name: task.name,
        currentPriority: this.getEffectivePriority(task),
        basePriority: task.basePriority,
        waitTime,
        deadlineProximity,
        boosted: isBoosted,
        ageBoost,
      });
    }

    return snapshots.sort((a, b) => b.currentPriority - a.currentPriority);
  }

  rebalance(): RebalanceResult {
    const changes: PriorityChange[] = [];
    let starvationPreventions = 0;
    const now = Date.now();

    for (const task of this.queue.values()) {
      const oldPriority = task.currentPriority;

      // Apply aging
      const waitTime = now - task.scheduledAt;
      const minutesWaiting = waitTime / (60 * 1000);
      const agingBoost = Math.min(
        minutesWaiting * this.options.agingRate,
        this.options.agingMaxBoost
      );

      // Apply deadline factor
      let deadlineBoost = 0;
      if (task.deadline) {
        const timeUntilDeadline = task.deadline - now;
        if (timeUntilDeadline > 0) {
          const proximity = 1 - Math.min(timeUntilDeadline / (24 * 60 * 60 * 1000), 1);
          deadlineBoost = proximity * 30 * this.options.deadlineWeight;
        } else {
          deadlineBoost = 50 * this.options.deadlineWeight;
        }
      }

      // Apply business value factor
      let bvBoost = 0;
      if (task.businessValue) {
        bvBoost = task.businessValue * this.options.businessValueWeight;
      }

      // Apply boost
      let boostValue = 0;
      if (this.boostMap.has(task.id)) {
        const expiry = this.boostMap.get(task.id)!;
        if (expiry > now) {
          boostValue = 25;
        } else {
          this.boostMap.delete(task.id);
        }
      }

      // Starvation prevention
      const lastExec = this.starvationMap.get(task.id);
      if (lastExec) {
        const timeSinceLastExec = now - lastExec;
        if (timeSinceLastExec > 10 * 60 * 1000 && task.currentPriority < this.options.starvationThreshold) {
          task.currentPriority = this.options.starvationThreshold;
          starvationPreventions++;
        }
      }

      task.currentPriority = task.basePriority + agingBoost + deadlineBoost + bvBoost + boostValue;
      task.lastAdjustedAt = now;

      if (Math.abs(task.currentPriority - oldPriority) > 0.01) {
        changes.push({
          taskId: task.id,
          oldPriority,
          newPriority: task.currentPriority,
          reason: 'rebalance',
        });
      }
    }

    const priorities = Array.from(this.queue.values()).map((t) => t.currentPriority);
    const averagePriority = priorities.length > 0
      ? priorities.reduce((a, b) => a + b, 0) / priorities.length
      : 0;

    return {
      totalTasks: this.queue.size,
      adjustedCount: changes.length,
      averagePriority,
      starvationPreventions,
      changes,
    };
  }

  removeTask(taskId: string): boolean {
    this.boostMap.delete(taskId);
    return this.queue.delete(taskId);
  }

  getQueueSize(): number {
    return this.queue.size;
  }

  private getEffectivePriority(task: InternalTask): number {
    const now = Date.now();
    let priority = task.currentPriority;

    // Apply boost
    if (this.boostMap.has(task.id)) {
      const expiry = this.boostMap.get(task.id)!;
      if (expiry > now) {
        priority += 25;
      }
    }

    return priority;
  }

  private preventStarvation(): void {
    const now = Date.now();
    for (const task of this.queue.values()) {
      const lastExec = this.starvationMap.get(task.id);
      if (lastExec) {
        const timeSinceLastExec = now - lastExec;
        if (timeSinceLastExec > 10 * 60 * 1000 && task.currentPriority < this.options.starvationThreshold) {
          task.currentPriority = this.options.starvationThreshold;
        }
      } else {
        // Task has never been executed - check wait time from scheduling
        const waitTime = now - task.scheduledAt;
        if (waitTime > 10 * 60 * 1000 && task.currentPriority < this.options.starvationThreshold) {
          task.currentPriority = this.options.starvationThreshold;
        }
      }
    }
  }
}

interface InternalTask extends ContinuousTask {
  basePriority: number;
  currentPriority: number;
  scheduledAt: number;
  lastAdjustedAt: number;
}
