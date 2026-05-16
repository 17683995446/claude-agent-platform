// ============================================================================
// Tests for @claude-agent/core
// ============================================================================

import { describe, test, expect, beforeEach } from 'bun:test';
import { AgentCore, EventBus, LifecycleManagerImpl, generateAgentId, generateTaskId } from '../packages/core/src/index.js';
import { LifecycleError } from '../packages/errors/src/index.js';
import { Logger } from '../packages/logger/src/index.js';

describe('@claude-agent/core', () => {
  describe('EventBus', () => {
    let bus: EventBus;

    beforeEach(() => {
      bus = new EventBus();
    });

    test('emits and receives events', () => {
      const received: any[] = [];
      bus.on('agent.started', (event) => {
        received.push(event);
      });

      bus.emit({
        type: 'agent.started',
        timestamp: new Date(),
        data: { agentId: 'test' },
      });

      expect(received).toHaveLength(1);
      expect(received[0]?.type).toBe('agent.started');
    });

    test('supports multiple listeners', () => {
      const received1: any[] = [];
      const received2: any[] = [];

      bus.on('agent.started', (e) => received1.push(e));
      bus.on('agent.started', (e) => received2.push(e));

      bus.emit({
        type: 'agent.started',
        timestamp: new Date(),
        data: {},
      });

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
    });

    test('off removes listener', () => {
      const received: any[] = [];
      const handler = (event: any) => received.push(event);
      bus.on('agent.started', handler);
      bus.off('agent.started', handler);

      bus.emit({
        type: 'agent.started',
        timestamp: new Date(),
        data: {},
      });

      expect(received).toHaveLength(0);
    });

    test('once fires only once', () => {
      const received: any[] = [];
      bus.once('agent.started', (e) => received.push(e));

      bus.emit({ type: 'agent.started', timestamp: new Date(), data: {} });
      bus.emit({ type: 'agent.started', timestamp: new Date(), data: {} });

      expect(received).toHaveLength(1);
    });

    test('removeAllListeners removes all for specific type', () => {
      const received: any[] = [];
      bus.on('agent.started', (e) => received.push(e));
      bus.on('agent.started', (e) => received.push(e));

      bus.removeAllListeners('agent.started');

      bus.emit({ type: 'agent.started', timestamp: new Date(), data: {} });
      expect(received).toHaveLength(0);
    });

    test('removeAllListeners removes all when no type specified', () => {
      const received: any[] = [];
      bus.on('agent.started', (e) => received.push(e));
      bus.on('agent.stopped', (e) => received.push(e));

      bus.removeAllListeners();

      bus.emit({ type: 'agent.started', timestamp: new Date(), data: {} });
      bus.emit({ type: 'agent.stopped', timestamp: new Date(), data: {} });
      expect(received).toHaveLength(0);
    });

    test('listenerCount returns correct count', () => {
      expect(bus.listenerCount('agent.started')).toBe(0);
      bus.on('agent.started', () => {});
      expect(bus.listenerCount('agent.started')).toBe(1);
      bus.on('agent.started', () => {});
      expect(bus.listenerCount('agent.started')).toBe(2);
    });

    test('handles async handlers', async () => {
      const received: any[] = [];
      bus.on('agent.started', async (e) => {
        await new Promise((r) => setTimeout(r, 10));
        received.push(e);
      });

      bus.emit({
        type: 'agent.started',
        timestamp: new Date(),
        data: {},
      });

      // Wait for async handler
      await new Promise((r) => setTimeout(r, 50));
      expect(received).toHaveLength(1);
    });

    test('handles handler errors gracefully', () => {
      bus.on('agent.started', () => {
        throw new Error('handler error');
      });

      // Should not throw
      expect(() => {
        bus.emit({
          type: 'agent.started',
          timestamp: new Date(),
          data: {},
        });
      }).not.toThrow();
    });
  });

  describe('generateAgentId', () => {
    test('generates unique IDs', () => {
      const id1 = generateAgentId();
      const id2 = generateAgentId();
      expect(id1).not.toBe(id2);
    });

    test('generates string IDs with agent prefix', () => {
      const id = generateAgentId();
      expect(typeof id).toBe('string');
      expect(id.startsWith('agent-')).toBe(true);
    });
  });

  describe('generateTaskId', () => {
    test('generates unique IDs', () => {
      const id1 = generateTaskId();
      const id2 = generateTaskId();
      expect(id1).not.toBe(id2);
    });

    test('generates string IDs with task prefix', () => {
      const id = generateTaskId();
      expect(typeof id).toBe('string');
      expect(id.startsWith('task-')).toBe(true);
    });
  });

  describe('AgentCore', () => {
    let agent: AgentCore;

    beforeEach(() => {
      agent = new AgentCore({ name: 'test-agent' });
    });

    test('creates with correct name', () => {
      expect(agent.name).toBe('test-agent');
    });

    test('initial status is idle', () => {
      expect(agent.getStatus()).toBe('idle');
    });

    test('starts successfully', async () => {
      await agent.start();
      expect(agent.getStatus()).toBe('running');
      expect(agent.isRunning()).toBe(true);
    });

    test('stops successfully', async () => {
      await agent.start();
      await agent.stop();
      expect(agent.getStatus()).toBe('stopped');
      expect(agent.isRunning()).toBe(false);
    });

    test('start throws when already running', async () => {
      await agent.start();
      await expect(agent.start()).rejects.toThrow(LifecycleError);
    });

    test('stop is idempotent', async () => {
      await agent.stop();
      await agent.stop(); // Should not throw
      expect(agent.isRunning()).toBe(false);
    });

    test('uptime returns 0 when not started', () => {
      expect(agent.getUptime()).toBe(0);
    });

    test('uptime returns positive value when running', async () => {
      await agent.start();
      await new Promise((r) => setTimeout(r, 10));
      expect(agent.getUptime()).toBeGreaterThan(0);
    });

    test('emit sends event through event bus', async () => {
      await agent.start();
      const received: any[] = [];
      agent.getEventBus().on('agent.custom', (e) => received.push(e));
      agent.emit('agent.custom' as any, { key: 'value' });
      expect(received).toHaveLength(1);
    });

    test('onShutdown registers callback', async () => {
      let called = false;
      agent.onShutdown(() => { called = true; });
      await agent.start();
      await agent.stop();
      expect(called).toBe(true);
    });
  });
});
