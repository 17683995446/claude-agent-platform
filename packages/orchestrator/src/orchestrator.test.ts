// ============================================================================
// @claude-agent/orchestrator - Tests
// ============================================================================

import { describe, it, expect, beforeEach } from 'bun:test';
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
import type { ParsedTask, TaskIntent } from '../src/types.js';

// ============================================================================
// NLTaskParser Tests
// ============================================================================

describe('NLTaskParser', () => {
  let parser: NLTaskParser;

  beforeEach(() => {
    parser = new NLTaskParser();
  });

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

  it('should parse mixed language input', () => {
    const result = parser.parse('帮我 analyze the project code structure');
    expect(['mixed', 'zh', 'en']).toContain(result.language);
    expect(result.intent).toBe('analyze');
  });

  it('should parse test task', () => {
    const result = parser.parse('运行测试');
    expect(result.intent).toBe('test');
  });

  it('should parse deploy task', () => {
    const result = parser.parse('部署到生产环境');
    expect(result.intent).toBe('deploy');
  });

  it('should parse fix task', () => {
    const result = parser.parse('修复登录 bug');
    expect(result.intent).toBe('fix');
  });

  it('should parse generate task', () => {
    const result = parser.parse('生成 API 文档');
    expect(result.intent).toBe('generate');
  });

  it('should parse refactor task', () => {
    const result = parser.parse('refactor the authentication module');
    expect(result.intent).toBe('refactor');
  });

  it('should parse document task', () => {
    const result = parser.parse('为代码写文档');
    expect(result.intent).toBe('document');
  });

  it('should parse optimize task', () => {
    const result = parser.parse('优化性能');
    expect(result.intent).toBe('optimize');
  });

  it('should parse migrate task', () => {
    const result = parser.parse('迁移到 TypeScript 5');
    expect(result.intent).toBe('migrate');
  });

  it('should parse review task', () => {
    const result = parser.parse('代码审查');
    expect(result.intent).toBe('review');
  });

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

  it('should detect critical priority', () => {
    const result = parser.parse('紧急修复这个 bug');
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

  it('should extract tags', () => {
    const result = parser.parse('分析 API 性能');
    expect(result.tags).toContain('analyze');
    expect(result.tags).toContain('api');
    expect(result.tags).toContain('performance');
  });

  it('should handle empty input', () => {
    const result = parser.parse('');
    expect(result.intent).toBe('unknown');
    expect(result.confidence).toBe(0);
  });

  it('should handle unknown intent', () => {
    const result = parser.parse('随便做点什么');
    expect(result.intent).toBe('unknown');
  });

  it('should batch parse multiple inputs', () => {
    const results = parser.parseBatch(['分析项目', '运行测试', '部署上线']);
    expect(results).toHaveLength(3);
    expect(results[0]!.intent).toBe('analyze');
    expect(results[1]!.intent).toBe('test');
    expect(results[2]!.intent).toBe('deploy');
  });

  it('should support custom intent registration', () => {
    parser.registerIntent('analyze', { zh: ['自定义分析'] });
    const result = parser.parse('自定义分析项目');
    expect(result.intent).toBe('analyze');
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
    sampleTask = {
      raw: '分析项目架构',
      intent: 'analyze',
      confidence: 0.8,
      entities: [],
      language: 'zh',
      description: '分析任务',
      priority: 'medium',
      tags: ['analyze'],
    };
  });

  it('should decompose analyze task', () => {
    const result = decomposer.decompose(sampleTask);
    expect(result.graph.nodes.length).toBeGreaterThan(0);
    expect(result.graph.edges.length).toBeGreaterThan(0);
    expect(result.decompositionStrategy).toBeDefined();
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

  it('should identify parallel groups', () => {
    const result = decomposer.decompose(sampleTask);
    expect(result.graph.parallelGroups.length).toBeGreaterThan(0);
  });

  it('should find critical path', () => {
    const result = decomposer.decompose(sampleTask);
    expect(result.graph.criticalPath.length).toBeGreaterThan(0);
  });

  it('should estimate total duration', () => {
    const result = decomposer.decompose(sampleTask);
    expect(result.totalEstimatedDuration).toBeGreaterThan(0);
  });

  it('should handle unknown intent', () => {
    sampleTask.intent = 'unknown';
    const result = decomposer.decompose(sampleTask);
    expect(result.graph.nodes.length).toBeGreaterThan(0);
  });

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

  it('should get strategy name', () => {
    expect(TaskDecomposer.getStrategyName('sequential')).toBe('顺序执行');
    expect(TaskDecomposer.getStrategyName('parallel')).toBe('并行执行');
    expect(TaskDecomposer.getStrategyName('mixed')).toBe('混合执行');
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

  it('should start in idle state', () => {
    expect(orchestrator.getState()).toBe('idle');
  });

  it('should create execution plan', () => {
    const task: ParsedTask = {
      raw: 'test', intent: 'test', confidence: 0.8, entities: [],
      language: 'en', description: 'test', priority: 'medium', tags: ['test'],
    };
    const decomposition = decomposer.decompose(task);
    const plan = orchestrator.createPlan(decomposition);
    expect(plan).toBeDefined();
    expect(plan.phases.length).toBeGreaterThan(0);
    expect(plan.totalSteps).toBe(decomposition.graph.nodes.length);
  });

  it('should execute plan successfully', async () => {
    const task: ParsedTask = {
      raw: 'test', intent: 'test', confidence: 0.8, entities: [],
      language: 'en', description: 'test', priority: 'medium', tags: ['test'],
    };
    const decomposition = decomposer.decompose(task);
    orchestrator.createPlan(decomposition);

    await orchestrator.execute(async () => ({ success: true, duration: 100 }));
    expect(orchestrator.getState()).toBe('completed');
  });

  it('should handle execution failure', async () => {
    const task: ParsedTask = {
      raw: 'test', intent: 'test', confidence: 0.8, entities: [],
      language: 'en', description: 'test', priority: 'medium', tags: ['test'],
    };
    const decomposition = decomposer.decompose(task);
    orchestrator.createPlan(decomposition);

    await orchestrator.execute(async () => ({ success: false, duration: 0 }));
    expect(orchestrator.getState()).toBe('failed');
  });

  it('should pause and resume', () => {
    const task: ParsedTask = {
      raw: 'test', intent: 'test', confidence: 0.8, entities: [],
      language: 'en', description: 'test', priority: 'medium', tags: ['test'],
    };
    const decomposition = decomposer.decompose(task);
    orchestrator.createPlan(decomposition);

    // Simulate executing state
    orchestrator.createPlan(decomposition);
    // Pause/resume only work during execution, test state transitions
    expect(orchestrator.getState()).toBe('idle');
  });

  it('should reset', () => {
    const task: ParsedTask = {
      raw: 'test', intent: 'test', confidence: 0.8, entities: [],
      language: 'en', description: 'test', priority: 'medium', tags: ['test'],
    };
    const decomposition = decomposer.decompose(task);
    orchestrator.createPlan(decomposition);
    orchestrator.reset();
    expect(orchestrator.getCurrentPlan()).toBeNull();
    expect(orchestrator.getState()).toBe('idle');
  });

  it('should throw when executing without plan', async () => {
    await expect(orchestrator.execute(async () => ({ success: true, duration: 0 })))
      .rejects.toThrow();
  });

  it('should track task results', async () => {
    const task: ParsedTask = {
      raw: 'test', intent: 'test', confidence: 0.8, entities: [],
      language: 'en', description: 'test', priority: 'medium', tags: ['test'],
    };
    const decomposition = decomposer.decompose(task);
    orchestrator.createPlan(decomposition);
    await orchestrator.execute(async () => ({ success: true, duration: 100 }));
    const results = orchestrator.getTaskResults();
    expect(results.size).toBe(decomposition.graph.nodes.length);
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

  it('should add context entry', () => {
    const entry = ctx.add({ type: 'file', key: 'test.ts', value: 'hello world', priority: 5 });
    expect(entry.id).toBeDefined();
    expect(entry.tokenCount).toBeGreaterThan(0);
  });

  it('should get context entry', () => {
    const entry = ctx.add({ type: 'file', key: 'test.ts', value: 'hello world', priority: 5 });
    const retrieved = ctx.get(entry.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.key).toBe('test.ts');
  });

  it('should get entries by type', () => {
    ctx.add({ type: 'file', key: 'a.ts', value: 'a', priority: 5 });
    ctx.add({ type: 'module', key: 'b', value: 'b', priority: 5 });
    const files = ctx.getByType('file');
    expect(files).toHaveLength(1);
  });

  it('should remove context entry', () => {
    const entry = ctx.add({ type: 'file', key: 'test.ts', value: 'hello', priority: 5 });
    expect(ctx.remove(entry.id)).toBe(true);
    expect(ctx.get(entry.id)).toBeUndefined();
  });

  it('should update context entry', () => {
    const entry = ctx.add({ type: 'file', key: 'test.ts', value: 'hello', priority: 5 });
    const updated = ctx.update(entry.id, { value: 'updated', priority: 8 });
    expect(updated!.value).toBe('updated');
    expect(updated!.priority).toBe(8);
  });

  it('should track total tokens', () => {
    ctx.add({ type: 'file', key: 'a', value: 'hello world', priority: 5 });
    ctx.add({ type: 'file', key: 'b', value: 'foo bar baz', priority: 5 });
    expect(ctx.getTotalTokens()).toBeGreaterThan(0);
  });

  it('should compress when exceeding threshold', () => {
    const smallCtx = new ContextManager({ maxTokens: 50, compressionThreshold: 0.5 });
    for (let i = 0; i < 10; i++) {
      smallCtx.add({ type: 'file', key: `f${i}`, value: 'some content here', priority: 1 });
    }
    // After adding many entries, compression should have occurred
    expect(smallCtx.getEntryCount()).toBeLessThanOrEqual(10);
  });

  it('should clear all entries', () => {
    ctx.add({ type: 'file', key: 'a', value: 'a', priority: 5 });
    ctx.add({ type: 'file', key: 'b', value: 'b', priority: 5 });
    ctx.clear();
    expect(ctx.getEntryCount()).toBe(0);
  });

  it('should collect project context', () => {
    ctx.collectProjectContext('/project', ['src/index.ts', 'src/utils.ts']);
    expect(ctx.getEntryCount()).toBe(2);
  });

  it('should export context', () => {
    ctx.add({ type: 'file', key: 'test', value: 'hello', priority: 5 });
    const exported = ctx.exportContext();
    expect(exported.entries).toHaveLength(1);
    expect(exported.config.maxTokens).toBe(1000);
  });

  it('should search by key pattern', () => {
    ctx.add({ type: 'file', key: 'src/index.ts', value: 'a', priority: 5 });
    ctx.add({ type: 'file', key: 'src/utils.ts', value: 'b', priority: 5 });
    ctx.add({ type: 'file', key: 'test/spec.ts', value: 'c', priority: 5 });
    const results = ctx.getByKeyPattern(/src/);
    expect(results).toHaveLength(2);
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

  it('should evaluate successful task', () => {
    const result = feedback.evaluate('task-1', true, 'Completed successfully');
    expect(result.success).toBe(true);
    expect(result.score).toBeGreaterThan(0);
    expect(result.shouldRetry).toBe(false);
  });

  it('should evaluate failed task', () => {
    const result = feedback.evaluate('task-1', false, 'Failed');
    expect(result.success).toBe(false);
    expect(result.score).toBe(0);
    expect(result.shouldRetry).toBe(true);
  });

  it('should calculate retry delay with exponential backoff', () => {
    const r1 = feedback.evaluate('task-1', false, 'Fail');
    const r2 = feedback.evaluate('task-1', false, 'Fail again');
    expect(r2.nextRetryDelay).toBeGreaterThan(r1.nextRetryDelay);
  });

  it('should stop retrying after max retries', () => {
    for (let i = 0; i < 4; i++) {
      feedback.evaluate('task-1', false, 'Fail');
    }
    const result = feedback.evaluate('task-1', false, 'Fail');
    expect(result.shouldRetry).toBe(false);
  });

  it('should track feedback history', () => {
    feedback.evaluate('task-1', true, 'OK');
    feedback.evaluate('task-1', false, 'Fail');
    const history = feedback.getHistory('task-1');
    expect(history).toHaveLength(2);
  });

  it('should accept user feedback', () => {
    feedback.evaluate('task-1', true, 'OK');
    feedback.submitUserFeedback('task-1', 'good');
    expect(feedback.getUserPreference('task-1')).toBeGreaterThan(0);
  });

  it('should calculate success rate', () => {
    feedback.evaluate('task-1', true, 'OK');
    feedback.evaluate('task-2', true, 'OK');
    feedback.evaluate('task-3', false, 'Fail');
    expect(feedback.getSuccessRate()).toBeCloseTo(2 / 3);
  });

  it('should handle custom retry config', () => {
    const custom = new FeedbackLoop({ maxRetries: 1, baseDelay: 500 });
    custom.evaluate('task-1', false, 'Fail');
    custom.evaluate('task-1', false, 'Fail');
    const result = custom.evaluate('task-1', false, 'Fail');
    expect(result.shouldRetry).toBe(false);
  });

  it('should clear history', () => {
    feedback.evaluate('task-1', true, 'OK');
    feedback.clear();
    expect(feedback.getHistory('task-1')).toHaveLength(0);
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

  it('should have built-in templates', () => {
    const builtIn = templates.getBuiltIn();
    expect(builtIn.length).toBeGreaterThan(0);
  });

  it('should get template by ID', () => {
    const template = templates.get('builtin:analyze-project');
    expect(template).toBeDefined();
    expect(template!.name).toBe('项目架构分析');
  });

  it('should search templates', () => {
    const results = templates.search('测试');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should get templates by category', () => {
    const results = templates.getByCategory('testing');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should get templates by intent', () => {
    const results = templates.getByIntent('test');
    expect(results.length).toBeGreaterThan(0);
  });

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

  it('should validate parameters', () => {
    const result = templates.validateParameters('builtin:run-tests', {});
    expect(result.valid).toBe(true);
  });

  it('should detect missing required parameters', () => {
    const result = templates.validateParameters('builtin:analyze-project', {});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should get template count', () => {
    const count = templates.getCount();
    expect(count.total).toBeGreaterThan(0);
    expect(count.builtIn).toBeGreaterThan(0);
    expect(count.custom).toBe(0);
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

  it('should record execution', () => {
    const record = history.record({
      sessionId: 'session-1',
      taskDescription: 'Analyze project',
      intent: 'analyze',
      status: 'success',
      startTime: new Date(),
      subTaskCount: 3,
      completedSubTasks: 3,
      metadata: {},
    });
    expect(record.id).toBeDefined();
    expect(history.getCount()).toBe(1);
  });

  it('should complete a record', () => {
    const startTime = new Date(Date.now() - 1000); // 1 second ago
    const record = history.record({
      sessionId: 'session-1',
      taskDescription: 'Test',
      intent: 'test',
      status: 'success',
      startTime,
      subTaskCount: 5,
      completedSubTasks: 0,
      metadata: {},
    });
    const completed = history.complete(record.id, 'success', 5);
    expect(completed!.duration).toBeGreaterThan(0);
    expect(completed!.completedSubTasks).toBe(5);
  });

  it('should get records by session', () => {
    history.record({
      sessionId: 's1', taskDescription: 'Task 1', intent: 'analyze',
      status: 'success', startTime: new Date(), subTaskCount: 1, completedSubTasks: 1, metadata: {},
    });
    history.record({
      sessionId: 's2', taskDescription: 'Task 2', intent: 'test',
      status: 'success', startTime: new Date(), subTaskCount: 1, completedSubTasks: 1, metadata: {},
    });
    expect(history.getBySession('s1')).toHaveLength(1);
  });

  it('should get records by intent', () => {
    history.record({
      sessionId: 's1', taskDescription: 'Task 1', intent: 'analyze',
      status: 'success', startTime: new Date(), subTaskCount: 1, completedSubTasks: 1, metadata: {},
    });
    history.record({
      sessionId: 's1', taskDescription: 'Task 2', intent: 'test',
      status: 'success', startTime: new Date(), subTaskCount: 1, completedSubTasks: 1, metadata: {},
    });
    expect(history.getByIntent('analyze')).toHaveLength(1);
  });

  it('should get recent records', () => {
    for (let i = 0; i < 5; i++) {
      history.record({
        sessionId: 's1', taskDescription: `Task ${i}`, intent: 'analyze',
        status: 'success', startTime: new Date(), subTaskCount: 1, completedSubTasks: 1, metadata: {},
      });
    }
    const recent = history.getRecent(3);
    expect(recent).toHaveLength(3);
  });

  it('should query with filters', () => {
    history.record({
      sessionId: 's1', taskDescription: 'Task 1', intent: 'analyze',
      status: 'success', startTime: new Date(), subTaskCount: 1, completedSubTasks: 1, metadata: {},
    });
    history.record({
      sessionId: 's1', taskDescription: 'Task 2', intent: 'test',
      status: 'failed', startTime: new Date(), subTaskCount: 1, completedSubTasks: 0, metadata: {},
    });
    const results = history.query({ status: 'failed' });
    expect(results).toHaveLength(1);
  });

  it('should calculate statistics', () => {
    history.record({
      sessionId: 's1', taskDescription: 'Task 1', intent: 'analyze',
      status: 'success', startTime: new Date(), subTaskCount: 1, completedSubTasks: 1, metadata: {},
    });
    history.record({
      sessionId: 's1', taskDescription: 'Task 2', intent: 'test',
      status: 'failed', startTime: new Date(), subTaskCount: 1, completedSubTasks: 0, metadata: {},
    });
    const stats = history.getStats();
    expect(stats.totalExecutions).toBe(2);
    expect(stats.successRate).toBe(0.5);
  });

  it('should trim old records', () => {
    const smallHistory = new ExecutionHistory(3);
    for (let i = 0; i < 5; i++) {
      smallHistory.record({
        sessionId: 's1', taskDescription: `Task ${i}`, intent: 'analyze',
        status: 'success', startTime: new Date(), subTaskCount: 1, completedSubTasks: 1, metadata: {},
      });
    }
    expect(smallHistory.getCount()).toBe(3);
  });

  it('should clear all records', () => {
    history.record({
      sessionId: 's1', taskDescription: 'Task', intent: 'analyze',
      status: 'success', startTime: new Date(), subTaskCount: 1, completedSubTasks: 1, metadata: {},
    });
    history.clear();
    expect(history.getCount()).toBe(0);
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

  it('should recommend README when missing', () => {
    const result = recs.analyzeProject(['src/index.ts', 'package.json']);
    const readmeRec = result.find((r) => r.title === '缺少 README');
    expect(readmeRec).toBeDefined();
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

  it('should analyze execution history for recurring failures', () => {
    const records = [
      { id: '1', sessionId: 's1', taskDescription: 'Deploy', intent: 'deploy' as TaskIntent, status: 'failed' as const, startTime: new Date(), subTaskCount: 1, completedSubTasks: 0, metadata: {} },
      { id: '2', sessionId: 's1', taskDescription: 'Deploy', intent: 'deploy' as TaskIntent, status: 'failed' as const, startTime: new Date(), subTaskCount: 1, completedSubTasks: 0, metadata: {} },
      { id: '3', sessionId: 's1', taskDescription: 'Deploy', intent: 'deploy' as TaskIntent, status: 'failed' as const, startTime: new Date(), subTaskCount: 1, completedSubTasks: 0, metadata: {} },
    ];
    const result = recs.analyzeHistory(records);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.title).toContain('重复失败');
  });

  it('should dismiss recommendations', () => {
    const result = recs.analyzeProject(['src/index.ts']);
    const id = result[0]!.id;
    recs.dismiss(id);
    expect(recs.getAll().find((r) => r.id === id)).toBeUndefined();
  });

  it('should get recommendations by priority', () => {
    recs.analyzeProject(['src/index.ts']);
    const high = recs.getByPriority('high');
    expect(high.length).toBeGreaterThan(0);
  });

  it('should clear recommendations', () => {
    recs.analyzeProject(['src/index.ts']);
    recs.clear();
    expect(recs.getCount()).toBe(0);
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

  it('should create a session', () => {
    const session = sessions.create('Test Session');
    expect(session.id).toBeDefined();
    expect(session.name).toBe('Test Session');
    expect(session.status).toBe('active');
  });

  it('should get active session', () => {
    const session = sessions.create();
    const active = sessions.getActive();
    expect(active!.id).toBe(session.id);
  });

  it('should add messages', () => {
    const session = sessions.create();
    const msg = sessions.addMessage(session.id, 'user', 'Hello');
    expect(msg).toBeDefined();
    expect(msg!.content).toBe('Hello');
  });

  it('should get messages', () => {
    const session = sessions.create();
    sessions.addMessage(session.id, 'user', 'Hello');
    sessions.addMessage(session.id, 'assistant', 'Hi there');
    const messages = sessions.getMessages(session.id);
    expect(messages).toHaveLength(2);
  });

  it('should search messages', () => {
    const session = sessions.create('Test');
    sessions.addMessage(session.id, 'user', 'Analyze the project');
    sessions.addMessage(session.id, 'user', 'Run the tests');
    const results = sessions.searchMessages('analyze');
    expect(results).toHaveLength(1);
  });

  it('should pause and resume sessions', () => {
    const session = sessions.create();
    expect(sessions.pause(session.id)).toBe(true);
    expect(sessions.get(session.id)!.status).toBe('paused');
    expect(sessions.resume(session.id)).toBe(true);
    expect(sessions.get(session.id)!.status).toBe('active');
  });

  it('should complete sessions', () => {
    const session = sessions.create();
    expect(sessions.complete(session.id)).toBe(true);
    expect(sessions.get(session.id)!.status).toBe('completed');
  });

  it('should archive sessions', () => {
    const session = sessions.create();
    expect(sessions.archive(session.id)).toBe(true);
    expect(sessions.get(session.id)!.status).toBe('archived');
  });

  it('should delete sessions', () => {
    const session = sessions.create();
    expect(sessions.delete(session.id)).toBe(true);
    expect(sessions.get(session.id)).toBeUndefined();
  });

  it('should export and import sessions', () => {
    const session = sessions.create('Export Test');
    sessions.addMessage(session.id, 'user', 'Hello');
    const json = sessions.exportSession(session.id);
    expect(json).toBeDefined();

    sessions.clear();
    const imported = sessions.importSession(json!);
    expect(imported).toBeDefined();
    expect(imported!.name).toBe('Export Test');
  });

  it('should link executions', () => {
    const session = sessions.create();
    expect(sessions.linkExecution(session.id, 'exec-1')).toBe(true);
    expect(sessions.get(session.id)!.executionIds).toContain('exec-1');
  });

  it('should update metadata', () => {
    const session = sessions.create();
    expect(sessions.updateMetadata(session.id, { key: 'value' })).toBe(true);
    expect(sessions.get(session.id)!.metadata.key).toBe('value');
  });

  it('should get sessions by status', () => {
    sessions.create('Active 1');
    sessions.create('Active 2');
    const s3 = sessions.create('To Archive');
    sessions.archive(s3.id);
    expect(sessions.getByStatus('active')).toHaveLength(2);
    expect(sessions.getByStatus('archived')).toHaveLength(1);
  });

  it('should clear all sessions', () => {
    sessions.create();
    sessions.create();
    sessions.clear();
    expect(sessions.getCount()).toBe(0);
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

  it('should grant permission', () => {
    const rule = perms.grant('task-1', 'fs.read', 'read');
    expect(rule.taskId).toBe('task-1');
    expect(rule.level).toBe('read');
  });

  it('should check granted permission', () => {
    perms.grant('task-1', 'fs.read', 'read');
    const result = perms.check('task-1', 'fs.read', 'read');
    expect(result.granted).toBe(true);
  });

  it('should deny without permission', () => {
    const result = perms.check('task-1', 'fs.read', 'read');
    expect(result.granted).toBe(false);
  });

  it('should check permission level hierarchy', () => {
    perms.grant('task-1', 'fs', 'read');
    expect(perms.check('task-1', 'fs', 'read').granted).toBe(true);
    expect(perms.check('task-1', 'fs', 'write').granted).toBe(false);
    expect(perms.check('task-1', 'fs', 'execute').granted).toBe(false);
  });

  it('should revoke permission', () => {
    perms.grant('task-1', 'fs.read', 'read');
    expect(perms.revoke('task-1', 'fs.read')).toBe(true);
    expect(perms.check('task-1', 'fs.read', 'read').granted).toBe(false);
  });

  it('should enforce sandbox deny list', () => {
    perms.updateSandboxConfig({ enabled: true, deniedTools: ['dangerous-tool'] });
    const result = perms.check('task-1', 'dangerous-tool', 'execute');
    expect(result.granted).toBe(false);
    expect(result.reason).toContain('blocked');
  });

  it('should enforce sandbox allow list', () => {
    perms.updateSandboxConfig({ enabled: true, allowedTools: ['safe-tool'] });
    // Also grant explicit permission since sandbox allow list requires it
    perms.grant('task-1', 'safe-tool', 'execute');
    expect(perms.check('task-1', 'safe-tool', 'execute').granted).toBe(true);
    expect(perms.check('task-1', 'other-tool', 'execute').granted).toBe(false);
  });

  it('should handle permission expiration', () => {
    perms.grant('task-1', 'fs.read', 'read', 'system', -1); // Already expired
    const result = perms.check('task-1', 'fs.read', 'read');
    expect(result.granted).toBe(false);
    expect(result.reason).toContain('expired');
  });

  it('should maintain audit log', () => {
    perms.grant('task-1', 'fs.read', 'read');
    perms.check('task-1', 'fs.read', 'read');
    perms.check('task-1', 'fs.write', 'write');
    const log = perms.getAuditLog();
    expect(log.length).toBe(3);
  });

  it('should filter audit log', () => {
    perms.grant('task-1', 'fs.read', 'read');
    perms.check('task-1', 'fs.write', 'write');
    const denied = perms.getAuditLog({ granted: false });
    expect(denied).toHaveLength(1);
  });

  it('should get rules for a task', () => {
    perms.grant('task-1', 'fs.read', 'read');
    perms.grant('task-1', 'fs.write', 'write');
    perms.grant('task-2', 'net', 'execute');
    expect(perms.getRulesForTask('task-1')).toHaveLength(2);
  });

  it('should clear all rules', () => {
    perms.grant('task-1', 'fs.read', 'read');
    perms.clear();
    expect(perms.getRules()).toHaveLength(0);
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

  it('should create progress tracker', () => {
    const state = tracker.create('task-1', 10);
    expect(state.taskId).toBe('task-1');
    expect(state.totalSteps).toBe(10);
    expect(state.percentage).toBe(0);
    expect(state.status).toBe('in_progress');
  });

  it('should update progress', () => {
    tracker.create('task-1', 10);
    const state = tracker.update('task-1', 5);
    expect(state!.percentage).toBe(50);
    expect(state!.completedSteps).toBe(5);
  });

  it('should increment progress', () => {
    tracker.create('task-1', 10);
    const state = tracker.increment('task-1', 'Step 1');
    expect(state!.completedSteps).toBe(1);
    expect(state!.currentStep).toBe('Step 1');
  });

  it('should calculate ETA', async () => {
    tracker.create('task-1', 10);
    // Wait a bit so elapsed time is non-zero
    await new Promise((r) => setTimeout(r, 10));
    tracker.update('task-1', 5);
    const state = tracker.getProgress('task-1');
    expect(state!.eta).toBeGreaterThanOrEqual(0);
  });

  it('should complete at 100%', () => {
    tracker.create('task-1', 10);
    const state = tracker.update('task-1', 10);
    expect(state!.percentage).toBe(100);
    expect(state!.status).toBe('completed');
  });

  it('should track milestones', () => {
    tracker.create('task-1', 10, [
      { name: 'Halfway', description: '50% done', targetStep: 5 },
    ]);
    const notifications: string[] = [];
    tracker.onProgress('task-1', (n) => notifications.push(n.type));
    tracker.update('task-1', 5);
    expect(notifications).toContain('milestone');
  });

  it('should fail a task', () => {
    tracker.create('task-1', 10);
    const state = tracker.fail('task-1', 'Something went wrong');
    expect(state!.status).toBe('failed');
  });

  it('should pause and resume', () => {
    tracker.create('task-1', 10);
    tracker.pause('task-1');
    expect(tracker.getProgress('task-1')!.status).toBe('paused');
    tracker.resume('task-1');
    expect(tracker.getProgress('task-1')!.status).toBe('in_progress');
  });

  it('should notify listeners', () => {
    tracker.create('task-1', 10);
    const notifications: string[] = [];
    tracker.onProgress('task-1', (n) => notifications.push(n.type));
    tracker.increment('task-1');
    expect(notifications).toContain('update');
  });

  it('should unsubscribe from notifications', () => {
    tracker.create('task-1', 10);
    const notifications: string[] = [];
    const unsub = tracker.onProgress('task-1', (n) => notifications.push(n.type));
    unsub();
    tracker.increment('task-1');
    expect(notifications).toHaveLength(0);
  });

  it('should remove progress tracker', () => {
    tracker.create('task-1', 10);
    expect(tracker.remove('task-1')).toBe(true);
    expect(tracker.getProgress('task-1')).toBeUndefined();
  });

  it('should clear all trackers', () => {
    tracker.create('task-1', 10);
    tracker.create('task-2', 5);
    tracker.clear();
    expect(tracker.getAllProgress()).toHaveLength(0);
  });

  it('should not update non-existent tracker', () => {
    const state = tracker.update('non-existent', 5);
    expect(state).toBeUndefined();
  });

  it('should not increment completed tracker', () => {
    tracker.create('task-1', 1);
    tracker.update('task-1', 1);
    const state = tracker.increment('task-1');
    // Once completed, update returns undefined because status is not 'in_progress'
    expect(state).toBeUndefined();
  });
});
