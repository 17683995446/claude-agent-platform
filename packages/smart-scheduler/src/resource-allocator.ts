// src/resource-allocator.ts - 资源分配器

export type ResourceType = 'cpu' | 'memory' | 'disk' | 'network' | 'gpu';

export interface ResourceRequirements {
  cpu?: number;
  memory?: number;
  disk?: number;
  network?: number;
  gpu?: number;
}

export interface ResourceAllocation {
  id: string;
  resources: ResourceRequirements;
  allocatedAt: number;
  taskId?: string;
}

export interface ResourceSnapshot {
  cpu: { total: number; available: number };
  memory: { total: number; available: number };
  disk: { total: number; available: number };
  network: { total: number; available: number };
  gpu: { total: number; available: number };
}

export interface ResourceUtilization {
  cpu: number;
  memory: number;
  disk: number;
  network: number;
  gpu: number;
  overall: number;
}

export type AllocationStrategy = 'fair-share' | 'priority-based' | 'guaranteed-minimum';

interface WaitQueueEntry {
  id: string;
  requirements: ResourceRequirements;
  priority: number;
  enqueuedAt: number;
}

export class ResourceAllocator {
  private totalResources: ResourceRequirements;
  private allocatedResources: ResourceRequirements;
  private allocations: Map<string, ResourceAllocation> = new Map();
  private waitQueue: WaitQueueEntry[] = [];
  private strategy: AllocationStrategy;
  private guaranteedMinimums: Partial<ResourceRequirements>;
  private idCounter: number = 0;

  constructor(options?: {
    totalResources?: ResourceRequirements;
    strategy?: AllocationStrategy;
    guaranteedMinimums?: Partial<ResourceRequirements>;
  }) {
    this.totalResources = {
      cpu: options?.totalResources?.cpu ?? 100,
      memory: options?.totalResources?.memory ?? 1024,
      disk: options?.totalResources?.disk ?? 10000,
      network: options?.totalResources?.network ?? 1000,
      gpu: options?.totalResources?.gpu ?? 10,
    };
    this.allocatedResources = { cpu: 0, memory: 0, disk: 0, network: 0, gpu: 0 };
    this.strategy = options?.strategy ?? 'fair-share';
    this.guaranteedMinimums = options?.guaranteedMinimums ?? {};
  }

  private generateId(): string {
    return `alloc-${++this.idCounter}`;
  }

  private getAvailable(type: ResourceType): number {
    const total = this.totalResources[type] ?? 0;
    const allocated = this.allocatedResources[type] ?? 0;
    return Math.max(0, total - allocated);
  }

  private canSatisfy(requirements: ResourceRequirements): boolean {
    for (const key of Object.keys(requirements) as ResourceType[]) {
      if (requirements[key] !== undefined && requirements[key]! > this.getAvailable(key)) {
        return false;
      }
    }
    return true;
  }

  allocate(requirements: ResourceRequirements, priority: number = 2): ResourceAllocation {
    // Check guaranteed minimums first
    if (this.strategy === 'guaranteed-minimum') {
      for (const key of Object.keys(this.guaranteedMinimums) as ResourceType[]) {
        const min = this.guaranteedMinimums[key] ?? 0;
        const available = this.getAvailable(key);
        const requested = requirements[key] ?? 0;
        if (available - requested < min) {
          // Cannot allocate without violating guaranteed minimum
          return this.enqueueWait(requirements, priority);
        }
      }
    }

    if (this.canSatisfy(requirements)) {
      const id = this.generateId();
      const allocation: ResourceAllocation = {
        id,
        resources: { ...requirements },
        allocatedAt: Date.now(),
      };
      this.allocations.set(id, allocation);
      this.applyAllocation(requirements, 1);
      return allocation;
    }

    // Oversubscription handling: for priority-based, allow oversubscription for high priority
    if (this.strategy === 'priority-based' && priority <= 1) {
      const id = this.generateId();
      const allocation: ResourceAllocation = {
        id,
        resources: { ...requirements },
        allocatedAt: Date.now(),
      };
      this.allocations.set(id, allocation);
      this.applyAllocation(requirements, 1);
      return allocation;
    }

    return this.enqueueWait(requirements, priority);
  }

  private enqueueWait(requirements: ResourceRequirements, priority: number): ResourceAllocation {
    const id = this.generateId();
    const allocation: ResourceAllocation = {
      id,
      resources: { ...requirements },
      allocatedAt: Date.now(),
    };
    this.waitQueue.push({ id, requirements, priority, enqueuedAt: Date.now() });
    this.waitQueue.sort((a, b) => a.priority - b.priority);
    return allocation;
  }

  release(allocationId: string): void {
    const allocation = this.allocations.get(allocationId);
    if (!allocation) return;

    this.applyAllocation(allocation.resources, -1);
    this.allocations.delete(allocationId);

    // Try to satisfy wait queue
    this.processWaitQueue();
  }

  private processWaitQueue(): void {
    const satisfied: string[] = [];
    for (const entry of this.waitQueue) {
      if (this.canSatisfy(entry.requirements)) {
        this.applyAllocation(entry.requirements, 1);
        satisfied.push(entry.id);
      }
    }
    this.waitQueue = this.waitQueue.filter((e) => !satisfied.includes(e.id));
  }

  private applyAllocation(resources: ResourceRequirements, sign: number): void {
    for (const key of Object.keys(resources) as ResourceType[]) {
      if (resources[key] !== undefined) {
        (this.allocatedResources as Record<string, number>)[key] =
          (this.allocatedResources[key] ?? 0) + sign * resources[key]!;
      }
    }
  }

  getAvailableResources(): ResourceSnapshot {
    return {
      cpu: { total: this.totalResources.cpu ?? 0, available: this.getAvailable('cpu') },
      memory: { total: this.totalResources.memory ?? 0, available: this.getAvailable('memory') },
      disk: { total: this.totalResources.disk ?? 0, available: this.getAvailable('disk') },
      network: { total: this.totalResources.network ?? 0, available: this.getAvailable('network') },
      gpu: { total: this.totalResources.gpu ?? 0, available: this.getAvailable('gpu') },
    };
  }

  getUtilization(): ResourceUtilization {
    const types: ResourceType[] = ['cpu', 'memory', 'disk', 'network', 'gpu'];
    let sum = 0;
    const util: Record<string, number> = {};
    for (const t of types) {
      const total = this.totalResources[t] ?? 1;
      const used = total - this.getAvailable(t);
      util[t] = total > 0 ? used / total : 0;
      sum += util[t];
    }
    return {
      cpu: util.cpu,
      memory: util.memory,
      disk: util.disk,
      network: util.network,
      gpu: util.gpu,
      overall: sum / types.length,
    };
  }

  getWaitQueueSize(): number {
    return this.waitQueue.length;
  }

  getAllocationCount(): number {
    return this.allocations.size;
  }
}
