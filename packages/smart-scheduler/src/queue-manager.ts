// src/queue-manager.ts - 队列管理器

export interface QueueConfig {
  priority?: number;
  weight?: number;
  maxSize?: number;
  retryLimit?: number;
  retryDelay?: number;
}

export interface QueuedTask {
  id: string;
  name: string;
  priority: number;
  data?: unknown;
  enqueuedAt: number;
  retryCount: number;
  queueName?: string;
}

export interface Queue {
  name: string;
  config: Required<QueueConfig>;
  tasks: QueuedTask[];
  deadLetterQueue: QueuedTask[];
  createdAt: number;
}

export interface QueueStatistics {
  name: string;
  depth: number;
  totalEnqueued: number;
  totalDequeued: number;
  totalFailed: number;
  deadLetterCount: number;
  avgWaitTime: number;
  throughput: number; // tasks per minute
}

export interface RebalanceResult {
  tasksMoved: number;
  sourceQueue: string;
  targetQueue: string;
  details: { from: string; to: string; count: number }[];
}

export class QueueManager {
  private queues: Map<string, Queue> = new Map();
  private idCounter: number = 0;

  createQueue(name: string, config?: QueueConfig): Queue {
    const queue: Queue = {
      name,
      config: {
        priority: config?.priority ?? 0,
        weight: config?.weight ?? 1,
        maxSize: config?.maxSize ?? 10000,
        retryLimit: config?.retryLimit ?? 3,
        retryDelay: config?.retryDelay ?? 1000,
      },
      tasks: [],
      deadLetterQueue: [],
      createdAt: Date.now(),
    };

    this.queues.set(name, queue);
    return queue;
  }

  enqueue(queueName: string, task: Partial<QueuedTask> & { name: string }): string {
    const queue = this.queues.get(queueName);
    if (!queue) throw new Error(`Queue "${queueName}" not found`);

    if (queue.tasks.length >= queue.config.maxSize) {
      throw new Error(`Queue "${queueName}" is full`);
    }

    const id = task.id ?? `qtask-${++this.idCounter}`;
    const queuedTask: QueuedTask = {
      id,
      name: task.name,
      priority: task.priority ?? 2,
      data: task.data,
      enqueuedAt: Date.now(),
      retryCount: task.retryCount ?? 0,
      queueName,
    };

    // Insert in priority order
    let inserted = false;
    for (let i = 0; i < queue.tasks.length; i++) {
      if (queuedTask.priority < queue.tasks[i].priority) {
        queue.tasks.splice(i, 0, queuedTask);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      queue.tasks.push(queuedTask);
    }

    return id;
  }

  dequeue(queueName: string): QueuedTask | undefined {
    const queue = this.queues.get(queueName);
    if (!queue || queue.tasks.length === 0) return undefined;

    return queue.tasks.shift();
  }

  dequeueFromAny(): { queueName: string; task: QueuedTask } | undefined {
    // Get highest priority queue with tasks
    const sortedQueues = Array.from(this.queues.values())
      .filter((q) => q.tasks.length > 0)
      .sort((a, b) => {
        // Higher weight queues are preferred
        if (a.config.weight !== b.config.weight) return b.config.weight - a.config.weight;
        return a.config.priority - b.config.priority;
      });

    if (sortedQueues.length === 0) return undefined;

    const queue = sortedQueues[0];
    const task = queue.tasks.shift()!;
    return { queueName: queue.name, task };
  }

  getQueueStats(queueName: string): QueueStatistics {
    const queue = this.queues.get(queueName);
    if (!queue) throw new Error(`Queue "${queueName}" not found`);

    const now = Date.now();
    const avgWaitTime = queue.tasks.length > 0
      ? queue.tasks.reduce((sum, t) => sum + (now - t.enqueuedAt), 0) / queue.tasks.length
      : 0;

    const elapsed = (now - queue.createdAt) / 60_000; // minutes
    const throughput = elapsed > 0 ? queue.tasks.length / elapsed : 0;

    return {
      name: queue.name,
      depth: queue.tasks.length,
      totalEnqueued: queue.tasks.length + queue.deadLetterQueue.length,
      totalDequeued: 0,
      totalFailed: queue.deadLetterQueue.length,
      deadLetterCount: queue.deadLetterQueue.length,
      avgWaitTime,
      throughput,
    };
  }

  moveToDeadLetter(queueName: string, taskId: string): boolean {
    const queue = this.queues.get(queueName);
    if (!queue) return false;

    const idx = queue.tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) return false;

    const task = queue.tasks.splice(idx, 1)[0];
    queue.deadLetterQueue.push(task);
    return true;
  }

  retryTask(queueName: string, taskId: string): boolean {
    const queue = this.queues.get(queueName);
    if (!queue) return false;

    const dlIdx = queue.deadLetterQueue.findIndex((t) => t.id === taskId);
    if (dlIdx === -1) return false;

    const task = queue.deadLetterQueue.splice(dlIdx, 1)[0];
    task.retryCount++;
    task.enqueuedAt = Date.now();

    if (task.retryCount <= queue.config.retryLimit) {
      queue.tasks.push(task);
      return true;
    }

    // Exceeded retry limit, put back in DLQ
    queue.deadLetterQueue.push(task);
    return false;
  }

  rebalance(): RebalanceResult {
    const details: { from: string; to: string; count: number }[] = [];
    let totalMoved = 0;

    const sortedQueues = Array.from(this.queues.values()).sort(
      (a, b) => a.tasks.length - b.tasks.length
    );

    if (sortedQueues.length < 2) {
      return { tasksMoved: 0, sourceQueue: '', targetQueue: '', details: [] };
    }

    // Move tasks from most loaded to least loaded
    const source = sortedQueues[sortedQueues.length - 1];
    const target = sortedQueues[0];

    if (source.tasks.length > target.tasks.length + 1) {
      const moveCount = Math.floor((source.tasks.length - target.tasks.length) / 2);
      const tasks = source.tasks.splice(0, moveCount);
      target.tasks.push(...tasks);
      details.push({ from: source.name, to: target.name, count: moveCount });
      totalMoved += moveCount;
    }

    return {
      tasksMoved: totalMoved,
      sourceQueue: source.name,
      targetQueue: target.name,
      details,
    };
  }

  deleteQueue(name: string): boolean {
    return this.queues.delete(name);
  }

  getQueueCount(): number {
    return this.queues.size;
  }

  getTotalDepth(): number {
    let total = 0;
    for (const queue of this.queues.values()) {
      total += queue.tasks.length;
    }
    return total;
  }

  getQueueNames(): string[] {
    return Array.from(this.queues.keys());
  }
}
