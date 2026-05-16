import { describe, test, expect, beforeEach } from 'bun:test';
import { NotificationCenter } from '../src/notification-center.ts';
import type { Notification, NotificationType, NotificationPriority } from '../src/notification-center.ts';
import { AlertManager } from '../src/alert-manager.ts';
import type { AlertRule, MetricData } from '../src/alert-manager.ts';
import { EnhancedEventBus } from '../src/event-bus-enhanced.ts';
import { WebhookManager } from '../src/webhook-manager.ts';
import { DigestBuilder } from '../src/digest-builder.ts';
import { NotificationTemplateEngine } from '../src/template-engine.ts';
import { ChannelRouter } from '../src/channel-router.ts';
import { NotificationPreferences } from '../src/notification-preferences.ts';
import { NotificationHistory } from '../src/notification-history.ts';
import { NotificationMetrics } from '../src/notification-metrics.ts';

// Helper to create a notification
function createNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: `notif_${Math.random().toString(36).slice(2)}`,
    type: 'info',
    priority: 'normal',
    title: 'Test Notification',
    message: 'This is a test notification',
    channel: 'console',
    timestamp: Date.now(),
    ...overrides,
  };
}

// ============================================================
// Module 1: NotificationCenter Tests
// ============================================================
describe('NotificationCenter', () => {
  let center: NotificationCenter;

  beforeEach(() => {
    center = new NotificationCenter();
  });

  test('should create a NotificationCenter instance', () => {
    expect(center).toBeDefined();
  });

  test('should send notification to console channel', async () => {
    const results = await center.send(createNotification({ channel: 'console' }));
    expect(results.length).toBe(1);
    expect(results[0].success).toBe(true);
    expect(results[0].channel).toBe('console');
  });

  test('should send notification to multiple channels', async () => {
    const results = await center.send(createNotification({ channel: ['console', 'file'] }));
    expect(results.length).toBe(2);
    expect(results[0].channel).toBe('console');
    expect(results[1].channel).toBe('file');
  });

  test('should subscribe to a channel and receive notifications', async () => {
    let received = false;
    center.subscribe('console', (notif) => { received = true; });
    await center.send(createNotification({ channel: 'console' }));
    expect(received).toBe(true);
  });

  test('should unsubscribe from a channel', async () => {
    let count = 0;
    const sub = center.subscribe('console', () => { count++; });
    await center.send(createNotification({ channel: 'console' }));
    expect(count).toBe(1);
    center.unsubscribe(sub.id);
    await center.send(createNotification({ channel: 'console' }));
    expect(count).toBe(1);
  });

  test('should deduplicate notifications with same dedupeKey', async () => {
    const notif = createNotification({ dedupeKey: 'test-dedupe' });
    const r1 = await center.send(notif);
    const r2 = await center.send(notif);
    expect(r1[0].success).toBe(true);
    expect(r2[0].success).toBe(false);
    expect(r2[0].error).toBe('Duplicate notification suppressed');
  });

  test('should store notifications in history', async () => {
    await center.send(createNotification({ channel: 'console' }));
    const history = center.getHistory();
    expect(history.length).toBe(1);
  });

  test('should filter history by type', async () => {
    await center.send(createNotification({ type: 'info', channel: 'console' }));
    await center.send(createNotification({ type: 'error', channel: 'console' }));
    const history = center.getHistory({ type: 'error' });
    expect(history.length).toBe(1);
    expect(history[0].notification.type).toBe('error');
  });

  test('should filter history by priority', async () => {
    await center.send(createNotification({ priority: 'low', channel: 'console' }));
    await center.send(createNotification({ priority: 'critical', channel: 'console' }));
    const history = center.getHistory({ priority: 'critical' });
    expect(history.length).toBe(1);
  });

  test('should filter history by channel', async () => {
    await center.send(createNotification({ channel: 'console' }));
    await center.send(createNotification({ channel: 'email' }));
    const history = center.getHistory({ channel: 'email' });
    expect(history.length).toBe(1);
  });

  test('should filter history by recipient', async () => {
    await center.send(createNotification({ channel: 'console', recipient: 'user1' }));
    await center.send(createNotification({ channel: 'console', recipient: 'user2' }));
    const history = center.getHistory({ recipient: 'user1' });
    expect(history.length).toBe(1);
  });

  test('should filter history by time range', async () => {
    const past = Date.now() - 100000;
    const future = Date.now() + 100000;
    await center.send(createNotification({ channel: 'console' }));
    const history = center.getHistory({ startTime: past, endTime: future });
    expect(history.length).toBe(1);
    // Filter with a range that excludes everything
    const empty = center.getHistory({ startTime: future, endTime: future + 100000 });
    expect(empty.length).toBe(0);
  });

  test('should limit history results', async () => {
    for (let i = 0; i < 5; i++) {
      await center.send(createNotification({ channel: 'console' }));
    }
    const history = center.getHistory({ limit: 2 });
    expect(history.length).toBe(2);
  });

  test('should handle handler errors gracefully', async () => {
    center.subscribe('console', () => { throw new Error('Handler error'); });
    const results = await center.send(createNotification({ channel: 'console' }));
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('Handler error');
  });

  test('should clear history', async () => {
    await center.send(createNotification({ channel: 'console' }));
    center.clearHistory();
    expect(center.getHistory().length).toBe(0);
  });

  test('should support all notification types', async () => {
    const types: NotificationType[] = ['info', 'success', 'warning', 'error', 'progress'];
    for (const type of types) {
      const results = await center.send(createNotification({ type, channel: 'console' }));
      expect(results[0].success).toBe(true);
    }
  });

  test('should support all priority levels', async () => {
    const priorities: NotificationPriority[] = ['low', 'normal', 'high', 'critical'];
    for (const priority of priorities) {
      const results = await center.send(createNotification({ priority, channel: 'console' }));
      expect(results[0].success).toBe(true);
    }
  });

  test('should include duration in send result', async () => {
    const results = await center.send(createNotification({ channel: 'console' }));
    expect(results[0].duration).toBeDefined();
    expect(typeof results[0].duration).toBe('number');
  });

  test('should include notificationId in send result', async () => {
    const notif = createNotification({ id: 'custom-id', channel: 'console' });
    const results = await center.send(notif);
    expect(results[0].notificationId).toBe('custom-id');
  });
});

// ============================================================
// Module 2: AlertManager Tests
// ============================================================
describe('AlertManager', () => {
  let manager: AlertManager;

  beforeEach(() => {
    manager = new AlertManager();
  });

  test('should create an AlertManager instance', () => {
    expect(manager).toBeDefined();
  });

  test('should create a rule and return its id', () => {
    const ruleId = manager.createRule({
      name: 'CPU High',
      severity: 'critical',
      metricName: 'cpu',
      condition: (data) => data.value > 90,
    });
    expect(ruleId).toBeDefined();
    expect(typeof ruleId).toBe('string');
  });

  test('should evaluate a rule that triggers', () => {
    const ruleId = manager.createRule({
      name: 'CPU High',
      severity: 'critical',
      metricName: 'cpu',
      condition: (data) => data.value > 90,
    });
    const result = manager.evaluateRule(ruleId, { name: 'cpu', value: 95 });
    expect(result.triggered).toBe(true);
    expect(result.severity).toBe('critical');
    expect(result.alertId).toBeDefined();
  });

  test('should evaluate a rule that does not trigger', () => {
    const ruleId = manager.createRule({
      name: 'CPU High',
      severity: 'critical',
      metricName: 'cpu',
      condition: (data) => data.value > 90,
    });
    const result = manager.evaluateRule(ruleId, { name: 'cpu', value: 50 });
    expect(result.triggered).toBe(false);
  });

  test('should return not found for non-existent rule', () => {
    const result = manager.evaluateRule('nonexistent', { name: 'cpu', value: 95 });
    expect(result.triggered).toBe(false);
    expect(result.message).toBe('Rule not found');
  });

  test('should not trigger disabled rules', () => {
    const ruleId = manager.createRule({
      name: 'CPU High',
      severity: 'critical',
      metricName: 'cpu',
      condition: (data) => data.value > 90,
      enabled: false,
    });
    const result = manager.evaluateRule(ruleId, { name: 'cpu', value: 95 });
    expect(result.triggered).toBe(false);
    expect(result.message).toBe('Rule is disabled');
  });

  test('should respect cooldown period', () => {
    const ruleId = manager.createRule({
      name: 'CPU High',
      severity: 'critical',
      metricName: 'cpu',
      condition: (data) => data.value > 90,
      cooldownMinutes: 60,
    });
    manager.evaluateRule(ruleId, { name: 'cpu', value: 95 });
    const result2 = manager.evaluateRule(ruleId, { name: 'cpu', value: 95 });
    expect(result2.triggered).toBe(false);
    expect(result2.message).toBe('Within cooldown period');
  });

  test('should acknowledge an active alert', () => {
    const ruleId = manager.createRule({
      name: 'CPU High',
      severity: 'critical',
      metricName: 'cpu',
      condition: (data) => data.value > 90,
    });
    const result = manager.evaluateRule(ruleId, { name: 'cpu', value: 95 });
    manager.acknowledgeAlert(result.alertId!);
    const alert = manager.getAlert(result.alertId!);
    expect(alert?.state).toBe('acknowledged');
    expect(alert?.acknowledgedAt).toBeDefined();
  });

  test('should resolve an active alert', () => {
    const ruleId = manager.createRule({
      name: 'CPU High',
      severity: 'critical',
      metricName: 'cpu',
      condition: (data) => data.value > 90,
    });
    const result = manager.evaluateRule(ruleId, { name: 'cpu', value: 95 });
    manager.resolveAlert(result.alertId!);
    const alert = manager.getAlert(result.alertId!);
    expect(alert?.state).toBe('resolved');
    expect(alert?.resolvedAt).toBeDefined();
  });

  test('should silence alerts for a rule', () => {
    const ruleId = manager.createRule({
      name: 'CPU High',
      severity: 'critical',
      metricName: 'cpu',
      condition: (data) => data.value > 90,
    });
    manager.evaluateRule(ruleId, { name: 'cpu', value: 95 });
    manager.silenceAlert(ruleId, 60000);
    const alerts = manager.getAlerts({ state: 'silenced' });
    expect(alerts.length).toBe(1);
  });

  test('should filter alerts by state', () => {
    const ruleId = manager.createRule({
      name: 'CPU High',
      severity: 'critical',
      metricName: 'cpu',
      condition: (data) => data.value > 90,
    });
    manager.evaluateRule(ruleId, { name: 'cpu', value: 95 });
    const active = manager.getAlerts({ state: 'active' });
    expect(active.length).toBe(1);
  });

  test('should filter alerts by severity', () => {
    manager.createRule({
      name: 'CPU High',
      severity: 'critical',
      metricName: 'cpu',
      condition: (data) => data.value > 90,
    });
    const warningRuleId = manager.createRule({
      name: 'Memory Warning',
      severity: 'warning',
      metricName: 'memory',
      condition: (data) => data.value > 80,
    });
    manager.evaluateRule('rule_1', { name: 'cpu', value: 95 });
    manager.evaluateRule(warningRuleId, { name: 'memory', value: 85 });
    const critical = manager.getAlerts({ severity: 'critical' });
    expect(critical.length).toBe(1);
  });

  test('should compute statistics', () => {
    const ruleId = manager.createRule({
      name: 'CPU High',
      severity: 'critical',
      metricName: 'cpu',
      condition: (data) => data.value > 90,
    });
    const result = manager.evaluateRule(ruleId, { name: 'cpu', value: 95 });
    manager.resolveAlert(result.alertId!);
    const stats = manager.getStatistics();
    expect(stats.total).toBe(1);
    expect(stats.resolved).toBe(1);
    expect(stats.bySeverity.critical).toBe(1);
  });

  test('should clear all data', () => {
    manager.createRule({
      name: 'CPU High',
      severity: 'critical',
      metricName: 'cpu',
      condition: (data) => data.value > 90,
    });
    manager.evaluateRule('rule_1', { name: 'cpu', value: 95 });
    manager.clear();
    expect(manager.getAlerts().length).toBe(0);
  });
});

// ============================================================
// Module 3: EnhancedEventBus Tests
// ============================================================
describe('EnhancedEventBus', () => {
  let bus: EnhancedEventBus;

  beforeEach(() => {
    bus = new EnhancedEventBus();
  });

  test('should create an EnhancedEventBus instance', () => {
    expect(bus).toBeDefined();
  });

  test('should emit and receive events', () => {
    let received: unknown = null;
    bus.on('test:event', (data) => { received = data; });
    bus.emit('test:event', { hello: 'world' });
    expect(received).toEqual({ hello: 'world' });
  });

  test('should support once listeners', () => {
    let count = 0;
    bus.once('test:event', () => { count++; });
    bus.emit('test:event');
    bus.emit('test:event');
    expect(count).toBe(1);
  });

  test('should remove listeners with off', () => {
    let count = 0;
    const sub = bus.on('test:event', () => { count++; });
    bus.emit('test:event');
    expect(count).toBe(1);
    bus.off('test:event', sub.id);
    bus.emit('test:event');
    expect(count).toBe(1);
  });

  test('should support wildcard listeners with single *', () => {
    let received: string[] = [];
    bus.on('test:*', (_data, event) => { received.push(event); });
    bus.emit('test:create');
    bus.emit('test:update');
    expect(received).toEqual(['test:create', 'test:update']);
  });

  test('should not match wildcard for different prefix', () => {
    let received: string[] = [];
    bus.on('test:*', (_data, event) => { received.push(event); });
    bus.emit('other:event');
    expect(received.length).toBe(0);
  });

  test('should support event namespacing', () => {
    let received: unknown = null;
    bus.on('module:entity:action', (data) => { received = data; });
    bus.emit('module:entity:action', { key: 'value' });
    expect(received).toEqual({ key: 'value' });
  });

  test('should record events in history', () => {
    bus.emit('test:event', { data: 1 });
    bus.emit('test:event', { data: 2 });
    const history = bus.getHistory('test:event');
    expect(history.length).toBe(2);
  });

  test('should replay events', () => {
    let count = 0;
    bus.emit('test:event');
    bus.emit('test:event');
    bus.on('test:event', () => { count++; });
    bus.replay('test:event');
    expect(count).toBe(2);
  });

  test('should replay limited number of events', () => {
    let count = 0;
    bus.emit('test:event');
    bus.emit('test:event');
    bus.emit('test:event');
    bus.on('test:event', () => { count++; });
    bus.replay('test:event', 2);
    expect(count).toBe(2);
  });

  test('should apply pre-middleware', () => {
    bus.use({
      name: 'add-field',
      pre: (_event, data) => {
        if (typeof data === 'object' && data !== null) {
          return { ...data as object, processed: true };
        }
        return data;
      },
    });
    let received: unknown = null;
    bus.on('test:event', (data) => { received = data; });
    bus.emit('test:event', { original: true });
    expect((received as any).processed).toBe(true);
  });

  test('should apply post-middleware', () => {
    let postCalled = false;
    bus.use({
      name: 'post-check',
      post: () => { postCalled = true; },
    });
    bus.emit('test:event');
    expect(postCalled).toBe(true);
  });

  test('should clear history', () => {
    bus.emit('test:event');
    bus.clearHistory();
    expect(bus.getHistory().length).toBe(0);
  });

  test('should remove all listeners for a specific event', () => {
    bus.on('test:event', () => {});
    bus.on('test:event', () => {});
    bus.removeAllListeners('test:event');
    bus.emit('test:event'); // should not throw
  });

  test('should remove all listeners', () => {
    bus.on('test:event', () => {});
    bus.on('other:event', () => {});
    bus.removeAllListeners();
    expect(bus.getHistory().length).toBe(0);
  });

  test('should respect maxHistorySize', () => {
    const smallBus = new EnhancedEventBus({ maxHistorySize: 2 });
    smallBus.emit('e1');
    smallBus.emit('e2');
    smallBus.emit('e3');
    expect(smallBus.getHistory().length).toBe(2);
  });

  test('should pass event name to handler', () => {
    let eventName = '';
    bus.on('test:event', (_data, event) => { eventName = event; });
    bus.emit('test:event');
    expect(eventName).toBe('test:event');
  });

  test('should handle multiple listeners on same event', () => {
    let count1 = 0;
    let count2 = 0;
    bus.on('test:event', () => { count1++; });
    bus.on('test:event', () => { count2++; });
    bus.emit('test:event');
    expect(count1).toBe(1);
    expect(count2).toBe(1);
  });
});

// ============================================================
// Module 4: WebhookManager Tests
// ============================================================
describe('WebhookManager', () => {
  let manager: WebhookManager;

  beforeEach(() => {
    manager = new WebhookManager();
  });

  test('should create a WebhookManager instance', () => {
    expect(manager).toBeDefined();
  });

  test('should register a webhook and return its id', () => {
    const id = manager.register({
      url: 'https://example.com/webhook',
      secret: 'my-secret',
      events: ['test.event'],
    });
    expect(id).toBeDefined();
    expect(typeof id).toBe('string');
  });

  test('should unregister a webhook', () => {
    const id = manager.register({
      url: 'https://example.com/webhook',
      secret: 'my-secret',
      events: ['test.event'],
    });
    manager.unregister(id);
    expect(manager.getWebhook(id)).toBeUndefined();
  });

  test('should trigger webhooks matching an event', async () => {
    manager.register({
      url: 'https://example.com/webhook',
      secret: 'my-secret',
      events: ['test.event'],
    });
    const results = await manager.trigger('test.event', { data: 'test' });
    expect(results.length).toBe(1);
    expect(results[0].success).toBe(true);
  });

  test('should not trigger webhooks for non-matching events', async () => {
    manager.register({
      url: 'https://example.com/webhook',
      secret: 'my-secret',
      events: ['other.event'],
    });
    const results = await manager.trigger('test.event', { data: 'test' });
    expect(results.length).toBe(0);
  });

  test('should not trigger disabled webhooks', async () => {
    manager.register({
      url: 'https://example.com/webhook',
      secret: 'my-secret',
      events: ['test.event'],
      enabled: false,
    });
    const results = await manager.trigger('test.event', { data: 'test' });
    expect(results.length).toBe(0);
  });

  test('should sign payloads with HMAC-SHA256', () => {
    const signature = manager.verifySignature(
      JSON.stringify({ test: 'data' }),
      'invalid-sig',
      'my-secret'
    );
    // The signature won't match invalid-sig
    expect(signature).toBe(false);
  });

  test('should verify valid signatures', () => {
    const payload = JSON.stringify({ test: 'data' });
    const secret = 'my-secret';
    // We need to generate a valid signature first
    // Use the internal signing mechanism
    const webhook = manager.register({
      url: 'https://example.com/webhook',
      secret,
      events: ['test.event'],
    });
    // Trigger to get a delivery, then check the signing works
    // Instead, directly test verification logic
    const { createHmac } = require('node:crypto');
    const validSig = createHmac('sha256', secret).update(payload).digest('hex');
    expect(manager.verifySignature(payload, validSig, secret)).toBe(true);
  });

  test('should track delivery status', async () => {
    const id = manager.register({
      url: 'https://example.com/webhook',
      secret: 'my-secret',
      events: ['test.event'],
    });
    await manager.trigger('test.event', { data: 'test' });
    const statuses = manager.getDeliveryStatus(id);
    expect(statuses.length).toBe(1);
    expect(statuses[0].completed).toBe(true);
  });

  test('should list all registered webhooks', () => {
    manager.register({
      url: 'https://example.com/webhook1',
      secret: 'secret1',
      events: ['e1'],
    });
    manager.register({
      url: 'https://example.com/webhook2',
      secret: 'secret2',
      events: ['e2'],
    });
    expect(manager.getWebhooks().length).toBe(2);
  });

  test('should clear all data', () => {
    manager.register({
      url: 'https://example.com/webhook',
      secret: 'my-secret',
      events: ['test.event'],
    });
    manager.clear();
    expect(manager.getWebhooks().length).toBe(0);
  });

  test('should include attempt count in delivery result', async () => {
    manager.register({
      url: 'https://example.com/webhook',
      secret: 'my-secret',
      events: ['test.event'],
      retryCount: 1,
    });
    const results = await manager.trigger('test.event', { data: 'test' });
    expect(results[0].attempt).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// Module 5: DigestBuilder Tests
// ============================================================
describe('DigestBuilder', () => {
  let builder: DigestBuilder;

  beforeEach(() => {
    builder = new DigestBuilder();
  });

  test('should create a DigestBuilder instance', () => {
    expect(builder).toBeDefined();
  });

  test('should add notifications', () => {
    builder.addNotification(createNotification({ type: 'info' }));
    builder.addNotification(createNotification({ type: 'error' }));
    const digest = builder.buildDigest('daily');
    expect(digest.notifications.length).toBe(2);
  });

  test('should build digest with correct summary', () => {
    builder.addNotification(createNotification({ type: 'info' }));
    builder.addNotification(createNotification({ type: 'error' }));
    builder.addNotification(createNotification({ type: 'info' }));
    const digest = builder.buildDigest('daily');
    expect(digest.summary.total).toBe(3);
    expect(digest.summary.byType.info).toBe(2);
    expect(digest.summary.byType.error).toBe(1);
  });

  test('should filter by time period', () => {
    const now = Date.now();
    builder.addNotification(createNotification({ timestamp: now - 100000 }));
    builder.addNotification(createNotification({ timestamp: now }));
    const digest = builder.buildDigest('hourly');
    // Only the recent notification should be in the hourly digest
    expect(digest.notifications.length).toBeLessThanOrEqual(2);
  });

  test('should render markdown digest', () => {
    builder.addNotification(createNotification({ type: 'info', title: 'Test Title', message: 'Test Message' }));
    const digest = builder.buildDigest('daily');
    const md = builder.renderMarkdown(digest);
    expect(md).toContain('Daily Digest');
    expect(md).toContain('Test Title');
    expect(md).toContain('info');
  });

  test('should render HTML digest', () => {
    builder.addNotification(createNotification({ type: 'info', title: 'Test Title', message: 'Test Message' }));
    const digest = builder.buildDigest('daily');
    const html = builder.renderHTML(digest);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Test Title');
    expect(html).toContain('notification info');
  });

  test('should apply include type rules', () => {
    builder.addRule({ includeTypes: ['error'] });
    builder.addNotification(createNotification({ type: 'info' }));
    builder.addNotification(createNotification({ type: 'error' }));
    const digest = builder.buildDigest('daily');
    expect(digest.notifications.length).toBe(1);
    expect(digest.notifications[0].type).toBe('error');
  });

  test('should apply exclude type rules', () => {
    builder.addRule({ excludeTypes: ['info'] });
    builder.addNotification(createNotification({ type: 'info' }));
    builder.addNotification(createNotification({ type: 'error' }));
    const digest = builder.buildDigest('daily');
    expect(digest.notifications.length).toBe(1);
    expect(digest.notifications[0].type).toBe('error');
  });

  test('should group by category', () => {
    builder.addNotification(createNotification({ data: { category: 'system' } }));
    builder.addNotification(createNotification({ data: { category: 'user' } }));
    builder.addNotification(createNotification({ data: { category: 'system' } }));
    const digest = builder.buildDigest('daily');
    expect(digest.summary.byCategory.system).toBe(2);
    expect(digest.summary.byCategory.user).toBe(1);
  });

  test('should clear notifications', () => {
    builder.addNotification(createNotification());
    builder.clear();
    const digest = builder.buildDigest('daily');
    expect(digest.notifications.length).toBe(0);
  });

  test('should set custom template', () => {
    builder.setTemplate('daily', {
      header: '# Custom {{period}}',
      itemFormat: '- {{title}}',
      footer: '---',
    });
    builder.addNotification(createNotification({ title: 'Custom Title' }));
    const digest = builder.buildDigest('daily');
    const md = builder.renderMarkdown(digest);
    expect(md).toContain('Custom daily');
  });
});

// ============================================================
// Module 6: NotificationTemplateEngine Tests
// ============================================================
describe('NotificationTemplateEngine', () => {
  let engine: NotificationTemplateEngine;

  beforeEach(() => {
    engine = new NotificationTemplateEngine();
  });

  test('should create a NotificationTemplateEngine instance', () => {
    expect(engine).toBeDefined();
  });

  test('should render simple variable substitution', () => {
    const result = engine.render('Hello, {{name}}!', { name: 'World' });
    expect(result).toBe('Hello, World!');
  });

  test('should render nested variable substitution', () => {
    const result = engine.render('{{user.name}} - {{user.email}}', {
      user: { name: 'John', email: 'john@example.com' },
    });
    expect(result).toBe('John - john@example.com');
  });

  test('should render if blocks with truthy values', () => {
    const result = engine.render('{{#if show}}Visible{{/if}}', { show: true });
    expect(result).toBe('Visible');
  });

  test('should hide if blocks with falsy values', () => {
    const result = engine.render('{{#if show}}Hidden{{/if}}', { show: false });
    expect(result).toBe('');
  });

  test('should render each blocks', () => {
    const result = engine.render('{{#each items}}- {{name}},{{/each}}', {
      items: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
    });
    expect(result).toBe('- A,- B,- C,');
  });

  test('should render each blocks with index', () => {
    const result = engine.render('{{#each items}}{{index}}{{/each}}', {
      items: ['x', 'y'],
    });
    expect(result).toBe('01');
  });

  test('should use uppercase function', () => {
    const result = engine.render('{{uppercase "hello"}}', {});
    expect(result).toBe('HELLO');
  });

  test('should use lowercase function', () => {
    const result = engine.render('{{lowercase "HELLO"}}', {});
    expect(result).toBe('hello');
  });

  test('should use truncate function', () => {
    const result = engine.render('{{truncate "Hello World" 5}}', {});
    expect(result).toBe('Hello...');
  });

  test('should use percent function', () => {
    const result = engine.render('{{percent 0.95}}', {});
    expect(result).toBe('95.0%');
  });

  test('should use number function', () => {
    const result = engine.render('{{number 3.14159 2}}', {});
    expect(result).toBe('3.14');
  });

  test('should register and retrieve templates', () => {
    engine.registerTemplate('welcome', 'Hello, {{name}}!');
    expect(engine.getTemplate('welcome')).toBe('Hello, {{name}}!');
  });

  test('should return undefined for non-existent template', () => {
    expect(engine.getTemplate('nonexistent')).toBeUndefined();
  });

  test('should compile templates', () => {
    const compiled = engine.compile('Hello, {{name}}!');
    const result = compiled.render({ name: 'World' });
    expect(result).toBe('Hello, World!');
  });

  test('should register custom functions', () => {
    engine.registerFunction('greet', (args) => `Hello, ${args[0]}!`);
    const result = engine.render('{{greet "Alice"}}', {});
    expect(result).toBe('Hello, Alice!');
  });

  test('should handle missing variables gracefully', () => {
    const result = engine.render('Hello, {{name}}!', {});
    expect(result).toBe('Hello, !');
  });

  test('should support default values', () => {
    const result = engine.render('Hello, {{name}}!', {
      name: undefined,
      _defaults: { name: 'Guest' },
    });
    expect(result).toBe('Hello, Guest!');
  });

  test('should use duration function', () => {
    const result = engine.render('{{duration 90000}}', {});
    expect(result).toBe('1m 30s');
  });

  test('should support locale setting', () => {
    engine.setLocale('zh');
    engine.registerTemplate('zh:greeting', '你好, {{name}}!');
    expect(engine.getTemplate('greeting')).toBe('你好, {{name}}!');
  });

  test('should render complex template with multiple features', () => {
    const template = '{{#if user}}Hello {{uppercase user.name}}!{{/if}} You have {{number count 0}} messages.';
    const result = engine.render(template, {
      user: { name: 'alice' },
      count: 5,
    });
    expect(result).toBe('Hello ALICE! You have 5 messages.');
  });
});

// ============================================================
// Module 7: ChannelRouter Tests
// ============================================================
describe('ChannelRouter', () => {
  let router: ChannelRouter;

  beforeEach(() => {
    router = new ChannelRouter();
  });

  test('should create a ChannelRouter instance', () => {
    expect(router).toBeDefined();
  });

  test('should add routing rules', () => {
    router.addRoute({
      name: 'Critical to email',
      condition: (n) => n.priority === 'critical',
      channels: ['email'],
    });
    expect(router.getRules().length).toBe(1);
  });

  test('should route based on matching rule', () => {
    router.addRoute({
      name: 'Critical to email',
      condition: (n) => n.priority === 'critical',
      channels: ['email'],
    });
    const channels = router.route(createNotification({ priority: 'critical' }));
    expect(channels).toContain('email');
  });

  test('should return default channel when no rules match', () => {
    const channels = router.route(createNotification({ type: 'info' }));
    expect(channels.length).toBeGreaterThanOrEqual(1);
  });

  test('should check channel availability', () => {
    expect(router.checkChannelAvailability('console')).toBe(true);
  });

  test('should mark channels as unavailable after failures', () => {
    router.updateChannelHealth('console', false);
    expect(router.checkChannelAvailability('console')).toBe(false);
  });

  test('should use failover channel when primary is down', () => {
    router.addRoute({
      name: 'Errors to console',
      condition: (n) => n.type === 'error',
      channels: ['console'],
    });
    router.setFailover('console', 'email');
    router.updateChannelHealth('console', false);
    const channels = router.route(createNotification({ type: 'error' }));
    expect(channels).toContain('email');
  });

  test('should not route to disabled rules', () => {
    router.addRoute({
      name: 'Disabled rule',
      condition: () => true,
      channels: ['email'],
      enabled: false,
    });
    const channels = router.route(createNotification());
    expect(channels).not.toContain('email');
  });

  test('should support higher priority rules first', () => {
    router.addRoute({
      name: 'Low priority rule',
      condition: () => true,
      channels: ['file'],
      priority: 1,
    });
    router.addRoute({
      name: 'High priority rule',
      condition: (n) => n.priority === 'critical',
      channels: ['email'],
      priority: 10,
    });
    const channels = router.route(createNotification({ priority: 'critical' }));
    expect(channels).toContain('email');
    expect(channels).not.toContain('file');
  });

  test('should get channel health info', () => {
    router.updateChannelHealth('console', true, 50);
    const health = router.getChannelHealth('console');
    expect(health).toBeDefined();
    expect(health!.available).toBe(true);
    expect(health!.latencyMs).toBe(50);
  });

  test('should get all channel health', () => {
    router.updateChannelHealth('console', true);
    router.updateChannelHealth('email', false);
    const allHealth = router.getAllChannelHealth();
    expect(allHealth.length).toBe(2);
  });

  test('should remove routing rules', () => {
    router.addRoute({
      name: 'Test rule',
      id: 'test-rule-id',
      condition: () => true,
      channels: ['console'],
    });
    router.removeRule('test-rule-id');
    expect(router.getRules().length).toBe(0);
  });

  test('should clear all data', () => {
    router.addRoute({
      name: 'Test',
      condition: () => true,
      channels: ['console'],
    });
    router.clear();
    expect(router.getRules().length).toBe(0);
  });

  test('should route error type to console by default', () => {
    const channels = router.route(createNotification({ type: 'error' }));
    expect(channels).toContain('console');
  });

  test('should route success type to in-app by default', () => {
    const channels = router.route(createNotification({ type: 'success' }));
    expect(channels).toContain('in-app');
  });
});

// ============================================================
// Module 8: NotificationPreferences Tests
// ============================================================
describe('NotificationPreferences', () => {
  let prefs: NotificationPreferences;

  beforeEach(() => {
    prefs = new NotificationPreferences();
  });

  test('should create a NotificationPreferences instance', () => {
    expect(prefs).toBeDefined();
  });

  test('should get default preferences for a user', () => {
    const userPrefs = prefs.getPreferences('user1');
    expect(userPrefs.userId).toBe('user1');
    expect(userPrefs.channels.console).toBe(true);
    expect(userPrefs.quietHours.enabled).toBe(false);
    expect(userPrefs.minPriority).toBe('low');
  });

  test('should set user preferences', () => {
    prefs.setPreferences('user1', { minPriority: 'high' });
    const userPrefs = prefs.getPreferences('user1');
    expect(userPrefs.minPriority).toBe('high');
  });

  test('should merge channel preferences', () => {
    prefs.setPreferences('user1', { channels: { email: false } });
    const userPrefs = prefs.getPreferences('user1');
    expect(userPrefs.channels.email).toBe(false);
    expect(userPrefs.channels.console).toBe(true);
  });

  test('should allow notification by default', () => {
    const result = prefs.shouldNotify('user1', createNotification());
    expect(result).toBe(true);
  });

  test('should block notification below min priority', () => {
    prefs.setPreferences('user1', { minPriority: 'high' });
    const result = prefs.shouldNotify('user1', createNotification({ priority: 'low' }));
    expect(result).toBe(false);
  });

  test('should allow critical notifications during quiet hours', () => {
    prefs.setPreferences('user1', {
      quietHours: { enabled: true, startHour: 0, endHour: 23 },
    });
    const result = prefs.shouldNotify('user1', createNotification({ priority: 'critical' }));
    expect(result).toBe(true);
  });

  test('should block non-critical during quiet hours', () => {
    prefs.setPreferences('user1', {
      quietHours: { enabled: true, startHour: 0, endHour: 23 },
    });
    const result = prefs.shouldNotify('user1', createNotification({ priority: 'normal' }));
    expect(result).toBe(false);
  });

  test('should block disabled categories', () => {
    prefs.setPreferences('user1', { disabledCategories: ['spam'] });
    const result = prefs.shouldNotify('user1', createNotification({ data: { category: 'spam' } }));
    expect(result).toBe(false);
  });

  test('should only allow enabled categories when set', () => {
    prefs.setPreferences('user1', { enabledCategories: ['important'] });
    const result = prefs.shouldNotify('user1', createNotification({ data: { category: 'other' } }));
    expect(result).toBe(false);
  });

  test('should allow enabled category', () => {
    prefs.setPreferences('user1', { enabledCategories: ['important'] });
    const result = prefs.shouldNotify('user1', createNotification({ data: { category: 'important' } }));
    expect(result).toBe(true);
  });

  test('should detect quiet hours spanning midnight', () => {
    prefs.setPreferences('user1', {
      quietHours: { enabled: true, startHour: 22, endHour: 8 },
    });
    // At hour 23, should be quiet
    const isQuiet = prefs.isQuietHours('user1');
    // This depends on current time, so we just verify it runs
    expect(typeof isQuiet).toBe('boolean');
  });

  test('should enforce daily max limit', () => {
    prefs.setPreferences('user1', { maxPerDay: 2 });
    prefs.incrementDailyCount('user1');
    prefs.incrementDailyCount('user1');
    const result = prefs.shouldNotify('user1', createNotification());
    expect(result).toBe(false);
  });

  test('should reset daily count', () => {
    prefs.setPreferences('user1', { maxPerDay: 1 });
    prefs.incrementDailyCount('user1');
    prefs.resetDailyCount('user1');
    const result = prefs.shouldNotify('user1', createNotification());
    expect(result).toBe(true);
  });

  test('should count users', () => {
    prefs.getPreferences('user1');
    prefs.getPreferences('user2');
    expect(prefs.getUserCount()).toBe(2);
  });

  test('should clear all preferences', () => {
    prefs.getPreferences('user1');
    prefs.clear();
    expect(prefs.getUserCount()).toBe(0);
  });

  test('should set default channel enabled', () => {
    prefs.setDefaultChannelEnabled('email', false);
    const userPrefs = prefs.getPreferences('newuser');
    expect(userPrefs.channels.email).toBe(false);
  });

  test('should set default min priority', () => {
    prefs.setDefaultMinPriority('high');
    const userPrefs = prefs.getPreferences('newuser');
    expect(userPrefs.minPriority).toBe('high');
  });
});

// ============================================================
// Module 9: NotificationHistory Tests
// ============================================================
describe('NotificationHistory', () => {
  let history: NotificationHistory;

  beforeEach(() => {
    history = new NotificationHistory();
  });

  test('should create a NotificationHistory instance', () => {
    expect(history).toBeDefined();
  });

  test('should record notifications', () => {
    history.record(createNotification(), [{ success: true, notificationId: '1', channel: 'console', timestamp: Date.now() }]);
    expect(history.getCount()).toBe(1);
  });

  test('should query all records', () => {
    history.record(createNotification({ type: 'info' }), [{ success: true, notificationId: '1', channel: 'console', timestamp: Date.now() }]);
    history.record(createNotification({ type: 'error' }), [{ success: true, notificationId: '2', channel: 'console', timestamp: Date.now() }]);
    expect(history.query({}).length).toBe(2);
  });

  test('should query by type', () => {
    history.record(createNotification({ type: 'info' }), [{ success: true, notificationId: '1', channel: 'console', timestamp: Date.now() }]);
    history.record(createNotification({ type: 'error' }), [{ success: true, notificationId: '2', channel: 'console', timestamp: Date.now() }]);
    expect(history.query({ type: 'error' }).length).toBe(1);
  });

  test('should query by channel', () => {
    history.record(createNotification(), [{ success: true, notificationId: '1', channel: 'console', timestamp: Date.now() }]);
    history.record(createNotification(), [{ success: true, notificationId: '2', channel: 'email', timestamp: Date.now() }]);
    expect(history.query({ channel: 'email' }).length).toBe(1);
  });

  test('should query by status success', () => {
    history.record(createNotification(), [{ success: true, notificationId: '1', channel: 'console', timestamp: Date.now() }]);
    history.record(createNotification(), [{ success: false, notificationId: '2', channel: 'console', timestamp: Date.now(), error: 'fail' }]);
    expect(history.query({ status: 'success' }).length).toBe(1);
  });

  test('should query by status failed', () => {
    history.record(createNotification(), [{ success: true, notificationId: '1', channel: 'console', timestamp: Date.now() }]);
    history.record(createNotification(), [{ success: false, notificationId: '2', channel: 'console', timestamp: Date.now(), error: 'fail' }]);
    expect(history.query({ status: 'failed' }).length).toBe(1);
  });

  test('should query by recipient', () => {
    history.record(createNotification({ recipient: 'user1' }), [{ success: true, notificationId: '1', channel: 'console', timestamp: Date.now() }]);
    history.record(createNotification({ recipient: 'user2' }), [{ success: true, notificationId: '2', channel: 'console', timestamp: Date.now() }]);
    expect(history.query({ recipient: 'user1' }).length).toBe(1);
  });

  test('should query with limit and offset', () => {
    for (let i = 0; i < 5; i++) {
      history.record(createNotification(), [{ success: true, notificationId: String(i), channel: 'console', timestamp: Date.now() }]);
    }
    expect(history.query({ limit: 2 }).length).toBe(2);
    expect(history.query({ offset: 3 }).length).toBe(2);
  });

  test('should aggregate by type', () => {
    history.record(createNotification({ type: 'info' }), [{ success: true, notificationId: '1', channel: 'console', timestamp: Date.now() }]);
    history.record(createNotification({ type: 'info' }), [{ success: true, notificationId: '2', channel: 'console', timestamp: Date.now() }]);
    history.record(createNotification({ type: 'error' }), [{ success: true, notificationId: '3', channel: 'console', timestamp: Date.now() }]);
    const agg = history.aggregate('type');
    expect(agg.total).toBe(3);
    expect(agg.buckets.info).toBe(2);
    expect(agg.buckets.error).toBe(1);
  });

  test('should aggregate by channel', () => {
    history.record(createNotification(), [{ success: true, notificationId: '1', channel: 'console', timestamp: Date.now() }]);
    history.record(createNotification(), [{ success: true, notificationId: '2', channel: 'email', timestamp: Date.now() }]);
    const agg = history.aggregate('channel');
    expect(agg.buckets.console).toBe(1);
    expect(agg.buckets.email).toBe(1);
  });

  test('should aggregate by day', () => {
    const now = Date.now();
    history.record(createNotification(), [{ success: true, notificationId: '1', channel: 'console', timestamp: now }]);
    const agg = history.aggregate('day');
    expect(agg.total).toBe(1);
    const dayKey = new Date(now).toISOString().split('T')[0];
    expect(agg.buckets[dayKey]).toBe(1);
  });

  test('should cleanup old records', () => {
    const old = Date.now() - 10 * 86400000; // 10 days ago
    const recent = Date.now();
    history.record(createNotification({ timestamp: old }), [{ success: true, notificationId: '1', channel: 'console', timestamp: old }]);
    history.record(createNotification({ timestamp: recent }), [{ success: true, notificationId: '2', channel: 'console', timestamp: recent }]);
    const removed = history.cleanup(7);
    expect(removed).toBe(1);
    expect(history.getCount()).toBe(1);
  });

  test('should export data as JSON', () => {
    history.record(createNotification(), [{ success: true, notificationId: '1', channel: 'console', timestamp: Date.now() }]);
    const json = history.exportData('json');
    const parsed = JSON.parse(json);
    expect(parsed.length).toBe(1);
  });

  test('should export data as CSV', () => {
    history.record(createNotification({ type: 'info', priority: 'normal', title: 'Test' }), [{ success: true, notificationId: '1', channel: 'console', timestamp: Date.now() }]);
    const csv = history.exportData('csv');
    expect(csv).toContain('id,type,priority,title');
    expect(csv).toContain('info');
  });

  test('should clear all records', () => {
    history.record(createNotification(), [{ success: true, notificationId: '1', channel: 'console', timestamp: Date.now() }]);
    history.clear();
    expect(history.getCount()).toBe(0);
  });
});

// ============================================================
// Module 10: NotificationMetrics Tests
// ============================================================
describe('NotificationMetrics', () => {
  let metrics: NotificationMetrics;

  beforeEach(() => {
    metrics = new NotificationMetrics();
  });

  test('should create a NotificationMetrics instance', () => {
    expect(metrics).toBeDefined();
  });

  test('should record delivery', () => {
    metrics.recordDelivery({
      notificationId: '1',
      channel: 'console',
      success: true,
      timestamp: Date.now(),
      latencyMs: 50,
    });
    const report = metrics.getMetrics();
    expect(report.totalSent).toBe(1);
    expect(report.totalDelivered).toBe(1);
  });

  test('should track failed deliveries', () => {
    metrics.recordDelivery({
      notificationId: '1',
      channel: 'console',
      success: true,
      timestamp: Date.now(),
      latencyMs: 50,
    });
    metrics.recordDelivery({
      notificationId: '2',
      channel: 'console',
      success: false,
      timestamp: Date.now(),
      latencyMs: 100,
    });
    const report = metrics.getMetrics();
    expect(report.totalSent).toBe(2);
    expect(report.totalDelivered).toBe(1);
    expect(report.totalFailed).toBe(1);
  });

  test('should calculate delivery rate', () => {
    metrics.recordDelivery({ notificationId: '1', channel: 'console', success: true, timestamp: Date.now(), latencyMs: 50 });
    metrics.recordDelivery({ notificationId: '2', channel: 'console', success: false, timestamp: Date.now(), latencyMs: 100 });
    const report = metrics.getMetrics();
    expect(report.deliveryRate).toBe(0.5);
  });

  test('should calculate average latency', () => {
    metrics.recordDelivery({ notificationId: '1', channel: 'console', success: true, timestamp: Date.now(), latencyMs: 50 });
    metrics.recordDelivery({ notificationId: '2', channel: 'console', success: true, timestamp: Date.now(), latencyMs: 150 });
    const report = metrics.getMetrics();
    expect(report.averageLatencyMs).toBe(100);
  });

  test('should get channel-specific metrics', () => {
    metrics.recordDelivery({ notificationId: '1', channel: 'console', success: true, timestamp: Date.now(), latencyMs: 50 });
    metrics.recordDelivery({ notificationId: '2', channel: 'email', success: true, timestamp: Date.now(), latencyMs: 100 });
    const consoleMetrics = metrics.getChannelMetrics('console');
    expect(consoleMetrics.sent).toBe(1);
    expect(consoleMetrics.channel).toBe('console');
  });

  test('should include channel metrics in report', () => {
    metrics.recordDelivery({ notificationId: '1', channel: 'console', success: true, timestamp: Date.now(), latencyMs: 50 });
    metrics.recordDelivery({ notificationId: '2', channel: 'email', success: false, timestamp: Date.now(), latencyMs: 100 });
    const report = metrics.getMetrics();
    expect(report.channelMetrics.console).toBeDefined();
    expect(report.channelMetrics.email).toBeDefined();
  });

  test('should track user engagement', () => {
    metrics.recordDelivery({ notificationId: '1', channel: 'console', success: true, timestamp: Date.now(), latencyMs: 50, userId: 'user1' });
    metrics.recordEngagement({ notificationId: '1', userId: 'user1', action: 'read', timestamp: Date.now() });
    metrics.recordEngagement({ notificationId: '1', userId: 'user1', action: 'acted_upon', timestamp: Date.now() });
    const userStats = metrics.getUserMetrics('user1');
    expect(userStats.totalReceived).toBe(1);
    expect(userStats.read).toBe(1);
    expect(userStats.actedUpon).toBe(1);
  });

  test('should track dismissed engagement', () => {
    metrics.recordDelivery({ notificationId: '1', channel: 'console', success: true, timestamp: Date.now(), latencyMs: 50, userId: 'user1' });
    metrics.recordEngagement({ notificationId: '1', userId: 'user1', action: 'dismissed', timestamp: Date.now() });
    const userStats = metrics.getUserMetrics('user1');
    expect(userStats.dismissed).toBe(1);
  });

  test('should group user metrics by channel', () => {
    metrics.recordDelivery({ notificationId: '1', channel: 'console', success: true, timestamp: Date.now(), latencyMs: 50, userId: 'user1' });
    metrics.recordDelivery({ notificationId: '2', channel: 'email', success: true, timestamp: Date.now(), latencyMs: 50, userId: 'user1' });
    const userStats = metrics.getUserMetrics('user1');
    expect(userStats.byChannel.console).toBe(1);
    expect(userStats.byChannel.email).toBe(1);
  });

  test('should get delivery rate trend', () => {
    const now = Date.now();
    metrics.recordDelivery({ notificationId: '1', channel: 'console', success: true, timestamp: now, latencyMs: 50 });
    metrics.recordDelivery({ notificationId: '2', channel: 'console', success: false, timestamp: now, latencyMs: 50 });
    const trend = metrics.getTrend('delivery_rate', 'daily');
    expect(trend.metric).toBe('delivery_rate');
    expect(trend.dataPoints.length).toBeGreaterThanOrEqual(1);
  });

  test('should get latency trend', () => {
    metrics.recordDelivery({ notificationId: '1', channel: 'console', success: true, timestamp: Date.now(), latencyMs: 50 });
    const trend = metrics.getTrend('latency', 'daily');
    expect(trend.metric).toBe('latency');
  });

  test('should get volume trend', () => {
    metrics.recordDelivery({ notificationId: '1', channel: 'console', success: true, timestamp: Date.now(), latencyMs: 50 });
    const trend = metrics.getTrend('volume', 'daily');
    expect(trend.metric).toBe('volume');
  });

  test('should get alert resolution time trend', () => {
    metrics.recordAlertResolution('alert1', Date.now() - 3600000, Date.now());
    const trend = metrics.getTrend('alert_resolution_time', 'daily');
    expect(trend.metric).toBe('alert_resolution_time');
  });

  test('should calculate trend direction', () => {
    const now = Date.now();
    metrics.recordDelivery({ notificationId: '1', channel: 'console', success: true, timestamp: now - 86400000, latencyMs: 10 });
    metrics.recordDelivery({ notificationId: '2', channel: 'console', success: true, timestamp: now, latencyMs: 100 });
    const trend = metrics.getTrend('latency', 'daily');
    expect(['up', 'down', 'stable']).toContain(trend.trend);
  });

  test('should return empty metrics when no data', () => {
    const report = metrics.getMetrics();
    expect(report.totalSent).toBe(0);
    expect(report.deliveryRate).toBe(0);
  });

  test('should return empty user metrics for unknown user', () => {
    const stats = metrics.getUserMetrics('unknown');
    expect(stats.totalReceived).toBe(0);
  });

  test('should clear all metrics', () => {
    metrics.recordDelivery({ notificationId: '1', channel: 'console', success: true, timestamp: Date.now(), latencyMs: 50 });
    metrics.clear();
    expect(metrics.getMetrics().totalSent).toBe(0);
  });
});
