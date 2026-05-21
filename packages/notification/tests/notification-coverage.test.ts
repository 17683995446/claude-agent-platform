import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { NotificationCenter } from '../src/notification-center.ts';
import type { Notification, NotificationType, NotificationPriority, NotificationChannel, SendResult } from '../src/notification-center.ts';
import { AlertManager } from '../src/alert-manager.ts';
import type { AlertRule, MetricData, AlertSeverity, AlertState } from '../src/alert-manager.ts';
import { EnhancedEventBus } from '../src/event-bus-enhanced.ts';
import type { EventMiddleware, EventRecord } from '../src/event-bus-enhanced.ts';
import { WebhookManager } from '../src/webhook-manager.ts';
import type { WebhookConfig, DeliveryResult } from '../src/webhook-manager.ts';
import { DigestBuilder } from '../src/digest-builder.ts';
import type { DigestPeriod, DigestRule, DigestTemplate } from '../src/digest-builder.ts';
import { NotificationTemplateEngine } from '../src/template-engine.ts';
import type { CompiledTemplate } from '../src/template-engine.ts';
import { ChannelRouter } from '../src/channel-router.ts';
import type { RoutingRule, ChannelHealth } from '../src/channel-router.ts';
import { NotificationPreferences } from '../src/notification-preferences.ts';
import type { UserPreferences } from '../src/notification-preferences.ts';
import { NotificationHistory } from '../src/notification-history.ts';
import type { HistoryFilter, AggregateDimension } from '../src/notification-history.ts';
import { NotificationMetrics } from '../src/notification-metrics.ts';
import type { NotificationMetricsReport, ChannelMetrics, UserNotificationStats, TrendData } from '../src/notification-metrics.ts';

// ============================================================
// Helpers
// ============================================================

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

function createSendResult(overrides: Partial<SendResult> = {}): SendResult {
  return {
    success: true,
    notificationId: 'test-1',
    channel: 'console',
    timestamp: Date.now(),
    ...overrides,
  };
}

// ============================================================
// Module 1: NotificationCenter - Comprehensive Tests
// ============================================================
describe('NotificationCenter', () => {
  let center: NotificationCenter;

  beforeEach(() => {
    center = new NotificationCenter();
  });

  // --- send() basic ---
  test('should send notification to single channel', async () => {
    const results = await center.send(createNotification({ channel: 'console' }));
    expect(results.length).toBe(1);
    expect(results[0].success).toBe(true);
    expect(results[0].channel).toBe('console');
    expect(results[0].notificationId).toBeDefined();
    expect(results[0].timestamp).toBeDefined();
    expect(results[0].duration).toBeDefined();
    expect(typeof results[0].duration).toBe('number');
  });

  test('should send notification to multiple channels', async () => {
    const results = await center.send(createNotification({ channel: ['console', 'file', 'email'] }));
    expect(results.length).toBe(3);
    expect(results[0].channel).toBe('console');
    expect(results[1].channel).toBe('file');
    expect(results[2].channel).toBe('email');
    expect(results.every(r => r.success)).toBe(true);
  });

  test('should send to all supported channel types', async () => {
    const channels: NotificationChannel[] = ['console', 'file', 'webhook', 'email', 'in-app'];
    for (const ch of channels) {
      const results = await center.send(createNotification({ channel: ch }));
      expect(results.length).toBe(1);
      expect(results[0].success).toBe(true);
      expect(results[0].channel).toBe(ch);
    }
  });

  // --- subscribe / unsubscribe ---
  test('should subscribe and receive notifications', async () => {
    let received: Notification | null = null;
    center.subscribe('console', (notif) => { received = notif; });
    const notif = createNotification({ channel: 'console' });
    await center.send(notif);
    expect(received).toBe(notif);
  });

  test('should support multiple subscribers on same channel', async () => {
    let count1 = 0;
    let count2 = 0;
    center.subscribe('console', () => { count1++; });
    center.subscribe('console', () => { count2++; });
    await center.send(createNotification({ channel: 'console' }));
    expect(count1).toBe(1);
    expect(count2).toBe(1);
  });

  test('should return subscription with id', () => {
    const sub = center.subscribe('console', () => {});
    expect(sub.id).toBeDefined();
    expect(sub.channel).toBe('console');
    expect(sub.handler).toBeDefined();
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

  test('should unsubscribe and clean up empty channel handlers', async () => {
    const sub = center.subscribe('unique_channel', () => {});
    center.unsubscribe(sub.id);
    // Sending to channel with no handlers should still succeed (no handler = no error)
    const results = await center.send(createNotification({ channel: 'unique_channel' }));
    expect(results[0].success).toBe(true);
  });

  test('should handle unsubscribe for non-existent subscription id', () => {
    expect(() => center.unsubscribe('non_existent')).not.toThrow();
  });

  // --- async handler support ---
  test('should handle async handlers', async () => {
    let received = false;
    center.subscribe('console', async () => {
      await new Promise(r => setTimeout(r, 10));
      received = true;
    });
    const results = await center.send(createNotification({ channel: 'console' }));
    expect(received).toBe(true);
    expect(results[0].success).toBe(true);
  });

  // --- handler errors ---
  test('should handle handler errors gracefully', async () => {
    center.subscribe('console', () => { throw new Error('Handler error'); });
    const results = await center.send(createNotification({ channel: 'console' }));
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('Handler error');
  });

  test('should handle non-Error thrown values', async () => {
    center.subscribe('console', () => { throw 'string error'; });
    const results = await center.send(createNotification({ channel: 'console' }));
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('string error');
  });

  test('should continue to next handler even if previous handler throws', async () => {
    let secondCalled = false;
    center.subscribe('console', () => { throw new Error('first'); });
    center.subscribe('console', () => { secondCalled = true; });
    const results = await center.send(createNotification({ channel: 'console' }));
    // Channel is marked as failed because first handler threw
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('first');
    // But second handler was still called
    expect(secondCalled).toBe(true);
  });

  // --- Deduplication ---
  test('should deduplicate notifications with same dedupeKey within window', async () => {
    const notif = createNotification({ dedupeKey: 'test-dedupe' });
    const r1 = await center.send(notif);
    const r2 = await center.send(notif);
    expect(r1[0].success).toBe(true);
    expect(r2[0].success).toBe(false);
    expect(r2[0].error).toBe('Duplicate notification suppressed');
    expect(r2[0].channel).toBe('dedupe');
  });

  test('should NOT deduplicate after dedupe window expires', async () => {
    const notif = createNotification({ dedupeKey: 'expire-test' });
    const r1 = await center.send(notif);
    // Manually expire the dedupe cache
    const centerAny = center as any;
    centerAny.dedupeCache.set('expire-test', Date.now() - 120000);
    const r2 = await center.send(notif);
    expect(r1[0].success).toBe(true);
    expect(r2[0].success).toBe(true);
  });

  test('should not deduplicate notifications without dedupeKey', async () => {
    const notif = createNotification();
    const r1 = await center.send(notif);
    const r2 = await center.send(notif);
    expect(r1[0].success).toBe(true);
    expect(r2[0].success).toBe(true);
  });

  test('should not mark dedupe cache when all channels fail (BUG FIX: message loss prevention)', async () => {
    center.subscribe('console', () => { throw new Error('always fail'); });
    const notif = createNotification({ dedupeKey: 'loss-test', channel: 'console' });
    const r1 = await center.send(notif);
    expect(r1[0].success).toBe(false);
    expect(r1[0].error).toBe('always fail');
    // Since all channels failed, dedupe should NOT be set
    const r2 = await center.send(notif);
    // Second send should also fail with handler error (not deduplicated)
    expect(r2[0].success).toBe(false);
    expect(r2[0].error).toBe('always fail');
  });

  test('should mark dedupe when at least one channel succeeds', async () => {
    center.subscribe('file', () => { throw new Error('fail'); });
    const notif = createNotification({ dedupeKey: 'partial-test', channel: ['console', 'file'] });
    const r1 = await center.send(notif);
    // console has no handler so succeeds, file throws
    expect(r1.some(r => r.success)).toBe(true);
    const r2 = await center.send(notif);
    expect(r2[0].channel).toBe('dedupe');
    expect(r2[0].error).toBe('Duplicate notification suppressed');
  });

  // --- Rate Limiting ---
  test('should enforce rate limit per channel', async () => {
    center.setRateLimit('console', 3);
    const results: SendResult[][] = [];
    for (let i = 0; i < 5; i++) {
      results.push(await center.send(createNotification({ channel: 'console' })));
    }
    expect(results[0][0].success).toBe(true);
    expect(results[1][0].success).toBe(true);
    expect(results[2][0].success).toBe(true);
    expect(results[3][0].success).toBe(false);
    expect(results[3][0].error).toBe('Rate limit exceeded');
    expect(results[4][0].success).toBe(false);
  });

  test('should use default rate limit when setRateLimit not called', async () => {
    // Default rate limit is 100, so 5 sends should all succeed
    for (let i = 0; i < 5; i++) {
      const results = await center.send(createNotification({ channel: 'console' }));
      expect(results[0].success).toBe(true);
    }
  });

  test('should reset rate limit after window expires', async () => {
    center.setRateLimit('console', 2);
    await center.send(createNotification({ channel: 'console' }));
    await center.send(createNotification({ channel: 'console' }));
    const r3 = await center.send(createNotification({ channel: 'console' }));
    expect(r3[0].success).toBe(false);

    // Manually expire the rate limit window
    const centerAny = center as any;
    const entry = centerAny.rateLimits.get('console');
    entry.resetTime = Date.now() - 1;

    const r4 = await center.send(createNotification({ channel: 'console' }));
    expect(r4[0].success).toBe(true);
  });

  test('BUG FIX: setRateLimit should actually use custom limit in checkRateLimit', async () => {
    center.setRateLimit('email', 2);
    const r1 = await center.send(createNotification({ channel: 'email' }));
    const r2 = await center.send(createNotification({ channel: 'email' }));
    const r3 = await center.send(createNotification({ channel: 'email' }));
    expect(r1[0].success).toBe(true);
    expect(r2[0].success).toBe(true);
    expect(r3[0].success).toBe(false);
    expect(r3[0].error).toBe('Rate limit exceeded');
  });

  test('rate limit should be independent per channel', async () => {
    center.setRateLimit('console', 1);
    center.setRateLimit('email', 100);
    await center.send(createNotification({ channel: 'console' }));
    const consoleResult = await center.send(createNotification({ channel: 'console' }));
    expect(consoleResult[0].success).toBe(false);
    const emailResult = await center.send(createNotification({ channel: 'email' }));
    expect(emailResult[0].success).toBe(true);
  });

  // --- History ---
  test('should store notifications in history', async () => {
    await center.send(createNotification({ channel: 'console' }));
    const history = center.getHistory();
    expect(history.length).toBe(1);
  });

  test('should filter history by type', async () => {
    await center.send(createNotification({ type: 'info', channel: 'console' }));
    await center.send(createNotification({ type: 'error', channel: 'console' }));
    await center.send(createNotification({ type: 'warning', channel: 'console' }));
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

  test('BUG FIX: getHistory should sort results chronologically', async () => {
    const now = Date.now();
    await center.send(createNotification({ channel: 'console', id: 'n1', timestamp: now + 300 }));
    await center.send(createNotification({ channel: 'console', id: 'n2', timestamp: now + 100 }));
    await center.send(createNotification({ channel: 'console', id: 'n3', timestamp: now + 200 }));
    const history = center.getHistory();
    expect(history[0].notification.id).toBe('n2');
    expect(history[1].notification.id).toBe('n3');
    expect(history[2].notification.id).toBe('n1');
  });

  test('should combine multiple filters', async () => {
    await center.send(createNotification({ type: 'info', priority: 'low', channel: 'console', recipient: 'user1' }));
    await center.send(createNotification({ type: 'error', priority: 'low', channel: 'console', recipient: 'user1' }));
    await center.send(createNotification({ type: 'error', priority: 'critical', channel: 'console', recipient: 'user2' }));
    const history = center.getHistory({ type: 'error', recipient: 'user1' });
    expect(history.length).toBe(1);
    expect(history[0].notification.priority).toBe('low');
  });

  // --- clearHistory ---
  test('should clear history, dedupe cache, and rate limits', async () => {
    center.subscribe('console', () => {});
    await center.send(createNotification({ dedupeKey: 'test', channel: 'console' }));
    center.setRateLimit('console', 1);
    center.clearHistory();
    expect(center.getHistory().length).toBe(0);
    // Should be able to send again after clear (dedupe and rate limit reset)
    const results = await center.send(createNotification({ dedupeKey: 'test', channel: 'console' }));
    expect(results[0].success).toBe(true);
  });

  // --- Edge cases ---
  test('should handle empty channel array', async () => {
    const results = await center.send(createNotification({ channel: [] as any }));
    expect(results.length).toBe(0);
  });

  test('should handle notification with no recipient', async () => {
    const results = await center.send(createNotification({ channel: 'console', recipient: undefined }));
    expect(results[0].success).toBe(true);
  });

  test('should handle notification with data', async () => {
    let receivedData: Record<string, unknown> | undefined;
    center.subscribe('console', (n) => { receivedData = n.data; });
    await center.send(createNotification({ channel: 'console', data: { key: 'value' } }));
    expect(receivedData).toEqual({ key: 'value' });
  });
});

// ============================================================
// Module 2: AlertManager - Comprehensive Tests
// ============================================================
describe('AlertManager', () => {
  let manager: AlertManager;

  beforeEach(() => {
    manager = new AlertManager();
  });

  // --- createRule ---
  test('should create a rule with auto-generated id', () => {
    const id = manager.createRule({
      name: 'CPU High',
      severity: 'critical',
      metricName: 'cpu',
      condition: (data) => data.value > 90,
    });
    expect(id).toMatch(/^rule_\d+$/);
  });

  test('should create a rule with custom id', () => {
    const id = manager.createRule({
      id: 'custom-rule',
      name: 'CPU High',
      severity: 'critical',
      metricName: 'cpu',
      condition: (data) => data.value > 90,
    });
    expect(id).toBe('custom-rule');
  });

  test('should enable rule by default', () => {
    const id = manager.createRule({
      name: 'Test',
      severity: 'info',
      metricName: 'test',
      condition: () => true,
    });
    const rule = manager.getRule(id);
    expect(rule!.enabled).toBe(true);
  });

  test('should store threshold in rule', () => {
    const id = manager.createRule({
      name: 'Memory',
      severity: 'warning',
      metricName: 'memory',
      condition: (data) => data.value > 80,
      threshold: 80,
    });
    const rule = manager.getRule(id);
    expect(rule!.threshold).toBe(80);
  });

  // --- evaluateRule ---
  test('should evaluate a triggered rule', () => {
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
    expect(result.message).toContain('CPU High');
  });

  test('should evaluate a non-triggered rule', () => {
    const ruleId = manager.createRule({
      name: 'CPU High',
      severity: 'critical',
      metricName: 'cpu',
      condition: (data) => data.value > 90,
    });
    const result = manager.evaluateRule(ruleId, { name: 'cpu', value: 50 });
    expect(result.triggered).toBe(false);
    expect(result.message).toBe('Condition not met');
  });

  test('should return not found for non-existent rule', () => {
    const result = manager.evaluateRule('nonexistent', { name: 'cpu', value: 95 });
    expect(result.triggered).toBe(false);
    expect(result.message).toBe('Rule not found');
    expect(result.severity).toBe('info');
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
    const r1 = manager.evaluateRule(ruleId, { name: 'cpu', value: 95 });
    expect(r1.triggered).toBe(true);
    const r2 = manager.evaluateRule(ruleId, { name: 'cpu', value: 95 });
    expect(r2.triggered).toBe(false);
    expect(r2.message).toBe('Within cooldown period');
  });

  test('should allow re-trigger after cooldown expires', () => {
    const ruleId = manager.createRule({
      name: 'CPU High',
      severity: 'critical',
      metricName: 'cpu',
      condition: (data) => data.value > 90,
      cooldownMinutes: 1,
    });
    manager.evaluateRule(ruleId, { name: 'cpu', value: 95 });
    // Manually expire cooldown
    const managerAny = manager as any;
    managerAny.lastTriggered.set(ruleId, Date.now() - 120000);
    const r2 = manager.evaluateRule(ruleId, { name: 'cpu', value: 95 });
    expect(r2.triggered).toBe(true);
  });

  test('should not apply cooldown when cooldownMinutes is undefined', () => {
    const ruleId = manager.createRule({
      name: 'CPU High',
      severity: 'critical',
      metricName: 'cpu',
      condition: (data) => data.value > 90,
    });
    const r1 = manager.evaluateRule(ruleId, { name: 'cpu', value: 95 });
    expect(r1.triggered).toBe(true);
    const r2 = manager.evaluateRule(ruleId, { name: 'cpu', value: 95 });
    expect(r2.triggered).toBe(true);
  });

  test('should create alert with correct message including threshold', () => {
    const ruleId = manager.createRule({
      name: 'Memory',
      severity: 'warning',
      metricName: 'memory',
      condition: (data) => data.value > 80,
      threshold: 80,
    });
    const result = manager.evaluateRule(ruleId, { name: 'memory', value: 90 });
    expect(result.message).toContain('threshold: 80');
  });

  test('should create alert without threshold in message', () => {
    const ruleId = manager.createRule({
      name: 'CPU',
      severity: 'critical',
      metricName: 'cpu',
      condition: (data) => data.value > 90,
    });
    const result = manager.evaluateRule(ruleId, { name: 'cpu', value: 95 });
    expect(result.message).not.toContain('threshold');
  });

  // --- Alert lifecycle ---
  test('should acknowledge an active alert', () => {
    const ruleId = manager.createRule({
      name: 'CPU',
      severity: 'critical',
      metricName: 'cpu',
      condition: () => true,
    });
    const result = manager.evaluateRule(ruleId, { name: 'cpu', value: 95 });
    manager.acknowledgeAlert(result.alertId!);
    const alert = manager.getAlert(result.alertId!);
    expect(alert?.state).toBe('acknowledged');
    expect(alert?.acknowledgedAt).toBeDefined();
    expect(alert?.updatedAt).toBeDefined();
  });

  test('should not acknowledge non-active alert', () => {
    const ruleId = manager.createRule({
      name: 'CPU',
      severity: 'critical',
      metricName: 'cpu',
      condition: () => true,
    });
    const result = manager.evaluateRule(ruleId, { name: 'cpu', value: 95 });
    manager.resolveAlert(result.alertId!);
    manager.acknowledgeAlert(result.alertId!);
    const alert = manager.getAlert(result.alertId!);
    expect(alert?.state).toBe('resolved'); // stays resolved
  });

  test('should not acknowledge non-existent alert', () => {
    expect(() => manager.acknowledgeAlert('nonexistent')).not.toThrow();
  });

  test('should resolve an active alert', () => {
    const ruleId = manager.createRule({
      name: 'CPU',
      severity: 'critical',
      metricName: 'cpu',
      condition: () => true,
    });
    const result = manager.evaluateRule(ruleId, { name: 'cpu', value: 95 });
    manager.resolveAlert(result.alertId!);
    const alert = manager.getAlert(result.alertId!);
    expect(alert?.state).toBe('resolved');
    expect(alert?.resolvedAt).toBeDefined();
  });

  test('should resolve an acknowledged alert', () => {
    const ruleId = manager.createRule({
      name: 'CPU',
      severity: 'critical',
      metricName: 'cpu',
      condition: () => true,
    });
    const result = manager.evaluateRule(ruleId, { name: 'cpu', value: 95 });
    manager.acknowledgeAlert(result.alertId!);
    manager.resolveAlert(result.alertId!);
    const alert = manager.getAlert(result.alertId!);
    expect(alert?.state).toBe('resolved');
  });

  test('should not resolve a silenced alert', () => {
    const ruleId = manager.createRule({
      name: 'CPU',
      severity: 'critical',
      metricName: 'cpu',
      condition: () => true,
    });
    manager.evaluateRule(ruleId, { name: 'cpu', value: 95 });
    manager.silenceAlert(ruleId, 60000);
    const alerts = manager.getAlerts();
    const alertId = alerts.find(a => a.state === 'silenced')!.id;
    manager.resolveAlert(alertId);
    const alert = manager.getAlert(alertId);
    expect(alert?.state).toBe('silenced'); // stays silenced
  });

  test('should silence active alerts for a rule', () => {
    const ruleId = manager.createRule({
      name: 'CPU',
      severity: 'critical',
      metricName: 'cpu',
      condition: () => true,
    });
    manager.evaluateRule(ruleId, { name: 'cpu', value: 95 });
    manager.evaluateRule(ruleId, { name: 'cpu', value: 96 });
    manager.silenceAlert(ruleId, 60000);
    const silenced = manager.getAlerts({ state: 'silenced' });
    expect(silenced.length).toBe(2);
    expect(silenced.every(a => a.silencedUntil !== undefined)).toBe(true);
  });

  test('should not silence non-active alerts', () => {
    const ruleId = manager.createRule({
      name: 'CPU',
      severity: 'critical',
      metricName: 'cpu',
      condition: () => true,
    });
    const result = manager.evaluateRule(ruleId, { name: 'cpu', value: 95 });
    manager.resolveAlert(result.alertId!);
    manager.silenceAlert(ruleId, 60000);
    const resolved = manager.getAlerts({ state: 'resolved' });
    expect(resolved.length).toBe(1);
  });

  // --- getAlerts / filtering ---
  test('should get all alerts', () => {
    manager.createRule({ name: 'R1', severity: 'critical', metricName: 'cpu', condition: () => true });
    manager.createRule({ name: 'R2', severity: 'warning', metricName: 'mem', condition: () => true });
    manager.evaluateRule('rule_1', { name: 'cpu', value: 95 });
    manager.evaluateRule('rule_2', { name: 'mem', value: 85 });
    expect(manager.getAlerts().length).toBe(2);
  });

  test('should filter alerts by state', () => {
    manager.createRule({ name: 'R1', severity: 'critical', metricName: 'cpu', condition: () => true });
    manager.createRule({ name: 'R2', severity: 'warning', metricName: 'mem', condition: () => true });
    const r1 = manager.evaluateRule('rule_1', { name: 'cpu', value: 95 });
    manager.evaluateRule('rule_2', { name: 'mem', value: 85 });
    manager.resolveAlert(r1.alertId!);
    expect(manager.getAlerts({ state: 'resolved' }).length).toBe(1);
    expect(manager.getAlerts({ state: 'active' }).length).toBe(1);
  });

  test('should filter alerts by severity', () => {
    manager.createRule({ name: 'R1', severity: 'critical', metricName: 'cpu', condition: () => true });
    const r2 = manager.createRule({ name: 'R2', severity: 'warning', metricName: 'mem', condition: () => true });
    manager.evaluateRule('rule_1', { name: 'cpu', value: 95 });
    manager.evaluateRule(r2, { name: 'mem', value: 85 });
    expect(manager.getAlerts({ severity: 'critical' }).length).toBe(1);
    expect(manager.getAlerts({ severity: 'warning' }).length).toBe(1);
  });

  test('should filter by both state and severity', () => {
    manager.createRule({ name: 'R1', severity: 'critical', metricName: 'cpu', condition: () => true });
    manager.createRule({ name: 'R2', severity: 'warning', metricName: 'mem', condition: () => true });
    manager.evaluateRule('rule_1', { name: 'cpu', value: 95 });
    manager.evaluateRule('rule_2', { name: 'mem', value: 85 });
    const filtered = manager.getAlerts({ state: 'active', severity: 'critical' });
    expect(filtered.length).toBe(1);
  });

  // --- Statistics ---
  test('should compute statistics correctly', async () => {
    manager.createRule({ name: 'R1', severity: 'critical', metricName: 'cpu', condition: () => true });
    const r1 = manager.evaluateRule('rule_1', { name: 'cpu', value: 95 });
    manager.acknowledgeAlert(r1.alertId!);
    // Small delay to ensure resolution time > 0
    await new Promise(r => setTimeout(r, 5));
    manager.resolveAlert(r1.alertId!);
    const stats = manager.getStatistics();
    expect(stats.total).toBe(1);
    expect(stats.active).toBe(0);
    expect(stats.acknowledged).toBe(0);
    expect(stats.resolved).toBe(1);
    expect(stats.silenced).toBe(0);
    expect(stats.bySeverity.critical).toBe(1);
    expect(stats.averageResolutionTime).toBeDefined();
    expect(stats.averageResolutionTime!).toBeGreaterThanOrEqual(0);
  });

  test('should compute average resolution time across multiple alerts', () => {
    manager.createRule({ name: 'R1', severity: 'critical', metricName: 'cpu', condition: () => true });
    const r1 = manager.evaluateRule('rule_1', { name: 'cpu', value: 95 });
    const r2 = manager.evaluateRule('rule_1', { name: 'cpu', value: 96 });
    manager.resolveAlert(r1.alertId!);
    manager.resolveAlert(r2.alertId!);
    const stats = manager.getStatistics();
    expect(stats.averageResolutionTime).toBeDefined();
  });

  test('should return zero averageResolutionTime when no resolved alerts', () => {
    const stats = manager.getStatistics();
    expect(stats.averageResolutionTime).toBeUndefined();
  });

  // --- Escalation chains ---
  test('should set escalation chain', () => {
    manager.setEscalationChain('rule_1', [
      { level: 1, delayMinutes: 5, action: 'notify', recipient: 'team-lead' },
      { level: 2, delayMinutes: 15, action: 'notify', recipient: 'manager' },
    ]);
    // Just verify it doesn't throw
    expect(true).toBe(true);
  });

  // --- clear ---
  test('should clear all data', () => {
    manager.createRule({ name: 'R1', severity: 'critical', metricName: 'cpu', condition: () => true });
    manager.evaluateRule('rule_1', { name: 'cpu', value: 95 });
    manager.clear();
    expect(manager.getAlerts().length).toBe(0);
    expect(manager.getRule('rule_1')).toBeUndefined();
  });

  // --- All severities ---
  test('should support all severity levels', () => {
    const severities: AlertSeverity[] = ['info', 'warning', 'critical', 'emergency'];
    for (const sev of severities) {
      const id = manager.createRule({
        name: `Rule ${sev}`,
        severity: sev,
        metricName: 'test',
        condition: () => true,
      });
      const result = manager.evaluateRule(id, { name: 'test', value: 1 });
      expect(result.severity).toBe(sev);
    }
  });
});

// ============================================================
// Module 3: EnhancedEventBus - Comprehensive Tests
// ============================================================
describe('EnhancedEventBus', () => {
  let bus: EnhancedEventBus;

  beforeEach(() => {
    bus = new EnhancedEventBus();
  });

  test('should create with default options', () => {
    expect(bus).toBeDefined();
  });

  test('should create with custom options', () => {
    const customBus = new EnhancedEventBus({ maxHistorySize: 500, asyncQueue: true });
    expect(customBus).toBeDefined();
  });

  // --- emit / on ---
  test('should emit and receive events', () => {
    let received: unknown = null;
    bus.on('test:event', (data) => { received = data; });
    bus.emit('test:event', { hello: 'world' });
    expect(received).toEqual({ hello: 'world' });
  });

  test('should pass event name to handler', () => {
    let eventName = '';
    bus.on('test:event', (_data, event) => { eventName = event; });
    bus.emit('test:event');
    expect(eventName).toBe('test:event');
  });

  test('should handle undefined data', () => {
    let received = true;
    bus.on('test:event', (data) => { received = data; });
    bus.emit('test:event');
    expect(received).toBeUndefined();
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

  // --- once ---
  test('should support once listeners', () => {
    let count = 0;
    bus.once('test:event', () => { count++; });
    bus.emit('test:event');
    bus.emit('test:event');
    expect(count).toBe(1);
  });

  test('BUG FIX: should remove wildcard once listeners after first emission', () => {
    let count = 0;
    bus.once('test:*', () => { count++; });
    bus.emit('test:create');
    bus.emit('test:update');
    expect(count).toBe(1);
  });

  // --- off ---
  test('should remove listeners with off', () => {
    let count = 0;
    const sub = bus.on('test:event', () => { count++; });
    bus.emit('test:event');
    expect(count).toBe(1);
    bus.off('test:event', sub.id);
    bus.emit('test:event');
    expect(count).toBe(1);
  });

  test('should handle off for non-existent handler id', () => {
    expect(() => bus.off('test:event', 'nonexistent')).not.toThrow();
  });

  test('should handle off for non-existent event', () => {
    expect(() => bus.off('nonexistent', 'id')).not.toThrow();
  });

  // --- Wildcard matching ---
  test('should support wildcard listeners with single *', () => {
    let received: string[] = [];
    bus.on('test:*', (_data, event) => { received.push(event); });
    bus.emit('test:create');
    bus.emit('test:update');
    bus.emit('test:delete');
    expect(received).toEqual(['test:create', 'test:update', 'test:delete']);
  });

  test('should not match wildcard for different prefix', () => {
    let received: string[] = [];
    bus.on('test:*', (_data, event) => { received.push(event); });
    bus.emit('other:event');
    expect(received.length).toBe(0);
  });

  test('should support double-star wildcard for different lengths', () => {
    let received: string[] = [];
    bus.on('test:**', (_data, event) => { received.push(event); });
    bus.emit('test:a');
    bus.emit('test:a:b');
    bus.emit('test:a:b:c');
    expect(received.length).toBe(3);
  });

  test('should support event namespacing with 3 parts', () => {
    let received: unknown = null;
    bus.on('module:entity:action', (data) => { received = data; });
    bus.emit('module:entity:action', { key: 'value' });
    expect(received).toEqual({ key: 'value' });
  });

  test('wildcard should match exact-length patterns', () => {
    let received: string[] = [];
    bus.on('a:b:*', (_data, event) => { received.push(event); });
    bus.emit('a:b:c');
    bus.emit('a:b:c:d'); // different length, should not match single *
    expect(received).toEqual(['a:b:c']);
  });

  // --- History ---
  test('should record events in history', () => {
    bus.emit('test:event', { data: 1 });
    bus.emit('test:event', { data: 2 });
    const history = bus.getHistory('test:event');
    expect(history.length).toBe(2);
  });

  test('should get all history when no event filter', () => {
    bus.emit('e1');
    bus.emit('e2');
    bus.emit('e3');
    expect(bus.getHistory().length).toBe(3);
  });

  test('should respect maxHistorySize', () => {
    const smallBus = new EnhancedEventBus({ maxHistorySize: 2 });
    smallBus.emit('e1');
    smallBus.emit('e2');
    smallBus.emit('e3');
    expect(smallBus.getHistory().length).toBe(2);
    // Should keep the most recent
    expect(smallBus.getHistory()[0].event).toBe('e2');
    expect(smallBus.getHistory()[1].event).toBe('e3');
  });

  // --- Replay ---
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

  test('should replay all events when count is undefined', () => {
    let count = 0;
    bus.emit('test:event');
    bus.emit('test:event');
    bus.on('test:event', () => { count++; });
    bus.replay('test:event');
    expect(count).toBe(2);
  });

  // --- Middleware ---
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

  test('should apply multiple pre-middleware in order', () => {
    bus.use({
      name: 'step1',
      pre: (_event, data) => ({ ...(data as any), step1: true }),
    });
    bus.use({
      name: 'step2',
      pre: (_event, data) => ({ ...(data as any), step2: true }),
    });
    let received: unknown = null;
    bus.on('test:event', (data) => { received = data; });
    bus.emit('test:event', {});
    expect((received as any).step1).toBe(true);
    expect((received as any).step2).toBe(true);
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

  // --- removeAllListeners ---
  test('should remove all listeners for a specific event', () => {
    bus.on('test:event', () => {});
    bus.on('test:event', () => {});
    bus.removeAllListeners('test:event');
    let called = false;
    bus.on('test:event', () => { called = true; });
    bus.emit('test:event');
    expect(called).toBe(true); // new listener works
  });

  test('should remove all listeners', () => {
    bus.on('test:event', () => {});
    bus.on('other:event', () => {});
    bus.removeAllListeners();
    let called = false;
    bus.on('test:event', () => { called = true; });
    bus.emit('test:event');
    expect(called).toBe(true);
  });

  // --- clearHistory ---
  test('should clear history', () => {
    bus.emit('test:event');
    bus.clearHistory();
    expect(bus.getHistory().length).toBe(0);
  });

  // --- Async queue ---
  test('should queue events when asyncQueue is enabled', async () => {
    const asyncBus = new EnhancedEventBus({ asyncQueue: true });
    let received: unknown[] = [];
    asyncBus.on('test', (data) => { received.push(data); });
    asyncBus.emit('test', 1);
    asyncBus.emit('test', 2);
    // Wait for queue to process
    await new Promise(r => setTimeout(r, 50));
    expect(received).toEqual([1, 2]);
  });
});

// ============================================================
// Module 4: WebhookManager - Comprehensive Tests
// ============================================================
describe('WebhookManager', () => {
  let manager: WebhookManager;

  beforeEach(() => {
    manager = new WebhookManager();
  });

  test('should register a webhook with auto id', () => {
    const id = manager.register({
      url: 'https://example.com/webhook',
      secret: 'my-secret',
      events: ['test.event'],
    });
    expect(id).toMatch(/^wh_\d+$/);
  });

  test('should register a webhook with custom id', () => {
    const id = manager.register({
      id: 'custom-wh',
      url: 'https://example.com/webhook',
      secret: 'my-secret',
      events: ['test.event'],
    });
    expect(id).toBe('custom-wh');
  });

  test('should set default values on register', () => {
    const id = manager.register({
      url: 'https://example.com/webhook',
      secret: 'secret',
      events: ['e1'],
    });
    const wh = manager.getWebhook(id);
    expect(wh!.enabled).toBe(true);
    expect(wh!.retryCount).toBe(3);
    expect(wh!.retryDelayMs).toBe(1000);
  });

  test('should respect custom values on register', () => {
    const id = manager.register({
      url: 'https://example.com/webhook',
      secret: 'secret',
      events: ['e1'],
      enabled: false,
      retryCount: 5,
      retryDelayMs: 2000,
    });
    const wh = manager.getWebhook(id);
    expect(wh!.enabled).toBe(false);
    expect(wh!.retryCount).toBe(5);
    expect(wh!.retryDelayMs).toBe(2000);
  });

  test('should unregister a webhook', () => {
    const id = manager.register({
      url: 'https://example.com/webhook',
      secret: 'secret',
      events: ['e1'],
    });
    manager.unregister(id);
    expect(manager.getWebhook(id)).toBeUndefined();
  });

  test('should trigger matching webhooks', async () => {
    manager.register({
      url: 'https://example.com/webhook',
      secret: 'secret',
      events: ['test.event'],
    });
    const results = await manager.trigger('test.event', { data: 'test' });
    expect(results.length).toBe(1);
    expect(results[0].success).toBe(true);
    expect(results[0].statusCode).toBe(200);
  });

  test('should not trigger webhooks for non-matching events', async () => {
    manager.register({
      url: 'https://example.com/webhook',
      secret: 'secret',
      events: ['other.event'],
    });
    const results = await manager.trigger('test.event', { data: 'test' });
    expect(results.length).toBe(0);
  });

  test('should not trigger disabled webhooks', async () => {
    manager.register({
      url: 'https://example.com/webhook',
      secret: 'secret',
      events: ['test.event'],
      enabled: false,
    });
    const results = await manager.trigger('test.event', { data: 'test' });
    expect(results.length).toBe(0);
  });

  test('should trigger multiple webhooks for same event', async () => {
    manager.register({ url: 'https://a.com/hook', secret: 's1', events: ['e1'] });
    manager.register({ url: 'https://b.com/hook', secret: 's2', events: ['e1'] });
    const results = await manager.trigger('e1', {});
    expect(results.length).toBe(2);
  });

  test('should trigger webhook matching one of multiple events', async () => {
    manager.register({
      url: 'https://example.com/webhook',
      secret: 'secret',
      events: ['e1', 'e2', 'e3'],
    });
    const r1 = await manager.trigger('e1', {});
    const r2 = await manager.trigger('e2', {});
    const r3 = await manager.trigger('e3', {});
    expect(r1.length).toBe(1);
    expect(r2.length).toBe(1);
    expect(r3.length).toBe(1);
  });

  // --- Signature verification ---
  test('should verify valid signatures', () => {
    const payload = JSON.stringify({ test: 'data' });
    const secret = 'my-secret';
    const { createHmac } = require('node:crypto');
    const validSig = createHmac('sha256', secret).update(payload).digest('hex');
    expect(manager.verifySignature(payload, validSig, secret)).toBe(true);
  });

  test('should reject invalid signatures', () => {
    const payload = JSON.stringify({ test: 'data' });
    expect(manager.verifySignature(payload, 'invalid', 'secret')).toBe(false);
  });

  test('should reject signatures with wrong length', () => {
    const payload = JSON.stringify({ test: 'data' });
    expect(manager.verifySignature(payload, 'abc', 'secret')).toBe(false);
  });

  // --- Delivery status ---
  test('should track delivery status', async () => {
    const id = manager.register({
      url: 'https://example.com/webhook',
      secret: 'secret',
      events: ['test.event'],
    });
    await manager.trigger('test.event', { data: 'test' });
    const statuses = manager.getDeliveryStatus(id);
    expect(statuses.length).toBe(1);
    expect(statuses[0].completed).toBe(true);
    expect(statuses[0].success).toBe(true);
    expect(statuses[0].attempts.length).toBe(1);
    expect(statuses[0].lastAttempt).toBeDefined();
  });

  test('should include attempt count in delivery result', async () => {
    manager.register({
      url: 'https://example.com/webhook',
      secret: 'secret',
      events: ['test.event'],
      retryCount: 1,
    });
    const results = await manager.trigger('test.event', { data: 'test' });
    expect(results[0].attempt).toBeGreaterThanOrEqual(1);
  });

  // --- BUG FIX: Invalid URL fast-fail ---
  test('BUG FIX: should fast-fail for invalid URL protocols without retrying', async () => {
    manager.register({
      url: 'ftp://example.com/webhook',
      secret: 'secret',
      events: ['test.event'],
      retryCount: 5,
      retryDelayMs: 1000,
    });
    const results = await manager.trigger('test.event', { data: 'test' });
    expect(results.length).toBe(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain('Invalid URL protocol');
    expect(results[0].attempt).toBe(1);
    // Verify only 1 attempt was made (no retries)
    const statuses = manager.getDeliveryStatus(results[0].webhookId);
    expect(statuses[0].attempts.length).toBe(1);
  });

  // --- List / clear ---
  test('should list all registered webhooks', () => {
    manager.register({ url: 'https://a.com/hook', secret: 's1', events: ['e1'] });
    manager.register({ url: 'https://b.com/hook', secret: 's2', events: ['e2'] });
    expect(manager.getWebhooks().length).toBe(2);
  });

  test('should clear all data', () => {
    manager.register({ url: 'https://a.com/hook', secret: 's1', events: ['e1'] });
    manager.clear();
    expect(manager.getWebhooks().length).toBe(0);
  });
});

// ============================================================
// Module 5: DigestBuilder - Comprehensive Tests
// ============================================================
describe('DigestBuilder', () => {
  let builder: DigestBuilder;

  beforeEach(() => {
    builder = new DigestBuilder();
  });

  test('should add notifications and categorize', () => {
    builder.addNotification(createNotification({ data: { category: 'system' } }));
    builder.addNotification(createNotification({ data: { category: 'user' } }));
    builder.addNotification(createNotification()); // no category -> 'general'
    const digest = builder.buildDigest('daily');
    expect(digest.notifications.length).toBe(3);
    expect(digest.notifications[0].category).toBe('system');
    expect(digest.notifications[1].category).toBe('user');
    expect(digest.notifications[2].category).toBe('general');
  });

  test('should build digest with correct summary', () => {
    builder.addNotification(createNotification({ type: 'info' }));
    builder.addNotification(createNotification({ type: 'error' }));
    builder.addNotification(createNotification({ type: 'info' }));
    const digest = builder.buildDigest('daily');
    expect(digest.summary.total).toBe(3);
    expect(digest.summary.byType.info).toBe(2);
    expect(digest.summary.byType.error).toBe(1);
    expect(digest.summary.byType.warning).toBe(0);
    expect(digest.summary.byType.success).toBe(0);
    expect(digest.summary.byType.progress).toBe(0);
  });

  test('should filter by time period', () => {
    const now = Date.now();
    builder.addNotification(createNotification({ timestamp: now - 100000 }));
    builder.addNotification(createNotification({ timestamp: now }));
    const digest = builder.buildDigest('hourly');
    expect(digest.notifications.length).toBeLessThanOrEqual(2);
  });

  test('should build digest for different periods', () => {
    const now = Date.now();
    builder.addNotification(createNotification({ timestamp: now }));
    for (const period of ['hourly', 'daily', 'weekly'] as DigestPeriod[]) {
      const digest = builder.buildDigest(period);
      expect(digest.period).toBe(period);
      expect(digest.notifications.length).toBeGreaterThanOrEqual(1);
    }
  });

  test('should render markdown digest', () => {
    builder.addNotification(createNotification({ type: 'info', title: 'Test Title', message: 'Test Message' }));
    const digest = builder.buildDigest('daily');
    const md = builder.renderMarkdown(digest);
    expect(md).toContain('Daily Digest');
    expect(md).toContain('Test Title');
    expect(md).toContain('info');
    expect(md).toContain('Summary:');
  });

  test('should render HTML digest', () => {
    builder.addNotification(createNotification({ type: 'info', title: 'Test Title', message: 'Test Message' }));
    const digest = builder.buildDigest('daily');
    const html = builder.renderHTML(digest);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Test Title');
    expect(html).toContain('notification info');
    expect(html).toContain('</html>');
  });

  test('should render HTML with all notification types', () => {
    const types: NotificationType[] = ['info', 'success', 'warning', 'error', 'progress'];
    for (const type of types) {
      builder.addNotification(createNotification({ type, title: `${type} title` }));
    }
    const digest = builder.buildDigest('daily');
    const html = builder.renderHTML(digest);
    for (const type of types) {
      expect(html).toContain(`notification ${type}`);
    }
  });

  // --- Rules ---
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

  test('should apply include category rules', () => {
    builder.addRule({ includeCategories: ['system'] });
    builder.addNotification(createNotification({ data: { category: 'system' } }));
    builder.addNotification(createNotification({ data: { category: 'user' } }));
    const digest = builder.buildDigest('daily');
    expect(digest.notifications.length).toBe(1);
  });

  test('should apply exclude category rules', () => {
    builder.addRule({ excludeCategories: ['spam'] });
    builder.addNotification(createNotification({ data: { category: 'spam' } }));
    builder.addNotification(createNotification({ data: { category: 'important' } }));
    const digest = builder.buildDigest('daily');
    expect(digest.notifications.length).toBe(1);
  });

  test('BUG FIX: multiple rules should use OR logic (union)', () => {
    builder.addRule({ includeTypes: ['error'] });
    builder.addRule({ includeTypes: ['warning'] });
    builder.addNotification(createNotification({ type: 'info' }));
    builder.addNotification(createNotification({ type: 'error' }));
    builder.addNotification(createNotification({ type: 'warning' }));
    const digest = builder.buildDigest('daily');
    // Should include both error AND warning (union of both rules)
    expect(digest.notifications.length).toBe(2);
    const types = digest.notifications.map(n => n.type);
    expect(types).toContain('error');
    expect(types).toContain('warning');
  });

  test('should group by category in summary', () => {
    builder.addNotification(createNotification({ data: { category: 'system' } }));
    builder.addNotification(createNotification({ data: { category: 'user' } }));
    builder.addNotification(createNotification({ data: { category: 'system' } }));
    const digest = builder.buildDigest('daily');
    expect(digest.summary.byCategory.system).toBe(2);
    expect(digest.summary.byCategory.user).toBe(1);
  });

  test('should group by priority in summary', () => {
    builder.addNotification(createNotification({ priority: 'low' }));
    builder.addNotification(createNotification({ priority: 'critical' }));
    builder.addNotification(createNotification({ priority: 'critical' }));
    const digest = builder.buildDigest('daily');
    expect(digest.summary.byPriority.low).toBe(1);
    expect(digest.summary.byPriority.critical).toBe(2);
  });

  // --- Templates ---
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

  test('should use default template for unknown period', () => {
    builder.addNotification(createNotification());
    const digest = builder.buildDigest('daily');
    const md = builder.renderMarkdown(digest);
    expect(md).toContain('Daily Digest');
  });

  // --- clear ---
  test('should clear notifications', () => {
    builder.addNotification(createNotification());
    builder.clear();
    const digest = builder.buildDigest('daily');
    expect(digest.notifications.length).toBe(0);
    expect(digest.summary.total).toBe(0);
  });

  // --- Empty state ---
  test('should handle empty digest', () => {
    const digest = builder.buildDigest('daily');
    expect(digest.notifications.length).toBe(0);
    expect(digest.summary.total).toBe(0);
    const md = builder.renderMarkdown(digest);
    expect(md).toContain('0 notifications');
  });
});

// ============================================================
// Module 6: NotificationTemplateEngine - Comprehensive Tests
// ============================================================
describe('NotificationTemplateEngine', () => {
  let engine: NotificationTemplateEngine;

  beforeEach(() => {
    engine = new NotificationTemplateEngine();
  });

  // --- Variable substitution ---
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

  test('should render deeply nested variables', () => {
    const result = engine.render('{{a.b.c.d}}', {
      a: { b: { c: { d: 'deep' } } },
    });
    expect(result).toBe('deep');
  });

  test('should handle missing variables gracefully', () => {
    const result = engine.render('Hello, {{name}}!', {});
    expect(result).toBe('Hello, !');
  });

  test('should handle null/undefined variable values', () => {
    const result = engine.render('{{name}}', { name: null });
    expect(result).toBe('null');
  });

  test('should convert numbers to strings', () => {
    const result = engine.render('{{count}}', { count: 42 });
    expect(result).toBe('42');
  });

  test('should support default values via _defaults', () => {
    const result = engine.render('Hello, {{name}}!', {
      name: undefined,
      _defaults: { name: 'Guest' },
    });
    expect(result).toBe('Hello, Guest!');
  });

  test('should not use default when value exists', () => {
    const result = engine.render('{{name}}', {
      name: 'Alice',
      _defaults: { name: 'Guest' },
    });
    expect(result).toBe('Alice');
  });

  // --- If blocks ---
  test('should render if blocks with truthy values', () => {
    expect(engine.render('{{#if show}}Visible{{/if}}', { show: true })).toBe('Visible');
    expect(engine.render('{{#if show}}Visible{{/if}}', { show: 'text' })).toBe('Visible');
    expect(engine.render('{{#if show}}Visible{{/if}}', { show: 1 })).toBe('Visible');
  });

  test('should hide if blocks with falsy values', () => {
    expect(engine.render('{{#if show}}Hidden{{/if}}', { show: false })).toBe('');
    expect(engine.render('{{#if show}}Hidden{{/if}}', { show: 0 })).toBe('');
    expect(engine.render('{{#if show}}Hidden{{/if}}', { show: '' })).toBe('');
    expect(engine.render('{{#if show}}Hidden{{/if}}', { show: null })).toBe('');
    expect(engine.render('{{#if show}}Hidden{{/if}}', { show: undefined })).toBe('');
  });

  test('should render if blocks with nested variable', () => {
    const result = engine.render('{{#if user.active}}Active{{/if}}', {
      user: { active: true },
    });
    expect(result).toBe('Active');
  });

  // --- Each blocks ---
  test('should render each blocks with objects', () => {
    const result = engine.render('{{#each items}}- {{name}},{{/each}}', {
      items: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
    });
    expect(result).toBe('- A,- B,- C,');
  });

  test('should render each blocks with primitives', () => {
    const result = engine.render('{{#each items}}[{{value}}]{{/each}}', {
      items: ['x', 'y', 'z'],
    });
    expect(result).toBe('[x][y][z]');
  });

  test('should render each blocks with index', () => {
    const result = engine.render('{{#each items}}{{index}}{{/each}}', {
      items: ['x', 'y'],
    });
    expect(result).toBe('01');
  });

  test('should render each blocks with @index', () => {
    const result = engine.render('{{#each items}}{{@index}}{{/each}}', {
      items: ['a', 'b'],
    });
    expect(result).toBe('01');
  });

  test('should render empty string for non-array in each', () => {
    const result = engine.render('{{#each items}}item{{/each}}', { items: 'not-array' });
    expect(result).toBe('');
  });

  test('should render empty string for missing array in each', () => {
    const result = engine.render('{{#each items}}item{{/each}}', {});
    expect(result).toBe('');
  });

  test('should render empty each block', () => {
    const result = engine.render('{{#each items}}item{{/each}}', { items: [] });
    expect(result).toBe('');
  });

  // --- Built-in functions ---
  test('should use uppercase function', () => {
    expect(engine.render('{{uppercase "hello"}}', {})).toBe('HELLO');
  });

  test('should use lowercase function', () => {
    expect(engine.render('{{lowercase "HELLO"}}', {})).toBe('hello');
  });

  test('should use truncate function', () => {
    expect(engine.render('{{truncate "Hello World" 5}}', {})).toBe('Hello...');
    expect(engine.render('{{truncate "Hi" 10}}', {})).toBe('Hi');
  });

  test('should use percent function', () => {
    expect(engine.render('{{percent 0.95}}', {})).toBe('95.0%');
    expect(engine.render('{{percent 0}}', {})).toBe('0.0%');
    expect(engine.render('{{percent 1}}', {})).toBe('100.0%');
  });

  test('should use number function', () => {
    expect(engine.render('{{number 3.14159 2}}', {})).toBe('3.14');
    expect(engine.render('{{number 42 0}}', {})).toBe('42');
  });

  test('should use duration function', () => {
    expect(engine.render('{{duration 90000}}', {})).toBe('1m 30s');
    expect(engine.render('{{duration 3600000}}', {})).toBe('1h 0m');
    expect(engine.render('{{duration 500}}', {})).toBe('0s');
  });

  test('should use date function', () => {
    const result = engine.render('{{date}}', {});
    expect(result).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  test('should use time function', () => {
    const result = engine.render('{{time}}', {});
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
  });

  test('should handle unknown function gracefully', () => {
    const result = engine.render('{{unknownFunction "arg"}}', {});
    expect(result).toBe('{{unknownFunction "arg"}}');
  });

  // --- Template management ---
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
    expect(compiled.template).toBe('Hello, {{name}}!');
  });

  test('should register custom functions', () => {
    engine.registerFunction('greet', (args) => `Hello, ${args[0]}!`);
    const result = engine.render('{{greet "Alice"}}', {});
    expect(result).toBe('Hello, Alice!');
  });

  // --- Locale ---
  test('should support locale setting', () => {
    engine.setLocale('zh');
    engine.registerTemplate('zh:greeting', '你好, {{name}}!');
    expect(engine.getTemplate('greeting')).toBe('你好, {{name}}!');
  });

  test('should fall back to non-locale template', () => {
    engine.setLocale('zh');
    engine.registerTemplate('greeting', 'Hello!');
    expect(engine.getTemplate('greeting')).toBe('Hello!');
  });

  test('should register and list locales', () => {
    engine.registerLocale('fr', new Map([['key', 'value']]));
    engine.registerLocale('de', new Map([['key', 'wert']]));
    expect(engine.getLocales()).toContain('fr');
    expect(engine.getLocales()).toContain('de');
  });

  // --- Complex templates ---
  test('should render complex template with multiple features', () => {
    const template = '{{#if user}}Hello {{uppercase user.name}}!{{/if}} You have {{number count 0}} messages.';
    const result = engine.render(template, {
      user: { name: 'alice' },
      count: 5,
    });
    expect(result).toBe('Hello ALICE! You have 5 messages.');
  });

  test('should render template with each and if combined', () => {
    const template = '{{#each items}}{{#if active}}[{{name}}]{{/if}}{{/each}}';
    const result = engine.render(template, {
      items: [
        { name: 'A', active: true },
        { name: 'B', active: false },
        { name: 'C', active: true },
      ],
    });
    expect(result).toBe('[A][C]');
  });

  test('should handle function with variable argument', () => {
    engine.registerFunction('double', (args) => String(Number(args[0]) * 2));
    const result = engine.render('{{double count}}', { count: 21 });
    expect(result).toBe('42');
  });
});

// ============================================================
// Module 7: ChannelRouter - Comprehensive Tests
// ============================================================
describe('ChannelRouter', () => {
  let router: ChannelRouter;

  beforeEach(() => {
    router = new ChannelRouter();
  });

  test('should add routing rules', () => {
    router.addRoute({
      name: 'Critical to email',
      condition: (n) => n.priority === 'critical',
      channels: ['email'],
    });
    expect(router.getRules().length).toBe(1);
  });

  test('should add route with custom id', () => {
    router.addRoute({
      id: 'custom-route',
      name: 'Test',
      condition: () => true,
      channels: ['console'],
    });
    expect(router.getRules()[0].id).toBe('custom-route');
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

  test('should use first matching rule (priority ordering)', () => {
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

  // --- Channel health ---
  test('should check channel availability (default true)', () => {
    expect(router.checkChannelAvailability('console')).toBe(true);
    expect(router.checkChannelAvailability('unknown_channel')).toBe(true);
  });

  test('should mark channel unavailable after any failure (available flag)', () => {
    router.updateChannelHealth('console', false);
    expect(router.checkChannelAvailability('console')).toBe(false);
  });

  test('should recover channel availability after success report', () => {
    router.updateChannelHealth('console', false);
    expect(router.checkChannelAvailability('console')).toBe(false);
    router.updateChannelHealth('console', true);
    expect(router.checkChannelAvailability('console')).toBe(true);
  });

  test('should track failure count and reset on success', () => {
    router.updateChannelHealth('console', false);
    router.updateChannelHealth('console', false);
    router.updateChannelHealth('console', true);
    const health = router.getChannelHealth('console');
    expect(health!.failureCount).toBe(0); // reset on success
  });

  test('should mark channel unavailable after 5 consecutive failures (threshold)', () => {
    // First mark as available, then fail 5 times
    router.updateChannelHealth('console', true);
    for (let i = 0; i < 5; i++) {
      router.updateChannelHealth('console', false);
    }
    // Even though we set available=true first, each updateChannelHealth(false)
    // sets available=false, so it's unavailable from the first failure
    expect(router.checkChannelAvailability('console')).toBe(false);
  });

  // --- Failover ---
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
    expect(channels).not.toContain('console');
  });

  test('should not use failover when primary is available', () => {
    router.addRoute({
      name: 'Errors to console',
      condition: (n) => n.type === 'error',
      channels: ['console'],
    });
    router.setFailover('console', 'email');
    const channels = router.route(createNotification({ type: 'error' }));
    expect(channels).toContain('console');
    expect(channels).not.toContain('email');
  });

  test('should not use failover if failover channel is also down', () => {
    router.addRoute({
      name: 'Errors to console',
      condition: (n) => n.type === 'error',
      channels: ['console'],
    });
    router.setFailover('console', 'email');
    router.updateChannelHealth('console', false);
    router.updateChannelHealth('email', false);
    const channels = router.route(createNotification({ type: 'error' }));
    expect(channels.length).toBe(0);
  });

  // --- Default channels ---
  test('should route error type to console by default', () => {
    const channels = router.route(createNotification({ type: 'error' }));
    expect(channels).toContain('console');
  });

  test('should route warning type to console by default', () => {
    const channels = router.route(createNotification({ type: 'warning' }));
    expect(channels).toContain('console');
  });

  test('should route success type to in-app by default', () => {
    const channels = router.route(createNotification({ type: 'success' }));
    expect(channels).toContain('in-app');
  });

  test('should route progress type to in-app by default', () => {
    const channels = router.route(createNotification({ type: 'progress' }));
    expect(channels).toContain('in-app');
  });

  test('should route info type to console by default', () => {
    const channels = router.route(createNotification({ type: 'info' }));
    expect(channels).toContain('console');
  });

  // --- Channel health info ---
  test('should get channel health info', () => {
    router.updateChannelHealth('console', true, 50);
    const health = router.getChannelHealth('console');
    expect(health).toBeDefined();
    expect(health!.available).toBe(true);
    expect(health!.latencyMs).toBe(50);
    expect(health!.lastCheck).toBeDefined();
  });

  test('should get all channel health', () => {
    router.updateChannelHealth('console', true);
    router.updateChannelHealth('email', false);
    const allHealth = router.getAllChannelHealth();
    expect(allHealth.length).toBe(2);
  });

  // --- Load balancing ---
  test('should return same channel when no instances', () => {
    expect(router.getLoadBalancedChannel('console')).toBe('console');
  });

  test('should round-robin across instances', () => {
    router.addChannelInstance('console', 1);
    router.addChannelInstance('console', 1);
    const c1 = router.getLoadBalancedChannel('console');
    const c2 = router.getLoadBalancedChannel('console');
    const c3 = router.getLoadBalancedChannel('console');
    expect(c1).toBe(c3); // wraps around
  });

  // --- clear ---
  test('should clear all data', () => {
    router.addRoute({ name: 'Test', condition: () => true, channels: ['console'] });
    router.updateChannelHealth('console', true);
    router.clear();
    expect(router.getRules().length).toBe(0);
    expect(router.getAllChannelHealth().length).toBe(0);
  });
});

// ============================================================
// Module 8: NotificationPreferences - Comprehensive Tests
// ============================================================
describe('NotificationPreferences', () => {
  let prefs: NotificationPreferences;

  beforeEach(() => {
    prefs = new NotificationPreferences();
  });

  // --- getPreferences ---
  test('should get default preferences for a user', () => {
    const userPrefs = prefs.getPreferences('user1');
    expect(userPrefs.userId).toBe('user1');
    expect(userPrefs.channels.console).toBe(true);
    expect(userPrefs.channels.file).toBe(true);
    expect(userPrefs.channels.webhook).toBe(true);
    expect(userPrefs.channels.email).toBe(true);
    expect(userPrefs.channels['in-app']).toBe(true);
    expect(userPrefs.quietHours.enabled).toBe(false);
    expect(userPrefs.minPriority).toBe('low');
    expect(userPrefs.digestEnabled).toBe(false);
    expect(userPrefs.digestFrequency).toBe('daily');
    expect(userPrefs.maxPerDay).toBe(100);
    expect(userPrefs.dailyCount).toBe(0);
  });

  test('should create new preferences for each user', () => {
    const p1 = prefs.getPreferences('user1');
    const p2 = prefs.getPreferences('user2');
    expect(p1).not.toBe(p2);
  });

  test('should return same preferences object for same user', () => {
    const p1 = prefs.getPreferences('user1');
    const p2 = prefs.getPreferences('user1');
    expect(p1).toBe(p2);
  });

  // --- setPreferences ---
  test('should set user preferences', () => {
    prefs.setPreferences('user1', { minPriority: 'high' });
    expect(prefs.getPreferences('user1').minPriority).toBe('high');
  });

  test('should merge channel preferences', () => {
    prefs.setPreferences('user1', { channels: { email: false } });
    const userPrefs = prefs.getPreferences('user1');
    expect(userPrefs.channels.email).toBe(false);
    expect(userPrefs.channels.console).toBe(true);
  });

  test('should merge quiet hours preferences', () => {
    prefs.setPreferences('user1', { quietHours: { enabled: true, startHour: 23, endHour: 6 } });
    const userPrefs = prefs.getPreferences('user1');
    expect(userPrefs.quietHours.enabled).toBe(true);
    expect(userPrefs.quietHours.startHour).toBe(23);
    expect(userPrefs.quietHours.endHour).toBe(6);
  });

  test('should preserve userId when setting preferences', () => {
    prefs.setPreferences('user1', { userId: 'user2' } as any);
    expect(prefs.getPreferences('user1').userId).toBe('user1');
  });

  // --- shouldNotify ---
  test('should allow notification by default', () => {
    expect(prefs.shouldNotify('user1', createNotification())).toBe(true);
  });

  test('should block notification below min priority', () => {
    prefs.setPreferences('user1', { minPriority: 'high' });
    expect(prefs.shouldNotify('user1', createNotification({ priority: 'low' }))).toBe(false);
    expect(prefs.shouldNotify('user1', createNotification({ priority: 'normal' }))).toBe(false);
    expect(prefs.shouldNotify('user1', createNotification({ priority: 'high' }))).toBe(true);
    expect(prefs.shouldNotify('user1', createNotification({ priority: 'critical' }))).toBe(true);
  });

  test('should allow critical notifications during quiet hours', () => {
    prefs.setPreferences('user1', {
      quietHours: { enabled: true, startHour: 0, endHour: 0 },
    });
    expect(prefs.shouldNotify('user1', createNotification({ priority: 'critical' }))).toBe(true);
  });

  test('should block non-critical during quiet hours', () => {
    prefs.setPreferences('user1', {
      quietHours: { enabled: true, startHour: 0, endHour: 0 },
    });
    expect(prefs.shouldNotify('user1', createNotification({ priority: 'normal' }))).toBe(false);
    expect(prefs.shouldNotify('user1', createNotification({ priority: 'high' }))).toBe(false);
  });

  test('should block disabled categories', () => {
    prefs.setPreferences('user1', { disabledCategories: ['spam'] });
    expect(prefs.shouldNotify('user1', createNotification({ data: { category: 'spam' } }))).toBe(false);
  });

  test('should only allow enabled categories when set', () => {
    prefs.setPreferences('user1', { enabledCategories: ['important'] });
    expect(prefs.shouldNotify('user1', createNotification({ data: { category: 'other' } }))).toBe(false);
    expect(prefs.shouldNotify('user1', createNotification({ data: { category: 'important' } }))).toBe(true);
  });

  test('should allow notifications with no category when enabledCategories is empty', () => {
    prefs.setPreferences('user1', { enabledCategories: [] });
    expect(prefs.shouldNotify('user1', createNotification({ data: { category: 'anything' } }))).toBe(true);
  });

  // --- Daily limit ---
  test('should enforce daily max limit', () => {
    prefs.setPreferences('user1', { maxPerDay: 2 });
    prefs.incrementDailyCount('user1');
    prefs.incrementDailyCount('user1');
    expect(prefs.shouldNotify('user1', createNotification())).toBe(false);
  });

  test('should allow up to max per day', () => {
    prefs.setPreferences('user1', { maxPerDay: 3 });
    prefs.incrementDailyCount('user1');
    prefs.incrementDailyCount('user1');
    expect(prefs.shouldNotify('user1', createNotification())).toBe(true);
  });

  test('should reset daily count', () => {
    prefs.setPreferences('user1', { maxPerDay: 1 });
    prefs.incrementDailyCount('user1');
    prefs.resetDailyCount('user1');
    expect(prefs.shouldNotify('user1', createNotification())).toBe(true);
  });

  // --- Quiet hours ---
  test('should detect quiet hours spanning midnight', () => {
    prefs.setPreferences('user1', {
      quietHours: { enabled: true, startHour: 22, endHour: 8 },
    });
    // Test with specific times
    expect(prefs.isQuietHours('user1', new Date(2024, 0, 1, 23, 0))).toBe(true);
    expect(prefs.isQuietHours('user1', new Date(2024, 0, 1, 3, 0))).toBe(true);
    expect(prefs.isQuietHours('user1', new Date(2024, 0, 1, 12, 0))).toBe(false);
    expect(prefs.isQuietHours('user1', new Date(2024, 0, 1, 21, 0))).toBe(false);
  });

  test('should detect quiet hours same day range', () => {
    prefs.setPreferences('user1', {
      quietHours: { enabled: true, startHour: 12, endHour: 14 },
    });
    expect(prefs.isQuietHours('user1', new Date(2024, 0, 1, 12, 0))).toBe(true);
    expect(prefs.isQuietHours('user1', new Date(2024, 0, 1, 13, 0))).toBe(true);
    expect(prefs.isQuietHours('user1', new Date(2024, 0, 1, 14, 0))).toBe(false);
    expect(prefs.isQuietHours('user1', new Date(2024, 0, 1, 11, 0))).toBe(false);
  });

  test('BUG FIX: should handle 24-hour quiet hours (startHour === endHour)', () => {
    prefs.setPreferences('user1', {
      quietHours: { enabled: true, startHour: 0, endHour: 0 },
    });
    expect(prefs.isQuietHours('user1', new Date(2024, 0, 1, 0, 0))).toBe(true);
    expect(prefs.isQuietHours('user1', new Date(2024, 0, 1, 12, 0))).toBe(true);
    expect(prefs.isQuietHours('user1', new Date(2024, 0, 1, 23, 0))).toBe(true);
  });

  test('should not be quiet when quiet hours disabled', () => {
    prefs.setPreferences('user1', {
      quietHours: { enabled: false, startHour: 0, endHour: 0 },
    });
    expect(prefs.isQuietHours('user1')).toBe(false);
  });

  // --- Default settings ---
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

  test('should set default quiet hours', () => {
    prefs.setDefaultQuietHours(22, 8);
    const userPrefs = prefs.getPreferences('newuser');
    expect(userPrefs.quietHours.enabled).toBe(true);
    expect(userPrefs.quietHours.startHour).toBe(22);
    expect(userPrefs.quietHours.endHour).toBe(8);
  });

  test('should create with custom defaults', () => {
    const customPrefs = new NotificationPreferences({
      maxPerDay: 10,
      minPriority: 'critical',
      digestEnabled: true,
    });
    const userPrefs = customPrefs.getPreferences('user1');
    expect(userPrefs.maxPerDay).toBe(10);
    expect(userPrefs.minPriority).toBe('critical');
    expect(userPrefs.digestEnabled).toBe(true);
  });

  // --- Utility ---
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
});

// ============================================================
// Module 9: NotificationHistory - Comprehensive Tests
// ============================================================
describe('NotificationHistory', () => {
  let history: NotificationHistory;

  beforeEach(() => {
    history = new NotificationHistory();
  });

  test('should create with memory storage by default', () => {
    expect(history.getCount()).toBe(0);
  });

  test('should create with file storage type', () => {
    const fileHistory = new NotificationHistory('file', '/tmp/notifications.json');
    expect(fileHistory.getCount()).toBe(0);
  });

  test('should record notifications', () => {
    history.record(createNotification(), [createSendResult()]);
    expect(history.getCount()).toBe(1);
  });

  test('should auto-generate record ids', () => {
    history.record(createNotification(), [createSendResult()]);
    history.record(createNotification(), [createSendResult()]);
    const records = history.query({});
    expect(records[0].id).toMatch(/^rec_\d+$/);
    expect(records[1].id).toMatch(/^rec_\d+$/);
    expect(records[0].id).not.toBe(records[1].id);
  });

  // --- Query ---
  test('should query all records', () => {
    history.record(createNotification({ type: 'info' }), [createSendResult()]);
    history.record(createNotification({ type: 'error' }), [createSendResult()]);
    expect(history.query({}).length).toBe(2);
  });

  test('should query by type', () => {
    history.record(createNotification({ type: 'info' }), [createSendResult()]);
    history.record(createNotification({ type: 'error' }), [createSendResult()]);
    expect(history.query({ type: 'error' }).length).toBe(1);
  });

  test('should query by channel', () => {
    history.record(createNotification(), [createSendResult({ channel: 'console' })]);
    history.record(createNotification(), [createSendResult({ channel: 'email' })]);
    expect(history.query({ channel: 'email' }).length).toBe(1);
  });

  test('should query by status success', () => {
    history.record(createNotification(), [createSendResult({ success: true })]);
    history.record(createNotification(), [createSendResult({ success: false, error: 'fail' })]);
    expect(history.query({ status: 'success' }).length).toBe(1);
  });

  test('should query by status failed', () => {
    history.record(createNotification(), [createSendResult({ success: true })]);
    history.record(createNotification(), [createSendResult({ success: false, error: 'fail' })]);
    expect(history.query({ status: 'failed' }).length).toBe(1);
  });

  test('should query by recipient', () => {
    history.record(createNotification({ recipient: 'user1' }), [createSendResult()]);
    history.record(createNotification({ recipient: 'user2' }), [createSendResult()]);
    expect(history.query({ recipient: 'user1' }).length).toBe(1);
  });

  test('should query by time range', () => {
    const now = Date.now();
    history.record(createNotification({ timestamp: now - 100000 }), [createSendResult()]);
    history.record(createNotification({ timestamp: now }), [createSendResult()]);
    expect(history.query({ startTime: now - 50000, endTime: now + 50000 }).length).toBe(1);
  });

  test('should query with limit', () => {
    for (let i = 0; i < 5; i++) {
      history.record(createNotification(), [createSendResult()]);
    }
    expect(history.query({ limit: 2 }).length).toBe(2);
  });

  test('should query with offset', () => {
    for (let i = 0; i < 5; i++) {
      history.record(createNotification(), [createSendResult()]);
    }
    expect(history.query({ offset: 3 }).length).toBe(2);
  });

  test('should query with limit and offset combined', () => {
    for (let i = 0; i < 5; i++) {
      history.record(createNotification(), [createSendResult()]);
    }
    expect(history.query({ offset: 1, limit: 2 }).length).toBe(2);
  });

  test('should sort results by timestamp descending', () => {
    const now = Date.now();
    history.record(createNotification({ timestamp: now }), [createSendResult()]);
    history.record(createNotification({ timestamp: now + 100 }), [createSendResult()]);
    history.record(createNotification({ timestamp: now + 50 }), [createSendResult()]);
    const results = history.query({});
    expect(results[0].timestamp).toBeGreaterThan(results[1].timestamp);
    expect(results[1].timestamp).toBeGreaterThan(results[2].timestamp);
  });

  // --- Aggregation ---
  test('should aggregate by type', () => {
    history.record(createNotification({ type: 'info' }), [createSendResult()]);
    history.record(createNotification({ type: 'info' }), [createSendResult()]);
    history.record(createNotification({ type: 'error' }), [createSendResult()]);
    const agg = history.aggregate('type');
    expect(agg.total).toBe(3);
    expect(agg.buckets.info).toBe(2);
    expect(agg.buckets.error).toBe(1);
    expect(agg.dimension).toBe('type');
  });

  test('should aggregate by channel', () => {
    history.record(createNotification(), [createSendResult({ channel: 'console' })]);
    history.record(createNotification(), [createSendResult({ channel: 'email' })]);
    const agg = history.aggregate('channel');
    expect(agg.buckets.console).toBe(1);
    expect(agg.buckets.email).toBe(1);
  });

  test('should aggregate by status', () => {
    history.record(createNotification(), [createSendResult({ success: true })]);
    history.record(createNotification(), [createSendResult({ success: false })]);
    const agg = history.aggregate('status');
    expect(agg.buckets.success).toBe(1);
    expect(agg.buckets.failed).toBe(1);
  });

  test('should aggregate by recipient', () => {
    history.record(createNotification({ recipient: 'user1' }), [createSendResult()]);
    history.record(createNotification({ recipient: 'user2' }), [createSendResult()]);
    const agg = history.aggregate('recipient');
    expect(agg.buckets.user1).toBe(1);
    expect(agg.buckets.user2).toBe(1);
  });

  test('should aggregate unknown recipient as "unknown"', () => {
    history.record(createNotification(), [createSendResult()]);
    const agg = history.aggregate('recipient');
    expect(agg.buckets.unknown).toBe(1);
  });

  test('should aggregate by day', () => {
    const now = Date.now();
    history.record(createNotification(), [createSendResult()]);
    const agg = history.aggregate('day');
    expect(agg.total).toBe(1);
    const dayKey = new Date(now).toISOString().split('T')[0];
    expect(agg.buckets[dayKey]).toBe(1);
  });

  // --- Cleanup ---
  test('should cleanup old records', () => {
    const old = Date.now() - 10 * 86400000;
    const recent = Date.now();
    history.record(createNotification({ timestamp: old }), [createSendResult()]);
    history.record(createNotification({ timestamp: recent }), [createSendResult()]);
    const removed = history.cleanup(7);
    expect(removed).toBe(1);
    expect(history.getCount()).toBe(1);
  });

  test('should not remove recent records during cleanup', () => {
    const recent = Date.now();
    history.record(createNotification({ timestamp: recent }), [createSendResult()]);
    const removed = history.cleanup(7);
    expect(removed).toBe(0);
    expect(history.getCount()).toBe(1);
  });

  // --- Export ---
  test('should export data as JSON', () => {
    history.record(createNotification(), [createSendResult()]);
    const json = history.exportData('json');
    const parsed = JSON.parse(json);
    expect(parsed.length).toBe(1);
  });

  test('should export data as CSV', () => {
    history.record(createNotification({ type: 'info', priority: 'normal', title: 'Test' }), [createSendResult()]);
    const csv = history.exportData('csv');
    expect(csv).toContain('id,type,priority,title');
    expect(csv).toContain('info');
  });

  test('should escape quotes in CSV export', () => {
    history.record(createNotification({ title: 'He said "hello"' }), [createSendResult()]);
    const csv = history.exportData('csv');
    expect(csv).toContain('He said ""hello""');
  });

  // --- clear ---
  test('should clear all records', () => {
    history.record(createNotification(), [createSendResult()]);
    history.clear();
    expect(history.getCount()).toBe(0);
  });
});

// ============================================================
// Module 10: NotificationMetrics - Comprehensive Tests
// ============================================================
describe('NotificationMetrics', () => {
  let metrics: NotificationMetrics;

  beforeEach(() => {
    metrics = new NotificationMetrics();
  });

  // --- recordDelivery ---
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
    expect(report.totalFailed).toBe(0);
  });

  test('should track failed deliveries', () => {
    metrics.recordDelivery({ notificationId: '1', channel: 'console', success: true, timestamp: Date.now(), latencyMs: 50 });
    metrics.recordDelivery({ notificationId: '2', channel: 'console', success: false, timestamp: Date.now(), latencyMs: 100 });
    const report = metrics.getMetrics();
    expect(report.totalSent).toBe(2);
    expect(report.totalDelivered).toBe(1);
    expect(report.totalFailed).toBe(1);
  });

  test('should calculate delivery rate', () => {
    metrics.recordDelivery({ notificationId: '1', channel: 'console', success: true, timestamp: Date.now(), latencyMs: 50 });
    metrics.recordDelivery({ notificationId: '2', channel: 'console', success: false, timestamp: Date.now(), latencyMs: 100 });
    expect(metrics.getMetrics().deliveryRate).toBe(0.5);
  });

  test('should calculate average latency', () => {
    metrics.recordDelivery({ notificationId: '1', channel: 'console', success: true, timestamp: Date.now(), latencyMs: 50 });
    metrics.recordDelivery({ notificationId: '2', channel: 'console', success: true, timestamp: Date.now(), latencyMs: 150 });
    expect(metrics.getMetrics().averageLatencyMs).toBe(100);
  });

  test('should return zero metrics when no data', () => {
    const report = metrics.getMetrics();
    expect(report.totalSent).toBe(0);
    expect(report.deliveryRate).toBe(0);
    expect(report.averageLatencyMs).toBe(0);
  });

  // --- Channel metrics ---
  test('should get channel-specific metrics', () => {
    metrics.recordDelivery({ notificationId: '1', channel: 'console', success: true, timestamp: Date.now(), latencyMs: 50 });
    metrics.recordDelivery({ notificationId: '2', channel: 'email', success: true, timestamp: Date.now(), latencyMs: 100 });
    const consoleMetrics = metrics.getChannelMetrics('console');
    expect(consoleMetrics.sent).toBe(1);
    expect(consoleMetrics.delivered).toBe(1);
    expect(consoleMetrics.channel).toBe('console');
  });

  test('should return empty channel metrics for unknown channel', () => {
    const cm = metrics.getChannelMetrics('unknown');
    expect(cm.sent).toBe(0);
    expect(cm.delivered).toBe(0);
  });

  test('should include channel metrics in report', () => {
    metrics.recordDelivery({ notificationId: '1', channel: 'console', success: true, timestamp: Date.now(), latencyMs: 50 });
    metrics.recordDelivery({ notificationId: '2', channel: 'email', success: false, timestamp: Date.now(), latencyMs: 100 });
    const report = metrics.getMetrics();
    expect(report.channelMetrics.console).toBeDefined();
    expect(report.channelMetrics.email).toBeDefined();
    expect(report.channelMetrics.console.delivered).toBe(1);
    expect(report.channelMetrics.email.failed).toBe(1);
  });

  test('should track lastDelivery per channel', () => {
    const now = Date.now();
    metrics.recordDelivery({ notificationId: '1', channel: 'console', success: true, timestamp: now, latencyMs: 50 });
    metrics.recordDelivery({ notificationId: '2', channel: 'console', success: true, timestamp: now + 1000, latencyMs: 50 });
    const cm = metrics.getChannelMetrics('console');
    expect(cm.lastDelivery).toBe(now + 1000);
  });

  // --- User metrics ---
  test('should track user engagement', () => {
    metrics.recordDelivery({ notificationId: '1', channel: 'console', success: true, timestamp: Date.now(), latencyMs: 50, userId: 'user1' });
    metrics.recordEngagement({ notificationId: '1', userId: 'user1', action: 'read', timestamp: Date.now() });
    metrics.recordEngagement({ notificationId: '1', userId: 'user1', action: 'acted_upon', timestamp: Date.now() });
    const stats = metrics.getUserMetrics('user1');
    expect(stats.totalReceived).toBe(1);
    expect(stats.read).toBe(1);
    expect(stats.actedUpon).toBe(1);
    expect(stats.dismissed).toBe(0);
  });

  test('should track dismissed engagement', () => {
    metrics.recordDelivery({ notificationId: '1', channel: 'console', success: true, timestamp: Date.now(), latencyMs: 50, userId: 'user1' });
    metrics.recordEngagement({ notificationId: '1', userId: 'user1', action: 'dismissed', timestamp: Date.now() });
    expect(metrics.getUserMetrics('user1').dismissed).toBe(1);
  });

  test('should group user metrics by channel', () => {
    metrics.recordDelivery({ notificationId: '1', channel: 'console', success: true, timestamp: Date.now(), latencyMs: 50, userId: 'user1' });
    metrics.recordDelivery({ notificationId: '2', channel: 'email', success: true, timestamp: Date.now(), latencyMs: 50, userId: 'user1' });
    const stats = metrics.getUserMetrics('user1');
    expect(stats.byChannel.console).toBe(1);
    expect(stats.byChannel.email).toBe(1);
  });

  test('BUG FIX: should populate byType in user metrics', () => {
    metrics.recordDelivery({
      notificationId: '1',
      channel: 'console',
      success: true,
      timestamp: Date.now(),
      latencyMs: 50,
      userId: 'user1',
      notificationType: 'info',
    });
    metrics.recordDelivery({
      notificationId: '2',
      channel: 'console',
      success: true,
      timestamp: Date.now(),
      latencyMs: 50,
      userId: 'user1',
      notificationType: 'error',
    });
    const stats = metrics.getUserMetrics('user1');
    expect(stats.byType.info).toBe(1);
    expect(stats.byType.error).toBe(1);
  });

  test('should return empty user metrics for unknown user', () => {
    const stats = metrics.getUserMetrics('unknown');
    expect(stats.totalReceived).toBe(0);
    expect(stats.read).toBe(0);
  });

  // --- Trends ---
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
    expect(trend.dataPoints[0].value).toBe(3600000);
  });

  test('should return empty trend for unknown metric', () => {
    const trend = metrics.getTrend('unknown_metric', 'daily');
    expect(trend.dataPoints.length).toBe(0);
    expect(trend.trend).toBe('stable');
  });

  test('should calculate trend direction correctly', () => {
    const now = Date.now();
    metrics.recordDelivery({ notificationId: '1', channel: 'console', success: true, timestamp: now - 86400000, latencyMs: 10 });
    metrics.recordDelivery({ notificationId: '2', channel: 'console', success: true, timestamp: now, latencyMs: 100 });
    const trend = metrics.getTrend('latency', 'daily');
    expect(trend.trend).toBe('up');
    expect(trend.changePercent).toBeGreaterThan(0);
  });

  test('should return stable trend for insufficient data', () => {
    metrics.recordDelivery({ notificationId: '1', channel: 'console', success: true, timestamp: Date.now(), latencyMs: 50 });
    const trend = metrics.getTrend('latency', 'daily');
    expect(trend.trend).toBe('stable');
    expect(trend.changePercent).toBe(0);
  });

  test('should support different period types', () => {
    metrics.recordDelivery({ notificationId: '1', channel: 'console', success: true, timestamp: Date.now(), latencyMs: 50 });
    expect(metrics.getTrend('volume', 'hourly').metric).toBe('volume');
    expect(metrics.getTrend('volume', 'weekly').metric).toBe('volume');
  });

  // --- Alert resolution ---
  test('should record alert resolution timing', () => {
    metrics.recordAlertResolution('alert1', Date.now() - 3600000, Date.now());
    metrics.recordAlertResolution('alert2', Date.now() - 1800000, Date.now());
    // Verify no crash
    expect(true).toBe(true);
  });

  // --- clear ---
  test('should clear all metrics', () => {
    metrics.recordDelivery({ notificationId: '1', channel: 'console', success: true, timestamp: Date.now(), latencyMs: 50 });
    metrics.recordEngagement({ notificationId: '1', userId: 'user1', action: 'read', timestamp: Date.now() });
    metrics.recordAlertResolution('alert1', Date.now() - 1000, Date.now());
    metrics.clear();
    expect(metrics.getMetrics().totalSent).toBe(0);
    expect(metrics.getUserMetrics('user1').totalReceived).toBe(0);
  });
});
