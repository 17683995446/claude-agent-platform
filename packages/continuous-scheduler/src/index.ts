// @claude-agent/continuous-scheduler
// Continuous Scheduling Optimization Package

// Module 1: Dynamic Priority Scheduler
export {
  DynamicPriorityScheduler,
  type ContinuousTask,
  type ResourceRequirements,
  type PriorityFactor,
  type TaskSnapshot,
  type RebalanceResult,
  type PriorityChange,
  type DynamicPriorityOptions,
} from './dynamic-priority.ts';

// Module 2: Adaptive Executor
export {
  AdaptiveExecutor,
  type ExecutionResult,
  type ResourceUsage,
  type BatchExecutionResult,
  type AdaptationRecord,
  type OptimalSettings,
  type AdaptiveExecutorOptions,
} from './adaptive-executor.ts';

// Module 3: Workload Predictor
export {
  WorkloadPredictor,
  type WorkloadMetrics,
  type WorkloadPrediction,
  type PeakPrediction,
  type ResourcePrediction,
  type WorkloadPattern,
} from './workload-predictor.ts';

// Module 4: Elastic Scaler
export {
  ElasticScaler,
  type ScaleStrategy,
  type ScalingDecision,
  type ScaleResult,
  type ScalingRecord,
  type CapacityInfo,
  type ElasticScalerOptions,
} from './elastic-scaler.ts';

// Module 5: Backpressure Handler
export {
  BackpressureHandler,
  type BackpressureLevel,
  type BackpressureStrategy,
  type BackpressureResult,
  type BackpressureConfig,
} from './backpressure-handler.ts';

// Module 6: Task Recycling Manager
export {
  TaskRecyclingManager,
  type RecycledResources,
  type CacheStats,
  type EvictionPolicy,
  type TaskRecyclingOptions,
} from './task-recycling.ts';

// Module 7: Long Running Task Manager
export {
  LongRunningTaskManager,
  type LongTask,
  type Milestone,
  type LongTaskState,
  type LongTaskStatus,
  type LongRunningTaskOptions,
} from './long-running-task.ts';

// Module 8: Schedule Optimizer
export {
  ScheduleOptimizer,
  type OptimizationStrategy,
  type ScheduleConstraints,
  type OptimizedSchedule,
  type SimulationResult,
  type Bottleneck,
  type ScheduleOptimizerOptions,
} from './schedule-optimizer.ts';

// Module 9: Periodic Job Manager
export {
  PeriodicJobManager,
  type JobHandler,
  type MissedExecutionPolicy,
  type JobOptions,
  type JobInfo,
  type JobResult,
  type JobStatus,
  type JobExecution,
} from './periodic-jobs.ts';

// Module 10: Scheduling Analytics
export {
  SchedulingAnalytics,
  type SchedulingEventType,
  type SchedulingEvent,
  type ThroughputData,
  type LatencyData,
  type UtilizationData,
  type SLAData,
  type EfficiencyReport,
  type SchedulingDashboard,
} from './scheduling-analytics.ts';
