// src/state-store.ts - 状态存储引擎

export interface SetOptions {
  namespace?: string;
  ttl?: number; // milliseconds
  label?: string;
}

export interface StateEntry {
  key: string;
  value: unknown;
  version: number;
  namespace?: string;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
}

export interface SnapshotInfo {
  id: string;
  label?: string;
  timestamp: number;
  entryCount: number;
  state: Map<string, StateEntry>;
}

export class StateStore {
  private store: Map<string, StateEntry> = new Map();
  private versions: Map<string, number> = new Map();
  private snapshots: Map<string, SnapshotInfo> = new Map();
  private snapshotCounter = 0;
  private ttlTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  get(key: string): StateEntry | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.delete(key);
      return undefined;
    }
    return { ...entry };
  }

  set(key: string, value: unknown, options?: SetOptions): StateEntry {
    const currentVersion = this.versions.get(key) ?? 0;
    const newVersion = currentVersion + 1;
    const now = Date.now();

    // Clear existing TTL timer
    const existingTimer = this.ttlTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.ttlTimers.delete(key);
    }

    const entry: StateEntry = {
      key,
      value: structuredClone(value),
      version: newVersion,
      namespace: options?.namespace,
      createdAt: this.store.has(key) ? (this.store.get(key)!.createdAt) : now,
      updatedAt: now,
      expiresAt: options?.ttl ? now + options.ttl : undefined,
    };

    this.store.set(key, entry);
    this.versions.set(key, newVersion);

    // Set TTL timer
    if (options?.ttl) {
      const timer = setTimeout(() => {
        this.delete(key);
      }, options.ttl);
      this.ttlTimers.set(key, timer);
    }

    return { ...entry };
  }

  delete(key: string): boolean {
    const existingTimer = this.ttlTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.ttlTimers.delete(key);
    }
    return this.store.delete(key);
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  keys(namespace?: string): string[] {
    const allKeys = Array.from(this.store.keys());
    if (!namespace) return allKeys;
    return allKeys.filter((key) => {
      const entry = this.store.get(key);
      return entry?.namespace === namespace;
    });
  }

  snapshot(label?: string): SnapshotInfo {
    this.snapshotCounter++;
    const id = `snap_${this.snapshotCounter}_${Date.now()}`;
    const state = new Map<string, StateEntry>();
    for (const [key, entry] of this.store) {
      state.set(key, { ...entry });
    }
    const info: SnapshotInfo = {
      id,
      label,
      timestamp: Date.now(),
      entryCount: state.size,
      state,
    };
    this.snapshots.set(id, info);
    return { ...info, state };
  }

  restore(snapshotId: string): boolean {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) return false;

    // Clear current state
    this.store.clear();
    this.versions.clear();
    for (const timer of this.ttlTimers.values()) {
      clearTimeout(timer);
    }
    this.ttlTimers.clear();

    // Restore from snapshot
    for (const [key, entry] of snapshot.state) {
      this.store.set(key, { ...entry });
      this.versions.set(key, entry.version);
    }

    return true;
  }

  getVersion(key: string): number {
    return this.versions.get(key) ?? 0;
  }

  clear(): void {
    this.store.clear();
    this.versions.clear();
    for (const timer of this.ttlTimers.values()) {
      clearTimeout(timer);
    }
    this.ttlTimers.clear();
  }

  size(): number {
    return this.store.size;
  }

  getSnapshot(snapshotId: string): SnapshotInfo | undefined {
    const snap = this.snapshots.get(snapshotId);
    if (!snap) return undefined;
    return { ...snap, state: new Map(snap.state) };
  }

  destroy(): void {
    this.clear();
    this.snapshots.clear();
  }
}
