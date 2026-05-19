import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  WorkflowEngine,
  DAGExecutor,
  CycleDetectedError,
  ConditionEvaluator,
  ConditionParseError,
  ParallelExecutor,
  TransformEngine,
  WorkflowErrorHandler,
  InMemoryWorkflowStore,
  WorkflowEventEmitter,
  WorkflowMonitor,
  WorkflowTemplateLibrary,
} from '../src/index.js';
import type {
  WorkflowDefinition,
  DAGNode,
  ParallelTask,
  TransformStep,
} from '../src/index.js';

// ============================================================
// Module 1: Workflow Engine Tests
// ============================================================
describe('WorkflowEngine', () => {
  let engine: WorkflowEngine;

  beforeEach(() => {
    engine = new WorkflowEngine();
  });

  test('should define a workflow', () => {
    const definition: WorkflowDefinition = {
      id: 'test-wf',
      name: 'Test Workflow',
      version: '1.0.0',
      steps: [
        { id: 'step1', name: 'Step 1', type: 'task', config: {}, next: ['step2'] },
        { id: 'step2', name: 'Step 2', type: 'task', config: {}, next: [] },
      ],
    };
    engine.define(definition);
    expect(engine.getDefinition('test-wf')).toBeDefined();
    expect(engine.getDefinition('test-wf')!.name).toBe('Test Workflow');
  });

  test('should execute a simple workflow', async () => {
    const definition: WorkflowDefinition = {
      id: 'simple-wf',
      name: 'Simple Workflow',
      version: '1.0.0',
      steps: [
        { id: 'step1', name: 'Step 1', type: 'task', config: {}, next: ['step2'] },
        { id: 'step2', name: 'Step 2', type: 'task', config: {}, next: [] },
      ],
    };
    engine.define(definition);
    const result = await engine.execute('simple-wf', { input: 'hello' });
    expect(result.success).toBe(true);
    expect(result.instanceId).toBeTruthy();
    expect(result.output).toBeDefined();
  });

  test('should return error for non-existent workflow', async () => {
    const result = await engine.execute('non-existent', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  test('should pass variables through workflow steps', async () => {
    const definition: WorkflowDefinition = {
      id: 'var-wf',
      name: 'Variable Workflow',
      version: '1.0.0',
      steps: [
        { id: 'step1', name: 'Step 1', type: 'task', config: { key: 'value' }, next: ['step2'] },
        { id: 'step2', name: 'Step 2', type: 'task', config: {}, next: [] },
      ],
    };
    engine.define(definition);
    const result = await engine.execute('var-wf', { myVar: 42 });
    expect(result.success).toBe(true);
    expect(result.output?.myVar).toBe(42);
  });

  test('should handle step timeout', async () => {
    engine.registerStepExecutor('task', async (step) => {
      await new Promise(resolve => setTimeout(resolve, 5000));
      return { done: true };
    });

    const definition: WorkflowDefinition = {
      id: 'timeout-wf',
      name: 'Timeout Workflow',
      version: '1.0.0',
      steps: [
        { id: 'slow', name: 'Slow Step', type: 'task', config: {}, next: [], timeout: 50 },
      ],
    };
    engine.define(definition);
    const result = await engine.execute('timeout-wf', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  });

  test('should retry failed steps', async () => {
    let attempts = 0;
    engine.registerStepExecutor('task', async () => {
      attempts++;
      if (attempts < 3) throw new Error('Not yet');
      return { success: true };
    });

    const definition: WorkflowDefinition = {
      id: 'retry-wf',
      name: 'Retry Workflow',
      version: '1.0.0',
      steps: [
        { id: 'flaky', name: 'Flaky Step', type: 'task', config: {}, next: [], retryPolicy: { count: 3, delay: 10, backoff: 'fixed' } },
      ],
    };
    engine.define(definition);
    const result = await engine.execute('retry-wf', {});
    expect(result.success).toBe(true);
    expect(attempts).toBe(3);
  });

  test('should use onError step on failure', async () => {
    engine.registerStepExecutor('task', async (step) => {
      if (step.id === 'fail-step') throw new Error('Expected failure');
      return { ok: true };
    });

    const definition: WorkflowDefinition = {
      id: 'onerror-wf',
      name: 'OnError Workflow',
      version: '1.0.0',
      steps: [
        { id: 'fail-step', name: 'Fail Step', type: 'task', config: {}, next: [], onError: 'recovery' },
        { id: 'recovery', name: 'Recovery Step', type: 'task', config: {}, next: [] },
      ],
    };
    engine.define(definition);
    const result = await engine.execute('onerror-wf', {});
    expect(result.success).toBe(true);
  });

  test('should fail workflow when step fails without onError', async () => {
    engine.registerStepExecutor('task', async () => {
      throw new Error('Unrecoverable');
    });

    const definition: WorkflowDefinition = {
      id: 'fail-wf',
      name: 'Fail Workflow',
      version: '1.0.0',
      steps: [
        { id: 'bad', name: 'Bad Step', type: 'task', config: {}, next: [] },
      ],
    };
    engine.define(definition);
    const result = await engine.execute('fail-wf', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unrecoverable');
  });

  test('should cancel a running workflow', async () => {
    // Use a long delay to simulate a running workflow
    engine.registerStepExecutor('task', async () => {
      await new Promise(resolve => setTimeout(resolve, 200));
      return { done: true };
    });

    const definition: WorkflowDefinition = {
      id: 'cancel-wf',
      name: 'Cancel Workflow',
      version: '1.0.0',
      steps: [
        { id: 'step1', name: 'Step 1', type: 'task', config: {}, next: ['step2'] },
        { id: 'step2', name: 'Step 2', type: 'delay', config: { duration: 5000 }, next: [] },
      ],
    };
    engine.define(definition);

    // Start execution and cancel immediately
    const execPromise = engine.execute('cancel-wf', {});
    // Give it a moment to start, then cancel
    await new Promise(resolve => setTimeout(resolve, 50));
    // Find the instance and cancel it
    const instances = engine.listInstances();
    const instance = instances[instances.length - 1];
    if (instance) engine.cancel(instance.id);

    const result = await execPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('cancelled');
  });

  test('should pause and resume a workflow', async () => {
    engine.registerStepExecutor('task', async (step) => {
      if (step.id === 'step1') {
        // Simulate work
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return { ok: true };
    });

    const definition: WorkflowDefinition = {
      id: 'pause-wf',
      name: 'Pause Workflow',
      version: '1.0.0',
      steps: [
        { id: 'step1', name: 'Step 1', type: 'task', config: {}, next: ['step2'] },
        { id: 'step2', name: 'Step 2', type: 'task', config: {}, next: [] },
      ],
    };
    engine.define(definition);

    const execPromise = engine.execute('pause-wf', {});
    await new Promise(resolve => setTimeout(resolve, 30));
    const instances = engine.listInstances();
    const instance = instances[instances.length - 1];
    if (instance) {
      engine.pause(instance.id);
      expect(instance.status).toBe('paused');
      await new Promise(resolve => setTimeout(resolve, 50));
      engine.resume(instance.id);
    }

    const result = await execPromise;
    expect(result.success).toBe(true);
  });

  test('should record step history', async () => {
    const definition: WorkflowDefinition = {
      id: 'history-wf',
      name: 'History Workflow',
      version: '1.0.0',
      steps: [
        { id: 'a', name: 'A', type: 'task', config: {}, next: ['b'] },
        { id: 'b', name: 'B', type: 'task', config: {}, next: [] },
      ],
    };
    engine.define(definition);
    const result = await engine.execute('history-wf', {});
    expect(result.success).toBe(true);

    const instance = engine.getInstance(result.instanceId);
    expect(instance).toBeDefined();
    expect(instance!.history.length).toBeGreaterThanOrEqual(2);
  });

  test('should use exponential backoff for retries', async () => {
    let attempts = 0;
    engine.registerStepExecutor('task', async () => {
      attempts++;
      throw new Error('always fail');
    });

    const definition: WorkflowDefinition = {
      id: 'backoff-wf',
      name: 'Backoff Workflow',
      version: '1.0.0',
      steps: [
        { id: 'flaky', name: 'Flaky', type: 'task', config: {}, next: [], retryPolicy: { count: 2, delay: 10, backoff: 'exponential' } },
      ],
    };
    engine.define(definition);
    const start = Date.now();
    const result = await engine.execute('backoff-wf', {});
    const elapsed = Date.now() - start;
    expect(result.success).toBe(false);
    expect(attempts).toBe(3); // initial + 2 retries
    // With exponential backoff: 10 + 20 = 30ms minimum
    expect(elapsed).toBeGreaterThanOrEqual(25);
  });

  test('should support delay step type', async () => {
    const definition: WorkflowDefinition = {
      id: 'delay-wf',
      name: 'Delay Workflow',
      version: '1.0.0',
      steps: [
        { id: 'wait', name: 'Wait', type: 'delay', config: { duration: 50 }, next: [] },
      ],
    };
    engine.define(definition);
    const start = Date.now();
    const result = await engine.execute('delay-wf', {});
    const elapsed = Date.now() - start;
    expect(result.success).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  test('should support approval step type', async () => {
    const definition: WorkflowDefinition = {
      id: 'approval-wf',
      name: 'Approval Workflow',
      version: '1.0.0',
      steps: [
        { id: 'approve', name: 'Approve', type: 'approval', config: { autoApprove: true }, next: [] },
      ],
    };
    engine.define(definition);
    const result = await engine.execute('approval-wf', {});
    expect(result.success).toBe(true);
  });

  test('should support transform step type', async () => {
    const definition: WorkflowDefinition = {
      id: 'transform-wf',
      name: 'Transform Workflow',
      version: '1.0.0',
      steps: [
        { id: 'transform', name: 'Transform', type: 'transform', config: {}, next: [] },
      ],
    };
    engine.define(definition);
    const result = await engine.execute('transform-wf', {});
    expect(result.success).toBe(true);
  });

  test('should list instances', async () => {
    const definition: WorkflowDefinition = {
      id: 'list-wf',
      name: 'List Workflow',
      version: '1.0.0',
      steps: [
        { id: 's1', name: 'S1', type: 'task', config: {}, next: [] },
      ],
    };
    engine.define(definition);
    await engine.execute('list-wf', {});
    await engine.execute('list-wf', {});
    const instances = engine.listInstances();
    expect(instances.length).toBe(2);
  });
});

// ============================================================
// Module 2: DAG Executor Tests
// ============================================================
describe('DAGExecutor', () => {
  let executor: DAGExecutor;

  beforeEach(() => {
    executor = new DAGExecutor();
  });

  test('should execute independent nodes in parallel', async () => {
    const executionOrder: string[] = [];
    const nodes: DAGNode[] = [
      { id: 'a', dependencies: [], execute: async () => { executionOrder.push('a'); return 'A'; } },
      { id: 'b', dependencies: [], execute: async () => { executionOrder.push('b'); return 'B'; } },
      { id: 'c', dependencies: [], execute: async () => { executionOrder.push('c'); return 'C'; } },
    ];

    const result = await executor.execute(nodes);
    expect(result.success).toBe(true);
    expect(result.outputs.a).toBe('A');
    expect(result.outputs.b).toBe('B');
    expect(result.outputs.c).toBe('C');
    expect(result.executionOrder).toHaveLength(3);
  });

  test('should respect dependency ordering', async () => {
    const executionOrder: string[] = [];
    const nodes: DAGNode[] = [
      { id: 'a', dependencies: [], execute: async () => { executionOrder.push('a'); return 'A'; } },
      { id: 'b', dependencies: ['a'], execute: async (inputs) => { executionOrder.push('b'); return { from: inputs.a }; } },
      { id: 'c', dependencies: ['b'], execute: async (inputs) => { executionOrder.push('c'); return { from: inputs.b }; } },
    ];

    const result = await executor.execute(nodes);
    expect(result.success).toBe(true);
    expect(executionOrder.indexOf('a')).toBeLessThan(executionOrder.indexOf('b'));
    expect(executionOrder.indexOf('b')).toBeLessThan(executionOrder.indexOf('c'));
  });

  test('should detect cycles and throw CycleDetectedError', () => {
    const nodes: DAGNode[] = [
      { id: 'a', dependencies: ['b'], execute: async () => 'A' },
      { id: 'b', dependencies: ['c'], execute: async () => 'B' },
      { id: 'c', dependencies: ['a'], execute: async () => 'C' },
    ];

    expect(() => executor.detectCycle(nodes)).toThrow(CycleDetectedError);
  });

  test('should detect self-referencing cycle', () => {
    const nodes: DAGNode[] = [
      { id: 'a', dependencies: ['a'], execute: async () => 'A' },
    ];

    expect(() => executor.detectCycle(nodes)).toThrow(CycleDetectedError);
  });

  test('should return timing information', async () => {
    const nodes: DAGNode[] = [
      { id: 'a', dependencies: [], execute: async () => { await new Promise(r => setTimeout(r, 50)); return 'A'; } },
      { id: 'b', dependencies: ['a'], execute: async () => 'B' },
    ];

    const result = await executor.execute(nodes);
    expect(result.timing).toHaveLength(2);
    expect(result.timing[0].duration).toBeGreaterThanOrEqual(40);
  });

  test('should handle node execution failure', async () => {
    const nodes: DAGNode[] = [
      { id: 'a', dependencies: [], execute: async () => { throw new Error('Node A failed'); } },
      { id: 'b', dependencies: [], execute: async () => 'B' },
    ];

    const result = await executor.execute(nodes);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Node A failed');
  });

  test('should perform topological sort', () => {
    const nodes: DAGNode[] = [
      { id: 'c', dependencies: ['b'], execute: async () => 'C' },
      { id: 'a', dependencies: [], execute: async () => 'A' },
      { id: 'b', dependencies: ['a'], execute: async () => 'B' },
    ];

    const order = executor.topologicalSort(nodes);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
  });

  test('should support AbortSignal cancellation', async () => {
    const controller = new AbortController();
    const nodes: DAGNode[] = [
      {
        id: 'a', dependencies: [],
        execute: async () => {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 5000);
            controller.signal.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new Error('Aborted'));
            }, { once: true });
          });
          return 'A';
        },
      },
    ];

    setTimeout(() => controller.abort(), 50);
    const result = await executor.execute(nodes, controller.signal);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Aborted');
  });

  test('should handle empty nodes list', async () => {
    const result = await executor.execute([]);
    expect(result.success).toBe(true);
    expect(result.executionOrder).toHaveLength(0);
  });

  test('should handle single node with no dependencies', async () => {
    const nodes: DAGNode[] = [
      { id: 'solo', dependencies: [], execute: async () => 'solo result' },
    ];

    const result = await executor.execute(nodes);
    expect(result.success).toBe(true);
    expect(result.outputs.solo).toBe('solo result');
  });
});

// ============================================================
// Module 3: Condition Evaluator Tests
// ============================================================
describe('ConditionEvaluator', () => {
  let evaluator: ConditionEvaluator;

  beforeEach(() => {
    evaluator = new ConditionEvaluator();
  });

  test('should evaluate simple equality', () => {
    expect(evaluator.evaluate('status == "active"', { status: 'active' })).toBe(true);
    expect(evaluator.evaluate('status == "inactive"', { status: 'active' })).toBe(false);
  });

  test('should evaluate inequality', () => {
    expect(evaluator.evaluate('status != "inactive"', { status: 'active' })).toBe(true);
  });

  test('should evaluate numeric comparisons', () => {
    expect(evaluator.evaluate('count > 5', { count: 10 })).toBe(true);
    expect(evaluator.evaluate('count < 5', { count: 3 })).toBe(true);
    expect(evaluator.evaluate('count >= 5', { count: 5 })).toBe(true);
    expect(evaluator.evaluate('count <= 5', { count: 5 })).toBe(true);
  });

  test('should evaluate AND conditions', () => {
    expect(evaluator.evaluate('age > 18 AND status == "active"', { age: 25, status: 'active' })).toBe(true);
    expect(evaluator.evaluate('age > 18 AND status == "inactive"', { age: 25, status: 'active' })).toBe(false);
  });

  test('should evaluate OR conditions', () => {
    expect(evaluator.evaluate('role == "admin" OR role == "moderator"', { role: 'admin' })).toBe(true);
    expect(evaluator.evaluate('role == "admin" OR role == "moderator"', { role: 'user' })).toBe(false);
  });

  test('should evaluate NOT conditions', () => {
    expect(evaluator.evaluate('NOT disabled', { disabled: false })).toBe(true);
    expect(evaluator.evaluate('NOT disabled', { disabled: true })).toBe(false);
  });

  test('should evaluate nested conditions with parentheses', () => {
    expect(evaluator.evaluate('(age > 18 OR role == "admin") AND status == "active"', { age: 16, role: 'admin', status: 'active' })).toBe(true);
    expect(evaluator.evaluate('(age > 18 OR role == "admin") AND status == "active"', { age: 16, role: 'user', status: 'active' })).toBe(false);
  });

  test('should evaluate contains method', () => {
    expect(evaluator.evaluate('name contains("John")', { name: 'John Doe' })).toBe(true);
    expect(evaluator.evaluate('name contains("Jane")', { name: 'John Doe' })).toBe(false);
  });

  test('should evaluate startsWith method', () => {
    expect(evaluator.evaluate('name startsWith("John")', { name: 'John Doe' })).toBe(true);
    expect(evaluator.evaluate('name startsWith("Doe")', { name: 'John Doe' })).toBe(false);
  });

  test('should evaluate endsWith method', () => {
    expect(evaluator.evaluate('name endsWith("Doe")', { name: 'John Doe' })).toBe(true);
    expect(evaluator.evaluate('name endsWith("John")', { name: 'John Doe' })).toBe(false);
  });

  test('should evaluate regex method', () => {
    expect(evaluator.evaluate('email regex("^[^@]+@[^@]+\\.[^@]+$")', { email: 'test@example.com' })).toBe(true);
    expect(evaluator.evaluate('email regex("^[^@]+@[^@]+\\.[^@]+$")', { email: 'invalid' })).toBe(false);
  });

  test('should resolve nested object properties', () => {
    expect(evaluator.evaluate('user.age > 18', { user: { age: 25 } })).toBe(true);
    expect(evaluator.evaluate('user.address.city == "NYC"', { user: { address: { city: 'NYC' } } })).toBe(true);
  });

  test('should handle boolean values', () => {
    expect(evaluator.evaluate('active == true', { active: true })).toBe(true);
    expect(evaluator.evaluate('active == false', { active: false })).toBe(true);
  });

  test('should handle null values', () => {
    expect(evaluator.evaluate('value == null', { value: null })).toBe(true);
    expect(evaluator.evaluate('value != null', { value: 'something' })).toBe(true);
  });

  test('should register and use custom functions', () => {
    evaluator.registerFunction('isEven', (val) => Number(val) % 2 === 0);
    expect(evaluator.evaluate('isEven(count)', { count: 4 })).toBe(true);
    expect(evaluator.evaluate('isEven(count)', { count: 3 })).toBe(false);
  });

  test('should throw ConditionParseError for invalid syntax', () => {
    expect(() => evaluator.evaluate('value ==', {})).toThrow(ConditionParseError);
    expect(() => evaluator.evaluate('name contains("unclosed"', {})).toThrow(ConditionParseError);
  });

  test('should handle undefined context variables gracefully', () => {
    expect(evaluator.evaluate('missing == null', {})).toBe(true);
    expect(evaluator.evaluate('missing == "default"', {})).toBe(false);
  });

  test('should coerce types for comparison', () => {
    expect(evaluator.evaluate('count == "5"', { count: 5 })).toBe(true);
    expect(evaluator.evaluate('name == "hello"', { name: 'hello' })).toBe(true);
  });
});

// ============================================================
// Module 4: Parallel Executor Tests
// ============================================================
describe('ParallelExecutor', () => {
  let executor: ParallelExecutor;

  beforeEach(() => {
    executor = new ParallelExecutor();
  });

  test('should execute tasks in parallel', async () => {
    const tasks: ParallelTask[] = [
      { id: 'a', execute: async () => 'A' },
      { id: 'b', execute: async () => 'B' },
      { id: 'c', execute: async () => 'C' },
    ];

    const result = await executor.execute(tasks);
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(3);
    expect(result.results[0].result).toBe('A');
    expect(result.results[1].result).toBe('B');
    expect(result.results[2].result).toBe('C');
  });

  test('should respect concurrency limit', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const tasks: ParallelTask[] = Array.from({ length: 10 }, (_, i) => ({
      id: `task-${i}`,
      execute: async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise(r => setTimeout(r, 50));
        concurrent--;
        return i;
      },
    }));

    const result = await executor.execute(tasks, { concurrency: 3 });
    expect(result.success).toBe(true);
    expect(maxConcurrent).toBeLessThanOrEqual(3);
  });

  test('should fail-fast on first error', async () => {
    const tasks: ParallelTask[] = [
      { id: 'a', execute: async () => { await new Promise(r => setTimeout(r, 100)); return 'A'; } },
      { id: 'b', execute: async () => { throw new Error('Task B failed'); } },
      { id: 'c', execute: async () => { await new Promise(r => setTimeout(r, 200)); return 'C'; } },
    ];

    const result = await executor.execute(tasks, { errorStrategy: 'fail-fast' });
    expect(result.success).toBe(false);
  });

  test('should continue on error', async () => {
    const tasks: ParallelTask[] = [
      { id: 'a', execute: async () => 'A' },
      { id: 'b', execute: async () => { throw new Error('fail'); } },
      { id: 'c', execute: async () => 'C' },
    ];

    const result = await executor.execute(tasks, { errorStrategy: 'continue-on-error' });
    expect(result.success).toBe(true);
    expect(result.results[0].success).toBe(true);
    expect(result.results[1].success).toBe(false);
    expect(result.results[2].success).toBe(true);
  });

  test('should aggregate results as all', async () => {
    const tasks: ParallelTask[] = [
      { id: 'a', execute: async () => 1 },
      { id: 'b', execute: async () => 2 },
    ];

    const result = await executor.execute(tasks, { aggregation: 'all' });
    expect(result.aggregated).toEqual([1, 2]);
  });

  test('should aggregate results as first-success', async () => {
    const tasks: ParallelTask[] = [
      { id: 'a', execute: async () => { throw new Error('fail'); } },
      { id: 'b', execute: async () => 'first success' },
      { id: 'c', execute: async () => 'second success' },
    ];

    const result = await executor.execute(tasks, { aggregation: 'first-success', errorStrategy: 'continue-on-error' });
    expect(result.aggregated).toBe('first success');
  });

  test('should aggregate results as majority-vote', async () => {
    const tasks: ParallelTask[] = [
      { id: 'a', execute: async () => 'yes' },
      { id: 'b', execute: async () => 'yes' },
      { id: 'c', execute: async () => 'no' },
    ];

    const result = await executor.execute(tasks, { aggregation: 'majority-vote' });
    expect(result.aggregated).toBe('yes');
  });

  test('should track progress', async () => {
    const tasks: ParallelTask[] = [
      { id: 'a', execute: async () => 'A' },
      { id: 'b', execute: async () => 'B' },
    ];

    const result = await executor.execute(tasks);
    expect(result.progress.total).toBe(2);
    expect(result.progress.percentage).toBe(100);
  });

  test('should retry failed tasks', async () => {
    let attempts = 0;
    const tasks: ParallelTask[] = [
      {
        id: 'flaky',
        execute: async () => {
          attempts++;
          if (attempts <= 2) throw new Error('not yet');
          return 'ok';
        },
      },
    ];

    const result = await executor.execute(tasks, { maxRetries: 2 });
    expect(result.success).toBe(true);
    expect(attempts).toBe(3);
  });

  test('should handle task timeout', async () => {
    const tasks: ParallelTask[] = [
      { id: 'slow', execute: async () => { await new Promise(r => setTimeout(r, 5000)); return 'late'; } },
    ];

    const result = await executor.execute(tasks, { taskTimeout: 50 });
    expect(result.success).toBe(false);
  });

  test('should prioritize tasks', async () => {
    const order: string[] = [];
    const tasks: ParallelTask[] = [
      { id: 'low', priority: 1, execute: async () => { order.push('low'); return 'L'; } },
      { id: 'high', priority: 10, execute: async () => { order.push('high'); return 'H'; } },
      { id: 'mid', priority: 5, execute: async () => { order.push('mid'); return 'M'; } },
    ];

    const result = await executor.execute(tasks, { concurrency: 1 });
    expect(result.success).toBe(true);
    expect(order[0]).toBe('high');
    expect(order[1]).toBe('mid');
    expect(order[2]).toBe('low');
  });

  test('should handle empty task list', async () => {
    const result = await executor.execute([]);
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(0);
    expect(result.progress.percentage).toBe(100);
  });
});

// ============================================================
// Module 5: Transform Engine Tests
// ============================================================
describe('TransformEngine', () => {
  let engine: TransformEngine;

  beforeEach(() => {
    engine = new TransformEngine();
  });

  test('should map array elements', async () => {
    const result = await engine.transform([1, 2, 3], [{ type: 'map', expression: 'value' }]);
    expect(result).toEqual([1, 2, 3]);
  });

  test('should filter array elements', async () => {
    const data = [{ age: 10 }, { age: 20 }, { age: 30 }];
    const result = await engine.transform(data, [{ type: 'filter', expression: 'age > 15' }]);
    expect(result).toHaveLength(2);
  });

  test('should sort array', async () => {
    const result = await engine.transform([3, 1, 2], [{ type: 'sort' }]);
    expect(result).toEqual([1, 2, 3]);
  });

  test('should sort array descending', async () => {
    const result = await engine.transform([3, 1, 2], [{ type: 'sort', order: 'desc' }]);
    expect(result).toEqual([3, 2, 1]);
  });

  test('should sort by field', async () => {
    const data = [{ name: 'C' }, { name: 'A' }, { name: 'B' }];
    const result = await engine.transform(data, [{ type: 'sort', by: 'name' }]);
    expect(result).toEqual([{ name: 'A' }, { name: 'B' }, { name: 'C' }]);
  });

  test('should group by field', async () => {
    const data = [{ type: 'a', val: 1 }, { type: 'b', val: 2 }, { type: 'a', val: 3 }];
    const result = await engine.transform(data, [{ type: 'groupBy', by: 'type' }]);
    expect(Object.keys(result as Record<string, unknown[]>)).toContain('a');
    expect(Object.keys(result as Record<string, unknown[]>)).toContain('b');
    expect((result as Record<string, unknown[]>).a).toHaveLength(2);
  });

  test('should flatten nested arrays', async () => {
    const result = await engine.transform([[1, 2], [3, [4, 5]]], [{ type: 'flatten' }]);
    expect(result).toEqual([1, 2, 3, 4, 5]);
  });

  test('should pick fields from object', async () => {
    const result = await engine.transform({ a: 1, b: 2, c: 3 }, [{ type: 'pick', fields: ['a', 'c'] }]);
    expect(result).toEqual({ a: 1, c: 3 });
  });

  test('should omit fields from object', async () => {
    const result = await engine.transform({ a: 1, b: 2, c: 3 }, [{ type: 'omit', fields: ['b'] }]);
    expect(result).toEqual({ a: 1, c: 3 });
  });

  test('should merge objects', async () => {
    const result = await engine.transform({ a: 1 }, [{ type: 'merge', value: { b: 2 } }]);
    expect(result).toEqual({ a: 1, b: 2 });
  });

  test('should rename fields', async () => {
    const result = await engine.transform({ oldName: 'value' }, [{ type: 'rename', path: 'oldName', as: 'newName' }]);
    expect(result).toEqual({ newName: 'value' });
  });

  test('should set default values', async () => {
    const result = await engine.transform({ a: 1 }, [{ type: 'default', path: 'b', value: 'default' }]);
    expect(result).toEqual({ a: 1, b: 'default' });
  });

  test('should not override existing values with default', async () => {
    const result = await engine.transform({ a: 1 }, [{ type: 'default', path: 'a', value: 99 }]);
    expect(result).toEqual({ a: 1 });
  });

  test('should set field values', async () => {
    const result = await engine.transform({ a: 1 }, [{ type: 'set', path: 'b', value: 42 }]);
    expect(result).toEqual({ a: 1, b: 42 });
  });

  test('should get nested field values', async () => {
    const result = await engine.transform({ a: { b: { c: 'deep' } } }, [{ type: 'get', path: 'a.b.c' }]);
    expect(result).toBe('deep');
  });

  test('should chunk arrays', async () => {
    const result = await engine.transform([1, 2, 3, 4, 5], [{ type: 'chunk', size: 2 }]);
    expect(result).toEqual([[1, 2], [3, 4], [5]]);
  });

  test('should zip arrays', async () => {
    const result = await engine.transform([1, 2, 3], [{ type: 'zip', value: ['a', 'b', 'c'] }]);
    expect(result).toEqual([[1, 'a'], [2, 'b'], [3, 'c']]);
  });

  test('should deduplicate arrays', async () => {
    const result = await engine.transform([1, 2, 2, 3, 3, 3], [{ type: 'uniq' }]);
    expect(result).toEqual([1, 2, 3]);
  });

  test('should compute array intersection', async () => {
    const result = await engine.transform([1, 2, 3, 4], [{ type: 'intersection', value: [2, 3, 5] }]);
    expect(result).toEqual([2, 3]);
  });

  test('should compute array difference', async () => {
    const result = await engine.transform([1, 2, 3, 4], [{ type: 'difference', value: [2, 3] }]);
    expect(result).toEqual([1, 4]);
  });

  test('should join arrays', async () => {
    const result = await engine.transform(['a', 'b', 'c'], [{ type: 'join', separator: '-' }]);
    expect(result).toBe('a-b-c');
  });

  test('should coerce types', async () => {
    const numResult = await engine.transform('42', [{ type: 'coerce', targetType: 'number' }]);
    expect(numResult).toBe(42);

    const boolResult = await engine.transform(1, [{ type: 'coerce', targetType: 'boolean' }]);
    expect(boolResult).toBe(true);

    const strResult = await engine.transform(123, [{ type: 'coerce', targetType: 'string' }]);
    expect(strResult).toBe('123');
  });

  test('should interpolate templates', async () => {
    const result = await engine.transform(
      { name: 'World', count: 42 },
      [{ type: 'template', template: 'Hello {{name}}, count is {{count}}' }],
    );
    expect(result).toBe('Hello World, count is 42');
  });

  test('should support composable transform pipelines', async () => {
    const data = [
      { name: 'Alice', age: 30, active: true },
      { name: 'Bob', age: 25, active: false },
      { name: 'Charlie', age: 35, active: true },
    ];
    const result = await engine.transform(data, [
      { type: 'filter', expression: 'active == true' },
      { type: 'sort', by: 'age' },
      { type: 'map', expression: 'name' },
    ]);
    expect(result).toEqual(['Alice', 'Charlie']);
  });

  test('should support dry-run mode', async () => {
    const data = [3, 1, 2];
    const result = await engine.transform(data, [{ type: 'sort' }], true);
    expect(result).toEqual([3, 1, 2]); // unchanged
  });
});

// ============================================================
// Module 6: Error Handler Tests
// ============================================================
describe('WorkflowErrorHandler', () => {
  let handler: WorkflowErrorHandler;

  beforeEach(() => {
    handler = new WorkflowErrorHandler();
  });

  test('should handle fail strategy', async () => {
    handler.setStrategy('step1', 'fail');
    const result = await handler.handle(
      new Error('test error'),
      { workflowId: 'wf1', instanceId: 'inst1', stepId: 'step1', error: new Error('test error'), variables: {}, attempt: 0 },
    );
    expect(result.action).toBe('fail');
    expect(result.retried).toBe(false);
  });

  test('should handle skip strategy', async () => {
    handler.setStrategy('step1', 'skip');
    const result = await handler.handle(
      new Error('test'),
      { workflowId: 'wf1', instanceId: 'inst1', stepId: 'step1', error: new Error('test'), variables: {}, attempt: 0 },
    );
    expect(result.action).toBe('skip');
  });

  test('should handle retry strategy', async () => {
    handler.setStrategy('step1', 'retry');
    handler.setRetryPolicy('step1', { count: 3, delay: 10, backoff: 'fixed' });
    const result = await handler.handle(
      new Error('ECONNREFUSED'),
      { workflowId: 'wf1', instanceId: 'inst1', stepId: 'step1', error: new Error('ECONNREFUSED'), variables: {}, attempt: 0 },
    );
    expect(result.action).toBe('retry');
    expect(result.retried).toBe(true);
  });

  test('should stop retrying after max count', async () => {
    handler.setStrategy('step1', 'retry');
    handler.setRetryPolicy('step1', { count: 2, delay: 10, backoff: 'fixed' });
    const result = await handler.handle(
      new Error('retryable'),
      { workflowId: 'wf1', instanceId: 'inst1', stepId: 'step1', error: new Error('retryable'), variables: {}, attempt: 2 },
    );
    expect(result.action).toBe('fail');
  });

  test('should handle fallback strategy', async () => {
    handler.setStrategy('step1', 'fallback');
    handler.setFallback('step1', async () => ({ fallbackValue: true }));
    const result = await handler.handle(
      new Error('primary failed'),
      { workflowId: 'wf1', instanceId: 'inst1', stepId: 'step1', error: new Error('primary failed'), variables: {}, attempt: 0 },
    );
    expect(result.action).toBe('fallback');
    expect(result.result).toEqual({ fallbackValue: true });
  });

  test('should handle compensate strategy', async () => {
    let compensated = false;
    handler.setStrategy('step1', 'compensate');
    handler.setCompensate('step1', async () => { compensated = true; });
    const result = await handler.handle(
      new Error('need compensation'),
      { workflowId: 'wf1', instanceId: 'inst1', stepId: 'step1', error: new Error('need compensation'), variables: {}, attempt: 0 },
    );
    expect(result.action).toBe('compensate');
    expect(compensated).toBe(true);
  });

  test('should classify retryable errors', () => {
    expect(handler.isRetryable(new Error('ECONNREFUSED'))).toBe(true);
    expect(handler.isRetryable(new Error('ETIMEDOUT'))).toBe(true);
    expect(handler.isRetryable(new Error('socket hang up'))).toBe(true);
    expect(handler.isRetryable(new Error('regular error'))).toBe(false);
  });

  test('should use custom retryable checker', () => {
    handler.addRetryableChecker((err) => err.message.includes('CUSTOM_RETRY'));
    expect(handler.isRetryable(new Error('CUSTOM_RETRY'))).toBe(true);
  });

  test('should add failed items to dead letter queue', async () => {
    handler.setStrategy('step1', 'fail');
    await handler.handle(
      new Error('dlq test'),
      { workflowId: 'wf1', instanceId: 'inst1', stepId: 'step1', error: new Error('dlq test'), variables: {}, attempt: 0 },
    );
    expect(handler.getDeadLetterQueueSize()).toBe(1);
  });

  test('should clear dead letter queue', async () => {
    handler.setStrategy('step1', 'fail');
    await handler.handle(
      new Error('test'),
      { workflowId: 'wf1', instanceId: 'inst1', stepId: 'step1', error: new Error('test'), variables: {}, attempt: 0 },
    );
    handler.clearDeadLetterQueue();
    expect(handler.getDeadLetterQueueSize()).toBe(0);
  });

  test('should send error notifications', async () => {
    const notifications: string[] = [];
    handler.addNotificationHook((n) => { notifications.push(n.context.stepId); });
    handler.setStrategy('step1', 'fail');
    await handler.handle(
      new Error('notify test'),
      { workflowId: 'wf1', instanceId: 'inst1', stepId: 'step1', error: new Error('notify test'), variables: {}, attempt: 0 },
    );
    expect(notifications).toContain('step1');
  });

  test('should isolate notification handler errors', async () => {
    handler.addNotificationHook(() => { throw new Error('handler error'); });
    handler.setStrategy('step1', 'fail');
    // Should not throw even though handler throws
    const result = await handler.handle(
      new Error('test'),
      { workflowId: 'wf1', instanceId: 'inst1', stepId: 'step1', error: new Error('test'), variables: {}, attempt: 0 },
    );
    expect(result.action).toBe('fail');
  });
});

// ============================================================
// Module 7: Workflow Persistence Tests
// ============================================================
describe('InMemoryWorkflowStore', () => {
  let store: InMemoryWorkflowStore;

  beforeEach(() => {
    store = new InMemoryWorkflowStore();
  });

  test('should save and load definitions', async () => {
    const def: WorkflowDefinition = {
      id: 'def1',
      name: 'Definition 1',
      version: '1.0.0',
      steps: [{ id: 's1', name: 'Step 1', type: 'task', config: {}, next: [] }],
    };
    await store.saveDefinition(def);
    const loaded = await store.loadDefinition('def1');
    expect(loaded).toBeDefined();
    expect(loaded!.name).toBe('Definition 1');
  });

  test('should list definitions', async () => {
    await store.saveDefinition({ id: 'd1', name: 'D1', version: '1.0', steps: [] });
    await store.saveDefinition({ id: 'd2', name: 'D2', version: '1.0', steps: [] });
    const list = await store.listDefinitions();
    expect(list).toHaveLength(2);
  });

  test('should delete definitions', async () => {
    await store.saveDefinition({ id: 'd1', name: 'D1', version: '1.0', steps: [] });
    await store.deleteDefinition('d1');
    const loaded = await store.loadDefinition('d1');
    expect(loaded).toBeUndefined();
  });

  test('should save and load instances', async () => {
    const instance = {
      id: 'inst1',
      definitionId: 'def1',
      status: 'running' as const,
      currentStep: 'step1',
      variables: { key: 'value' },
      history: [],
      startedAt: new Date(),
      completedAt: null,
    };
    await store.saveInstance(instance);
    const loaded = await store.loadInstance('inst1');
    expect(loaded).toBeDefined();
    expect(loaded!.variables.key).toBe('value');
  });

  test('should list instances with filter', async () => {
    await store.saveInstance({
      id: 'i1', definitionId: 'def1', status: 'completed', currentStep: null,
      variables: {}, history: [], startedAt: new Date('2024-01-01'), completedAt: new Date(),
    });
    await store.saveInstance({
      id: 'i2', definitionId: 'def2', status: 'running', currentStep: 's1',
      variables: {}, history: [], startedAt: new Date('2024-06-01'), completedAt: null,
    });

    const completed = await store.listInstances({ status: 'completed' });
    expect(completed).toHaveLength(1);
    expect(completed[0].id).toBe('i1');

    const byDef = await store.listInstances({ definitionId: 'def2' });
    expect(byDef).toHaveLength(1);
    expect(byDef[0].id).toBe('i2');
  });

  test('should delete instances', async () => {
    await store.saveInstance({
      id: 'i1', definitionId: 'def1', status: 'completed', currentStep: null,
      variables: {}, history: [], startedAt: new Date(), completedAt: new Date(),
    });
    await store.deleteInstance('i1');
    const loaded = await store.loadInstance('i1');
    expect(loaded).toBeUndefined();
  });

  test('should save and load checkpoints', async () => {
    const checkpoint = {
      instanceId: 'inst1',
      stepId: 'step1',
      variables: { progress: 50 },
      timestamp: new Date(),
    };
    await store.saveCheckpoint(checkpoint);
    const loaded = await store.loadCheckpoint('inst1');
    expect(loaded).toBeDefined();
    expect(loaded!.variables.progress).toBe(50);
  });

  test('should return undefined for non-existent items', async () => {
    expect(await store.loadDefinition('nonexistent')).toBeUndefined();
    expect(await store.loadInstance('nonexistent')).toBeUndefined();
    expect(await store.loadCheckpoint('nonexistent')).toBeUndefined();
  });

  test('should clear all data', async () => {
    await store.saveDefinition({ id: 'd1', name: 'D1', version: '1.0', steps: [] });
    await store.saveInstance({
      id: 'i1', definitionId: 'd1', status: 'running', currentStep: null,
      variables: {}, history: [], startedAt: new Date(), completedAt: null,
    });
    store.clear();
    expect(await store.listDefinitions()).toHaveLength(0);
    expect(await store.listInstances()).toHaveLength(0);
  });

  test('should deep clone on save/load', async () => {
    const original = { a: { b: 1 } };
    await store.saveInstance({
      id: 'i1', definitionId: 'd1', status: 'running', currentStep: null,
      variables: { data: original }, history: [], startedAt: new Date(), completedAt: null,
    });
    original.a.b = 999;
    const loaded = await store.loadInstance('i1');
    expect((loaded!.variables.data as Record<string, unknown>).a).toEqual({ b: 1 });
  });
});

// ============================================================
// Module 8: Workflow Events Tests
// ============================================================
describe('WorkflowEventEmitter', () => {
  let emitter: WorkflowEventEmitter;

  beforeEach(() => {
    emitter = new WorkflowEventEmitter();
  });

  test('should emit and receive events', async () => {
    const received: string[] = [];
    emitter.on('workflow.started', (e) => { received.push(e.type); });
    await emitter.emitWorkflowEvent('workflow.started', 'wf1', 'inst1');
    expect(received).toContain('workflow.started');
  });

  test('should support wildcard listeners', async () => {
    const received: string[] = [];
    emitter.on('*', (e) => { received.push(e.type); });
    await emitter.emitWorkflowEvent('workflow.started', 'wf1', 'inst1');
    await emitter.emitWorkflowEvent('step.completed', 'wf1', 'inst1');
    expect(received).toHaveLength(2);
  });

  test('should support event middleware filtering', async () => {
    const received: string[] = [];
    emitter.use((event) => event.type === 'workflow.started' ? event : null);
    emitter.on('*', (e) => { received.push(e.type); });
    await emitter.emitWorkflowEvent('workflow.started', 'wf1', 'inst1');
    await emitter.emitWorkflowEvent('workflow.failed', 'wf1', 'inst1');
    expect(received).toHaveLength(1);
    expect(received[0]).toBe('workflow.started');
  });

  test('should support event middleware transformation', async () => {
    const received: unknown[] = [];
    emitter.use((event) => ({ ...event, data: { transformed: true } }));
    emitter.on('workflow.started', (e) => { received.push(e.data); });
    await emitter.emitWorkflowEvent('workflow.started', 'wf1', 'inst1');
    expect(received[0]).toEqual({ transformed: true });
  });

  test('should record event history', async () => {
    await emitter.emitWorkflowEvent('workflow.started', 'wf1', 'inst1');
    await emitter.emitWorkflowEvent('step.completed', 'wf1', 'inst1', { stepId: 's1' });
    expect(emitter.getEventCount()).toBe(2);
  });

  test('should filter event history', async () => {
    await emitter.emitWorkflowEvent('workflow.started', 'wf1', 'inst1');
    await emitter.emitWorkflowEvent('step.completed', 'wf1', 'inst2');
    const history = emitter.getHistory({ workflowId: 'wf1', instanceId: 'inst1' });
    expect(history).toHaveLength(1);
  });

  test('should replay events', async () => {
    const received: string[] = [];
    await emitter.emitWorkflowEvent('workflow.started', 'wf1', 'inst1');
    await emitter.emitWorkflowEvent('workflow.completed', 'wf1', 'inst1');
    emitter.on('*', (e) => { received.push(e.type); });
    await emitter.replay();
    expect(received).toHaveLength(2);
  });

  test('should replay events with filter', async () => {
    const received: string[] = [];
    await emitter.emitWorkflowEvent('workflow.started', 'wf1', 'inst1');
    await emitter.emitWorkflowEvent('workflow.failed', 'wf1', 'inst1');
    emitter.on('*', (e) => { received.push(e.type); });
    await emitter.replay((e) => e.type === 'workflow.started');
    expect(received).toHaveLength(1);
    expect(received[0]).toBe('workflow.started');
  });

  test('should remove listeners', async () => {
    const received: string[] = [];
    const handler = (e: { type: string }) => { received.push(e.type); };
    emitter.on('workflow.started', handler);
    await emitter.emitWorkflowEvent('workflow.started', 'wf1', 'inst1');
    emitter.off('workflow.started', handler);
    await emitter.emitWorkflowEvent('workflow.started', 'wf1', 'inst1');
    expect(received).toHaveLength(1);
  });

  test('should clear history', async () => {
    await emitter.emitWorkflowEvent('workflow.started', 'wf1', 'inst1');
    emitter.clearHistory();
    expect(emitter.getEventCount()).toBe(0);
  });

  test('should isolate async handler errors', async () => {
    emitter.on('workflow.started', () => { throw new Error('handler error'); });
    // Should not throw
    await emitter.emitWorkflowEvent('workflow.started', 'wf1', 'inst1');
    expect(emitter.getEventCount()).toBe(1);
  });

  test('should include timestamp in events', async () => {
    const received: Date[] = [];
    emitter.on('workflow.started', (e) => { received.push(e.timestamp); });
    await emitter.emitWorkflowEvent('workflow.started', 'wf1', 'inst1');
    expect(received[0]).toBeInstanceOf(Date);
  });

  test('should support all event types', async () => {
    const types = [
      'workflow.started', 'workflow.completed', 'workflow.failed',
      'workflow.paused', 'workflow.resumed',
      'step.started', 'step.completed', 'step.failed', 'step.retried',
      'variable.changed',
    ];
    const received: string[] = [];
    emitter.on('*', (e) => { received.push(e.type); });
    for (const type of types) {
      await emitter.emitWorkflowEvent(type as any, 'wf1', 'inst1');
    }
    expect(received).toHaveLength(types.length);
  });
});

// ============================================================
// Module 9: Workflow Monitor Tests
// ============================================================
describe('WorkflowMonitor', () => {
  let monitor: WorkflowMonitor;

  beforeEach(() => {
    monitor = new WorkflowMonitor();
  });

  test('should record and retrieve workflow stats', () => {
    monitor.record({
      workflowId: 'wf1',
      instanceId: 'inst1',
      status: 'completed',
      duration: 1000,
      timestamp: new Date(),
    });

    const stats = monitor.getWorkflowStats('wf1');
    expect(stats.totalExecutions).toBe(1);
    expect(stats.successCount).toBe(1);
    expect(stats.avgDuration).toBe(1000);
  });

  test('should track success rate', () => {
    monitor.record({ workflowId: 'wf1', instanceId: 'i1', status: 'completed', duration: 100, timestamp: new Date() });
    monitor.record({ workflowId: 'wf1', instanceId: 'i2', status: 'completed', duration: 200, timestamp: new Date() });
    monitor.record({ workflowId: 'wf1', instanceId: 'i3', status: 'failed', duration: 50, timestamp: new Date() });

    const stats = monitor.getWorkflowStats('wf1');
    expect(stats.successRate).toBeCloseTo(2 / 3);
  });

  test('should track step metrics', () => {
    monitor.record({
      workflowId: 'wf1', instanceId: 'i1', status: 'completed',
      stepId: 'step1', stepStatus: 'completed', duration: 100, timestamp: new Date(),
    });
    monitor.record({
      workflowId: 'wf1', instanceId: 'i2', status: 'completed',
      stepId: 'step1', stepStatus: 'completed', duration: 200, timestamp: new Date(),
    });

    const stats = monitor.getWorkflowStats('wf1');
    const stepMetrics = stats.stepMetrics.get('step1');
    expect(stepMetrics).toBeDefined();
    expect(stepMetrics!.executionCount).toBe(2);
    expect(stepMetrics!.avgDuration).toBe(150);
  });

  test('should generate dashboard', () => {
    monitor.record({ workflowId: 'wf1', instanceId: 'i1', status: 'running', timestamp: new Date() });
    monitor.record({ workflowId: 'wf1', instanceId: 'i2', status: 'completed', duration: 500, timestamp: new Date() });
    monitor.record({ workflowId: 'wf1', instanceId: 'i3', status: 'failed', duration: 300, timestamp: new Date() });

    const dashboard = monitor.getDashboard();
    expect(dashboard.activeWorkflows).toBeGreaterThanOrEqual(0);
    expect(dashboard.completedWorkflows).toBe(1);
    expect(dashboard.failedWorkflows).toBe(1);
  });

  test('should detect bottleneck steps', () => {
    monitor.record({
      workflowId: 'wf1', instanceId: 'i1', status: 'completed',
      stepId: 'slow-step', stepStatus: 'completed', duration: 5000, timestamp: new Date(),
    });
    monitor.record({
      workflowId: 'wf1', instanceId: 'i2', status: 'completed',
      stepId: 'fast-step', stepStatus: 'completed', duration: 100, timestamp: new Date(),
    });

    const dashboard = monitor.getDashboard();
    expect(dashboard.bottleneckSteps.length).toBeGreaterThan(0);
    expect(dashboard.bottleneckSteps[0].stepId).toBe('slow-step');
  });

  test('should fire alert rules', () => {
    monitor.addAlertRule({
      id: 'high-failure',
      name: 'High Failure Rate',
      condition: (stats) => stats.failureCount > 2,
      message: 'Failure rate is too high',
      enabled: true,
    });

    monitor.record({ workflowId: 'wf1', instanceId: 'i1', status: 'failed', timestamp: new Date() });
    monitor.record({ workflowId: 'wf1', instanceId: 'i2', status: 'failed', timestamp: new Date() });
    monitor.record({ workflowId: 'wf1', instanceId: 'i3', status: 'failed', timestamp: new Date() });

    const alerts = monitor.getRecentAlerts();
    expect(alerts.length).toBeGreaterThan(0);
  });

  test('should return empty stats for unknown workflow', () => {
    const stats = monitor.getWorkflowStats('unknown');
    expect(stats.totalExecutions).toBe(0);
    expect(stats.successRate).toBe(0);
  });

  test('should clear all data', () => {
    monitor.record({ workflowId: 'wf1', instanceId: 'i1', status: 'completed', duration: 100, timestamp: new Date() });
    monitor.clear();
    const stats = monitor.getWorkflowStats('wf1');
    expect(stats.totalExecutions).toBe(0);
  });

  test('should clear alerts', () => {
    monitor.addAlertRule({
      id: 'test', name: 'Test', condition: () => true, message: 'test', enabled: true,
    });
    monitor.record({ workflowId: 'wf1', instanceId: 'i1', status: 'failed', timestamp: new Date() });
    monitor.clearAlerts();
    expect(monitor.getRecentAlerts()).toHaveLength(0);
  });

  test('should remove alert rules', () => {
    monitor.addAlertRule({
      id: 'remove-me', name: 'Remove Me', condition: () => true, message: 'test', enabled: true,
    });
    monitor.removeAlertRule('remove-me');
    monitor.record({ workflowId: 'wf1', instanceId: 'i1', status: 'failed', timestamp: new Date() });
    const alerts = monitor.getRecentAlerts();
    expect(alerts.every(a => a.ruleId !== 'remove-me')).toBe(true);
  });
});

// ============================================================
// Module 10: Workflow Templates Tests
// ============================================================
describe('WorkflowTemplateLibrary', () => {
  let library: WorkflowTemplateLibrary;

  beforeEach(() => {
    library = new WorkflowTemplateLibrary();
  });

  test('should have built-in templates', () => {
    const templates = library.listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(6);
  });

  test('should get template by name', () => {
    const template = library.getTemplate('ci-cd-pipeline');
    expect(template).toBeDefined();
    expect(template!.name).toBe('ci-cd-pipeline');
    expect(template!.version).toBe('1.0.0');
  });

  test('should return undefined for unknown template', () => {
    expect(library.getTemplate('nonexistent')).toBeUndefined();
  });

  test('should instantiate CI/CD pipeline template', () => {
    const def = library.instantiate('ci-cd-pipeline', { projectName: 'my-app' });
    expect(def.id).toContain('my-app');
    expect(def.steps.length).toBeGreaterThan(0);
    expect(def.steps[0].type).toBe('task');
  });

  test('should instantiate code review template', () => {
    const def = library.instantiate('code-review', { repository: 'github.com/test/repo' });
    expect(def.id).toContain('github.com/test/repo');
    expect(def.steps.some(s => s.type === 'approval')).toBe(true);
  });

  test('should instantiate deployment template', () => {
    const def = library.instantiate('deployment', { serviceName: 'api', environment: 'staging' });
    expect(def.id).toContain('api');
    expect(def.steps.some(s => s.id === 'rollback')).toBe(true);
  });

  test('should instantiate data processing template', () => {
    const def = library.instantiate('data-processing', { source: 'db', destination: 'warehouse' });
    expect(def.steps.some(s => s.type === 'transform')).toBe(true);
  });

  test('should instantiate approval flow template', () => {
    const def = library.instantiate('approval-flow', { requestType: 'vacation' });
    expect(def.steps.some(s => s.type === 'approval')).toBe(true);
  });

  test('should instantiate incident response template', () => {
    const def = library.instantiate('incident-response', { incidentId: 'INC-001' });
    expect(def.id).toContain('INC-001');
    expect(def.steps.some(s => s.id === 'post-mortem')).toBe(true);
  });

  test('should apply default parameters', () => {
    const def = library.instantiate('ci-cd-pipeline', { projectName: 'test' });
    // buildCommand should default to 'npm run build'
    const buildStep = def.steps.find(s => s.id === 'build');
    expect(buildStep?.config.command).toBe('npm run build');
  });

  test('should throw on missing required parameters', () => {
    expect(() => library.instantiate('ci-cd-pipeline', {})).toThrow('Required parameter');
  });

  test('should register custom template', () => {
    library.register({
      name: 'custom-template',
      version: '1.0.0',
      description: 'Custom template',
      parameters: [],
      definition: (params) => ({
        id: `custom-${JSON.stringify(params)}`,
        name: 'Custom Workflow',
        version: '1.0.0',
        steps: [{ id: 's1', name: 'Step 1', type: 'task', config: params, next: [] }],
      }),
    });

    const template = library.getTemplate('custom-template');
    expect(template).toBeDefined();
    expect(template!.name).toBe('custom-template');
  });

  test('should instantiate custom template', () => {
    library.register({
      name: 'custom-wf',
      version: '1.0.0',
      description: 'Custom',
      parameters: [
        { name: 'greeting', type: 'string', required: true, defaultValue: 'hello' },
      ],
      definition: (params) => ({
        id: 'custom-wf',
        name: 'Custom',
        version: '1.0.0',
        steps: [{ id: 's1', name: 'S1', type: 'task', config: { greeting: params.greeting }, next: [] }],
      }),
    });

    const def = library.instantiate('custom-wf', {});
    expect(def.steps[0].config.greeting).toBe('hello');
  });

  test('should export template to JSON', () => {
    const json = library.exportTemplate('ci-cd-pipeline');
    expect(json).toBeDefined();
    const parsed = JSON.parse(json!);
    expect(parsed.name).toBe('ci-cd-pipeline');
    expect(parsed.parameters).toBeDefined();
  });

  test('should return undefined when exporting non-existent template', () => {
    expect(library.exportTemplate('nonexistent')).toBeUndefined();
  });

  test('should import template from JSON', () => {
    const json = JSON.stringify({
      name: 'imported-template',
      version: '1.0.0',
      description: 'Imported',
      parameters: [],
    });
    library.importTemplate(json, (params) => ({
      id: 'imported',
      name: 'Imported',
      version: '1.0.0',
      steps: [{ id: 's1', name: 'S1', type: 'task', config: params, next: [] }],
    }));
    expect(library.getTemplate('imported-template')).toBeDefined();
  });

  test('should remove template', () => {
    library.register({
      name: 'temp-template',
      version: '1.0.0',
      description: 'Temporary',
      parameters: [],
      definition: () => ({ id: 'temp', name: 'Temp', version: '1.0.0', steps: [] }),
    });
    expect(library.getTemplate('temp-template')).toBeDefined();
    library.removeTemplate('temp-template');
    expect(library.getTemplate('temp-template')).toBeUndefined();
  });

  test('should validate parameters', () => {
    library.register({
      name: 'validated',
      version: '1.0.0',
      description: 'Validated',
      parameters: [
        { name: 'age', type: 'number', required: true, validation: (v) => Number(v) >= 0 },
      ],
      definition: (params) => ({ id: 'v', name: 'V', version: '1.0.0', steps: [], variables: params }),
    });

    expect(() => library.instantiate('validated', { age: -1 })).toThrow('Validation failed');
    const def = library.instantiate('validated', { age: 25 });
    expect(def.variables?.age).toBe(25);
  });
});
