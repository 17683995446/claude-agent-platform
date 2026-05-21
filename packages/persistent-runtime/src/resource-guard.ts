// src/resource-guard.ts - Resource Guard

export interface MemoryUsage {
  used: number;
  total: number;
  percentage: number;
}

export interface ResourceThreshold {
  resource: string;
  warning: number;
  critical: number;
  current: number;
  level: 'normal' | 'warning' | 'critical';
}

export interface ResourceRequest {
  memory?: number;
  cpu?: number;
  handles?: number;
}

export interface Reservation {
  id: string;
  resources: ResourceRequest;
  grantedAt: number;
}

export interface ResourceReport {
  timestamp: number;
  memory: MemoryUsage;
  eventLoopLag: number;
  thresholds: ResourceThreshold[];
  reservations: number;
  actions: string[];
}

export class ResourceGuard {
  private thresholds: Map<string, { warning: number; critical: number }> = new Map();
  private reservations: Map<string, Reservation> = new Map();
  private monitorTimer: ReturnType<typeof setInterval> | null = null;
  private lastEventLoopLag = 0;
  private reservedMemory = 0;
  private actions: string[] = [];
  private onWarning?: (resource: string, value: number) => void;
  private onCritical?: (resource: string, value: number) => void;
  private onAction?: (action: string) => void;

  constructor() {
    // Default thresholds
    this.thresholds.set('memory', { warning: 80, critical: 95 });
    this.thresholds.set('eventLoopLag', { warning: 100, critical: 500 });
  }

  monitor(intervalMs: number): void {
    if (this.monitorTimer !== null) return;
    this.monitorTimer = setInterval(() => {
      this.checkResources();
    }, intervalMs);
  }

  stopMonitoring(): void {
    if (this.monitorTimer !== null) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
  }

  getMemoryUsage(): MemoryUsage {
    const mem = process.memoryUsage();
    const total = mem.heapTotal;
    const used = mem.heapUsed;
    return {
      used,
      total,
      percentage: total > 0 ? (used / total) * 100 : 0,
    };
  }

  getEventLoopLag(): number {
    return this.lastEventLoopLag;
  }

  setThreshold(resource: string, warning: number, critical: number): void {
    this.thresholds.set(resource, { warning, critical });
  }

  reserve(resources: ResourceRequest): Reservation {
    const id = `res_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Validate available memory against tracked reservations
    if (resources.memory && resources.memory > 0) {
      const mem = this.getMemoryUsage();
      const availableMemory = mem.total - mem.used;
      if (resources.memory > availableMemory) {
        // Warn about over-reservation but allow it (soft limit)
        const action = `Over-reservation warning: requested ${resources.memory} bytes but only ${availableMemory} bytes available`;
        this.actions.push(action);
        if (this.onWarning) {
          this.onWarning('memory', this.reservedMemory + resources.memory);
        }
      }
    }

    const reservation: Reservation = {
      id,
      resources,
      grantedAt: Date.now(),
    };
    this.reservations.set(id, reservation);
    if (resources.memory && resources.memory > 0) {
      this.reservedMemory += resources.memory;
    }
    return reservation;
  }

  release(reservationId: string): void {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) return;
    if (reservation.resources.memory) {
      this.reservedMemory -= reservation.resources.memory;
    }
    this.reservations.delete(reservationId);
  }

  getReport(): ResourceReport {
    const memory = this.getMemoryUsage();
    const thresholds: ResourceThreshold[] = [];

    for (const [resource, threshold] of this.thresholds) {
      let current: number;
      if (resource === 'memory') {
        current = memory.percentage;
      } else if (resource === 'eventLoopLag') {
        current = this.lastEventLoopLag;
      } else {
        current = 0;
      }

      let level: 'normal' | 'warning' | 'critical' = 'normal';
      if (current >= threshold.critical) {
        level = 'critical';
      } else if (current >= threshold.warning) {
        level = 'warning';
      }

      thresholds.push({ resource, warning: threshold.warning, critical: threshold.critical, current, level });
    }

    return {
      timestamp: Date.now(),
      memory,
      eventLoopLag: this.lastEventLoopLag,
      thresholds,
      reservations: this.reservations.size,
      actions: [...this.actions],
    };
  }

  getReservationCount(): number {
    return this.reservations.size;
  }

  onWarningHook(callback: (resource: string, value: number) => void): void {
    this.onWarning = callback;
  }

  onCriticalHook(callback: (resource: string, value: number) => void): void {
    this.onCritical = callback;
  }

  onActionHook(callback: (action: string) => void): void {
    this.onAction = callback;
  }

  setEventLoopLag(lag: number): void {
    this.lastEventLoopLag = lag;
  }

  private checkResources(): void {
    const memory = this.getMemoryUsage();
    const memThreshold = this.thresholds.get('memory');

    if (memThreshold) {
      if (memory.percentage >= memThreshold.critical) {
        this.onCritical?.('memory', memory.percentage);
        this.executeAction('emergencyStop');
      } else if (memory.percentage >= memThreshold.warning) {
        this.onWarning?.('memory', memory.percentage);
        this.executeAction('gc');
      }
    }

    const lagThreshold = this.thresholds.get('eventLoopLag');
    if (lagThreshold) {
      if (this.lastEventLoopLag >= lagThreshold.critical) {
        this.onCritical?.('eventLoopLag', this.lastEventLoopLag);
        this.executeAction('reject');
      } else if (this.lastEventLoopLag >= lagThreshold.warning) {
        this.onWarning?.('eventLoopLag', this.lastEventLoopLag);
      }
    }
  }

  private executeAction(action: string): void {
    this.actions.push(`${action}@${Date.now()}`);
    this.onAction?.(action);

    if (action === 'gc') {
      if (global.gc) {
        global.gc();
      }
    }
  }
}
