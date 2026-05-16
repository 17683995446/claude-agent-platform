/**
 * 配置快照模块
 * 支持配置版本管理、快照创建、比较和回滚
 */

export interface Snapshot {
  id: string;
  label?: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface SnapshotInfo {
  id: string;
  label?: string;
  timestamp: number;
  summary: string;
}

export interface ConfigDiff {
  added: string[];
  removed: string[];
  changed: Array<{ path: string; oldValue: unknown; newValue: unknown }>;
}

/**
 * ConfigSnapshotManager - 配置快照管理器
 */
export class ConfigSnapshotManager {
  private store: { getAll(): Record<string, unknown>; merge(data: Record<string, unknown>): void; clear(): void };
  private snapshots: Map<string, Snapshot> = new Map();
  private snapshotCounter = 0;
  private autoSnapshotEnabled = false;

  constructor(store: { getAll(): Record<string, unknown>; merge(data: Record<string, unknown>): void; clear(): void }) {
    this.store = store;
  }

  /**
   * 创建当前配置的快照
   */
  createSnapshot(label?: string): Snapshot {
    this.snapshotCounter++;
    const id = `snap-${this.snapshotCounter}-${Date.now()}`;
    const snapshot: Snapshot = {
      id,
      label,
      timestamp: Date.now(),
      data: JSON.parse(JSON.stringify(this.store.getAll())),
    };
    this.snapshots.set(id, snapshot);
    return snapshot;
  }

  /**
   * 恢复到指定快照
   */
  restoreSnapshot(snapshotId: string): boolean {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) return false;
    this.store.clear();
    this.store.merge(JSON.parse(JSON.stringify(snapshot.data)));
    return true;
  }

  /**
   * 列出所有快照
   */
  listSnapshots(): SnapshotInfo[] {
    return Array.from(this.snapshots.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .map((snap) => ({
        id: snap.id,
        label: snap.label,
        timestamp: snap.timestamp,
        summary: `${Object.keys(snap.data).length} top-level keys`,
      }));
  }

  /**
   * 比较两个快照
   */
  compareSnapshots(id1: string, id2: string): ConfigDiff {
    const snap1 = this.snapshots.get(id1);
    const snap2 = this.snapshots.get(id2);
    if (!snap1 || !snap2) {
      throw new Error('Snapshot not found');
    }
    return this.diff(snap1.data, snap2.data);
  }

  /**
   * 获取快照数据
   */
  getSnapshot(snapshotId: string): Snapshot | undefined {
    return this.snapshots.get(snapshotId);
  }

  /**
   * 删除快照
   */
  deleteSnapshot(snapshotId: string): boolean {
    return this.snapshots.delete(snapshotId);
  }

  /**
   * 启用/禁用自动快照
   */
  setAutoSnapshot(enabled: boolean): void {
    this.autoSnapshotEnabled = enabled;
  }

  /**
   * 检查自动快照是否启用
   */
  isAutoSnapshotEnabled(): boolean {
    return this.autoSnapshotEnabled;
  }

  /**
   * 获取快照数量
   */
  getSnapshotCount(): number {
    return this.snapshots.size;
  }

  private diff(config1: Record<string, unknown>, config2: Record<string, unknown>): ConfigDiff {
    const added: string[] = [];
    const removed: string[] = [];
    const changed: Array<{ path: string; oldValue: unknown; newValue: unknown }> = [];

    const allKeys = new Set([
      ...this.flattenKeys(config1),
      ...this.flattenKeys(config2),
    ]);

    for (const key of allKeys) {
      const v1 = this.getNestedValue(config1, key);
      const v2 = this.getNestedValue(config2, key);

      if (v1 === undefined && v2 !== undefined) {
        added.push(key);
      } else if (v1 !== undefined && v2 === undefined) {
        removed.push(key);
      } else if (JSON.stringify(v1) !== JSON.stringify(v2)) {
        changed.push({ path: key, oldValue: v1, newValue: v2 });
      }
    }

    return { added, removed, changed };
  }

  private flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
    const result: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        result.push(...this.flattenKeys(value as Record<string, unknown>, fullKey));
      } else {
        result.push(fullKey);
      }
    }
    return result;
  }

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }
}
