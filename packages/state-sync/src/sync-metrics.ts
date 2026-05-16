// src/sync-metrics.ts - 同步指标

export interface SyncEvent {
  type: 'sync-start' | 'sync-complete' | 'sync-fail' | 'conflict' | 'replication';
  nodeId: string;
  targetNodeId?: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  entriesCount?: number;
  conflictCount?: number;
  success?: boolean;
  error?: string;
}

export interface SyncMetricsReport {
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  averageSyncLatency: number;
  totalConflicts: number;
  conflictRate: number;
  syncFrequency: number;
  dataFreshness: number;
  periodStart: number;
  periodEnd: number;
}

export interface NodeSyncStats {
  nodeId: string;
  syncCount: number;
  successfulSyncs: number;
  failedSyncs: number;
  averageLatency: number;
  lastSyncTime: number | null;
  totalConflicts: number;
  totalEntries: number;
}

export interface LatencyData {
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  avg: number;
}

export interface SyncDashboard {
  overview: SyncMetricsReport;
  nodeStats: NodeSyncStats[];
  latency: LatencyData;
  recentEvents: SyncEvent[];
  topConflictingNodes: { nodeId: string; conflicts: number }[];
}

export class SyncMetrics {
  private events: SyncEvent[] = [];
  private nodeStats: Map<string, {
    syncCount: number;
    successfulSyncs: number;
    failedSyncs: number;
    totalLatency: number;
    lastSyncTime: number | null;
    totalConflicts: number;
    totalEntries: number;
  }> = new Map();
  private periodStart: number;
  private periodEnd: number;
  private maxEvents = 10000;

  constructor() {
    this.periodStart = Date.now();
    this.periodEnd = Date.now();
  }

  recordSync(event: SyncEvent): void {
    const record: SyncEvent = { ...event };
    if (!record.endTime && record.startTime) {
      record.endTime = Date.now();
      record.duration = record.endTime - record.startTime;
    }

    this.events.push(record);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    this.periodEnd = Date.now();

    // Update node stats
    const stats = this.getOrCreateNodeStats(record.nodeId);
    stats.syncCount++;

    if (record.type === 'sync-complete' || record.type === 'replication') {
      if (record.success) {
        stats.successfulSyncs++;
      } else {
        stats.failedSyncs++;
      }
      if (record.duration) {
        stats.totalLatency += record.duration;
      }
      stats.lastSyncTime = record.endTime ?? Date.now();
      if (record.entriesCount) {
        stats.totalEntries += record.entriesCount;
      }
    }

    if (record.type === 'sync-fail') {
      stats.failedSyncs++;
    }

    if (record.type === 'conflict') {
      stats.totalConflicts++;
    }
  }

  getMetrics(): SyncMetricsReport {
    const syncs = this.events.filter((e) =>
      e.type === 'sync-complete' || e.type === 'sync-fail' || e.type === 'replication'
    );
    const successful = syncs.filter((e) => e.success !== false);
    const failed = syncs.filter((e) => e.success === false);
    const conflicts = this.events.filter((e) => e.type === 'conflict');

    const latencies = syncs
      .filter((e) => e.duration !== undefined)
      .map((e) => e.duration!);

    const avgLatency = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;

    const elapsedMs = this.periodEnd - this.periodStart;
    const syncFrequency = elapsedMs > 0 ? (syncs.length / elapsedMs) * 1000 : 0;

    // Data freshness: time since last successful sync
    const lastSync = syncs
      .filter((e) => e.success !== false)
      .sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0))[0];
    const dataFreshness = lastSync ? Date.now() - (lastSync.endTime ?? Date.now()) : Infinity;

    return {
      totalSyncs: syncs.length,
      successfulSyncs: successful.length,
      failedSyncs: failed.length,
      averageSyncLatency: avgLatency,
      totalConflicts: conflicts.length,
      conflictRate: syncs.length > 0 ? conflicts.length / syncs.length : 0,
      syncFrequency,
      dataFreshness,
      periodStart: this.periodStart,
      periodEnd: this.periodEnd,
    };
  }

  getNodeMetrics(nodeId: string): NodeSyncStats {
    const stats = this.nodeStats.get(nodeId);
    if (!stats) {
      return {
        nodeId,
        syncCount: 0,
        successfulSyncs: 0,
        failedSyncs: 0,
        averageLatency: 0,
        lastSyncTime: null,
        totalConflicts: 0,
        totalEntries: 0,
      };
    }

    return {
      nodeId,
      syncCount: stats.syncCount,
      successfulSyncs: stats.successfulSyncs,
      failedSyncs: stats.failedSyncs,
      averageLatency: stats.successfulSyncs > 0 ? stats.totalLatency / stats.successfulSyncs : 0,
      lastSyncTime: stats.lastSyncTime,
      totalConflicts: stats.totalConflicts,
      totalEntries: stats.totalEntries,
    };
  }

  getLatencyPercentiles(): LatencyData {
    const latencies = this.events
      .filter((e) => e.duration !== undefined)
      .map((e) => e.duration!)
      .sort((a, b) => a - b);

    if (latencies.length === 0) {
      return { p50: 0, p90: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0 };
    }

    const percentile = (p: number) => {
      const idx = Math.ceil((p / 100) * latencies.length) - 1;
      return latencies[Math.max(0, idx)];
    };

    return {
      p50: percentile(50),
      p90: percentile(90),
      p95: percentile(95),
      p99: percentile(99),
      min: latencies[0],
      max: latencies[latencies.length - 1],
      avg: latencies.reduce((a, b) => a + b, 0) / latencies.length,
    };
  }

  getDashboard(): SyncDashboard {
    const allNodeIds = new Set(this.events.map((e) => e.nodeId));
    const nodeStatsList = Array.from(allNodeIds).map((id) => this.getNodeMetrics(id));

    // Top conflicting nodes
    const conflictMap = new Map<string, number>();
    for (const event of this.events) {
      if (event.type === 'conflict') {
        const count = conflictMap.get(event.nodeId) ?? 0;
        conflictMap.set(event.nodeId, count + 1);
      }
    }
    const topConflictingNodes = Array.from(conflictMap.entries())
      .map(([nodeId, conflicts]) => ({ nodeId, conflicts }))
      .sort((a, b) => b.conflicts - a.conflicts)
      .slice(0, 5);

    return {
      overview: this.getMetrics(),
      nodeStats: nodeStatsList,
      latency: this.getLatencyPercentiles(),
      recentEvents: this.events.slice(-20),
      topConflictingNodes,
    };
  }

  getAllNodeIds(): string[] {
    return Array.from(new Set(this.events.map((e) => e.nodeId)));
  }

  getEvents(): SyncEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
    this.nodeStats.clear();
    this.periodStart = Date.now();
    this.periodEnd = Date.now();
  }

  private getOrCreateNodeStats(nodeId: string) {
    if (!this.nodeStats.has(nodeId)) {
      this.nodeStats.set(nodeId, {
        syncCount: 0,
        successfulSyncs: 0,
        failedSyncs: 0,
        totalLatency: 0,
        lastSyncTime: null,
        totalConflicts: 0,
        totalEntries: 0,
      });
    }
    return this.nodeStats.get(nodeId)!;
  }
}
