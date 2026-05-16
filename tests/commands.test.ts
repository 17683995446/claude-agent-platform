// ============================================================================
// Tests for @claude-agent/commands
// ============================================================================
import { describe, test, expect, beforeEach } from 'bun:test';
import { CommandBus, loggingCommandMiddleware, createCommand } from '../packages/commands/src/index.js';

describe('@claude-agent/commands', () => {
  describe('CommandBus', () => {
    let bus: CommandBus;

    beforeEach(() => { bus = new CommandBus(); });

    test('registers and dispatches command', async () => {
      bus.register('greet', async (cmd) => ({ success: true, data: `Hello, ${cmd.payload.name}!`, duration: 0 }));
      const result = await bus.dispatch('greet', { name: 'World' });
      expect(result.success).toBe(true);
      expect(result.data).toBe('Hello, World!');
    });

    test('returns error for unknown command', async () => {
      const result = await bus.dispatch('unknown', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('No handler registered');
    });

    test('validates commands', async () => {
      bus.register('create', async (cmd) => ({ success: true, data: cmd.payload, duration: 0 }), (payload) => {
        if (!payload.name) return { valid: false, errors: ['name is required'] };
        return { valid: true };
      });
      const valid = await bus.dispatch('create', { name: 'test' });
      expect(valid.success).toBe(true);
      const invalid = await bus.dispatch('create', {});
      expect(invalid.success).toBe(false);
      expect(invalid.error).toContain('Validation failed');
    });

    test('records command history', async () => {
      bus.register('test', async () => ({ success: true, duration: 0 }));
      await bus.dispatch('test', {});
      await bus.dispatch('test', {});
      expect(bus.getHistory()).toHaveLength(2);
    });

    test('filters history by type', async () => {
      bus.register('a', async () => ({ success: true, duration: 0 }));
      bus.register('b', async () => ({ success: true, duration: 0 }));
      await bus.dispatch('a', {});
      await bus.dispatch('b', {});
      await bus.dispatch('a', {});
      expect(bus.getHistory('a')).toHaveLength(2);
      expect(bus.getHistory('b')).toHaveLength(1);
    });

    test('clears history', async () => {
      bus.register('test', async () => ({ success: true, duration: 0 }));
      await bus.dispatch('test', {});
      bus.clearHistory();
      expect(bus.getHistory()).toHaveLength(0);
    });

    test('unregisters handlers', () => {
      bus.register('test', async () => ({ success: true, duration: 0 }));
      expect(bus.hasHandler('test')).toBe(true);
      bus.unregister('test');
      expect(bus.hasHandler('test')).toBe(false);
    });

    test('lists handlers', () => {
      bus.register('a', async () => ({ success: true, duration: 0 }));
      bus.register('b', async () => ({ success: true, duration: 0 }));
      expect(bus.listHandlers()).toEqual(['a', 'b']);
    });

    test('handles handler errors', async () => {
      bus.register('fail', async () => { throw new Error('handler failed'); });
      const result = await bus.dispatch('fail', {});
      expect(result.success).toBe(false);
      expect(result.error).toBe('handler failed');
    });

    test('uses middleware', async () => {
      bus.use(loggingCommandMiddleware());
      bus.register('test', async () => ({ success: true, data: 'ok', duration: 0 }));
      const result = await bus.dispatch('test', {});
      expect(result.success).toBe(true);
    });
  });

  describe('createCommand', () => {
    test('creates command with type and payload', () => {
      const cmd = createCommand('test', { key: 'value' });
      expect(cmd.commandType).toBe('test');
      expect(cmd.payload).toEqual({ key: 'value' });
      expect(cmd.commandId).toMatch(/^cmd-/);
      expect(cmd.timestamp).toBeInstanceOf(Date);
    });

    test('creates command with metadata', () => {
      const cmd = createCommand('test', {}, { source: 'test' });
      expect(cmd.metadata).toEqual({ source: 'test' });
    });
  });
});
