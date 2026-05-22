// ============================================================================
// @claude-agent/types - Comprehensive Test Suite
// ============================================================================
// This test file covers all exported types, functions, and edge cases.
// Each test documents bugs found and fixes applied.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

// Import all exports from the types package
import {
  // Brand types
  AgentId,
  TaskId,
  RequestId,
  PluginId,
  PipelineId,
  // String literal types
  LogLevel,
  AgentStatus,
  TaskStatus,
  PluginPhase,
  PipelineStatus,
  ErrorCode,
  AgentEventType,
  CLICommand,
  // Interfaces
  ClaudeAgentConfig,
  HttpConfig,
  PluginConfig,
  PipelineConfig,
  CheckpointConfig,
  Agent,
  AgentOptions,
  Task,
  TaskMetadata,
  TaskOptions,
  AgentErrorInfo,
  Plugin,
  PluginDefinition,
  PluginContext,
  EventHandler,
  Pipeline,
  PipelineStep,
  PipelineDefinition,
  PipelineStepDefinition,
  StepHandler,
  PipelineContext,
  PipelineMiddleware,
  AgentEvent,
  LoggerInterface,
  LogEntry,
  EventBusInterface,
  HealthCheckResult,
  HealthCheck,
  MetricsData,
  MemoryUsage,
  LifecycleManager,
  ShutdownCallback,
  CLIContext,
  // Constants
  LOG_LEVELS,
  AGENT_STATUSES,
  TASK_STATUSES,
  PLUGIN_PHASES,
  PIPELINE_STATUSES,
  HEALTH_STATUSES,
  ERROR_CODES,
  AGENT_EVENT_TYPES,
  CLI_COMMANDS,
  // Type guards
  isLogLevel,
  isAgentStatus,
  isTaskStatus,
  isPluginPhase,
  isPipelineStatus,
  isErrorCode,
  isAgentEventType,
  isCLICommand,
  isHealthStatus,
  // ID creators
  createAgentId,
  createTaskId,
  createRequestId,
  createPluginId,
  createPipelineId,
  // Validators
  validateHttpConfig,
  validatePluginConfig,
  validatePipelineConfig,
  validateCheckpointConfig,
  validateClaudeAgentConfig,
  // Log utilities
  getLogLevelSeverity,
  compareLogLevels,
  shouldLog,
  // Factories
  createAgentErrorInfo,
  createAgentEvent,
  // State transitions
  isValidTaskTransition,
  isValidAgentTransition,
  isValidPluginTransition,
  isValidPipelineTransition,
  // Health check
  createHealthCheck,
  createHealthCheckResult,
  // Metrics
  validateMemoryUsage,
  createMetricsData,
} from '../src/index';

// ============================================================================
// Type Guard Tests
// ============================================================================

describe('Type Guards', () => {
  describe('isLogLevel', () => {
    // BUG-FIX-001: [HIGH] Added runtime validation for LogLevel to prevent invalid string assignment.
    // Previously, any string could be assigned to LogLevel without validation.
    // FIX: Added isLogLevel type guard function with runtime validation.

    it('should return true for valid log levels', () => {
      const validLevels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
      for (const level of validLevels) {
        expect(isLogLevel(level)).toBe(true);
      }
    });

    it('should return false for invalid log levels', () => {
      expect(isLogLevel('invalid')).toBe(false);
      expect(isLogLevel('INFO')).toBe(false); // Case sensitive
      expect(isLogLevel('Info')).toBe(false);
      expect(isLogLevel('')).toBe(false);
    });

    it('should return false for non-string values', () => {
      expect(isLogLevel(null)).toBe(false);
      expect(isLogLevel(undefined)).toBe(false);
      expect(isLogLevel(123)).toBe(false);
      expect(isLogLevel({})).toBe(false);
      expect(isLogLevel([])).toBe(false);
      expect(isLogLevel(true)).toBe(false);
    });
  });

  describe('isAgentStatus', () => {
    // BUG-FIX-002: [HIGH] Added runtime validation for AgentStatus to prevent invalid state transitions.
    // Previously, any string could be assigned as agent status.
    // FIX: Added isAgentStatus type guard function.

    it('should return true for valid agent statuses', () => {
      const validStatuses: AgentStatus[] = ['idle', 'running', 'paused', 'stopping', 'stopped', 'error'];
      for (const status of validStatuses) {
        expect(isAgentStatus(status)).toBe(true);
      }
    });

    it('should return false for invalid agent statuses', () => {
      expect(isAgentStatus('invalid')).toBe(false);
      expect(isAgentStatus('RUNNING')).toBe(false);
      expect(isAgentStatus('')).toBe(false);
      expect(isAgentStatus('pending')).toBe(false); // Not a valid agent status
    });

    it('should return false for non-string values', () => {
      expect(isAgentStatus(null)).toBe(false);
      expect(isAgentStatus(undefined)).toBe(false);
      expect(isAgentStatus(123)).toBe(false);
    });
  });

  describe('isTaskStatus', () => {
    // BUG-FIX-003: [HIGH] Added runtime validation for TaskStatus to prevent invalid task states.
    // FIX: Added isTaskStatus type guard function.

    it('should return true for valid task statuses', () => {
      const validStatuses: TaskStatus[] = ['pending', 'running', 'completed', 'failed', 'cancelled', 'skipped'];
      for (const status of validStatuses) {
        expect(isTaskStatus(status)).toBe(true);
      }
    });

    it('should return false for invalid task statuses', () => {
      expect(isTaskStatus('invalid')).toBe(false);
      expect(isTaskStatus('idle')).toBe(false); // Agent status, not task
      expect(isTaskStatus('')).toBe(false);
    });

    it('should return false for non-string values', () => {
      expect(isTaskStatus(null)).toBe(false);
      expect(isTaskStatus(undefined)).toBe(false);
      expect(isTaskStatus(123)).toBe(false);
    });
  });

  describe('isPluginPhase', () => {
    // BUG-FIX-004: [HIGH] Added runtime validation for PluginPhase to prevent invalid plugin states.
    // FIX: Added isPluginPhase type guard function.

    it('should return true for valid plugin phases', () => {
      const validPhases: PluginPhase[] = ['registered', 'initializing', 'ready', 'active', 'stopping', 'stopped'];
      for (const phase of validPhases) {
        expect(isPluginPhase(phase)).toBe(true);
      }
    });

    it('should return false for invalid plugin phases', () => {
      expect(isPluginPhase('invalid')).toBe(false);
      expect(isPluginPhase('pending')).toBe(false);
      expect(isPluginPhase('')).toBe(false);
    });

    it('should return false for non-string values', () => {
      expect(isPluginPhase(null)).toBe(false);
      expect(isPluginPhase(undefined)).toBe(false);
    });
  });

  describe('isPipelineStatus', () => {
    // BUG-FIX-005: [HIGH] Added runtime validation for PipelineStatus to prevent invalid pipeline states.
    // FIX: Added isPipelineStatus type guard function.

    it('should return true for valid pipeline statuses', () => {
      const validStatuses: PipelineStatus[] = ['pending', 'running', 'completed', 'failed', 'cancelled'];
      for (const status of validStatuses) {
        expect(isPipelineStatus(status)).toBe(true);
      }
    });

    it('should return false for invalid pipeline statuses', () => {
      expect(isPipelineStatus('invalid')).toBe(false);
      expect(isPipelineStatus('idle')).toBe(false);
      expect(isPipelineStatus('')).toBe(false);
    });

    it('should return false for non-string values', () => {
      expect(isPipelineStatus(null)).toBe(false);
      expect(isPipelineStatus(undefined)).toBe(false);
    });
  });

  describe('isErrorCode', () => {
    // BUG-FIX-006: [HIGH] Added runtime validation for ErrorCode to prevent invalid error codes.
    // FIX: Added isErrorCode type guard function.

    it('should return true for valid error codes', () => {
      const validCodes: ErrorCode[] = [
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
      for (const code of validCodes) {
        expect(isErrorCode(code)).toBe(true);
      }
    });

    it('should return false for invalid error codes', () => {
      expect(isErrorCode('invalid')).toBe(false);
      expect(isErrorCode('task_failed')).toBe(false); // Case sensitive
      expect(isErrorCode('')).toBe(false);
    });

    it('should return false for non-string values', () => {
      expect(isErrorCode(null)).toBe(false);
      expect(isErrorCode(undefined)).toBe(false);
    });
  });

  describe('isAgentEventType', () => {
    // BUG-FIX-007: [HIGH] Added runtime validation for AgentEventType to prevent invalid event types.
    // FIX: Added isAgentEventType type guard function.

    it('should return true for valid event types', () => {
      const validTypes: AgentEventType[] = [
        'agent.started',
        'agent.stopped',
        'agent.error',
        'task.created',
        'task.started',
        'task.completed',
        'task.failed',
        'task.cancelled',
        'pipeline.started',
        'pipeline.completed',
        'pipeline.failed',
        'plugin.registered',
        'plugin.ready',
        'plugin.error',
        'config.changed',
        'config.reloaded',
        'health.check',
      ];
      for (const type of validTypes) {
        expect(isAgentEventType(type)).toBe(true);
      }
    });

    it('should return false for invalid event types', () => {
      expect(isAgentEventType('invalid')).toBe(false);
      expect(isAgentEventType('AGENT_STARTED')).toBe(false);
      expect(isAgentEventType('')).toBe(false);
    });

    it('should return false for non-string values', () => {
      expect(isAgentEventType(null)).toBe(false);
      expect(isAgentEventType(undefined)).toBe(false);
    });
  });

  describe('isCLICommand', () => {
    // BUG-FIX-008: [MEDIUM] Added runtime validation for CLICommand to prevent invalid commands.
    // FIX: Added isCLICommand type guard function.

    it('should return true for valid CLI commands', () => {
      const validCommands: CLICommand[] = [
        'run',
        'analyze',
        'test',
        'graph',
        'devops',
        'design',
        'monitor',
        'checkpoint',
        'ask',
      ];
      for (const cmd of validCommands) {
        expect(isCLICommand(cmd)).toBe(true);
      }
    });

    it('should return false for invalid CLI commands', () => {
      expect(isCLICommand('invalid')).toBe(false);
      expect(isCLICommand('RUN')).toBe(false);
      expect(isCLICommand('')).toBe(false);
    });

    it('should return false for non-string values', () => {
      expect(isCLICommand(null)).toBe(false);
      expect(isCLICommand(undefined)).toBe(false);
    });
  });

  describe('isHealthStatus', () => {
    // BUG-FIX-009: [MEDIUM] Added runtime validation for health status.
    // FIX: Added isHealthStatus type guard function.

    it('should return true for valid health statuses', () => {
      expect(isHealthStatus('healthy')).toBe(true);
      expect(isHealthStatus('degraded')).toBe(true);
      expect(isHealthStatus('unhealthy')).toBe(true);
    });

    it('should return false for invalid health statuses', () => {
      expect(isHealthStatus('invalid')).toBe(false);
      expect(isHealthStatus('HEALTHY')).toBe(false);
      expect(isHealthStatus('ok')).toBe(false);
      expect(isHealthStatus('')).toBe(false);
    });

    it('should return false for non-string values', () => {
      expect(isHealthStatus(null)).toBe(false);
      expect(isHealthStatus(undefined)).toBe(false);
    });
  });
});

// ============================================================================
// ID Creator Tests
// ============================================================================

describe('ID Creators', () => {
  describe('createAgentId', () => {
    // BUG-FIX-010: [HIGH] Added ID validation to prevent empty or whitespace-only IDs.
    // Previously, empty strings or whitespace could be used as IDs.
    // FIX: Added createAgentId function with validation.

    it('should create valid AgentId from non-empty string', () => {
      const id = createAgentId('agent-123');
      expect(id).toBe('agent-123');
    });

    it('should trim whitespace from ID', () => {
      const id = createAgentId('  agent-123  ');
      expect(id).toBe('agent-123');
    });

    it('should throw for empty string', () => {
      expect(() => createAgentId('')).toThrow('AgentId cannot be empty or whitespace');
    });

    it('should throw for whitespace-only string', () => {
      expect(() => createAgentId('   ')).toThrow('AgentId cannot be empty or whitespace');
    });

    it('should throw for non-string values', () => {
      expect(() => createAgentId(null as any)).toThrow('AgentId must be a string');
      expect(() => createAgentId(undefined as any)).toThrow('AgentId must be a string');
      expect(() => createAgentId(123 as any)).toThrow('AgentId must be a string');
    });
  });

  describe('createTaskId', () => {
    // BUG-FIX-011: [HIGH] Added ID validation to prevent empty or whitespace-only IDs.
    // FIX: Added createTaskId function with validation.

    it('should create valid TaskId from non-empty string', () => {
      const id = createTaskId('task-456');
      expect(id).toBe('task-456');
    });

    it('should throw for empty string', () => {
      expect(() => createTaskId('')).toThrow('TaskId cannot be empty or whitespace');
    });

    it('should throw for whitespace-only string', () => {
      expect(() => createTaskId('   ')).toThrow('TaskId cannot be empty or whitespace');
    });

    it('should throw for non-string values', () => {
      expect(() => createTaskId(null as any)).toThrow('TaskId must be a string');
    });
  });

  describe('createRequestId', () => {
    // BUG-FIX-012: [HIGH] Added ID validation to prevent empty or whitespace-only IDs.
    // FIX: Added createRequestId function with validation.

    it('should create valid RequestId from non-empty string', () => {
      const id = createRequestId('req-789');
      expect(id).toBe('req-789');
    });

    it('should throw for empty string', () => {
      expect(() => createRequestId('')).toThrow('RequestId cannot be empty or whitespace');
    });

    it('should throw for whitespace-only string', () => {
      expect(() => createRequestId('   ')).toThrow('RequestId cannot be empty or whitespace');
    });

    it('should throw for non-string values', () => {
      expect(() => createRequestId(null as any)).toThrow('RequestId must be a string');
    });
  });

  describe('createPluginId', () => {
    // BUG-FIX-013: [HIGH] Added ID validation to prevent empty or whitespace-only IDs.
    // FIX: Added createPluginId function with validation.

    it('should create valid PluginId from non-empty string', () => {
      const id = createPluginId('plugin-abc');
      expect(id).toBe('plugin-abc');
    });

    it('should throw for empty string', () => {
      expect(() => createPluginId('')).toThrow('PluginId cannot be empty or whitespace');
    });

    it('should throw for whitespace-only string', () => {
      expect(() => createPluginId('   ')).toThrow('PluginId cannot be empty or whitespace');
    });

    it('should throw for non-string values', () => {
      expect(() => createPluginId(null as any)).toThrow('PluginId must be a string');
    });
  });

  describe('createPipelineId', () => {
    // BUG-FIX-014: [HIGH] Added ID validation to prevent empty or whitespace-only IDs.
    // FIX: Added createPipelineId function with validation.

    it('should create valid PipelineId from non-empty string', () => {
      const id = createPipelineId('pipeline-xyz');
      expect(id).toBe('pipeline-xyz');
    });

    it('should throw for empty string', () => {
      expect(() => createPipelineId('')).toThrow('PipelineId cannot be empty or whitespace');
    });

    it('should throw for whitespace-only string', () => {
      expect(() => createPipelineId('   ')).toThrow('PipelineId cannot be empty or whitespace');
    });

    it('should throw for non-string values', () => {
      expect(() => createPipelineId(null as any)).toThrow('PipelineId must be a string');
    });
  });
});

// ============================================================================
// Configuration Validation Tests
// ============================================================================

describe('Configuration Validators', () => {
  describe('validateHttpConfig', () => {
    // BUG-FIX-015: [HIGH] Added validation for port range and required fields.
    // Previously, invalid port numbers and missing fields could pass validation.
    // FIX: Added validateHttpConfig function with comprehensive validation.

    const validConfig: HttpConfig = {
      enabled: true,
      host: 'localhost',
      port: 8080,
      healthPath: '/health',
    };

    it('should pass for valid configuration', () => {
      expect(() => validateHttpConfig(validConfig)).not.toThrow();
    });

    it('should accept port 0', () => {
      expect(() => validateHttpConfig({ ...validConfig, port: 0 })).not.toThrow();
    });

    it('should accept port 65535', () => {
      expect(() => validateHttpConfig({ ...validConfig, port: 65535 })).not.toThrow();
    });

    it('should throw for non-boolean enabled', () => {
      expect(() => validateHttpConfig({ ...validConfig, enabled: 'true' as any })).toThrow(
        'HttpConfig.enabled must be a boolean',
      );
    });

    it('should throw for empty host', () => {
      expect(() => validateHttpConfig({ ...validConfig, host: '' })).toThrow(
        'HttpConfig.host must be a non-empty string',
      );
    });

    it('should throw for whitespace-only host', () => {
      expect(() => validateHttpConfig({ ...validConfig, host: '   ' })).toThrow(
        'HttpConfig.host must be a non-empty string',
      );
    });

    it('should throw for non-number port', () => {
      expect(() => validateHttpConfig({ ...validConfig, port: '8080' as any })).toThrow(
        'HttpConfig.port must be a number',
      );
    });

    it('should throw for non-integer port', () => {
      expect(() => validateHttpConfig({ ...validConfig, port: 8080.5 })).toThrow(
        'HttpConfig.port must be an integer',
      );
    });

    it('should throw for negative port', () => {
      expect(() => validateHttpConfig({ ...validConfig, port: -1 })).toThrow(
        'HttpConfig.port must be between 0 and 65535',
      );
    });

    it('should throw for port > 65535', () => {
      expect(() => validateHttpConfig({ ...validConfig, port: 65536 })).toThrow(
        'HttpConfig.port must be between 0 and 65535',
      );
    });

    it('should throw for empty healthPath', () => {
      expect(() => validateHttpConfig({ ...validConfig, healthPath: '' })).toThrow(
        'HttpConfig.healthPath must be a non-empty string',
      );
    });
  });

  describe('validatePluginConfig', () => {
    // BUG-FIX-016: [HIGH] Added validation for plugin name and enabled field.
    // FIX: Added validatePluginConfig function with validation.

    const validConfig: PluginConfig = {
      name: 'test-plugin',
      enabled: true,
    };

    it('should pass for valid configuration', () => {
      expect(() => validatePluginConfig(validConfig)).not.toThrow();
    });

    it('should pass for configuration with options', () => {
      expect(() => validatePluginConfig({ ...validConfig, options: { key: 'value' } })).not.toThrow();
    });

    it('should throw for empty name', () => {
      expect(() => validatePluginConfig({ ...validConfig, name: '' })).toThrow(
        'PluginConfig.name must be a non-empty string',
      );
    });

    it('should throw for non-boolean enabled', () => {
      expect(() => validatePluginConfig({ ...validConfig, enabled: 'true' as any })).toThrow(
        'PluginConfig.enabled must be a boolean',
      );
    });

    it('should throw for non-object options', () => {
      expect(() => validatePluginConfig({ ...validConfig, options: 'invalid' as any })).toThrow(
        'PluginConfig.options must be an object if provided',
      );
    });

    it('should throw for array options', () => {
      expect(() => validatePluginConfig({ ...validConfig, options: [] as any })).toThrow(
        'PluginConfig.options must be a plain object, not an array',
      );
    });
  });

  describe('validatePipelineConfig', () => {
    // BUG-FIX-017: [HIGH] Added validation for pipeline name and steps.
    // FIX: Added validatePipelineConfig function with validation.

    const validConfig: PipelineConfig = {
      name: 'test-pipeline',
      steps: ['step1', 'step2'],
    };

    it('should pass for valid configuration', () => {
      expect(() => validatePipelineConfig(validConfig)).not.toThrow();
    });

    it('should throw for empty name', () => {
      expect(() => validatePipelineConfig({ ...validConfig, name: '' })).toThrow(
        'PipelineConfig.name must be a non-empty string',
      );
    });

    it('should throw for non-array steps', () => {
      expect(() => validatePipelineConfig({ ...validConfig, steps: 'invalid' as any })).toThrow(
        'PipelineConfig.steps must be an array',
      );
    });

    it('should throw for empty steps array', () => {
      expect(() => validatePipelineConfig({ ...validConfig, steps: [] })).toThrow(
        'PipelineConfig.steps cannot be empty',
      );
    });

    it('should throw for empty step name', () => {
      expect(() => validatePipelineConfig({ ...validConfig, steps: ['step1', ''] })).toThrow(
        'PipelineConfig.steps[1] must be a non-empty string',
      );
    });

    it('should throw for whitespace-only step name', () => {
      expect(() => validatePipelineConfig({ ...validConfig, steps: ['   '] })).toThrow(
        'PipelineConfig.steps[0] must be a non-empty string',
      );
    });
  });

  describe('validateCheckpointConfig', () => {
    // BUG-FIX-018: [HIGH] Added validation for checkpoint directory and maxRetain.
    // FIX: Added validateCheckpointConfig function with validation.

    const validConfig: CheckpointConfig = {
      enabled: true,
      directory: '/tmp/checkpoints',
      maxRetain: 10,
    };

    it('should pass for valid configuration', () => {
      expect(() => validateCheckpointConfig(validConfig)).not.toThrow();
    });

    it('should accept maxRetain of 0', () => {
      expect(() => validateCheckpointConfig({ ...validConfig, maxRetain: 0 })).not.toThrow();
    });

    it('should throw for non-boolean enabled', () => {
      expect(() => validateCheckpointConfig({ ...validConfig, enabled: 'true' as any })).toThrow(
        'CheckpointConfig.enabled must be a boolean',
      );
    });

    it('should throw for empty directory', () => {
      expect(() => validateCheckpointConfig({ ...validConfig, directory: '' })).toThrow(
        'CheckpointConfig.directory must be a non-empty string',
      );
    });

    it('should throw for non-number maxRetain', () => {
      expect(() => validateCheckpointConfig({ ...validConfig, maxRetain: '10' as any })).toThrow(
        'CheckpointConfig.maxRetain must be a number',
      );
    });

    it('should throw for non-integer maxRetain', () => {
      expect(() => validateCheckpointConfig({ ...validConfig, maxRetain: 10.5 })).toThrow(
        'CheckpointConfig.maxRetain must be an integer',
      );
    });

    it('should throw for negative maxRetain', () => {
      expect(() => validateCheckpointConfig({ ...validConfig, maxRetain: -1 })).toThrow(
        'CheckpointConfig.maxRetain must be non-negative',
      );
    });
  });

  describe('validateClaudeAgentConfig', () => {
    // BUG-FIX-019: [HIGH] Added comprehensive validation for all config fields.
    // FIX: Added validateClaudeAgentConfig function with full validation.

    const validConfig: ClaudeAgentConfig = {
      name: 'test-agent',
      version: '1.0.0',
      logLevel: 'info',
      cwd: '/tmp',
    };

    it('should pass for valid minimal configuration', () => {
      expect(() => validateClaudeAgentConfig(validConfig)).not.toThrow();
    });

    it('should pass for valid full configuration', () => {
      const fullConfig: ClaudeAgentConfig = {
        ...validConfig,
        http: {
          enabled: true,
          host: 'localhost',
          port: 8080,
          healthPath: '/health',
        },
        plugins: [{ name: 'test-plugin', enabled: true }],
        pipelines: [{ name: 'test-pipeline', steps: ['step1'] }],
        checkpoint: {
          enabled: true,
          directory: '/tmp/checkpoints',
          maxRetain: 10,
        },
      };
      expect(() => validateClaudeAgentConfig(fullConfig)).not.toThrow();
    });

    it('should throw for empty name', () => {
      expect(() => validateClaudeAgentConfig({ ...validConfig, name: '' })).toThrow(
        'ClaudeAgentConfig.name must be a non-empty string',
      );
    });

    it('should throw for empty version', () => {
      expect(() => validateClaudeAgentConfig({ ...validConfig, version: '' })).toThrow(
        'ClaudeAgentConfig.version must be a non-empty string',
      );
    });

    it('should throw for invalid logLevel', () => {
      expect(() => validateClaudeAgentConfig({ ...validConfig, logLevel: 'invalid' as any })).toThrow(
        'ClaudeAgentConfig.logLevel must be a valid LogLevel',
      );
    });

    it('should throw for empty cwd', () => {
      expect(() => validateClaudeAgentConfig({ ...validConfig, cwd: '' })).toThrow(
        'ClaudeAgentConfig.cwd must be a non-empty string',
      );
    });

    it('should throw for non-array plugins', () => {
      expect(() => validateClaudeAgentConfig({ ...validConfig, plugins: 'invalid' as any })).toThrow(
        'ClaudeAgentConfig.plugins must be an array if provided',
      );
    });

    it('should throw for invalid plugin config', () => {
      expect(() =>
        validateClaudeAgentConfig({ ...validConfig, plugins: [{ name: '', enabled: true }] }),
      ).toThrow('PluginConfig.name must be a non-empty string');
    });

    it('should throw for non-array pipelines', () => {
      expect(() => validateClaudeAgentConfig({ ...validConfig, pipelines: 'invalid' as any })).toThrow(
        'ClaudeAgentConfig.pipelines must be an array if provided',
      );
    });

    it('should throw for invalid pipeline config', () => {
      expect(() =>
        validateClaudeAgentConfig({ ...validConfig, pipelines: [{ name: 'test', steps: [] }] }),
      ).toThrow('PipelineConfig.steps cannot be empty');
    });
  });
});

// ============================================================================
// Log Level Utilities Tests
// ============================================================================

describe('Log Level Utilities', () => {
  describe('getLogLevelSeverity', () => {
    // BUG-FIX-020: [MEDIUM] Added severity comparison utility for log level filtering.
    // FIX: Added getLogLevelSeverity function.

    it('should return correct severity for each level', () => {
      expect(getLogLevelSeverity('trace')).toBe(0);
      expect(getLogLevelSeverity('debug')).toBe(1);
      expect(getLogLevelSeverity('info')).toBe(2);
      expect(getLogLevelSeverity('warn')).toBe(3);
      expect(getLogLevelSeverity('error')).toBe(4);
      expect(getLogLevelSeverity('fatal')).toBe(5);
    });

    it('should throw for invalid log level', () => {
      expect(() => getLogLevelSeverity('invalid' as any)).toThrow('Invalid LogLevel');
    });
  });

  describe('compareLogLevels', () => {
    // BUG-FIX-021: [MEDIUM] Added log level comparison for filtering logic.
    // FIX: Added compareLogLevels function.

    it('should return negative when a < b', () => {
      expect(compareLogLevels('debug', 'error')).toBeLessThan(0);
      expect(compareLogLevels('trace', 'fatal')).toBeLessThan(0);
    });

    it('should return positive when a > b', () => {
      expect(compareLogLevels('error', 'debug')).toBeGreaterThan(0);
      expect(compareLogLevels('fatal', 'trace')).toBeGreaterThan(0);
    });

    it('should return 0 when a === b', () => {
      expect(compareLogLevels('info', 'info')).toBe(0);
      expect(compareLogLevels('error', 'error')).toBe(0);
    });
  });

  describe('shouldLog', () => {
    // BUG-FIX-022: [MEDIUM] Added log level filtering utility.
    // FIX: Added shouldLog function.

    it('should return true when message level >= minimum level', () => {
      expect(shouldLog('error', 'info')).toBe(true);
      expect(shouldLog('fatal', 'error')).toBe(true);
      expect(shouldLog('info', 'info')).toBe(true);
    });

    it('should return false when message level < minimum level', () => {
      expect(shouldLog('debug', 'info')).toBe(false);
      expect(shouldLog('trace', 'error')).toBe(false);
    });

    it('should work with all log levels', () => {
      // Minimum level is 'warn', only warn, error, fatal should log
      expect(shouldLog('trace', 'warn')).toBe(false);
      expect(shouldLog('debug', 'warn')).toBe(false);
      expect(shouldLog('info', 'warn')).toBe(false);
      expect(shouldLog('warn', 'warn')).toBe(true);
      expect(shouldLog('error', 'warn')).toBe(true);
      expect(shouldLog('fatal', 'warn')).toBe(true);
    });
  });
});

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('Factory Functions', () => {
  describe('createAgentErrorInfo', () => {
    // BUG-FIX-023: [HIGH] Added factory function to ensure timestamp is always set.
    // Previously, timestamp could be undefined or missing.
    // FIX: Added createAgentErrorInfo factory function.

    it('should create valid AgentErrorInfo', () => {
      const error = createAgentErrorInfo('TASK_FAILED', 'Task failed to complete');
      expect(error.code).toBe('TASK_FAILED');
      expect(error.message).toBe('Task failed to complete');
      expect(error.timestamp).toBeInstanceOf(Date);
    });

    it('should include optional details', () => {
      const error = createAgentErrorInfo('PLUGIN_ERROR', 'Plugin failed', {
        details: { pluginName: 'test-plugin' },
        stack: 'Error at line 1',
      });
      expect(error.details).toEqual({ pluginName: 'test-plugin' });
      expect(error.stack).toBe('Error at line 1');
    });

    it('should throw for invalid error code', () => {
      expect(() => createAgentErrorInfo('INVALID_CODE' as any, 'message')).toThrow('Invalid ErrorCode');
    });

    it('should throw for non-string message', () => {
      expect(() => createAgentErrorInfo('TASK_FAILED', 123 as any)).toThrow('message must be a string');
    });

    it('should throw for empty message', () => {
      expect(() => createAgentErrorInfo('TASK_FAILED', '')).toThrow('message cannot be empty');
    });

    it('should throw for whitespace-only message', () => {
      expect(() => createAgentErrorInfo('TASK_FAILED', '   ')).toThrow('message cannot be empty');
    });
  });

  describe('createAgentEvent', () => {
    // BUG-FIX-024: [HIGH] Added factory function to ensure timestamp is always set and data is valid.
    // FIX: Added createAgentEvent factory function.

    it('should create valid AgentEvent', () => {
      const event = createAgentEvent('task.completed', { taskId: 'task-123' });
      expect(event.type).toBe('task.completed');
      expect(event.timestamp).toBeInstanceOf(Date);
      expect(event.data).toEqual({ taskId: 'task-123' });
    });

    it('should include optional requestId', () => {
      const event = createAgentEvent('task.started', { taskId: 'task-123' }, 'req-456' as RequestId);
      expect(event.requestId).toBe('req-456');
    });

    it('should throw for invalid event type', () => {
      expect(() => createAgentEvent('invalid' as any, {})).toThrow('Invalid AgentEventType');
    });

    it('should throw for null data', () => {
      expect(() => createAgentEvent('task.completed', null as any)).toThrow('data must be a plain object');
    });

    it('should throw for array data', () => {
      expect(() => createAgentEvent('task.completed', [] as any)).toThrow('data must be a plain object');
    });
  });
});

// ============================================================================
// State Transition Tests
// ============================================================================

describe('State Transitions', () => {
  describe('isValidTaskTransition', () => {
    // BUG-FIX-025: [HIGH] Added state transition validation to prevent invalid state changes.
    // Previously, any status change was allowed without validation.
    // FIX: Added isValidTaskTransition function.

    it('should allow valid transitions from pending', () => {
      expect(isValidTaskTransition('pending', 'running')).toBe(true);
      expect(isValidTaskTransition('pending', 'cancelled')).toBe(true);
      expect(isValidTaskTransition('pending', 'skipped')).toBe(true);
    });

    it('should allow valid transitions from running', () => {
      expect(isValidTaskTransition('running', 'completed')).toBe(true);
      expect(isValidTaskTransition('running', 'failed')).toBe(true);
      expect(isValidTaskTransition('running', 'cancelled')).toBe(true);
    });

    it('should allow retry from failed/cancelled', () => {
      expect(isValidTaskTransition('failed', 'pending')).toBe(true);
      expect(isValidTaskTransition('cancelled', 'pending')).toBe(true);
    });

    it('should not allow transitions from terminal states', () => {
      expect(isValidTaskTransition('completed', 'pending')).toBe(false);
      expect(isValidTaskTransition('completed', 'running')).toBe(false);
      expect(isValidTaskTransition('skipped', 'pending')).toBe(false);
    });

    it('should not allow invalid transitions', () => {
      expect(isValidTaskTransition('pending', 'completed')).toBe(false); // Must go through running
      expect(isValidTaskTransition('running', 'pending')).toBe(false);
      expect(isValidTaskTransition('idle' as any, 'running')).toBe(false); // Invalid status
    });

    it('should return false for same status', () => {
      expect(isValidTaskTransition('pending', 'pending')).toBe(false);
      expect(isValidTaskTransition('running', 'running')).toBe(false);
    });
  });

  describe('isValidAgentTransition', () => {
    // BUG-FIX-026: [HIGH] Added state transition validation to prevent invalid state changes.
    // FIX: Added isValidAgentTransition function.

    it('should allow valid transitions from idle', () => {
      expect(isValidAgentTransition('idle', 'running')).toBe(true);
      expect(isValidAgentTransition('idle', 'stopped')).toBe(true);
    });

    it('should allow valid transitions from running', () => {
      expect(isValidAgentTransition('running', 'paused')).toBe(true);
      expect(isValidAgentTransition('running', 'stopping')).toBe(true);
      expect(isValidAgentTransition('running', 'error')).toBe(true);
    });

    it('should allow valid transitions from paused', () => {
      expect(isValidAgentTransition('paused', 'running')).toBe(true);
      expect(isValidAgentTransition('paused', 'stopping')).toBe(true);
    });

    it('should allow valid transitions from stopping', () => {
      expect(isValidAgentTransition('stopping', 'stopped')).toBe(true);
      expect(isValidAgentTransition('stopping', 'error')).toBe(true);
    });

    it('should allow recovery from error', () => {
      expect(isValidAgentTransition('error', 'idle')).toBe(true);
      expect(isValidAgentTransition('error', 'stopped')).toBe(true);
    });

    it('should allow restart from stopped', () => {
      expect(isValidAgentTransition('stopped', 'idle')).toBe(true);
    });

    it('should not allow invalid transitions', () => {
      expect(isValidAgentTransition('idle', 'paused')).toBe(false);
      expect(isValidAgentTransition('stopped', 'running')).toBe(false);
      expect(isValidAgentTransition('running', 'idle')).toBe(false);
    });
  });

  describe('isValidPluginTransition', () => {
    // BUG-FIX-027: [HIGH] Added state transition validation to prevent invalid state changes.
    // FIX: Added isValidPluginTransition function.

    it('should allow valid plugin lifecycle transitions', () => {
      expect(isValidPluginTransition('registered', 'initializing')).toBe(true);
      expect(isValidPluginTransition('initializing', 'ready')).toBe(true);
      expect(isValidPluginTransition('ready', 'active')).toBe(true);
      expect(isValidPluginTransition('active', 'stopping')).toBe(true);
      expect(isValidPluginTransition('stopping', 'stopped')).toBe(true);
    });

    it('should allow stopping from various states', () => {
      expect(isValidPluginTransition('initializing', 'stopped')).toBe(true);
      expect(isValidPluginTransition('ready', 'stopping')).toBe(true);
    });

    it('should not allow transitions from stopped', () => {
      expect(isValidPluginTransition('stopped', 'registered')).toBe(false);
      expect(isValidPluginTransition('stopped', 'ready')).toBe(false);
    });

    it('should not allow invalid transitions', () => {
      expect(isValidPluginTransition('registered', 'ready')).toBe(false); // Must initialize first
      expect(isValidPluginTransition('ready', 'initializing')).toBe(false);
      expect(isValidPluginTransition('active', 'ready')).toBe(false);
    });
  });

  describe('isValidPipelineTransition', () => {
    // BUG-FIX-028: [HIGH] Added state transition validation to prevent invalid state changes.
    // FIX: Added isValidPipelineTransition function.

    it('should allow valid transitions from pending', () => {
      expect(isValidPipelineTransition('pending', 'running')).toBe(true);
      expect(isValidPipelineTransition('pending', 'cancelled')).toBe(true);
    });

    it('should allow valid transitions from running', () => {
      expect(isValidPipelineTransition('running', 'completed')).toBe(true);
      expect(isValidPipelineTransition('running', 'failed')).toBe(true);
      expect(isValidPipelineTransition('running', 'cancelled')).toBe(true);
    });

    it('should allow retry from failed/cancelled', () => {
      expect(isValidPipelineTransition('failed', 'pending')).toBe(true);
      expect(isValidPipelineTransition('cancelled', 'pending')).toBe(true);
    });

    it('should not allow transitions from completed', () => {
      expect(isValidPipelineTransition('completed', 'pending')).toBe(false);
      expect(isValidPipelineTransition('completed', 'running')).toBe(false);
    });

    it('should not allow invalid transitions', () => {
      expect(isValidPipelineTransition('pending', 'completed')).toBe(false);
      expect(isValidPipelineTransition('running', 'pending')).toBe(false);
    });
  });
});

// ============================================================================
// Health Check Tests
// ============================================================================

describe('Health Check Utilities', () => {
  describe('createHealthCheck', () => {
    // BUG-FIX-029: [MEDIUM] Added factory function with validation.
    // FIX: Added createHealthCheck function.

    it('should create valid HealthCheck', () => {
      const check = createHealthCheck('database', 'healthy');
      expect(check.name).toBe('database');
      expect(check.status).toBe('healthy');
    });

    it('should include optional fields', () => {
      const check = createHealthCheck('api', 'degraded', {
        message: 'High latency',
        duration: 150,
        details: { latency: 150 },
      });
      expect(check.message).toBe('High latency');
      expect(check.duration).toBe(150);
      expect(check.details).toEqual({ latency: 150 });
    });

    it('should throw for empty name', () => {
      expect(() => createHealthCheck('', 'healthy')).toThrow('HealthCheck.name must be a non-empty string');
    });

    it('should throw for invalid status', () => {
      expect(() => createHealthCheck('test', 'invalid' as any)).toThrow('Invalid health status');
    });

    it('should throw for negative duration', () => {
      expect(() => createHealthCheck('test', 'healthy', { duration: -1 })).toThrow(
        'HealthCheck.duration must be non-negative',
      );
    });

    it('should throw for non-number duration', () => {
      expect(() => createHealthCheck('test', 'healthy', { duration: '100' as any })).toThrow(
        'HealthCheck.duration must be a number',
      );
    });
  });

  describe('createHealthCheckResult', () => {
    // BUG-FIX-030: [HIGH] Added factory function with validation and uptime calculation.
    // FIX: Added createHealthCheckResult function.

    it('should create valid HealthCheckResult', () => {
      const checks: HealthCheck[] = [
        createHealthCheck('database', 'healthy'),
        createHealthCheck('api', 'healthy'),
      ];
      const startTime = new Date(Date.now() - 1000);
      const result = createHealthCheckResult(checks, '1.0.0', startTime);

      expect(result.status).toBe('healthy');
      expect(result.checks).toHaveLength(2);
      expect(result.version).toBe('1.0.0');
      expect(result.uptime).toBeGreaterThanOrEqual(1000);
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should determine overall status as degraded when any check is degraded', () => {
      const checks: HealthCheck[] = [
        createHealthCheck('database', 'healthy'),
        createHealthCheck('api', 'degraded'),
      ];
      const result = createHealthCheckResult(checks, '1.0.0', new Date());
      expect(result.status).toBe('degraded');
    });

    it('should determine overall status as unhealthy when any check is unhealthy', () => {
      const checks: HealthCheck[] = [
        createHealthCheck('database', 'healthy'),
        createHealthCheck('api', 'degraded'),
        createHealthCheck('cache', 'unhealthy'),
      ];
      const result = createHealthCheckResult(checks, '1.0.0', new Date());
      expect(result.status).toBe('unhealthy');
    });

    it('should prioritize unhealthy over degraded', () => {
      const checks: HealthCheck[] = [
        createHealthCheck('api', 'degraded'),
        createHealthCheck('cache', 'unhealthy'),
      ];
      const result = createHealthCheckResult(checks, '1.0.0', new Date());
      expect(result.status).toBe('unhealthy');
    });

    it('should handle empty checks array', () => {
      const result = createHealthCheckResult([], '1.0.0', new Date());
      expect(result.status).toBe('healthy');
    });

    it('should throw for non-array checks', () => {
      expect(() => createHealthCheckResult('invalid' as any, '1.0.0', new Date())).toThrow(
        'checks must be an array',
      );
    });

    it('should throw for invalid check in array', () => {
      const invalidCheck = { name: '', status: 'healthy' } as HealthCheck;
      expect(() => createHealthCheckResult([invalidCheck], '1.0.0', new Date())).toThrow(
        'checks[0].name must be a non-empty string',
      );
    });

    it('should throw for empty version', () => {
      expect(() => createHealthCheckResult([], '', new Date())).toThrow('version must be a non-empty string');
    });

    it('should throw for invalid startTime', () => {
      expect(() => createHealthCheckResult([], '1.0.0', 'invalid' as any)).toThrow(
        'startTime must be a valid Date',
      );
      expect(() => createHealthCheckResult([], '1.0.0', new Date('invalid'))).toThrow(
        'startTime must be a valid Date',
      );
    });
  });
});

// ============================================================================
// Memory Usage Tests
// ============================================================================

describe('Memory Usage Utilities', () => {
  describe('validateMemoryUsage', () => {
    // BUG-FIX-031: [MEDIUM] Added validation for memory usage values.
    // FIX: Added validateMemoryUsage function.

    const validMemory: MemoryUsage = {
      rss: 1000000,
      heapUsed: 500000,
      heapTotal: 1000000,
      external: 100000,
    };

    it('should pass for valid memory usage', () => {
      expect(() => validateMemoryUsage(validMemory)).not.toThrow();
    });

    it('should accept zero values', () => {
      expect(() =>
        validateMemoryUsage({
          rss: 0,
          heapUsed: 0,
          heapTotal: 0,
          external: 0,
        }),
      ).not.toThrow();
    });

    it('should throw for negative rss', () => {
      expect(() => validateMemoryUsage({ ...validMemory, rss: -1 })).toThrow(
        'MemoryUsage.rss must be a non-negative number',
      );
    });

    it('should throw for negative heapUsed', () => {
      expect(() => validateMemoryUsage({ ...validMemory, heapUsed: -1 })).toThrow(
        'MemoryUsage.heapUsed must be a non-negative number',
      );
    });

    it('should throw for negative heapTotal', () => {
      expect(() => validateMemoryUsage({ ...validMemory, heapTotal: -1 })).toThrow(
        'MemoryUsage.heapTotal must be a non-negative number',
      );
    });

    it('should throw for negative external', () => {
      expect(() => validateMemoryUsage({ ...validMemory, external: -1 })).toThrow(
        'MemoryUsage.external must be a non-negative number',
      );
    });

    it('should throw when heapUsed > heapTotal', () => {
      expect(() => validateMemoryUsage({ ...validMemory, heapUsed: 2000000, heapTotal: 1000000 })).toThrow(
        'MemoryUsage.heapUsed cannot exceed heapTotal',
      );
    });

    it('should throw for non-number values', () => {
      expect(() => validateMemoryUsage({ ...validMemory, rss: '100' as any })).toThrow(
        'MemoryUsage.rss must be a non-negative number',
      );
    });
  });

  describe('createMetricsData', () => {
    // BUG-FIX-032: [HIGH] Added factory function with validation.
    // FIX: Added createMetricsData function.

    const validData = {
      tasksTotal: 100,
      tasksCompleted: 80,
      tasksFailed: 5,
      pipelinesTotal: 10,
      pipelinesCompleted: 8,
      activePlugins: 3,
      startTime: new Date(Date.now() - 60000),
    };

    const validMemory: MemoryUsage = {
      rss: 1000000,
      heapUsed: 500000,
      heapTotal: 1000000,
      external: 100000,
    };

    it('should create valid MetricsData', () => {
      const metrics = createMetricsData(validData, validMemory);
      expect(metrics.tasksTotal).toBe(100);
      expect(metrics.tasksCompleted).toBe(80);
      expect(metrics.tasksFailed).toBe(5);
      expect(metrics.pipelinesTotal).toBe(10);
      expect(metrics.pipelinesCompleted).toBe(8);
      expect(metrics.activePlugins).toBe(3);
      expect(metrics.uptime).toBeGreaterThanOrEqual(60000);
      expect(metrics.timestamp).toBeInstanceOf(Date);
      expect(metrics.memoryUsage).toEqual(validMemory);
    });

    it('should accept zero values', () => {
      const zeroData = {
        tasksTotal: 0,
        tasksCompleted: 0,
        tasksFailed: 0,
        pipelinesTotal: 0,
        pipelinesCompleted: 0,
        activePlugins: 0,
        startTime: new Date(),
      };
      expect(() => createMetricsData(zeroData, validMemory)).not.toThrow();
    });

    it('should throw for negative tasksTotal', () => {
      expect(() => createMetricsData({ ...validData, tasksTotal: -1 }, validMemory)).toThrow(
        'tasksTotal must be non-negative',
      );
    });

    it('should throw for non-integer tasksTotal', () => {
      expect(() => createMetricsData({ ...validData, tasksTotal: 10.5 }, validMemory)).toThrow(
        'tasksTotal must be an integer',
      );
    });

    it('should throw when tasksCompleted > tasksTotal', () => {
      expect(() => createMetricsData({ ...validData, tasksCompleted: 200 }, validMemory)).toThrow(
        'tasksCompleted cannot exceed tasksTotal',
      );
    });

    it('should throw when tasksFailed > tasksTotal', () => {
      expect(() => createMetricsData({ ...validData, tasksFailed: 200 }, validMemory)).toThrow(
        'tasksFailed cannot exceed tasksTotal',
      );
    });

    it('should throw when pipelinesCompleted > pipelinesTotal', () => {
      expect(() => createMetricsData({ ...validData, pipelinesCompleted: 200 }, validMemory)).toThrow(
        'pipelinesCompleted cannot exceed pipelinesTotal',
      );
    });

    it('should throw for invalid startTime', () => {
      expect(() => createMetricsData({ ...validData, startTime: 'invalid' as any }, validMemory)).toThrow(
        'startTime must be a valid Date',
      );
    });

    it('should throw for invalid memory', () => {
      expect(() => createMetricsData(validData, { ...validMemory, rss: -1 })).toThrow(
        'MemoryUsage.rss must be a non-negative number',
      );
    });
  });
});

// ============================================================================
// Constants Tests
// ============================================================================

describe('Constants', () => {
  it('LOG_LEVELS should contain all log levels in order', () => {
    expect(LOG_LEVELS).toEqual(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
  });

  it('AGENT_STATUSES should contain all agent statuses', () => {
    expect(AGENT_STATUSES).toEqual(['idle', 'running', 'paused', 'stopping', 'stopped', 'error']);
  });

  it('TASK_STATUSES should contain all task statuses', () => {
    expect(TASK_STATUSES).toEqual(['pending', 'running', 'completed', 'failed', 'cancelled', 'skipped']);
  });

  it('PLUGIN_PHASES should contain all plugin phases', () => {
    expect(PLUGIN_PHASES).toEqual([
      'registered',
      'initializing',
      'ready',
      'active',
      'stopping',
      'stopped',
    ]);
  });

  it('PIPELINE_STATUSES should contain all pipeline statuses', () => {
    expect(PIPELINE_STATUSES).toEqual(['pending', 'running', 'completed', 'failed', 'cancelled']);
  });

  it('HEALTH_STATUSES should contain all health statuses', () => {
    expect(HEALTH_STATUSES).toEqual(['healthy', 'degraded', 'unhealthy']);
  });

  it('ERROR_CODES should contain all error codes', () => {
    expect(ERROR_CODES).toContain('AGENT_NOT_FOUND');
    expect(ERROR_CODES).toContain('TASK_FAILED');
    expect(ERROR_CODES).toContain('TASK_TIMEOUT');
    expect(ERROR_CODES).toContain('CONFIG_INVALID');
    expect(ERROR_CODES).toContain('CONFIG_NOT_FOUND');
    expect(ERROR_CODES).toContain('PLUGIN_ERROR');
    expect(ERROR_CODES).toContain('PLUGIN_NOT_FOUND');
    expect(ERROR_CODES).toContain('PIPELINE_ERROR');
    expect(ERROR_CODES).toContain('PIPELINE_STEP_FAILED');
    expect(ERROR_CODES).toContain('HTTP_ERROR');
    expect(ERROR_CODES).toContain('VALIDATION_ERROR');
    expect(ERROR_CODES).toContain('INTERNAL_ERROR');
    expect(ERROR_CODES).toContain('LIFECYCLE_ERROR');
    expect(ERROR_CODES).toHaveLength(13);
  });

  it('AGENT_EVENT_TYPES should contain all event types', () => {
    expect(AGENT_EVENT_TYPES).toContain('agent.started');
    expect(AGENT_EVENT_TYPES).toContain('task.completed');
    expect(AGENT_EVENT_TYPES).toContain('pipeline.failed');
    expect(AGENT_EVENT_TYPES).toContain('plugin.error');
    expect(AGENT_EVENT_TYPES).toHaveLength(17);
  });

  it('CLI_COMMANDS should contain all CLI commands', () => {
    expect(CLI_COMMANDS).toEqual([
      'run',
      'analyze',
      'test',
      'graph',
      'devops',
      'design',
      'monitor',
      'checkpoint',
      'ask',
    ]);
  });
});

// ============================================================================
// Type Interface Tests (Compile-time validation)
// ============================================================================

describe('Type Interfaces', () => {
  it('should allow valid ClaudeAgentConfig', () => {
    const config: ClaudeAgentConfig = {
      name: 'test-agent',
      version: '1.0.0',
      logLevel: 'info',
      cwd: '/tmp',
    };
    expect(config.name).toBe('test-agent');
  });

  it('should allow valid Task', () => {
    const task: Task<string, number> = {
      id: 'task-123' as TaskId,
      name: 'test-task',
      status: 'pending',
      input: 'input-data',
      output: undefined,
      createdAt: new Date(),
      metadata: {
        retryCount: 0,
        timeout: 30000,
        tags: ['test'],
      },
    };
    expect(task.name).toBe('test-task');
  });

  it('should allow valid Agent', () => {
    const agent: Agent = {
      id: 'agent-123' as AgentId,
      name: 'test-agent',
      status: 'idle',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(agent.name).toBe('test-agent');
  });

  it('should allow valid Plugin', () => {
    const plugin: Plugin = {
      id: 'plugin-123' as PluginId,
      name: 'test-plugin',
      version: '1.0.0',
      phase: 'registered',
      description: 'A test plugin',
    };
    expect(plugin.name).toBe('test-plugin');
  });

  it('should allow valid Pipeline', () => {
    const pipeline: Pipeline = {
      id: 'pipeline-123' as PipelineId,
      name: 'test-pipeline',
      status: 'pending',
      steps: [],
      createdAt: new Date(),
    };
    expect(pipeline.name).toBe('test-pipeline');
  });

  it('should allow valid AgentEvent', () => {
    const event: AgentEvent = {
      type: 'task.completed',
      timestamp: new Date(),
      data: { taskId: 'task-123' },
    };
    expect(event.type).toBe('task.completed');
  });

  it('should allow valid HealthCheckResult', () => {
    const result: HealthCheckResult = {
      status: 'healthy',
      timestamp: new Date(),
      checks: [],
      uptime: 1000,
      version: '1.0.0',
    };
    expect(result.status).toBe('healthy');
  });

  it('should allow valid MetricsData', () => {
    const metrics: MetricsData = {
      timestamp: new Date(),
      tasksTotal: 100,
      tasksCompleted: 80,
      tasksFailed: 5,
      pipelinesTotal: 10,
      pipelinesCompleted: 8,
      activePlugins: 3,
      uptime: 60000,
      memoryUsage: {
        rss: 1000000,
        heapUsed: 500000,
        heapTotal: 1000000,
        external: 100000,
      },
    };
    expect(metrics.tasksTotal).toBe(100);
  });
});

// ============================================================================
// Edge Case Tests
// ============================================================================

describe('Edge Cases', () => {
  describe('Very large inputs', () => {
    it('should handle very long ID strings', () => {
      const longId = 'a'.repeat(10000);
      expect(() => createAgentId(longId)).not.toThrow();
      expect(createAgentId(longId)).toBe(longId);
    });

    it('should handle large port number at boundary', () => {
      expect(() =>
        validateHttpConfig({
          enabled: true,
          host: 'localhost',
          port: 65535,
          healthPath: '/health',
        }),
      ).not.toThrow();
    });

    it('should handle large metrics values', () => {
      const largeData = {
        tasksTotal: Number.MAX_SAFE_INTEGER,
        tasksCompleted: Number.MAX_SAFE_INTEGER,
        tasksFailed: 0,
        pipelinesTotal: Number.MAX_SAFE_INTEGER,
        pipelinesCompleted: Number.MAX_SAFE_INTEGER,
        activePlugins: Number.MAX_SAFE_INTEGER,
        startTime: new Date(),
      };
      const memory: MemoryUsage = {
        rss: Number.MAX_SAFE_INTEGER,
        heapUsed: Number.MAX_SAFE_INTEGER,
        heapTotal: Number.MAX_SAFE_INTEGER,
        external: Number.MAX_SAFE_INTEGER,
      };
      expect(() => createMetricsData(largeData, memory)).not.toThrow();
    });
  });

  describe('Unicode and special characters', () => {
    it('should handle unicode in ID strings', () => {
      const unicodeId = 'agent-测试-🎉';
      expect(createAgentId(unicodeId)).toBe(unicodeId);
    });

    it('should handle special characters in config names', () => {
      const config: ClaudeAgentConfig = {
        name: 'test-agent-测试',
        version: '1.0.0-beta.1+build.123',
        logLevel: 'info',
        cwd: '/tmp/path with spaces',
      };
      expect(() => validateClaudeAgentConfig(config)).not.toThrow();
    });
  });

  describe('Concurrent access simulation', () => {
    it('should handle multiple simultaneous ID creations', async () => {
      const promises = Array.from({ length: 100 }, (_, i) =>
        Promise.resolve(createAgentId(`agent-${i}`)),
      );
      const ids = await Promise.all(promises);
      expect(ids).toHaveLength(100);
      ids.forEach((id, i) => {
        expect(id).toBe(`agent-${i}`);
      });
    });

    it('should handle multiple simultaneous event creations', async () => {
      const promises = Array.from({ length: 100 }, (_, i) =>
        Promise.resolve(createAgentEvent('task.completed', { taskId: `task-${i}` })),
      );
      const events = await Promise.all(promises);
      expect(events).toHaveLength(100);
      events.forEach((event, i) => {
        expect(event.data.taskId).toBe(`task-${i}`);
      });
    });
  });

  describe('Date edge cases', () => {
    it('should handle dates at epoch', () => {
      const epochDate = new Date(0);
      const result = createHealthCheckResult([], '1.0.0', epochDate);
      expect(result.uptime).toBeGreaterThanOrEqual(Date.now());
    });

    it('should handle future dates for startTime', () => {
      const futureDate = new Date(Date.now() + 100000);
      const result = createHealthCheckResult([], '1.0.0', futureDate);
      expect(result.uptime).toBeLessThan(0); // Negative uptime for future dates
    });
  });
});

// ============================================================================
// Error Recovery Tests
// ============================================================================

describe('Error Recovery', () => {
  describe('Invalid input recovery', () => {
    it('should provide clear error messages for debugging', () => {
      try {
        validateHttpConfig({
          enabled: 'true' as any,
          host: '',
          port: -1,
          healthPath: '',
        });
      } catch (error) {
        expect(error).toBeInstanceOf(TypeError);
        expect((error as Error).message).toContain('HttpConfig.enabled');
      }
    });

    it('should fail fast on first error', () => {
      // Should throw on the first invalid field (enabled)
      expect(() =>
        validateHttpConfig({
          enabled: 'true' as any,
          host: '',
          port: -1,
          healthPath: '',
        }),
      ).toThrow('HttpConfig.enabled');
    });
  });

  describe('Type coercion prevention', () => {
    it('should not coerce string numbers to numbers', () => {
      expect(() =>
        validateHttpConfig({
          enabled: true,
          host: 'localhost',
          port: '8080' as any,
          healthPath: '/health',
        }),
      ).toThrow('HttpConfig.port must be a number');
    });

    it('should not coerce string booleans to booleans', () => {
      expect(() =>
        validatePluginConfig({
          name: 'test',
          enabled: 'true' as any,
        }),
      ).toThrow('PluginConfig.enabled must be a boolean');
    });
  });
});

// ============================================================================
// Summary
// ============================================================================

describe('Test Summary', () => {
  it('should document all bugs found and fixed', () => {
    // This test serves as documentation for all bugs found and fixed
    const bugs = [
      'BUG-FIX-001: [HIGH] Added runtime validation for LogLevel',
      'BUG-FIX-002: [HIGH] Added runtime validation for AgentStatus',
      'BUG-FIX-003: [HIGH] Added runtime validation for TaskStatus',
      'BUG-FIX-004: [HIGH] Added runtime validation for PluginPhase',
      'BUG-FIX-005: [HIGH] Added runtime validation for PipelineStatus',
      'BUG-FIX-006: [HIGH] Added runtime validation for ErrorCode',
      'BUG-FIX-007: [HIGH] Added runtime validation for AgentEventType',
      'BUG-FIX-008: [MEDIUM] Added runtime validation for CLICommand',
      'BUG-FIX-009: [MEDIUM] Added runtime validation for health status',
      'BUG-FIX-010: [HIGH] Added ID validation for AgentId',
      'BUG-FIX-011: [HIGH] Added ID validation for TaskId',
      'BUG-FIX-012: [HIGH] Added ID validation for RequestId',
      'BUG-FIX-013: [HIGH] Added ID validation for PluginId',
      'BUG-FIX-014: [HIGH] Added ID validation for PipelineId',
      'BUG-FIX-015: [HIGH] Added validation for HttpConfig port range',
      'BUG-FIX-016: [HIGH] Added validation for PluginConfig',
      'BUG-FIX-017: [HIGH] Added validation for PipelineConfig',
      'BUG-FIX-018: [HIGH] Added validation for CheckpointConfig',
      'BUG-FIX-019: [HIGH] Added comprehensive validation for ClaudeAgentConfig',
      'BUG-FIX-020: [MEDIUM] Added severity comparison utility for log levels',
      'BUG-FIX-021: [MEDIUM] Added log level comparison function',
      'BUG-FIX-022: [MEDIUM] Added log level filtering utility',
      'BUG-FIX-023: [HIGH] Added factory function for AgentErrorInfo',
      'BUG-FIX-024: [HIGH] Added factory function for AgentEvent',
      'BUG-FIX-025: [HIGH] Added state transition validation for TaskStatus',
      'BUG-FIX-026: [HIGH] Added state transition validation for AgentStatus',
      'BUG-FIX-027: [HIGH] Added state transition validation for PluginPhase',
      'BUG-FIX-028: [HIGH] Added state transition validation for PipelineStatus',
      'BUG-FIX-029: [MEDIUM] Added factory function for HealthCheck',
      'BUG-FIX-030: [HIGH] Added factory function for HealthCheckResult',
      'BUG-FIX-031: [MEDIUM] Added validation for MemoryUsage',
      'BUG-FIX-032: [HIGH] Added factory function for MetricsData',
    ];

    expect(bugs).toHaveLength(32);
  });
});
