// src/checkpoint-manager.ts - Checkpoint Manager

export type CheckpointType = 'full' | 'incremental' | 'differential';

export interface Checkpoint {
  id: string;
  type: CheckpointType;
  label?: string;
  timestamp: number;
  data: unknown;
  hash: string;
  size: number;
  iteration?: number;
  previousCheckpointId?: string;
  tagged?: boolean;
}

export interface CheckpointInfo {
  id: string;
  type: CheckpointType;
  label?: string;
  timestamp: number;
  size: number;
  iteration?: number;
  tagged?: boolean;
}

export interface RestoreResult {
  success: boolean;
  checkpointId: string;
  restoredAt: number;
  data: unknown;
  error?: string;
}

export interface CheckpointTrigger {
  timeIntervalSec: number;
  iterationInterval: number;
  sizeThreshold: number;
  eventBased: boolean;
}

export interface CheckpointRetention {
  maxCount: number;
  maxAgeHours: number;
  keepTagged: boolean;
}

export class CheckpointManager {
  private checkpoints: Map<string, Checkpoint> = new Map();
  private checkpointOrder: string[] = [];
  private trigger: CheckpointTrigger;
  private retention: CheckpointRetention;
  private lastCheckpointTime = 0;
  private lastCheckpointIteration = 0;
  private lastStateHash = '';
  private currentIteration = 0;
  private lastCheckpointId: string | undefined;
  private lastCheckpointDataSize = 0;
  private onCheckpointCreated?: (checkpoint: Checkpoint) => void;

  constructor(options?: {
    trigger?: Partial<CheckpointTrigger>;
    retention?: Partial<CheckpointRetention>;
  }) {
    this.trigger = {
      timeIntervalSec: options?.trigger?.timeIntervalSec ?? 300,
      iterationInterval: options?.trigger?.iterationInterval ?? 100,
      sizeThreshold: options?.trigger?.sizeThreshold ?? 1024 * 1024,
      eventBased: options?.trigger?.eventBased ?? true,
    };
    this.retention = {
      maxCount: options?.retention?.maxCount ?? 10,
      maxAgeHours: options?.retention?.maxAgeHours ?? 24,
      keepTagged: options?.retention?.keepTagged ?? true,
    };
  }

  createCheckpoint(label?: string, state?: unknown): Checkpoint {
    const id = this.generateId();
    const data = state ?? this.lastStateHash;
    const serialized = this.safeStringify(data);
    const hash = this.computeHash(serialized);
    const size = new TextEncoder().encode(serialized).length;

    const checkpoint: Checkpoint = {
      id,
      type: 'full',
      label,
      timestamp: Date.now(),
      data,
      hash,
      size,
      iteration: this.currentIteration,
      previousCheckpointId: this.lastCheckpointId,
    };

    this.checkpoints.set(id, checkpoint);
    this.checkpointOrder.push(id);
    this.lastCheckpointId = id;
    this.lastCheckpointTime = Date.now();
    this.lastCheckpointIteration = this.currentIteration;
    this.lastCheckpointDataSize = size;

    this.enforceRetention();
    this.onCheckpointCreated?.(checkpoint);

    return checkpoint;
  }

  async restoreCheckpoint(checkpointId: string): Promise<RestoreResult> {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) {
      return {
        success: false,
        checkpointId,
        restoredAt: Date.now(),
        data: undefined,
        error: 'Checkpoint not found',
      };
    }

    // Verify integrity
    const serialized = this.safeStringify(checkpoint.data);
    const hash = this.computeHash(serialized);
    if (hash !== checkpoint.hash) {
      return {
        success: false,
        checkpointId,
        restoredAt: Date.now(),
        data: undefined,
        error: 'Checkpoint integrity check failed',
      };
    }

    this.lastStateHash = serialized;
    return {
      success: true,
      checkpointId,
      restoredAt: Date.now(),
      data: checkpoint.data,
    };
  }

  listCheckpoints(): CheckpointInfo[] {
    return this.checkpointOrder.map((id) => {
      const cp = this.checkpoints.get(id)!;
      return {
        id: cp.id,
        type: cp.type,
        label: cp.label,
        timestamp: cp.timestamp,
        size: cp.size,
        iteration: cp.iteration,
        tagged: cp.tagged,
      };
    });
  }

  deleteCheckpoint(checkpointId: string): boolean {
    if (!this.checkpoints.has(checkpointId)) return false;
    this.checkpoints.delete(checkpointId);
    this.checkpointOrder = this.checkpointOrder.filter((id) => id !== checkpointId);
    if (this.lastCheckpointId === checkpointId) {
      this.lastCheckpointId = this.checkpointOrder.length > 0
        ? this.checkpointOrder[this.checkpointOrder.length - 1]!
        : undefined;
    }
    return true;
  }

  getLatestCheckpoint(): CheckpointInfo | undefined {
    if (this.checkpointOrder.length === 0) return undefined;
    const id = this.checkpointOrder[this.checkpointOrder.length - 1]!;
    const cp = this.checkpoints.get(id)!;
    return {
      id: cp.id,
      type: cp.type,
      label: cp.label,
      timestamp: cp.timestamp,
      size: cp.size,
      iteration: cp.iteration,
      tagged: cp.tagged,
    };
  }

  setIteration(iteration: number): void {
    this.currentIteration = iteration;
  }

  shouldCheckpoint(state?: unknown): boolean {
    // Time-based trigger
    if (this.trigger.timeIntervalSec > 0) {
      const elapsed = (Date.now() - this.lastCheckpointTime) / 1000;
      if (elapsed >= this.trigger.timeIntervalSec) return true;
    }

    // Iteration-based trigger
    if (this.trigger.iterationInterval > 0) {
      const iterationsSinceLast = this.currentIteration - this.lastCheckpointIteration;
      if (iterationsSinceLast >= this.trigger.iterationInterval) return true;
    }

    // Size-based trigger
    if (state !== undefined && this.trigger.sizeThreshold > 0) {
      const serialized = JSON.stringify(state);
      const size = new TextEncoder().encode(serialized).length;
      const diff = Math.abs(size - this.lastCheckpointDataSize);
      if (diff >= this.trigger.sizeThreshold) return true;
    }

    return false;
  }

  tagCheckpoint(checkpointId: string): boolean {
    const cp = this.checkpoints.get(checkpointId);
    if (!cp) return false;
    cp.tagged = true;
    return true;
  }

  onCheckpointCreatedHook(callback: (checkpoint: Checkpoint) => void): void {
    this.onCheckpointCreated = callback;
  }

  getCheckpointCount(): number {
    return this.checkpoints.size;
  }

  private enforceRetention(): void {
    const now = Date.now();
    const maxAgeMs = this.retention.maxAgeHours * 60 * 60 * 1000;

    // Remove expired non-tagged checkpoints
    const toRemove: string[] = [];
    for (const id of this.checkpointOrder) {
      const cp = this.checkpoints.get(id)!;
      if (cp.tagged && this.retention.keepTagged) continue;
      if (now - cp.timestamp > maxAgeMs) {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      this.deleteCheckpoint(id);
    }

    // Keep only maxCount (preserving tagged)
    while (this.checkpointOrder.length > this.retention.maxCount) {
      let removed = false;
      for (let i = 0; i < this.checkpointOrder.length; i++) {
        const cp = this.checkpoints.get(this.checkpointOrder[i]!)!;
        if (!cp.tagged || !this.retention.keepTagged) {
          this.deleteCheckpoint(this.checkpointOrder[i]!);
          removed = true;
          break;
        }
      }
      if (!removed) break;
    }
  }

  private generateId(): string {
    return `cp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private computeHash(data: string): string {
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `hash_${Math.abs(hash).toString(16)}`;
  }

  private safeStringify(data: unknown): string {
    const seen = new WeakSet();
    try {
      const result = JSON.stringify(data, (_key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) return '[Circular]';
          seen.add(value);
        }
        return value;
      });
      return result ?? JSON.stringify(String(data)) ?? 'null';
    } catch {
      return JSON.stringify(String(data)) ?? 'null';
    }
  }
}
