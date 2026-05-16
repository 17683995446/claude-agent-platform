// src/change-tracker.ts - 变更追踪器

export type ChangeType = 'create' | 'update' | 'delete';

export interface ChangeRecord {
  key: string;
  type: ChangeType;
  oldValue: unknown;
  newValue: unknown;
  timestamp: number;
  version: number;
}

export type ChangeCallback = (record: ChangeRecord) => void;
export type UnsubscribeFn = () => void;

export interface ChangeBatch {
  changes: ChangeRecord[];
  startTime: number;
  endTime: number;
}

export class ChangeTracker {
  private changes: ChangeRecord[] = [];
  private subscriptions: Map<string, Set<ChangeCallback>> = new Map();
  private globalSubscriptions: Set<ChangeCallback> = new Set();
  private versionCounter = 0;
  private changeCounts: Map<string, number> = new Map();
  private batches: ChangeBatch[] = [];
  private currentBatch: ChangeRecord[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private batchInterval: number;

  constructor(batchInterval: number = 100) {
    this.batchInterval = batchInterval;
  }

  track(key: string, oldValue: unknown, newValue: unknown): ChangeRecord {
    this.versionCounter++;

    let type: ChangeType;
    if (oldValue === undefined && newValue !== undefined) {
      type = 'create';
    } else if (oldValue !== undefined && newValue === undefined) {
      type = 'delete';
    } else {
      type = 'update';
    }

    const record: ChangeRecord = {
      key,
      type,
      oldValue: structuredClone(oldValue),
      newValue: structuredClone(newValue),
      timestamp: Date.now(),
      version: this.versionCounter,
    };

    this.changes.push(record);

    // Update change count
    const count = this.changeCounts.get(key) ?? 0;
    this.changeCounts.set(key, count + 1);

    // Add to current batch
    this.currentBatch.push(record);
    this.scheduleBatchFlush();

    // Notify subscribers
    this.notifySubscribers(key, record);

    return record;
  }

  getChanges(since: number): ChangeRecord[] {
    return this.changes.filter((c) => c.version > since);
  }

  subscribe(key: string, callback: ChangeCallback): UnsubscribeFn {
    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, new Set());
    }
    this.subscriptions.get(key)!.add(callback);

    return () => {
      this.subscriptions.get(key)?.delete(callback);
    };
  }

  subscribeAll(callback: ChangeCallback): UnsubscribeFn {
    this.globalSubscriptions.add(callback);
    return () => {
      this.globalSubscriptions.delete(callback);
    };
  }

  getChangeCount(key: string): number {
    return this.changeCounts.get(key) ?? 0;
  }

  exportChanges(format: 'json'): string {
    if (format === 'json') {
      return JSON.stringify(this.changes, null, 2);
    }
    throw new Error(`Unsupported format: ${format}`);
  }

  getAllChanges(): ChangeRecord[] {
    return [...this.changes];
  }

  getBatches(): ChangeBatch[] {
    return [...this.batches];
  }

  clearChanges(): void {
    this.changes = [];
    this.changeCounts.clear();
    this.currentBatch = [];
    this.batches = [];
  }

  getTotalChangeCount(): number {
    return this.changes.length;
  }

  private notifySubscribers(key: string, record: ChangeRecord): void {
    // Key-specific subscribers
    const keySubs = this.subscriptions.get(key);
    if (keySubs) {
      for (const callback of keySubs) {
        try {
          callback(record);
        } catch {
          // Ignore callback errors
        }
      }
    }

    // Global subscribers
    for (const callback of this.globalSubscriptions) {
      try {
        callback(record);
      } catch {
        // Ignore callback errors
      }
    }
  }

  private scheduleBatchFlush(): void {
    if (this.batchTimer) return;
    this.batchTimer = setTimeout(() => {
      this.flushBatch();
    }, this.batchInterval);
  }

  private flushBatch(): void {
    if (this.currentBatch.length === 0) return;

    const batch: ChangeBatch = {
      changes: [...this.currentBatch],
      startTime: this.currentBatch[0].timestamp,
      endTime: this.currentBatch[this.currentBatch.length - 1].timestamp,
    };

    this.batches.push(batch);
    this.currentBatch = [];
    this.batchTimer = null;
  }

  destroy(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }
    this.flushBatch();
    this.subscriptions.clear();
    this.globalSubscriptions.clear();
  }
}
