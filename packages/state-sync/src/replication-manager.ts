// src/replication-manager.ts - 复制管理器

export type ReplicationMode = 'leader-follower' | 'multi-leader' | 'leaderless';

export interface ClusterNode {
  nodeId: string;
  endpoint: string;
  isLeader: boolean;
  isAlive: boolean;
  lastHeartbeat: number;
}

export interface ReplicationResult {
  success: boolean;
  replicatedTo: string[];
  failedNodes: string[];
  replicationFactor: number;
  achieved: number;
  duration: number;
}

export interface ReadQuorum {
  type: 'one' | 'quorum' | 'all';
  consistencyLevel?: number;
}

export interface ReadResult {
  success: boolean;
  value: unknown;
  readFrom: string[];
  consistencyAchieved: boolean;
  stale: boolean;
}

export interface ClusterState {
  mode: ReplicationMode;
  nodes: ClusterNode[];
  leaderId: string | null;
  replicationFactor: number;
  totalNodes: number;
  aliveNodes: number;
}

export interface ReplicationStats {
  totalReplications: number;
  successfulReplications: number;
  failedReplications: number;
  averageLatency: number;
  lastReplicationTime: number | null;
  antiEntropyCount: number;
  conflictCount: number;
}

export class ReplicationManager {
  private mode: ReplicationMode;
  private nodes: Map<string, ClusterNode> = new Map();
  private replicationFactor: number;
  private readQuorumDefault: ReadQuorum = { type: 'quorum' };
  private writeQuorumDefault: ReadQuorum = { type: 'quorum' };
  private stats: ReplicationStats = {
    totalReplications: 0,
    successfulReplications: 0,
    failedReplications: 0,
    averageLatency: 0,
    lastReplicationTime: null,
    antiEntropyCount: 0,
    conflictCount: 0,
  };
  private leaderId: string | null = null;
  private antiEntropyInterval: ReturnType<typeof setInterval> | null = null;
  private antiEntropyCallback: (() => void) | null = null;

  constructor(mode: ReplicationMode = 'multi-leader', replicationFactor: number = 3) {
    this.mode = mode;
    this.replicationFactor = replicationFactor;
  }

  addNode(nodeId: string, endpoint: string): void {
    const isLeader = this.mode === 'leader-follower' && this.nodes.size === 0;
    const node: ClusterNode = {
      nodeId,
      endpoint,
      isLeader,
      isAlive: true,
      lastHeartbeat: Date.now(),
    };
    this.nodes.set(nodeId, node);
    if (isLeader) this.leaderId = nodeId;
  }

  removeNode(nodeId: string): void {
    this.nodes.delete(nodeId);
    if (this.leaderId === nodeId) {
      this.leaderId = null;
      // Elect new leader in leader-follower mode
      if (this.mode === 'leader-follower') {
        const remaining = Array.from(this.nodes.values());
        if (remaining.length > 0) {
          remaining[0].isLeader = true;
          this.leaderId = remaining[0].nodeId;
        }
      }
    }
  }

  replicate(key: string, value: unknown): ReplicationResult {
    const startTime = Date.now();
    this.stats.totalReplications++;

    const aliveNodes = Array.from(this.nodes.values()).filter((n) => n.isAlive);

    // Use writeQuorumDefault if set, otherwise calculate from replicationFactor
    let requiredQuorum: number;
    if (this.writeQuorumDefault.type === 'all') {
      requiredQuorum = aliveNodes.length;
    } else if (this.writeQuorumDefault.type === 'one') {
      requiredQuorum = 1;
    } else {
      requiredQuorum = Math.ceil(this.replicationFactor / 2);
    }

    // Fail early if not enough alive nodes to achieve quorum
    if (aliveNodes.length < requiredQuorum) {
      const duration = Date.now() - startTime;
      this.stats.failedReplications++;
      this.stats.lastReplicationTime = Date.now();
      return {
        success: false,
        replicatedTo: [],
        failedNodes: aliveNodes.map((n) => n.nodeId),
        replicationFactor: this.replicationFactor,
        achieved: 0,
        duration,
      };
    }

    const targetCount = Math.min(this.replicationFactor, aliveNodes.length);
    const targets = aliveNodes.slice(0, targetCount);

    const replicatedTo: string[] = [];
    const failedNodes: string[] = [];

    for (const node of targets) {
      // Simulate replication (always succeeds in this implementation)
      node.lastHeartbeat = Date.now();
      replicatedTo.push(node.nodeId);
    }

    const success = replicatedTo.length >= requiredQuorum;
    const duration = Date.now() - startTime;

    if (success) {
      this.stats.successfulReplications++;
    } else {
      this.stats.failedReplications++;
    }

    // Update average latency
    if (success) {
      const prevTotal = this.stats.averageLatency * (this.stats.successfulReplications - 1);
      this.stats.averageLatency = (prevTotal + duration) / this.stats.successfulReplications;
    }
    this.stats.lastReplicationTime = Date.now();

    return {
      success,
      replicatedTo,
      failedNodes,
      replicationFactor: this.replicationFactor,
      achieved: replicatedTo.length,
      duration,
    };
  }

  read(key: string, quorum?: ReadQuorum): ReadResult {
    const q = quorum ?? this.readQuorumDefault;
    const aliveNodes = Array.from(this.nodes.values()).filter((n) => n.isAlive);

    let requiredReads: number;
    switch (q.type) {
      case 'one':
        requiredReads = 1;
        break;
      case 'all':
        requiredReads = aliveNodes.length;
        break;
      case 'quorum':
      default:
        requiredReads = Math.floor(aliveNodes.length / 2) + 1;
        break;
    }

    if (q.consistencyLevel !== undefined) {
      requiredReads = q.consistencyLevel;
    }

    const readFrom = aliveNodes.slice(0, requiredReads).map((n) => n.nodeId);
    const consistencyAchieved = readFrom.length >= requiredReads;

    return {
      success: consistencyAchieved,
      value: key, // Placeholder - actual value would come from store
      readFrom,
      consistencyAchieved,
      stale: !consistencyAchieved,
    };
  }

  getClusterState(): ClusterState {
    const nodes = Array.from(this.nodes.values());
    return {
      mode: this.mode,
      nodes: nodes.map((n) => ({ ...n })),
      leaderId: this.leaderId,
      replicationFactor: this.replicationFactor,
      totalNodes: nodes.length,
      aliveNodes: nodes.filter((n) => n.isAlive).length,
    };
  }

  getReplicationStats(): ReplicationStats {
    return { ...this.stats };
  }

  setMode(mode: ReplicationMode): void {
    this.mode = mode;
  }

  setReplicationFactor(factor: number): void {
    this.replicationFactor = factor;
  }

  setReadQuorum(quorum: ReadQuorum): void {
    this.readQuorumDefault = quorum;
  }

  setWriteQuorum(quorum: ReadQuorum): void {
    this.writeQuorumDefault = quorum;
  }

  startAntiEntropy(intervalMs: number, callback: () => void): void {
    this.stopAntiEntropy();
    this.antiEntropyCallback = callback;
    this.antiEntropyInterval = setInterval(() => {
      this.stats.antiEntropyCount++;
      callback();
    }, intervalMs);
  }

  stopAntiEntropy(): void {
    if (this.antiEntropyInterval) {
      clearInterval(this.antiEntropyInterval);
      this.antiEntropyInterval = null;
    }
  }

  markNodeAlive(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.isAlive = true;
      node.lastHeartbeat = Date.now();
    }
  }

  markNodeDead(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.isAlive = false;
    }
  }

  getNode(nodeId: string): ClusterNode | undefined {
    return this.nodes.get(nodeId) ? { ...this.nodes.get(nodeId)! } : undefined;
  }

  destroy(): void {
    this.stopAntiEntropy();
    this.nodes.clear();
  }
}
