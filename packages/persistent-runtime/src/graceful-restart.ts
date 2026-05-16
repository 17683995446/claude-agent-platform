// src/graceful-restart.ts - Graceful Restarter

export interface RestartResult {
  success: boolean;
  reason?: string;
  timestamp: number;
}

export interface RestartPreparation {
  id: string;
  reason: string;
  preparedAt: number;
  stateSnapshot: unknown;
  inFlightTasks: number;
  drained: boolean;
}

export interface RestartRecord {
  id: string;
  reason: string;
  initiatedAt: number;
  completedAt?: number;
  duration?: number;
  success: boolean;
  rolledBack: boolean;
}

export class GracefulRestarter {
  private drainTimeoutMs: number;
  private maxRestartRate: number;
  private restartRateWindowMs: number;
  private enableRollback: boolean;
  private restartHistory: RestartRecord[] = [];
  private currentPreparation: RestartPreparation | null = null;
  private isRestarting = false;
  private inFlightTasks = 0;
  private preRestartHooks: Array<() => Promise<void>> = [];
  private postRestartHooks: Array<() => Promise<void>> = [];
  private stateSerializer?: () => unknown;
  private stateDeserializer?: (state: unknown) => void;
  private rollbackState?: unknown;

  constructor(options?: {
    drainTimeoutMs?: number;
    maxRestartRate?: number;
    restartRateWindowMs?: number;
    enableRollback?: boolean;
  }) {
    this.drainTimeoutMs = options?.drainTimeoutMs ?? 30000;
    this.maxRestartRate = options?.maxRestartRate ?? 5;
    this.restartRateWindowMs = options?.restartRateWindowMs ?? 300000;
    this.enableRollback = options?.enableRollback ?? true;
  }

  async initiateRestart(reason?: string): Promise<RestartResult> {
    if (this.isRestarting) {
      return { success: false, reason: 'Restart already in progress', timestamp: Date.now() };
    }

    if (!this.canRestart()) {
      return { success: false, reason: 'Restart rate limit exceeded', timestamp: Date.now() };
    }

    this.isRestarting = true;
    const record: RestartRecord = {
      id: `restart_${Date.now()}`,
      reason: reason ?? 'manual',
      initiatedAt: Date.now(),
      success: false,
      rolledBack: false,
    };

    try {
      const preparation = await this.prepareRestart();
      this.currentPreparation = preparation;

      await this.completeRestart(preparation);

      record.completedAt = Date.now();
      record.duration = record.completedAt - record.initiatedAt;
      record.success = true;
      this.restartHistory.push(record);
      this.isRestarting = false;

      return { success: true, reason, timestamp: Date.now() };
    } catch (error) {
      if (this.enableRollback) {
        await this.rollback();
        record.rolledBack = true;
      }
      record.completedAt = Date.now();
      record.duration = record.completedAt - record.initiatedAt;
      this.restartHistory.push(record);
      this.isRestarting = false;

      return { success: false, reason: (error as Error).message, timestamp: Date.now() };
    }
  }

  async prepareRestart(): Promise<RestartPreparation> {
    // Run pre-restart hooks
    for (const hook of this.preRestartHooks) {
      await hook();
    }

    // Serialize state
    const stateSnapshot = this.stateSerializer?.();

    // Save rollback state
    if (this.enableRollback) {
      this.rollbackState = stateSnapshot;
    }

    const preparation: RestartPreparation = {
      id: `prep_${Date.now()}`,
      reason: 'preparation',
      preparedAt: Date.now(),
      stateSnapshot,
      inFlightTasks: this.inFlightTasks,
      drained: this.inFlightTasks === 0,
    };

    this.currentPreparation = preparation;
    return preparation;
  }

  async completeRestart(preparation: RestartPreparation): Promise<void> {
    // Run post-restart hooks
    for (const hook of this.postRestartHooks) {
      await hook();
    }

    // Restore state
    if (this.stateDeserializer && preparation.stateSnapshot) {
      this.stateDeserializer(preparation.stateSnapshot);
    }

    this.currentPreparation = null;
  }

  async rollback(): Promise<void> {
    if (this.rollbackState && this.stateDeserializer) {
      this.stateDeserializer(this.rollbackState);
    }
    this.currentPreparation = null;
  }

  canRestart(): boolean {
    const now = Date.now();
    const windowStart = now - this.restartRateWindowMs;
    const recentRestarts = this.restartHistory.filter(
      (r) => r.initiatedAt >= windowStart
    );
    return recentRestarts.length < this.maxRestartRate;
  }

  getRestartHistory(): RestartRecord[] {
    return [...this.restartHistory];
  }

  setInFlightTasks(count: number): void {
    this.inFlightTasks = count;
  }

  addPreRestartHook(hook: () => Promise<void>): void {
    this.preRestartHooks.push(hook);
  }

  addPostRestartHook(hook: () => Promise<void>): void {
    this.postRestartHooks.push(hook);
  }

  setStateSerializer(serializer: () => unknown): void {
    this.stateSerializer = serializer;
  }

  setStateDeserializer(deserializer: (state: unknown) => void): void {
    this.stateDeserializer = deserializer;
  }

  isRestartingNow(): boolean {
    return this.isRestarting;
  }

  getCurrentPreparation(): RestartPreparation | null {
    return this.currentPreparation;
  }
}
