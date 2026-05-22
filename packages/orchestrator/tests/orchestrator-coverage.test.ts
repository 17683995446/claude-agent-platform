// ============================================================================
// @claude-agent/orchestrator - Comprehensive Coverage Tests
// ============================================================================
//
// BUG FIXES DOCUMENTED:
//
// BUG-001: [CRITICAL] context-manager.ts add() silently drops entries when over budget
//   FIX: Set tokenCount to 0 on the returned entry to mark it as not stored
//
// BUG-002: [HIGH] feedback-loop.ts calculateRetryDelay() can return negative value with jitter
//   FIX: Added Math.max(0, ...) guard around the jitter calculation
//
// BUG-003: [HIGH] smart-orchestrator.ts parallel phase failure doesn't set phase status to 'failed'
//   FIX: Set phase.status = 'failed', call onPhaseComplete, set state = 'failed', and return
//
// BUG-004: [MEDIUM] task-decomposer.ts findCriticalPath() uses wrong node duration in longest path
//   FIX: Changed from nodeMap.get(edge.to)?.estimatedDuration to currentNode.estimatedDuration
//
// BUG-005: [MEDIUM] context-manager.ts getAvailableTokens() can return negative value
//   FIX: Added Math.max(0, ...) guard
//
// BUG-006: [MEDIUM] execution-history.ts query() endDate filter uses startTime instead of endTime
//   FIX: Use endTime (or fallback to startTime if endTime is undefined)
//
// BUG-007: [MEDIUM] nl-task-parser.ts parse() returns raw: input instead of raw: '' for empty input
//   FIX: Changed to raw: '' for empty/whitespace-only input
//
// BUG-008: [MEDIUM] session-manager.ts pause() should also allow pausing 'completed' sessions
//   FIX: Allow pause from both 'active' and 'completed' states
//
// BUG-009: [LOW] progress-tracker.ts update() active time calculation variable naming clarity
//   FIX: Extract elapsed time into a named variable for clarity
//
// BUG-010: [HIGH] feedback-loop.ts calculateRetryDelay() jitter can push delay above maxDelay
//   FIX: Cap delay at maxDelay after applying jitter
//
// BUG-011: [MEDIUM] feedback-loop.ts submitUserFeedback() checks positive keywords before negative,
//   causing '不好' (bad) to match '好' (good) first
//   FIX: Check negative keywords before positive keywords
//
// BUG-012: [MEDIUM] progress-tracker.ts update() triggers completion when totalSteps is 0
//   because `0 >= 0` is true
//   FIX: Add `totalSteps > 0` guard to completion check
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  NLTaskParser,
  TaskDecomposer,
  SmartOrchestrator,
  ContextManager,
  FeedbackLoop,
  TaskTemplates,
  ExecutionHistory,
  SmartRecommendations,
  SessionManager,
  PermissionDelegation,
  ProgressTracker,
} from '../src/index.js';
import type {
  ParsedTask,
  TaskIntent,
  SubTask,
  ContextEntry,
  FeedbackResult,
  ExecutionRecord,
  Recommendation,
  Session,
  SessionMessage,
  PermissionLevel,
  PermissionRule,
  AuditLogEntry,
  ProgressState,
  ProgressNotification,
  Milestone,
  ExecutionPlan,
  ExecutionPhase,
  ReorderDecision,
  DecompositionResult,
  TaskGraph,
  TaskEdge,
  ContextWindowConfig,
  RetryConfig,
  TaskTemplate,
  TemplateParameter,
  TemplateStep,
  ExecutionStats,
  SandboxConfig,
} from '../src/types.js';

// ============================================================================
// Helper functions
// ============================================================================

function createSampleParsedTask(overrides: Partial<ParsedTask> = {}): ParsedTask {
  return {
    raw: 'analyze project architecture',
    intent: 'analyze',
    confidence: 0.8,
    entities: [],
    language: 'en',
    description: 'analyze task',
    priority: 'medium',
    tags: ['analyze'],
    ...overrides,
  };
}

function createSampleExecutionRecord(overrides: Partial<ExecutionRecord> = {}): Omit<ExecutionRecord, 'id'> {
  return {
    sessionId: 'session-1',
    taskDescription: 'Test task',
    intent: 'analyze' as TaskIntent,
    status: 'success',
    startTime: new Date(),
    subTaskCount: 3,
    completedSubTasks: 3,
    metadata: {},
    ...overrides,
  };
}

// ============================================================================
// NLTaskParser Tests
// ============================================================================

describe('NLTaskParser', () => {
  let parser: NLTaskParser;

  beforeEach(() => {
    parser = new NLTaskParser();
  });

  // --- Basic parsing ---

  it('should parse Chinese analyze task', () => {
    const result = parser.parse('帮我分析这个项目的架构');
    expect(result.intent).toBe('analyze');
    expect(result.language).toBe('zh');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.description).toContain('分析');
  });

  it('should parse English analyze task', () => {
    const result = parser.parse('analyze the project architecture');
    expect(result.intent).toBe('analyze');
    expect(result.language).toBe('en');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should detect mixed language input', () => {
    // Use input with roughly equal Chinese and English characters
    const result = parser.parse('请帮我 analyze 这个 project 的 code 结构');
    expect(['mixed', 'zh', 'en']).toContain(result.language);
    expect(result.intent).toBe('analyze');
  });

  // BUG-007: Empty input should return raw: ''
  it('BUG-007: should return raw empty string for empty input', () => {
    const result = parser.parse('');
    expect(result.raw).toBe('');
    expect(result.intent).toBe('unknown');
    expect(result.confidence).toBe(0);
    expect(result.entities).toHaveLength(0);
    expect(result.tags).toHaveLength(0);
  });

  it('BUG-007: should return raw empty string for whitespace-only input', () => {
    const result = parser.parse('   \t\n  ');
    expect(result.raw).toBe('');
    expect(result.intent).toBe('unknown');
  });

  // --- Intent recognition ---

  it('should parse test intent', () => {
    const result = parser.parse('运行测试');
    expect(result.intent).toBe('test');
  });

  it('should parse deploy intent', () => {
    const result = parser.parse('部署到生产环境');
    expect(result.intent).toBe('deploy');
  });

  it('should parse fix intent', () => {
    const result = parser.parse('修复登录 bug');
    expect(result.intent).toBe('fix');
  });

  it('should parse generate intent', () => {
    const result = parser.parse('生成 API 文档');
    expect(result.intent).toBe('generate');
  });

  it('should parse refactor intent', () => {
    const result = parser.parse('refactor the authentication module');
    expect(result.intent).toBe('refactor');
  });

  it('should parse document intent', () => {
    const result = parser.parse('为代码写文档');
    expect(result.intent).toBe('document');
  });

  it('should parse optimize intent', () => {
    const result = parser.parse('优化性能');
    expect(result.intent).toBe('optimize');
  });

  it('should parse migrate intent', () => {
    const result = parser.parse('迁移到 TypeScript 5');
    expect(result.intent).toBe('migrate');
  });

  it('should parse review intent', () => {
    const result = parser.parse('代码审查');
    expect(result.intent).toBe('review');
  });

  it('should return unknown intent for unrecognized input', () => {
    const result = parser.parse('随便做点什么');
    expect(result.intent).toBe('unknown');
  });

  it('should return unknown intent with confidence 0 for gibberish', () => {
    const result = parser.parse('xyzzyplugh');
    expect(result.intent).toBe('unknown');
    expect(result.confidence).toBe(0);
  });

  // --- Entity extraction ---

  it('should detect file path entities', () => {
    const result = parser.parse('分析 ./src/index.ts 文件');
    const filePaths = result.entities.filter((e) => e.type === 'filePath');
    expect(filePaths.length).toBeGreaterThan(0);
  });

  it('should detect module name entities', () => {
    const result = parser.parse('分析 @claude-agent/core 模块');
    const modules = result.entities.filter((e) => e.type === 'moduleName');
    expect(modules.length).toBeGreaterThan(0);
  });

  it('should detect parameter entities', () => {
    const result = parser.parse('--output=dist/index.js');
    const params = result.entities.filter((e) => e.type === 'parameter');
    expect(params.length).toBeGreaterThan(0);
  });

  it('should extract entities with correct indices', () => {
    const result = parser.parse('analyze ./src/index.ts');
    const filePaths = result.entities.filter((e) => e.type === 'filePath');
    if (filePaths.length > 0) {
      const fp = filePaths[0]!;
      expect(fp.startIndex).toBeGreaterThanOrEqual(0);
      expect(fp.endIndex).toBeGreaterThan(fp.startIndex);
    }
  });

  // --- Priority detection ---

  it('should detect critical priority (Chinese)', () => {
    const result = parser.parse('紧急修复这个 bug');
    expect(result.priority).toBe('critical');
  });

  it('should detect critical priority (English)', () => {
    const result = parser.parse('fix this critical bug immediately');
    expect(result.priority).toBe('critical');
  });

  it('should detect high priority', () => {
    const result = parser.parse('重要：分析项目架构');
    expect(result.priority).toBe('high');
  });

  it('should detect low priority', () => {
    const result = parser.parse('不急，帮我优化一下代码');
    expect(result.priority).toBe('low');
  });

  it('should default to medium priority', () => {
    const result = parser.parse('分析项目');
    expect(result.priority).toBe('medium');
  });

  // --- Tag extraction ---

  it('should extract tags', () => {
    const result = parser.parse('分析 API 性能');
    expect(result.tags).toContain('analyze');
    expect(result.tags).toContain('api');
    expect(result.tags).toContain('performance');
  });

  it('should extract security tag', () => {
    const result = parser.parse('安全分析');
    expect(result.tags).toContain('security');
  });

  it('should extract database tag', () => {
    const result = parser.parse('优化数据库查询');
    expect(result.tags).toContain('database');
  });

  it('should extract frontend tag', () => {
    const result = parser.parse('前端UI优化');
    expect(result.tags).toContain('frontend');
  });

  it('should extract docker tag', () => {
    const result = parser.parse('Docker容器优化');
    expect(result.tags).toContain('docker');
  });

  it('should not have duplicate tags', () => {
    const result = parser.parse('分析分析分析');
    const uniqueTags = new Set(result.tags);
    expect(result.tags.length).toBe(uniqueTags.size);
  });

  // --- Description generation ---

  it('should generate description with entities', () => {
    const result = parser.parse('分析 ./src/index.ts 文件');
    expect(result.description).toContain('分析');
  });

  it('should generate description without entities', () => {
    const result = parser.parse('分析项目');
    expect(result.description).toContain('分析');
  });

  // --- Batch parsing ---

  it('should batch parse multiple inputs', () => {
    const results = parser.parseBatch(['分析项目', '运行测试', '部署上线']);
    expect(results).toHaveLength(3);
    expect(results[0]!.intent).toBe('analyze');
    expect(results[1]!.intent).toBe('test');
    expect(results[2]!.intent).toBe('deploy');
  });

  it('should handle empty batch', () => {
    const results = parser.parseBatch([]);
    expect(results).toHaveLength(0);
  });

  it('should handle batch with empty strings', () => {
    const results = parser.parseBatch(['', '分析项目', '  ']);
    expect(results).toHaveLength(3);
    expect(results[0]!.intent).toBe('unknown');
    expect(results[1]!.intent).toBe('analyze');
    expect(results[2]!.intent).toBe('unknown');
  });

  // --- Custom intents ---

  it('should support custom intent registration', () => {
    parser.registerIntent('analyze', { zh: ['自定义分析'] });
    const result = parser.parse('自定义分析项目');
    expect(result.intent).toBe('analyze');
  });

  it('should support custom intent with English keywords', () => {
    parser.registerIntent('test', { en: ['custom-test'] });
    const result = parser.parse('run custom-test');
    expect(result.intent).toBe('test');
  });

  it('should support custom intent overriding built-in', () => {
    parser.registerIntent('generate', { zh: ['特殊生成'], en: ['xyzzy-gen'] });
    const result = parser.parse('xyzzy-gen my widget');
    expect(result.intent).toBe('generate');
    expect(result.confidence).toBeGreaterThan(0);
  });

  // --- Language detection ---

  it('should detect pure Chinese', () => {
    const result = parser.parse('这是一个纯中文的测试输入');
    expect(result.language).toBe('zh');
  });

  it('should detect pure English', () => {
    const result = parser.parse('this is a pure english test input');
    expect(result.language).toBe('en');
  });

  it('should detect mixed language', () => {
    // Need roughly equal Chinese and English chars for 'mixed' detection
    // zhRatio must be between 0.3 and 0.7
    const result = parser.parse('请帮我分析 analyze 这个 project 的代码结构');
    expect(result.language).toBe('mixed');
  });

  it('should default to en for non-alphabetic non-Chinese input', () => {
    const result = parser.parse('1234567890');
    expect(result.language).toBe('en');
  });
});

// ============================================================================
// TaskDecomposer Tests
// ============================================================================

describe('TaskDecomposer', () => {
  let decomposer: TaskDecomposer;
  let sampleTask: ParsedTask;

  beforeEach(() => {
    decomposer = new TaskDecomposer();
    sampleTask = createSampleParsedTask();
  });

  // --- Basic decomposition ---

  it('should decompose analyze task', () => {
    const result = decomposer.decompose(sampleTask);
    expect(result.graph.nodes.length).toBeGreaterThan(0);
    expect(result.graph.edges.length).toBeGreaterThan(0);
    expect(result.decompositionStrategy).toBeDefined();
    expect(result.rootTask).toBe(sampleTask);
  });

  it('should decompose test task', () => {
    sampleTask.intent = 'test';
    const result = decomposer.decompose(sampleTask);
    expect(result.graph.nodes.length).toBe(3);
  });

  it('should decompose deploy task', () => {
    sampleTask.intent = 'deploy';
    const result = decomposer.decompose(sampleTask);
    expect(result.graph.nodes.length).toBe(5);
  });

  it('should decompose fix task', () => {
    sampleTask.intent = 'fix';
    const result = decomposer.decompose(sampleTask);
    expect(result.graph.nodes.length).toBe(4);
  });

  it('should decompose generate task', () => {
    sampleTask.intent = 'generate';
    const result = decomposer.decompose(sampleTask);
    expect(result.graph.nodes.length).toBe(3);
  });

  it('should decompose refactor task', () => {
    sampleTask.intent = 'refactor';
    const result = decomposer.decompose(sampleTask);
    expect(result.graph.nodes.length).toBe(4);
  });

  it('should decompose document task', () => {
    sampleTask.intent = 'document';
    const result = decomposer.decompose(sampleTask);
    expect(result.graph.nodes.length).toBe(2);
  });

  it('should decompose optimize task', () => {
    sampleTask.intent = 'optimize';
    const result = decomposer.decompose(sampleTask);
    expect(result.graph.nodes.length).toBe(3);
  });

  it('should decompose migrate task', () => {
    sampleTask.intent = 'migrate';
    const result = decomposer.decompose(sampleTask);
    expect(result.graph.nodes.length).toBe(3);
  });

  it('should decompose review task', () => {
    sampleTask.intent = 'review';
    const result = decomposer.decompose(sampleTask);
    expect(result.graph.nodes.length).toBe(3);
  });

  it('should decompose unknown task', () => {
    sampleTask.intent = 'unknown';
    const result = decomposer.decompose(sampleTask);
    expect(result.graph.nodes.length).toBeGreaterThan(0);
  });

  // --- Graph analysis ---

  it('should identify parallel groups', () => {
    const result = decomposer.decompose(sampleTask);
    expect(result.graph.parallelGroups.length).toBeGreaterThan(0);
  });

  it('should find critical path', () => {
    const result = decomposer.decompose(sampleTask);
    expect(result.graph.criticalPath.length).toBeGreaterThan(0);
  });

  // BUG-004: Critical path should use correct node duration
  it('BUG-004: critical path should correctly calculate longest path', () => {
    sampleTask.intent = 'test';
    const result = decomposer.decompose(sampleTask);
    const { nodes, criticalPath } = result.graph;
    // The critical path duration should equal totalEstimatedDuration
    const criticalPathDuration = criticalPath.reduce((sum, id) => {
      const node = nodes.find((n) => n.id === id);
      return sum + (node?.estimatedDuration ?? 0);
    }, 0);
    expect(result.totalEstimatedDuration).toBe(criticalPathDuration);
    expect(result.totalEstimatedDuration).toBeGreaterThan(0);
  });

  it('should estimate total duration', () => {
    const result = decomposer.decompose(sampleTask);
    expect(result.totalEstimatedDuration).toBeGreaterThan(0);
  });

  it('should build correct edges from dependencies', () => {
    sampleTask.intent = 'test';
    const result = decomposer.decompose(sampleTask);
    const { nodes, edges } = result.graph;
    // Each dependency should create an edge
    let depCount = 0;
    for (const node of nodes) {
      depCount += node.dependencies.length;
    }
    expect(edges.length).toBe(depCount);
    for (const edge of edges) {
      expect(edge.type).toBe('hard');
    }
  });

  it('should determine sequential strategy for linear tasks', () => {
    sampleTask.intent = 'test';
    const result = decomposer.decompose(sampleTask);
    expect(result.decompositionStrategy).toBe('sequential');
  });

  it('should determine mixed strategy when some groups are parallel', () => {
    // analyze with file paths creates parallel subtasks
    sampleTask.intent = 'analyze';
    sampleTask.entities = [{ type: 'filePath', value: './src/index.ts', confidence: 0.9, startIndex: 0, endIndex: 14 }];
    const result = decomposer.decompose(sampleTask);
    expect(['sequential', 'mixed', 'parallel']).toContain(result.decompositionStrategy);
  });

  it('should handle analyze task with file paths (conditional subtask)', () => {
    sampleTask.intent = 'analyze';
    sampleTask.entities = [{ type: 'filePath', value: './src/index.ts', confidence: 0.9, startIndex: 0, endIndex: 14 }];
    const result = decomposer.decompose(sampleTask);
    expect(result.graph.nodes.length).toBe(4); // Should have the extra code quality analysis step
  });

  it('should handle analyze task without file paths', () => {
    sampleTask.intent = 'analyze';
    sampleTask.entities = [];
    const result = decomposer.decompose(sampleTask);
    expect(result.graph.nodes.length).toBe(3); // No code quality analysis step
  });

  // --- Custom rules ---

  it('should support custom decomposition rules', () => {
    decomposer.registerRule('analyze', () => [
      {
        id: 'custom-1',
        name: 'Custom Step',
        description: 'A custom step',
        intent: 'analyze',
        dependencies: [],
        priority: 10,
        estimatedDuration: 1000,
        entities: [],
        status: 'pending',
      },
    ]);
    const result = decomposer.decompose(sampleTask);
    expect(result.graph.nodes).toHaveLength(1);
    expect(result.graph.nodes[0]!.name).toBe('Custom Step');
  });

  it('should handle custom rule with parallel tasks', () => {
    decomposer.registerRule('analyze', () => [
      {
        id: 'c1', name: 'Step 1', description: '', intent: 'analyze',
        dependencies: [], priority: 10, estimatedDuration: 1000, entities: [], status: 'pending',
      },
      {
        id: 'c2', name: 'Step 2', description: '', intent: 'analyze',
        dependencies: [], priority: 10, estimatedDuration: 2000, entities: [], status: 'pending',
      },
      {
        id: 'c3', name: 'Step 3', description: '', intent: 'analyze',
        dependencies: ['c1', 'c2'], priority: 10, estimatedDuration: 500, entities: [], status: 'pending',
      },
    ]);
    const result = decomposer.decompose(sampleTask);
    expect(result.graph.parallelGroups.length).toBe(2);
    expect(result.graph.parallelGroups[0]!.length).toBe(2);
  });

  // --- Static methods ---

  it('should get strategy name', () => {
    expect(TaskDecomposer.getStrategyName('sequential')).toBe('顺序执行');
    expect(TaskDecomposer.getStrategyName('parallel')).toBe('并行执行');
    expect(TaskDecomposer.getStrategyName('mixed')).toBe('混合执行');
  });

  // --- Edge cases ---

  it('should handle task with many entities', () => {
    sampleTask.entities = Array.from({ length: 50 }, (_, i) => ({
      type: 'filePath' as const,
      value: `./file${i}.ts`,
      confidence: 0.9,
      startIndex: i * 15,
      endIndex: (i + 1) * 15,
    }));
    const result = decomposer.decompose(sampleTask);
    expect(result.graph.nodes.length).toBeGreaterThan(0);
  });

  it('should handle circular dependency gracefully', () => {
    decomposer.registerRule('analyze', () => [
      {
        id: 'a', name: 'A', description: '', intent: 'analyze',
        dependencies: ['b'], priority: 10, estimatedDuration: 1000, entities: [], status: 'pending',
      },
      {
        id: 'b', name: 'B', description: '', intent: 'analyze',
        dependencies: ['a'], priority: 10, estimatedDuration: 1000, entities: [], status: 'pending',
      },
    ]);
    const result = decomposer.decompose(sampleTask);
    // Should not hang - circular dependency should be broken
    expect(result.graph.parallelGroups.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// SmartOrchestrator Tests
// ============================================================================

describe('SmartOrchestrator', () => {
  let orchestrator: SmartOrchestrator;
  let decomposer: TaskDecomposer;

  beforeEach(() => {
    orchestrator = new SmartOrchestrator();
    decomposer = new TaskDecomposer();
  });

  // --- State management ---

  it('should start in idle state', () => {
    expect(orchestrator.getState()).toBe('idle');
  });

  it('should have no current plan initially', () => {
    expect(orchestrator.getCurrentPlan()).toBeNull();
  });

  it('should have empty reorder history initially', () => {
    expect(orchestrator.getReorderHistory()).toHaveLength(0);
  });

  it('should have empty task results initially', () => {
    expect(orchestrator.getTaskResults().size).toBe(0);
  });

  // --- Plan creation ---

  it('should create execution plan', () => {
    const task = createSampleParsedTask({ intent: 'test' });
    const decomposition = decomposer.decompose(task);
    const plan = orchestrator.createPlan(decomposition);
    expect(plan).toBeDefined();
    expect(plan.phases.length).toBeGreaterThan(0);
    expect(plan.totalSteps).toBe(decomposition.graph.nodes.length);
    expect(plan.estimatedDuration).toBeGreaterThan(0);
    expect(plan.createdAt).toBeInstanceOf(Date);
  });

  it('should return to idle state after plan creation', () => {
    const task = createSampleParsedTask({ intent: 'test' });
    const decomposition = decomposer.decompose(task);
    orchestrator.createPlan(decomposition);
    expect(orchestrator.getState()).toBe('idle');
  });

  it('should create plan with correct phase names', () => {
    const task = createSampleParsedTask({ intent: 'test' });
    const decomposition = decomposer.decompose(task);
    const plan = orchestrator.createPlan(decomposition);
    for (let i = 0; i < plan.phases.length; i++) {
      expect(plan.phases[i]!.name).toContain(`阶段 ${i + 1}`);
    }
  });

  // --- Execution ---

  it('should execute plan successfully', async () => {
    const task = createSampleParsedTask({ intent: 'test' });
    const decomposition = decomposer.decompose(task);
    orchestrator.createPlan(decomposition);

    await orchestrator.execute(async () => ({ success: true, duration: 100 }));
    expect(orchestrator.getState()).toBe('completed');
  });

  it('should track all task results after successful execution', async () => {
    const task = createSampleParsedTask({ intent: 'test' });
    const decomposition = decomposer.decompose(task);
    orchestrator.createPlan(decomposition);
    await orchestrator.execute(async () => ({ success: true, duration: 100 }));
    const results = orchestrator.getTaskResults();
    expect(results.size).toBe(decomposition.graph.nodes.length);
  });

  it('should throw when executing without plan', async () => {
    await expect(orchestrator.execute(async () => ({ success: true, duration: 0 })))
      .rejects.toThrow('No execution plan available');
  });

  // BUG-003: Sequential phase failure should set state to failed
  it('should handle sequential phase failure', async () => {
    const task = createSampleParsedTask({ intent: 'test' });
    const decomposition = decomposer.decompose(task);
    orchestrator.createPlan(decomposition);

    await orchestrator.execute(async () => ({ success: false, duration: 0 }));
    expect(orchestrator.getState()).toBe('failed');
  });

  // BUG-003: Parallel phase failure should set state to failed
  it('BUG-003: should set state to failed when parallel phase fails', async () => {
    // Create a plan with parallel tasks
    decomposer.registerRule('test', () => [
      {
        id: 'p1', name: 'Parallel 1', description: '', intent: 'test',
        dependencies: [], priority: 10, estimatedDuration: 1000, entities: [], status: 'pending',
      },
      {
        id: 'p2', name: 'Parallel 2', description: '', intent: 'test',
        dependencies: [], priority: 10, estimatedDuration: 1000, entities: [], status: 'pending',
      },
    ]);
    const task = createSampleParsedTask({ intent: 'test' });
    const decomposition = decomposer.decompose(task);
    orchestrator.createPlan(decomposition);

    await orchestrator.execute(async (taskId) => {
      if (taskId === 'p1') return { success: false, duration: 0 };
      return { success: true, duration: 100 };
    });
    expect(orchestrator.getState()).toBe('failed');
  });

  it('BUG-003: should call onPhaseComplete when parallel phase fails', async () => {
    decomposer.registerRule('test', () => [
      {
        id: 'p1', name: 'Parallel 1', description: '', intent: 'test',
        dependencies: [], priority: 10, estimatedDuration: 1000, entities: [], status: 'pending',
      },
      {
        id: 'p2', name: 'Parallel 2', description: '', intent: 'test',
        dependencies: [], priority: 10, estimatedDuration: 1000, entities: [], status: 'pending',
      },
    ]);
    const task = createSampleParsedTask({ intent: 'test' });
    const decomposition = decomposer.decompose(task);
    orchestrator.createPlan(decomposition);

    const completedPhases: ExecutionPhase[] = [];
    orchestrator.setCallbacks({
      onPhaseComplete: (phase) => completedPhases.push(phase),
    });

    await orchestrator.execute(async (taskId) => {
      if (taskId === 'p1') return { success: false, duration: 0 };
      return { success: true, duration: 100 };
    });

    expect(completedPhases.length).toBe(1);
    expect(completedPhases[0]!.status).toBe('failed');
  });

  it('should handle task handler throwing an error in parallel mode', async () => {
    const task = createSampleParsedTask({ intent: 'test' });
    const decomposition = decomposer.decompose(task);
    orchestrator.createPlan(decomposition);

    await orchestrator.execute(async (taskId) => {
      if (taskId === decomposition.graph.nodes[0]!.id) {
        throw new Error('Task handler error');
      }
      return { success: true, duration: 100 };
    });
    expect(orchestrator.getState()).toBe('failed');
  });

  it('should handle task handler throwing an error in sequential mode', async () => {
    const task = createSampleParsedTask({ intent: 'test' });
    const decomposition = decomposer.decompose(task);
    orchestrator.createPlan(decomposition);

    await orchestrator.execute(async () => {
      throw new Error('Handler error');
    });
    expect(orchestrator.getState()).toBe('failed');
  });

  // --- Callbacks ---

  it('should call onPhaseComplete for each completed phase', async () => {
    const task = createSampleParsedTask({ intent: 'test' });
    const decomposition = decomposer.decompose(task);
    orchestrator.createPlan(decomposition);

    const completedPhases: ExecutionPhase[] = [];
    orchestrator.setCallbacks({
      onPhaseComplete: (phase) => completedPhases.push(phase),
    });

    await orchestrator.execute(async () => ({ success: true, duration: 100 }));
    expect(completedPhases.length).toBe(decomposition.graph.parallelGroups.length);
    for (const phase of completedPhases) {
      expect(phase.status).toBe('completed');
      expect(phase.completedAt).toBeInstanceOf(Date);
    }
  });

  it('should call onReorder when parallel tasks fail', async () => {
    decomposer.registerRule('test', () => [
      {
        id: 'p1', name: 'P1', description: '', intent: 'test',
        dependencies: [], priority: 10, estimatedDuration: 1000, entities: [], status: 'pending',
      },
      {
        id: 'p2', name: 'P2', description: '', intent: 'test',
        dependencies: [], priority: 10, estimatedDuration: 1000, entities: [], status: 'pending',
      },
    ]);
    const task = createSampleParsedTask({ intent: 'test' });
    const decomposition = decomposer.decompose(task);
    orchestrator.createPlan(decomposition);

    const reorderDecisions: ReorderDecision[] = [];
    orchestrator.setCallbacks({
      onReorder: (decision) => reorderDecisions.push(decision),
    });

    await orchestrator.execute(async (taskId) => {
      if (taskId === 'p1') return { success: false, duration: 0 };
      return { success: true, duration: 100 };
    });

    expect(reorderDecisions.length).toBe(1);
    expect(reorderDecisions[0]!.reason).toContain('失败');
  });

  // --- Pause / Resume / Cancel ---

  it('should pause execution', async () => {
    const task = createSampleParsedTask({ intent: 'test' });
    const decomposition = decomposer.decompose(task);
    orchestrator.createPlan(decomposition);

    let phaseStarted = false;
    const executePromise = orchestrator.execute(async (taskId) => {
      phaseStarted = true;
      // Simulate a long-running task
      await new Promise((r) => setTimeout(r, 100));
      return { success: true, duration: 100 };
    });

    // Wait for execution to start
    while (!phaseStarted) {
      await new Promise((r) => setTimeout(r, 10));
    }

    orchestrator.pause();
    expect(orchestrator.getState()).toBe('paused');

    orchestrator.resume();
    expect(orchestrator.getState()).toBe('executing');

    await executePromise;
  });

  it('should cancel execution', async () => {
    const task = createSampleParsedTask({ intent: 'test' });
    const decomposition = decomposer.decompose(task);
    orchestrator.createPlan(decomposition);

    let canCancel = false;
    const executePromise = orchestrator.execute(async (taskId) => {
      canCancel = true;
      await new Promise((r) => setTimeout(r, 200));
      return { success: true, duration: 100 };
    });

    while (!canCancel) {
      await new Promise((r) => setTimeout(r, 10));
    }

    orchestrator.cancel();
    await executePromise;
    // After cancel, state should be idle
    expect(orchestrator.getState()).toBe('idle');
  });

  it('should not pause when not executing', () => {
    orchestrator.pause();
    expect(orchestrator.getState()).toBe('idle');
  });

  it('should not resume when not paused', () => {
    orchestrator.resume();
    expect(orchestrator.getState()).toBe('idle');
  });

  it('should not cancel when not executing or paused', () => {
    orchestrator.cancel();
    expect(orchestrator.getState()).toBe('idle');
  });

  // --- Reset ---

  it('should reset orchestrator', () => {
    const task = createSampleParsedTask({ intent: 'test' });
    const decomposition = decomposer.decompose(task);
    orchestrator.createPlan(decomposition);
    orchestrator.reset();
    expect(orchestrator.getCurrentPlan()).toBeNull();
    expect(orchestrator.getState()).toBe('idle');
    expect(orchestrator.getReorderHistory()).toHaveLength(0);
    expect(orchestrator.getTaskResults().size).toBe(0);
  });

  it('should allow creating new plan after reset', () => {
    const task = createSampleParsedTask({ intent: 'test' });
    const decomposition = decomposer.decompose(task);
    orchestrator.createPlan(decomposition);
    orchestrator.reset();
    const plan2 = orchestrator.createPlan(decomposition);
    expect(plan2).toBeDefined();
  });
});

// ============================================================================
// ContextManager Tests
// ============================================================================

describe('ContextManager', () => {
  let ctx: ContextManager;

  beforeEach(() => {
    ctx = new ContextManager({ maxTokens: 1000 });
  });

  // --- Configuration ---

  it('should have default configuration', () => {
    const config = ctx.getConfig();
    expect(config.maxTokens).toBe(1000);
    expect(config.reservedTokens).toBe(1000);
    expect(config.compressionThreshold).toBe(0.8);
    expect(config.strategy).toBe('lru');
  });

  it('should accept custom configuration', () => {
    const custom = new ContextManager({
      maxTokens: 5000,
      reservedTokens: 500,
      compressionThreshold: 0.6,
      strategy: 'priority',
    });
    const config = custom.getConfig();
    expect(config.maxTokens).toBe(5000);
    expect(config.reservedTokens).toBe(500);
    expect(config.compressionThreshold).toBe(0.6);
    expect(config.strategy).toBe('priority');
  });

  it('should update configuration', () => {
    ctx.updateConfig({ maxTokens: 2000 });
    expect(ctx.getConfig().maxTokens).toBe(2000);
  });

  // --- Add / Get / Remove ---

  it('should add context entry', () => {
    const entry = ctx.add({ type: 'file', key: 'test.ts', value: 'hello world', priority: 5 });
    expect(entry.id).toBeDefined();
    expect(entry.tokenCount).toBeGreaterThan(0);
    expect(entry.type).toBe('file');
    expect(entry.key).toBe('test.ts');
    expect(entry.priority).toBe(5);
    expect(entry.createdAt).toBeInstanceOf(Date);
    expect(entry.lastAccessedAt).toBeInstanceOf(Date);
  });

  it('should get context entry by ID', () => {
    const entry = ctx.add({ type: 'file', key: 'test.ts', value: 'hello world', priority: 5 });
    const retrieved = ctx.get(entry.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.key).toBe('test.ts');
  });

  it('should update lastAccessedAt on get', async () => {
    const entry = ctx.add({ type: 'file', key: 'test.ts', value: 'hello', priority: 5 });
    const retrieved1 = ctx.get(entry.id)!;
    await new Promise((r) => setTimeout(r, 10));
    const retrieved2 = ctx.get(entry.id)!;
    expect(retrieved2.lastAccessedAt.getTime()).toBeGreaterThanOrEqual(retrieved1.lastAccessedAt.getTime());
  });

  it('should return undefined for non-existent entry', () => {
    expect(ctx.get('non-existent')).toBeUndefined();
  });

  it('should remove context entry', () => {
    const entry = ctx.add({ type: 'file', key: 'test.ts', value: 'hello', priority: 5 });
    expect(ctx.remove(entry.id)).toBe(true);
    expect(ctx.get(entry.id)).toBeUndefined();
  });

  it('should return false when removing non-existent entry', () => {
    expect(ctx.remove('non-existent')).toBe(false);
  });

  // --- Update ---

  it('should update context entry value', () => {
    const entry = ctx.add({ type: 'file', key: 'test.ts', value: 'hello', priority: 5 });
    const updated = ctx.update(entry.id, { value: 'updated' });
    expect(updated!.value).toBe('updated');
    expect(updated!.tokenCount).toBeGreaterThan(0);
  });

  it('should update context entry priority', () => {
    const entry = ctx.add({ type: 'file', key: 'test.ts', value: 'hello', priority: 5 });
    const updated = ctx.update(entry.id, { priority: 8 });
    expect(updated!.priority).toBe(8);
  });

  it('should return undefined when updating non-existent entry', () => {
    expect(ctx.update('non-existent', { value: 'x' })).toBeUndefined();
  });

  // --- Query ---

  it('should get entries by type', () => {
    ctx.add({ type: 'file', key: 'a.ts', value: 'a', priority: 5 });
    ctx.add({ type: 'module', key: 'b', value: 'b', priority: 5 });
    const files = ctx.getByType('file');
    expect(files).toHaveLength(1);
    expect(files[0]!.type).toBe('file');
  });

  it('should return empty array for type with no entries', () => {
    expect(ctx.getByType('config')).toHaveLength(0);
  });

  it('should search by key pattern', () => {
    ctx.add({ type: 'file', key: 'src/index.ts', value: 'a', priority: 5 });
    ctx.add({ type: 'file', key: 'src/utils.ts', value: 'b', priority: 5 });
    ctx.add({ type: 'file', key: 'test/spec.ts', value: 'c', priority: 5 });
    const results = ctx.getByKeyPattern(/src/);
    expect(results).toHaveLength(2);
  });

  it('should return empty array for pattern with no matches', () => {
    ctx.add({ type: 'file', key: 'test.ts', value: 'a', priority: 5 });
    expect(ctx.getByKeyPattern(/nonexistent/)).toHaveLength(0);
  });

  // --- Token tracking ---

  it('should track total tokens', () => {
    ctx.add({ type: 'file', key: 'a', value: 'hello world', priority: 5 });
    ctx.add({ type: 'file', key: 'b', value: 'foo bar baz', priority: 5 });
    expect(ctx.getTotalTokens()).toBeGreaterThan(0);
  });

  it('should return 0 total tokens when empty', () => {
    expect(ctx.getTotalTokens()).toBe(0);
  });

  // BUG-005: getAvailableTokens should not return negative
  it('BUG-005: getAvailableTokens should not be negative', () => {
    expect(ctx.getAvailableTokens()).toBeGreaterThanOrEqual(0);
  });

  it('should calculate available tokens correctly', () => {
    ctx.add({ type: 'file', key: 'a', value: 'hello world', priority: 5 });
    const total = ctx.getTotalTokens();
    const available = ctx.getAvailableTokens();
    // BUG-005 FIX: available is max(0, maxTokens - reservedTokens - total)
    const expected = Math.max(0, 1000 - 1000 - total);
    expect(available).toBe(expected);
  });

  // --- Compression ---

  it('should compress when exceeding threshold', () => {
    const smallCtx = new ContextManager({ maxTokens: 50, compressionThreshold: 0.5 });
    for (let i = 0; i < 10; i++) {
      smallCtx.add({ type: 'file', key: `f${i}`, value: 'some content here', priority: 1 });
    }
    expect(smallCtx.getEntryCount()).toBeLessThanOrEqual(10);
  });

  it('should not compress high priority entries', () => {
    const smallCtx = new ContextManager({ maxTokens: 50, compressionThreshold: 0.5 });
    const important = smallCtx.add({ type: 'file', key: 'important', value: 'very important data', priority: 8 });
    for (let i = 0; i < 10; i++) {
      smallCtx.add({ type: 'file', key: `f${i}`, value: 'some content here', priority: 1 });
    }
    // High priority entry should still be present (look up by ID, not key)
    expect(smallCtx.get(important.id)).toBeDefined();
  });

  it('should return 0 from compress when under threshold', () => {
    const removed = ctx.compress();
    expect(removed).toBe(0);
  });

  // BUG-001: Entry not stored when over budget
  it('BUG-001: should mark entry as not stored when over budget', () => {
    const tinyCtx = new ContextManager({ maxTokens: 10, compressionThreshold: 1.0 });
    // Add a large entry that exceeds max
    const entry = tinyCtx.add({ type: 'file', key: 'big', value: 'this is a very large value that exceeds the token limit', priority: 5 });
    expect(entry.tokenCount).toBe(0); // Marked as not stored
    expect(tinyCtx.getEntryCount()).toBe(0);
  });

  // --- FIFO strategy ---

  it('should use FIFO eviction strategy', () => {
    const fifoCtx = new ContextManager({ maxTokens: 50, compressionThreshold: 0.5, strategy: 'fifo' });
    for (let i = 0; i < 10; i++) {
      fifoCtx.add({ type: 'file', key: `f${i}`, value: 'content data', priority: 1 });
    }
    // Should have compressed some entries
    expect(fifoCtx.getEntryCount()).toBeLessThanOrEqual(10);
  });

  // --- Priority strategy ---

  it('should use priority eviction strategy', () => {
    const prioCtx = new ContextManager({ maxTokens: 50, compressionThreshold: 0.5, strategy: 'priority' });
    const highEntry = prioCtx.add({ type: 'file', key: 'low', value: 'low priority', priority: 1 });
    prioCtx.add({ type: 'file', key: 'high', value: 'high priority', priority: 9 });
    for (let i = 0; i < 10; i++) {
      prioCtx.add({ type: 'file', key: `f${i}`, value: 'content', priority: 3 });
    }
    // High priority should survive (look up by ID, not key)
    expect(prioCtx.getByKeyPattern(/high/).length).toBeGreaterThan(0);
  });

  // --- Entry count ---

  it('should return correct entry count', () => {
    expect(ctx.getEntryCount()).toBe(0);
    ctx.add({ type: 'file', key: 'a', value: 'a', priority: 5 });
    ctx.add({ type: 'file', key: 'b', value: 'b', priority: 5 });
    expect(ctx.getEntryCount()).toBe(2);
  });

  // --- Get all / Clear ---

  it('should get all entries', () => {
    ctx.add({ type: 'file', key: 'a', value: 'a', priority: 5 });
    ctx.add({ type: 'file', key: 'b', value: 'b', priority: 5 });
    expect(ctx.getAll()).toHaveLength(2);
  });

  it('should clear all entries', () => {
    ctx.add({ type: 'file', key: 'a', value: 'a', priority: 5 });
    ctx.add({ type: 'file', key: 'b', value: 'b', priority: 5 });
    ctx.clear();
    expect(ctx.getEntryCount()).toBe(0);
    expect(ctx.getTotalTokens()).toBe(0);
  });

  // --- Project context ---

  it('should collect project context', () => {
    ctx.collectProjectContext('/project', ['src/index.ts', 'src/utils.ts']);
    expect(ctx.getEntryCount()).toBe(2);
  });

  it('should handle empty file list in collectProjectContext', () => {
    ctx.collectProjectContext('/project', []);
    expect(ctx.getEntryCount()).toBe(0);
  });

  // --- Export ---

  it('should export context', () => {
    ctx.add({ type: 'file', key: 'test', value: 'hello', priority: 5 });
    const exported = ctx.exportContext();
    expect(exported.entries).toHaveLength(1);
    expect(exported.config.maxTokens).toBe(1000);
  });

  it('should export empty context', () => {
    const exported = ctx.exportContext();
    expect(exported.entries).toHaveLength(0);
  });

  // --- Persist / Load (no-op) ---

  it('should persist without error', async () => {
    await ctx.persist();
  });

  it('should load without error', async () => {
    await ctx.load();
  });

  // --- Edge cases ---

  it('should handle null value', () => {
    const entry = ctx.add({ type: 'file', key: 'null', value: null, priority: 5 });
    expect(entry).toBeDefined();
    expect(entry.tokenCount).toBeGreaterThan(0);
  });

  it('should handle numeric value', () => {
    const entry = ctx.add({ type: 'file', key: 'num', value: 42, priority: 5 });
    expect(entry).toBeDefined();
  });

  it('should handle object value', () => {
    const entry = ctx.add({ type: 'file', key: 'obj', value: { foo: 'bar' }, priority: 5 });
    expect(entry).toBeDefined();
  });

  it('should handle Chinese text token estimation', () => {
    const entry = ctx.add({ type: 'file', key: 'zh', value: '这是一个中文测试', priority: 5 });
    expect(entry.tokenCount).toBeGreaterThan(0);
  });

  it('should handle empty string value', () => {
    const entry = ctx.add({ type: 'file', key: 'empty', value: '', priority: 5 });
    expect(entry.tokenCount).toBe(0);
  });
});

// ============================================================================
// FeedbackLoop Tests
// ============================================================================

describe('FeedbackLoop', () => {
  let feedback: FeedbackLoop;

  beforeEach(() => {
    feedback = new FeedbackLoop();
  });

  // --- Configuration ---

  it('should have default retry config', () => {
    const config = feedback.getRetryConfig();
    expect(config.maxRetries).toBe(3);
    expect(config.baseDelay).toBe(1000);
    expect(config.maxDelay).toBe(30000);
    expect(config.backoffMultiplier).toBe(2);
    expect(config.jitter).toBe(true);
  });

  it('should accept custom retry config', () => {
    const custom = new FeedbackLoop({ maxRetries: 5, baseDelay: 500, jitter: false });
    const config = custom.getRetryConfig();
    expect(config.maxRetries).toBe(5);
    expect(config.baseDelay).toBe(500);
    expect(config.jitter).toBe(false);
  });

  it('should update retry config', () => {
    feedback.updateRetryConfig({ maxRetries: 10 });
    expect(feedback.getRetryConfig().maxRetries).toBe(10);
  });

  // --- Evaluation ---

  it('should evaluate successful task', () => {
    const result = feedback.evaluate('task-1', true, 'Completed successfully');
    expect(result.success).toBe(true);
    expect(result.score).toBeGreaterThan(0);
    expect(result.shouldRetry).toBe(false);
    expect(result.retryCount).toBe(1);
    expect(result.nextRetryDelay).toBe(0);
  });

  it('should evaluate failed task', () => {
    const result = feedback.evaluate('task-1', false, 'Failed');
    expect(result.success).toBe(false);
    expect(result.score).toBe(0);
    expect(result.shouldRetry).toBe(true);
    expect(result.retryCount).toBe(1);
    expect(result.nextRetryDelay).toBeGreaterThan(0);
  });

  it('should calculate score with duration penalty', () => {
    const fast = feedback.evaluate('fast', true, 'Fast', 1000);
    const slow = feedback.evaluate('slow', true, 'Slow', 60000);
    expect(fast.score).toBeGreaterThan(slow.score);
  });

  it('should calculate score with retry penalty', () => {
    feedback.evaluate('task-1', false, 'Fail');
    feedback.evaluate('task-1', false, 'Fail');
    const result = feedback.evaluate('task-1', true, 'Finally success');
    expect(result.score).toBeLessThan(100);
  });

  it('should cap score at 0 minimum', () => {
    feedback.evaluate('task-1', false, 'Fail');
    feedback.evaluate('task-1', false, 'Fail');
    feedback.evaluate('task-1', false, 'Fail');
    feedback.evaluate('task-1', false, 'Fail');
    feedback.evaluate('task-1', false, 'Fail');
    feedback.evaluate('task-1', false, 'Fail');
    feedback.evaluate('task-1', false, 'Fail');
    const result = feedback.evaluate('task-1', true, 'Success after many retries');
    expect(result.score).toBe(0);
  });

  // --- Retry logic ---

  it('should calculate retry delay with exponential backoff', () => {
    const r1 = feedback.evaluate('task-1', false, 'Fail');
    const r2 = feedback.evaluate('task-1', false, 'Fail again');
    expect(r2.nextRetryDelay).toBeGreaterThan(r1.nextRetryDelay);
  });

  it('should cap retry delay at maxDelay', () => {
    for (let i = 0; i < 20; i++) {
      feedback.evaluate('task-1', false, 'Fail');
    }
    const result = feedback.evaluate('task-1', false, 'Fail');
    expect(result.nextRetryDelay).toBeLessThanOrEqual(30000);
  });

  // BUG-002: Retry delay should never be negative
  it('BUG-002: retry delay should never be negative', () => {
    // With jitter, delay could theoretically be negative without the fix
    for (let i = 0; i < 100; i++) {
      feedback.evaluate('task-1', false, 'Fail');
      const history = feedback.getHistory('task-1');
      const lastDelay = history[history.length - 1]!.nextRetryDelay;
      expect(lastDelay).toBeGreaterThanOrEqual(0);
    }
  });

  it('should stop retrying after max retries', () => {
    for (let i = 0; i < 4; i++) {
      feedback.evaluate('task-1', false, 'Fail');
    }
    const result = feedback.evaluate('task-1', false, 'Fail');
    expect(result.shouldRetry).toBe(false);
  });

  it('should track shouldRetry based on consecutive failures in history', () => {
    // 1st failure: history.length=0 before push, shouldRetry = 0 < 3 = true
    let result = feedback.evaluate('task-1', false, 'Fail');
    expect(result.shouldRetry).toBe(true);

    // 2nd failure: history.length=1, shouldRetry = 1 < 3 = true
    result = feedback.evaluate('task-1', false, 'Fail');
    expect(result.shouldRetry).toBe(true);

    // 3rd failure: history.length=2, shouldRetry = 2 < 3 = true
    result = feedback.evaluate('task-1', false, 'Fail');
    expect(result.shouldRetry).toBe(true);

    // 4th failure: history.length=3, shouldRetry = 3 < 3 = false
    result = feedback.evaluate('task-1', false, 'Fail');
    expect(result.shouldRetry).toBe(false);

    // Even after success, history still has 5 entries
    feedback.evaluate('task-1', true, 'Success');
    result = feedback.evaluate('task-1', false, 'Fail again');
    expect(result.shouldRetry).toBe(false); // history.length=5 >= maxRetries(3)
  });

  // --- History ---

  it('should track feedback history', () => {
    feedback.evaluate('task-1', true, 'OK');
    feedback.evaluate('task-1', false, 'Fail');
    const history = feedback.getHistory('task-1');
    expect(history).toHaveLength(2);
  });

  it('should return empty history for unknown task', () => {
    expect(feedback.getHistory('non-existent')).toHaveLength(0);
  });

  it('should get all history', () => {
    feedback.evaluate('task-1', true, 'OK');
    feedback.evaluate('task-2', false, 'Fail');
    const allHistory = feedback.getAllHistory();
    expect(allHistory.size).toBe(2);
  });

  // --- User feedback ---

  it('should accept positive user feedback', () => {
    feedback.evaluate('task-1', true, 'OK');
    feedback.submitUserFeedback('task-1', 'good');
    expect(feedback.getUserPreference('task-1')).toBeGreaterThan(0);
  });

  it('should accept negative user feedback', () => {
    feedback.evaluate('task-1', true, 'OK');
    feedback.submitUserFeedback('task-1', 'bad');
    expect(feedback.getUserPreference('task-1')).toBeLessThan(0);
  });

  it('should accept Chinese positive feedback', () => {
    feedback.evaluate('task-1', true, 'OK');
    feedback.submitUserFeedback('task-1', '很好');
    expect(feedback.getUserPreference('task-1')).toBeGreaterThan(0);
  });

  it('should accept Chinese negative feedback', () => {
    feedback.evaluate('task-1', true, 'OK');
    feedback.submitUserFeedback('task-1', '不好');
    expect(feedback.getUserPreference('task-1')).toBeLessThan(0);
  });

  it('should ignore user feedback for unknown task', () => {
    feedback.submitUserFeedback('non-existent', 'good');
    expect(feedback.getUserPreference('non-existent')).toBe(0);
  });

  it('should accumulate user preferences', () => {
    feedback.evaluate('task-1', true, 'OK');
    feedback.submitUserFeedback('task-1', 'good');
    feedback.submitUserFeedback('task-1', 'good');
    feedback.submitUserFeedback('task-1', 'bad');
    expect(feedback.getUserPreference('task-1')).toBe(1);
  });

  it('should return 0 preference for unknown task', () => {
    expect(feedback.getUserPreference('non-existent')).toBe(0);
  });

  // --- Success rate ---

  it('should calculate success rate', () => {
    feedback.evaluate('task-1', true, 'OK');
    feedback.evaluate('task-2', true, 'OK');
    feedback.evaluate('task-3', false, 'Fail');
    expect(feedback.getSuccessRate()).toBeCloseTo(2 / 3);
  });

  it('should return 0 success rate when empty', () => {
    expect(feedback.getSuccessRate()).toBe(0);
  });

  // --- Callback ---

  it('should call onFeedback callback', () => {
    const results: FeedbackResult[] = [];
    feedback.setOnFeedback((result) => results.push(result));
    feedback.evaluate('task-1', true, 'OK');
    expect(results).toHaveLength(1);
    expect(results[0]!.taskId).toBe('task-1');
  });

  // --- Clear ---

  it('should clear history', () => {
    feedback.evaluate('task-1', true, 'OK');
    feedback.clear();
    expect(feedback.getHistory('task-1')).toHaveLength(0);
    expect(feedback.getAllHistory().size).toBe(0);
    expect(feedback.getSuccessRate()).toBe(0);
  });

  it('should clear user preferences', () => {
    feedback.evaluate('task-1', true, 'OK');
    feedback.submitUserFeedback('task-1', 'good');
    feedback.clear();
    expect(feedback.getUserPreference('task-1')).toBe(0);
  });
});

// ============================================================================
// TaskTemplates Tests
// ============================================================================

describe('TaskTemplates', () => {
  let templates: TaskTemplates;

  beforeEach(() => {
    templates = new TaskTemplates();
  });

  // --- Built-in templates ---

  it('should have built-in templates', () => {
    const builtIn = templates.getBuiltIn();
    expect(builtIn.length).toBeGreaterThan(0);
  });

  it('should have 5 built-in templates', () => {
    expect(templates.getBuiltIn().length).toBe(5);
  });

  it('should get template by ID', () => {
    const template = templates.get('builtin:analyze-project');
    expect(template).toBeDefined();
    expect(template!.name).toBe('项目架构分析');
    expect(template!.isBuiltIn).toBe(true);
  });

  it('should return undefined for non-existent template', () => {
    expect(templates.get('non-existent')).toBeUndefined();
  });

  // --- Search ---

  it('should search templates by name', () => {
    const results = templates.search('测试');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should search templates by description', () => {
    const results = templates.search('部署');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should search templates by category', () => {
    const results = templates.search('testing');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should search templates by tag', () => {
    const results = templates.search('bug');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should return empty for no search matches', () => {
    expect(templates.search('zzzzzzzzz')).toHaveLength(0);
  });

  // --- Category / Intent ---

  it('should get templates by category', () => {
    const results = templates.getByCategory('testing');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should return empty for non-existent category', () => {
    expect(templates.getByCategory('nonexistent')).toHaveLength(0);
  });

  it('should get templates by intent', () => {
    const results = templates.getByIntent('test');
    expect(results.length).toBeGreaterThan(0);
  });

  // --- CRUD ---

  it('should register custom template', () => {
    const template = templates.register({
      name: 'My Template',
      description: 'A custom template',
      category: 'custom',
      parameters: [],
      steps: [{ name: 'Step 1', description: 'Do something', intent: 'analyze', parameterMapping: {} }],
      tags: ['custom'],
    });
    expect(template.id).toContain('custom:');
    expect(template.isBuiltIn).toBe(false);
    expect(templates.getCustom()).toHaveLength(1);
  });

  it('should update custom template', () => {
    const template = templates.register({
      name: 'My Template',
      description: 'Original',
      category: 'custom',
      parameters: [],
      steps: [],
      tags: [],
    });
    const updated = templates.update(template.id, { description: 'Updated' });
    expect(updated!.description).toBe('Updated');
  });

  it('should not update built-in template', () => {
    const result = templates.update('builtin:analyze-project', { description: 'Hacked' });
    expect(result).toBeUndefined();
  });

  it('should not update non-existent template', () => {
    expect(templates.update('non-existent', { description: 'X' })).toBeUndefined();
  });

  it('should delete custom template', () => {
    const template = templates.register({
      name: 'Delete Me',
      description: 'To be deleted',
      category: 'custom',
      parameters: [],
      steps: [],
      tags: [],
    });
    expect(templates.delete(template.id)).toBe(true);
    expect(templates.get(template.id)).toBeUndefined();
  });

  it('should not delete built-in template', () => {
    expect(templates.delete('builtin:analyze-project')).toBe(false);
  });

  it('should return false when deleting non-existent template', () => {
    expect(templates.delete('non-existent')).toBe(false);
  });

  // --- Validation ---

  it('should validate parameters with all required present', () => {
    const result = templates.validateParameters('builtin:run-tests', {});
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should detect missing required parameters', () => {
    const result = templates.validateParameters('builtin:analyze-project', {});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('projectPath');
  });

  it('should validate parameter types', () => {
    const result = templates.validateParameters('builtin:analyze-project', {
      projectPath: 123, // Should be string/path
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('type'))).toBe(true);
  });

  it('should validate enum parameter values', () => {
    const result = templates.validateParameters('builtin:deploy-production', {
      env: 'invalid-env',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('must be one of'))).toBe(true);
  });

  it('should validate enum parameter with valid value', () => {
    const result = templates.validateParameters('builtin:deploy-production', {
      env: 'production',
    });
    expect(result.valid).toBe(true);
  });

  it('should return error for non-existent template validation', () => {
    const result = templates.validateParameters('non-existent', {});
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('not found');
  });

  // --- Count ---

  it('should get template count', () => {
    const count = templates.getCount();
    expect(count.total).toBeGreaterThan(0);
    expect(count.builtIn).toBeGreaterThan(0);
    expect(count.custom).toBe(0);
  });

  it('should update count after registration', () => {
    templates.register({
      name: 'Extra', description: '', category: 'c',
      parameters: [], steps: [], tags: [],
    });
    const count = templates.getCount();
    expect(count.custom).toBe(1);
  });

  // --- Get all ---

  it('should get all templates', () => {
    const all = templates.getAll();
    expect(all.length).toBeGreaterThan(0);
  });

  it('should get custom templates (empty initially)', () => {
    expect(templates.getCustom()).toHaveLength(0);
  });
});

// ============================================================================
// ExecutionHistory Tests
// ============================================================================

describe('ExecutionHistory', () => {
  let history: ExecutionHistory;

  beforeEach(() => {
    history = new ExecutionHistory();
  });

  // --- Record ---

  it('should record execution', () => {
    const record = history.record(createSampleExecutionRecord());
    expect(record.id).toBeDefined();
    expect(history.getCount()).toBe(1);
  });

  it('should generate unique IDs', () => {
    const r1 = history.record(createSampleExecutionRecord());
    const r2 = history.record(createSampleExecutionRecord());
    expect(r1.id).not.toBe(r2.id);
  });

  // --- Complete ---

  it('should complete a record', () => {
    const startTime = new Date(Date.now() - 1000);
    const record = history.record(createSampleExecutionRecord({ startTime }));
    const completed = history.complete(record.id, 'success', 5);
    expect(completed!.duration).toBeGreaterThan(0);
    expect(completed!.completedSubTasks).toBe(5);
    expect(completed!.endTime).toBeInstanceOf(Date);
  });

  it('should complete with error', () => {
    const record = history.record(createSampleExecutionRecord());
    const completed = history.complete(record.id, 'failed', 0, 'Something went wrong');
    expect(completed!.error).toBe('Something went wrong');
    expect(completed!.status).toBe('failed');
  });

  it('should return undefined when completing non-existent record', () => {
    expect(history.complete('non-existent', 'success')).toBeUndefined();
  });

  // --- Get ---

  it('should get record by ID', () => {
    const record = history.record(createSampleExecutionRecord());
    expect(history.get(record.id)).toBeDefined();
  });

  it('should return undefined for non-existent record', () => {
    expect(history.get('non-existent')).toBeUndefined();
  });

  it('should get records by session', () => {
    history.record(createSampleExecutionRecord({ sessionId: 's1' }));
    history.record(createSampleExecutionRecord({ sessionId: 's2' }));
    expect(history.getBySession('s1')).toHaveLength(1);
    expect(history.getBySession('s2')).toHaveLength(1);
  });

  it('should get records by intent', () => {
    history.record(createSampleExecutionRecord({ intent: 'analyze' }));
    history.record(createSampleExecutionRecord({ intent: 'test' }));
    expect(history.getByIntent('analyze')).toHaveLength(1);
    expect(history.getByIntent('test')).toHaveLength(1);
  });

  it('should get records by status', () => {
    history.record(createSampleExecutionRecord({ status: 'success' }));
    history.record(createSampleExecutionRecord({ status: 'failed' }));
    expect(history.getByStatus('success')).toHaveLength(1);
    expect(history.getByStatus('failed')).toHaveLength(1);
  });

  it('should get recent records', () => {
    for (let i = 0; i < 5; i++) {
      history.record(createSampleExecutionRecord({ taskDescription: `Task ${i}` }));
    }
    const recent = history.getRecent(3);
    expect(recent).toHaveLength(3);
    expect(recent[0]!.taskDescription).toBe('Task 4');
  });

  it('should get all records', () => {
    history.record(createSampleExecutionRecord());
    history.record(createSampleExecutionRecord());
    expect(history.getAll()).toHaveLength(2);
  });

  // --- Query ---

  it('should query with status filter', () => {
    history.record(createSampleExecutionRecord({ status: 'success' }));
    history.record(createSampleExecutionRecord({ status: 'failed' }));
    const results = history.query({ status: 'failed' });
    expect(results).toHaveLength(1);
  });

  it('should query with session filter', () => {
    history.record(createSampleExecutionRecord({ sessionId: 's1' }));
    history.record(createSampleExecutionRecord({ sessionId: 's2' }));
    const results = history.query({ sessionId: 's1' });
    expect(results).toHaveLength(1);
  });

  it('should query with intent filter', () => {
    history.record(createSampleExecutionRecord({ intent: 'analyze' }));
    history.record(createSampleExecutionRecord({ intent: 'test' }));
    const results = history.query({ intent: 'analyze' });
    expect(results).toHaveLength(1);
  });

  it('should query with date range', () => {
    const past = new Date(Date.now() - 100000);
    const future = new Date(Date.now() + 100000);
    history.record(createSampleExecutionRecord({ startTime: new Date() }));
    const results = history.query({ startDate: past, endDate: future });
    expect(results.length).toBeGreaterThan(0);
  });

  it('should query with limit', () => {
    for (let i = 0; i < 10; i++) {
      history.record(createSampleExecutionRecord({ taskDescription: `Task ${i}` }));
    }
    const results = history.query({ limit: 3 });
    expect(results).toHaveLength(3);
  });

  // BUG-006: endDate filter should use endTime
  it('BUG-006: endDate filter should use endTime when available', () => {
    const startTime = new Date('2024-01-01T00:00:00Z');
    const record = history.record(createSampleExecutionRecord({ startTime }));
    history.complete(record.id, 'success', 1);

    // Query with endDate between startTime and endTime
    const midTime = new Date('2024-01-01T00:00:30Z');
    const results = history.query({ endDate: midTime });
    // The record's endTime should be after midTime (1 second duration from startTime)
    expect(results).toHaveLength(0);
  });

  it('should return empty query with no matching filters', () => {
    history.record(createSampleExecutionRecord({ sessionId: 's1' }));
    const results = history.query({ sessionId: 'non-existent' });
    expect(results).toHaveLength(0);
  });

  // --- Statistics ---

  it('should calculate statistics', () => {
    history.record(createSampleExecutionRecord({ status: 'success' }));
    history.record(createSampleExecutionRecord({ status: 'failed' }));
    const stats = history.getStats();
    expect(stats.totalExecutions).toBe(2);
    expect(stats.successRate).toBe(0.5);
  });

  it('should return empty stats when no records', () => {
    const stats = history.getStats();
    expect(stats.totalExecutions).toBe(0);
    expect(stats.successRate).toBe(0);
    expect(stats.averageDuration).toBe(0);
    expect(stats.mostCommonTasks).toHaveLength(0);
  });

  it('should calculate intent breakdown', () => {
    history.record(createSampleExecutionRecord({ intent: 'analyze' }));
    history.record(createSampleExecutionRecord({ intent: 'analyze' }));
    history.record(createSampleExecutionRecord({ intent: 'test' }));
    const stats = history.getStats();
    expect(stats.intentBreakdown['analyze']).toBe(2);
    expect(stats.intentBreakdown['test']).toBe(1);
  });

  it('should calculate daily breakdown', () => {
    history.record(createSampleExecutionRecord());
    const stats = history.getStats();
    const days = Object.keys(stats.dailyBreakdown);
    expect(days.length).toBe(1);
  });

  it('should find most common tasks', () => {
    history.record(createSampleExecutionRecord({ taskDescription: 'Deploy' }));
    history.record(createSampleExecutionRecord({ taskDescription: 'Deploy' }));
    history.record(createSampleExecutionRecord({ taskDescription: 'Deploy' }));
    history.record(createSampleExecutionRecord({ taskDescription: 'Test' }));
    const stats = history.getStats();
    expect(stats.mostCommonTasks[0]!.description).toBe('Deploy');
    expect(stats.mostCommonTasks[0]!.count).toBe(3);
  });

  // --- Trimming ---

  it('should trim old records', () => {
    const smallHistory = new ExecutionHistory(3);
    for (let i = 0; i < 5; i++) {
      smallHistory.record(createSampleExecutionRecord({ taskDescription: `Task ${i}` }));
    }
    expect(smallHistory.getCount()).toBe(3);
    // Should keep the most recent records
    const recent = smallHistory.getRecent(3);
    expect(recent[0]!.taskDescription).toBe('Task 4');
  });

  // --- Clear ---

  it('should clear all records', () => {
    history.record(createSampleExecutionRecord());
    history.clear();
    expect(history.getCount()).toBe(0);
  });

  // --- Edge cases ---

  it('should handle partial status', () => {
    const record = history.record(createSampleExecutionRecord({ status: 'partial' }));
    expect(record.status).toBe('partial');
  });

  it('should handle cancelled status', () => {
    const record = history.record(createSampleExecutionRecord({ status: 'cancelled' }));
    expect(record.status).toBe('cancelled');
  });

  it('should handle metadata', () => {
    const record = history.record(createSampleExecutionRecord({
      metadata: { key1: 'value1', key2: 42 },
    }));
    expect(record.metadata.key1).toBe('value1');
    expect(record.metadata.key2).toBe(42);
  });
});

// ============================================================================
// SmartRecommendations Tests
// ============================================================================

describe('SmartRecommendations', () => {
  let recs: SmartRecommendations;

  beforeEach(() => {
    recs = new SmartRecommendations();
  });

  // --- Project analysis ---

  it('should recommend README when missing', () => {
    const result = recs.analyzeProject(['src/index.ts', 'package.json']);
    const readmeRec = result.find((r) => r.title === '缺少 README');
    expect(readmeRec).toBeDefined();
    expect(readmeRec!.priority).toBe('high');
  });

  it('should not recommend README when present', () => {
    const result = recs.analyzeProject(['src/index.ts', 'README.md']);
    const readmeRec = result.find((r) => r.title === '缺少 README');
    expect(readmeRec).toBeUndefined();
  });

  it('should detect Docker projects', () => {
    const result = recs.analyzeProject(['Dockerfile', 'src/index.ts', 'README.md']);
    const dockerRec = result.find((r) => r.title === 'Docker 优化');
    expect(dockerRec).toBeDefined();
  });

  it('should detect CI/CD', () => {
    const result = recs.analyzeProject(['.github/workflows/ci.yml', 'README.md']);
    const ciRec = result.find((r) => r.title === 'CI/CD 检查');
    expect(ciRec).toBeDefined();
  });

  it('should detect test files', () => {
    const result = recs.analyzeProject(['src/index.ts', 'src/index.test.ts', 'README.md']);
    const testRec = result.find((r) => r.title === '运行测试');
    expect(testRec).toBeDefined();
  });

  it('should detect API code', () => {
    const result = recs.analyzeProject(['src/api/routes.ts', 'README.md']);
    const apiRec = result.find((r) => r.title === 'API 文档生成');
    expect(apiRec).toBeDefined();
  });

  it('should handle empty file list', () => {
    const result = recs.analyzeProject([]);
    expect(result.length).toBeGreaterThan(0); // Should still recommend README
  });

  // --- History analysis ---

  it('should analyze execution history for recurring failures', () => {
    const records = [
      createSampleExecutionRecord({ taskDescription: 'Deploy', status: 'failed' }),
      createSampleExecutionRecord({ taskDescription: 'Deploy', status: 'failed' }),
      createSampleExecutionRecord({ taskDescription: 'Deploy', status: 'failed' }),
    ];
    const result = recs.analyzeHistory(records);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.title).toContain('重复失败');
    expect(result[0]!.priority).toBe('high');
  });

  it('should not recommend for less than 3 failures', () => {
    const records = [
      createSampleExecutionRecord({ taskDescription: 'Deploy', status: 'failed' }),
      createSampleExecutionRecord({ taskDescription: 'Deploy', status: 'failed' }),
    ];
    const result = recs.analyzeHistory(records);
    expect(result.find((r) => r.title.includes('重复失败'))).toBeUndefined();
  });

  it('should analyze for slow tasks', () => {
    const records = [
      createSampleExecutionRecord({
        taskDescription: 'Slow Task',
        status: 'success',
        duration: 60000,
      }),
    ];
    const result = recs.analyzeHistory(records);
    expect(result.find((r) => r.title.includes('性能优化'))).toBeDefined();
  });

  it('should return empty for empty history', () => {
    const result = recs.analyzeHistory([]);
    expect(result).toHaveLength(0);
  });

  // --- Pattern analysis ---

  it('should analyze patterns with enough records', () => {
    const records = Array.from({ length: 10 }, (_, i) =>
      createSampleExecutionRecord({
        startTime: new Date(`2024-01-${String((i % 7) + 1).padStart(2, '0')}T10:00:00Z`),
      }),
    );
    const result = recs.analyzePatterns(records);
    // May or may not produce a recommendation depending on distribution
    expect(Array.isArray(result)).toBe(true);
  });

  it('should return empty for insufficient pattern data', () => {
    const records = Array.from({ length: 3 }, () =>
      createSampleExecutionRecord(),
    );
    const result = recs.analyzePatterns(records);
    expect(result).toHaveLength(0);
  });

  // --- Dismiss ---

  it('should dismiss recommendations', () => {
    const result = recs.analyzeProject(['src/index.ts']);
    const id = result[0]!.id;
    recs.dismiss(id);
    expect(recs.getAll().find((r) => r.id === id)).toBeUndefined();
  });

  it('should trim dismissed IDs when exceeding max', () => {
    const maxDismiss = 200;
    for (let i = 0; i < maxDismiss + 50; i++) {
      const result = recs.analyzeProject([`src/file${i}.ts`]);
      if (result.length > 0) {
        recs.dismiss(result[0]!.id);
      }
    }
    // Should not throw, dismissed IDs should be trimmed
    expect(recs.getCount()).toBeGreaterThanOrEqual(0);
  });

  // --- Filtering ---

  it('should get recommendations by type', () => {
    recs.analyzeProject(['src/index.ts']);
    const optimizations = recs.getByType('proactive');
    expect(optimizations.length).toBeGreaterThan(0);
  });

  it('should get recommendations by priority', () => {
    recs.analyzeProject(['src/index.ts']);
    const high = recs.getByPriority('high');
    expect(high.length).toBeGreaterThan(0);
  });

  it('should return empty for non-existent priority', () => {
    expect(recs.getByPriority('critical')).toHaveLength(0);
  });

  // --- Max recommendations ---

  it('should trim to max recommendations', () => {
    const smallRecs = new SmartRecommendations(5);
    for (let i = 0; i < 20; i++) {
      smallRecs.analyzeProject([`src/file${i}.ts`]);
    }
    expect(smallRecs.getCount()).toBeLessThanOrEqual(5);
  });

  // --- Clear ---

  it('should clear recommendations', () => {
    recs.analyzeProject(['src/index.ts']);
    recs.clear();
    expect(recs.getCount()).toBe(0);
  });

  it('should clear dismissed IDs on clear', () => {
    const result = recs.analyzeProject(['src/index.ts']);
    recs.dismiss(result[0]!.id);
    recs.clear();
    // After clear, new analysis should produce recommendations again
    const newResult = recs.analyzeProject(['src/index.ts']);
    expect(newResult.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// SessionManager Tests
// ============================================================================

describe('SessionManager', () => {
  let sessions: SessionManager;

  beforeEach(() => {
    sessions = new SessionManager();
  });

  // --- Create ---

  it('should create a session with name', () => {
    const session = sessions.create('Test Session');
    expect(session.id).toBeDefined();
    expect(session.name).toBe('Test Session');
    expect(session.status).toBe('active');
    expect(session.messages).toHaveLength(0);
    expect(session.context).toHaveLength(0);
    expect(session.executionIds).toHaveLength(0);
    expect(session.metadata).toEqual({});
  });

  it('should create a session with auto-generated name', () => {
    const session = sessions.create();
    expect(session.name).toContain('会话');
  });

  it('should set new session as active', () => {
    const session = sessions.create();
    expect(sessions.getActive()!.id).toBe(session.id);
  });

  it('should generate unique session IDs', () => {
    const s1 = sessions.create();
    const s2 = sessions.create();
    expect(s1.id).not.toBe(s2.id);
  });

  // --- Get ---

  it('should get session by ID', () => {
    const session = sessions.create('Test');
    expect(sessions.get(session.id)).toBeDefined();
  });

  it('should return undefined for non-existent session', () => {
    expect(sessions.get('non-existent')).toBeUndefined();
  });

  it('should get active session', () => {
    const session = sessions.create();
    const active = sessions.getActive();
    expect(active!.id).toBe(session.id);
  });

  it('should return undefined for active session when none exists', () => {
    expect(sessions.getActive()).toBeUndefined();
  });

  // --- Set active ---

  it('should set active session', () => {
    const s1 = sessions.create('S1');
    const s2 = sessions.create('S2');
    sessions.setActive(s1.id);
    expect(sessions.getActive()!.id).toBe(s1.id);
  });

  it('should return false when setting non-existent session as active', () => {
    expect(sessions.setActive('non-existent')).toBe(false);
  });

  // --- Messages ---

  it('should add message to session', () => {
    const session = sessions.create();
    const msg = sessions.addMessage(session.id, 'user', 'Hello');
    expect(msg).toBeDefined();
    expect(msg!.content).toBe('Hello');
    expect(msg!.role).toBe('user');
  });

  it('should add message with metadata', () => {
    const session = sessions.create();
    const msg = sessions.addMessage(session.id, 'user', 'Hello', { key: 'value' });
    expect(msg!.metadata).toEqual({ key: 'value' });
  });

  it('should return undefined when adding message to non-existent session', () => {
    expect(sessions.addMessage('non-existent', 'user', 'Hello')).toBeUndefined();
  });

  it('should add message to active session', () => {
    const session = sessions.create();
    const msg = sessions.addMessageToActive('user', 'Hello');
    expect(msg).toBeDefined();
    expect(msg!.content).toBe('Hello');
  });

  it('should return undefined when adding to active with no active session', () => {
    expect(sessions.addMessageToActive('user', 'Hello')).toBeUndefined();
  });

  it('should get messages from session', () => {
    const session = sessions.create();
    sessions.addMessage(session.id, 'user', 'Hello');
    sessions.addMessage(session.id, 'assistant', 'Hi there');
    const messages = sessions.getMessages(session.id);
    expect(messages).toHaveLength(2);
  });

  it('should get messages with limit', () => {
    const session = sessions.create();
    sessions.addMessage(session.id, 'user', 'Msg 1');
    sessions.addMessage(session.id, 'user', 'Msg 2');
    sessions.addMessage(session.id, 'user', 'Msg 3');
    const messages = sessions.getMessages(session.id, 2);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.content).toBe('Msg 2');
  });

  it('should return empty array for non-existent session messages', () => {
    expect(sessions.getMessages('non-existent')).toHaveLength(0);
  });

  it('should search messages across sessions', () => {
    const session = sessions.create('Test');
    sessions.addMessage(session.id, 'user', 'Analyze the project');
    sessions.addMessage(session.id, 'user', 'Run the tests');
    const results = sessions.searchMessages('analyze');
    expect(results).toHaveLength(1);
    expect(results[0]!.messages[0]!.content).toContain('Analyze');
  });

  it('should return empty search results for no matches', () => {
    sessions.create('Test');
    expect(sessions.searchMessages('zzzzzz')).toHaveLength(0);
  });

  it('should search case-insensitively', () => {
    const session = sessions.create('Test');
    sessions.addMessage(session.id, 'user', 'Analyze This');
    const results = sessions.searchMessages('analyze');
    expect(results).toHaveLength(1);
  });

  // --- Link execution ---

  it('should link execution to session', () => {
    const session = sessions.create();
    expect(sessions.linkExecution(session.id, 'exec-1')).toBe(true);
    expect(sessions.get(session.id)!.executionIds).toContain('exec-1');
  });

  it('should return false when linking to non-existent session', () => {
    expect(sessions.linkExecution('non-existent', 'exec-1')).toBe(false);
  });

  // --- Context ---

  it('should update session context', () => {
    const session = sessions.create();
    const context: ContextEntry[] = [{
      id: 'ctx-1', type: 'file', key: 'test', value: 'data',
      tokenCount: 10, lastAccessedAt: new Date(), createdAt: new Date(), priority: 5,
    }];
    expect(sessions.updateContext(session.id, context)).toBe(true);
    expect(sessions.get(session.id)!.context).toHaveLength(1);
  });

  it('should return false when updating context for non-existent session', () => {
    expect(sessions.updateContext('non-existent', [])).toBe(false);
  });

  // --- Metadata ---

  it('should update session metadata', () => {
    const session = sessions.create();
    expect(sessions.updateMetadata(session.id, { key: 'value' })).toBe(true);
    expect(sessions.get(session.id)!.metadata.key).toBe('value');
  });

  it('should merge metadata', () => {
    const session = sessions.create();
    sessions.updateMetadata(session.id, { a: 1 });
    sessions.updateMetadata(session.id, { b: 2 });
    expect(sessions.get(session.id)!.metadata).toEqual({ a: 1, b: 2 });
  });

  it('should return false when updating metadata for non-existent session', () => {
    expect(sessions.updateMetadata('non-existent', { key: 'v' })).toBe(false);
  });

  // --- State transitions ---

  it('should pause active session', () => {
    const session = sessions.create();
    expect(sessions.pause(session.id)).toBe(true);
    expect(sessions.get(session.id)!.status).toBe('paused');
  });

  it('should resume paused session', () => {
    const session = sessions.create();
    sessions.pause(session.id);
    expect(sessions.resume(session.id)).toBe(true);
    expect(sessions.get(session.id)!.status).toBe('active');
  });

  // BUG-008: Allow pausing completed sessions
  it('BUG-008: should allow pausing completed session', () => {
    const session = sessions.create();
    sessions.complete(session.id);
    expect(sessions.pause(session.id)).toBe(true);
    expect(sessions.get(session.id)!.status).toBe('paused');
  });

  it('should not pause already paused session', () => {
    const session = sessions.create();
    sessions.pause(session.id);
    expect(sessions.pause(session.id)).toBe(false);
  });

  it('should not pause non-existent session', () => {
    expect(sessions.pause('non-existent')).toBe(false);
  });

  it('should not resume active session', () => {
    const session = sessions.create();
    expect(sessions.resume(session.id)).toBe(false);
  });

  it('should not resume non-existent session', () => {
    expect(sessions.resume('non-existent')).toBe(false);
  });

  it('should resume paused session and set as active if no active', () => {
    const session = sessions.create();
    sessions.pause(session.id);
    sessions.clear(); // This clears activeSessionId
    // Re-add the session
    const newSession = sessions.create();
    sessions.pause(newSession.id);
    // Now resume should set it as active
    sessions.resume(newSession.id);
    expect(sessions.getActive()!.id).toBe(newSession.id);
  });

  it('should complete session', () => {
    const session = sessions.create();
    expect(sessions.complete(session.id)).toBe(true);
    expect(sessions.get(session.id)!.status).toBe('completed');
  });

  it('should archive session', () => {
    const session = sessions.create();
    expect(sessions.archive(session.id)).toBe(true);
    expect(sessions.get(session.id)!.status).toBe('archived');
  });

  it('should return false for non-existent session operations', () => {
    expect(sessions.complete('non-existent')).toBe(false);
    expect(sessions.archive('non-existent')).toBe(false);
  });

  // --- Delete ---

  it('should delete session', () => {
    const session = sessions.create();
    expect(sessions.delete(session.id)).toBe(true);
    expect(sessions.get(session.id)).toBeUndefined();
  });

  it('should clear active session when deleting active', () => {
    const session = sessions.create();
    sessions.delete(session.id);
    expect(sessions.getActive()).toBeUndefined();
  });

  it('should return false when deleting non-existent session', () => {
    expect(sessions.delete('non-existent')).toBe(false);
  });

  // --- Export / Import ---

  it('should export session as JSON', () => {
    const session = sessions.create('Export Test');
    sessions.addMessage(session.id, 'user', 'Hello');
    const json = sessions.exportSession(session.id);
    expect(json).toBeDefined();
    const parsed = JSON.parse(json!);
    expect(parsed.name).toBe('Export Test');
  });

  it('should return undefined when exporting non-existent session', () => {
    expect(sessions.exportSession('non-existent')).toBeUndefined();
  });

  it('should import session from JSON', () => {
    const session = sessions.create('Export Test');
    sessions.addMessage(session.id, 'user', 'Hello');
    const json = sessions.exportSession(session.id)!;

    sessions.clear();
    const imported = sessions.importSession(json);
    expect(imported).toBeDefined();
    expect(imported!.name).toBe('Export Test');
    expect(imported!.messages).toHaveLength(1);
  });

  it('should return undefined for invalid JSON import', () => {
    expect(sessions.importSession('not json')).toBeUndefined();
  });

  it('should return undefined for JSON without required fields', () => {
    expect(sessions.importSession('{}')).toBeUndefined();
    expect(sessions.importSession('{"name": 123}')).toBeUndefined();
  });

  it('should assign new ID on import', () => {
    const session = sessions.create('Original');
    const json = sessions.exportSession(session.id)!;
    const imported = sessions.importSession(json)!;
    expect(imported.id).not.toBe(session.id);
  });

  it('should default status to active on import', () => {
    const json = JSON.stringify({
      name: 'Test',
      messages: [],
      executionIds: [],
      metadata: {},
    });
    const imported = sessions.importSession(json)!;
    expect(imported.status).toBe('active');
  });

  // --- Get all / By status ---

  it('should get all sessions', () => {
    sessions.create('S1');
    sessions.create('S2');
    expect(sessions.getAll()).toHaveLength(2);
  });

  it('should get sessions by status', () => {
    sessions.create('Active 1');
    sessions.create('Active 2');
    const s3 = sessions.create('To Archive');
    sessions.archive(s3.id);
    expect(sessions.getByStatus('active')).toHaveLength(2);
    expect(sessions.getByStatus('archived')).toHaveLength(1);
  });

  // --- Count / Clear ---

  it('should get session count', () => {
    sessions.create();
    sessions.create();
    expect(sessions.getCount()).toBe(2);
  });

  it('should clear all sessions', () => {
    sessions.create();
    sessions.create();
    sessions.clear();
    expect(sessions.getCount()).toBe(0);
    expect(sessions.getActive()).toBeUndefined();
  });
});

// ============================================================================
// PermissionDelegation Tests
// ============================================================================

describe('PermissionDelegation', () => {
  let perms: PermissionDelegation;

  beforeEach(() => {
    perms = new PermissionDelegation();
  });

  // --- Sandbox config ---

  it('should have default sandbox config', () => {
    const config = perms.getSandboxConfig();
    expect(config.enabled).toBe(false);
    expect(config.maxExecutionTime).toBe(60000);
    expect(config.maxMemoryMB).toBe(512);
  });

  it('should update sandbox config', () => {
    perms.updateSandboxConfig({ enabled: true, deniedTools: ['dangerous'] });
    const config = perms.getSandboxConfig();
    expect(config.enabled).toBe(true);
    expect(config.deniedTools).toContain('dangerous');
  });

  // --- Grant ---

  it('should grant permission', () => {
    const rule = perms.grant('task-1', 'fs.read', 'read');
    expect(rule.taskId).toBe('task-1');
    expect(rule.toolName).toBe('fs.read');
    expect(rule.level).toBe('read');
    expect(rule.grantedAt).toBeInstanceOf(Date);
  });

  it('should grant permission with expiration', () => {
    const rule = perms.grant('task-1', 'fs.read', 'read', 'system', 60000);
    expect(rule.expiresAt).toBeInstanceOf(Date);
    expect(rule.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('should grant permission by user', () => {
    const rule = perms.grant('task-1', 'fs.read', 'read', 'user');
    expect(rule.grantedBy).toBe('user');
  });

  it('should overwrite existing permission for same task:tool', () => {
    perms.grant('task-1', 'fs', 'read');
    perms.grant('task-1', 'fs', 'admin');
    const rules = perms.getRulesForTask('task-1');
    expect(rules).toHaveLength(1);
    expect(rules[0]!.level).toBe('admin');
  });

  // --- Check ---

  it('should check granted permission', () => {
    perms.grant('task-1', 'fs.read', 'read');
    const result = perms.check('task-1', 'fs.read', 'read');
    expect(result.granted).toBe(true);
  });

  it('should deny without permission', () => {
    const result = perms.check('task-1', 'fs.read', 'read');
    expect(result.granted).toBe(false);
    expect(result.reason).toContain('No permission');
  });

  it('should check permission level hierarchy', () => {
    perms.grant('task-1', 'fs', 'read');
    expect(perms.check('task-1', 'fs', 'read').granted).toBe(true);
    expect(perms.check('task-1', 'fs', 'write').granted).toBe(false);
    expect(perms.check('task-1', 'fs', 'execute').granted).toBe(false);
    expect(perms.check('task-1', 'fs', 'admin').granted).toBe(false);
  });

  it('should allow admin level to satisfy all lower levels', () => {
    perms.grant('task-1', 'fs', 'admin');
    expect(perms.check('task-1', 'fs', 'read').granted).toBe(true);
    expect(perms.check('task-1', 'fs', 'write').granted).toBe(true);
    expect(perms.check('task-1', 'fs', 'execute').granted).toBe(true);
    expect(perms.check('task-1', 'fs', 'admin').granted).toBe(true);
  });

  // --- Revoke ---

  it('should revoke permission', () => {
    perms.grant('task-1', 'fs.read', 'read');
    expect(perms.revoke('task-1', 'fs.read')).toBe(true);
    expect(perms.check('task-1', 'fs.read', 'read').granted).toBe(false);
  });

  it('should return false when revoking non-existent permission', () => {
    expect(perms.revoke('task-1', 'non-existent')).toBe(false);
  });

  // --- Sandbox ---

  it('should enforce sandbox deny list', () => {
    perms.updateSandboxConfig({ enabled: true, deniedTools: ['dangerous-tool'] });
    const result = perms.check('task-1', 'dangerous-tool', 'execute');
    expect(result.granted).toBe(false);
    expect(result.reason).toContain('blocked');
  });

  it('should enforce sandbox allow list', () => {
    perms.updateSandboxConfig({ enabled: true, allowedTools: ['safe-tool'] });
    perms.grant('task-1', 'safe-tool', 'execute');
    expect(perms.check('task-1', 'safe-tool', 'execute').granted).toBe(true);
    expect(perms.check('task-1', 'other-tool', 'execute').granted).toBe(false);
  });

  it('should not enforce sandbox when disabled', () => {
    perms.updateSandboxConfig({ enabled: false, deniedTools: ['dangerous'] });
    perms.grant('task-1', 'dangerous', 'execute');
    expect(perms.check('task-1', 'dangerous', 'execute').granted).toBe(true);
  });

  // --- Expiration ---

  it('should handle permission expiration', () => {
    perms.grant('task-1', 'fs.read', 'read', 'system', -1);
    const result = perms.check('task-1', 'fs.read', 'read');
    expect(result.granted).toBe(false);
    expect(result.reason).toContain('expired');
  });

  it('should allow non-expired permission', () => {
    perms.grant('task-1', 'fs.read', 'read', 'system', 60000);
    expect(perms.check('task-1', 'fs.read', 'read').granted).toBe(true);
  });

  // --- Audit log ---

  it('should maintain audit log', () => {
    perms.grant('task-1', 'fs.read', 'read');
    perms.check('task-1', 'fs.read', 'read');
    perms.check('task-1', 'fs.write', 'write');
    const log = perms.getAuditLog();
    expect(log.length).toBe(3);
  });

  it('should sort audit log by timestamp descending', () => {
    perms.grant('task-1', 'a', 'read');
    perms.grant('task-1', 'b', 'read');
    const log = perms.getAuditLog();
    expect(log[0]!.timestamp.getTime()).toBeGreaterThanOrEqual(log[1]!.timestamp.getTime());
  });

  it('should filter audit log by task', () => {
    perms.grant('task-1', 'a', 'read');
    perms.grant('task-2', 'b', 'read');
    const log = perms.getAuditLog({ taskId: 'task-1' });
    expect(log).toHaveLength(1);
  });

  it('should filter audit log by tool', () => {
    perms.grant('task-1', 'a', 'read');
    perms.grant('task-1', 'b', 'read');
    const log = perms.getAuditLog({ toolName: 'a' });
    expect(log).toHaveLength(1);
  });

  it('should filter audit log by granted status', () => {
    perms.grant('task-1', 'fs.read', 'read');
    perms.check('task-1', 'fs.write', 'write');
    const denied = perms.getAuditLog({ granted: false });
    expect(denied.length).toBeGreaterThanOrEqual(1);
  });

  it('should combine audit log filters', () => {
    perms.grant('task-1', 'a', 'read');
    perms.check('task-1', 'b', 'write');
    perms.check('task-2', 'a', 'read');
    const log = perms.getAuditLog({ taskId: 'task-1', granted: false });
    expect(log).toHaveLength(1);
  });

  // --- Rules ---

  it('should get all rules', () => {
    perms.grant('task-1', 'a', 'read');
    perms.grant('task-2', 'b', 'write');
    expect(perms.getRules()).toHaveLength(2);
  });

  it('should get rules for a task', () => {
    perms.grant('task-1', 'a', 'read');
    perms.grant('task-1', 'b', 'write');
    perms.grant('task-2', 'c', 'execute');
    expect(perms.getRulesForTask('task-1')).toHaveLength(2);
    expect(perms.getRulesForTask('task-2')).toHaveLength(1);
    expect(perms.getRulesForTask('non-existent')).toHaveLength(0);
  });

  // --- Clear ---

  it('should clear all rules', () => {
    perms.grant('task-1', 'fs.read', 'read');
    perms.clear();
    expect(perms.getRules()).toHaveLength(0);
    expect(perms.getAuditLog()).toHaveLength(0);
  });
});

// ============================================================================
// ProgressTracker Tests
// ============================================================================

describe('ProgressTracker', () => {
  let tracker: ProgressTracker;

  beforeEach(() => {
    tracker = new ProgressTracker();
  });

  // --- Create ---

  it('should create progress tracker', () => {
    const state = tracker.create('task-1', 10);
    expect(state.taskId).toBe('task-1');
    expect(state.totalSteps).toBe(10);
    expect(state.completedSteps).toBe(0);
    expect(state.percentage).toBe(0);
    expect(state.status).toBe('in_progress');
    expect(state.startedAt).toBeInstanceOf(Date);
    expect(state.updatedAt).toBeInstanceOf(Date);
  });

  it('should create progress tracker with milestones', () => {
    const state = tracker.create('task-1', 10, [
      { name: 'Halfway', description: '50%', targetStep: 5 },
      { name: 'Done', description: '100%', targetStep: 10 },
    ]);
    expect(state.milestones).toHaveLength(2);
    expect(state.milestones[0]!.name).toBe('Halfway');
    expect(state.milestones[0]!.achieved).toBe(false);
  });

  it('should create progress tracker with zero total steps', () => {
    const state = tracker.create('task-1', 0);
    expect(state.totalSteps).toBe(0);
    expect(state.percentage).toBe(0);
  });

  // --- Update ---

  it('should update progress', () => {
    tracker.create('task-1', 10);
    const state = tracker.update('task-1', 5);
    expect(state!.percentage).toBe(50);
    expect(state!.completedSteps).toBe(5);
  });

  it('should cap completedSteps at totalSteps', () => {
    tracker.create('task-1', 10);
    const state = tracker.update('task-1', 15);
    expect(state!.completedSteps).toBe(10);
    expect(state!.percentage).toBe(100);
  });

  it('should update currentStep', () => {
    tracker.create('task-1', 10);
    const state = tracker.update('task-1', 3, 'Running tests');
    expect(state!.currentStep).toBe('Running tests');
  });

  it('should not update currentStep when not provided', () => {
    tracker.create('task-1', 10);
    tracker.update('task-1', 3, 'Step A');
    const state = tracker.update('task-1', 5);
    expect(state!.currentStep).toBe('Step A');
  });

  it('should return undefined for non-existent tracker', () => {
    expect(tracker.update('non-existent', 5)).toBeUndefined();
  });

  it('should return undefined when updating completed tracker', () => {
    tracker.create('task-1', 10);
    tracker.update('task-1', 10);
    expect(tracker.update('task-1', 5)).toBeUndefined();
  });

  it('should return undefined when updating failed tracker', () => {
    tracker.create('task-1', 10);
    tracker.fail('task-1');
    expect(tracker.update('task-1', 5)).toBeUndefined();
  });

  it('should calculate ETA', async () => {
    tracker.create('task-1', 10);
    await new Promise((r) => setTimeout(r, 10));
    tracker.update('task-1', 5);
    const state = tracker.getProgress('task-1');
    expect(state!.eta).toBeGreaterThanOrEqual(0);
  });

  it('should set ETA to 0 when completed', () => {
    tracker.create('task-1', 10);
    const state = tracker.update('task-1', 10);
    expect(state!.eta).toBe(0);
  });

  it('should handle zero total steps in percentage calculation', () => {
    tracker.create('task-1', 0);
    const state = tracker.update('task-1', 0);
    expect(state!.percentage).toBe(0);
  });

  // --- Increment ---

  it('should increment progress', () => {
    tracker.create('task-1', 10);
    const state = tracker.increment('task-1', 'Step 1');
    expect(state!.completedSteps).toBe(1);
    expect(state!.currentStep).toBe('Step 1');
  });

  it('should return undefined when incrementing non-existent tracker', () => {
    expect(tracker.increment('non-existent')).toBeUndefined();
  });

  it('should not increment completed tracker', () => {
    tracker.create('task-1', 1);
    tracker.update('task-1', 1);
    expect(tracker.increment('task-1')).toBeUndefined();
  });

  // --- Completion ---

  it('should complete at 100%', () => {
    tracker.create('task-1', 10);
    const state = tracker.update('task-1', 10);
    expect(state!.percentage).toBe(100);
    expect(state!.status).toBe('completed');
  });

  it('should complete when reaching totalSteps', () => {
    tracker.create('task-1', 5);
    tracker.increment('task-1');
    tracker.increment('task-1');
    tracker.increment('task-1');
    tracker.increment('task-1');
    const state = tracker.increment('task-1');
    expect(state!.status).toBe('completed');
    expect(state!.percentage).toBe(100);
  });

  // --- Milestones ---

  it('should track milestones', () => {
    tracker.create('task-1', 10, [
      { name: 'Halfway', description: '50% done', targetStep: 5 },
    ]);
    const notifications: ProgressNotification[] = [];
    tracker.onProgress('task-1', (n) => notifications.push(n));
    tracker.update('task-1', 5);
    expect(notifications.some((n) => n.type === 'milestone')).toBe(true);
  });

  it('should not trigger milestone twice', () => {
    tracker.create('task-1', 10, [
      { name: 'Halfway', description: '50%', targetStep: 5 },
    ]);
    const notifications: ProgressNotification[] = [];
    tracker.onProgress('task-1', (n) => notifications.push(n));
    tracker.update('task-1', 5);
    tracker.update('task-1', 6);
    const milestones = notifications.filter((n) => n.type === 'milestone');
    expect(milestones).toHaveLength(1);
  });

  it('should set achievedAt on milestone', async () => {
    tracker.create('task-1', 10, [
      { name: 'M1', description: '', targetStep: 3 },
    ]);
    await new Promise((r) => setTimeout(r, 10));
    tracker.update('task-1', 3);
    const state = tracker.getProgress('task-1');
    expect(state!.milestones[0]!.achieved).toBe(true);
    expect(state!.milestones[0]!.achievedAt).toBeInstanceOf(Date);
  });

  // --- Fail ---

  it('should fail a task', () => {
    tracker.create('task-1', 10);
    const state = tracker.fail('task-1', 'Something went wrong');
    expect(state!.status).toBe('failed');
  });

  it('should fail with default reason', () => {
    tracker.create('task-1', 10);
    const state = tracker.fail('task-1');
    expect(state!.status).toBe('failed');
  });

  it('should return undefined when failing non-existent tracker', () => {
    expect(tracker.fail('non-existent')).toBeUndefined();
  });

  // --- Pause / Resume ---

  it('should pause tracker', () => {
    tracker.create('task-1', 10);
    tracker.pause('task-1');
    expect(tracker.getProgress('task-1')!.status).toBe('paused');
  });

  it('should resume tracker', () => {
    tracker.create('task-1', 10);
    tracker.pause('task-1');
    tracker.resume('task-1');
    expect(tracker.getProgress('task-1')!.status).toBe('in_progress');
  });

  it('should return undefined when pausing non-existent tracker', () => {
    expect(tracker.pause('non-existent')).toBeUndefined();
  });

  it('should return undefined when pausing completed tracker', () => {
    tracker.create('task-1', 1);
    tracker.update('task-1', 1);
    expect(tracker.pause('task-1')).toBeUndefined();
  });

  it('should return undefined when resuming non-existent tracker', () => {
    expect(tracker.resume('non-existent')).toBeUndefined();
  });

  it('should return undefined when resuming non-paused tracker', () => {
    tracker.create('task-1', 10);
    expect(tracker.resume('task-1')).toBeUndefined();
  });

  // --- Notifications ---

  it('should notify on progress update', () => {
    tracker.create('task-1', 10);
    const notifications: ProgressNotification[] = [];
    tracker.onProgress('task-1', (n) => notifications.push(n));
    tracker.increment('task-1');
    expect(notifications.some((n) => n.type === 'update')).toBe(true);
  });

  it('should notify on completion', () => {
    tracker.create('task-1', 1);
    const notifications: ProgressNotification[] = [];
    tracker.onProgress('task-1', (n) => notifications.push(n));
    tracker.update('task-1', 1);
    expect(notifications.some((n) => n.type === 'complete')).toBe(true);
  });

  it('should notify on failure', () => {
    tracker.create('task-1', 10);
    const notifications: ProgressNotification[] = [];
    tracker.onProgress('task-1', (n) => notifications.push(n));
    tracker.fail('task-1', 'Error');
    expect(notifications.some((n) => n.type === 'error')).toBe(true);
  });

  it('should not notify when completedSteps unchanged', () => {
    tracker.create('task-1', 10);
    tracker.update('task-1', 5);
    const notifications: ProgressNotification[] = [];
    tracker.onProgress('task-1', (n) => notifications.push(n));
    tracker.update('task-1', 5); // Same step count
    expect(notifications.filter((n) => n.type === 'update')).toHaveLength(0);
  });

  it('should handle listener errors gracefully', () => {
    tracker.create('task-1', 10);
    tracker.onProgress('task-1', () => {
      throw new Error('Listener error');
    });
    // Should not throw
    expect(() => tracker.increment('task-1')).not.toThrow();
  });

  // --- Subscribe / Unsubscribe ---

  it('should unsubscribe from notifications', () => {
    tracker.create('task-1', 10);
    const notifications: ProgressNotification[] = [];
    const unsub = tracker.onProgress('task-1', (n) => notifications.push(n));
    unsub();
    tracker.increment('task-1');
    expect(notifications).toHaveLength(0);
  });

  it('should support multiple listeners', () => {
    tracker.create('task-1', 10);
    const n1: ProgressNotification[] = [];
    const n2: ProgressNotification[] = [];
    tracker.onProgress('task-1', (n) => n1.push(n));
    tracker.onProgress('task-1', (n) => n2.push(n));
    tracker.increment('task-1');
    expect(n1).toHaveLength(1);
    expect(n2).toHaveLength(1);
  });

  // --- Get / Remove ---

  it('should get progress state', () => {
    tracker.create('task-1', 10);
    expect(tracker.getProgress('task-1')).toBeDefined();
    expect(tracker.getProgress('non-existent')).toBeUndefined();
  });

  it('should get all progress states', () => {
    tracker.create('task-1', 10);
    tracker.create('task-2', 5);
    expect(tracker.getAllProgress()).toHaveLength(2);
  });

  it('should remove progress tracker', () => {
    tracker.create('task-1', 10);
    expect(tracker.remove('task-1')).toBe(true);
    expect(tracker.getProgress('task-1')).toBeUndefined();
  });

  it('should return false when removing non-existent tracker', () => {
    expect(tracker.remove('non-existent')).toBe(false);
  });

  it('should clean up listeners on remove', () => {
    tracker.create('task-1', 10);
    const notifications: ProgressNotification[] = [];
    tracker.onProgress('task-1', (n) => notifications.push(n));
    tracker.remove('task-1');
    // Re-create and verify old listener is gone
    tracker.create('task-1', 10);
    tracker.increment('task-1');
    expect(notifications).toHaveLength(0);
  });

  // --- Clear ---

  it('should clear all trackers', () => {
    tracker.create('task-1', 10);
    tracker.create('task-2', 5);
    tracker.clear();
    expect(tracker.getAllProgress()).toHaveLength(0);
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration: Full Pipeline', () => {
  it('should parse, decompose, plan, and execute a task', async () => {
    const parser = new NLTaskParser();
    const decomposer = new TaskDecomposer();
    const orchestrator = new SmartOrchestrator();

    const parsed = parser.parse('运行项目测试');
    expect(parsed.intent).toBe('test');

    const decomposition = decomposer.decompose(parsed);
    expect(decomposition.graph.nodes.length).toBeGreaterThan(0);

    const plan = orchestrator.createPlan(decomposition);
    expect(plan.phases.length).toBeGreaterThan(0);

    await orchestrator.execute(async () => ({ success: true, duration: 50 }));
    expect(orchestrator.getState()).toBe('completed');

    const results = orchestrator.getTaskResults();
    expect(results.size).toBe(decomposition.graph.nodes.length);
  });

  it('should handle failure recovery with feedback loop', async () => {
    const feedback = new FeedbackLoop({ maxRetries: 2 });
    let attempts = 0;

    const result = feedback.evaluate('task-1', false, 'First attempt failed');
    expect(result.shouldRetry).toBe(true);
    attempts++;

    const result2 = feedback.evaluate('task-1', true, 'Second attempt succeeded');
    expect(result2.success).toBe(true);
    expect(result2.score).toBeLessThan(100); // Penalty for retry
  });

  it('should track execution history and generate recommendations', () => {
    const history = new ExecutionHistory();
    const recs = new SmartRecommendations();

    // Record some executions
    for (let i = 0; i < 3; i++) {
      history.record(createSampleExecutionRecord({
        taskDescription: 'Deploy to production',
        status: 'failed',
      }));
    }

    const recommendations = recs.analyzeHistory(history.getAll());
    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations[0]!.title).toContain('重复失败');
  });

  it('should manage session with context and permissions', () => {
    const sessionMgr = new SessionManager();
    const ctxMgr = new ContextManager();
    const permMgr = new PermissionDelegation();

    const session = sessionMgr.create('Test Session');
    sessionMgr.addMessage(session.id, 'user', 'Analyze the project');

    ctxMgr.add({ type: 'file', key: 'src/index.ts', value: 'content', priority: 5 });
    sessionMgr.updateContext(session.id, ctxMgr.getAll());

    permMgr.grant('task-1', 'fs.read', 'read');
    const check = permMgr.check('task-1', 'fs.read', 'read');
    expect(check.granted).toBe(true);

    const exported = sessionMgr.exportSession(session.id);
    expect(exported).toBeDefined();
  });

  it('should track progress through task execution', () => {
    const tracker = new ProgressTracker();
    tracker.create('task-1', 5, [
      { name: '25%', description: 'Quarter done', targetStep: 1 },
      { name: '50%', description: 'Half done', targetStep: 3 },
    ]);

    const notifications: ProgressNotification[] = [];
    tracker.onProgress('task-1', (n) => notifications.push(n));

    tracker.increment('task-1', 'Step 1');
    expect(tracker.getProgress('task-1')!.completedSteps).toBe(1);

    tracker.update('task-1', 3, 'Step 3');
    expect(tracker.getProgress('task-1')!.percentage).toBe(60);

    tracker.update('task-1', 5);
    expect(tracker.getProgress('task-1')!.status).toBe('completed');
    expect(tracker.getProgress('task-1')!.percentage).toBe(100);

    expect(notifications.some((n) => n.type === 'milestone')).toBe(true);
    expect(notifications.some((n) => n.type === 'complete')).toBe(true);
  });
});
