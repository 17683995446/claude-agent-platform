// ============================================================================
// Tests for @claude-agent/http
// ============================================================================

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { HealthCheckRegistry, HealthServer } from '../packages/http/src/index.js';
import { HttpError } from '../packages/errors/src/index.js';
import { Logger } from '../packages/logger/src/index.js';
import { EventBus } from '../packages/core/src/index.js';

describe('@claude-agent/http', () => {
  describe('HealthCheckRegistry', () => {
    let registry: HealthCheckRegistry;

    beforeEach(() => {
      registry = new HealthCheckRegistry();
    });

    test('registers a health check', () => {
      registry.register('test', () => ({
        status: 'healthy',
        message: 'ok',
      }));
      expect(registry.list()).toContain('test');
    });

    test('unregisters a health check', () => {
      registry.register('test', () => ({ status: 'healthy' }));
      registry.unregister('test');
      expect(registry.list()).not.toContain('test');
    });

    test('runs a single health check', async () => {
      registry.register('test', () => ({
        status: 'healthy',
        message: 'all good',
      }));

      const result = await registry.run('test');
      expect(result.status).toBe('healthy');
      expect(result.message).toBe('all good');
    });

    test('throws for unknown health check', async () => {
      await expect(registry.run('unknown')).rejects.toThrow(HttpError);
    });

    test('runs all health checks', async () => {
      registry.register('check1', () => ({ status: 'healthy' }));
      registry.register('check2', () => ({ status: 'healthy' }));

      const results = await registry.runAll();
      expect(results).toHaveLength(2);
      expect(results[0]?.name).toBe('check1');
      expect(results[1]?.name).toBe('check2');
    });

    test('handles async health checks', async () => {
      registry.register('async', async () => {
        await new Promise((r) => setTimeout(r, 10));
        return { status: 'healthy' };
      });

      const result = await registry.run('async');
      expect(result.status).toBe('healthy');
    });

    test('handles failing health checks', async () => {
      registry.register('failing', () => {
        throw new Error('check failed');
      });

      const results = await registry.runAll();
      expect(results[0]?.status).toBe('unhealthy');
      expect(results[0]?.message).toBe('check failed');
    });

    test('includes duration in results', async () => {
      registry.register('timed', async () => {
        await new Promise((r) => setTimeout(r, 50));
        return { status: 'healthy' };
      });

      const results = await registry.runAll();
      expect(results[0]?.duration).toBeGreaterThanOrEqual(40);
    });
  });

  describe('HealthServer', () => {
    let server: HealthServer;
    let port: number;

    beforeEach(() => {
      port = 3000 + Math.floor(Math.random() * 1000);
      server = new HealthServer({
        logger: new Logger({ level: 'silent' }),
        eventBus: new EventBus(),
        port,
      });

      // Register some health checks
      server.getRegistry().register('test', () => ({ status: 'healthy' }));
    });

    afterEach(async () => {
      await server.stop();
    });

    test('starts and stops', async () => {
      server.start();
      expect(server.isReady()).toBe(true);
      await server.stop();
      expect(server.isReady()).toBe(false);
    });

    test('returns URL', () => {
      expect(server.getUrl()).toContain(`${port}`);
    });

    test('handles /health endpoint', async () => {
      server.start();
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.status).toBe('healthy');
      expect(data.checks).toBeDefined();
      expect(data.version).toBeDefined();
      expect(data.uptime).toBeDefined();
    });

    test('handles /ready endpoint', async () => {
      server.start();
      const response = await fetch(`http://127.0.0.1:${port}/ready`);
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.status).toBe('ready');
    });

    test('handles /metrics endpoint', async () => {
      server.start();
      const response = await fetch(`http://127.0.0.1:${port}/metrics`);
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.memoryUsage).toBeDefined();
      expect(data.uptime).toBeDefined();
    });

    test('returns 404 for unknown paths', async () => {
      server.start();
      const response = await fetch(`http://127.0.0.1:${port}/unknown`);
      expect(response.status).toBe(404);
    });

    test('health returns degraded when check is degraded', async () => {
      server.getRegistry().register('degraded', () => ({ status: 'degraded' }));
      server.start();
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      const data = await response.json();
      expect(data.status).toBe('degraded');
    });

    test('health returns unhealthy when check is unhealthy', async () => {
      server.getRegistry().register('sick', () => ({ status: 'unhealthy' }));
      server.start();
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      const data = await response.json();
      expect(data.status).toBe('unhealthy');
      expect(response.status).toBe(503);
    });

    test('start is idempotent', () => {
      server.start();
      server.start(); // Should not throw
      expect(server.isReady()).toBe(true);
    });

    test('stop is idempotent', async () => {
      await server.stop();
      await server.stop(); // Should not throw
      expect(server.isReady()).toBe(false);
    });
  });
});
