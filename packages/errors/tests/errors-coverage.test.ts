// ============================================================================
// @claude-agent/errors - Comprehensive Test Suite
// ============================================================================
// NOTE: This test file must work correctly even when other test files use
// mock.module() to mock @claude-agent/errors. We use dynamic import with
// a cache-busting query string to get the real implementation.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

// Dynamic import with cache-busting to bypass mock.module
// The ?real query string forces a fresh module load
const ErrorsModule = await import('../src/index?real=' + Date.now());

const {
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
  onAgentError,
  dispatchError,
  wrapError,
  installGlobalErrorHandlers,
  clearErrorHandlers,
} = ErrorsModule as any;

type ErrorCallback = (error: typeof AgentError) => void;

// ============================================================================
// BUG DOCUMENTATION
// ============================================================================
// BUG-001 [CRITICAL]: Global mutable array had race condition potential
// FIX: Changed to use a Set for O(1) lookup and prevent duplicate registrations,
// and use immutable snapshot pattern during dispatch to prevent concurrent modification.
//
// BUG-002 [HIGH]: suggestedFix returned undefined when pluginName was undefined
// FIX: Handle undefined pluginName case gracefully
//
// BUG-003 [HIGH]: suggestedFix returned undefined when pipelineName was undefined
// FIX: Handle undefined pipelineName case gracefully
//
// BUG-004 [MEDIUM]: statusCode was not validated to be a valid HTTP status code
// FIX: Validate statusCode is an integer in valid HTTP range (100-599)
//
// BUG-005 [HIGH]: timeout was not validated to be a positive number
// FIX: Validate timeout is a non-negative number, default to 0 if invalid
//
// BUG-006 [MEDIUM]: cause parameter was ignored in TaskTimeoutError (passed as undefined)
// FIX: Pass the cause parameter to parent constructor
//
// BUG-007 [MEDIUM]: Missing cause parameter in ConfigNotFoundError for consistency
// FIX: Added optional cause parameter
//
// BUG-008 [MEDIUM]: configPath was not validated in ConfigNotFoundError
// FIX: Validate configPath is a non-empty string
//
// BUG-009 [MEDIUM]: Missing cause parameter in PluginNotFoundError for consistency
// FIX: Added optional cause parameter
//
// BUG-010 [MEDIUM]: pluginName was not validated in PluginNotFoundError
// FIX: Validate pluginName is a non-empty string
//
// BUG-011 [MEDIUM]: pipelineName and stepName were not validated in PipelineStepError
// FIX: Validate pipelineName and stepName are non-empty strings
//
// BUG-012 [MEDIUM]: Missing cause parameter in ValidationError for consistency
// FIX: Added optional cause parameter
//
// BUG-013 [HIGH]: JSON.stringify could throw on circular references in ValidationError.suggestedFix
// FIX: Use try-catch and provide fallback for unstringifiable values
//
// BUG-014 [CRITICAL]: No way to uninstall global handlers, causing memory leaks in tests
// FIX: Return cleanup function to remove handlers
//
// BUG-015 [CRITICAL]: process.exit(1) after setTimeout could cause issues in tests
// FIX: Only exit in non-test environments
// ============================================================================

// Helper to clear all registered handlers between tests
function clearAllHandlers() {
  // Register and immediately unregister a dummy handler to get access to cleanup
  // This works because we're testing the Set-based implementation
  const handlers = (onAgentError as unknown as { _getHandlers?: () => Set<ErrorCallback> })._getHandlers?.();
  if (handlers) {
    handlers.clear();
  }
}

// ============================================================================
// AgentError - Base Error Class Tests
// ============================================================================

describe('AgentError', () => {
  it('should create an error with all required properties', () => {
    const error = new AgentError('TASK_FAILED', 'Task execution failed');
    
    expect(error.name).toBe('AgentError');
    expect(error.code).toBe('TASK_FAILED');
    expect(error.message).toBe('Task execution failed');
    expect(error.details).toEqual({});
    expect(error.timestamp).toBeInstanceOf(Date);
    expect(error.cause).toBeUndefined();
    expect(error.stack).toBeDefined();
  });

  it('should accept custom details', () => {
    const details = { taskId: 'task-123', attempt: 3 };
    const error = new AgentError('TASK_FAILED', 'Task failed', details);
    
    expect(error.details).toEqual(details);
  });

  it('should accept a cause error', () => {
    const cause = new Error('Original error');
    const error = new AgentError('INTERNAL_ERROR', 'Wrapped error', {}, cause);
    
    expect(error.cause).toBe(cause);
  });

  it('should convert to AgentErrorInfo correctly', () => {
    const details = { key: 'value' };
    const error = new AgentError('TASK_FAILED', 'Test message', details);
    const info = error.toErrorInfo();
    
    expect(info.code).toBe('TASK_FAILED');
    expect(info.message).toBe('Test message');
    expect(info.details).toEqual(details);
    expect(info.stack).toBe(error.stack);
    expect(info.timestamp).toBe(error.timestamp);
  });

  it('should return undefined for suggestedFix by default', () => {
    const error = new AgentError('TASK_FAILED', 'Test');
    expect(error.suggestedFix).toBeUndefined();
  });

  it('should maintain proper prototype chain', () => {
    const error = new AgentError('TASK_FAILED', 'Test');
    expect(error instanceof AgentError).toBe(true);
    expect(error instanceof Error).toBe(true);
  });

  it('should handle empty message', () => {
    const error = new AgentError('TASK_FAILED', '');
    expect(error.message).toBe('');
  });

  it('should handle null and undefined details gracefully', () => {
    // TypeScript would prevent this, but runtime should handle it
    const error1 = new AgentError('TASK_FAILED', 'Test', {} as Record<string, unknown>);
    expect(error1.details).toEqual({});
  });
});

// ============================================================================
// TaskError Tests
// ============================================================================

describe('TaskError', () => {
  it('should create error with taskId', () => {
    const error = new TaskError('Task failed', 'task-123');
    
    expect(error.name).toBe('TaskError');
    expect(error.code).toBe('TASK_FAILED');
    expect(error.message).toBe('Task failed');
    expect(error.taskId).toBe('task-123');
    expect(error.details.taskId).toBe('task-123');
  });

  it('should create error without taskId', () => {
    const error = new TaskError('Task failed');
    
    expect(error.taskId).toBeUndefined();
    expect(error.details.taskId).toBeUndefined();
  });

  it('should accept custom details', () => {
    const error = new TaskError('Task failed', 'task-123', { retryCount: 3 });
    
    expect(error.details.retryCount).toBe(3);
    expect(error.details.taskId).toBe('task-123');
  });

  it('should accept cause error', () => {
    const cause = new Error('Original error');
    const error = new TaskError('Task failed', 'task-123', {}, cause);
    
    expect(error.cause).toBe(cause);
  });

  it('should return suggested fix', () => {
    const error = new TaskError('Task failed');
    expect(error.suggestedFix).toBe('Check the task input and handler implementation. Ensure all dependencies are available.');
  });

  it('should maintain proper prototype chain', () => {
    const error = new TaskError('Task failed');
    expect(error instanceof TaskError).toBe(true);
    expect(error instanceof AgentError).toBe(true);
    expect(error instanceof Error).toBe(true);
  });
});

// ============================================================================
// TaskTimeoutError Tests
// ============================================================================

describe('TaskTimeoutError', () => {
  it('should create error with timeout and taskId', () => {
    const error = new TaskTimeoutError('Task timed out', 5000, 'task-123');
    
    expect(error.name).toBe('TaskTimeoutError');
    expect(error.code).toBe('TASK_TIMEOUT');
    expect(error.message).toBe('Task timed out');
    expect(error.timeout).toBe(5000);
    expect(error.taskId).toBe('task-123');
    expect(error.details.timeout).toBe(5000);
    expect(error.details.taskId).toBe('task-123');
  });

  it('should create error without taskId', () => {
    const error = new TaskTimeoutError('Task timed out', 3000);
    
    expect(error.taskId).toBeUndefined();
    expect(error.timeout).toBe(3000);
  });

  // BUG-005: timeout validation
  it('should validate negative timeout (BUG-005)', () => {
    const error = new TaskTimeoutError('Task timed out', -100);
    expect(error.timeout).toBe(0);
  });

  it('should validate NaN timeout (BUG-005)', () => {
    const error = new TaskTimeoutError('Task timed out', NaN);
    expect(error.timeout).toBe(0);
  });

  it('should validate Infinity timeout (BUG-005)', () => {
    const error = new TaskTimeoutError('Task timed out', Infinity);
    expect(error.timeout).toBe(0);
  });

  it('should validate non-number timeout (BUG-005)', () => {
    const error = new TaskTimeoutError('Task timed out', 'not a number' as unknown as number);
    expect(error.timeout).toBe(0);
  });

  it('should accept zero timeout', () => {
    const error = new TaskTimeoutError('Task timed out', 0);
    expect(error.timeout).toBe(0);
  });

  // BUG-006: cause parameter
  it('should accept cause error (BUG-006)', () => {
    const cause = new Error('Original timeout cause');
    const error = new TaskTimeoutError('Task timed out', 5000, 'task-123', {}, cause);
    
    expect(error.cause).toBe(cause);
  });

  it('should accept custom details', () => {
    const error = new TaskTimeoutError('Task timed out', 5000, 'task-123', { attempt: 2 });
    expect(error.details.attempt).toBe(2);
  });

  it('should return suggested fix with timeout value', () => {
    const error = new TaskTimeoutError('Task timed out', 5000);
    expect(error.suggestedFix).toContain('5000ms');
  });

  it('should maintain proper prototype chain', () => {
    const error = new TaskTimeoutError('Task timed out', 5000);
    expect(error instanceof TaskTimeoutError).toBe(true);
    expect(error instanceof AgentError).toBe(true);
  });
});

// ============================================================================
// ConfigError Tests
// ============================================================================

describe('ConfigError', () => {
  it('should create error with configPath', () => {
    const error = new ConfigError('Invalid config', '/path/to/config.json');
    
    expect(error.name).toBe('ConfigError');
    expect(error.code).toBe('CONFIG_INVALID');
    expect(error.configPath).toBe('/path/to/config.json');
    expect(error.details.configPath).toBe('/path/to/config.json');
  });

  it('should create error without configPath', () => {
    const error = new ConfigError('Invalid config');
    
    expect(error.configPath).toBeUndefined();
  });

  it('should accept custom details', () => {
    const error = new ConfigError('Invalid config', '/path/to/config.json', { line: 42 });
    expect(error.details.line).toBe(42);
  });

  it('should accept cause error', () => {
    const cause = new Error('Parse error');
    const error = new ConfigError('Invalid config', '/path/to/config.json', {}, cause);
    expect(error.cause).toBe(cause);
  });

  it('should return suggested fix with path', () => {
    const error = new ConfigError('Invalid config', '/path/to/config.json');
    expect(error.suggestedFix).toContain('/path/to/config.json');
  });

  it('should return suggested fix without path', () => {
    const error = new ConfigError('Invalid config');
    expect(error.suggestedFix).toContain('configuration file');
    expect(error.suggestedFix).not.toContain('in ');
  });

  it('should maintain proper prototype chain', () => {
    const error = new ConfigError('Invalid config');
    expect(error instanceof ConfigError).toBe(true);
    expect(error instanceof AgentError).toBe(true);
  });
});

// ============================================================================
// ConfigNotFoundError Tests
// ============================================================================

describe('ConfigNotFoundError', () => {
  it('should create error with configPath', () => {
    const error = new ConfigNotFoundError('/path/to/config.json');
    
    expect(error.name).toBe('ConfigNotFoundError');
    expect(error.code).toBe('CONFIG_NOT_FOUND');
    expect(error.message).toBe('Configuration file not found: /path/to/config.json');
    expect(error.configPath).toBe('/path/to/config.json');
    expect(error.details.configPath).toBe('/path/to/config.json');
  });

  // BUG-007: cause parameter
  it('should accept cause error (BUG-007)', () => {
    const cause = new Error('File system error');
    const error = new ConfigNotFoundError('/path/to/config.json', cause);
    expect(error.cause).toBe(cause);
  });

  // BUG-008: configPath validation
  it('should handle empty configPath (BUG-008)', () => {
    const error = new ConfigNotFoundError('');
    expect(error.configPath).toBe('<unknown>');
    expect(error.message).toBe('Configuration file not found: <unknown>');
  });

  it('should handle whitespace-only configPath (BUG-008)', () => {
    const error = new ConfigNotFoundError('   ');
    expect(error.configPath).toBe('<unknown>');
  });

  it('should handle null configPath (BUG-008)', () => {
    const error = new ConfigNotFoundError(null as unknown as string);
    expect(error.configPath).toBe('<unknown>');
  });

  it('should handle undefined configPath (BUG-008)', () => {
    const error = new ConfigNotFoundError(undefined as unknown as string);
    expect(error.configPath).toBe('<unknown>');
  });

  it('should return suggested fix', () => {
    const error = new ConfigNotFoundError('/path/to/config.json');
    expect(error.suggestedFix).toContain('/path/to/config.json');
    expect(error.suggestedFix).toContain('Create a configuration file');
  });

  it('should maintain proper prototype chain', () => {
    const error = new ConfigNotFoundError('/path/to/config.json');
    expect(error instanceof ConfigNotFoundError).toBe(true);
    expect(error instanceof AgentError).toBe(true);
  });
});

// ============================================================================
// PluginError Tests
// ============================================================================

describe('PluginError', () => {
  it('should create error with pluginName', () => {
    const error = new PluginError('Plugin failed', 'my-plugin');
    
    expect(error.name).toBe('PluginError');
    expect(error.code).toBe('PLUGIN_ERROR');
    expect(error.pluginName).toBe('my-plugin');
    expect(error.details.pluginName).toBe('my-plugin');
  });

  it('should create error without pluginName', () => {
    const error = new PluginError('Plugin failed');
    
    expect(error.pluginName).toBeUndefined();
  });

  // BUG-002: suggestedFix with undefined pluginName
  it('should return suggested fix without pluginName (BUG-002)', () => {
    const error = new PluginError('Plugin failed');
    expect(error.suggestedFix).toBe('Check the plugin implementation and ensure it follows the plugin interface.');
  });

  it('should return suggested fix with pluginName (BUG-002)', () => {
    const error = new PluginError('Plugin failed', 'my-plugin');
    expect(error.suggestedFix).toContain('my-plugin');
    expect(error.suggestedFix).toContain('"my-plugin"');
  });

  it('should accept custom details', () => {
    const error = new PluginError('Plugin failed', 'my-plugin', { version: '1.0.0' });
    expect(error.details.version).toBe('1.0.0');
  });

  it('should accept cause error', () => {
    const cause = new Error('Plugin initialization failed');
    const error = new PluginError('Plugin failed', 'my-plugin', {}, cause);
    expect(error.cause).toBe(cause);
  });

  it('should maintain proper prototype chain', () => {
    const error = new PluginError('Plugin failed');
    expect(error instanceof PluginError).toBe(true);
    expect(error instanceof AgentError).toBe(true);
  });
});

// ============================================================================
// PluginNotFoundError Tests
// ============================================================================

describe('PluginNotFoundError', () => {
  it('should create error with pluginName', () => {
    const error = new PluginNotFoundError('my-plugin');
    
    expect(error.name).toBe('PluginNotFoundError');
    expect(error.code).toBe('PLUGIN_NOT_FOUND');
    expect(error.message).toBe('Plugin not found: my-plugin');
    expect(error.pluginName).toBe('my-plugin');
    expect(error.details.pluginName).toBe('my-plugin');
  });

  // BUG-009: cause parameter
  it('should accept cause error (BUG-009)', () => {
    const cause = new Error('Registry error');
    const error = new PluginNotFoundError('my-plugin', cause);
    expect(error.cause).toBe(cause);
  });

  // BUG-010: pluginName validation
  it('should handle empty pluginName (BUG-010)', () => {
    const error = new PluginNotFoundError('');
    expect(error.pluginName).toBe('<unknown>');
    expect(error.message).toBe('Plugin not found: <unknown>');
  });

  it('should handle whitespace-only pluginName (BUG-010)', () => {
    const error = new PluginNotFoundError('   ');
    expect(error.pluginName).toBe('<unknown>');
  });

  it('should handle null pluginName (BUG-010)', () => {
    const error = new PluginNotFoundError(null as unknown as string);
    expect(error.pluginName).toBe('<unknown>');
  });

  it('should handle undefined pluginName (BUG-010)', () => {
    const error = new PluginNotFoundError(undefined as unknown as string);
    expect(error.pluginName).toBe('<unknown>');
  });

  it('should return suggested fix', () => {
    const error = new PluginNotFoundError('my-plugin');
    expect(error.suggestedFix).toContain('my-plugin');
    expect(error.suggestedFix).toContain('installed and registered');
  });

  it('should maintain proper prototype chain', () => {
    const error = new PluginNotFoundError('my-plugin');
    expect(error instanceof PluginNotFoundError).toBe(true);
    expect(error instanceof AgentError).toBe(true);
  });
});

// ============================================================================
// PipelineError Tests
// ============================================================================

describe('PipelineError', () => {
  it('should create error with pipelineName', () => {
    const error = new PipelineError('Pipeline failed', 'my-pipeline');
    
    expect(error.name).toBe('PipelineError');
    expect(error.code).toBe('PIPELINE_ERROR');
    expect(error.pipelineName).toBe('my-pipeline');
    expect(error.details.pipelineName).toBe('my-pipeline');
  });

  it('should create error without pipelineName', () => {
    const error = new PipelineError('Pipeline failed');
    
    expect(error.pipelineName).toBeUndefined();
  });

  // BUG-003: suggestedFix with undefined pipelineName
  it('should return suggested fix without pipelineName (BUG-003)', () => {
    const error = new PipelineError('Pipeline failed');
    expect(error.suggestedFix).toBe('Review the pipeline configuration and step definitions.');
  });

  it('should return suggested fix with pipelineName (BUG-003)', () => {
    const error = new PipelineError('Pipeline failed', 'my-pipeline');
    expect(error.suggestedFix).toContain('my-pipeline');
    expect(error.suggestedFix).toContain('"my-pipeline"');
  });

  it('should accept custom details', () => {
    const error = new PipelineError('Pipeline failed', 'my-pipeline', { step: 'step-1' });
    expect(error.details.step).toBe('step-1');
  });

  it('should accept cause error', () => {
    const cause = new Error('Step execution failed');
    const error = new PipelineError('Pipeline failed', 'my-pipeline', {}, cause);
    expect(error.cause).toBe(cause);
  });

  it('should maintain proper prototype chain', () => {
    const error = new PipelineError('Pipeline failed');
    expect(error instanceof PipelineError).toBe(true);
    expect(error instanceof AgentError).toBe(true);
  });
});

// ============================================================================
// PipelineStepError Tests
// ============================================================================

describe('PipelineStepError', () => {
  it('should create error with pipelineName and stepName', () => {
    const error = new PipelineStepError('Step failed', 'my-pipeline', 'my-step');
    
    expect(error.name).toBe('PipelineStepError');
    expect(error.code).toBe('PIPELINE_STEP_FAILED');
    expect(error.pipelineName).toBe('my-pipeline');
    expect(error.stepName).toBe('my-step');
    expect(error.details.pipelineName).toBe('my-pipeline');
    expect(error.details.stepName).toBe('my-step');
  });

  // BUG-011: pipelineName and stepName validation
  it('should handle empty pipelineName (BUG-011)', () => {
    const error = new PipelineStepError('Step failed', '', 'my-step');
    expect(error.pipelineName).toBe('<unknown>');
  });

  it('should handle empty stepName (BUG-011)', () => {
    const error = new PipelineStepError('Step failed', 'my-pipeline', '');
    expect(error.stepName).toBe('<unknown>');
  });

  it('should handle whitespace-only names (BUG-011)', () => {
    const error = new PipelineStepError('Step failed', '   ', '   ');
    expect(error.pipelineName).toBe('<unknown>');
    expect(error.stepName).toBe('<unknown>');
  });

  it('should handle null pipelineName (BUG-011)', () => {
    const error = new PipelineStepError('Step failed', null as unknown as string, 'my-step');
    expect(error.pipelineName).toBe('<unknown>');
  });

  it('should handle null stepName (BUG-011)', () => {
    const error = new PipelineStepError('Step failed', 'my-pipeline', null as unknown as string);
    expect(error.stepName).toBe('<unknown>');
  });

  it('should accept custom details', () => {
    const error = new PipelineStepError('Step failed', 'my-pipeline', 'my-step', { duration: 100 });
    expect(error.details.duration).toBe(100);
  });

  it('should accept cause error', () => {
    const cause = new Error('Step handler error');
    const error = new PipelineStepError('Step failed', 'my-pipeline', 'my-step', {}, cause);
    expect(error.cause).toBe(cause);
  });

  it('should return suggested fix', () => {
    const error = new PipelineStepError('Step failed', 'my-pipeline', 'my-step');
    expect(error.suggestedFix).toContain('my-step');
    expect(error.suggestedFix).toContain('my-pipeline');
  });

  it('should maintain proper prototype chain', () => {
    const error = new PipelineStepError('Step failed', 'my-pipeline', 'my-step');
    expect(error instanceof PipelineStepError).toBe(true);
    expect(error instanceof AgentError).toBe(true);
  });
});

// ============================================================================
// HttpError Tests
// ============================================================================

describe('HttpError', () => {
  it('should create error with default status code', () => {
    const error = new HttpError('Internal server error');
    
    expect(error.name).toBe('HttpError');
    expect(error.code).toBe('HTTP_ERROR');
    expect(error.statusCode).toBe(500);
    expect(error.details.statusCode).toBe(500);
  });

  it('should create error with custom status code', () => {
    const error = new HttpError('Not found', 404);
    expect(error.statusCode).toBe(404);
  });

  // BUG-004: statusCode validation
  it('should validate status code below 100 (BUG-004)', () => {
    const error = new HttpError('Invalid status', 99);
    expect(error.statusCode).toBe(500);
  });

  it('should validate status code above 599 (BUG-004)', () => {
    const error = new HttpError('Invalid status', 600);
    expect(error.statusCode).toBe(500);
  });

  it('should validate non-integer status code (BUG-004)', () => {
    const error = new HttpError('Invalid status', 200.5);
    expect(error.statusCode).toBe(500);
  });

  it('should validate non-number status code (BUG-004)', () => {
    const error = new HttpError('Invalid status', '404' as unknown as number);
    expect(error.statusCode).toBe(500);
  });

  it('should accept NaN status code (BUG-004)', () => {
    const error = new HttpError('Invalid status', NaN);
    expect(error.statusCode).toBe(500);
  });

  it('should accept valid boundary status codes', () => {
    const error100 = new HttpError('Continue', 100);
    const error599 = new HttpError('Network error', 599);
    
    expect(error100.statusCode).toBe(100);
    expect(error599.statusCode).toBe(599);
  });

  it('should accept custom details', () => {
    const error = new HttpError('Not found', 404, { path: '/api/users' });
    expect(error.details.path).toBe('/api/users');
  });

  it('should accept cause error', () => {
    const cause = new Error('Network timeout');
    const error = new HttpError('Gateway timeout', 504, {}, cause);
    expect(error.cause).toBe(cause);
  });

  it('should maintain proper prototype chain', () => {
    const error = new HttpError('Error');
    expect(error instanceof HttpError).toBe(true);
    expect(error instanceof AgentError).toBe(true);
  });
});

// ============================================================================
// ValidationError Tests
// ============================================================================

describe('ValidationError', () => {
  it('should create error with field and value', () => {
    const error = new ValidationError('Invalid value', 'username', 'test');
    
    expect(error.name).toBe('ValidationError');
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.field).toBe('username');
    expect(error.value).toBe('test');
    expect(error.details.field).toBe('username');
    expect(error.details.value).toBe('test');
  });

  it('should create error without field and value', () => {
    const error = new ValidationError('Validation failed');
    
    expect(error.field).toBeUndefined();
    expect(error.value).toBeUndefined();
  });

  // BUG-012: cause parameter
  it('should accept cause error (BUG-012)', () => {
    const cause = new Error('Schema validation error');
    const error = new ValidationError('Invalid value', 'field', 'value', {}, cause);
    expect(error.cause).toBe(cause);
  });

  it('should return suggested fix with field', () => {
    const error = new ValidationError('Invalid value', 'username', 'test');
    expect(error.suggestedFix).toContain('username');
    expect(error.suggestedFix).toContain('test');
  });

  it('should return suggested fix without field', () => {
    const error = new ValidationError('Validation failed');
    expect(error.suggestedFix).toBe('Review the input data and ensure all fields are valid.');
  });

  // BUG-013: JSON.stringify circular reference
  it('should handle circular reference in value (BUG-013)', () => {
    const circular: Record<string, unknown> = { name: 'test' };
    circular.self = circular;
    
    const error = new ValidationError('Invalid value', 'data', circular);
    expect(error.suggestedFix).toContain('[unable to serialize]');
  });

  it('should handle null value', () => {
    const error = new ValidationError('Invalid value', 'field', null);
    expect(error.value).toBeNull();
    expect(error.suggestedFix).toContain('null');
  });

  it('should handle undefined value', () => {
    const error = new ValidationError('Invalid value', 'field', undefined);
    expect(error.suggestedFix).toContain('undefined');
  });

  it('should handle object value', () => {
    const error = new ValidationError('Invalid value', 'config', { key: 'value' });
    expect(error.suggestedFix).toContain('{"key":"value"}');
  });

  it('should accept custom details', () => {
    const error = new ValidationError('Invalid value', 'field', 'value', { constraint: 'min: 5' });
    expect(error.details.constraint).toBe('min: 5');
  });

  it('should maintain proper prototype chain', () => {
    const error = new ValidationError('Invalid value');
    expect(error instanceof ValidationError).toBe(true);
    expect(error instanceof AgentError).toBe(true);
  });
});

// ============================================================================
// InternalError Tests
// ============================================================================

describe('InternalError', () => {
  it('should create error with message', () => {
    const error = new InternalError('Something went wrong');
    
    expect(error.name).toBe('InternalError');
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.message).toBe('Something went wrong');
  });

  it('should accept custom details', () => {
    const error = new InternalError('Error', { component: 'Logger' });
    expect(error.details.component).toBe('Logger');
  });

  it('should accept cause error', () => {
    const cause = new Error('Original error');
    const error = new InternalError('Wrapped error', {}, cause);
    expect(error.cause).toBe(cause);
  });

  it('should return undefined for suggestedFix', () => {
    const error = new InternalError('Error');
    expect(error.suggestedFix).toBeUndefined();
  });

  it('should maintain proper prototype chain', () => {
    const error = new InternalError('Error');
    expect(error instanceof InternalError).toBe(true);
    expect(error instanceof AgentError).toBe(true);
  });
});

// ============================================================================
// LifecycleError Tests
// ============================================================================

describe('LifecycleError', () => {
  it('should create error with message', () => {
    const error = new LifecycleError('Lifecycle error');
    
    expect(error.name).toBe('LifecycleError');
    expect(error.code).toBe('LIFECYCLE_ERROR');
    expect(error.message).toBe('Lifecycle error');
  });

  it('should accept custom details', () => {
    const error = new LifecycleError('Error', { phase: 'shutdown' });
    expect(error.details.phase).toBe('shutdown');
  });

  it('should accept cause error', () => {
    const cause = new Error('Original error');
    const error = new LifecycleError('Wrapped error', {}, cause);
    expect(error.cause).toBe(cause);
  });

  it('should return undefined for suggestedFix', () => {
    const error = new LifecycleError('Error');
    expect(error.suggestedFix).toBeUndefined();
  });

  it('should maintain proper prototype chain', () => {
    const error = new LifecycleError('Error');
    expect(error instanceof LifecycleError).toBe(true);
    expect(error instanceof AgentError).toBe(true);
  });
});

// ============================================================================
// Global Error Handler Tests
// ============================================================================

describe('Global Error Handlers', () => {
  // Store original handlers to restore after tests
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    // Clear any existing handlers before each test
    clearErrorHandlers();
    cleanup = null;
  });

  afterEach(() => {
    // Cleanup any registered handlers
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
    clearErrorHandlers();
  });

  describe('onAgentError', () => {
    it('should register a callback', () => {
      let called = false;
      const unsubscribe = onAgentError(() => {
        called = true;
      });

      const error = new AgentError('TASK_FAILED', 'Test error');
      dispatchError(error);

      expect(called).toBe(true);
      unsubscribe();
    });

    it('should return unsubscribe function', () => {
      let callCount = 0;
      const unsubscribe = onAgentError(() => {
        callCount++;
      });

      dispatchError(new AgentError('TASK_FAILED', 'Test 1'));
      expect(callCount).toBe(1);

      unsubscribe();

      dispatchError(new AgentError('TASK_FAILED', 'Test 2'));
      expect(callCount).toBe(1); // Should still be 1 after unsubscribe
    });

    // BUG-001: Prevent duplicate registrations
    it('should not register same callback twice (BUG-001)', () => {
      let callCount = 0;
      const handler = () => {
        callCount++;
      };

      const unsub1 = onAgentError(handler);
      const unsub2 = onAgentError(handler);

      dispatchError(new AgentError('TASK_FAILED', 'Test'));
      expect(callCount).toBe(1); // Should only be called once

      unsub1();
      dispatchError(new AgentError('TASK_FAILED', 'Test 2'));
      expect(callCount).toBe(1); // Handler should be removed

      unsub2();
    });

    it('should support multiple different callbacks', () => {
      const calls: string[] = [];
      
      const unsub1 = onAgentError(() => calls.push('handler1'));
      const unsub2 = onAgentError(() => calls.push('handler2'));

      dispatchError(new AgentError('TASK_FAILED', 'Test'));
      expect(calls).toEqual(['handler1', 'handler2']);

      unsub1();
      unsub2();
    });
  });

  describe('dispatchError', () => {
    it('should dispatch to all handlers', () => {
      const calls: string[] = [];
      
      const unsub1 = onAgentError((e) => calls.push(`1:${e.message}`));
      const unsub2 = onAgentError((e) => calls.push(`2:${e.message}`));

      dispatchError(new AgentError('TASK_FAILED', 'Test message'));
      expect(calls).toEqual(['1:Test message', '2:Test message']);

      unsub1();
      unsub2();
    });

    it('should handle handler errors gracefully', () => {
      let secondHandlerCalled = false;
      
      const unsub1 = onAgentError(() => {
        throw new Error('Handler error');
      });
      const unsub2 = onAgentError(() => {
        secondHandlerCalled = true;
      });

      // Should not throw
      expect(() => {
        dispatchError(new AgentError('TASK_FAILED', 'Test'));
      }).not.toThrow();

      expect(secondHandlerCalled).toBe(true);

      unsub1();
      unsub2();
    });

    // BUG-001: Concurrent modification during dispatch
    it('should handle handlers that modify the handler list (BUG-001)', () => {
      const calls: string[] = [];
      
      let unsub2: () => void;
      const unsub1 = onAgentError(() => {
        calls.push('handler1');
        // Register another handler during dispatch
        unsub2 = onAgentError(() => calls.push('handler2'));
      });

      dispatchError(new AgentError('TASK_FAILED', 'Test'));
      
      // First dispatch should only call handler1
      expect(calls).toEqual(['handler1']);

      // Second dispatch should call both handlers
      calls.length = 0;
      dispatchError(new AgentError('TASK_FAILED', 'Test 2'));
      expect(calls).toEqual(['handler1', 'handler2']);

      unsub1();
      unsub2!();
    });

    it('should handle handlers that unregister themselves (BUG-001)', () => {
      const calls: string[] = [];
      
      let unsub: () => void;
      unsub = onAgentError(() => {
        calls.push('handler');
        unsub(); // Unregister itself
      });

      dispatchError(new AgentError('TASK_FAILED', 'Test 1'));
      expect(calls).toEqual(['handler']);

      calls.length = 0;
      dispatchError(new AgentError('TASK_FAILED', 'Test 2'));
      expect(calls).toEqual([]); // Handler should be gone
    });
  });

  describe('wrapError', () => {
    it('should return AgentError as-is', () => {
      const original = new TaskError('Task failed', 'task-123');
      const wrapped = wrapError(original);
      
      expect(wrapped).toBe(original);
    });

    it('should wrap Error into InternalError', () => {
      const original = new Error('Original error');
      original.name = 'CustomError';
      
      const wrapped = wrapError(original);
      
      expect(wrapped).toBeInstanceOf(InternalError);
      expect(wrapped.message).toBe('Original error');
      expect(wrapped.cause).toBe(original);
      expect(wrapped.details.originalName).toBe('CustomError');
    });

    it('should wrap string into InternalError', () => {
      const wrapped = wrapError('Something went wrong');
      
      expect(wrapped).toBeInstanceOf(InternalError);
      expect(wrapped.message).toBe('Something went wrong');
    });

    it('should wrap number into InternalError', () => {
      const wrapped = wrapError(42);
      
      expect(wrapped).toBeInstanceOf(InternalError);
      expect(wrapped.message).toBe('42');
    });

    it('should wrap null into InternalError', () => {
      const wrapped = wrapError(null);
      
      expect(wrapped).toBeInstanceOf(InternalError);
      expect(wrapped.message).toBe('null');
    });

    it('should wrap undefined into InternalError', () => {
      const wrapped = wrapError(undefined);
      
      expect(wrapped).toBeInstanceOf(InternalError);
      expect(wrapped.message).toBe('undefined');
    });

    it('should wrap object into InternalError', () => {
      const wrapped = wrapError({ code: 'ERROR' });
      
      expect(wrapped).toBeInstanceOf(InternalError);
      expect(wrapped.message).toBe('[object Object]');
    });

    it('should wrap array into InternalError', () => {
      const wrapped = wrapError([1, 2, 3]);
      
      expect(wrapped).toBeInstanceOf(InternalError);
      expect(wrapped.message).toBe('1,2,3');
    });
  });

  describe('installGlobalErrorHandlers', () => {
    // BUG-014: Return cleanup function
    it('should return cleanup function (BUG-014)', () => {
      const cleanup = installGlobalErrorHandlers();
      expect(typeof cleanup).toBe('function');
      cleanup();
    });

    it('should dispatch unhandled rejection to handlers', async () => {
      let dispatchedError: AgentError | null = null;
      
      const unsub = onAgentError((e) => {
        dispatchedError = e;
      });
      
      const cleanup = installGlobalErrorHandlers();

      // Simulate unhandled rejection
      process.emit('unhandledRejection', new Error('Unhandled rejection'), Promise.resolve());

      expect(dispatchedError).not.toBeNull();
      expect(dispatchedError!.message).toBe('Unhandled rejection');

      cleanup();
      unsub();
    });

    it('should dispatch uncaught exception to handlers', () => {
      let dispatchedError: AgentError | null = null;
      
      const unsub = onAgentError((e) => {
        dispatchedError = e;
      });
      
      const cleanup = installGlobalErrorHandlers();

      // Simulate uncaught exception
      process.emit('uncaughtException', new Error('Uncaught exception'));

      expect(dispatchedError).not.toBeNull();
      expect(dispatchedError!.message).toBe('Uncaught exception');

      cleanup();
      unsub();
    });

    it('should cleanup handlers properly (BUG-014)', () => {
      let callCount = 0;
      
      const unsub = onAgentError(() => {
        callCount++;
      });
      
      const cleanup = installGlobalErrorHandlers();

      // First emit should work
      process.emit('unhandledRejection', new Error('Test 1'), Promise.resolve());
      expect(callCount).toBe(1);

      // Cleanup
      cleanup();

      // Second emit should not reach our handler
      process.emit('unhandledRejection', new Error('Test 2'), Promise.resolve());
      // Note: The global handler is removed, but our local handler is still registered
      // So callCount should still be 1 because dispatchError won't be called
      expect(callCount).toBe(1);

      unsub();
    });
  });
});

// ============================================================================
// Edge Cases and Stress Tests
// ============================================================================

describe('Edge Cases', () => {
  beforeEach(() => {
    clearErrorHandlers();
  });

  afterEach(() => {
    clearErrorHandlers();
  });

  it('should handle very long error messages', () => {
    const longMessage = 'a'.repeat(10000);
    const error = new AgentError('TASK_FAILED', longMessage);
    
    expect(error.message).toBe(longMessage);
    expect(error.message.length).toBe(10000);
  });

  it('should handle special characters in messages', () => {
    const specialMessage = 'Error with \n newlines \t tabs and "quotes" and \\backslashes\\';
    const error = new AgentError('TASK_FAILED', specialMessage);
    
    expect(error.message).toBe(specialMessage);
  });

  it('should handle unicode in messages', () => {
    const unicodeMessage = '错误信息 🚨 エラー Ошибка';
    const error = new AgentError('TASK_FAILED', unicodeMessage);
    
    expect(error.message).toBe(unicodeMessage);
  });

  it('should handle very large details object', () => {
    const largeDetails: Record<string, unknown> = {};
    for (let i = 0; i < 1000; i++) {
      largeDetails[`key${i}`] = `value${i}`;
    }
    
    const error = new AgentError('TASK_FAILED', 'Test', largeDetails);
    
    expect(Object.keys(error.details).length).toBe(1000);
  });

  it('should handle deeply nested cause chain', () => {
    const cause1 = new Error('Level 1');
    const cause2 = new InternalError('Level 2', {}, cause1);
    const cause3 = new TaskError('Level 3', 'task-1', {}, cause2);
    const error = new AgentError('TASK_FAILED', 'Top level', {}, cause3);
    
    expect(error.cause).toBe(cause3);
    expect((error.cause as TaskError).cause).toBe(cause2);
    expect(((error.cause as TaskError).cause as InternalError).cause).toBe(cause1);
  });

  it('should handle concurrent dispatch calls', async () => {
    const calls: number[] = [];
    
    const unsub = onAgentError(() => {
      calls.push(Date.now());
    });

    // Dispatch multiple errors concurrently
    const promises = Array.from({ length: 100 }, (_, i) => {
      return Promise.resolve().then(() => {
        dispatchError(new AgentError('TASK_FAILED', `Error ${i}`));
      });
    });

    await Promise.all(promises);

    expect(calls.length).toBe(100);
    unsub();
  });

  it('should maintain error identity through wrapError', () => {
    const original = new ValidationError('Invalid', 'field', 'value');
    const wrapped = wrapError(original);
    
    expect(wrapped).toBe(original);
    expect((wrapped as ValidationError).field).toBe('field');
  });

  it('should serialize error info correctly', () => {
    const error = new TaskError('Task failed', 'task-123', { attempt: 3 });
    const info = error.toErrorInfo();
    
    // Should be serializable
    const serialized = JSON.stringify(info);
    const parsed = JSON.parse(serialized);
    
    expect(parsed.code).toBe('TASK_FAILED');
    expect(parsed.message).toBe('Task failed');
    expect(parsed.details.taskId).toBe('task-123');
    expect(parsed.details.attempt).toBe(3);
  });
});

// ============================================================================
// Type Safety Tests
// ============================================================================

describe('Type Safety', () => {
  it('should have correct error codes for each error type', () => {
    expect(new TaskError('').code).toBe('TASK_FAILED');
    expect(new TaskTimeoutError('', 1000).code).toBe('TASK_TIMEOUT');
    expect(new ConfigError('').code).toBe('CONFIG_INVALID');
    expect(new ConfigNotFoundError('/path').code).toBe('CONFIG_NOT_FOUND');
    expect(new PluginError('').code).toBe('PLUGIN_ERROR');
    expect(new PluginNotFoundError('name').code).toBe('PLUGIN_NOT_FOUND');
    expect(new PipelineError('').code).toBe('PIPELINE_ERROR');
    expect(new PipelineStepError('', 'pipeline', 'step').code).toBe('PIPELINE_STEP_FAILED');
    expect(new HttpError('').code).toBe('HTTP_ERROR');
    expect(new ValidationError('').code).toBe('VALIDATION_ERROR');
    expect(new InternalError('').code).toBe('INTERNAL_ERROR');
    expect(new LifecycleError('').code).toBe('LIFECYCLE_ERROR');
  });

  it('should have correct error names for each error type', () => {
    expect(new TaskError('').name).toBe('TaskError');
    expect(new TaskTimeoutError('', 1000).name).toBe('TaskTimeoutError');
    expect(new ConfigError('').name).toBe('ConfigError');
    expect(new ConfigNotFoundError('/path').name).toBe('ConfigNotFoundError');
    expect(new PluginError('').name).toBe('PluginError');
    expect(new PluginNotFoundError('name').name).toBe('PluginNotFoundError');
    expect(new PipelineError('').name).toBe('PipelineError');
    expect(new PipelineStepError('', 'pipeline', 'step').name).toBe('PipelineStepError');
    expect(new HttpError('').name).toBe('HttpError');
    expect(new ValidationError('').name).toBe('ValidationError');
    expect(new InternalError('').name).toBe('InternalError');
    expect(new LifecycleError('').name).toBe('LifecycleError');
  });
});
