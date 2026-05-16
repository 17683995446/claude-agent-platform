// ============================================================================
// @claude-agent/orchestrator - Natural Language Task Interface + Smart Orchestration
// ============================================================================

// Types
export type {
  // NL Task Parser
  TaskIntent,
  EntityType,
  ExtractedEntity,
  ParsedTask,
  // Task Decomposer
  SubTask,
  TaskGraph,
  TaskEdge,
  DecompositionResult,
  // Smart Orchestrator
  ExecutionPlan,
  ExecutionPhase,
  OrchestratorState,
  ReorderDecision,
  // Context Manager
  ContextEntry,
  ContextWindowConfig,
  // Feedback Loop
  FeedbackResult,
  RetryConfig,
  // Task Templates
  TaskTemplate,
  TemplateParameter,
  TemplateStep,
  // Execution History
  ExecutionRecord,
  ExecutionStats,
  // Smart Recommendations
  Recommendation,
  // Session Manager
  Session,
  SessionMessage,
  // Permission Delegation
  PermissionLevel,
  PermissionRule,
  AuditLogEntry,
  SandboxConfig,
  // Progress Tracker
  ProgressState,
  Milestone,
  ProgressNotification,
} from './types.js';

// Modules
export { NLTaskParser } from './nl-task-parser.js';
export { TaskDecomposer } from './task-decomposer.js';
export { SmartOrchestrator } from './smart-orchestrator.js';
export { ContextManager } from './context-manager.js';
export { FeedbackLoop } from './feedback-loop.js';
export { TaskTemplates } from './task-templates.js';
export { ExecutionHistory } from './execution-history.js';
export { SmartRecommendations } from './smart-recommendations.js';
export { SessionManager } from './session-manager.js';
export { PermissionDelegation } from './permission-delegation.js';
export { ProgressTracker } from './progress-tracker.js';
