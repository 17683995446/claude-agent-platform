// src/index.ts - Export everything

// Module 1: Workflow Engine
export {
  WorkflowEngine,
  type WorkflowStatus,
  type StepType,
  type RetryPolicy,
  type WorkflowStep,
  type ErrorHandlingConfig,
  type WorkflowDefinition,
  type WorkflowHistoryEntry,
  type WorkflowInstance,
  type WorkflowResult,
} from './workflow-engine.js';

// Module 2: DAG Executor
export {
  DAGExecutor,
  CycleDetectedError,
  type DAGNode,
  type DAGNodeTiming,
  type DAGResult,
} from './dag-executor.js';

// Module 3: Condition Evaluator
export {
  ConditionEvaluator,
  ConditionParseError,
} from './condition-evaluator.js';

// Module 4: Parallel Executor
export {
  ParallelExecutor,
  type ParallelTask,
  type ErrorStrategy as ParallelErrorStrategy,
  type ResultAggregation,
  type ParallelOptions,
  type TaskResult,
  type ParallelProgress,
  type ParallelResult,
} from './parallel-executor.js';

// Module 5: Transform Engine
export {
  TransformEngine,
  type TransformStep,
} from './transform-engine.js';

// Module 6: Error Handler
export {
  WorkflowErrorHandler,
  type ErrorStrategy,
  type RetryPolicy as ErrorRetryPolicy,
  type ErrorContext,
  type ErrorResolution,
  type DeadLetterItem,
  type ErrorNotification,
} from './error-handler.js';

// Module 7: Workflow Persistence
export {
  InMemoryWorkflowStore,
  FileWorkflowStore,
  type InstanceFilter,
  type Checkpoint,
  type WorkflowStore,
} from './workflow-persistence.js';

// Module 8: Workflow Events
export {
  WorkflowEventEmitter,
  type WorkflowEventType,
  type WorkflowEvent,
  type EventMiddleware,
  type EventHandler,
} from './workflow-events.js';

// Module 9: Workflow Monitor
export {
  WorkflowMonitor,
  type StepMetrics,
  type WorkflowStats,
  type AlertRule,
  type Alert,
  type WorkflowDashboard,
  type MonitorRecord,
} from './workflow-monitor.js';

// Module 10: Workflow Templates
export {
  WorkflowTemplateLibrary,
  type TemplateParameter,
  type WorkflowTemplate,
} from './workflow-templates.js';
