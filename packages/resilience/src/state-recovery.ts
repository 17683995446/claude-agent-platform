// state-recovery.ts - 状态恢复系统

export type RecoveryStrategy = 'full_restore' | 'partial_restore' | 'replay_events';
export type SnapshotStorage = 'memory' | 'file';

export interface Snapshot {
  id: string;
  state: unknown;
  timestamp: number;
  version: number;
  metadata?: Record<string, unknown>;
}

export interface SnapshotInfo {
  id: string;
  timestamp: number;
  version: number;
  size: number;
  metadata?: Record<string, unknown>;
}

export interface RecoveryConfig {
  storage: SnapshotStorage;
  filePath?: string;
  maxSnapshots?: number;
  autoSnapshotInterval?: number;
}

export interface RecoveryEvent {
  type: 'snapshot_created' | 'snapshot_restored' | 'snapshot_deleted';
  snapshotId: string;
  timestamp: number;
}

type RecoveryEventCallback = (event: RecoveryEvent) => void;

export class StateRecoveryManager {
  private snapshots = new Map<string, Snapshot>();
  private version = 0;
  private eventLog: RecoveryEvent[] = [];
  private readonly maxEventLogSize = 10000;
  private eventCallbacks: RecoveryEventCallback[] = [];
  private autoSnapshotTimer: ReturnType<typeof setInterval> | null = null;
  private readonly config: Required<Pick<RecoveryConfig, 'maxSnapshots'>> & RecoveryConfig;

  constructor(config?: Partial<RecoveryConfig>) {
    this.config = {
      storage: 'memory',
      maxSnapshots: 100,
      ...config,
    };

    if (this.config.autoSnapshotInterval) {
      this.startAutoSnapshot();
    }
  }

  createSnapshot(state: unknown, metadata?: Record<string, unknown>): Snapshot {
    this.version++;
    const snapshot: Snapshot = {
      id: `snap_${Date.now()}_${this.version}`,
      state: this.deepClone(state),
      timestamp: Date.now(),
      version: this.version,
      metadata,
    };

    this.snapshots.set(snapshot.id, snapshot);
    this.enforceMaxSnapshots();

    const event: RecoveryEvent = {
      type: 'snapshot_created',
      snapshotId: snapshot.id,
      timestamp: Date.now(),
    };
    this.eventLog.push(event);
    this.trimEventLog();
    this.eventCallbacks.forEach(cb => cb(event));

    return snapshot;
  }

  async restore(snapshotId: string, strategy: RecoveryStrategy = 'full_restore'): Promise<unknown> {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    const restoredState = this.deepClone(snapshot.state);

    const event: RecoveryEvent = {
      type: 'snapshot_restored',
      snapshotId: snapshot.id,
      timestamp: Date.now(),
    };
    this.eventLog.push(event);
    this.trimEventLog();
    this.eventCallbacks.forEach(cb => cb(event));

    if (strategy === 'partial_restore') {
      return { ...restoredState, _restoredFrom: snapshot.id, _restoredAt: Date.now() };
    }

    return restoredState;
  }

  listSnapshots(): SnapshotInfo[] {
    return Array.from(this.snapshots.values()).map(s => ({
      id: s.id,
      timestamp: s.timestamp,
      version: s.version,
      size: JSON.stringify(s.state).length,
      metadata: s.metadata,
    }));
  }

  getSnapshot(snapshotId: string): Snapshot | undefined {
    return this.snapshots.get(snapshotId);
  }

  cleanup(keepLast?: number): number {
    const keep = keepLast ?? this.config.maxSnapshots;
    const sorted = Array.from(this.snapshots.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);

    let deleted = 0;
    while (sorted.length > keep) {
      const [id] = sorted.shift()!;
      this.snapshots.delete(id);
      deleted++;

      const event: RecoveryEvent = {
        type: 'snapshot_deleted',
        snapshotId: id,
        timestamp: Date.now(),
      };
      this.eventLog.push(event);
      this.trimEventLog();
      this.eventCallbacks.forEach(cb => cb(event));
    }

    return deleted;
  }

  deleteSnapshot(snapshotId: string): boolean {
    const deleted = this.snapshots.delete(snapshotId);
    if (deleted) {
      const event: RecoveryEvent = {
        type: 'snapshot_deleted',
        snapshotId,
        timestamp: Date.now(),
      };
      this.eventLog.push(event);
      this.trimEventLog();
      this.eventCallbacks.forEach(cb => cb(event));
    }
    return deleted;
  }

  getEventLog(): RecoveryEvent[] {
    return [...this.eventLog];
  }

  getVersion(): number {
    return this.version;
  }

  getSnapshotCount(): number {
    return this.snapshots.size;
  }

  onEvent(callback: RecoveryEventCallback): void {
    this.eventCallbacks.push(callback);
  }

  destroy(): void {
    if (this.autoSnapshotTimer) {
      clearInterval(this.autoSnapshotTimer);
      this.autoSnapshotTimer = null;
    }
  }

  private enforceMaxSnapshots(): void {
    if (this.snapshots.size > this.config.maxSnapshots) {
      const sorted = Array.from(this.snapshots.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);
      while (this.snapshots.size > this.config.maxSnapshots) {
        const [id] = sorted.shift()!;
        this.snapshots.delete(id);
      }
    }
  }

  private deepClone<T>(obj: T): T {
    return structuredClone(obj);
  }

  private startAutoSnapshot(): void {
    if (!this.config.autoSnapshotInterval || this.config.autoSnapshotInterval <= 0) return;
    // Note: Actual snapshot creation requires a state provider callback.
    // This interval emits an event so that external listeners can decide
    // whether to create a snapshot. The interval is set up but the caller
    // must listen for auto-snapshot events to perform the actual work.
    this.autoSnapshotTimer = setInterval(() => {
      const event: RecoveryEvent = {
        type: 'snapshot_created',
        snapshotId: `auto_${Date.now()}`,
        timestamp: Date.now(),
      };
      this.eventLog.push(event);
      this.trimEventLog();
      this.eventCallbacks.forEach(cb => cb(event));
    }, this.config.autoSnapshotInterval);
  }

  private trimEventLog(): void {
    if (this.eventLog.length > this.maxEventLogSize) {
      this.eventLog = this.eventLog.slice(this.eventLog.length - this.maxEventLogSize);
    }
  }
}
