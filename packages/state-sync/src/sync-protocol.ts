// src/sync-protocol.ts - 同步协议

import type { CRDTState } from './crdt-store.js';

export type SyncStrategy = 'full-sync' | 'delta-sync' | 'causal-sync';

export interface VersionVector {
  [nodeId: string]: number;
}

export interface SyncMessage {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  strategy: SyncStrategy;
  state: CRDTState;
  versionVector: VersionVector;
  timestamp: number;
  compressed: boolean;
  payload?: string; // compressed payload
}

export interface SyncResult {
  success: boolean;
  entriesMerged: number;
  conflictsDetected: number;
  conflictsResolved: number;
  duration: number;
  strategy: SyncStrategy;
  versionVector: VersionVector;
}

export interface SyncStatus {
  lastSyncTime: number | null;
  lastSyncResult: SyncResult | null;
  pendingSyncs: number;
  syncInProgress: boolean;
  versionVector: VersionVector;
  connectedNodes: string[];
}

export interface StateEntry {
  key: string;
  value: unknown;
  version: number;
  timestamp: number;
  nodeId: string;
}

export class SyncProtocol {
  private nodeId: string;
  private versionVector: VersionVector = {};
  private localVersion: number = 0;
  private connectedNodes: Set<string> = new Set();
  private lastSyncTime: number | null = null;
  private lastSyncResult: SyncResult | null = null;
  private syncInProgress = false;
  private pendingSyncs = 0;
  private syncCounter = 0;

  constructor(nodeId: string) {
    this.nodeId = nodeId;
    this.versionVector[nodeId] = 0;
  }

  prepareSync(localState: CRDTState): SyncMessage {
    this.localVersion++;
    this.versionVector[this.nodeId] = this.localVersion;
    this.syncCounter++;

    const message: SyncMessage = {
      id: `sync_${this.syncCounter}_${Date.now()}`,
      fromNodeId: this.nodeId,
      toNodeId: '',
      strategy: 'full-sync',
      state: localState,
      versionVector: { ...this.versionVector },
      timestamp: Date.now(),
      compressed: false,
    };

    return message;
  }

  prepareDeltaSync(localState: CRDTState, strategy: SyncStrategy = 'delta-sync'): SyncMessage {
    this.localVersion++;
    this.versionVector[this.nodeId] = this.localVersion;
    this.syncCounter++;

    const message: SyncMessage = {
      id: `sync_${this.syncCounter}_${Date.now()}`,
      fromNodeId: this.nodeId,
      toNodeId: '',
      strategy,
      state: localState,
      versionVector: { ...this.versionVector },
      timestamp: Date.now(),
      compressed: false,
    };

    return message;
  }

  processSync(message: SyncMessage): SyncResult {
    const startTime = Date.now();
    this.syncInProgress = true;
    this.pendingSyncs++;

    try {
      // Detect conflicts BEFORE merging version vectors
      let conflictsDetected = 0;
      for (const [node, version] of Object.entries(message.versionVector)) {
        const localVersion = this.versionVector[node] ?? 0;
        if (node !== this.nodeId && version > localVersion) {
          conflictsDetected++;
        }
      }

      // Merge version vectors (after conflict detection)
      const mergedVector: VersionVector = { ...this.versionVector };
      for (const [node, version] of Object.entries(message.versionVector)) {
        mergedVector[node] = Math.max(mergedVector[node] ?? 0, version);
      }
      this.versionVector = mergedVector;

      const entriesMerged = Object.keys(message.state.counters).length +
        Object.keys(message.state.sets).length +
        Object.keys(message.state.registers).length +
        Object.keys(message.state.maps).length;

      this.lastSyncTime = Date.now();

      const result: SyncResult = {
        success: true,
        entriesMerged,
        conflictsDetected,
        conflictsResolved: conflictsDetected,
        duration: Date.now() - startTime,
        strategy: message.strategy,
        versionVector: { ...this.versionVector },
      };

      this.lastSyncResult = result;
      return result;
    } finally {
      this.syncInProgress = false;
      this.pendingSyncs--;
    }
  }

  resolveConflict(local: StateEntry, remote: StateEntry): StateEntry {
    // Last-writer-wins based on timestamp
    if (remote.timestamp > local.timestamp) {
      return { ...remote };
    }
    if (local.timestamp > remote.timestamp) {
      return { ...local };
    }
    // Tie-breaker: higher node ID wins
    if (remote.nodeId > local.nodeId) {
      return { ...remote };
    }
    return { ...local };
  }

  getSyncStatus(): SyncStatus {
    return {
      lastSyncTime: this.lastSyncTime,
      lastSyncResult: this.lastSyncResult,
      pendingSyncs: this.pendingSyncs,
      syncInProgress: this.syncInProgress,
      versionVector: { ...this.versionVector },
      connectedNodes: Array.from(this.connectedNodes),
    };
  }

  connectNode(nodeId: string): void {
    this.connectedNodes.add(nodeId);
    this.versionVector[nodeId] = this.versionVector[nodeId] ?? 0;
  }

  disconnectNode(nodeId: string): void {
    this.connectedNodes.delete(nodeId);
  }

  compressPayload(message: SyncMessage): SyncMessage {
    const payload = JSON.stringify(message.state);
    // Simple compression simulation: base64 encode
    const compressed = Buffer.from(payload).toString('base64');
    return {
      ...message,
      compressed: true,
      payload: compressed,
    };
  }

  decompressPayload(message: SyncMessage): SyncMessage {
    if (!message.compressed || !message.payload) return message;
    const payload = JSON.parse(Buffer.from(message.payload, 'base64').toString());
    return {
      ...message,
      state: payload,
      compressed: false,
    };
  }

  getVersionVector(): VersionVector {
    return { ...this.versionVector };
  }

  getNodeId(): string {
    return this.nodeId;
  }
}
