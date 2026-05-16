// @claude-agent/ai-context
// AI Context Optimization Platform
// Export everything from all modules

// Module 1: Context Window Manager
export {
  ContextWindowManager,
  countTokens,
  PRIORITY_MAP,
} from './context-window.ts';
export type {
  MessageRole,
  ContextMessage,
  ContextSnapshot,
  CompressionResult,
} from './context-window.ts';

// Module 2: Code Understanding Engine
export {
  CodeUnderstandingEngine,
} from './code-understanding.ts';
export type {
  FileEntry,
  FunctionInfo,
  ClassInfo,
  ImportInfo,
  CodeAnalysis,
  CodeComplexity,
  ProjectAnalysis,
  SymbolRelation,
} from './code-understanding.ts';

// Module 3: Intent Recognition System
export {
  IntentRecognizer,
} from './intent-recognition.ts';
export type {
  IntentCategory,
  Priority,
  DetectedLanguage,
  Entity,
  IntentResult,
} from './intent-recognition.ts';

// Module 4: Knowledge Synthesis Engine
export {
  KnowledgeSynthesizer,
} from './knowledge-synthesis.ts';
export type {
  SourceType,
  KnowledgeSource,
  KnowledgeFact,
  KnowledgeNode,
  SynthesisResult,
} from './knowledge-synthesis.ts';

// Module 5: Conversation Memory System
export {
  ConversationMemory,
} from './conversation-memory.ts';
export type {
  ConversationMessage,
  RecallOptions,
  MemoryResult,
  LongTermMemory,
  EpisodicMemory,
  SemanticMemory,
  ConversationSummary,
} from './conversation-memory.ts';

// Module 6: Task Planner
export {
  TaskPlanner,
} from './task-planner.ts';
export type {
  Task,
  TaskPlan,
  PlanningContext,
  EffortEstimate,
  Feedback,
} from './task-planner.ts';

// Module 7: Code Generation Assistant
export {
  CodeGenerationAssistant,
} from './code-generation.ts';
export type {
  GenerationParams,
  GeneratedCode,
  CodeContext,
  CompletionSuggestion,
  TransformResult,
} from './code-generation.ts';

// Module 8: Error Diagnosis System
export {
  ErrorDiagnosisEngine,
} from './error-diagnosis.ts';
export type {
  DiagnosisContext,
  DiagnosisResult,
  StackFrame,
  FixSuggestion,
  ErrorCategory,
} from './error-diagnosis.ts';

// Module 9: Project Insights Engine
export {
  ProjectInsightsEngine,
} from './project-insights.ts';
export type {
  ProjectData,
  ProjectInsight,
  ArchitecturePattern,
  QualityMetrics,
  DependencyAnalysis,
  TeamPatterns,
  TrendAnalysis,
  Recommendation,
  InsightDiff,
} from './project-insights.ts';

// Module 10: Adaptive Learning System
export {
  AdaptiveLearningSystem,
} from './adaptive-learning.ts';
export type {
  UserInteraction,
  PredictionResult,
  ApproachSuggestion,
  LearnedPattern,
} from './adaptive-learning.ts';
