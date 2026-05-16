// src/index.ts - Export everything

// Module 1: State Store
export { StateStore } from './state-store.js';
export type { SetOptions, StateEntry, SnapshotInfo } from './state-store.js';

// Module 2: CRDT Store
export { CRDTStore, GCounter, PNCounter, GSet, ORSet, LWWRegister, LWWMap } from './crdt-store.js';
export type {
  CRDTCounter,
  CRDTSet,
  CRDTRegister,
  CRDTMap,
  CRDTState,
  MergeResult,
} from './crdt-store.js';

// Module 3: Sync Protocol
export { SyncProtocol } from './sync-protocol.js';
export type {
  SyncStrategy,
  VersionVector,
  SyncMessage,
  SyncResult,
  SyncStatus,
  StateEntry as SyncStateEntry,
} from './sync-protocol.js';

// Module 4: Conflict Resolver
export { ConflictResolver } from './conflict-resolver.js';
export type {
  ResolutionStrategy,
  ConflictEntry,
  ResolvedEntry,
  Conflict,
  ConflictRecord,
  CustomResolver,
} from './conflict-resolver.js';

// Module 5: Replication Manager
export { ReplicationManager } from './replication-manager.js';
export type {
  ReplicationMode,
  ClusterNode,
  ReplicationResult,
  ReadQuorum,
  ReadResult,
  ClusterState,
  ReplicationStats,
} from './replication-manager.js';

// Module 6: Raft Consensus
export { RaftConsensus } from './consensus-raft.js';
export type { RaftRole, LogEntry, RaftConfig } from './consensus-raft.js';

// Module 7: Event Sourcing
export { EventSourcedStore } from './event-sourcing.js';
export type { DomainEvent, AggregateSnapshot, EventStream } from './event-sourcing.js';

// Module 8: Change Tracker
export { ChangeTracker } from './change-tracker.js';
export type { ChangeType, ChangeRecord, ChangeCallback, UnsubscribeFn, ChangeBatch } from './change-tracker.js';

// Module 9: Consistency Checker
export { ConsistencyChecker } from './consistency-checker.js';
export type {
  RepairStrategy,
  InvariantCheck,
  InvariantInfo,
  ConsistencyIssue,
  ConsistencyReport,
  NodeConsistencyReport,
  RepairResult,
} from './consistency-checker.js';

// Module 10: Sync Metrics
export { SyncMetrics } from './sync-metrics.js';
export type {
  SyncEvent,
  SyncMetricsReport,
  NodeSyncStats,
  LatencyData,
  SyncDashboard,
} from './sync-metrics.js';
