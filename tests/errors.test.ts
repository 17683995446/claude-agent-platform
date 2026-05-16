// ============================================================================
// Tests for @claude-agent/errors
// ============================================================================

import { describe, test, expect } from 'bun:test';
import {
  AgentError,
  TaskError,
  TaskTimeoutError,
  ConfigError,
  ConfigNotFoundError,
  PluginError,
  PluginNotFoundError,
  PipelineError,
  PipelineStepError,
  HttpError,
  ValidationError,
  InternalError,
  LifecycleError,
  wrapError,
  onAgentError,
  dispatchError,
} from '../packages/errors/src/index.js';

describe('@claude-agent/errors', () => {
  describe('AgentError', () => {
    test('creates error with code and message', () => {
      const error = new AgentError('INTERNAL_ERROR', 'test error');
      expect(error.message).toBe('test error');
      expect(error.code).toBe('INTERNAL_ERROR');
      expect(error.name).toBe('AgentError');
      expect(error.timestamp).toBeInstanceOf(Date);
      expect(error.details).toEqual({});
    });

    test('creates error with details and cause', () => {
      const cause = new Error('original');
      const error = new AgentError('INTERNAL_ERROR', 'test', { key: 'value' }, cause);
      expect(error.details).toEqual({ key: 'value' });
      expect(error.cause).toBe(cause);
    });

    test('toErrorInfo returns serializable object', () => {
      const error = new AgentError('TASK_FAILED', 'task failed');
      const info = error.toErrorInfo();
      expect(info.code).toBe('TASK_FAILED');
      expect(info.message).toBe('task failed');
      expect(info.timestamp).toBeInstanceOf(Date);
      expect(info.details).toEqual({});
    });

    test('suggestedFix returns undefined by default', () => {
      const error = new AgentError('INTERNAL_ERROR', 'test');
      expect(error.suggestedFix).toBeUndefined();
    });

    test('is instanceof Error', () => {
      const error = new AgentError('INTERNAL_ERROR', 'test');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AgentError);
    });
  });

  describe('TaskError', () => {
    test('creates with task id', () => {
      const error = new TaskError('task failed', 'task-123');
      expect(error.code).toBe('TASK_FAILED');
      expect(error.taskId).toBe('task-123');
      expect(error.name).toBe('TaskError');
    });

    test('has suggested fix', () => {
      const error = new TaskError('task failed');
      expect(error.suggestedFix).toContain('task input');
    });
  });

  describe('TaskTimeoutError', () => {
    test('creates with timeout', () => {
      const error = new TaskTimeoutError('timeout', 5000, 'task-123');
      expect(error.code).toBe('TASK_TIMEOUT');
      expect(error.timeout).toBe(5000);
      expect(error.taskId).toBe('task-123');
    });

    test('suggested fix mentions timeout value', () => {
      const error = new TaskTimeoutError('timeout', 5000);
      expect(error.suggestedFix).toContain('5000ms');
    });
  });

  describe('ConfigError', () => {
    test('creates with config path', () => {
      const error = new ConfigError('invalid config', '/path/to/config');
      expect(error.code).toBe('CONFIG_INVALID');
      expect(error.configPath).toBe('/path/to/config');
    });

    test('suggested fix mentions config path', () => {
      const error = new ConfigError('invalid', '/etc/claude.json');
      expect(error.suggestedFix).toContain('/etc/claude.json');
    });
  });

  describe('ConfigNotFoundError', () => {
    test('creates with config path', () => {
      const error = new ConfigNotFoundError('/missing/config.json');
      expect(error.code).toBe('CONFIG_NOT_FOUND');
      expect(error.configPath).toBe('/missing/config.json');
    });
  });

  describe('PluginError', () => {
    test('creates with plugin name', () => {
      const error = new PluginError('plugin failed', 'my-plugin');
      expect(error.code).toBe('PLUGIN_ERROR');
      expect(error.pluginName).toBe('my-plugin');
    });
  });

  describe('PluginNotFoundError', () => {
    test('creates with plugin name', () => {
      const error = new PluginNotFoundError('missing-plugin');
      expect(error.code).toBe('PLUGIN_NOT_FOUND');
      expect(error.pluginName).toBe('missing-plugin');
    });
  });

  describe('PipelineError', () => {
    test('creates with pipeline name', () => {
      const error = new PipelineError('pipeline failed', 'test-pipeline');
      expect(error.code).toBe('PIPELINE_ERROR');
      expect(error.pipelineName).toBe('test-pipeline');
    });
  });

  describe('PipelineStepError', () => {
    test('creates with pipeline and step names', () => {
      const error = new PipelineStepError('step failed', 'pipe', 'step1');
      expect(error.code).toBe('PIPELINE_STEP_FAILED');
      expect(error.pipelineName).toBe('pipe');
      expect(error.stepName).toBe('step1');
    });
  });

  describe('HttpError', () => {
    test('creates with status code', () => {
      const error = new HttpError('not found', 404);
      expect(error.code).toBe('HTTP_ERROR');
      expect(error.statusCode).toBe(404);
    });

    test('default status code is 500', () => {
      const error = new HttpError('server error');
      expect(error.statusCode).toBe(500);
    });
  });

  describe('ValidationError', () => {
    test('creates with field and value', () => {
      const error = new ValidationError('invalid field', 'name', 123);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.field).toBe('name');
      expect(error.value).toBe(123);
    });
  });

  describe('InternalError', () => {
    test('creates with message', () => {
      const error = new InternalError('internal failure');
      expect(error.code).toBe('INTERNAL_ERROR');
      expect(error.name).toBe('InternalError');
    });
  });

  describe('LifecycleError', () => {
    test('creates with message', () => {
      const error = new LifecycleError('lifecycle issue');
      expect(error.code).toBe('LIFECYCLE_ERROR');
      expect(error.name).toBe('LifecycleError');
    });
  });

  describe('wrapError', () => {
    test('wraps AgentError as-is', () => {
      const original = new TaskError('task failed');
      const wrapped = wrapError(original);
      expect(wrapped).toBe(original);
    });

    test('wraps Error into InternalError', () => {
      const original = new Error('something went wrong');
      const wrapped = wrapError(original);
      expect(wrapped).toBeInstanceOf(InternalError);
      expect(wrapped.message).toBe('something went wrong');
      expect(wrapped.cause).toBe(original);
    });

    test('wraps string into InternalError', () => {
      const wrapped = wrapError('string error');
      expect(wrapped).toBeInstanceOf(InternalError);
      expect(wrapped.message).toBe('string error');
    });

    test('wraps unknown into InternalError', () => {
      const wrapped = wrapError(42);
      expect(wrapped).toBeInstanceOf(InternalError);
      expect(wrapped.message).toBe('42');
    });
  });

  describe('Global Error Handlers', () => {
    test('onAgentError registers and unregisters', () => {
      const errors: AgentError[] = [];
      const unsubscribe = onAgentError((err) => errors.push(err));

      dispatchError(new AgentError('INTERNAL_ERROR', 'test1'));
      dispatchError(new AgentError('INTERNAL_ERROR', 'test2'));

      expect(errors).toHaveLength(2);
      expect(errors[0]?.message).toBe('test1');
      expect(errors[1]?.message).toBe('test2');

      unsubscribe();

      dispatchError(new AgentError('INTERNAL_ERROR', 'test3'));
      expect(errors).toHaveLength(2); // No new error dispatched
    });

    test('dispatchError handles handler errors gracefully', () => {
      const badHandler = () => {
        throw new Error('handler error');
      };
      const unsubscribe = onAgentError(badHandler);

      // Should not throw
      expect(() => dispatchError(new AgentError('INTERNAL_ERROR', 'test'))).not.toThrow();

      unsubscribe();
    });
  });
});
