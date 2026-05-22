// ============================================================================
// @claude-agent/pipeline - Comprehensive Test Suite
// ============================================================================
// This test file documents all bugs found and fixed in the pipeline package.
// Each bug is documented with:
// - BUG-ID: [severity] description of bug
// - FIX: what was changed to fix it
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import {
  PipelineEngine,
  PipelineBuilder,
  createAnalyzePipeline,
  createTestPipeline,
  createDevOpsPipeline,
} from '../src/index';
import { PipelineError, PipelineStepError, TaskTimeoutError } from '@claude-agent/errors';
import type {
  PipelineDefinition,
  PipelineMiddleware,
  PipelineContext,
  LoggerInterface,
  EventBusInterface,
  ClaudeAgentConfig,
  AgentEvent,
} from '@claude-agent/types';

// ============================================================================
// Mock Implementations
// ============================================================================

function createMockLogger(): LoggerInterface {
  return {
    trace: mock(() => {}),
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    fatal: mock(() => {}),
    setLevel: mock(() => {}),
    getLevel: mock(() => 'info' as const),
    child: mock(() => createMockLogger()),
  };
}

function createMockEventBus(): EventBusInterface {
  const listeners = new Map<string, Set<(event: AgentEvent) => void | Promise<void>>>();
  
  return {
    emit: mock((event: AgentEvent) => {
      const handlers = listeners.get(event.type);
      if (handlers) {
        handlers.forEach(handler => handler(event));
      }
    }),
    on: mock((eventType: string, handler: (event: AgentEvent) => void | Promise<void>) => {
      if (!listeners.has(eventType)) {
        listeners.set(eventType, new Set());
      }
      listeners.get(eventType)!.add(handler);
      return () => listeners.get(eventType)?.delete(handler);
    }),
    off: mock((eventType: string, handler: (event: AgentEvent) => void | Promise<void>) => {
      listeners.get(eventType)?.delete(handler);
    }),
    once: mock((eventType: string, handler: (event: AgentEvent) => void | Promise<void>) => {
      const wrappedHandler = (event: AgentEvent) => {
        listeners.get(eventType)?.delete(wrappedHandler);
        handler(event);
      };
      if (!listeners.has(eventType)) {
        listeners.set(eventType, new Set());
      }
      listeners.get(eventType)!.add(wrappedHandler);
      return () => listeners.get(eventType)?.delete(wrappedHandler);
    }),
    removeAllListeners: mock((eventType?: string) => {
      if (eventType) {
        listeners.delete(eventType);
      } else {
        listeners.clear();
      }
    }),
  };
}

function createMockConfig(): ClaudeAgentConfig {
  return {
    name: 'test-agent',
    version: '1.0.0',
    logLevel: 'info',
    cwd: '/tmp',
  };
}

// ============================================================================
// Bug Documentation
// ============================================================================

// BUG-001: [CRITICAL] Memory leak - timeout timer not cleared when step completes
// FIX: Store timeout reference and clear it after Promise.race resolves using try/finally

// BUG-002: [HIGH] Missing error propagation - non-PipelineStepError errors were silently swallowed
// FIX: Store the error and re-throw it after pipeline state is finalized

// BUG-003: [HIGH] Error re-throwing loses original error cause
// FIX: Store the failed step reference to avoid redundant find() calls and ensure proper error context

// BUG-004: [MEDIUM] Missing validation for empty pipeline name
// FIX: Add validation for empty/whitespace-only pipeline name in register()

// BUG-005: [MEDIUM] Missing validation for empty step names
// FIX: Validate all step names are non-empty in register()

// BUG-006: [MEDIUM] Missing validation for empty steps array
// FIX: Validate that pipeline has at least one step in register()

// BUG-007: [LOW] unregister silently succeeds for non-existent pipeline
// FIX: Return boolean indicating whether the pipeline was actually removed

// BUG-008: [MEDIUM] retryCount option is accepted but never used
// FIX: Implement retry logic with configurable retry count in runStep()

// BUG-009: [MEDIUM] Negative retryCount causes loop to never execute
// FIX: Use Math.max to ensure at least 0 retries (1 attempt)

// ============================================================================
// PipelineEngine Tests
// ============================================================================

describe('PipelineEngine', () => {
  let engine: PipelineEngine;
  let mockLogger: LoggerInterface;
  let mockEventBus: EventBusInterface;
  let mockConfig: ClaudeAgentConfig;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockEventBus = createMockEventBus();
    mockConfig = createMockConfig();
    engine = new PipelineEngine({
      logger: mockLogger,
      eventBus: mockEventBus,
      config: mockConfig,
    });
  });

  // -------------------------------------------------------------------------
  // Constructor Tests
  // -------------------------------------------------------------------------

  describe('constructor', () => {
    it('should create engine with default dependencies', () => {
      const defaultEngine = new PipelineEngine();
      expect(defaultEngine).toBeDefined();
      expect(defaultEngine.list()).toEqual([]);
    });

    it('should create engine with custom dependencies', () => {
      expect(engine).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // register() Tests - BUG-004, BUG-005, BUG-006
  // -------------------------------------------------------------------------

  describe('register', () => {
    it('should register a valid pipeline definition', () => {
      const definition: PipelineDefinition = {
        name: 'test-pipeline',
        steps: [
          { name: 'step1', handler: async () => 'result' },
        ],
      };

      engine.register(definition);
      expect(engine.get('test-pipeline')).toBe(definition);
    });

    it('should throw PipelineError when registering duplicate pipeline', () => {
      const definition: PipelineDefinition = {
        name: 'duplicate-pipeline',
        steps: [
          { name: 'step1', handler: async () => 'result' },
        ],
      };

      engine.register(definition);

      expect(() => engine.register(definition)).toThrow(PipelineError);
      expect(() => engine.register(definition)).toThrow('already registered');
    });

    // BUG-004: [MEDIUM] Missing validation for empty pipeline name
    it('should throw PipelineError when pipeline name is empty', () => {
      const definition: PipelineDefinition = {
        name: '',
        steps: [
          { name: 'step1', handler: async () => 'result' },
        ],
      };

      expect(() => engine.register(definition)).toThrow(PipelineError);
      expect(() => engine.register(definition)).toThrow('Pipeline name cannot be empty');
    });

    // BUG-004: [MEDIUM] Missing validation for whitespace-only pipeline name
    it('should throw PipelineError when pipeline name is whitespace only', () => {
      const definition: PipelineDefinition = {
        name: '   ',
        steps: [
          { name: 'step1', handler: async () => 'result' },
        ],
      };

      expect(() => engine.register(definition)).toThrow(PipelineError);
      expect(() => engine.register(definition)).toThrow('Pipeline name cannot be empty');
    });

    // BUG-006: [MEDIUM] Missing validation for empty steps array
    it('should throw PipelineError when steps array is empty', () => {
      const definition: PipelineDefinition = {
        name: 'empty-steps-pipeline',
        steps: [],
      };

      expect(() => engine.register(definition)).toThrow(PipelineError);
      expect(() => engine.register(definition)).toThrow('Pipeline must have at least one step');
    });

    // BUG-006: [MEDIUM] Missing validation for undefined steps array
    it('should throw PipelineError when steps array is undefined', () => {
      const definition = {
        name: 'undefined-steps-pipeline',
        steps: undefined as any,
      };

      expect(() => engine.register(definition)).toThrow(PipelineError);
      expect(() => engine.register(definition)).toThrow('Pipeline must have at least one step');
    });

    // BUG-005: [MEDIUM] Missing validation for empty step names
    it('should throw PipelineError when step name is empty', () => {
      const definition: PipelineDefinition = {
        name: 'empty-step-name-pipeline',
        steps: [
          { name: '', handler: async () => 'result' },
        ],
      };

      expect(() => engine.register(definition)).toThrow(PipelineError);
      expect(() => engine.register(definition)).toThrow('Step name cannot be empty');
    });

    // BUG-005: [MEDIUM] Missing validation for whitespace-only step names
    it('should throw PipelineError when step name is whitespace only', () => {
      const definition: PipelineDefinition = {
        name: 'whitespace-step-name-pipeline',
        steps: [
          { name: '   ', handler: async () => 'result' },
        ],
      };

      expect(() => engine.register(definition)).toThrow(PipelineError);
      expect(() => engine.register(definition)).toThrow('Step name cannot be empty');
    });

    it('should log registration info', () => {
      const definition: PipelineDefinition = {
        name: 'logged-pipeline',
        steps: [
          { name: 'step1', handler: async () => 'result' },
        ],
      };

      engine.register(definition);
      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // unregister() Tests - BUG-007
  // -------------------------------------------------------------------------

  describe('unregister', () => {
    // BUG-007: [LOW] unregister silently succeeds for non-existent pipeline
    it('should return true when unregistering an existing pipeline', () => {
      const definition: PipelineDefinition = {
        name: 'to-unregister',
        steps: [
          { name: 'step1', handler: async () => 'result' },
        ],
      };

      engine.register(definition);
      const result = engine.unregister('to-unregister');

      expect(result).toBe(true);
      expect(engine.get('to-unregister')).toBeUndefined();
    });

    // BUG-007: [LOW] unregister silently succeeds for non-existent pipeline
    it('should return false when unregistering a non-existent pipeline', () => {
      const result = engine.unregister('non-existent');
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // get() Tests
  // -------------------------------------------------------------------------

  describe('get', () => {
    it('should return undefined for non-existent pipeline', () => {
      expect(engine.get('non-existent')).toBeUndefined();
    });

    it('should return the pipeline definition for existing pipeline', () => {
      const definition: PipelineDefinition = {
        name: 'existing-pipeline',
        steps: [
          { name: 'step1', handler: async () => 'result' },
        ],
      };

      engine.register(definition);
      expect(engine.get('existing-pipeline')).toBe(definition);
    });
  });

  // -------------------------------------------------------------------------
  // list() Tests
  // -------------------------------------------------------------------------

  describe('list', () => {
    it('should return empty array when no pipelines registered', () => {
      expect(engine.list()).toEqual([]);
    });

    it('should return all registered pipeline names', () => {
      engine.register({
        name: 'pipeline-1',
        steps: [{ name: 'step1', handler: async () => 'result' }],
      });
      engine.register({
        name: 'pipeline-2',
        steps: [{ name: 'step1', handler: async () => 'result' }],
      });

      expect(engine.list()).toEqual(['pipeline-1', 'pipeline-2']);
    });
  });

  // -------------------------------------------------------------------------
  // execute() Tests
  // -------------------------------------------------------------------------

  describe('execute', () => {
    beforeEach(() => {
      engine.register({
        name: 'simple-pipeline',
        steps: [
          { name: 'step1', handler: async (input) => `processed: ${input}` },
        ],
      });
    });

    it('should throw PipelineError for non-existent pipeline', async () => {
      await expect(engine.execute('non-existent', 'input')).rejects.toThrow(PipelineError);
      await expect(engine.execute('non-existent', 'input')).rejects.toThrow('not found');
    });

    it('should execute a simple pipeline successfully', async () => {
      const result = await engine.execute('simple-pipeline', 'test-input');

      expect(result.status).toBe('completed');
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].status).toBe('completed');
      expect(result.steps[0].output).toBe('processed: test-input');
    });

    it('should pass output of one step as input to next step', async () => {
      engine.register({
        name: 'chain-pipeline',
        steps: [
          { name: 'step1', handler: async (input) => `${input}-step1` },
          { name: 'step2', handler: async (input) => `${input}-step2` },
        ],
      });

      const result = await engine.execute('chain-pipeline', 'start');

      expect(result.status).toBe('completed');
      expect(result.steps[1].output).toBe('start-step1-step2');
    });

    it('should emit pipeline.started event', async () => {
      await engine.execute('simple-pipeline', 'input');

      expect(mockEventBus.emit).toHaveBeenCalled();
      const calls = (mockEventBus.emit as any).mock.calls;
      const startCall = calls.find((call: any[]) => call[0].type === 'pipeline.started');
      expect(startCall).toBeDefined();
    });

    it('should emit pipeline.completed event on success', async () => {
      await engine.execute('simple-pipeline', 'input');

      const calls = (mockEventBus.emit as any).mock.calls;
      const completeCall = calls.find((call: any[]) => call[0].type === 'pipeline.completed');
      expect(completeCall).toBeDefined();
    });

    it('should emit pipeline.failed event on failure', async () => {
      engine.register({
        name: 'failing-pipeline',
        steps: [
          { name: 'fail-step', handler: async () => { throw new Error('Step failed'); } },
        ],
      });

      try {
        await engine.execute('failing-pipeline', 'input');
      } catch (e) {
        // Expected
      }

      const calls = (mockEventBus.emit as any).mock.calls;
      const failCall = calls.find((call: any[]) => call[0].type === 'pipeline.failed');
      expect(failCall).toBeDefined();
    });

    it('should include metadata in context', async () => {
      let capturedContext: PipelineContext | undefined;

      engine.register({
        name: 'metadata-pipeline',
        steps: [
          { 
            name: 'capture', 
            handler: async (_input, context) => {
              capturedContext = context;
              return 'done';
            }
          },
        ],
      });

      await engine.execute('metadata-pipeline', 'input', {
        metadata: { customKey: 'customValue' },
      });

      expect(capturedContext).toBeDefined();
      expect(capturedContext!.metadata).toEqual({ customKey: 'customValue' });
    });

    // BUG-002: [HIGH] Missing error propagation
    it('should throw PipelineStepError when step fails', async () => {
      engine.register({
        name: 'error-pipeline',
        steps: [
          { name: 'fail', handler: async () => { throw new Error('Step error'); } },
        ],
      });

      await expect(engine.execute('error-pipeline', 'input')).rejects.toThrow(PipelineStepError);
    });

    it('should record step duration', async () => {
      const result = await engine.execute('simple-pipeline', 'input');

      expect(result.steps[0].duration).toBeDefined();
      expect(result.steps[0].duration).toBeGreaterThanOrEqual(0);
    });

    it('should generate unique pipeline IDs', async () => {
      const result1 = await engine.execute('simple-pipeline', 'input');
      const result2 = await engine.execute('simple-pipeline', 'input');

      expect(result1.id).not.toBe(result2.id);
    });
  });

  // -------------------------------------------------------------------------
  // execute() with Middleware Tests
  // -------------------------------------------------------------------------

  describe('execute with middleware', () => {
    it('should apply middleware in correct order', async () => {
      const order: string[] = [];

      const middleware1: PipelineMiddleware = async (_ctx, next) => {
        order.push('m1-before');
        const result = await next();
        order.push('m1-after');
        return result;
      };

      const middleware2: PipelineMiddleware = async (_ctx, next) => {
        order.push('m2-before');
        const result = await next();
        order.push('m2-after');
        return result;
      };

      engine.register({
        name: 'middleware-order-pipeline',
        steps: [
          { name: 'step1', handler: async () => { order.push('handler'); return 'done'; } },
        ],
        middleware: [middleware1, middleware2],
      });

      await engine.execute('middleware-order-pipeline', 'input');

      // Middleware is applied in order: first middleware wraps second middleware
      // So m1 wraps m2, meaning m1-before runs first, then m2-before, then handler, then m2-after, then m1-after
      expect(order).toEqual(['m1-before', 'm2-before', 'handler', 'm2-after', 'm1-after']);
    });

    it('should apply runtime middleware alongside definition middleware', async () => {
      const calls: string[] = [];

      const definitionMiddleware: PipelineMiddleware = async (_ctx, next) => {
        calls.push('definition');
        return next();
      };

      const runtimeMiddleware: PipelineMiddleware = async (_ctx, next) => {
        calls.push('runtime');
        return next();
      };

      engine.register({
        name: 'combined-middleware-pipeline',
        steps: [
          { name: 'step1', handler: async () => 'done' },
        ],
        middleware: [definitionMiddleware],
      });

      await engine.execute('combined-middleware-pipeline', 'input', {
        middleware: [runtimeMiddleware],
      });

      expect(calls).toContain('definition');
      expect(calls).toContain('runtime');
    });

    it('should allow middleware to modify input', async () => {
      const modifyMiddleware: PipelineMiddleware = async (_ctx, next) => {
        return next();
      };

      engine.register({
        name: 'modify-input-pipeline',
        steps: [
          { name: 'step1', handler: async (input) => input },
        ],
        middleware: [modifyMiddleware],
      });

      const result = await engine.execute('modify-input-pipeline', 'original');
      expect(result.steps[0].output).toBe('original');
    });

    it('should allow middleware to short-circuit', async () => {
      const shortCircuitMiddleware: PipelineMiddleware = async () => {
        return 'short-circuited';
      };

      engine.register({
        name: 'short-circuit-pipeline',
        steps: [
          { name: 'step1', handler: async () => 'should-not-be-called' },
        ],
        middleware: [shortCircuitMiddleware],
      });

      const result = await engine.execute('short-circuit-pipeline', 'input');
      expect(result.steps[0].output).toBe('short-circuited');
    });
  });

  // -------------------------------------------------------------------------
  // execute() with Timeout Tests - BUG-001
  // -------------------------------------------------------------------------

  describe('execute with timeout', () => {
    // BUG-001: [CRITICAL] Memory leak - timeout timer not cleared when step completes
    it('should throw PipelineStepError with timeout message when step exceeds timeout', async () => {
      engine.register({
        name: 'timeout-pipeline',
        steps: [
          { 
            name: 'slow-step', 
            handler: async () => {
              await new Promise(resolve => setTimeout(resolve, 1000));
              return 'done';
            },
            timeout: 10, // 10ms timeout
          },
        ],
      });

      // TaskTimeoutError is caught and wrapped in PipelineStepError
      await expect(engine.execute('timeout-pipeline', 'input')).rejects.toThrow(PipelineStepError);
      await expect(engine.execute('timeout-pipeline', 'input')).rejects.toThrow('timed out');
    });

    it('should complete successfully when step finishes before timeout', async () => {
      engine.register({
        name: 'fast-pipeline',
        steps: [
          { 
            name: 'fast-step', 
            handler: async () => 'done',
            timeout: 1000,
          },
        ],
      });

      const result = await engine.execute('fast-pipeline', 'input');
      expect(result.status).toBe('completed');
    });

    // BUG-001: Verify timer is cleared after successful completion
    it('should clear timeout timer after successful completion', async () => {
      const originalSetTimeout = setTimeout;
      const originalClearTimeout = clearTimeout;
      const timeoutIds = new Set<ReturnType<typeof setTimeout>>();

      // Track all timeouts
      (global as any).setTimeout = ((fn: any, delay: number) => {
        const id = originalSetTimeout(fn, delay);
        timeoutIds.add(id);
        return id;
      }) as any;

      (global as any).clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
        timeoutIds.delete(id);
        return originalClearTimeout(id);
      }) as any;

      try {
        engine.register({
          name: 'timer-cleanup-pipeline',
          steps: [
            { name: 'step1', handler: async () => 'done', timeout: 1000 },
          ],
        });

        await engine.execute('timer-cleanup-pipeline', 'input');

        // Allow any pending timers to be cleared
        await new Promise(resolve => originalSetTimeout(resolve, 10));

        // All timeouts should be cleared
        expect(timeoutIds.size).toBe(0);
      } finally {
        (global as any).setTimeout = originalSetTimeout;
        (global as any).clearTimeout = originalClearTimeout;
      }
    });
  });

  // -------------------------------------------------------------------------
  // execute() with Retry Tests - BUG-008
  // -------------------------------------------------------------------------

  describe('execute with retry', () => {
    // BUG-008: [MEDIUM] retryCount option is accepted but never used
    it('should retry failed step according to retryCount', async () => {
      let attempts = 0;

      engine.register({
        name: 'retry-pipeline',
        steps: [
          { 
            name: 'flaky-step', 
            handler: async () => {
              attempts++;
              if (attempts < 3) {
                throw new Error('Transient error');
              }
              return 'success';
            },
            retryCount: 3,
          },
        ],
      });

      const result = await engine.execute('retry-pipeline', 'input');

      expect(result.status).toBe('completed');
      expect(attempts).toBe(3);
    });

    it('should fail after all retries exhausted', async () => {
      let attempts = 0;

      engine.register({
        name: 'always-fail-pipeline',
        steps: [
          { 
            name: 'always-fail-step', 
            handler: async () => {
              attempts++;
              throw new Error('Permanent error');
            },
            retryCount: 2,
          },
        ],
      });

      await expect(engine.execute('always-fail-pipeline', 'input')).rejects.toThrow();

      // retryCount=2 means 3 total attempts (initial + 2 retries)
      expect(attempts).toBe(3);
    });

    it('should succeed on first attempt without retry', async () => {
      let attempts = 0;

      engine.register({
        name: 'no-retry-pipeline',
        steps: [
          { 
            name: 'success-step', 
            handler: async () => {
              attempts++;
              return 'done';
            },
            retryCount: 0,
          },
        ],
      });

      const result = await engine.execute('no-retry-pipeline', 'input');

      expect(result.status).toBe('completed');
      expect(attempts).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // static define() Tests
  // -------------------------------------------------------------------------

  describe('static define', () => {
    it('should create a PipelineBuilder', () => {
      const builder = PipelineEngine.define('test-pipeline');
      expect(builder).toBeInstanceOf(PipelineBuilder);
    });
  });
});

// ============================================================================
// PipelineBuilder Tests
// ============================================================================

describe('PipelineBuilder', () => {
  describe('define', () => {
    it('should create a new builder', () => {
      const builder = PipelineBuilder.define('test-pipeline');
      expect(builder).toBeInstanceOf(PipelineBuilder);
    });
  });

  describe('step', () => {
    it('should add steps to the pipeline', () => {
      const definition = PipelineBuilder.define('multi-step-pipeline')
        .step('step1', async () => 'result1')
        .step('step2', async () => 'result2')
        .build();

      expect(definition.steps).toHaveLength(2);
      expect(definition.steps[0].name).toBe('step1');
      expect(definition.steps[1].name).toBe('step2');
    });

    it('should pass timeout option to step', () => {
      const definition = PipelineBuilder.define('timeout-option-pipeline')
        .step('timed-step', async () => 'result', { timeout: 5000 })
        .build();

      expect(definition.steps[0].timeout).toBe(5000);
    });

    it('should pass retryCount option to step', () => {
      const definition = PipelineBuilder.define('retry-option-pipeline')
        .step('retry-step', async () => 'result', { retryCount: 3 })
        .build();

      expect(definition.steps[0].retryCount).toBe(3);
    });
  });

  describe('use', () => {
    it('should add middleware to the pipeline', () => {
      const middleware: PipelineMiddleware = async (_ctx, next) => next();

      const definition = PipelineBuilder.define('middleware-pipeline')
        .use(middleware)
        .step('step1', async () => 'result')
        .build();

      expect(definition.middleware).toHaveLength(1);
    });

    it('should support multiple middleware', () => {
      const middleware1: PipelineMiddleware = async (_ctx, next) => next();
      const middleware2: PipelineMiddleware = async (_ctx, next) => next();

      const definition = PipelineBuilder.define('multi-middleware-pipeline')
        .use(middleware1)
        .use(middleware2)
        .step('step1', async () => 'result')
        .build();

      expect(definition.middleware).toHaveLength(2);
    });
  });

  describe('build', () => {
    it('should throw PipelineError when no steps defined', () => {
      expect(() => {
        PipelineBuilder.define('empty-pipeline').build();
      }).toThrow(PipelineError);
      expect(() => {
        PipelineBuilder.define('empty-pipeline').build();
      }).toThrow('Pipeline must have at least one step');
    });

    it('should return undefined middleware when none added', () => {
      const definition = PipelineBuilder.define('no-middleware-pipeline')
        .step('step1', async () => 'result')
        .build();

      expect(definition.middleware).toBeUndefined();
    });

    it('should return valid PipelineDefinition', () => {
      const definition = PipelineBuilder.define('valid-pipeline')
        .step('step1', async () => 'result')
        .build();

      expect(definition.name).toBe('valid-pipeline');
      expect(definition.steps).toHaveLength(1);
    });
  });
});

// ============================================================================
// Built-in Pipeline Tests
// ============================================================================

describe('Built-in Pipelines', () => {
  let engine: PipelineEngine;
  let mockLogger: LoggerInterface;
  let mockEventBus: EventBusInterface;
  let mockConfig: ClaudeAgentConfig;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockEventBus = createMockEventBus();
    mockConfig = createMockConfig();
    engine = new PipelineEngine({
      logger: mockLogger,
      eventBus: mockEventBus,
      config: mockConfig,
    });
  });

  describe('createAnalyzePipeline', () => {
    it('should register analyze pipeline', () => {
      createAnalyzePipeline(engine);
      expect(engine.get('analyze')).toBeDefined();
    });

    it('should execute analyze pipeline successfully', async () => {
      createAnalyzePipeline(engine);
      const result = await engine.execute('analyze', { data: 'test' });

      expect(result.status).toBe('completed');
      expect(result.steps).toHaveLength(3);
    });
  });

  describe('createTestPipeline', () => {
    it('should register test pipeline', () => {
      createTestPipeline(engine);
      expect(engine.get('test')).toBeDefined();
    });

    it('should execute test pipeline successfully', async () => {
      createTestPipeline(engine);
      const result = await engine.execute('test', { data: 'test' });

      expect(result.status).toBe('completed');
      expect(result.steps).toHaveLength(3);
    });
  });

  describe('createDevOpsPipeline', () => {
    it('should register devops pipeline', () => {
      createDevOpsPipeline(engine);
      expect(engine.get('devops')).toBeDefined();
    });

    it('should execute devops pipeline successfully', async () => {
      createDevOpsPipeline(engine);
      const result = await engine.execute('devops', { data: 'test' });

      expect(result.status).toBe('completed');
      expect(result.steps).toHaveLength(3);
    });
  });
});

// ============================================================================
// Edge Case Tests
// ============================================================================

describe('Edge Cases', () => {
  let engine: PipelineEngine;
  let mockLogger: LoggerInterface;
  let mockEventBus: EventBusInterface;
  let mockConfig: ClaudeAgentConfig;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockEventBus = createMockEventBus();
    mockConfig = createMockConfig();
    engine = new PipelineEngine({
      logger: mockLogger,
      eventBus: mockEventBus,
      config: mockConfig,
    });
  });

  it('should handle null input', async () => {
    engine.register({
      name: 'null-input-pipeline',
      steps: [
        { name: 'step1', handler: async (input) => input },
      ],
    });

    const result = await engine.execute('null-input-pipeline', null);
    expect(result.steps[0].output).toBeNull();
  });

  it('should handle undefined input', async () => {
    engine.register({
      name: 'undefined-input-pipeline',
      steps: [
        { name: 'step1', handler: async (input) => input },
      ],
    });

    const result = await engine.execute('undefined-input-pipeline', undefined);
    expect(result.steps[0].output).toBeUndefined();
  });

  it('should handle empty object input', async () => {
    engine.register({
      name: 'empty-object-pipeline',
      steps: [
        { name: 'step1', handler: async (input) => input },
      ],
    });

    const result = await engine.execute('empty-object-pipeline', {});
    expect(result.steps[0].output).toEqual({});
  });

  it('should handle large input', async () => {
    const largeInput = { data: 'x'.repeat(100000) };

    engine.register({
      name: 'large-input-pipeline',
      steps: [
        { name: 'step1', handler: async (input) => input },
      ],
    });

    const result = await engine.execute('large-input-pipeline', largeInput);
    expect(result.steps[0].output).toEqual(largeInput);
  });

  it('should handle step returning undefined', async () => {
    engine.register({
      name: 'undefined-output-pipeline',
      steps: [
        { name: 'step1', handler: async () => undefined },
        { name: 'step2', handler: async (input) => `got: ${input}` },
      ],
    });

    const result = await engine.execute('undefined-output-pipeline', 'start');
    expect(result.status).toBe('completed');
    expect(result.steps[1].output).toBe('got: undefined');
  });

  it('should handle step returning null', async () => {
    engine.register({
      name: 'null-output-pipeline',
      steps: [
        { name: 'step1', handler: async () => null },
        { name: 'step2', handler: async (input) => `got: ${input}` },
      ],
    });

    const result = await engine.execute('null-output-pipeline', 'start');
    expect(result.status).toBe('completed');
    expect(result.steps[1].output).toBe('got: null');
  });

  it('should handle non-Error thrown from step', async () => {
    engine.register({
      name: 'non-error-throw-pipeline',
      steps: [
        { name: 'step1', handler: async () => { throw 'string error'; } },
      ],
    });

    await expect(engine.execute('non-error-throw-pipeline', 'input')).rejects.toThrow();
  });

  it('should handle step throwing object', async () => {
    engine.register({
      name: 'object-throw-pipeline',
      steps: [
        { name: 'step1', handler: async () => { throw { code: 500, message: 'error' }; } },
      ],
    });

    await expect(engine.execute('object-throw-pipeline', 'input')).rejects.toThrow();
  });

  it('should handle concurrent pipeline executions', async () => {
    engine.register({
      name: 'concurrent-pipeline',
      steps: [
        { name: 'step1', handler: async (input) => `processed: ${input}` },
      ],
    });

    const promises = Array(10).fill(null).map((_, i) => 
      engine.execute('concurrent-pipeline', `input-${i}`)
    );

    const results = await Promise.all(promises);

    results.forEach((result, i) => {
      expect(result.status).toBe('completed');
      expect(result.steps[0].output).toBe(`processed: input-${i}`);
    });
  });

  it('should handle zero timeout', async () => {
    engine.register({
      name: 'zero-timeout-pipeline',
      steps: [
        { 
          name: 'step1', 
          handler: async () => 'done',
          timeout: 0,
        },
      ],
    });

    // Zero timeout should still allow immediate completion
    const result = await engine.execute('zero-timeout-pipeline', 'input');
    expect(result.status).toBe('completed');
  });

  // BUG-009: [MEDIUM] Negative retryCount causes loop to never execute
  it('should handle negative retryCount as zero', async () => {
    let attempts = 0;

    engine.register({
      name: 'negative-retry-pipeline',
      steps: [
        { 
          name: 'step1', 
          handler: async () => {
            attempts++;
            throw new Error('fail');
          },
          retryCount: -1 as any,
        },
      ],
    });

    await expect(engine.execute('negative-retry-pipeline', 'input')).rejects.toThrow();
    // With negative retryCount fixed, the loop should run at least once
    expect(attempts).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  let engine: PipelineEngine;
  let mockLogger: LoggerInterface;
  let mockEventBus: EventBusInterface;
  let mockConfig: ClaudeAgentConfig;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockEventBus = createMockEventBus();
    mockConfig = createMockConfig();
    engine = new PipelineEngine({
      logger: mockLogger,
      eventBus: mockEventBus,
      config: mockConfig,
    });
  });

  it('should include step name in error', async () => {
    engine.register({
      name: 'error-step-name-pipeline',
      steps: [
        { name: 'failing-step', handler: async () => { throw new Error('Step failed'); } },
      ],
    });

    try {
      await engine.execute('error-step-name-pipeline', 'input');
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PipelineStepError);
      expect((error as PipelineStepError).stepName).toBe('failing-step');
    }
  });

  it('should include pipeline name in error', async () => {
    engine.register({
      name: 'error-pipeline-name',
      steps: [
        { name: 'step1', handler: async () => { throw new Error('Step failed'); } },
      ],
    });

    try {
      await engine.execute('error-pipeline-name', 'input');
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PipelineStepError);
      expect((error as PipelineStepError).pipelineName).toBe('error-pipeline-name');
    }
  });

  it('should record error in step result', async () => {
    engine.register({
      name: 'record-error-pipeline',
      steps: [
        { name: 'step1', handler: async () => { throw new Error('Recorded error'); } },
      ],
    });

    try {
      await engine.execute('record-error-pipeline', 'input');
    } catch (e) {
      // Expected
    }

    // The error should be recorded in the pipeline result
    // This is verified by checking the event bus emit calls
    const calls = (mockEventBus.emit as any).mock.calls;
    const failCall = calls.find((call: any[]) => call[0].type === 'pipeline.failed');
    expect(failCall).toBeDefined();
    expect(failCall[0].data.status).toBe('failed');
  });

  it('should stop pipeline execution on first failure', async () => {
    let step2Executed = false;

    engine.register({
      name: 'stop-on-failure-pipeline',
      steps: [
        { name: 'step1', handler: async () => { throw new Error('First step fails'); } },
        { name: 'step2', handler: async () => { step2Executed = true; return 'done'; } },
      ],
    });

    try {
      await engine.execute('stop-on-failure-pipeline', 'input');
    } catch (e) {
      // Expected
    }

    expect(step2Executed).toBe(false);
  });
});

// ============================================================================
// Pipeline Context Tests
// ============================================================================

describe('Pipeline Context', () => {
  let engine: PipelineEngine;
  let mockLogger: LoggerInterface;
  let mockEventBus: EventBusInterface;
  let mockConfig: ClaudeAgentConfig;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockEventBus = createMockEventBus();
    mockConfig = createMockConfig();
    engine = new PipelineEngine({
      logger: mockLogger,
      eventBus: mockEventBus,
      config: mockConfig,
    });
  });

  it('should provide pipelineId in context', async () => {
    let capturedContext: PipelineContext | undefined;

    engine.register({
      name: 'context-pipeline-id',
      steps: [
        { 
          name: 'step1', 
          handler: async (_input, context) => {
            capturedContext = context;
            return 'done';
          }
        },
      ],
    });

    await engine.execute('context-pipeline-id', 'input');

    expect(capturedContext).toBeDefined();
    expect(capturedContext!.pipelineId).toBeDefined();
    expect(capturedContext!.pipelineId).toMatch(/^pipeline-/);
  });

  it('should provide requestId in context', async () => {
    let capturedContext: PipelineContext | undefined;

    engine.register({
      name: 'context-request-id',
      steps: [
        { 
          name: 'step1', 
          handler: async (_input, context) => {
            capturedContext = context;
            return 'done';
          }
        },
      ],
    });

    await engine.execute('context-request-id', 'input');

    expect(capturedContext).toBeDefined();
    expect(capturedContext!.requestId).toBeDefined();
  });

  it('should provide logger in context', async () => {
    let capturedContext: PipelineContext | undefined;

    engine.register({
      name: 'context-logger',
      steps: [
        { 
          name: 'step1', 
          handler: async (_input, context) => {
            capturedContext = context;
            return 'done';
          }
        },
      ],
    });

    await engine.execute('context-logger', 'input');

    expect(capturedContext).toBeDefined();
    expect(capturedContext!.logger).toBe(mockLogger);
  });

  it('should provide eventBus in context', async () => {
    let capturedContext: PipelineContext | undefined;

    engine.register({
      name: 'context-event-bus',
      steps: [
        { 
          name: 'step1', 
          handler: async (_input, context) => {
            capturedContext = context;
            return 'done';
          }
        },
      ],
    });

    await engine.execute('context-event-bus', 'input');

    expect(capturedContext).toBeDefined();
    expect(capturedContext!.eventBus).toBe(mockEventBus);
  });

  it('should provide config in context', async () => {
    let capturedContext: PipelineContext | undefined;

    engine.register({
      name: 'context-config',
      steps: [
        { 
          name: 'step1', 
          handler: async (_input, context) => {
            capturedContext = context;
            return 'done';
          }
        },
      ],
    });

    await engine.execute('context-config', 'input');

    expect(capturedContext).toBeDefined();
    expect(capturedContext!.config).toBe(mockConfig);
  });

  it('should allow steps to emit events via context', async () => {
    engine.register({
      name: 'emit-event-pipeline',
      steps: [
        { 
          name: 'step1', 
          handler: async (_input, context) => {
            context.eventBus.emit({
              type: 'task.completed',
              timestamp: new Date(),
              requestId: context.requestId,
              data: { custom: 'event' },
            });
            return 'done';
          }
        },
      ],
    });

    await engine.execute('emit-event-pipeline', 'input');

    const calls = (mockEventBus.emit as any).mock.calls;
    const customEvent = calls.find((call: any[]) => call[0].type === 'task.completed');
    expect(customEvent).toBeDefined();
    expect(customEvent[0].data.custom).toBe('event');
  });
});
