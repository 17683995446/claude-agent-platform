// ============================================================================
// Tests for @claude-agent/strategy
// ============================================================================
import { describe, test, expect, beforeEach } from 'bun:test';
import { StrategyRegistry, CompositeStrategy, FallbackStrategy, ContextAwareStrategy } from '../packages/strategy/src/index.js';

describe('@claude-agent/strategy', () => {
  describe('StrategyRegistry', () => {
    let registry: StrategyRegistry<{ type: string }>;

    beforeEach(() => { registry = new StrategyRegistry(); });

    test('registers and resolves strategy', async () => {
      registry.register({ name: 'test', canHandle: (ctx) => ctx.type === 'test', execute: async (ctx) => 'handled' });
      const strategy = await registry.resolve({ type: 'test' });
      expect(strategy.name).toBe('test');
    });

    test('throws when no strategy can handle', async () => {
      registry.register({ name: 'test', canHandle: () => false, execute: async () => 'nope' });
      await expect(registry.resolve({ type: 'unknown' })).rejects.toThrow();
    });

    test('uses default strategy', async () => {
      registry.register({ name: 'default', canHandle: () => false, execute: async () => 'default' });
      registry.setDefault('default');
      const strategy = await registry.resolve({ type: 'anything' });
      expect(strategy.name).toBe('default');
    });

    test('executes strategy', async () => {
      registry.register({ name: 'echo', canHandle: () => true, execute: async (ctx) => ctx.type });
      const result = await registry.execute({ type: 'hello' });
      expect(result).toBe('hello');
    });

    test('lists strategies', () => {
      registry.register({ name: 'a', canHandle: () => false, execute: async () => null });
      registry.register({ name: 'b', canHandle: () => false, execute: async () => null });
      expect(registry.list()).toEqual(['a', 'b']);
    });

    test('unregisters strategy', () => {
      registry.register({ name: 'test', canHandle: () => false, execute: async () => null });
      registry.unregister('test');
      expect(registry.has('test')).toBe(false);
    });
  });

  describe('CompositeStrategy', () => {
    test('executes in sequence mode', async () => {
      const composite = new CompositeStrategy<{ type: string }, string>('seq', 'sequence');
      composite.add({ name: 'a', canHandle: () => true, execute: async () => 'first' });
      composite.add({ name: 'b', canHandle: () => true, execute: async () => 'second' });
      const result = await composite.execute({ type: 'test' });
      expect(result).toBe('second');
    });

    test('executes first applicable in first mode', async () => {
      const composite = new CompositeStrategy<{ type: string }, string>('first', 'first');
      composite.add({ name: 'a', canHandle: (ctx) => ctx.type === 'a', execute: async () => 'a-result' });
      composite.add({ name: 'b', canHandle: () => true, execute: async () => 'b-result' });
      const result = await composite.execute({ type: 'a' });
      expect(result).toBe('a-result');
    });

    test('throws when no strategy can handle', async () => {
      const composite = new CompositeStrategy('empty', 'sequence');
      await expect(composite.execute({ type: 'test' })).rejects.toThrow();
    });
  });

  describe('FallbackStrategy', () => {
    test('uses primary when it can handle', async () => {
      const fallback = new FallbackStrategy(
        'test',
        { name: 'primary', canHandle: () => true, execute: async () => 'primary' },
        { name: 'fallback', canHandle: () => true, execute: async () => 'fallback' },
      );
      const result = await fallback.execute({ type: 'test' });
      expect(result).toBe('primary');
    });

    test('falls back when primary fails', async () => {
      const fallback = new FallbackStrategy(
        'test',
        { name: 'primary', canHandle: () => true, execute: async () => { throw new Error('fail'); } },
        { name: 'fallback', canHandle: () => true, execute: async () => 'fallback' },
      );
      const result = await fallback.execute({ type: 'test' });
      expect(result).toBe('fallback');
    });
  });

  describe('ContextAwareStrategy', () => {
    test('handles matching context type', async () => {
      const strategy = new ContextAwareStrategy('json', 'json', async (ctx) => 'json-result');
      expect(strategy.canHandle({ type: 'json' })).toBe(true);
      expect(strategy.canHandle({ type: 'xml' })).toBe(false);
      const result = await strategy.execute({ type: 'json' });
      expect(result).toBe('json-result');
    });
  });
});
