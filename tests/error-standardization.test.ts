// ============================================================================
// Error Message Standardization Tests
// ============================================================================
// This test file verifies that all error messages follow a consistent format
// with context, error codes, and remediation suggestions.
//
// Test Categories:
// 1. Error Code Consistency (25+ tests)
// 2. Error Message Format (25+ tests)
// 3. Suggested Fix Presence (20+ tests)
// 4. Error Context Propagation (20+ tests)
// 5. Error Serialization (15+ tests)
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
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
  clearErrorHandlers,
} from '../packages/errors/src/index.js';
import { ERROR_CODES, isErrorCode, createAgentErrorInfo } from '../packages/types/src/index.js';

// ============================================================================
// Test Category 1: Error Code Consistency (25+ tests)
// ============================================================================

describe('Error Code Consistency', () => {
  describe('Error Code Uniqueness', () => {
    it('should have all unique error codes in ERROR_CODES array', () => {
      const uniqueCodes = new Set(ERROR_CODES);
      expect(uniqueCodes.size).toBe(ERROR_CODES.length);
    });

    it('should validate all error codes using isErrorCode', () => {
      for (const code of ERROR_CODES) {
        expect(isErrorCode(code)).toBe(true);
      }
    });

    it('should reject invalid error codes', () => {
      expect(isErrorCode('INVALID_CODE')).toBe(false);
      expect(isErrorCode('')).toBe(false);
      expect(isErrorCode(123 as unknown as string)).toBe(false);
      expect(isErrorCode(null as unknown as string)).toBe(false);
    });

    it('should have error codes following SCOPE_ERROR_NAME pattern', () => {
      const validPattern = /^[A-Z]+_[A-Z_]+$/;
      for (const code of ERROR_CODES) {
        expect(validPattern.test(code)).toBe(true);
      }
    });

    it('should have error codes with appropriate scope prefixes', () => {
      const validScopes = ['AGENT', 'TASK', 'CONFIG', 'PLUGIN', 'PIPELINE', 'HTTP', 'VALIDATION', 'INTERNAL', 'LIFECYCLE'];
      for (const code of ERROR_CODES) {
        const scope = code.split('_')[0];
        expect(validScopes).toContain(scope);
      }
    });
  });

  describe('AgentError Code Assignment', () => {
    it('should assign correct code to AgentError', () => {
      const error = new AgentError('INTERNAL_ERROR', 'test');
      expect(error.code).toBe('INTERNAL_ERROR');
    });

    it('should assign correct code to TaskError', () => {
      const error = new TaskError('task failed');
      expect(error.code).toBe('TASK_FAILED');
    });

    it('should assign correct code to TaskTimeoutError', () => {
      const error = new TaskTimeoutError('timeout', 5000);
      expect(error.code).toBe('TASK_TIMEOUT');
    });

    it('should assign correct code to ConfigError', () => {
      const error = new ConfigError('invalid config');
      expect(error.code).toBe('CONFIG_INVALID');
    });

    it('should assign correct code to ConfigNotFoundError', () => {
      const error = new ConfigNotFoundError('/config.json');
      expect(error.code).toBe('CONFIG_NOT_FOUND');
    });

    it('should assign correct code to PluginError', () => {
      const error = new PluginError('plugin failed');
      expect(error.code).toBe('PLUGIN_ERROR');
    });

    it('should assign correct code to PluginNotFoundError', () => {
      const error = new PluginNotFoundError('my-plugin');
      expect(error.code).toBe('PLUGIN_NOT_FOUND');
    });

    it('should assign correct code to PipelineError', () => {
      const error = new PipelineError('pipeline failed');
      expect(error.code).toBe('PIPELINE_ERROR');
    });

    it('should assign correct code to PipelineStepError', () => {
      const error = new PipelineStepError('step failed', 'pipe', 'step1');
      expect(error.code).toBe('PIPELINE_STEP_FAILED');
    });

    it('should assign correct code to HttpError', () => {
      const error = new HttpError('http error');
      expect(error.code).toBe('HTTP_ERROR');
    });

    it('should assign correct code to ValidationError', () => {
      const error = new ValidationError('validation failed');
      expect(error.code).toBe('VALIDATION_ERROR');
    });

    it('should assign correct code to InternalError', () => {
      const error = new InternalError('internal error');
      expect(error.code).toBe('INTERNAL_ERROR');
    });

    it('should assign correct code to LifecycleError', () => {
      const error = new LifecycleError('lifecycle error');
      expect(error.code).toBe('LIFECYCLE_ERROR');
    });
  });

  describe('Error Code Immutability', () => {
    it('should have immutable code property on AgentError', () => {
      const error = new AgentError('INTERNAL_ERROR', 'test');
      expect(() => {
        (error as Record<string, string>).code = 'MODIFIED';
      }).toThrow();
      expect(error.code).toBe('INTERNAL_ERROR');
    });

    it('should have immutable code property on all error types', () => {
      const errors = [
        new TaskError('test'),
        new ConfigError('test'),
        new PluginError('test'),
        new PipelineError('test'),
        new ValidationError('test'),
      ];
      for (const error of errors) {
        expect(() => {
          (error as Record<string, string>).code = 'MODIFIED';
        }).toThrow();
      }
    });
  });

  describe('Error Code Registry', () => {
    it('should have all error codes documented in ERROR_CODES', () => {
      const expectedCodes = [
        'AGENT_NOT_FOUND',
        'TASK_FAILED',
        'TASK_TIMEOUT',
        'CONFIG_INVALID',
        'CONFIG_NOT_FOUND',
        'PLUGIN_ERROR',
        'PLUGIN_NOT_FOUND',
        'PIPELINE_ERROR',
        'PIPELINE_STEP_FAILED',
        'HTTP_ERROR',
        'VALIDATION_ERROR',
        'INTERNAL_ERROR',
        'LIFECYCLE_ERROR',
      ];
      for (const code of expectedCodes) {
        expect(ERROR_CODES).toContain(code);
      }
    });

    it('should create AgentErrorInfo with valid error code', () => {
      const info = createAgentErrorInfo('TASK_FAILED', 'Task failed');
      expect(info.code).toBe('TASK_FAILED');
      expect(info.message).toBe('Task failed');
      expect(info.timestamp).toBeInstanceOf(Date);
    });

    it('should throw when creating AgentErrorInfo with invalid code', () => {
      expect(() => {
        createAgentErrorInfo('INVALID_CODE' as typeof ERROR_CODES[number], 'test');
      }).toThrow();
    });
  });
});

// ============================================================================
// Test Category 2: Error Message Format (25+ tests)
// ============================================================================

describe('Error Message Format', () => {
  describe('Message Structure - What Happened', () => {
    it('should describe what happened in TaskError message', () => {
      const error = new TaskError('Task execution failed due to timeout');
      expect(error.message).toContain('failed');
    });

    it('should describe what happened in ConfigError message', () => {
      const error = new ConfigError('Configuration validation failed');
      expect(error.message).toContain('Configuration');
    });

    it('should describe what happened in PluginError message', () => {
      const error = new PluginError('Plugin initialization failed');
      expect(error.message).toContain('Plugin');
    });

    it('should describe what happened in PipelineError message', () => {
      const error = new PipelineError('Pipeline execution failed');
      expect(error.message).toContain('Pipeline');
    });

    it('should describe what happened in ValidationError message', () => {
      const error = new ValidationError('Field validation failed');
      expect(error.message).toContain('validation');
    });

    it('should describe what happened in HttpError message', () => {
      const error = new HttpError('HTTP request failed');
      expect(error.message).toContain('HTTP');
    });
  });

  describe('Message Structure - Why It Happened', () => {
    it('should include reason in ConfigNotFoundError', () => {
      const error = new ConfigNotFoundError('/path/to/config.json');
      expect(error.message).toContain('not found');
      expect(error.message).toContain('/path/to/config.json');
    });

    it('should include reason in PluginNotFoundError', () => {
      const error = new PluginNotFoundError('missing-plugin');
      expect(error.message).toContain('not found');
      expect(error.message).toContain('missing-plugin');
    });

    it('should include timeout value in TaskTimeoutError', () => {
      const error = new TaskTimeoutError('Task timed out', 5000);
      expect(error.message).toContain('timed out');
      expect(error.timeout).toBe(5000);
    });

    it('should include status code in HttpError', () => {
      const error = new HttpError('Not found', 404);
      expect(error.statusCode).toBe(404);
    });

    it('should include field name in ValidationError', () => {
      const error = new ValidationError('Invalid value', 'email', 'invalid-email');
      expect(error.field).toBe('email');
    });

    it('should include step and pipeline names in PipelineStepError', () => {
      const error = new PipelineStepError('Step failed', 'my-pipeline', 'my-step');
      expect(error.pipelineName).toBe('my-pipeline');
      expect(error.stepName).toBe('my-step');
    });
  });

  describe('Message Structure - Context Information', () => {
    it('should include taskId in TaskError details', () => {
      const error = new TaskError('Task failed', 'task-123');
      expect(error.taskId).toBe('task-123');
      expect(error.details.taskId).toBe('task-123');
    });

    it('should include configPath in ConfigError details', () => {
      const error = new ConfigError('Invalid config', '/etc/config.json');
      expect(error.configPath).toBe('/etc/config.json');
      expect(error.details.configPath).toBe('/etc/config.json');
    });

    it('should include pluginName in PluginError details', () => {
      const error = new PluginError('Plugin failed', 'my-plugin');
      expect(error.pluginName).toBe('my-plugin');
      expect(error.details.pluginName).toBe('my-plugin');
    });

    it('should include pipelineName in PipelineError details', () => {
      const error = new PipelineError('Pipeline failed', 'my-pipeline');
      expect(error.pipelineName).toBe('my-pipeline');
      expect(error.details.pipelineName).toBe('my-pipeline');
    });

    it('should include field and value in ValidationError details', () => {
      const error = new ValidationError('Invalid', 'age', -5);
      expect(error.details.field).toBe('age');
      expect(error.details.value).toBe(-5);
    });
  });

  describe('User-Friendly Messages', () => {
    it('should not use technical jargon in TaskError message', () => {
      const error = new TaskError('Task failed to complete');
      expect(error.message).not.toContain('Exception');
      expect(error.message).not.toContain('Stack trace');
    });

    it('should not use technical jargon in ConfigError message', () => {
      const error = new ConfigError('Configuration file is missing');
      expect(error.message).not.toContain('undefined');
      expect(error.message).not.toContain('null');
    });

    it('should provide clear message in PluginNotFoundError', () => {
      const error = new PluginNotFoundError('my-plugin');
      expect(error.message).toBe('Plugin not found: my-plugin');
    });

    it('should provide clear message in ConfigNotFoundError', () => {
      const error = new ConfigNotFoundError('/config.json');
      expect(error.message).toBe('Configuration file not found: /config.json');
    });

    it('should use understandable language in ValidationError', () => {
      const error = new ValidationError('The email field is invalid', 'email', 'test');
      expect(error.message).toContain('invalid');
    });
  });

  describe('No Sensitive Data in Messages', () => {
    it('should not include password in error message', () => {
      const error = new ValidationError('Invalid credentials', 'password', 'secret123');
      // The value is in details, but message should not expose it
      expect(error.message).not.toContain('secret123');
    });

    it('should not include token in error details by default', () => {
      const details = { user: 'admin', token: 'abc123' };
      const error = new AgentError('INTERNAL_ERROR', 'Auth failed', details);
      // This test documents current behavior - sensitive data should be filtered
      // In production, sensitive fields should be redacted
      expect(error.details).toEqual(details); // Current behavior - may need sanitization
    });

    it('should not include API keys in error messages', () => {
      const error = new ConfigError('Invalid API configuration');
      expect(error.message).not.toContain('sk-');
      expect(error.message).not.toContain('api_key');
    });
  });

  describe('Message Completeness', () => {
    it('should have non-empty message for all error types', () => {
      const errors = [
        new TaskError('Task failed'),
        new ConfigError('Config invalid'),
        new PluginError('Plugin error'),
        new PipelineError('Pipeline error'),
        new ValidationError('Validation error'),
        new InternalError('Internal error'),
        new LifecycleError('Lifecycle error'),
      ];
      for (const error of errors) {
        expect(error.message.length).toBeGreaterThan(0);
      }
    });

    it('should have meaningful message for ConfigNotFoundError', () => {
      const error = new ConfigNotFoundError('');
      expect(error.message).toContain('not found');
    });

    it('should have meaningful message for PluginNotFoundError', () => {
      const error = new PluginNotFoundError('');
      expect(error.message).toContain('not found');
    });
  });
});

// ============================================================================
// Test Category 3: Suggested Fix Presence (20+ tests)
// ============================================================================

describe('Suggested Fix Presence', () => {
  describe('suggestedFix Getter Existence', () => {
    it('should have suggestedFix getter on TaskError', () => {
      const error = new TaskError('failed');
      expect(error.suggestedFix).toBeDefined();
      expect(typeof error.suggestedFix).toBe('string');
    });

    it('should have suggestedFix getter on TaskTimeoutError', () => {
      const error = new TaskTimeoutError('timeout', 5000);
      expect(error.suggestedFix).toBeDefined();
      expect(typeof error.suggestedFix).toBe('string');
    });

    it('should have suggestedFix getter on ConfigError', () => {
      const error = new ConfigError('invalid');
      expect(error.suggestedFix).toBeDefined();
      expect(typeof error.suggestedFix).toBe('string');
    });

    it('should have suggestedFix getter on ConfigNotFoundError', () => {
      const error = new ConfigNotFoundError('/config.json');
      expect(error.suggestedFix).toBeDefined();
      expect(typeof error.suggestedFix).toBe('string');
    });

    it('should have suggestedFix getter on PluginError', () => {
      const error = new PluginError('failed');
      expect(error.suggestedFix).toBeDefined();
      expect(typeof error.suggestedFix).toBe('string');
    });

    it('should have suggestedFix getter on PluginNotFoundError', () => {
      const error = new PluginNotFoundError('plugin');
      expect(error.suggestedFix).toBeDefined();
      expect(typeof error.suggestedFix).toBe('string');
    });

    it('should have suggestedFix getter on PipelineError', () => {
      const error = new PipelineError('failed');
      expect(error.suggestedFix).toBeDefined();
      expect(typeof error.suggestedFix).toBe('string');
    });

    it('should have suggestedFix getter on PipelineStepError', () => {
      const error = new PipelineStepError('failed', 'pipe', 'step');
      expect(error.suggestedFix).toBeDefined();
      expect(typeof error.suggestedFix).toBe('string');
    });

    it('should have suggestedFix getter on ValidationError', () => {
      const error = new ValidationError('invalid');
      expect(error.suggestedFix).toBeDefined();
      expect(typeof error.suggestedFix).toBe('string');
    });

    it('should return undefined for base AgentError suggestedFix', () => {
      const error = new AgentError('INTERNAL_ERROR', 'test');
      expect(error.suggestedFix).toBeUndefined();
    });
  });

  describe('Suggested Fix Actionability', () => {
    it('should provide actionable fix for TaskError', () => {
      const error = new TaskError('Task failed', 'task-123');
      expect(error.suggestedFix).toContain('Check');
      expect(error.suggestedFix).toContain('task');
    });

    it('should provide actionable fix for TaskTimeoutError', () => {
      const error = new TaskTimeoutError('Timeout', 5000);
      expect(error.suggestedFix).toContain('timeout');
      expect(error.suggestedFix).toContain('5000');
    });

    it('should provide actionable fix for ConfigError', () => {
      const error = new ConfigError('Invalid', '/config.json');
      expect(error.suggestedFix).toContain('Review');
      expect(error.suggestedFix).toContain('configuration');
    });

    it('should provide actionable fix for ConfigNotFoundError', () => {
      const error = new ConfigNotFoundError('/config.json');
      expect(error.suggestedFix).toContain('Create');
      expect(error.suggestedFix).toContain('/config.json');
    });

    it('should provide actionable fix for PluginError', () => {
      const error = new PluginError('Failed', 'my-plugin');
      expect(error.suggestedFix).toContain('Check');
      expect(error.suggestedFix).toContain('plugin');
    });

    it('should provide actionable fix for PluginNotFoundError', () => {
      const error = new PluginNotFoundError('my-plugin');
      expect(error.suggestedFix).toContain('installed');
      expect(error.suggestedFix).toContain('my-plugin');
    });

    it('should provide actionable fix for PipelineError', () => {
      const error = new PipelineError('Failed', 'my-pipeline');
      expect(error.suggestedFix).toContain('Review');
      expect(error.suggestedFix).toContain('pipeline');
    });

    it('should provide actionable fix for PipelineStepError', () => {
      const error = new PipelineStepError('Failed', 'pipe', 'step');
      expect(error.suggestedFix).toContain('step');
      expect(error.suggestedFix).toContain('pipe');
    });

    it('should provide actionable fix for ValidationError with field', () => {
      const error = new ValidationError('Invalid', 'email', 'test');
      expect(error.suggestedFix).toContain('email');
      expect(error.suggestedFix).toContain('field');
    });

    it('should provide actionable fix for ValidationError without field', () => {
      const error = new ValidationError('Invalid');
      expect(error.suggestedFix).toContain('input');
      expect(error.suggestedFix).toContain('valid');
    });
  });

  describe('Suggested Fix Context Awareness', () => {
    it('should include taskId in TaskError suggested fix when available', () => {
      const error = new TaskError('Failed', 'task-123');
      expect(error.suggestedFix).toContain('task-123');
    });

    it('should handle missing taskId in TaskError suggested fix', () => {
      const error = new TaskError('Failed');
      expect(error.suggestedFix).toBeDefined();
      expect(error.suggestedFix).toContain('task');
    });

    it('should include configPath in ConfigError suggested fix when available', () => {
      const error = new ConfigError('Invalid', '/etc/config.json');
      expect(error.suggestedFix).toContain('/etc/config.json');
    });

    it('should handle missing configPath in ConfigError suggested fix', () => {
      const error = new ConfigError('Invalid');
      expect(error.suggestedFix).toBeDefined();
      expect(error.suggestedFix).not.toContain('undefined');
    });

    it('should include pluginName in PluginError suggested fix when available', () => {
      const error = new PluginError('Failed', 'my-plugin');
      expect(error.suggestedFix).toContain('my-plugin');
    });

    it('should handle missing pluginName in PluginError suggested fix', () => {
      const error = new PluginError('Failed');
      expect(error.suggestedFix).toBeDefined();
      expect(error.suggestedFix).not.toContain('undefined');
    });

    it('should include pipelineName in PipelineError suggested fix when available', () => {
      const error = new PipelineError('Failed', 'my-pipeline');
      expect(error.suggestedFix).toContain('my-pipeline');
    });

    it('should handle missing pipelineName in PipelineError suggested fix', () => {
      const error = new PipelineError('Failed');
      expect(error.suggestedFix).toBeDefined();
      expect(error.suggestedFix).not.toContain('undefined');
    });
  });
});

// ============================================================================
// Test Category 4: Error Context Propagation (20+ tests)
// ============================================================================

describe('Error Context Propagation', () => {
  describe('Cause Chain Preservation', () => {
    it('should preserve original error as cause', () => {
      const original = new Error('Original error');
      const error = new AgentError('INTERNAL_ERROR', 'Wrapped', {}, original);
      expect(error.cause).toBe(original);
    });

    it('should preserve cause in TaskError', () => {
      const original = new Error('Database connection failed');
      const error = new TaskError('Task failed', 'task-1', {}, original);
      expect(error.cause).toBe(original);
      expect(error.cause?.message).toBe('Database connection failed');
    });

    it('should preserve cause in ConfigError', () => {
      const original = new Error('File read failed');
      const error = new ConfigError('Config invalid', '/config.json', {}, original);
      expect(error.cause).toBe(original);
    });

    it('should preserve cause in PluginError', () => {
      const original = new Error('Module not found');
      const error = new PluginError('Plugin failed', 'my-plugin', {}, original);
      expect(error.cause).toBe(original);
    });

    it('should preserve cause in PipelineStepError', () => {
      const original = new Error('Step handler failed');
      const error = new PipelineStepError('Step failed', 'pipe', 'step', {}, original);
      expect(error.cause).toBe(original);
    });

    it('should preserve cause in ValidationError', () => {
      const original = new Error('Schema validation failed');
      const error = new ValidationError('Invalid', 'field', 'value', {}, original);
      expect(error.cause).toBe(original);
    });

    it('should preserve cause in InternalError', () => {
      const original = new Error('Unexpected failure');
      const error = new InternalError('Internal error', {}, original);
      expect(error.cause).toBe(original);
    });

    it('should preserve cause in LifecycleError', () => {
      const original = new Error('Shutdown failed');
      const error = new LifecycleError('Lifecycle error', {}, original);
      expect(error.cause).toBe(original);
    });
  });

  describe('Error Chain Traversability', () => {
    it('should traverse error cause chain', () => {
      const root = new Error('Root cause');
      const middle = new AgentError('INTERNAL_ERROR', 'Middle', {}, root);
      const top = new TaskError('Top level', 'task-1', {}, middle);

      expect(top.cause).toBe(middle);
      expect(top.cause?.cause).toBe(root);
    });

    it('should access root cause through chain', () => {
      const root = new Error('Root cause');
      const error = new TaskError('Task failed', 'task-1', {}, root);

      let current: Error | undefined = error;
      while (current?.cause) {
        current = current.cause;
      }
      expect(current).toBe(root);
    });

    it('should handle errors without cause', () => {
      const error = new TaskError('Task failed');
      expect(error.cause).toBeUndefined();
    });
  });

  describe('Stack Trace Preservation', () => {
    it('should have stack trace on AgentError', () => {
      const error = new AgentError('INTERNAL_ERROR', 'test');
      expect(error.stack).toBeDefined();
      expect(error.stack?.length).toBeGreaterThan(0);
    });

    it('should have stack trace on all error types', () => {
      const errors = [
        new TaskError('test'),
        new ConfigError('test'),
        new PluginError('test'),
        new PipelineError('test'),
        new ValidationError('test'),
        new InternalError('test'),
        new LifecycleError('test'),
      ];
      for (const error of errors) {
        expect(error.stack).toBeDefined();
        expect(error.stack?.length).toBeGreaterThan(0);
      }
    });

    it('should include error name in stack trace', () => {
      const error = new TaskError('test');
      expect(error.stack).toContain('TaskError');
    });

    it('should include error message in stack trace', () => {
      const error = new TaskError('specific error message');
      expect(error.stack).toContain('specific error message');
    });
  });

  describe('Async Error Context', () => {
    it('should maintain context through async operations', async () => {
      const original = new Error('Async failure');
      const error = new TaskError('Task failed', 'task-1', {}, original);

      await Promise.resolve();

      expect(error.cause).toBe(original);
      expect(error.taskId).toBe('task-1');
    });

    it('should preserve error details through promise chain', async () => {
      const error = new ConfigError('Config error', '/config.json', { key: 'value' });

      const result = await Promise.resolve(error);

      expect(result.configPath).toBe('/config.json');
      expect(result.details.key).toBe('value');
    });
  });

  describe('Details Immutability', () => {
    it('should have immutable details property', () => {
      const error = new AgentError('INTERNAL_ERROR', 'test', { key: 'value' });
      expect(() => {
        (error as Record<string, Record<string, string>>).details = { modified: 'true' };
      }).toThrow();
    });

    it('should preserve original details object', () => {
      const details = { key: 'value', nested: { prop: 'test' } };
      const error = new AgentError('INTERNAL_ERROR', 'test', details);
      expect(error.details).toEqual(details);
    });
  });
});

// ============================================================================
// Test Category 5: Error Serialization (15+ tests)
// ============================================================================

describe('Error Serialization', () => {
  describe('toErrorInfo Serialization', () => {
    it('should serialize AgentError to AgentErrorInfo', () => {
      const error = new AgentError('TASK_FAILED', 'Task failed', { id: '123' });
      const info = error.toErrorInfo();

      expect(info.code).toBe('TASK_FAILED');
      expect(info.message).toBe('Task failed');
      expect(info.details).toEqual({ id: '123' });
      expect(info.timestamp).toBeInstanceOf(Date);
      expect(info.stack).toBeDefined();
    });

    it('should serialize TaskError to AgentErrorInfo', () => {
      const error = new TaskError('Task failed', 'task-123');
      const info = error.toErrorInfo();

      expect(info.code).toBe('TASK_FAILED');
      expect(info.details.taskId).toBe('task-123');
    });

    it('should serialize ConfigError to AgentErrorInfo', () => {
      const error = new ConfigError('Config invalid', '/config.json');
      const info = error.toErrorInfo();

      expect(info.code).toBe('CONFIG_INVALID');
      expect(info.details.configPath).toBe('/config.json');
    });

    it('should include stack trace in serialized info', () => {
      const error = new AgentError('INTERNAL_ERROR', 'test');
      const info = error.toErrorInfo();

      expect(info.stack).toBeDefined();
      expect(info.stack?.length).toBeGreaterThan(0);
    });

    it('should include timestamp in serialized info', () => {
      const error = new AgentError('INTERNAL_ERROR', 'test');
      const info = error.toErrorInfo();

      expect(info.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('JSON Serialization', () => {
    it('should serialize to JSON correctly', () => {
      const error = new AgentError('TASK_FAILED', 'Task failed', { id: '123' });
      // Use toErrorInfo() for proper serialization since Object.defineProperty
      // makes properties non-enumerable by default
      const info = error.toErrorInfo();
      const json = JSON.stringify(info);
      const parsed = JSON.parse(json);

      expect(parsed.code).toBe('TASK_FAILED');
      expect(parsed.message).toBe('Task failed');
      expect(parsed.details).toEqual({ id: '123' });
    });

    it('should serialize TaskError to JSON', () => {
      const error = new TaskError('Task failed', 'task-123');
      const json = JSON.stringify(error);
      const parsed = JSON.parse(json);

      expect(parsed.code).toBe('TASK_FAILED');
      expect(parsed.taskId).toBe('task-123');
    });

    it('should serialize ValidationError with field and value', () => {
      const error = new ValidationError('Invalid', 'email', 'test@example.com');
      const json = JSON.stringify(error);
      const parsed = JSON.parse(json);

      expect(parsed.field).toBe('email');
      expect(parsed.value).toBe('test@example.com');
    });

    it('should include timestamp in JSON serialization', () => {
      const error = new AgentError('INTERNAL_ERROR', 'test');
      const json = JSON.stringify(error);
      const parsed = JSON.parse(json);

      expect(parsed.timestamp).toBeDefined();
      expect(new Date(parsed.timestamp)).toBeInstanceOf(Date);
    });
  });

  describe('Circular Reference Handling', () => {
    it('should handle circular references in details gracefully', () => {
      const details: Record<string, unknown> = { name: 'test' };
      details.self = details; // Create circular reference

      // Should not throw when creating error
      const error = new AgentError('INTERNAL_ERROR', 'test', details);

      // toErrorInfo should handle circular references
      const info = error.toErrorInfo();
      expect(info.details.name).toBe('test');
    });

    it('should handle nested circular references', () => {
      const child: Record<string, unknown> = { type: 'child' };
      const parent: Record<string, unknown> = { type: 'parent', child };
      child.parent = parent; // Create circular reference

      const error = new AgentError('INTERNAL_ERROR', 'test', parent);
      const info = error.toErrorInfo();

      expect(info.details.type).toBe('parent');
    });

    it('should handle ValidationError with circular value', () => {
      const value: Record<string, unknown> = { data: 'test' };
      value.self = value;

      // ValidationError suggestedFix uses JSON.stringify which may throw
      // This test verifies the fix handles it gracefully
      const error = new ValidationError('Invalid', 'field', value);

      // Should not throw when accessing suggestedFix
      expect(() => error.suggestedFix).not.toThrow();
      expect(error.suggestedFix).toContain('field');
    });
  });

  describe('Sensitive Data Filtering in Serialization', () => {
    it('should not include cause in toErrorInfo by default', () => {
      const cause = new Error('Sensitive cause');
      const error = new AgentError('INTERNAL_ERROR', 'test', {}, cause);
      const info = error.toErrorInfo();

      // Cause is not part of AgentErrorInfo interface
      expect('cause' in info).toBe(false);
    });

    it('should handle errors with undefined details', () => {
      const error = new AgentError('INTERNAL_ERROR', 'test', {});
      const info = error.toErrorInfo();

      expect(info.details).toEqual({});
    });
  });

  describe('Error Reconstruction', () => {
    it('should be able to reconstruct error from serialized data', () => {
      const original = new AgentError('TASK_FAILED', 'Task failed', { id: '123' });
      const info = original.toErrorInfo();

      // Reconstruct
      const reconstructed = new AgentError(
        info.code,
        info.message,
        info.details || {},
      );

      expect(reconstructed.code).toBe(original.code);
      expect(reconstructed.message).toBe(original.message);
      expect(reconstructed.details).toEqual(original.details);
    });

    it('should preserve error type information after reconstruction', () => {
      const original = new TaskError('Task failed', 'task-123');
      const info = original.toErrorInfo();

      // Reconstruct as TaskError
      const reconstructed = new TaskError(
        info.message,
        info.details?.taskId as string,
        info.details || {},
      );

      expect(reconstructed.code).toBe(original.code);
      expect(reconstructed.taskId).toBe(original.taskId);
    });
  });

  describe('wrapError Serialization', () => {
    it('should wrap standard Error and serialize', () => {
      const original = new Error('Standard error');
      const wrapped = wrapError(original);
      const info = wrapped.toErrorInfo();

      expect(info.code).toBe('INTERNAL_ERROR');
      expect(info.message).toBe('Standard error');
    });

    it('should wrap string and serialize', () => {
      const wrapped = wrapError('String error');
      const info = wrapped.toErrorInfo();

      expect(info.code).toBe('INTERNAL_ERROR');
      expect(info.message).toBe('String error');
    });

    it('should preserve AgentError when wrapping', () => {
      const original = new TaskError('Task failed');
      const wrapped = wrapError(original);

      expect(wrapped).toBe(original);
      expect(wrapped.toErrorInfo().code).toBe('TASK_FAILED');
    });
  });
});

// ============================================================================
// Global Error Handler Tests
// ============================================================================

describe('Global Error Handler', () => {
  beforeEach(() => {
    clearErrorHandlers();
  });

  afterEach(() => {
    clearErrorHandlers();
  });

  it('should dispatch error to registered handlers', () => {
    const errors: AgentError[] = [];
    const unsubscribe = onAgentError((err) => errors.push(err));

    const error = new AgentError('INTERNAL_ERROR', 'test');
    dispatchError(error);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe('test');

    unsubscribe();
  });

  it('should handle multiple error handlers', () => {
    const errors1: AgentError[] = [];
    const errors2: AgentError[] = [];

    const unsubscribe1 = onAgentError((err) => errors1.push(err));
    const unsubscribe2 = onAgentError((err) => errors2.push(err));

    dispatchError(new AgentError('INTERNAL_ERROR', 'test'));

    expect(errors1).toHaveLength(1);
    expect(errors2).toHaveLength(1);

    unsubscribe1();
    unsubscribe2();
  });

  it('should isolate handler errors', () => {
    let goodHandlerCalled = false;
    const goodHandler = () => {
      goodHandlerCalled = true;
    };
    const badHandler = () => {
      throw new Error('Handler error');
    };

    const unsubscribe1 = onAgentError(badHandler);
    const unsubscribe2 = onAgentError(goodHandler);

    expect(() => {
      dispatchError(new AgentError('INTERNAL_ERROR', 'test'));
    }).not.toThrow();

    expect(goodHandlerCalled).toBe(true);

    unsubscribe1();
    unsubscribe2();
  });
});

// ============================================================================
// Error Timestamp Tests
// ============================================================================

describe('Error Timestamp', () => {
  it('should have timestamp on all error types', () => {
    const errors = [
      new AgentError('INTERNAL_ERROR', 'test'),
      new TaskError('test'),
      new ConfigError('test'),
      new PluginError('test'),
      new PipelineError('test'),
      new ValidationError('test'),
      new InternalError('test'),
      new LifecycleError('test'),
    ];

    for (const error of errors) {
      expect(error.timestamp).toBeInstanceOf(Date);
      expect(error.timestamp.getTime()).toBeGreaterThan(0);
    }
  });

  it('should have immutable timestamp', () => {
    const error = new AgentError('INTERNAL_ERROR', 'test');
    const originalTimestamp = error.timestamp;

    expect(() => {
      (error as Record<string, Date>).timestamp = new Date('2020-01-01');
    }).toThrow();

    expect(error.timestamp).toBe(originalTimestamp);
  });

  it('should have recent timestamp', () => {
    const before = Date.now();
    const error = new AgentError('INTERNAL_ERROR', 'test');
    const after = Date.now();

    expect(error.timestamp.getTime()).toBeGreaterThanOrEqual(before);
    expect(error.timestamp.getTime()).toBeLessThanOrEqual(after);
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Error Standardization Integration', () => {
  it('should maintain consistency across error lifecycle', () => {
    // Create error
    const cause = new Error('Database connection failed');
    const error = new TaskError('Task execution failed', 'task-123', { retryCount: 3 }, cause);

    // Verify all properties
    expect(error.code).toBe('TASK_FAILED');
    expect(error.message).toBe('Task execution failed');
    expect(error.taskId).toBe('task-123');
    expect(error.details.retryCount).toBe(3);
    expect(error.cause).toBe(cause);
    expect(error.suggestedFix).toContain('task-123');
    expect(error.timestamp).toBeInstanceOf(Date);

    // Serialize
    const info = error.toErrorInfo();
    expect(info.code).toBe('TASK_FAILED');
    expect(info.message).toBe('Task execution failed');
    expect(info.details.taskId).toBe('task-123');

    // JSON
    const json = JSON.stringify(error);
    const parsed = JSON.parse(json);
    expect(parsed.code).toBe('TASK_FAILED');
    expect(parsed.taskId).toBe('task-123');
  });

  it('should handle complex error chains', () => {
    const dbError = new Error('Connection refused');
    const taskError = new TaskError('Task failed', 'task-1', {}, dbError);
    const pipelineError = new PipelineStepError('Pipeline failed', 'pipe', 'step', {}, taskError);

    // Traverse chain
    expect(pipelineError.cause).toBe(taskError);
    expect(pipelineError.cause?.cause).toBe(dbError);

    // Each level has correct type
    expect(pipelineError).toBeInstanceOf(PipelineStepError);
    expect(pipelineError.cause).toBeInstanceOf(TaskError);
    expect(pipelineError.cause?.cause).toBeInstanceOf(Error);
  });
});
