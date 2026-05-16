// ============================================================================
// @claude-agent/orchestrator - Orchestrator Types
// ============================================================================

// ---- NL Task Parser Types ----

/** Task intent categories */
export type TaskIntent =
  | 'analyze'
  | 'test'
  | 'deploy'
  | 'fix'
  | 'generate'
  | 'refactor'
  | 'document'
  | 'optimize'
  | 'migrate'
  | 'review'
  | 'unknown';

/** Parsed entity types */
export type EntityType = 'filePath' | 'moduleName' | 'parameter' | 'flag' | 'pattern';

/** Extracted entity from natural language */
export interface ExtractedEntity {
  type: EntityType;
  value: string;
  confidence: number;
  startIndex: number;
  endIndex: number;
}

/** Result of natural language parsing */
export interface ParsedTask {
  /** Original input text */
  raw: string;
  /** Detected intent */
  intent: TaskIntent;
  /** Confidence score (0-1) */
  confidence: number;
  /** Extracted entities */
  entities: ExtractedEntity[];
  /** Detected language */
  language: 'zh' | 'en' | 'mixed';
  /** Structured task description */
  description: string;
  /** Priority hint from input */
  priority: 'low' | 'medium' | 'high' | 'critical';
  /** Tags extracted from input */
  tags: string[];
}

// ---- Task Decomposer Types ----

/** A sub-task in the decomposition */
export interface SubTask {
  id: string;
  name: string;
  description: string;
  intent: TaskIntent;
  dependencies: string[];
  priority: number;
  estimatedDuration: number;
  entities: ExtractedEntity[];
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
}

/** Dependency graph for tasks */
export interface TaskGraph {
  nodes: SubTask[];
  edges: TaskEdge[];
  /** Critical path through the DAG */
  criticalPath: string[];
  /** Tasks that can run in parallel */
  parallelGroups: string[][];
}

/** An edge in the task dependency graph */
export interface TaskEdge {
  from: string;
  to: string;
  type: 'hard' | 'soft';
}

/** Decomposition result */
export interface DecompositionResult {
  rootTask: ParsedTask;
  graph: TaskGraph;
  totalEstimatedDuration: number;
  decompositionStrategy: 'sequential' | 'parallel' | 'mixed';
}

// ---- Smart Orchestrator Types ----

/** Execution plan produced by the orchestrator */
export interface ExecutionPlan {
  id: string;
  phases: ExecutionPhase[];
  totalSteps: number;
  estimatedDuration: number;
  createdAt: Date;
}

/** A phase in the execution plan */
export interface ExecutionPhase {
  id: string;
  name: string;
  tasks: string[];
  parallel: boolean;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: Date;
  completedAt?: Date;
}

/** Orchestrator state */
export type OrchestratorState = 'idle' | 'planning' | 'executing' | 'paused' | 'completed' | 'failed';

/** Dynamic reordering decision */
export interface ReorderDecision {
  reason: string;
  movedTasks: { taskId: string; fromPhase: string; toPhase: string }[];
  timestamp: Date;
}

// ---- Context Manager Types ----

/** Context entry */
export interface ContextEntry {
  id: string;
  type: 'file' | 'module' | 'output' | 'config' | 'user' | 'system';
  key: string;
  value: unknown;
  tokenCount: number;
  lastAccessedAt: Date;
  createdAt: Date;
  priority: number;
}

/** Context window configuration */
export interface ContextWindowConfig {
  maxTokens: number;
  reservedTokens: number;
  compressionThreshold: number;
  strategy: 'lru' | 'priority' | 'fifo';
}

// ---- Feedback Loop Types ----

/** Feedback result */
export interface FeedbackResult {
  taskId: string;
  success: boolean;
  score: number;
  message: string;
  shouldRetry: boolean;
  retryCount: number;
  maxRetries: number;
  nextRetryDelay: number;
  userFeedback?: string;
}

/** Retry configuration */
export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
}

// ---- Task Templates Types ----

/** Task template definition */
export interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  parameters: TemplateParameter[];
  steps: TemplateStep[];
  tags: string[];
  isBuiltIn: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Template parameter */
export interface TemplateParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'path' | 'enum';
  required: boolean;
  defaultValue?: unknown;
  description: string;
  enumValues?: string[];
}

/** Template step */
export interface TemplateStep {
  name: string;
  description: string;
  intent: TaskIntent;
  parameterMapping: Record<string, string>;
  condition?: string;
}

// ---- Execution History Types ----

/** Execution record */
export interface ExecutionRecord {
  id: string;
  sessionId: string;
  taskDescription: string;
  intent: TaskIntent;
  status: 'success' | 'failed' | 'partial' | 'cancelled';
  startTime: Date;
  endTime?: Date;
  duration?: number;
  subTaskCount: number;
  completedSubTasks: number;
  error?: string;
  metadata: Record<string, unknown>;
}

/** Execution statistics */
export interface ExecutionStats {
  totalExecutions: number;
  successRate: number;
  averageDuration: number;
  totalDuration: number;
  intentBreakdown: Record<TaskIntent, number>;
  dailyBreakdown: Record<string, number>;
  mostCommonTasks: { description: string; count: number }[];
}

// ---- Smart Recommendations Types ----

/** A recommendation */
export interface Recommendation {
  id: string;
  type: 'task' | 'optimization' | 'schedule' | 'proactive';
  title: string;
  description: string;
  confidence: number;
  source: 'project_analysis' | 'history' | 'pattern' | 'best_practice';
  suggestedAction: string;
  priority: 'low' | 'medium' | 'high';
  createdAt: Date;
}

// ---- Session Manager Types ----

/** Session state */
export interface Session {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  status: 'active' | 'paused' | 'completed' | 'archived';
  messages: SessionMessage[];
  context: ContextEntry[];
  executionIds: string[];
  metadata: Record<string, unknown>;
}

/** Session message */
export interface SessionMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

// ---- Permission Delegation Types ----

/** Permission level */
export type PermissionLevel = 'read' | 'write' | 'execute' | 'admin';

/** Permission rule */
export interface PermissionRule {
  id: string;
  taskId: string;
  toolName: string;
  level: PermissionLevel;
  grantedAt: Date;
  expiresAt?: Date;
  grantedBy: 'system' | 'user';
}

/** Audit log entry */
export interface AuditLogEntry {
  id: string;
  timestamp: Date;
  taskId: string;
  action: string;
  toolName: string;
  permissionLevel: PermissionLevel;
  granted: boolean;
  reason?: string;
}

/** Sandbox configuration */
export interface SandboxConfig {
  enabled: boolean;
  allowedTools: string[];
  deniedTools: string[];
  maxExecutionTime: number;
  maxMemoryMB: number;
  networkAccess: boolean;
  fileSystemAccess: boolean;
}

// ---- Progress Tracker Types ----

/** Progress state */
export interface ProgressState {
  taskId: string;
  totalSteps: number;
  completedSteps: number;
  percentage: number;
  currentStep: string;
  eta: number;
  milestones: Milestone[];
  status: 'in_progress' | 'completed' | 'failed' | 'paused';
  startedAt: Date;
  updatedAt: Date;
}

/** Milestone marker */
export interface Milestone {
  id: string;
  name: string;
  description: string;
  targetStep: number;
  achieved: boolean;
  achievedAt?: Date;
}

/** Progress notification */
export interface ProgressNotification {
  taskId: string;
  type: 'update' | 'milestone' | 'complete' | 'eta_change' | 'error';
  message: string;
  progress: number;
  eta?: number;
  milestone?: string;
}
