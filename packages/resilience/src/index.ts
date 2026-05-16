// src/index.ts - Export everything

export {
  CircuitBreaker,
  CircuitBreakerOpenError,
  type CircuitState,
  type CircuitBreakerConfig,
  type CircuitBreakerMetrics,
  type CircuitBreakerEvents,
} from './circuit-breaker.ts';

export {
  Bulkhead,
  BulkheadFullError,
  BulkheadQueueTimeoutError,
  type BulkheadConfig,
} from './bulkhead.ts';

export {
  RetryWithBackoff,
  type BackoffStrategy,
  type RetryConfig,
  type RetryEvent,
} from './retry-with-backoff.ts';

export {
  TimeoutGuard,
  TimeoutTimer,
  TimeoutError,
  type TimeoutStrategy,
  type TimeoutConfig,
} from './timeout-guard.ts';

export {
  HealthChecker,
  type HealthLevel,
  type HealthCheckType,
  type HealthCheckConfig,
  type HealthCheckFn,
  type HealthCheckResult,
  type ComponentHealth,
  type HealthReport,
  type DependencyGroup,
} from './health-checker.ts';

export {
  FallbackProvider,
  type FallbackStrategy,
  type Fallback,
  type FallbackMetrics,
} from './fallback-provider.ts';

export {
  ChaosEngine,
  type FaultType,
  type FaultConfig,
  type ActiveFault,
  type ChaosEngineConfig,
} from './chaos-engine.ts';

export {
  StateRecoveryManager,
  type RecoveryStrategy,
  type SnapshotStorage,
  type Snapshot,
  type SnapshotInfo,
  type RecoveryConfig,
  type RecoveryEvent,
} from './state-recovery.ts';

export {
  GracefulShutdownManager,
  type ShutdownPhase,
  type ShutdownHandler,
  type ShutdownConfig,
  type ShutdownStatus,
} from './graceful-shutdown.ts';

export {
  ResilienceObservability,
  type CircuitBreakerSnapshot,
  type BulkheadSnapshot,
  type RetrySnapshot,
  type HealthSnapshot,
  type Alert,
  type AlertRule,
  type ResilienceDashboard,
  type ObservabilityConfig,
} from './observability.ts';
