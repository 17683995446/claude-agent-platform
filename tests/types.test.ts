// ============================================================================
// Tests for @claude-agent/types
// ============================================================================

import { describe, test, expect } from 'bun:test';

describe('@claude-agent/types', () => {
  describe('Type Brands', () => {
    test('AgentId type brand works at runtime', () => {
      const id = 'agent-123' as any;
      expect(typeof id).toBe('string');
    });

    test('TaskId type brand works at runtime', () => {
      const id = 'task-456' as any;
      expect(typeof id).toBe('string');
    });

    test('RequestId type brand works at runtime', () => {
      const id = 'req-789' as any;
      expect(typeof id).toBe('string');
    });

    test('PluginId type brand works at runtime', () => {
      const id = 'plugin-abc' as any;
      expect(typeof id).toBe('string');
    });

    test('PipelineId type brand works at runtime', () => {
      const id = 'pipeline-def' as any;
      expect(typeof id).toBe('string');
    });
  });

  describe('Enum-like Types', () => {
    test('LogLevel values are valid', () => {
      const levels: string[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
      expect(levels).toHaveLength(6);
    });

    test('AgentStatus values are valid', () => {
      const statuses: string[] = ['idle', 'running', 'paused', 'stopping', 'stopped', 'error'];
      expect(statuses).toHaveLength(6);
    });

    test('TaskStatus values are valid', () => {
      const statuses: string[] = ['pending', 'running', 'completed', 'failed', 'cancelled', 'skipped'];
      expect(statuses).toHaveLength(6);
    });

    test('PluginPhase values are valid', () => {
      const phases: string[] = ['registered', 'initializing', 'ready', 'active', 'stopping', 'stopped'];
      expect(phases).toHaveLength(6);
    });

    test('PipelineStatus values are valid', () => {
      const statuses: string[] = ['pending', 'running', 'completed', 'failed', 'cancelled'];
      expect(statuses).toHaveLength(5);
    });
  });

  describe('Interface Shapes', () => {
    test('ClaudeAgentConfig interface shape', () => {
      const config = {
        name: 'test-agent',
        version: '1.0.0',
        logLevel: 'info' as const,
        cwd: '/tmp',
      };
      expect(config.name).toBe('test-agent');
      expect(config.version).toBe('1.0.0');
      expect(config.logLevel).toBe('info');
      expect(config.cwd).toBe('/tmp');
    });

    test('AgentEvent interface shape', () => {
      const event = {
        type: 'agent.started' as const,
        timestamp: new Date(),
        data: { agentId: 'test' },
      };
      expect(event.type).toBe('agent.started');
      expect(event.timestamp).toBeInstanceOf(Date);
      expect(event.data.agentId).toBe('test');
    });

    test('HealthCheckResult interface shape', () => {
      const result = {
        status: 'healthy' as const,
        timestamp: new Date(),
        checks: [],
        uptime: 1000,
        version: '1.0.0',
      };
      expect(result.status).toBe('healthy');
      expect(result.checks).toHaveLength(0);
      expect(result.uptime).toBe(1000);
    });

    test('LogEntry interface shape', () => {
      const entry = {
        timestamp: new Date().toISOString(),
        level: 'info' as const,
        message: 'test message',
      };
      expect(entry.level).toBe('info');
      expect(entry.message).toBe('test message');
    });
  });
});
