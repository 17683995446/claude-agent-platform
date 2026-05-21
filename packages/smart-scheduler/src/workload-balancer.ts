// src/workload-balancer.ts - 工作负载均衡器

export type BalancingAlgorithm =
  | 'round-robin'
  | 'weighted-round-robin'
  | 'least-connections'
  | 'least-response-time'
  | 'consistent-hash'
  | 'power-of-two-choices';

export interface WorkerInfo {
  id: string;
  address: string;
  weight: number;
  healthy: boolean;
  currentLoad: number;
  activeConnections: number;
  avgResponseTime: number;
  metadata?: Record<string, unknown>;
}

export interface TaskAssignment {
  id: string;
  type: string;
  affinityKey?: string;
  estimatedDuration?: number;
  data?: unknown;
}

export interface WorkerStats {
  workerId: string;
  totalTasksAssigned: number;
  totalTasksCompleted: number;
  avgResponseTime: number;
  successRate: number;
  currentLoad: number;
  activeConnections: number;
  isHealthy: boolean;
}

interface WorkerState {
  info: WorkerInfo;
  totalAssigned: number;
  totalCompleted: number;
  totalFailed: number;
  responseTimes: number[];
  lastHealthCheck: number;
  affinityMap: Map<string, number>;
  roundRobinIndex: number;
}

export class WorkloadBalancer {
  private workers: Map<string, WorkerState> = new Map();
  private algorithm: BalancingAlgorithm;
  private healthCheckInterval: number;
  private taskAffinity: Map<string, string> = new Map(); // affinityKey -> workerId
  private idCounter: number = 0;

  constructor(options?: { algorithm?: BalancingAlgorithm; healthCheckInterval?: number }) {
    this.algorithm = options?.algorithm ?? 'round-robin';
    this.healthCheckInterval = options?.healthCheckInterval ?? 30_000;
  }

  addWorker(worker: WorkerInfo): void {
    this.workers.set(worker.id, {
      info: { ...worker },
      totalAssigned: 0,
      totalCompleted: 0,
      totalFailed: 0,
      responseTimes: [],
      lastHealthCheck: Date.now(),
      affinityMap: new Map(),
      roundRobinIndex: 0,
    });
  }

  removeWorker(workerId: string): void {
    this.workers.delete(workerId);
  }

  assign(task: TaskAssignment): WorkerInfo {
    // Check affinity first
    if (task.affinityKey) {
      const existingWorkerId = this.taskAffinity.get(task.affinityKey);
      if (existingWorkerId && this.workers.has(existingWorkerId)) {
        const state = this.workers.get(existingWorkerId)!;
        if (state.info.healthy) {
          state.totalAssigned++;
          state.info.currentLoad++;
          state.info.activeConnections++;
          return { ...state.info };
        }
      }
    }

    const worker = this.selectWorker(task);
    const state = this.workers.get(worker.id)!;
    state.totalAssigned++;
    state.info.currentLoad++;
    state.info.activeConnections++;

    if (task.affinityKey) {
      this.taskAffinity.set(task.affinityKey, worker.id);
      state.affinityMap.set(task.affinityKey, (state.affinityMap.get(task.affinityKey) ?? 0) + 1);
    }

    return { ...worker };
  }

  private selectWorker(task: TaskAssignment): WorkerInfo {
    const healthyWorkers = Array.from(this.workers.values()).filter((w) => w.info.healthy);
    if (healthyWorkers.length === 0) {
      // Fallback to any worker
      const allWorkers = Array.from(this.workers.values());
      if (allWorkers.length === 0) throw new Error('No workers available');
      return allWorkers[0].info;
    }

    switch (this.algorithm) {
      case 'round-robin':
        return this.roundRobinSelect(healthyWorkers);
      case 'weighted-round-robin':
        return this.weightedRoundRobinSelect(healthyWorkers);
      case 'least-connections':
        return this.leastConnectionsSelect(healthyWorkers);
      case 'least-response-time':
        return this.leastResponseTimeSelect(healthyWorkers);
      case 'consistent-hash':
        return this.consistentHashSelect(healthyWorkers, task.id);
      case 'power-of-two-choices':
        return this.powerOfTwoChoicesSelect(healthyWorkers);
      default:
        return this.roundRobinSelect(healthyWorkers);
    }
  }

  private roundRobinSelect(workers: WorkerState[]): WorkerInfo {
    const idx = this.idCounter++ % workers.length;
    return workers[idx].info;
  }

  private weightedRoundRobinSelect(workers: WorkerState[]): WorkerInfo {
    const totalWeight = workers.reduce((sum, w) => sum + w.info.weight, 0);
    let target = this.idCounter++ % totalWeight;
    for (const worker of workers) {
      target -= worker.info.weight;
      if (target < 0) return worker.info;
    }
    return workers[0].info;
  }

  private leastConnectionsSelect(workers: WorkerState[]): WorkerInfo {
    const sorted = [...workers].sort((a, b) => a.info.activeConnections - b.info.activeConnections);
    return sorted[0].info;
  }

  private leastResponseTimeSelect(workers: WorkerState[]): WorkerInfo {
    const sorted = [...workers].sort((a, b) => a.info.avgResponseTime - b.info.avgResponseTime);
    return sorted[0].info;
  }

  private consistentHashSelect(workers: WorkerState[], taskId: string): WorkerInfo {
    let hash = 0;
    for (let i = 0; i < taskId.length; i++) {
      hash = (hash * 31 + taskId.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(hash) % workers.length;
    return workers[idx].info;
  }

  private powerOfTwoChoicesSelect(workers: WorkerState[]): WorkerInfo {
    if (workers.length <= 2) {
      const sorted = [...workers].sort((a, b) => a.info.currentLoad - b.info.currentLoad);
      return sorted[0].info;
    }
    const i1 = Math.floor(Math.random() * workers.length);
    let i2 = Math.floor(Math.random() * workers.length);
    while (i2 === i1) {
      i2 = Math.floor(Math.random() * workers.length);
    }
    return workers[i1].info.currentLoad <= workers[i2].info.currentLoad
      ? workers[i1].info
      : workers[i2].info;
  }

  reportCompletion(workerId: string, taskId: string, duration: number): void {
    const state = this.workers.get(workerId);
    if (!state) return;

    state.totalCompleted++;
    state.info.currentLoad = Math.max(0, state.info.currentLoad - 1);
    state.info.activeConnections = Math.max(0, state.info.activeConnections - 1);
    state.responseTimes.push(duration);
    if (state.responseTimes.length > 100) {
      state.responseTimes.shift();
    }
    state.info.avgResponseTime =
      state.responseTimes.reduce((a, b) => a + b, 0) / state.responseTimes.length;
  }

  reportFailure(workerId: string, _taskId: string): void {
    const state = this.workers.get(workerId);
    if (!state) return;
    state.totalFailed++;
    state.info.currentLoad = Math.max(0, state.info.currentLoad - 1);
    state.info.activeConnections = Math.max(0, state.info.activeConnections - 1);
  }

  getWorkerStats(workerId: string): WorkerStats {
    const state = this.workers.get(workerId);
    if (!state) throw new Error(`Worker ${workerId} not found`);

    const total = state.totalCompleted + state.totalFailed;
    return {
      workerId: state.info.id,
      totalTasksAssigned: state.totalAssigned,
      totalTasksCompleted: state.totalCompleted,
      avgResponseTime: state.info.avgResponseTime,
      successRate: total > 0 ? state.totalCompleted / total : 1,
      currentLoad: state.info.currentLoad,
      activeConnections: state.info.activeConnections,
      isHealthy: state.info.healthy,
    };
  }

  checkWorkerHealth(): void {
    const now = Date.now();
    for (const state of this.workers.values()) {
      if (now - state.lastHealthCheck > this.healthCheckInterval) {
        state.lastHealthCheck = now;
        // Simple health check: if load is too high, mark unhealthy
        state.info.healthy = state.info.currentLoad < 100;
      }
    }
  }

  setAlgorithm(algorithm: BalancingAlgorithm): void {
    this.algorithm = algorithm;
  }

  getWorkerCount(): number {
    return this.workers.size;
  }

  getHealthyWorkerCount(): number {
    return Array.from(this.workers.values()).filter((w) => w.info.healthy).length;
  }
}
