// chaos-engine.ts - 混沌工程工具

export type FaultType = 'latency' | 'error' | 'timeout' | 'resource_exhaustion' | 'network_partition';

export interface FaultConfig {
  id: string;
  type: FaultType;
  probability: number; // 0-1
  duration?: number; // ms, undefined = permanent until removed
  latencyMs?: number;
  errorFn?: () => Error;
  targetOperation?: string; // if set, only affects matching operations
  schedule?: {
    startTime: number;
    endTime?: number;
  };
  maxConcurrent?: number;
}

export interface ActiveFault extends FaultConfig {
  injectedAt: number;
  triggerCount: number;
}

export interface ChaosEngineConfig {
  maxConcurrentFaults: number;
  autoRecoveryTimeout: number;
  enabled: boolean;
}

export class ChaosEngine {
  private activeFaults = new Map<string, ActiveFault>();
  private readonly config: ChaosEngineConfig;
  private scheduleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(config?: Partial<ChaosEngineConfig>) {
    this.config = {
      maxConcurrentFaults: 10,
      autoRecoveryTimeout: 60000,
      enabled: true,
      ...config,
    };
  }

  injectFault(fault: FaultConfig): void {
    if (!this.config.enabled) return;
    if (this.activeFaults.size >= this.config.maxConcurrentFaults) {
      throw new Error(`Maximum concurrent faults (${this.config.maxConcurrentFaults}) reached`);
    }

    const activeFault: ActiveFault = {
      ...fault,
      injectedAt: Date.now(),
      triggerCount: 0,
    };

    this.activeFaults.set(fault.id, activeFault);

    // Auto-recovery
    if (fault.duration && fault.duration > 0) {
      const timer = setTimeout(() => {
        this.removeFault(fault.id);
      }, fault.duration);
      this.scheduleTimers.set(fault.id, timer);
    }

    // Scheduled faults
    if (fault.schedule?.startTime) {
      const delay = fault.schedule.startTime - Date.now();
      if (delay > 0) {
        const timer = setTimeout(() => {
          try {
            // Re-inject if it was removed
            if (!this.activeFaults.has(fault.id)) {
              this.injectFault(fault);
            }
          } catch {
            // Ignore re-injection errors (e.g., max concurrent faults reached)
          }
        }, delay);
        this.scheduleTimers.set(`schedule_${fault.id}`, timer);
      }
    }
  }

  removeFault(faultId: string): void {
    this.activeFaults.delete(faultId);
    const timer = this.scheduleTimers.get(faultId);
    if (timer) {
      clearTimeout(timer);
      this.scheduleTimers.delete(faultId);
    }
    const scheduleTimer = this.scheduleTimers.get(`schedule_${faultId}`);
    if (scheduleTimer) {
      clearTimeout(scheduleTimer);
      this.scheduleTimers.delete(`schedule_${faultId}`);
    }
  }

  getActiveFaults(): ActiveFault[] {
    return Array.from(this.activeFaults.values());
  }

  async execute<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    if (!this.config.enabled) return fn();

    const faults = this.getApplicableFaults(operation);

    for (const fault of faults) {
      if (Math.random() < fault.probability) {
        fault.triggerCount++;
        await this.applyFault(fault);
      }
    }

    return fn();
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  enable(): void {
    this.config.enabled = true;
  }

  disable(): void {
    this.config.enabled = false;
  }

  clearAll(): void {
    this.activeFaults.clear();
    this.scheduleTimers.forEach(timer => clearTimeout(timer));
    this.scheduleTimers.clear();
  }

  getFaultStats(): Record<string, { triggerCount: number; activeMs: number }> {
    const stats: Record<string, { triggerCount: number; activeMs: number }> = {};
    const now = Date.now();
    for (const [id, fault] of this.activeFaults) {
      stats[id] = {
        triggerCount: fault.triggerCount,
        activeMs: now - fault.injectedAt,
      };
    }
    return stats;
  }

  private getApplicableFaults(operation: string): ActiveFault[] {
    return Array.from(this.activeFaults.values()).filter(
      fault => !fault.targetOperation || fault.targetOperation === operation,
    );
  }

  private async applyFault(fault: ActiveFault): Promise<void> {
    switch (fault.type) {
      case 'latency':
        if (fault.latencyMs) {
          await new Promise(resolve => setTimeout(resolve, fault.latencyMs));
        }
        break;
      case 'error':
        throw fault.errorFn?.() ?? new Error('Chaos: injected error');
      case 'timeout':
        await new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Chaos: injected timeout')), 5000),
        );
        break;
      case 'resource_exhaustion':
        throw new Error('Chaos: resource exhaustion');
      case 'network_partition':
        throw new Error('Chaos: network partition');
    }
  }
}
