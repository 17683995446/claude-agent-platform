// src/heartbeat-monitor.ts - Heartbeat Monitor

export interface HeartbeatOptions {
  intervalMs?: number;
  timeoutMs?: number;
  tolerance?: number;
}

export interface HeartbeatStatus {
  componentId: string;
  isAlive: boolean;
  lastBeat: number;
  missedBeats: number;
  healthScore: number;
  status: 'healthy' | 'warning' | 'critical' | 'dead';
}

export interface HeartbeatRecord {
  timestamp: number;
  componentId: string;
}

export class HeartbeatMonitor {
  private components: Map<string, {
    lastBeat: number;
    intervalMs: number;
    timeoutMs: number;
    tolerance: number;
    missedBeats: number;
    history: HeartbeatRecord[];
    registeredAt: number;
  }> = new Map();

  private defaultIntervalMs: number;
  private defaultTimeoutMs: number;
  private defaultTolerance: number;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private onMissedBeat?: (componentId: string, missedCount: number) => void;
  private onRecovery?: (componentId: string) => void;
  private onDeath?: (componentId: string) => void;

  constructor(options?: {
    intervalMs?: number;
    timeoutMs?: number;
    tolerance?: number;
  }) {
    this.defaultIntervalMs = options?.intervalMs ?? 5000;
    this.defaultTimeoutMs = options?.timeoutMs ?? 15000;
    this.defaultTolerance = options?.tolerance ?? 3;
  }

  register(componentId: string, options?: HeartbeatOptions): void {
    this.components.set(componentId, {
      lastBeat: Date.now(),
      intervalMs: options?.intervalMs ?? this.defaultIntervalMs,
      timeoutMs: options?.timeoutMs ?? this.defaultTimeoutMs,
      tolerance: options?.tolerance ?? this.defaultTolerance,
      missedBeats: 0,
      history: [{ timestamp: Date.now(), componentId }],
      registeredAt: Date.now(),
    });
  }

  beat(componentId: string): void {
    const comp = this.components.get(componentId);
    if (!comp) return;

    const wasMissed = comp.missedBeats > 0;
    comp.lastBeat = Date.now();
    comp.missedBeats = 0;
    comp.history.push({ timestamp: Date.now(), componentId });

    // Keep only last 100 records
    if (comp.history.length > 100) {
      comp.history = comp.history.slice(-100);
    }

    if (wasMissed) {
      this.onRecovery?.(componentId);
    }
  }

  unregister(componentId: string): void {
    this.components.delete(componentId);
  }

  isAlive(componentId: string): boolean {
    const comp = this.components.get(componentId);
    if (!comp) return false;
    return this.getComponentStatus(comp).isAlive;
  }

  getAllStatuses(): Map<string, HeartbeatStatus> {
    const result = new Map<string, HeartbeatStatus>();
    for (const [id, comp] of this.components) {
      const status = this.getComponentStatus(comp);
      status.componentId = id;
      result.set(id, status);
    }
    return result;
  }

  getStaleComponents(): string[] {
    const stale: string[] = [];
    const now = Date.now();
    for (const [id, comp] of this.components) {
      const elapsed = now - comp.lastBeat;
      if (elapsed > comp.intervalMs) {
        stale.push(id);
      }
    }
    return stale;
  }

  getHealthScore(componentId: string): number {
    const comp = this.components.get(componentId);
    if (!comp) return 0;
    return this.getComponentStatus(comp).healthScore;
  }

  startMonitoring(checkIntervalMs?: number): void {
    if (this.checkTimer !== null) return;
    const interval = checkIntervalMs ?? this.defaultIntervalMs;
    this.checkTimer = setInterval(() => {
      this.checkAllComponents();
    }, interval);
  }

  stopMonitoring(): void {
    if (this.checkTimer !== null) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  onMissedBeatHook(callback: (componentId: string, missedCount: number) => void): void {
    this.onMissedBeat = callback;
  }

  onRecoveryHook(callback: (componentId: string) => void): void {
    this.onRecovery = callback;
  }

  onDeathHook(callback: (componentId: string) => void): void {
    this.onDeath = callback;
  }

  getComponentCount(): number {
    return this.components.size;
  }

  private checkAllComponents(): void {
    const now = Date.now();
    for (const [id, comp] of this.components) {
      const elapsed = now - comp.lastBeat;
      const expectedBeats = Math.floor(elapsed / comp.intervalMs);
      const missed = Math.max(0, expectedBeats - 1);

      if (missed > comp.missedBeats) {
        comp.missedBeats = missed;
        this.onMissedBeat?.(id, missed);

        if (missed >= comp.tolerance) {
          this.onDeath?.(id);
        }
      }
    }
  }

  private getComponentStatus(comp: NonNullable<ReturnType<typeof this.components.get>>): HeartbeatStatus {
    const now = Date.now();
    const elapsed = now - comp.lastBeat;
    const isAlive = elapsed < comp.timeoutMs;

    let status: HeartbeatStatus['status'] = 'healthy';
    if (!isAlive) {
      status = 'dead';
    } else if (elapsed > comp.intervalMs * 2) {
      status = 'critical';
    } else if (elapsed > comp.intervalMs) {
      status = 'warning';
    }

    // Health score: 100 = perfect, 0 = dead
    const healthScore = isAlive
      ? Math.max(0, Math.round(100 * (1 - elapsed / comp.timeoutMs)))
      : 0;

    return {
      componentId: '', // Will be set by caller
      isAlive,
      lastBeat: comp.lastBeat,
      missedBeats: comp.missedBeats,
      healthScore,
      status,
    };
  }
}
