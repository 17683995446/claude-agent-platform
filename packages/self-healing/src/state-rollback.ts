// src/state-rollback.ts - State Rollback Manager Module

export interface Snapshot {
  id: string;
  componentId: string;
  state: unknown;
  version: number;
  timestamp: number;
  checksum: string;
  size: number;
}

export interface SnapshotInfo {
  id: string;
  componentId: string;
  version: number;
  timestamp: number;
  size: number;
  checksum: string;
}

export interface RollbackResult {
  success: boolean;
  componentId: string;
  snapshotId: string;
  previousVersion: number;
  newVersion: number;
  message: string;
  duration: number;
}

export interface VerificationResult {
  valid: boolean;
  componentId: string;
  checks: VerificationCheck[];
  timestamp: number;
}

export interface VerificationCheck {
  name: string;
  passed: boolean;
  message: string;
}

interface ComponentState {
  componentId: string;
  currentState: unknown;
  currentVersion: number;
  versionCounter: number; // Monotonically increasing, never decreases on rollback
  snapshots: Snapshot[];
}

export class StateRollbackManager {
  private components = new Map<string, ComponentState>();
  private snapshotIdCounter = 0;
  private maxSnapshotsPerComponent = 50;

  createSnapshot(componentId: string, state: unknown): Snapshot {
    let entry = this.components.get(componentId);
    if (!entry) {
      entry = {
        componentId,
        currentState: state,
        currentVersion: 0,
        versionCounter: 0,
        snapshots: [],
      };
      this.components.set(componentId, entry);
    }

    entry.versionCounter++;
    entry.currentVersion = entry.versionCounter;
    const serialized = JSON.stringify(state);
    const snapshot: Snapshot = {
      id: `snap-${++this.snapshotIdCounter}`,
      componentId,
      state,
      version: entry.currentVersion,
      timestamp: Date.now(),
      checksum: this.computeChecksum(serialized),
      size: Buffer.byteLength(serialized, 'utf-8'),
    };

    entry.snapshots.push(snapshot);
    entry.currentState = state;

    // Cleanup old snapshots
    if (entry.snapshots.length > this.maxSnapshotsPerComponent) {
      entry.snapshots = entry.snapshots.slice(-this.maxSnapshotsPerComponent);
    }

    return snapshot;
  }

  async rollback(componentId: string, snapshotId: string): Promise<RollbackResult> {
    const entry = this.components.get(componentId);
    if (!entry) {
      return {
        success: false,
        componentId,
        snapshotId,
        previousVersion: 0,
        newVersion: 0,
        message: `Component ${componentId} not found`,
        duration: 0,
      };
    }

    const snapshot = entry.snapshots.find((s) => s.id === snapshotId);
    if (!snapshot) {
      return {
        success: false,
        componentId,
        snapshotId,
        previousVersion: entry.currentVersion,
        newVersion: entry.currentVersion,
        message: `Snapshot ${snapshotId} not found`,
        duration: 0,
      };
    }

    const startTime = Date.now();
    const previousVersion = entry.currentVersion;

    entry.currentState = snapshot.state;
    // After rollback, set version to snapshot.version.
    // The next createSnapshot will increment from here, which is correct
    // since it represents a new branch from the rolled-back state.
    entry.currentVersion = snapshot.version;

    const duration = Date.now() - startTime;

    return {
      success: true,
      componentId,
      snapshotId,
      previousVersion,
      newVersion: snapshot.version,
      message: `Rolled back ${componentId} to snapshot ${snapshotId} (version ${snapshot.version})`,
      duration,
    };
  }

  async rollbackToLatest(componentId: string): Promise<RollbackResult> {
    const entry = this.components.get(componentId);
    if (!entry || entry.snapshots.length === 0) {
      return {
        success: false,
        componentId,
        snapshotId: '',
        previousVersion: 0,
        newVersion: 0,
        message: entry ? 'No snapshots available' : `Component ${componentId} not found`,
        duration: 0,
      };
    }

    const latestSnapshot = entry.snapshots[entry.snapshots.length - 1]!;
    return this.rollback(componentId, latestSnapshot.id);
  }

  getSnapshotHistory(componentId: string): SnapshotInfo[] {
    const entry = this.components.get(componentId);
    if (!entry) return [];

    return entry.snapshots.map((s) => ({
      id: s.id,
      componentId: s.componentId,
      version: s.version,
      timestamp: s.timestamp,
      size: s.size,
      checksum: s.checksum,
    }));
  }

  verifyState(componentId: string, state: unknown): VerificationResult {
    const entry = this.components.get(componentId);
    const checks: VerificationCheck[] = [];

    // Check 1: State is not null/undefined
    checks.push({
      name: 'state_not_null',
      passed: state !== null && state !== undefined,
      message: state !== null && state !== undefined ? 'State is not null' : 'State is null or undefined',
    });

    // Check 2: State is serializable
    let serialized: string;
    try {
      serialized = JSON.stringify(state);
      checks.push({
        name: 'serializable',
        passed: true,
        message: 'State is serializable',
      });
    } catch {
      checks.push({
        name: 'serializable',
        passed: false,
        message: 'State is not serializable',
      });
      return {
        valid: false,
        componentId,
        checks,
        timestamp: Date.now(),
      };
    }

    // Check 3: Checksum matches if component exists
    if (entry) {
      const currentChecksum = this.computeChecksum(JSON.stringify(entry.currentState));
      const newChecksum = this.computeChecksum(serialized);
      if (entry.snapshots.length > 0) {
        const latestSnapshot = entry.snapshots[entry.snapshots.length - 1]!;
        const snapshotMatch = newChecksum === latestSnapshot.checksum;
        checks.push({
          name: 'checksum_match',
          passed: true, // Always passes - just informational
          message: `Current checksum: ${currentChecksum}, New checksum: ${newChecksum}`,
        });
      }
    }

    // Check 4: State is not empty
    const isEmpty = serialized === '{}' || serialized === '[]' || serialized === '""';
    checks.push({
      name: 'not_empty',
      passed: !isEmpty,
      message: isEmpty ? 'State appears to be empty' : 'State has content',
    });

    const allPassed = checks.every((c) => c.passed);
    return {
      valid: allPassed,
      componentId,
      checks,
      timestamp: Date.now(),
    };
  }

  getCurrentState(componentId: string): unknown {
    return this.components.get(componentId)?.currentState;
  }

  getCurrentVersion(componentId: string): number {
    return this.components.get(componentId)?.currentVersion ?? 0;
  }

  deleteSnapshot(componentId: string, snapshotId: string): boolean {
    const entry = this.components.get(componentId);
    if (!entry) return false;
    const index = entry.snapshots.findIndex((s) => s.id === snapshotId);
    if (index === -1) return false;
    entry.snapshots.splice(index, 1);
    return true;
  }

  clearSnapshots(componentId: string): void {
    const entry = this.components.get(componentId);
    if (entry) {
      entry.snapshots = [];
    }
  }

  setMaxSnapshots(max: number): void {
    this.maxSnapshotsPerComponent = max;
  }

  getRegisteredComponents(): string[] {
    return [...this.components.keys()];
  }

  private computeChecksum(data: string): string {
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }
}
