// ============================================================================
// Integration Tests - Full Platform
// ============================================================================

import { describe, test, expect } from 'bun:test';
import ClaudeAgentApp from '../apps/claude-agent/src/index.js';

describe('Integration: ClaudeAgentApp', () => {
  test('creates app instance', () => {
    const app = new ClaudeAgentApp();
    expect(app).toBeDefined();
  });

  test('app has all components', () => {
    const app = new ClaudeAgentApp();
    expect(app.getAgent()).toBeDefined();
    expect(app.getPipelineEngine()).toBeDefined();
    expect(app.getPluginSystem()).toBeDefined();
    expect(app.getHealthServer()).toBeDefined();
  });

  test('app starts and stops successfully', async () => {
    const app = new ClaudeAgentApp();
    await app.start();
    expect(app.getAgent().isRunning()).toBe(true);
    await app.stop();
    expect(app.getAgent().isRunning()).toBe(false);
  });

  test('pipeline engine has built-in pipelines after start', async () => {
    const app = new ClaudeAgentApp();
    await app.start();
    const pipelines = app.getPipelineEngine().list();
    expect(pipelines).toContain('analyze');
    expect(pipelines).toContain('test');
    expect(pipelines).toContain('devops');
    await app.stop();
  });

  test('plugin system has all toolkit plugins after start', async () => {
    const app = new ClaudeAgentApp();
    await app.start();
    const plugins = app.getPluginSystem().list();
    expect(plugins).toContain('analyzer');
    expect(plugins).toContain('tester');
    expect(plugins).toContain('devops');
    expect(plugins).toContain('graph');
    expect(plugins).toContain('design');
    expect(plugins).toContain('monitor');
    await app.stop();
  });

  test('can execute analyze pipeline through app', async () => {
    const app = new ClaudeAgentApp();
    await app.start();
    const result = await app.getPipelineEngine().execute('analyze', { code: 'test' });
    expect(result.status).toBe('completed');
    expect(result.steps).toHaveLength(3);
    await app.stop();
  });

  test('can execute test pipeline through app', async () => {
    const app = new ClaudeAgentApp();
    await app.start();
    const result = await app.getPipelineEngine().execute('test', {});
    expect(result.status).toBe('completed');
    await app.stop();
  });

  test('can execute devops pipeline through app', async () => {
    const app = new ClaudeAgentApp();
    await app.start();
    const result = await app.getPipelineEngine().execute('devops', {});
    expect(result.status).toBe('completed');
    await app.stop();
  });

  test('health server has registered checks after start', async () => {
    const app = new ClaudeAgentApp();
    await app.start();
    const checks = app.getHealthServer().getRegistry().list();
    expect(checks).toContain('agent');
    expect(checks).toContain('plugins');
    expect(checks).toContain('memory');
    await app.stop();
  });

  test('health checks pass after start', async () => {
    const app = new ClaudeAgentApp();
    await app.start();
    const results = await app.getHealthServer().getRegistry().runAll();
    for (const check of results) {
      expect(check.status).toBe('healthy');
    }
    await app.stop();
  });

  test('CLI mode works', async () => {
    const app = new ClaudeAgentApp();
    const exitCode = await app.runCLI(['bun', 'cli', '--version']);
    expect(exitCode).toBe(0);
  });

  test('multiple start/stop cycles work', async () => {
    const app = new ClaudeAgentApp();
    await app.start();
    await app.stop();
    // Create a new app for second cycle since agent state persists
    const app2 = new ClaudeAgentApp();
    await app2.start();
    expect(app2.getAgent().isRunning()).toBe(true);
    await app2.stop();
  });
});
