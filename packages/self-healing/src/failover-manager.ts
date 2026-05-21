// src/failover-manager.ts - Failover Manager Module

export interface ComponentHandler {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  healthCheck: () => Promise<boolean>;
  handleRequest?: (request: unknown) => Promise<unknown>;
}

export type FailoverMode = 'active-passive' | 'active-active';

export interface FailoverStatus {
  componentId: string;
  mode: FailoverMode;
  activeInstance: string;
  isFailedOver: boolean;
  lastFailover: number | null;
  healthStatus: Record<string, boolean>;
}

export interface FailoverResult {
  success: boolean;
  componentId: string;
  fromInstance: string;
  toInstance: string;
  duration: number;
  message: string;
}

export interface FailoverRecord {
  componentId: string;
  mode: FailoverMode;
  fromInstance: string;
  toInstance: string;
  timestamp: number;
  success: boolean;
  reason: string;
}

interface ComponentEntry {
  id: string;
  mode: FailoverMode;
  primary: ComponentHandler;
  standby: ComponentHandler | null;
  instances: Map<string, ComponentHandler>;
  activeInstance: string;
  isFailedOver: boolean;
  lastFailover: number | null;
  healthCheckInterval: ReturnType<typeof setInterval> | null;
  failbackEnabled: boolean;
}

export class FailoverManager {
  private components = new Map<string, ComponentEntry>();
  private failoverHistory: FailoverRecord[] = [];
  private healthCheckIntervals = new Map<string, ReturnType<typeof setInterval>>();

  registerPrimary(componentId: string, handler: ComponentHandler): void {
    const existing = this.components.get(componentId);
    if (existing) {
      existing.primary = handler;
      existing.activeInstance = 'primary';
    } else {
      this.components.set(componentId, {
        id: componentId,
        mode: 'active-passive',
        primary: handler,
        standby: null,
        instances: new Map([['primary', handler]]),
        activeInstance: 'primary',
        isFailedOver: false,
        lastFailover: null,
        healthCheckInterval: null,
        failbackEnabled: true,
      });
    }
  }

  registerStandby(componentId: string, handler: ComponentHandler): void {
    const entry = this.components.get(componentId);
    if (!entry) {
      throw new Error(`No primary registered for component ${componentId}`);
    }
    entry.standby = handler;
    entry.instances.set('standby', handler);
  }

  setActiveActive(componentId: string): void {
    const entry = this.components.get(componentId);
    if (!entry) {
      throw new Error(`Component ${componentId} not registered`);
    }
    entry.mode = 'active-active';
  }

  async triggerFailover(componentId: string): Promise<FailoverResult> {
    const entry = this.components.get(componentId);
    if (!entry) {
      return {
        success: false,
        componentId,
        fromInstance: 'unknown',
        toInstance: 'unknown',
        duration: 0,
        message: `Component ${componentId} not found`,
      };
    }

    const startTime = Date.now();
    const fromInstance = entry.activeInstance;

    if (entry.mode === 'active-passive') {
      if (!entry.standby) {
        return {
          success: false,
          componentId,
          fromInstance,
          toInstance: 'standby',
          duration: 0,
          message: 'No standby available',
        };
      }

      try {
        await entry.primary.stop();
        await entry.standby.start();
        entry.activeInstance = 'standby';
        entry.isFailedOver = true;
        entry.lastFailover = Date.now();

        const record: FailoverRecord = {
          componentId,
          mode: entry.mode,
          fromInstance,
          toInstance: 'standby',
          timestamp: Date.now(),
          success: true,
          reason: 'manual_failover',
        };
        this.failoverHistory.push(record);

        return {
          success: true,
          componentId,
          fromInstance,
          toInstance: 'standby',
          duration: Date.now() - startTime,
          message: `Successfully failed over from ${fromInstance} to standby`,
        };
      } catch (error) {
        return {
          success: false,
          componentId,
          fromInstance,
          toInstance: 'standby',
          duration: Date.now() - startTime,
          message: `Failover failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    } else {
      // Active-active: find healthiest instance
      const healthyInstances: string[] = [];
      for (const [name, handler] of entry.instances) {
        try {
          const healthy = await handler.healthCheck();
          if (healthy && name !== fromInstance) {
            healthyInstances.push(name);
          }
        } catch {
          // Skip unhealthy
        }
      }

      if (healthyInstances.length === 0) {
        return {
          success: false,
          componentId,
          fromInstance,
          toInstance: 'none',
          duration: Date.now() - startTime,
          message: 'No healthy instances available for failover',
        };
      }

      const toInstance = healthyInstances[0]!;
      entry.activeInstance = toInstance;
      entry.isFailedOver = true;
      entry.lastFailover = Date.now();

      this.failoverHistory.push({
        componentId,
        mode: entry.mode,
        fromInstance,
        toInstance,
        timestamp: Date.now(),
        success: true,
        reason: 'health_based_routing',
      });

      return {
        success: true,
        componentId,
        fromInstance,
        toInstance,
        duration: Date.now() - startTime,
        message: `Traffic rerouted from ${fromInstance} to ${toInstance}`,
      };
    }
  }

  async triggerFailback(componentId: string): Promise<void> {
    const entry = this.components.get(componentId);
    if (!entry || !entry.isFailedOver) return;

    try {
      const isHealthy = await entry.primary.healthCheck();
      if (!isHealthy) return;

      const previousInstance = entry.activeInstance;

      if (entry.standby) {
        await entry.standby.stop();
      }
      await entry.primary.start();
      entry.activeInstance = 'primary';
      entry.isFailedOver = false;

      this.failoverHistory.push({
        componentId,
        mode: entry.mode,
        fromInstance: previousInstance,
        toInstance: 'primary',
        timestamp: Date.now(),
        success: true,
        reason: 'failback',
      });
    } catch {
      // Failback failed, stay on standby
    }
  }

  getFailoverStatus(componentId: string): FailoverStatus | null {
    const entry = this.components.get(componentId);
    if (!entry) return null;

    const healthStatus: Record<string, boolean> = {};
    for (const [name] of entry.instances) {
      healthStatus[name] = true; // Simplified
    }

    return {
      componentId,
      mode: entry.mode,
      activeInstance: entry.activeInstance,
      isFailedOver: entry.isFailedOver,
      lastFailover: entry.lastFailover,
      healthStatus,
    };
  }

  getFailoverHistory(): FailoverRecord[] {
    return [...this.failoverHistory];
  }

  startHealthMonitoring(componentId: string, intervalMs = 5000): void {
    const entry = this.components.get(componentId);
    if (!entry) return;

    this.stopHealthMonitoring(componentId);

    const intervalId = setInterval(async () => {
      try {
        const healthy = await entry.primary.healthCheck();
        if (!healthy && !entry.isFailedOver) {
          await this.triggerFailover(componentId);
        } else if (healthy && entry.isFailedOver && entry.failbackEnabled) {
          await this.triggerFailback(componentId);
        }
      } catch {
        if (!entry.isFailedOver) {
          await this.triggerFailover(componentId);
        }
      }
    }, intervalMs);

    entry.healthCheckInterval = intervalId;
    this.healthCheckIntervals.set(componentId, intervalId);
  }

  stopHealthMonitoring(componentId: string): void {
    const intervalId = this.healthCheckIntervals.get(componentId);
    if (intervalId) {
      clearInterval(intervalId);
      this.healthCheckIntervals.delete(componentId);
    }
    const entry = this.components.get(componentId);
    if (entry) {
      entry.healthCheckInterval = null;
    }
  }

  setFailbackEnabled(componentId: string, enabled: boolean): void {
    const entry = this.components.get(componentId);
    if (entry) {
      entry.failbackEnabled = enabled;
    }
  }

  getRegisteredComponents(): string[] {
    return [...this.components.keys()];
  }
}
