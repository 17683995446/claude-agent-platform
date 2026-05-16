// ============================================================================
// Tests for @claude-agent/pipeline
// ============================================================================

import { describe, test, expect, beforeEach } from 'bun:test';
import { PipelineEngine, PipelineBuilder, createAnalyzePipeline, createTestPipeline, createDevOpsPipeline } from '../packages/pipeline/src/index.js';
import { PipelineError, PipelineStepError } from '../packages/errors/src/index.js';
import { Logger } from '../packages/logger/src/index.js';
import { EventBus } from '../packages/core/src/index.js';

describe('@claude-agent/pipeline', () => {
  let engine: PipelineEngine;

  beforeEach(() => {
    engine = new PipelineEngine({
      logger: new Logger({ level: 'silent' }),
      eventBus: new EventBus(),
    });
  });

  describe('PipelineBuilder', () => {
    test('builds a valid pipeline', () => {
      const def = PipelineBuilder.define('test')
        .step('step1', async (input) => input)
        .step('step2', async (input) => input)
        .build();

      expect(def.name).toBe('test');
      expect(def.steps).toHaveLength(2);
      expect(def.steps[0]?.name).toBe('step1');
      expect(def.steps[1]?.name).toBe('step2');
    });

    test('throws when building with no steps', () => {
      expect(() => PipelineBuilder.define('empty').build()).toThrow(PipelineError);
    });

    test('supports step options', () => {
      const def = PipelineBuilder.define('test')
        .step('step1', async (input) => input, { timeout: 5000, retryCount: 3 })
        .build();

      expect(def.steps[0]?.timeout).toBe(5000);
      expect(def.steps[0]?.retryCount).toBe(3);
    });

    test('supports middleware', () => {
      const def = PipelineBuilder.define('test')
        .step('step1', async (input) => input)
        .use(async (ctx, next) => {
          return next();
        })
        .build();

      expect(def.middleware).toHaveLength(1);
    });
  });

  describe('PipelineEngine', () => {
    test('registers a pipeline', () => {
      const def = PipelineBuilder.define('test')
        .step('step1', async (input) => input)
        .build();

      engine.register(def);
      expect(engine.list()).toContain('test');
    });

    test('throws when registering duplicate', () => {
      const def = PipelineBuilder.define('test')
        .step('step1', async (input) => input)
        .build();

      engine.register(def);
      expect(() => engine.register(def)).toThrow(PipelineError);
    });

    test('unregisters a pipeline', () => {
      const def = PipelineBuilder.define('test')
        .step('step1', async (input) => input)
        .build();

      engine.register(def);
      engine.unregister('test');
      expect(engine.list()).not.toContain('test');
    });

    test('gets a registered pipeline', () => {
      const def = PipelineBuilder.define('test')
        .step('step1', async (input) => input)
        .build();

      engine.register(def);
      const retrieved = engine.get('test');
      expect(retrieved?.name).toBe('test');
    });

    test('executes a pipeline successfully', async () => {
      const def = PipelineBuilder.define('test')
        .step('step1', async (input: number) => input + 1)
        .step('step2', async (input: number) => input * 2)
        .build();

      engine.register(def);
      const result = await engine.execute('test', 5);

      expect(result.status).toBe('completed');
      expect(result.steps).toHaveLength(2);
      expect(result.steps[0]?.status).toBe('completed');
      expect(result.steps[1]?.status).toBe('completed');
    });

    test('pipeline passes data between steps', async () => {
      const def = PipelineBuilder.define('chain')
        .step('add', async (input: number) => ({ value: input + 10 }))
        .step('multiply', async (input: any) => ({ value: input.value * 2 }))
        .step('result', async (input: any) => ({ final: input.value }))
        .build();

      engine.register(def);
      const result = await engine.execute('chain', 5);

      expect(result.status).toBe('completed');
      expect(result.steps[2]?.output).toEqual({ final: 30 });
    });

    test('pipeline fails on step error', async () => {
      const def = PipelineBuilder.define('failing')
        .step('step1', async (input) => input)
        .step('step2', async () => {
          throw new Error('step2 failed');
        })
        .step('step3', async (input) => input)
        .build();

      engine.register(def);

      await expect(engine.execute('failing', 'input')).rejects.toThrow(PipelineStepError);
    });

    test('throws when executing unknown pipeline', async () => {
      await expect(engine.execute('unknown', 'input')).rejects.toThrow(PipelineError);
    });

    test('handles step timeout', async () => {
      const def = PipelineBuilder.define('timeout')
        .step('slow', async () => {
          await new Promise((r) => setTimeout(r, 5000));
          return 'done';
        }, { timeout: 50 })
        .build();

      engine.register(def);

      await expect(engine.execute('timeout', 'input')).rejects.toThrow();
    });

    test('middleware is applied', async () => {
      const order: string[] = [];

      const def = PipelineBuilder.define('middleware-test')
        .step('step1', async (input) => {
          order.push('step');
          return input;
        })
        .use(async (ctx, next) => {
          order.push('before');
          const result = await next();
          order.push('after');
          return result;
        })
        .build();

      engine.register(def);
      await engine.execute('middleware-test', 'input');

      expect(order).toEqual(['before', 'step', 'after']);
    });
  });

  describe('Built-in Pipelines', () => {
    test('createAnalyzePipeline registers analyze pipeline', () => {
      createAnalyzePipeline(engine);
      expect(engine.list()).toContain('analyze');
      expect(engine.get('analyze')?.steps).toHaveLength(3);
    });

    test('createTestPipeline registers test pipeline', () => {
      createTestPipeline(engine);
      expect(engine.list()).toContain('test');
      expect(engine.get('test')?.steps).toHaveLength(3);
    });

    test('createDevOpsPipeline registers devops pipeline', () => {
      createDevOpsPipeline(engine);
      expect(engine.list()).toContain('devops');
      expect(engine.get('devops')?.steps).toHaveLength(3);
    });

    test('execute analyze pipeline', async () => {
      createAnalyzePipeline(engine);
      const result = await engine.execute('analyze', { code: 'const x = 1;' });
      expect(result.status).toBe('completed');
    });

    test('execute test pipeline', async () => {
      createTestPipeline(engine);
      const result = await engine.execute('test', {});
      expect(result.status).toBe('completed');
    });

    test('execute devops pipeline', async () => {
      createDevOpsPipeline(engine);
      const result = await engine.execute('devops', {});
      expect(result.status).toBe('completed');
    });
  });
});
