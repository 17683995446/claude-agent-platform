// src/index.ts - Export everything

export { InfiniteLoop } from './infinite-loop.ts';
export type { LoopMode, LoopStatus, LoopOptions } from './infinite-loop.ts';

export { RuntimeStateMachine } from './state-machine.ts';
export type {
  RuntimeState,
  RunningSubState,
  StateTransition,
  StateHistoryEntry,
  PersistedState,
} from './state-machine.ts';

export { CheckpointManager } from './checkpoint-manager.ts';
export type {
  Checkpoint,
  CheckpointInfo,
  RestoreResult,
  CheckpointType,
  CheckpointTrigger,
  CheckpointRetention,
} from './checkpoint-manager.ts';

export { PersistentTaskQueue } from './task-queue.ts';
export type {
  TaskDefinition,
  TaskInstance,
  TaskStatus,
  TaskQueueStats,
} from './task-queue.ts';

export { HeartbeatMonitor } from './heartbeat-monitor.ts';
export type {
  HeartbeatOptions,
  HeartbeatStatus,
  HeartbeatRecord,
} from './heartbeat-monitor.ts';

export { ResourceGuard } from './resource-guard.ts';
export type {
  MemoryUsage,
  ResourceThreshold,
  ResourceRequest,
  Reservation,
  ResourceReport,
} from './resource-guard.ts';

export { IdleDetector } from './idle-detector.ts';
export type { IdlePeriod, IdleCallback, ActiveCallback } from './idle-detector.ts';

export { GracefulRestarter } from './graceful-restart.ts';
export type {
  RestartResult,
  RestartPreparation,
  RestartRecord,
} from './graceful-restart.ts';

export { LifecycleManager } from './lifecycle-manager.ts';
export type {
  LifecyclePhase,
  LifecycleComponent,
  ComponentStatus,
  RuntimeConfig as LifecycleRuntimeConfig,
  PhaseTransition,
} from './lifecycle-manager.ts';

export { RuntimeConfigManager } from './runtime-config.ts';
export type {
  RuntimeConfig,
  LoopConfig,
  StateConfig,
  CheckpointConfig,
  QueueConfig,
  HeartbeatConfig,
  ResourceConfig,
  IdleConfig,
  RestartConfig,
  ValidationResult,
  ConfigChangeRecord,
} from './runtime-config.ts';
