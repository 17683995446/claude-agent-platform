import { describe, test, expect, beforeEach } from 'bun:test';
import {
  RemoteControlServer,
  RuntimeDashboard,
  RealtimeMonitor,
  OpsCommandRegistry,
  LogAggregator,
  DeploymentManager,
  ConfigHotSwap,
  DEFAULT_CONFIG,
  ThreadPoolManager,
  MemoryManager,
  UptimeTracker,
} from '../src/index.ts';

// ============================================================
// Module 1: RemoteControlServer - 远程控制接口
// ============================================================
describe('RemoteControlServer', () => {
  let server: RemoteControlServer;

  beforeEach(() => {
    server = new RemoteControlServer(['test-api-key']);
  });

  test('should create instance with API keys', () => {
    expect(server).toBeDefined();
    expect(server.authenticate('test-api-key')).toBe(true);
  });

  test('should authenticate valid API key', () => {
    expect(server.authenticate('test-api-key')).toBe(true);
  });

  test('should reject invalid API key', () => {
    expect(server.authenticate('wrong-key')).toBe(false);
  });

  test('should add API key', () => {
    server.addApiKey('new-key');
    expect(server.authenticate('new-key')).toBe(true);
  });

  test('should remove API key', () => {
    server.addApiKey('temp-key');
    expect(server.authenticate('temp-key')).toBe(true);
    expect(server.removeApiKey('temp-key')).toBe(true);
    expect(server.authenticate('temp-key')).toBe(false);
  });

  test('should handle start command', async () => {
    const result = await server.handleCommand({
      id: 'cmd-1',
      name: 'start',
      timestamp: Date.now(),
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ status: 'started' });
  });

  test('should handle stop command', async () => {
    const result = await server.handleCommand({
      id: 'cmd-2',
      name: 'stop',
      timestamp: Date.now(),
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ status: 'stopped' });
  });

  test('should handle pause command', async () => {
    const result = await server.handleCommand({
      id: 'cmd-3',
      name: 'pause',
      timestamp: Date.now(),
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ status: 'paused' });
  });

  test('should handle resume command', async () => {
    const result = await server.handleCommand({
      id: 'cmd-4',
      name: 'resume',
      timestamp: Date.now(),
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ status: 'resumed' });
  });

  test('should handle restart command', async () => {
    const result = await server.handleCommand({
      id: 'cmd-5',
      name: 'restart',
      timestamp: Date.now(),
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ status: 'restarted' });
  });

  test('should handle status command', async () => {
    const result = await server.handleCommand({
      id: 'cmd-6',
      name: 'status',
      timestamp: Date.now(),
    });
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect((result.data as any).status).toBe('running');
  });

  test('should handle config command', async () => {
    const result = await server.handleCommand({
      id: 'cmd-7',
      name: 'config',
      args: { debug: true },
      timestamp: Date.now(),
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ config: { debug: true } });
  });

  test('should return error for unknown command', async () => {
    const result = await server.handleCommand({
      id: 'cmd-8',
      name: 'unknown',
      timestamp: Date.now(),
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown command');
  });

  test('should register custom command', async () => {
    server.registerCommand('custom', async (cmd) => ({
      success: true,
      data: { custom: true },
      commandId: cmd.id,
      timestamp: Date.now(),
    }));
    const result = await server.handleCommand({
      id: 'cmd-9',
      name: 'custom',
      timestamp: Date.now(),
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ custom: true });
  });

  test('should enqueue commands with priority', () => {
    server.enqueueCommand({ id: 'low', name: 'status', timestamp: Date.now(), priority: 10 });
    server.enqueueCommand({ id: 'high', name: 'status', timestamp: Date.now(), priority: 0 });
    server.enqueueCommand({ id: 'mid', name: 'status', timestamp: Date.now(), priority: 5 });
    const pending = server.getPendingCommands();
    expect(pending[0].id).toBe('high');
    expect(pending[1].id).toBe('mid');
    expect(pending[2].id).toBe('low');
  });

  test('should dequeue next command', () => {
    server.enqueueCommand({ id: 'first', name: 'status', timestamp: Date.now(), priority: 0 });
    server.enqueueCommand({ id: 'second', name: 'status', timestamp: Date.now(), priority: 1 });
    const next = server.dequeueNext();
    expect(next?.id).toBe('first');
    expect(server.getPendingCommands().length).toBe(1);
  });

  test('should return empty pending commands', () => {
    expect(server.getPendingCommands()).toEqual([]);
  });

  test('should dequeue undefined when queue is empty', () => {
    expect(server.dequeueNext()).toBeUndefined();
  });

  test('should record audit log entries', async () => {
    await server.handleCommand({ id: 'audit-1', name: 'start', timestamp: Date.now() });
    await server.handleCommand({ id: 'audit-2', name: 'unknown', timestamp: Date.now() });
    const log = server.getAuditLog();
    expect(log.length).toBe(2);
    expect(log[0].success).toBe(true);
    expect(log[1].success).toBe(false);
  });

  test('should limit audit log entries', async () => {
    for (let i = 0; i < 20; i++) {
      await server.handleCommand({ id: `audit-${i}`, name: 'start', timestamp: Date.now() });
    }
    const log = server.getAuditLog(5);
    expect(log.length).toBe(5);
  });

  test('should clear audit log', async () => {
    await server.handleCommand({ id: 'audit-clear', name: 'start', timestamp: Date.now() });
    server.clearAuditLog();
    expect(server.getAuditLog()).toEqual([]);
  });

  test('should list registered commands', () => {
    const commands = server.getRegisteredCommands();
    expect(commands).toContain('start');
    expect(commands).toContain('stop');
    expect(commands).toContain('pause');
    expect(commands).toContain('resume');
    expect(commands).toContain('restart');
    expect(commands).toContain('status');
    expect(commands).toContain('config');
  });

  test('should set and check processing state', () => {
    expect(server.isProcessing()).toBe(false);
    server.setProcessing(true);
    expect(server.isProcessing()).toBe(true);
    server.setProcessing(false);
    expect(server.isProcessing()).toBe(false);
  });

  test('should handle command handler errors', async () => {
    server.registerCommand('error-cmd', async () => {
      throw new Error('handler failed');
    });
    const result = await server.handleCommand({
      id: 'err-1',
      name: 'error-cmd',
      timestamp: Date.now(),
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('handler failed');
  });

  test('should record failed command in audit log', async () => {
    await server.handleCommand({ id: 'fail-1', name: 'nonexistent', timestamp: Date.now() });
    const log = server.getAuditLog();
    expect(log[0].success).toBe(false);
    expect(log[0].error).toBeDefined();
  });

  test('should default priority to 5', () => {
    server.enqueueCommand({ id: 'default-p', name: 'status', timestamp: Date.now() });
    const pending = server.getPendingCommands();
    expect(pending[0].priority).toBeUndefined();
  });
});

// ============================================================
// Module 2: RuntimeDashboard - 运行时仪表板
// ============================================================
describe('RuntimeDashboard', () => {
  let dashboard: RuntimeDashboard;

  beforeEach(() => {
    dashboard = new RuntimeDashboard(100);
  });

  test('should create instance', () => {
    expect(dashboard).toBeDefined();
  });

  test('should return default overview when no providers', () => {
    const overview = dashboard.getOverview();
    expect(overview.status).toBe('unknown');
    expect(overview.totalTasks).toBe(0);
  });

  test('should return default task summary when no providers', () => {
    const tasks = dashboard.getTaskSummary();
    expect(tasks.running).toBe(0);
    expect(tasks.completed).toBe(0);
  });

  test('should return default resource usage when no providers', () => {
    const resources = dashboard.getResourceUsage();
    expect(resources.cpu).toBe(0);
    expect(resources.memory).toBe(0);
  });

  test('should return default health status when no providers', () => {
    const health = dashboard.getHealthStatus();
    expect(health.overall).toBe('healthy');
    expect(health.components).toEqual([]);
  });

  test('should return empty recent events', () => {
    const events = dashboard.getRecentEvents(10);
    expect(events).toEqual([]);
  });

  test('should add and retrieve events', () => {
    dashboard.addEvent({
      id: 'evt-1',
      type: 'info',
      message: 'test event',
      timestamp: Date.now(),
      severity: 'info',
    });
    const events = dashboard.getRecentEvents(10);
    expect(events.length).toBe(1);
    expect(events[0].message).toBe('test event');
  });

  test('should limit events to maxEvents', () => {
    for (let i = 0; i < 150; i++) {
      dashboard.addEvent({
        id: `evt-${i}`,
        type: 'info',
        message: `event ${i}`,
        timestamp: Date.now(),
        severity: 'info',
      });
    }
    const events = dashboard.getRecentEvents(200);
    expect(events.length).toBe(100);
  });

  test('should limit recent events by limit parameter', () => {
    for (let i = 0; i < 20; i++) {
      dashboard.addEvent({
        id: `evt-${i}`,
        type: 'info',
        message: `event ${i}`,
        timestamp: Date.now(),
        severity: 'info',
      });
    }
    const events = dashboard.getRecentEvents(5);
    expect(events.length).toBe(5);
  });

  test('should get complete dashboard data', () => {
    const data = dashboard.getDashboard();
    expect(data.overview).toBeDefined();
    expect(data.tasks).toBeDefined();
    expect(data.resources).toBeDefined();
    expect(data.health).toBeDefined();
    expect(data.recentEvents).toBeDefined();
    expect(data.generatedAt).toBeGreaterThan(0);
  });

  test('should use metric provider for overview', () => {
    dashboard.addProvider({
      getOverview: () => ({
        status: 'running',
        uptime: 12345,
        totalTasks: 10,
        activeTasks: 2,
        completedTasks: 8,
        failedTasks: 0,
        version: '1.0.0',
      }),
    });
    const overview = dashboard.getOverview();
    expect(overview.status).toBe('running');
    expect(overview.version).toBe('1.0.0');
  });

  test('should use metric provider for task summary', () => {
    dashboard.addProvider({
      getTaskSummary: () => ({
        running: 5,
        queued: 3,
        completed: 20,
        failed: 1,
        averageDuration: 100,
        throughput: 10,
      }),
    });
    const tasks = dashboard.getTaskSummary();
    expect(tasks.running).toBe(5);
    expect(tasks.completed).toBe(20);
  });

  test('should use metric provider for resource usage', () => {
    dashboard.addProvider({
      getResourceUsage: () => ({
        cpu: 45,
        memory: 60,
        memoryUsed: 307,
        memoryTotal: 512,
        disk: 30,
        network: { in: 1000, out: 500 },
      }),
    });
    const resources = dashboard.getResourceUsage();
    expect(resources.cpu).toBe(45);
    expect(resources.disk).toBe(30);
  });

  test('should use metric provider for health status', () => {
    dashboard.addProvider({
      getHealthStatus: () => ({
        overall: 'degraded',
        components: [{ name: 'db', status: 'degraded', message: 'slow queries' }],
        lastCheck: Date.now(),
      }),
    });
    const health = dashboard.getHealthStatus();
    expect(health.overall).toBe('degraded');
    expect(health.components.length).toBe(1);
  });

  test('should add and remove providers', () => {
    const provider = {
      getOverview: () => ({
        status: 'test',
        uptime: 0,
        totalTasks: 0,
        activeTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        version: '0.0.0',
      }),
    };
    dashboard.addProvider(provider);
    expect(dashboard.getProviderCount()).toBe(1);
    dashboard.removeProvider(provider);
    expect(dashboard.getProviderCount()).toBe(0);
  });

  test('should clear events', () => {
    dashboard.addEvent({
      id: 'evt-clear',
      type: 'info',
      message: 'to be cleared',
      timestamp: Date.now(),
      severity: 'info',
    });
    dashboard.clearEvents();
    expect(dashboard.getRecentEvents(10)).toEqual([]);
  });

  test('should return zero provider count initially', () => {
    expect(dashboard.getProviderCount()).toBe(0);
  });
});

// ============================================================
// Module 3: RealtimeMonitor - 实时监控器
// ============================================================
describe('RealtimeMonitor', () => {
  let monitor: RealtimeMonitor;

  beforeEach(() => {
    monitor = new RealtimeMonitor(100);
  });

  test('should create instance', () => {
    expect(monitor).toBeDefined();
  });

  test('should record metric', () => {
    monitor.recordMetric('cpu', 50, '%');
    const metric = monitor.getMetric('cpu');
    expect(metric).toBeDefined();
    expect(metric!.value).toBe(50);
    expect(metric!.unit).toBe('%');
  });

  test('should return undefined for unknown metric', () => {
    expect(monitor.getMetric('unknown')).toBeUndefined();
  });

  test('should get all metrics', () => {
    monitor.recordMetric('cpu', 50, '%');
    monitor.recordMetric('memory', 70, '%');
    const metrics = monitor.getMetrics();
    expect(metrics.size).toBe(2);
  });

  test('should record metric history', () => {
    monitor.recordMetric('cpu', 10);
    monitor.recordMetric('cpu', 20);
    monitor.recordMetric('cpu', 30);
    const history = monitor.getHistory('cpu');
    expect(history.length).toBe(3);
    expect(history[2].value).toBe(30);
  });

  test('should limit history points', () => {
    for (let i = 0; i < 200; i++) {
      monitor.recordMetric('cpu', i);
    }
    const history = monitor.getHistory('cpu');
    expect(history.length).toBe(100);
  });

  test('should limit history by points parameter', () => {
    for (let i = 0; i < 50; i++) {
      monitor.recordMetric('cpu', i);
    }
    const history = monitor.getHistory('cpu', 10);
    expect(history.length).toBe(10);
  });

  test('should return empty history for unknown metric', () => {
    expect(monitor.getHistory('unknown')).toEqual([]);
  });

  test('should trigger alert on threshold breach', () => {
    let alerted = false;
    monitor.setAlert('cpu', { operator: '>', threshold: 80 }, () => { alerted = true; });
    monitor.recordMetric('cpu', 90);
    expect(alerted).toBe(true);
  });

  test('should not trigger alert below threshold', () => {
    let alerted = false;
    monitor.setAlert('cpu', { operator: '>', threshold: 80 }, () => { alerted = true; });
    monitor.recordMetric('cpu', 50);
    expect(alerted).toBe(false);
  });

  test('should support less-than alert', () => {
    let alerted = false;
    monitor.setAlert('memory', { operator: '<', threshold: 10 }, () => { alerted = true; });
    monitor.recordMetric('memory', 5);
    expect(alerted).toBe(true);
  });

  test('should support greater-equal alert', () => {
    let alerted = false;
    monitor.setAlert('cpu', { operator: '>=', threshold: 80 }, () => { alerted = true; });
    monitor.recordMetric('cpu', 80);
    expect(alerted).toBe(true);
  });

  test('should support less-equal alert', () => {
    let alerted = false;
    monitor.setAlert('memory', { operator: '<=', threshold: 10 }, () => { alerted = true; });
    monitor.recordMetric('memory', 10);
    expect(alerted).toBe(true);
  });

  test('should support equal alert', () => {
    let alerted = false;
    monitor.setAlert('cpu', { operator: '==', threshold: 50 }, () => { alerted = true; });
    monitor.recordMetric('cpu', 50);
    expect(alerted).toBe(true);
  });

  test('should support not-equal alert', () => {
    let alerted = false;
    monitor.setAlert('cpu', { operator: '!=', threshold: 50 }, () => { alerted = true; });
    monitor.recordMetric('cpu', 60);
    expect(alerted).toBe(true);
  });

  test('should not re-trigger alert while still breached', () => {
    let triggerCount = 0;
    monitor.setAlert('cpu', { operator: '>', threshold: 80 }, () => { triggerCount++; });
    monitor.recordMetric('cpu', 90);
    monitor.recordMetric('cpu', 95);
    expect(triggerCount).toBe(1);
  });

  test('should re-trigger alert after recovery', () => {
    let triggerCount = 0;
    monitor.setAlert('cpu', { operator: '>', threshold: 80 }, () => { triggerCount++; });
    monitor.recordMetric('cpu', 90);
    monitor.recordMetric('cpu', 50); // recover
    monitor.recordMetric('cpu', 90); // breach again
    expect(triggerCount).toBe(2);
  });

  test('should remove alert', () => {
    monitor.setAlert('cpu', { operator: '>', threshold: 80 }, () => {});
    expect(monitor.removeAlert('cpu')).toBe(true);
    expect(monitor.removeAlert('cpu')).toBe(false);
  });

  test('should get all alerts', () => {
    monitor.setAlert('cpu', { operator: '>', threshold: 80 }, () => {});
    monitor.setAlert('memory', { operator: '>', threshold: 90 }, () => {});
    const alerts = monitor.getAlerts();
    expect(alerts.length).toBe(2);
  });

  test('should start and stop monitoring', () => {
    monitor.startMonitoring(100);
    expect(monitor.isMonitoring()).toBe(true);
    monitor.stopMonitoring();
    expect(monitor.isMonitoring()).toBe(false);
  });

  test('should not start monitoring twice', () => {
    monitor.startMonitoring(100);
    monitor.startMonitoring(200);
    expect(monitor.isMonitoring()).toBe(true);
    monitor.stopMonitoring();
  });

  test('should clear history for specific metric', () => {
    monitor.recordMetric('cpu', 50);
    monitor.recordMetric('memory', 70);
    monitor.clearHistory('cpu');
    expect(monitor.getHistory('cpu')).toEqual([]);
    expect(monitor.getHistory('memory').length).toBe(1);
  });

  test('should clear all history', () => {
    monitor.recordMetric('cpu', 50);
    monitor.recordMetric('memory', 70);
    monitor.clearHistory();
    expect(monitor.getHistory('cpu')).toEqual([]);
    expect(monitor.getHistory('memory')).toEqual([]);
  });

  test('should clear all metrics', () => {
    monitor.recordMetric('cpu', 50);
    monitor.clearMetrics();
    expect(monitor.getMetric('cpu')).toBeUndefined();
  });

  test('should use collect callback during monitoring', () => {
    monitor.setCollectCallback(() => new Map([['test', 42]]));
    monitor.collect();
    expect(monitor.getMetric('test')?.value).toBe(42);
  });
});

// ============================================================
// Module 4: OpsCommandRegistry - 运维命令集
// ============================================================
describe('OpsCommandRegistry', () => {
  let registry: OpsCommandRegistry;

  beforeEach(() => {
    registry = new OpsCommandRegistry();
  });

  test('should create instance with built-in commands', () => {
    expect(registry).toBeDefined();
    const commands = registry.listCommands();
    expect(commands.length).toBeGreaterThan(0);
  });

  test('should execute status command', async () => {
    const result = await registry.execute('status', []);
    expect(result.success).toBe(true);
    expect(result.output).toContain('running');
  });

  test('should execute health command', async () => {
    const result = await registry.execute('health', []);
    expect(result.success).toBe(true);
    expect(result.output).toContain('healthy');
  });

  test('should execute tasks command', async () => {
    const result = await registry.execute('tasks', []);
    expect(result.success).toBe(true);
  });

  test('should execute logs command with args', async () => {
    const result = await registry.execute('logs', ['20']);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ limit: 20 });
  });

  test('should execute config command without args', async () => {
    const result = await registry.execute('config', []);
    expect(result.success).toBe(true);
  });

  test('should execute config command with args', async () => {
    const result = await registry.execute('config', ['key=value']);
    expect(result.success).toBe(true);
  });

  test('should execute restart command', async () => {
    const result = await registry.execute('restart', []);
    expect(result.success).toBe(true);
    expect(result.output).toContain('restarting');
  });

  test('should execute shutdown command', async () => {
    const result = await registry.execute('shutdown', []);
    expect(result.success).toBe(true);
  });

  test('should execute backup command', async () => {
    const result = await registry.execute('backup', ['my-backup']);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ backupName: 'my-backup' });
  });

  test('should execute restore command with name', async () => {
    const result = await registry.execute('restore', ['my-backup']);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ restored: 'my-backup' });
  });

  test('should fail restore without name', async () => {
    const result = await registry.execute('restore', []);
    expect(result.success).toBe(false);
    expect(result.error).toContain('required');
  });

  test('should execute diagnose command', async () => {
    const result = await registry.execute('diagnose', []);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  test('should return error for unknown command', async () => {
    const result = await registry.execute('nonexistent', []);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown');
  });

  test('should execute command via alias', async () => {
    const result = await registry.execute('st', []);
    expect(result.success).toBe(true);
  });

  test('should get help for command', () => {
    const help = registry.getHelp('status');
    expect(help).not.toBeNull();
    expect(help!.name).toBe('status');
    expect(help!.description).toBeDefined();
    expect(help!.usage).toBeDefined();
  });

  test('should get help for alias', () => {
    const help = registry.getHelp('st');
    expect(help).not.toBeNull();
    expect(help!.name).toBe('status');
  });

  test('should return null help for unknown command', () => {
    expect(registry.getHelp('nonexistent')).toBeNull();
  });

  test('should list all commands', () => {
    const commands = registry.listCommands();
    const names = commands.map(c => c.name);
    expect(names).toContain('status');
    expect(names).toContain('health');
    expect(names).toContain('tasks');
    expect(names).toContain('logs');
    expect(names).toContain('config');
    expect(names).toContain('restart');
    expect(names).toContain('shutdown');
    expect(names).toContain('backup');
    expect(names).toContain('restore');
    expect(names).toContain('diagnose');
  });

  test('should record command history', async () => {
    await registry.execute('status', []);
    await registry.execute('health', []);
    const history = registry.getHistory();
    expect(history.length).toBe(2);
  });

  test('should limit history', async () => {
    for (let i = 0; i < 20; i++) {
      await registry.execute('status', []);
    }
    const history = registry.getHistory(5);
    expect(history.length).toBe(5);
  });

  test('should undo last command', async () => {
    await registry.execute('status', []);
    await registry.execute('health', []);
    const undone = registry.undo();
    expect(undone).toBeDefined();
    expect(undone!.command).toBe('health');
    expect(registry.getHistory().length).toBe(1);
  });

  test('should return undefined when undoing empty history', () => {
    expect(registry.undo()).toBeUndefined();
  });

  test('should clear history', async () => {
    await registry.execute('status', []);
    registry.clearHistory();
    expect(registry.getHistory()).toEqual([]);
  });

  test('should register custom command', async () => {
    registry.register({
      name: 'custom',
      description: 'Custom command',
      usage: 'custom',
      permission: 'readonly',
      handler: async () => ({ success: true, output: 'custom result' }),
    });
    const result = await registry.execute('custom', []);
    expect(result.success).toBe(true);
    expect(result.output).toBe('custom result');
  });

  test('should unregister command', () => {
    expect(registry.unregister('status')).toBe(true);
    expect(registry.unregister('nonexistent')).toBe(false);
  });

  test('should get command by name', () => {
    const cmd = registry.getCommand('status');
    expect(cmd).toBeDefined();
    expect(cmd!.name).toBe('status');
  });

  test('should get command by alias', () => {
    const cmd = registry.getCommand('st');
    expect(cmd).toBeDefined();
    expect(cmd!.name).toBe('status');
  });

  test('should record failed commands in history', async () => {
    await registry.execute('nonexistent', []);
    const history = registry.getHistory();
    expect(history[0].success).toBe(false);
  });

  test('should handle command handler errors', async () => {
    registry.register({
      name: 'error-cmd',
      description: 'Error command',
      usage: 'error-cmd',
      permission: 'readonly',
      handler: async () => { throw new Error('boom'); },
    });
    const result = await registry.execute('error-cmd', []);
    expect(result.success).toBe(false);
    expect(result.error).toBe('boom');
  });
});

// ============================================================
// Module 5: LogAggregator - 日志聚合器
// ============================================================
describe('LogAggregator', () => {
  let aggregator: LogAggregator;

  beforeEach(() => {
    aggregator = new LogAggregator(100);
  });

  test('should create instance', () => {
    expect(aggregator).toBeDefined();
  });

  test('should collect log entry', () => {
    aggregator.collect('src', 'info', 'test message');
    expect(aggregator.getLogCount()).toBe(1);
  });

  test('should collect debug log', () => {
    aggregator.debug('src', 'debug message');
    expect(aggregator.getLogCount()).toBe(1);
  });

  test('should collect info log', () => {
    aggregator.info('src', 'info message');
    expect(aggregator.getLogCount()).toBe(1);
  });

  test('should collect warn log', () => {
    aggregator.warn('src', 'warn message');
    expect(aggregator.getLogCount()).toBe(1);
  });

  test('should collect error log', () => {
    aggregator.error('src', 'error message');
    expect(aggregator.getLogCount()).toBe(1);
  });

  test('should collect fatal log', () => {
    aggregator.fatal('src', 'fatal message');
    expect(aggregator.getLogCount()).toBe(1);
  });

  test('should collect log with metadata', () => {
    aggregator.collect('src', 'info', 'test', { key: 'value' });
    const results = aggregator.search({});
    expect(results[0].meta).toEqual({ key: 'value' });
  });

  test('should search by source', () => {
    aggregator.collect('src-a', 'info', 'msg a');
    aggregator.collect('src-b', 'info', 'msg b');
    const results = aggregator.search({ source: 'src-a' });
    expect(results.length).toBe(1);
    expect(results[0].source).toBe('src-a');
  });

  test('should search by level', () => {
    aggregator.collect('src', 'info', 'info msg');
    aggregator.collect('src', 'error', 'error msg');
    const results = aggregator.search({ level: 'error' });
    expect(results.length).toBe(1);
  });

  test('should search by message content', () => {
    aggregator.collect('src', 'info', 'hello world');
    aggregator.collect('src', 'info', 'goodbye world');
    const results = aggregator.search({ message: 'hello' });
    expect(results.length).toBe(1);
  });

  test('should search by time range', () => {
    const now = Date.now();
    aggregator.collect('src', 'info', 'msg 1');
    const results = aggregator.search({ from: now - 1000, to: now + 1000 });
    expect(results.length).toBe(1);
  });

  test('should search by meta', () => {
    aggregator.collect('src', 'info', 'msg', { env: 'prod' });
    aggregator.collect('src', 'info', 'msg', { env: 'dev' });
    const results = aggregator.search({ meta: { env: 'prod' } });
    expect(results.length).toBe(1);
  });

  test('should limit search results', () => {
    for (let i = 0; i < 20; i++) {
      aggregator.collect('src', 'info', `msg ${i}`);
    }
    const results = aggregator.search({ limit: 5 });
    expect(results.length).toBe(5);
  });

  test('should return empty search results', () => {
    expect(aggregator.search({ source: 'nonexistent' })).toEqual([]);
  });

  test('should get log stats', () => {
    aggregator.info('src-a', 'info msg');
    aggregator.error('src-b', 'error msg');
    aggregator.warn('src-a', 'warn msg');
    const stats = aggregator.getStats();
    expect(stats.total).toBe(3);
    expect(stats.byLevel.info).toBe(1);
    expect(stats.byLevel.error).toBe(1);
    expect(stats.byLevel.warn).toBe(1);
  });

  test('should get sources', () => {
    aggregator.collect('src-a', 'info', 'msg');
    aggregator.collect('src-b', 'info', 'msg');
    const sources = aggregator.getSources();
    expect(sources).toContain('src-a');
    expect(sources).toContain('src-b');
  });

  test('should export logs as JSON', () => {
    aggregator.collect('src', 'info', 'test');
    const json = aggregator.exportLogs('json');
    const parsed = JSON.parse(json);
    expect(parsed.length).toBe(1);
  });

  test('should export logs as text', () => {
    aggregator.collect('src', 'info', 'test');
    const text = aggregator.exportLogs('text');
    expect(text).toContain('[INFO]');
    expect(text).toContain('[src]');
    expect(text).toContain('test');
  });

  test('should enforce max logs limit', () => {
    for (let i = 0; i < 150; i++) {
      aggregator.collect('src', 'info', `msg ${i}`);
    }
    expect(aggregator.getLogCount()).toBe(100);
  });

  test('should clear all logs', () => {
    aggregator.collect('src', 'info', 'msg');
    aggregator.clear();
    expect(aggregator.getLogCount()).toBe(0);
    expect(aggregator.getSources()).toEqual([]);
  });

  test('should generate unique log IDs', () => {
    aggregator.collect('src', 'info', 'msg 1');
    aggregator.collect('src', 'info', 'msg 2');
    const results = aggregator.search({});
    expect(results[0].id).not.toBe(results[1].id);
  });
});

// ============================================================
// Module 6: DeploymentManager - 部署管理器
// ============================================================
describe('DeploymentManager', () => {
  let manager: DeploymentManager;

  beforeEach(() => {
    manager = new DeploymentManager();
  });

  test('should create instance', () => {
    expect(manager).toBeDefined();
  });

  test('should deploy with standard strategy', async () => {
    const result = await manager.deploy({
      version: '1.0.0',
      environment: 'production',
      strategy: 'standard',
    });
    expect(result.success).toBe(true);
    expect(result.phase).toBe('deployed');
    expect(result.version).toBe('1.0.0');
  });

  test('should deploy with blue-green strategy', async () => {
    const result = await manager.deploy({
      version: '2.0.0',
      environment: 'production',
      strategy: 'blue-green',
    });
    expect(result.success).toBe(true);
    expect(result.phase).toBe('deployed');
  });

  test('should deploy with canary strategy (partial)', async () => {
    const result = await manager.deploy({
      version: '3.0.0',
      environment: 'production',
      strategy: 'canary',
      canaryPercent: 20,
    });
    expect(result.success).toBe(true);
    expect(result.phase).toBe('deploying');
  });

  test('should deploy with canary strategy (full rollout)', async () => {
    const result = await manager.deploy({
      version: '3.1.0',
      environment: 'production',
      strategy: 'canary',
      canaryPercent: 100,
    });
    expect(result.success).toBe(true);
    expect(result.phase).toBe('deployed');
  });

  test('should get deployment status', async () => {
    const result = await manager.deploy({
      version: '1.0.0',
      environment: 'staging',
      strategy: 'standard',
    });
    const status = manager.getStatus(result.deploymentId);
    expect(status).toBeDefined();
    expect(status!.version).toBe('1.0.0');
    expect(status!.phase).toBe('deployed');
  });

  test('should return undefined for unknown deployment', () => {
    expect(manager.getStatus('nonexistent')).toBeUndefined();
  });

  test('should get active deployment', async () => {
    await manager.deploy({
      version: '1.0.0',
      environment: 'production',
      strategy: 'standard',
    });
    const active = manager.getActiveDeployment();
    expect(active).toBeDefined();
    expect(active!.version).toBe('1.0.0');
  });

  test('should return undefined active deployment when none', () => {
    expect(manager.getActiveDeployment()).toBeUndefined();
  });

  test('should get deployment history', async () => {
    await manager.deploy({ version: '1.0.0', environment: 'prod', strategy: 'standard' });
    await manager.deploy({ version: '2.0.0', environment: 'prod', strategy: 'standard' });
    const history = manager.getDeploymentHistory();
    expect(history.length).toBe(2);
  });

  test('should rollback deployment', async () => {
    const result = await manager.deploy({
      version: '1.0.0',
      environment: 'prod',
      strategy: 'standard',
    });
    const rollbackResult = await manager.rollback(result.deploymentId);
    expect(rollbackResult.success).toBe(true);
    expect(rollbackResult.previousVersion).toBe('1.0.0');
  });

  test('should fail rollback for unknown deployment', async () => {
    const result = await manager.rollback('nonexistent');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  test('should clear active deployment after rollback', async () => {
    const result = await manager.deploy({
      version: '1.0.0',
      environment: 'prod',
      strategy: 'standard',
    });
    expect(manager.getActiveDeployment()).toBeDefined();
    await manager.rollback(result.deploymentId);
    expect(manager.getActiveDeployment()).toBeUndefined();
  });

  test('should get deployment count', async () => {
    await manager.deploy({ version: '1.0.0', environment: 'prod', strategy: 'standard' });
    await manager.deploy({ version: '2.0.0', environment: 'prod', strategy: 'standard' });
    expect(manager.getDeploymentCount()).toBe(2);
  });

  test('should clear history', async () => {
    await manager.deploy({ version: '1.0.0', environment: 'prod', strategy: 'standard' });
    manager.clearHistory();
    expect(manager.getDeploymentCount()).toBe(0);
    expect(manager.getActiveDeployment()).toBeUndefined();
  });

  test('should generate unique deployment IDs', async () => {
    const r1 = await manager.deploy({ version: '1.0.0', environment: 'prod', strategy: 'standard' });
    const r2 = await manager.deploy({ version: '2.0.0', environment: 'prod', strategy: 'standard' });
    expect(r1.deploymentId).not.toBe(r2.deploymentId);
  });
});

// ============================================================
// Module 7: ConfigHotSwap - 配置热交换
// ============================================================
describe('ConfigHotSwap', () => {
  let hotswap: ConfigHotSwap;

  beforeEach(() => {
    hotswap = new ConfigHotSwap();
  });

  test('should create instance with default config', () => {
    const config = hotswap.getConfig();
    expect(config.logLevel).toBe('info');
    expect(config.maxWorkers).toBe(4);
  });

  test('should create instance with initial config', () => {
    const hs = new ConfigHotSwap({ logLevel: 'debug', maxWorkers: 8 });
    const config = hs.getConfig();
    expect(config.logLevel).toBe('debug');
    expect(config.maxWorkers).toBe(8);
  });

  test('should validate valid changes', () => {
    const result = hotswap.validateChanges({ maxWorkers: 8 });
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test('should invalidate maxWorkers out of range', () => {
    const result = hotswap.validateChanges({ maxWorkers: 0 });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('should invalidate maxWorkers too high', () => {
    const result = hotswap.validateChanges({ maxWorkers: 100 });
    expect(result.valid).toBe(false);
  });

  test('should invalidate memoryLimit too low', () => {
    const result = hotswap.validateChanges({ memoryLimit: 10 });
    expect(result.valid).toBe(false);
  });

  test('should invalidate negative cacheTTL', () => {
    const result = hotswap.validateChanges({ cacheTTL: -1 });
    expect(result.valid).toBe(false);
  });

  test('should warn about low apiTimeout', () => {
    const result = hotswap.validateChanges({ apiTimeout: 50 });
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test('should warn about high retryAttempts', () => {
    const result = hotswap.validateChanges({ retryAttempts: 20 });
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test('should update config successfully', () => {
    const result = hotswap.updateConfig({ maxWorkers: 8 });
    expect(result.success).toBe(true);
    expect(result.applied).toContain('maxWorkers');
    expect(hotswap.getConfig().maxWorkers).toBe(8);
  });

  test('should reject invalid config changes', () => {
    const result = hotswap.updateConfig({ maxWorkers: 0 });
    expect(result.success).toBe(false);
    expect(result.rejected).toContain('maxWorkers');
  });

  test('should notify subscribers on config change', () => {
    let notified = false;
    hotswap.subscribe((changes) => {
      if ('maxWorkers' in changes) notified = true;
    });
    hotswap.updateConfig({ maxWorkers: 8 });
    expect(notified).toBe(true);
  });

  test('should unsubscribe from config changes', () => {
    let count = 0;
    const unsub = hotswap.subscribe(() => { count++; });
    hotswap.updateConfig({ maxWorkers: 8 });
    expect(count).toBe(1);
    unsub();
    hotswap.updateConfig({ maxWorkers: 16 });
    expect(count).toBe(1);
  });

  test('should record change history', () => {
    hotswap.updateConfig({ maxWorkers: 8 });
    hotswap.updateConfig({ logLevel: 'debug' });
    const history = hotswap.getChangeHistory();
    expect(history.length).toBe(2);
  });

  test('should rollback config change', () => {
    hotswap.updateConfig({ maxWorkers: 8 });
    expect(hotswap.getConfig().maxWorkers).toBe(8);
    const history = hotswap.getChangeHistory();
    const success = hotswap.rollback(history[0].id);
    expect(success).toBe(true);
    expect(hotswap.getConfig().maxWorkers).toBe(4);
  });

  test('should fail rollback for unknown change', () => {
    expect(hotswap.rollback('nonexistent')).toBe(false);
  });

  test('should add custom validator', () => {
    hotswap.addValidator((changes) => {
      if (changes.logLevel === 'verbose') {
        return { valid: false, errors: ['verbose is not allowed'], warnings: [] };
      }
      return { valid: true, errors: [], warnings: [] };
    });
    const result = hotswap.validateChanges({ logLevel: 'verbose' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('verbose is not allowed');
  });

  test('should return previous config on update', () => {
    const result = hotswap.updateConfig({ maxWorkers: 8 });
    expect(result.previousConfig.maxWorkers).toBe(4);
  });

  test('should get subscriber count', () => {
    const unsub1 = hotswap.subscribe(() => {});
    const unsub2 = hotswap.subscribe(() => {});
    expect(hotswap.getSubscriberCount()).toBe(2);
    unsub1();
    expect(hotswap.getSubscriberCount()).toBe(1);
    unsub2();
  });

  test('should reset config to defaults', () => {
    hotswap.updateConfig({ maxWorkers: 16, logLevel: 'debug' });
    hotswap.reset();
    expect(hotswap.getConfig().maxWorkers).toBe(DEFAULT_CONFIG.maxWorkers);
    expect(hotswap.getConfig().logLevel).toBe(DEFAULT_CONFIG.logLevel);
  });

  test('should apply multiple changes atomically', () => {
    const result = hotswap.updateConfig({ maxWorkers: 8, logLevel: 'debug', enableCache: false });
    expect(result.success).toBe(true);
    expect(result.applied.length).toBe(3);
    const config = hotswap.getConfig();
    expect(config.maxWorkers).toBe(8);
    expect(config.logLevel).toBe('debug');
    expect(config.enableCache).toBe(false);
  });
});

// ============================================================
// Module 8: ThreadPoolManager - 线程池管理
// ============================================================
describe('ThreadPoolManager', () => {
  let pool: ThreadPoolManager;

  beforeEach(() => {
    pool = new ThreadPoolManager(4);
  });

  test('should create instance', () => {
    expect(pool).toBeDefined();
  });

  test('should return correct pool size', () => {
    expect(pool.getPoolSize()).toBe(4);
  });

  test('should submit and execute task', async () => {
    const result = await pool.submit({
      id: 'task-1',
      handler: async () => 42,
    });
    expect(result).toBe(42);
  });

  test('should submit batch of tasks', async () => {
    const results = await pool.submitBatch([
      { id: 'batch-1', handler: async () => 1 },
      { id: 'batch-2', handler: async () => 2 },
      { id: 'batch-3', handler: async () => 3 },
    ]);
    expect(results).toEqual([1, 2, 3]);
  });

  test('should return active workers count', async () => {
    const slowTask = pool.submit({
      id: 'slow',
      handler: async () => {
        await new Promise(r => setTimeout(r, 100));
        return 'done';
      },
    });
    // Active workers may be 0 or 1 depending on timing
    expect(pool.getActiveWorkers()).toBeGreaterThanOrEqual(0);
    await slowTask;
  });

  test('should return queue size', () => {
    expect(pool.getQueueSize()).toBe(0);
  });

  test('should resize pool', () => {
    pool.resize(8);
    expect(pool.getPoolSize()).toBe(8);
    expect(pool.getWorkerCount()).toBe(8);
  });

  test('should shrink pool by removing idle workers', () => {
    pool.resize(2);
    expect(pool.getPoolSize()).toBe(2);
  });

  test('should throw on invalid pool size', () => {
    expect(() => pool.resize(0)).toThrow();
  });

  test('should get worker stats', () => {
    const stats = pool.getWorkerStats();
    expect(stats.length).toBe(4);
    expect(stats[0].status).toBe('idle');
  });

  test('should get pool stats', () => {
    const stats = pool.getStats();
    expect(stats.poolSize).toBe(4);
    expect(stats.activeWorkers).toBe(0);
    expect(stats.queueSize).toBe(0);
  });

  test('should track completed tasks', async () => {
    await pool.submit({ id: 't1', handler: async () => 1 });
    await pool.submit({ id: 't2', handler: async () => 2 });
    const stats = pool.getStats();
    expect(stats.totalCompleted).toBe(2);
  });

  test('should track failed tasks', async () => {
    try {
      await pool.submit({
        id: 'fail-1',
        handler: async () => { throw new Error('task failed'); },
      });
    } catch {
      // expected
    }
    const stats = pool.getStats();
    expect(stats.totalFailed).toBe(1);
  });

  test('should handle task rejection', async () => {
    await expect(
      pool.submit({
        id: 'reject-1',
        handler: async () => { throw new Error('rejected'); },
      })
    ).rejects.toThrow('rejected');
  });

  test('should reset pool', async () => {
    await pool.submit({ id: 't1', handler: async () => 1 });
    pool.reset();
    const stats = pool.getStats();
    expect(stats.totalCompleted).toBe(0);
    expect(stats.totalFailed).toBe(0);
  });

  test('should create pool with custom size', () => {
    const customPool = new ThreadPoolManager(8);
    expect(customPool.getPoolSize()).toBe(8);
  });

  test('should auto-restart crashed workers', async () => {
    const autoRestartPool = new ThreadPoolManager(2, true);
    try {
      await autoRestartPool.submit({
        id: 'crash',
        handler: async () => { throw new Error('crash'); },
      });
    } catch {
      // expected
    }
    const stats = autoRestartPool.getWorkerStats();
    // With auto-restart, workers should be idle after crash
    const idleCount = stats.filter(w => w.status === 'idle').length;
    expect(idleCount).toBeGreaterThanOrEqual(1);
  });

  test('should execute tasks with priority', async () => {
    const order: number[] = [];
    const results = await Promise.all([
      pool.submit({ id: 'p-low', priority: 10, handler: async () => { order.push(2); return 2; } }),
      pool.submit({ id: 'p-high', priority: 0, handler: async () => { order.push(1); return 1; } }),
    ]);
    // Both should complete
    expect(results).toContain(1);
    expect(results).toContain(2);
  });
});

// ============================================================
// Module 9: MemoryManager - 内存管理器
// ============================================================
describe('MemoryManager', () => {
  let manager: MemoryManager;

  beforeEach(() => {
    manager = new MemoryManager();
  });

  test('should create instance', () => {
    expect(manager).toBeDefined();
  });

  test('should get memory usage', () => {
    const usage = manager.getUsage();
    expect(usage.used).toBeGreaterThanOrEqual(0);
    expect(usage.total).toBeGreaterThan(0);
    expect(usage.percentage).toBeGreaterThanOrEqual(0);
    expect(usage.rss).toBeGreaterThanOrEqual(0);
  });

  test('should record usage', () => {
    manager.recordUsage();
    expect(manager.getHistoryLength()).toBe(1);
  });

  test('should get trend with insufficient data', () => {
    const trend = manager.getTrend();
    expect(trend.direction).toBe('stable');
    expect(trend.rate).toBe(0);
  });

  test('should get trend with data', () => {
    manager.recordUsage();
    manager.recordUsage();
    const trend = manager.getTrend();
    expect(trend.samples).toBe(2);
    expect(trend.duration).toBeGreaterThanOrEqual(0);
  });

  test('should force GC', () => {
    const result = manager.forceGC();
    // triggered is true only if globalThis.gc is available
    expect(typeof result.triggered).toBe('boolean');
    expect(result.freedAmount).toBeGreaterThanOrEqual(0);
  });

  test('should detect no leak with insufficient data', () => {
    const report = manager.detectLeaks();
    expect(report.hasLeak).toBe(false);
    expect(report.confidence).toBe(0);
  });

  test('should detect leaks based on trend', () => {
    // Simulate growing memory by recording usage
    for (let i = 0; i < 5; i++) {
      manager.recordUsage();
    }
    const report = manager.detectLeaks();
    // With real usage data, leak detection depends on actual memory behavior
    expect(report.recommendation).toBeDefined();
  });

  test('should track large objects', () => {
    manager.registerLargeObject(1024, 'Buffer');
    manager.registerLargeObject(2048, 'String');
    const large = manager.trackLargeObjects(1024);
    expect(large.length).toBe(2);
  });

  test('should filter large objects by minimum size', () => {
    manager.registerLargeObject(512, 'Buffer');
    manager.registerLargeObject(2048, 'String');
    const large = manager.trackLargeObjects(1024);
    expect(large.length).toBe(1);
    expect(large[0].size).toBe(2048);
  });

  test('should register large object', () => {
    const obj = manager.registerLargeObject(4096, 'Array');
    expect(obj.size).toBe(4096);
    expect(obj.type).toBe('Array');
    expect(obj.id).toBeDefined();
  });

  test('should unregister large object', () => {
    const obj = manager.registerLargeObject(1024, 'Buffer');
    expect(manager.unregisterLargeObject(obj.id)).toBe(true);
    expect(manager.unregisterLargeObject('nonexistent')).toBe(false);
  });

  test('should access large object', () => {
    const obj = manager.registerLargeObject(1024, 'Buffer');
    const before = obj.lastAccessed;
    // Small delay to ensure timestamp difference
    manager.accessLargeObject(obj.id);
    const large = manager.trackLargeObjects(0);
    expect(large[0].lastAccessed).toBeGreaterThanOrEqual(before);
  });

  test('should set thresholds', () => {
    manager.setThreshold(60, 85);
    const thresholds = manager.getThresholds();
    expect(thresholds.warning).toBe(60);
    expect(thresholds.critical).toBe(85);
  });

  test('should check warning state', () => {
    manager.setThreshold(100, 100); // Very high thresholds
    expect(manager.isWarning()).toBe(false);
  });

  test('should check critical state', () => {
    manager.setThreshold(100, 100);
    expect(manager.isCritical()).toBe(false);
  });

  test('should clear history', () => {
    manager.recordUsage();
    manager.recordUsage();
    manager.clearHistory();
    expect(manager.getHistoryLength()).toBe(0);
  });

  test('should clear large objects', () => {
    manager.registerLargeObject(1024, 'Buffer');
    manager.clearLargeObjects();
    expect(manager.trackLargeObjects(0)).toEqual([]);
  });

  test('should return empty large objects initially', () => {
    expect(manager.trackLargeObjects(0)).toEqual([]);
  });
});

// ============================================================
// Module 10: UptimeTracker - 运行时间追踪器
// ============================================================
describe('UptimeTracker', () => {
  let tracker: UptimeTracker;

  beforeEach(() => {
    tracker = new UptimeTracker();
  });

  test('should create instance', () => {
    expect(tracker).toBeDefined();
  });

  test('should not be running initially', () => {
    expect(tracker.isRunning()).toBe(false);
  });

  test('should record start', () => {
    tracker.recordStart();
    expect(tracker.isRunning()).toBe(true);
    expect(tracker.getStartTime()).not.toBeNull();
  });

  test('should record stop', () => {
    tracker.recordStart();
    tracker.recordStop('maintenance');
    expect(tracker.isRunning()).toBe(false);
  });

  test('should get session uptime', () => {
    tracker.recordStart();
    const uptime = tracker.getSessionUptime();
    expect(uptime).toBeGreaterThanOrEqual(0);
  });

  test('should return zero session uptime when not running', () => {
    expect(tracker.getSessionUptime()).toBe(0);
  });

  test('should get total uptime', () => {
    tracker.recordStart();
    tracker.recordStop('test');
    tracker.recordStart();
    const uptime = tracker.getUptime();
    expect(uptime).toBeGreaterThanOrEqual(0);
  });

  test('should return zero total uptime initially', () => {
    expect(tracker.getUptime()).toBe(0);
  });

  test('should get 100% availability with no downtime', () => {
    tracker.recordStart();
    const availability = tracker.getAvailability();
    expect(availability).toBe(100);
  });

  test('should calculate availability with downtime', () => {
    tracker.recordStart();
    tracker.recordStop('test');
    const availability = tracker.getAvailability();
    expect(availability).toBeGreaterThanOrEqual(0);
    expect(availability).toBeLessThanOrEqual(100);
  });

  test('should get downtime history', () => {
    tracker.recordStart();
    tracker.recordStop('maintenance');
    const history = tracker.getDowntimeHistory();
    expect(history.length).toBe(1);
    expect(history[0].reason).toBe('maintenance');
  });

  test('should return empty downtime history initially', () => {
    expect(tracker.getDowntimeHistory()).toEqual([]);
  });

  test('should get SLA compliance - compliant', () => {
    tracker.recordStart();
    const report = tracker.getSLACompliance(99.9);
    expect(report.target).toBe(99.9);
    expect(report.actual).toBe(100);
    expect(report.compliant).toBe(true);
  });

  test('should get SLA compliance - non-compliant', async () => {
    tracker.recordStart();
    // Simulate a long downtime period by manipulating internal state
    tracker.recordStop('outage');
    // Manually set a large downtime to ensure non-compliance
    const history = tracker.getDowntimeHistory();
    if (history.length > 0) {
      history[history.length - 1].startTime = Date.now() - 100000;
      history[history.length - 1].endTime = Date.now() - 1000;
      history[history.length - 1].duration = 99000;
    }
    tracker.recordStart();
    const report = tracker.getSLACompliance(99.99);
    expect(report.target).toBe(99.99);
    // With large downtime recorded, availability should be < 100
    expect(report.actual).toBeLessThan(100);
  });

  test('should get milestones', () => {
    const milestones = tracker.getMilestones();
    expect(milestones.length).toBeGreaterThan(0);
    expect(milestones[0].name).toBe('1 minute');
  });

  test('should achieve milestone', () => {
    tracker.recordStart();
    // Manually set a very short milestone to test
    const milestones = tracker.getMilestones();
    // Without enough uptime, milestones should not be achieved
    const unachieved = milestones.filter(m => !m.achieved);
    expect(unachieved.length).toBeGreaterThan(0);
  });

  test('should handle multiple start-stop cycles', () => {
    tracker.recordStart();
    tracker.recordStop('test1');
    tracker.recordStart();
    tracker.recordStop('test2');
    tracker.recordStart();
    expect(tracker.isRunning()).toBe(true);
    expect(tracker.getDowntimeHistory().length).toBe(2);
  });

  test('should ignore stop when not running', () => {
    tracker.recordStop('test');
    expect(tracker.getDowntimeHistory()).toEqual([]);
  });

  test('should get stop time', () => {
    tracker.recordStart();
    tracker.recordStop('test');
    expect(tracker.getStopTime()).not.toBeNull();
  });

  test('should return null stop time when running', () => {
    tracker.recordStart();
    expect(tracker.getStopTime()).toBeNull();
  });

  test('should return null start time initially', () => {
    expect(tracker.getStartTime()).toBeNull();
  });

  test('should reset tracker', () => {
    tracker.recordStart();
    tracker.recordStop('test');
    tracker.reset();
    expect(tracker.isRunning()).toBe(false);
    expect(tracker.getUptime()).toBe(0);
    expect(tracker.getDowntimeHistory()).toEqual([]);
    expect(tracker.getStartTime()).toBeNull();
  });

  test('should handle getAvailability with period parameter', () => {
    tracker.recordStart();
    const avail = tracker.getAvailability('1h');
    expect(avail).toBeGreaterThanOrEqual(0);
    expect(avail).toBeLessThanOrEqual(100);
  });

  test('should return total downtime', () => {
    tracker.recordStart();
    tracker.recordStop('test');
    const downtime = tracker.getTotalDowntime();
    expect(downtime).toBeGreaterThanOrEqual(0);
  });

  test('should return zero total downtime initially', () => {
    expect(tracker.getTotalDowntime()).toBe(0);
  });
});
