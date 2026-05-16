// src/index.ts - Self-Healing Package Entry Point

export { AnomalyDetector } from './anomaly-detector.js';
export type {
  AnomalySeverity,
  MetricOptions,
  BaselineStats,
  AnomalyReport,
} from './anomaly-detector.js';

export { DiagnosisEngine } from './diagnosis-engine.js';
export type {
  Symptom,
  DiagnosisRule,
  PossibleCause,
  Action,
  DiagnosisResult,
} from './diagnosis-engine.js';

export { RecoveryStrategyRegistry } from './recovery-strategies.js';
export type {
  RecoveryStrategy,
  RecoveryContext,
  RecoveryResult,
  EffectivenessStats,
} from './recovery-strategies.js';

export { AutoRepairEngine } from './auto-repair.js';
export type {
  AutonomyLevel,
  Issue,
  RepairResult,
  RepairRecord,
  RepairStats,
  RepairConfig,
} from './auto-repair.js';

export { FailoverManager } from './failover-manager.js';
export type {
  ComponentHandler,
  FailoverMode,
  FailoverStatus,
  FailoverResult,
  FailoverRecord,
} from './failover-manager.js';

export { StateRollbackManager } from './state-rollback.js';
export type {
  Snapshot,
  SnapshotInfo,
  RollbackResult,
  VerificationResult,
  VerificationCheck,
} from './state-rollback.js';

export { EnhancedCircuitBreaker } from './circuit-breaker-enhanced.js';
export type {
  CircuitState,
  CircuitBreakerConfig,
  CircuitDiagnostics,
} from './circuit-breaker-enhanced.js';

export { HealthProbe } from './health-probe.js';
export type {
  ProbeType,
  HealthStatus,
  HealthProbeFn,
  HealthProbeResult,
  HealthReport,
  ComponentHealth,
  ProbeResult,
} from './health-probe.js';

export { RecoveryLearningSystem } from './recovery-learning.js';
export type {
  StrategySuggestion,
  LearnedPattern,
  ModelStats,
} from './recovery-learning.js';

export { IncidentManager } from './incident-manager.js';
export type {
  IncidentSeverity,
  IncidentStatus,
  Incident,
  IncidentUpdate,
  TimelineEvent,
  PostMortem,
  SLAConfig,
} from './incident-manager.js';
