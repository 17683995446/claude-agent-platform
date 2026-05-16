// src/index.ts - Export everything

export { RemoteControlServer } from './remote-control.ts';
export type {
  ControlCommand,
  ControlCommandName,
  CommandResult,
  CommandHandler,
  AuditLogEntry,
} from './remote-control.ts';

export { RuntimeDashboard } from './runtime-dashboard.ts';
export type {
  OverviewData,
  TaskSummary,
  ResourceUsage,
  HealthStatus,
  RuntimeEvent,
  DashboardData,
  MetricProvider,
} from './runtime-dashboard.ts';

export { RealtimeMonitor } from './realtime-monitor.ts';
export type {
  MetricSnapshot,
  MetricPoint,
  AlertCondition,
  AlertAction,
  AlertEntry,
} from './realtime-monitor.ts';

export { OpsCommandRegistry } from './ops-commands.ts';
export type {
  PermissionLevel,
  OpsCommand,
  OpsResult,
  CommandHelp,
  CommandInfo,
  CommandHistoryEntry,
} from './ops-commands.ts';

export { LogAggregator } from './log-aggregator.ts';
export type {
  LogLevel,
  LogEntry,
  LogQuery,
  LogStats,
} from './log-aggregator.ts';

export { DeploymentManager } from './deployment-manager.ts';
export type {
  DeploymentPhase,
  DeploymentConfig,
  DeploymentResult,
  RollbackResult,
  DeploymentStatus,
  DeploymentInfo,
  DeploymentRecord,
} from './deployment-manager.ts';

export { ConfigHotSwap, DEFAULT_CONFIG } from './config-hotswap.ts';
export type {
  RuntimeConfig,
  HotSwapResult,
  ValidationResult,
  ConfigChangeCallback,
  UnsubscribeFn,
  ConfigChangeRecord,
} from './config-hotswap.ts';

export { ThreadPoolManager } from './thread-pool.ts';
export type {
  PoolTask,
  WorkerStats,
  PoolStats,
} from './thread-pool.ts';

export { MemoryManager } from './memory-manager.ts';
export type {
  MemoryUsage,
  MemoryTrend,
  GCSuccess,
  LeakReport,
  LargeObject,
} from './memory-manager.ts';

export { UptimeTracker } from './uptime-tracker.ts';
export type {
  DowntimeRecord,
  SLAReport,
  UptimeMilestone,
} from './uptime-tracker.ts';
