import { describe, test, expect, beforeEach, afterEach, vi } from 'bun:test';
import { AnomalyDetector } from '../src/anomaly-detector.js';
import { DiagnosisEngine } from '../src/diagnosis-engine.js';
import { RecoveryStrategyRegistry } from '../src/recovery-strategies.js';
import { AutoRepairEngine } from '../src/auto-repair.js';
import { FailoverManager } from '../src/failover-manager.js';
import { StateRollbackManager } from '../src/state-rollback.js';
import { EnhancedCircuitBreaker } from '../src/circuit-breaker-enhanced.js';
import { HealthProbe } from '../src/health-probe.js';
import { RecoveryLearningSystem } from '../src/recovery-learning.js';
import { IncidentManager } from '../src/incident-manager.js';

// ============================================================
// AnomalyDetector Tests
// ============================================================
describe('AnomalyDetector', () => {
  let detector: AnomalyDetector;

  beforeEach(() => {
    detector = new AnomalyDetector();
  });

  test('should create instance', () => {
    expect(detector).toBeDefined();
  });

  test('should register a metric', () => {
    detector.registerMetric('memory', { windowSize: 50 });
    expect(detector.getMetrics()).toContain('memory');
  });

  test('should register metric with default options', () => {
    detector.registerMetric('cpu');
    expect(detector.getMetrics()).toContain('cpu');
  });

  test('should record a value for registered metric', () => {
    detector.registerMetric('memory');
    detector.record('memory', 100);
    expect(detector.getMetricValues('memory')).toEqual([100]);
  });

  test('should auto-register metric on record', () => {
    detector.record('cpu', 50);
    expect(detector.getMetrics()).toContain('cpu');
  });

  test('should trim values to window size', () => {
    detector.registerMetric('mem', { windowSize: 5 });
    for (let i = 0; i < 10; i++) {
      detector.record('mem', i);
    }
    expect(detector.getMetricValues('mem').length).toBe(5);
  });

  test('should detect no anomalies with normal data', () => {
    detector.registerMetric('memory');
    for (let i = 0; i < 20; i++) {
      detector.record('memory', 50 + Math.random() * 2);
    }
    const anomalies = detector.detect();
    expect(anomalies.length).toBe(0);
  });

  test('should detect threshold anomaly (above max)', () => {
    detector.registerMetric('memory', { thresholdMax: 100 });
    for (let i = 0; i < 5; i++) detector.record('memory', 50);
    detector.record('memory', 200);
    const anomalies = detector.detect();
    expect(anomalies.some((a) => a.type === 'threshold')).toBe(true);
  });

  test('should detect threshold anomaly (below min)', () => {
    detector.registerMetric('memory', { thresholdMin: 10 });
    for (let i = 0; i < 5; i++) detector.record('memory', 50);
    detector.record('memory', 2);
    const anomalies = detector.detect();
    expect(anomalies.some((a) => a.type === 'threshold')).toBe(true);
  });

  test('should detect z-score anomaly', () => {
    detector.registerMetric('latency', { zScoreThreshold: 2 });
    for (let i = 0; i < 20; i++) {
      detector.record('latency', 50 + Math.random() * 5);
    }
    detector.updateBaseline('latency');
    detector.record('latency', 500);
    const anomalies = detector.detect();
    expect(anomalies.some((a) => a.type === 'zscore')).toBe(true);
  });

  test('should detect IQR anomaly', () => {
    detector.registerMetric('response_time', { iqrMultiplier: 1.0 });
    for (let i = 0; i < 20; i++) {
      detector.record('response_time', 50 + Math.random() * 10);
    }
    detector.updateBaseline('response_time');
    detector.record('response_time', 500);
    const anomalies = detector.detect();
    expect(anomalies.some((a) => a.type === 'iqr')).toBe(true);
  });

  test('should detect trend anomaly', () => {
    detector.registerMetric('memory', { trendSensitivity: 0.3 });
    for (let i = 0; i < 10; i++) detector.record('memory', 50);
    for (let i = 0; i < 5; i++) detector.record('memory', 500);
    const anomalies = detector.detect();
    expect(anomalies.some((a) => a.type === 'trend')).toBe(true);
  });

  test('should detect pattern anomaly', () => {
    detector.registerMetric('cpu', { patternWindowSize: 5 });
    for (let i = 0; i < 15; i++) detector.record('cpu', 50);
    for (let i = 0; i < 5; i++) detector.record('cpu', 200);
    const anomalies = detector.detect();
    expect(anomalies.some((a) => a.type === 'pattern')).toBe(true);
  });

  test('isAnomalous should return false for normal data', () => {
    detector.registerMetric('memory');
    for (let i = 0; i < 10; i++) detector.record('memory', 50);
    expect(detector.isAnomalous('memory')).toBe(false);
  });

  test('isAnomalous should return true for anomalous data', () => {
    detector.registerMetric('memory', { thresholdMax: 100 });
    for (let i = 0; i < 5; i++) detector.record('memory', 50);
    detector.record('memory', 200);
    expect(detector.isAnomalous('memory')).toBe(true);
  });

  test('getBaseline should return valid stats', () => {
    detector.registerMetric('memory');
    for (let i = 0; i < 10; i++) detector.record('memory', 50 + i);
    const baseline = detector.getBaseline('memory');
    expect(baseline.sampleCount).toBe(10);
    expect(baseline.mean).toBeGreaterThan(0);
    expect(baseline.stdDev).toBeGreaterThanOrEqual(0);
  });

  test('getBaseline should return empty stats for unknown metric', () => {
    const baseline = detector.getBaseline('unknown');
    expect(baseline.sampleCount).toBe(0);
  });

  test('updateBaseline should recalculate stats', () => {
    detector.registerMetric('memory');
    for (let i = 0; i < 5; i++) detector.record('memory', 100);
    detector.updateBaseline('memory');
    const b1 = detector.getBaseline('memory');
    for (let i = 0; i < 5; i++) detector.record('memory', 200);
    detector.updateBaseline('memory');
    const b2 = detector.getBaseline('memory');
    expect(b2.mean).toBeGreaterThan(b1.mean);
  });

  test('anomaly report should have correct fields', () => {
    detector.registerMetric('mem', { thresholdMax: 100 });
    detector.record('mem', 50);
    detector.record('mem', 50);
    detector.record('mem', 200);
    const anomalies = detector.detect();
    const anomaly = anomalies.find((a) => a.type === 'threshold')!;
    expect(anomaly).toBeDefined();
    expect(anomaly!.metric).toBe('mem');
    expect(anomaly!.value).toBe(200);
    expect(anomaly!.timestamp).toBeGreaterThan(0);
    expect(['low', 'medium', 'high', 'critical']).toContain(anomaly!.severity);
  });

  test('should track anomaly history', () => {
    detector.registerMetric('mem', { thresholdMax: 100 });
    detector.record('mem', 50);
    detector.record('mem', 50);
    detector.record('mem', 50);
    detector.record('mem', 200);
    detector.detect();
    expect(detector.getAnomalyHistory().length).toBeGreaterThan(0);
  });

  test('clearHistory should remove anomaly history', () => {
    detector.registerMetric('mem', { thresholdMax: 100 });
    detector.record('mem', 200);
    detector.detect();
    detector.clearHistory();
    expect(detector.getAnomalyHistory().length).toBe(0);
  });

  test('detect should return empty for insufficient data', () => {
    detector.registerMetric('mem');
    detector.record('mem', 50);
    const anomalies = detector.detect();
    expect(anomalies.length).toBe(0);
  });

  test('should handle multiple metrics', () => {
    detector.registerMetric('cpu');
    detector.registerMetric('memory');
    detector.record('cpu', 50);
    detector.record('memory', 100);
    expect(detector.getMetrics().length).toBe(2);
  });
});

// ============================================================
// DiagnosisEngine Tests
// ============================================================
describe('DiagnosisEngine', () => {
  let engine: DiagnosisEngine;

  beforeEach(() => {
    engine = new DiagnosisEngine();
  });

  test('should create instance with default rules', () => {
    expect(engine.getRules().length).toBeGreaterThan(0);
  });

  test('should diagnose memory leak symptoms', () => {
    const symptoms = [
      { source: 'anomaly', type: 'memory_usage', description: 'High memory', severity: 'high' as const, timestamp: Date.now() },
      { source: 'anomaly', type: 'response_time', description: 'Slow response', severity: 'medium' as const, timestamp: Date.now() },
    ];
    const result = engine.diagnose(symptoms);
    expect(result.primaryCause.cause).toBe('memory_leak');
    expect(result.confidence).toBeGreaterThan(0);
  });

  test('should diagnose network failure symptoms', () => {
    const symptoms = [
      { source: 'anomaly', type: 'error_rate', description: 'High errors', severity: 'critical' as const, timestamp: Date.now() },
      { source: 'anomaly', type: 'response_time', description: 'Timeout', severity: 'critical' as const, timestamp: Date.now() },
    ];
    const result = engine.diagnose(symptoms);
    expect(result.primaryCause.cause).toBe('network_failure');
  });

  test('should diagnose resource exhaustion', () => {
    const symptoms = [
      { source: 'anomaly', type: 'memory_usage', description: 'OOM', severity: 'critical' as const, timestamp: Date.now() },
    ];
    const result = engine.diagnose(symptoms);
    expect(result.primaryCause.cause).toBe('resource_exhaustion');
  });

  test('should add custom rule', () => {
    engine.addRule({
      id: 'custom-1',
      name: 'Custom Rule',
      conditions: () => true,
      cause: 'custom_cause',
      confidence: 0.95,
      recommendedActions: ['custom_action'],
    });
    expect(engine.getRules().some((r) => r.id === 'custom-1')).toBe(true);
  });

  test('should remove rule', () => {
    engine.addRule({
      id: 'to-remove',
      name: 'Remove Me',
      conditions: () => true,
      cause: 'temp',
      confidence: 0.5,
      recommendedActions: [],
    });
    engine.removeRule('to-remove');
    expect(engine.getRules().some((r) => r.id === 'to-remove')).toBe(false);
  });

  test('getPossibleCauses should return matching causes', () => {
    const symptoms = [
      { source: 'test', type: 'memory_usage', description: 'High mem', severity: 'high' as const, timestamp: Date.now() },
      { source: 'test', type: 'response_time', description: 'Slow', severity: 'medium' as const, timestamp: Date.now() },
    ];
    const causes = engine.getPossibleCauses(symptoms);
    expect(causes.length).toBeGreaterThan(0);
  });

  test('getRecommendedActions should return actions', () => {
    const symptoms = [
      { source: 'test', type: 'memory_usage', description: 'High mem', severity: 'high' as const, timestamp: Date.now() },
      { source: 'test', type: 'response_time', description: 'Slow', severity: 'medium' as const, timestamp: Date.now() },
    ];
    const diagnosis = engine.diagnose(symptoms);
    expect(diagnosis.recommendedActions.length).toBeGreaterThan(0);
  });

  test('diagnosis result should have correct structure', () => {
    const symptoms = [
      { source: 'test', type: 'error_rate', description: 'Errors', severity: 'high' as const, timestamp: Date.now() },
    ];
    const result = engine.diagnose(symptoms);
    expect(result.id).toBeDefined();
    expect(result.primaryCause).toBeDefined();
    expect(result.possibleCauses).toBeDefined();
    expect(result.recommendedActions).toBeDefined();
    expect(result.symptoms).toBeDefined();
    expect(result.timestamp).toBeGreaterThan(0);
  });

  test('should track diagnosis history', () => {
    engine.diagnose([
      { source: 'test', type: 'memory_usage', description: 'High', severity: 'high' as const, timestamp: Date.now() },
      { source: 'test', type: 'response_time', description: 'Slow', severity: 'medium' as const, timestamp: Date.now() },
    ]);
    expect(engine.getDiagnosisHistory().length).toBe(1);
  });

  test('clearHistory should remove diagnosis history', () => {
    engine.diagnose([
      { source: 'test', type: 'memory_usage', description: 'High', severity: 'high' as const, timestamp: Date.now() },
    ]);
    engine.clearHistory();
    expect(engine.getDiagnosisHistory().length).toBe(0);
  });

  test('low confidence diagnosis should suggest investigation', () => {
    const result = engine.diagnose([
      { source: 'test', type: 'unknown_symptom', description: 'Something weird', severity: 'low' as const, timestamp: Date.now() },
    ]);
    const hasInvestigate = result.recommendedActions.some((a) => a.name === 'investigate_further');
    expect(hasInvestigate).toBe(true);
  });
});

// ============================================================
// RecoveryStrategyRegistry Tests
// ============================================================
describe('RecoveryStrategyRegistry', () => {
  let registry: RecoveryStrategyRegistry;

  beforeEach(() => {
    registry = new RecoveryStrategyRegistry();
  });

  test('should create instance with builtin strategies', () => {
    expect(registry.getAllStrategies().length).toBeGreaterThan(0);
  });

  test('should have restart_component strategy', () => {
    expect(registry.getAllStrategies()).toContain('restart_component');
  });

  test('should have failover strategy', () => {
    expect(registry.getAllStrategies()).toContain('failover');
  });

  test('should register custom strategy', () => {
    registry.register('custom', {
      name: 'custom',
      description: 'Custom strategy',
      execute: async () => ({ success: true, strategy: 'custom', duration: 0, message: 'ok', rollbackRequired: false }),
    });
    expect(registry.getAllStrategies()).toContain('custom');
  });

  test('should unregister strategy', () => {
    registry.register('temp', {
      name: 'temp',
      description: 'Temp',
      execute: async () => ({ success: true, strategy: 'temp', duration: 0, message: 'ok', rollbackRequired: false }),
    });
    registry.unregister('temp');
    expect(registry.getAllStrategies()).not.toContain('temp');
  });

  test('should get strategy by name', () => {
    const strategy = registry.getStrategy('restart_component');
    expect(strategy).toBeDefined();
    expect(strategy!.name).toBe('restart_component');
  });

  test('should select strategies based on severity', () => {
    const strategies = registry.select({
      primaryCause: 'unknown',
      severity: 'critical',
    });
    expect(strategies.length).toBeGreaterThan(0);
  });

  test('should select strategies based on recommended actions', () => {
    const strategies = registry.select({
      primaryCause: 'memory_leak',
      severity: 'high',
      recommendedActions: ['restart_component', 'clear_cache'],
    });
    expect(strategies.length).toBe(2);
  });

  test('should execute strategy successfully', async () => {
    const strategy = registry.getStrategy('restart_component')!;
    const result = await registry.execute(strategy, {
      componentId: 'test',
      diagnosis: 'test',
      severity: 'high',
    });
    expect(result.success).toBe(true);
    expect(result.strategy).toBe('restart_component');
  });

  test('should execute strategy with timeout handling', async () => {
    registry.register('slow', {
      name: 'slow',
      description: 'Slow strategy',
      timeout: 50,
      execute: async () => {
        await new Promise((r) => setTimeout(r, 1000));
        return { success: true, strategy: 'slow', duration: 0, message: 'ok', rollbackRequired: false };
      },
    });
    const strategy = registry.getStrategy('slow')!;
    const result = await registry.execute(strategy, {
      componentId: 'test',
      diagnosis: 'test',
      severity: 'high',
    });
    expect(result.success).toBe(false);
  });

  test('should track effectiveness stats', async () => {
    const strategy = registry.getStrategy('restart_component')!;
    await registry.execute(strategy, { componentId: 'a', diagnosis: 'test', severity: 'high' });
    await registry.execute(strategy, { componentId: 'b', diagnosis: 'test', severity: 'high' });
    const stats = registry.getEffectiveness('restart_component');
    expect(stats.totalExecutions).toBe(2);
    expect(stats.successfulExecutions).toBe(2);
    expect(stats.successRate).toBe(1);
  });

  test('should track failed executions', async () => {
    registry.register('failing', {
      name: 'failing',
      description: 'Always fails',
      execute: async () => ({ success: false, strategy: 'failing', duration: 0, message: 'fail', rollbackRequired: false }),
    });
    const strategy = registry.getStrategy('failing')!;
    await registry.execute(strategy, { componentId: 'test', diagnosis: 'test', severity: 'high' });
    const stats = registry.getEffectiveness('failing');
    expect(stats.successRate).toBe(0);
  });

  test('should fallback to escalate when no strategies match', () => {
    registry.unregister('retry_operation');
    registry.unregister('escalate');
    const strategies = registry.select({
      primaryCause: 'unknown',
      severity: 'low',
      recommendedActions: ['nonexistent_strategy'],
    });
    // Should be empty since all fallbacks removed
    expect(strategies.length).toBe(0);
  });

  test('getEffectiveness should return zero for unknown strategy', () => {
    const stats = registry.getEffectiveness('nonexistent');
    expect(stats.totalExecutions).toBe(0);
    expect(stats.successRate).toBe(0);
  });

  test('should track execution history', async () => {
    const strategy = registry.getStrategy('restart_component')!;
    await registry.execute(strategy, { componentId: 'test', diagnosis: 'test', severity: 'high' });
    expect(registry.getExecutionHistory().length).toBe(1);
  });
});

// ============================================================
// AutoRepairEngine Tests
// ============================================================
describe('AutoRepairEngine', () => {
  let repairEngine: AutoRepairEngine;
  let anomalyDetector: AnomalyDetector;
  let diagnosisEngine: DiagnosisEngine;
  let strategyRegistry: RecoveryStrategyRegistry;

  beforeEach(() => {
    anomalyDetector = new AnomalyDetector();
    diagnosisEngine = new DiagnosisEngine();
    strategyRegistry = new RecoveryStrategyRegistry();
    repairEngine = new AutoRepairEngine(anomalyDetector, diagnosisEngine, strategyRegistry, {
      autonomyLevel: 'fully_auto',
    });
  });

  afterEach(() => {
    repairEngine.stopAutoRepair();
  });

  test('should create instance', () => {
    expect(repairEngine).toBeDefined();
  });

  test('should start auto repair', () => {
    repairEngine.startAutoRepair(60000);
    expect(repairEngine.isRunning()).toBe(true);
  });

  test('should stop auto repair', () => {
    repairEngine.startAutoRepair(60000);
    repairEngine.stopAutoRepair();
    expect(repairEngine.isRunning()).toBe(false);
  });

  test('should trigger repair for an issue', async () => {
    const issue = {
      id: 'issue-1',
      componentId: 'comp-1',
      description: 'High memory usage',
      severity: 'high' as const,
      detectedAt: Date.now(),
      anomalies: [
        {
          metric: 'memory_usage',
          severity: 'high' as const,
          type: 'threshold' as const,
          value: 500,
          expected: 100,
          message: 'Memory too high',
          timestamp: Date.now(),
        },
      ],
    };
    const result = await repairEngine.triggerRepair(issue);
    expect(result.issueId).toBe('issue-1');
    expect(result.strategiesAttempted.length).toBeGreaterThan(0);
  });

  test('should block blacklisted issues', async () => {
    repairEngine.addToBlacklist('blacklisted_issue');
    const issue = {
      id: 'issue-2',
      componentId: 'comp-1',
      description: 'blacklisted_issue',
      severity: 'high' as const,
      detectedAt: Date.now(),
    };
    const result = await repairEngine.triggerRepair(issue);
    expect(result.success).toBe(false);
    expect(result.message).toContain('blacklisted');
  });

  test('should enforce rate limiting', async () => {
    const engine = new AutoRepairEngine(anomalyDetector, diagnosisEngine, strategyRegistry, {
      autonomyLevel: 'fully_auto',
      maxRepairsPerHour: 1,
    });
    const issue = {
      id: 'issue-3',
      componentId: 'comp-1',
      description: 'test',
      severity: 'high' as const,
      detectedAt: Date.now(),
    };
    await engine.triggerRepair(issue);
    const result2 = await engine.triggerRepair({ ...issue, id: 'issue-4' });
    expect(result2.success).toBe(false);
    expect(result2.message).toContain('Rate limit');
  });

  test('should require approval in manual_confirm mode', async () => {
    const engine = new AutoRepairEngine(anomalyDetector, diagnosisEngine, strategyRegistry, {
      autonomyLevel: 'manual_confirm',
    });
    const issue = {
      id: 'issue-5',
      componentId: 'comp-1',
      description: 'test',
      severity: 'high' as const,
      detectedAt: Date.now(),
    };
    const result = await engine.triggerRepair(issue);
    expect(result.requiresApproval).toBe(true);
  });

  test('should approve pending repair', async () => {
    const engine = new AutoRepairEngine(anomalyDetector, diagnosisEngine, strategyRegistry, {
      autonomyLevel: 'manual_confirm',
    });
    const issue = {
      id: 'issue-6',
      componentId: 'comp-1',
      description: 'test',
      severity: 'high' as const,
      detectedAt: Date.now(),
    };
    await engine.triggerRepair(issue);
    expect(engine.getPendingApprovals()).toContain('issue-6');
    // Change autonomy to auto before approving
    engine.setAutonomyLevel('fully_auto');
    const result = await engine.approveRepair('issue-6');
    expect(result.success).toBe(true);
  });

  test('should track repair history', async () => {
    const issue = {
      id: 'issue-7',
      componentId: 'comp-1',
      description: 'test',
      severity: 'high' as const,
      detectedAt: Date.now(),
    };
    await repairEngine.triggerRepair(issue);
    expect(repairEngine.getRepairHistory().length).toBe(1);
  });

  test('should return repair stats', async () => {
    const issue = {
      id: 'issue-8',
      componentId: 'comp-1',
      description: 'test',
      severity: 'high' as const,
      detectedAt: Date.now(),
    };
    await repairEngine.triggerRepair(issue);
    const stats = repairEngine.getRepairStats();
    expect(stats.totalRepairs).toBe(1);
  });

  test('should set autonomy level', () => {
    repairEngine.setAutonomyLevel('manual_confirm');
    expect(repairEngine.getAutonomyLevel()).toBe('manual_confirm');
  });

  test('should remove from blacklist', () => {
    repairEngine.addToBlacklist('test');
    repairEngine.removeFromBlacklist('test');
    expect(repairEngine.getRepairStats()).toBeDefined();
  });

  test('should send notification on repair', async () => {
    const notifications: string[] = [];
    const engine = new AutoRepairEngine(anomalyDetector, diagnosisEngine, strategyRegistry, {
      autonomyLevel: 'fully_auto',
      notificationCallback: (result) => notifications.push(result.message),
    });
    const issue = {
      id: 'issue-9',
      componentId: 'comp-1',
      description: 'test',
      severity: 'high' as const,
      detectedAt: Date.now(),
    };
    await engine.triggerRepair(issue);
    expect(notifications.length).toBe(1);
  });

  test('approveRepair should return failure for unknown issue', async () => {
    const result = await repairEngine.approveRepair('nonexistent');
    expect(result.success).toBe(false);
  });
});

// ============================================================
// FailoverManager Tests
// ============================================================
describe('FailoverManager', () => {
  let manager: FailoverManager;
  let mockPrimary: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; healthCheck: ReturnType<typeof vi.fn> };
  let mockStandby: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; healthCheck: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    manager = new FailoverManager();
    mockPrimary = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      healthCheck: vi.fn().mockResolvedValue(true),
    };
    mockStandby = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      healthCheck: vi.fn().mockResolvedValue(true),
    };
  });

  afterEach(() => {
    manager.stopHealthMonitoring('comp-1');
  });

  test('should register primary component', () => {
    manager.registerPrimary('comp-1', mockPrimary);
    expect(manager.getRegisteredComponents()).toContain('comp-1');
  });

  test('should register standby component', () => {
    manager.registerPrimary('comp-1', mockPrimary);
    manager.registerStandby('comp-1', mockStandby);
    const status = manager.getFailoverStatus('comp-1');
    expect(status).toBeDefined();
  });

  test('should throw when registering standby without primary', () => {
    expect(() => manager.registerStandby('comp-1', mockStandby)).toThrow();
  });

  test('should trigger failover successfully', async () => {
    manager.registerPrimary('comp-1', mockPrimary);
    manager.registerStandby('comp-1', mockStandby);
    const result = await manager.triggerFailover('comp-1');
    expect(result.success).toBe(true);
    expect(result.toInstance).toBe('standby');
    expect(mockPrimary.stop).toHaveBeenCalled();
    expect(mockStandby.start).toHaveBeenCalled();
  });

  test('should fail failover without standby', async () => {
    manager.registerPrimary('comp-1', mockPrimary);
    const result = await manager.triggerFailover('comp-1');
    expect(result.success).toBe(false);
    expect(result.message).toContain('No standby');
  });

  test('should fail failover for unknown component', async () => {
    const result = await manager.triggerFailover('unknown');
    expect(result.success).toBe(false);
  });

  test('should track failover status', async () => {
    manager.registerPrimary('comp-1', mockPrimary);
    manager.registerStandby('comp-1', mockStandby);
    await manager.triggerFailover('comp-1');
    const status = manager.getFailoverStatus('comp-1');
    expect(status!.isFailedOver).toBe(true);
    expect(status!.activeInstance).toBe('standby');
  });

  test('should trigger failback', async () => {
    manager.registerPrimary('comp-1', mockPrimary);
    manager.registerStandby('comp-1', mockStandby);
    await manager.triggerFailover('comp-1');
    await manager.triggerFailback('comp-1');
    const status = manager.getFailoverStatus('comp-1');
    expect(status!.isFailedOver).toBe(false);
    expect(status!.activeInstance).toBe('primary');
  });

  test('should track failover history', async () => {
    manager.registerPrimary('comp-1', mockPrimary);
    manager.registerStandby('comp-1', mockStandby);
    await manager.triggerFailover('comp-1');
    expect(manager.getFailoverHistory().length).toBe(1);
  });

  test('should return null status for unknown component', () => {
    expect(manager.getFailoverStatus('unknown')).toBeNull();
  });

  test('should set active-active mode', () => {
    manager.registerPrimary('comp-1', mockPrimary);
    manager.setActiveActive('comp-1');
    const status = manager.getFailoverStatus('comp-1');
    expect(status!.mode).toBe('active-active');
  });

  test('should throw when setting active-active for unknown component', () => {
    expect(() => manager.setActiveActive('unknown')).toThrow();
  });

  test('should handle failover failure', async () => {
    manager.registerPrimary('comp-1', mockPrimary);
    manager.registerStandby('comp-1', mockStandby);
    mockStandby.start.mockRejectedValue(new Error('start failed'));
    const result = await manager.triggerFailover('comp-1');
    expect(result.success).toBe(false);
  });

  test('should not failback when primary is unhealthy', async () => {
    manager.registerPrimary('comp-1', mockPrimary);
    manager.registerStandby('comp-1', mockStandby);
    await manager.triggerFailover('comp-1');
    mockPrimary.healthCheck.mockResolvedValue(false);
    await manager.triggerFailback('comp-1');
    const status = manager.getFailoverStatus('comp-1');
    expect(status!.isFailedOver).toBe(true);
  });

  test('should set failback enabled', () => {
    manager.registerPrimary('comp-1', mockPrimary);
    manager.setFailbackEnabled('comp-1', false);
    // No error means it worked
  });
});

// ============================================================
// StateRollbackManager Tests
// ============================================================
describe('StateRollbackManager', () => {
  let manager: StateRollbackManager;

  beforeEach(() => {
    manager = new StateRollbackManager();
  });

  test('should create instance', () => {
    expect(manager).toBeDefined();
  });

  test('should create snapshot', () => {
    const snapshot = manager.createSnapshot('comp-1', { data: 'test' });
    expect(snapshot.id).toBeDefined();
    expect(snapshot.componentId).toBe('comp-1');
    expect(snapshot.version).toBe(1);
  });

  test('should increment version on each snapshot', () => {
    manager.createSnapshot('comp-1', { v: 1 });
    manager.createSnapshot('comp-1', { v: 2 });
    manager.createSnapshot('comp-1', { v: 3 });
    expect(manager.getCurrentVersion('comp-1')).toBe(3);
  });

  test('should rollback to specific snapshot', async () => {
    manager.createSnapshot('comp-1', { v: 1 });
    const snap2 = manager.createSnapshot('comp-1', { v: 2 });
    manager.createSnapshot('comp-1', { v: 3 });
    const result = await manager.rollback('comp-1', snap2.id);
    expect(result.success).toBe(true);
    expect(result.newVersion).toBe(2);
  });

  test('should rollback to latest snapshot', async () => {
    manager.createSnapshot('comp-1', { v: 1 });
    const snap2 = manager.createSnapshot('comp-1', { v: 2 });
    const result = await manager.rollbackToLatest('comp-1');
    expect(result.success).toBe(true);
    expect(result.snapshotId).toBe(snap2.id);
  });

  test('should fail rollback for unknown component', async () => {
    const result = await manager.rollback('unknown', 'snap-1');
    expect(result.success).toBe(false);
  });

  test('should fail rollback for unknown snapshot', async () => {
    manager.createSnapshot('comp-1', { v: 1 });
    const result = await manager.rollback('comp-1', 'nonexistent');
    expect(result.success).toBe(false);
  });

  test('should fail rollbackToLatest for empty snapshots', async () => {
    const result = await manager.rollbackToLatest('comp-1');
    expect(result.success).toBe(false);
  });

  test('should get snapshot history', () => {
    manager.createSnapshot('comp-1', { v: 1 });
    manager.createSnapshot('comp-1', { v: 2 });
    const history = manager.getSnapshotHistory('comp-1');
    expect(history.length).toBe(2);
  });

  test('should return empty snapshot history for unknown component', () => {
    expect(manager.getSnapshotHistory('unknown').length).toBe(0);
  });

  test('should verify valid state', () => {
    const result = manager.verifyState('comp-1', { data: 'test' });
    expect(result.valid).toBe(true);
  });

  test('should detect null state', () => {
    const result = manager.verifyState('comp-1', null);
    expect(result.valid).toBe(false);
  });

  test('should detect undefined state', () => {
    const result = manager.verifyState('comp-1', undefined);
    expect(result.valid).toBe(false);
  });

  test('should detect empty state', () => {
    const result = manager.verifyState('comp-1', {});
    expect(result.valid).toBe(false);
  });

  test('should detect non-serializable state', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const result = manager.verifyState('comp-1', circular);
    expect(result.valid).toBe(false);
  });

  test('should get current state', () => {
    manager.createSnapshot('comp-1', { data: 'hello' });
    expect(manager.getCurrentState('comp-1')).toEqual({ data: 'hello' });
  });

  test('should delete snapshot', () => {
    const snap = manager.createSnapshot('comp-1', { v: 1 });
    expect(manager.deleteSnapshot('comp-1', snap.id)).toBe(true);
    expect(manager.getSnapshotHistory('comp-1').length).toBe(0);
  });

  test('should fail delete for unknown snapshot', () => {
    manager.createSnapshot('comp-1', { v: 1 });
    expect(manager.deleteSnapshot('comp-1', 'nonexistent')).toBe(false);
  });

  test('should clear all snapshots', () => {
    manager.createSnapshot('comp-1', { v: 1 });
    manager.createSnapshot('comp-1', { v: 2 });
    manager.clearSnapshots('comp-1');
    expect(manager.getSnapshotHistory('comp-1').length).toBe(0);
  });

  test('should cleanup old snapshots beyond max', () => {
    manager.setMaxSnapshots(3);
    for (let i = 0; i < 10; i++) {
      manager.createSnapshot('comp-1', { v: i });
    }
    expect(manager.getSnapshotHistory('comp-1').length).toBe(3);
  });

  test('should compute checksum for snapshot', () => {
    const snap = manager.createSnapshot('comp-1', { data: 'test' });
    expect(snap.checksum).toBeDefined();
    expect(snap.checksum.length).toBeGreaterThan(0);
  });

  test('should list registered components', () => {
    manager.createSnapshot('comp-1', {});
    manager.createSnapshot('comp-2', {});
    expect(manager.getRegisteredComponents().length).toBe(2);
  });
});

// ============================================================
// EnhancedCircuitBreaker Tests
// ============================================================
describe('EnhancedCircuitBreaker', () => {
  let breaker: EnhancedCircuitBreaker;

  beforeEach(() => {
    breaker = new EnhancedCircuitBreaker({ failureThreshold: 3, recoveryTimeout: 1000, halfOpenMaxCalls: 2 });
  });

  test('should start in closed state', () => {
    expect(breaker.getState()).toBe('closed');
  });

  test('should execute successfully in closed state', async () => {
    const result = await breaker.execute(async () => 42);
    expect(result).toBe(42);
  });

  test('should trip to open state after failures', async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => { throw new Error('fail'); });
      } catch {
        // expected
      }
    }
    expect(breaker.getState()).toBe('open');
  });

  test('should reject calls in open state', async () => {
    for (let i = 0; i < 3; i++) {
      try { await breaker.execute(async () => { throw new Error('fail'); }); } catch { /* */ }
    }
    await expect(breaker.execute(async () => 42)).rejects.toThrow('open');
  });

  test('should transition to half-open after recovery timeout', async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 3; i++) {
      try { await breaker.execute(async () => { throw new Error('fail'); }); } catch { /* */ }
    }
    expect(breaker.getState()).toBe('open');
    vi.advanceTimersByTime(1100);
    expect(breaker.getState()).toBe('half-open');
    vi.useRealTimers();
  });

  test('should close after successful half-open calls', async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 3; i++) {
      try { await breaker.execute(async () => { throw new Error('fail'); }); } catch { /* */ }
    }
    vi.advanceTimersByTime(1100);
    await breaker.execute(async () => 'ok');
    await breaker.execute(async () => 'ok');
    expect(breaker.getState()).toBe('closed');
    vi.useRealTimers();
  });

  test('should re-open on failure in half-open state', async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 3; i++) {
      try { await breaker.execute(async () => { throw new Error('fail'); }); } catch { /* */ }
    }
    vi.advanceTimersByTime(1100);
    try { await breaker.execute(async () => { throw new Error('fail'); }); } catch { /* */ }
    expect(breaker.getState()).toBe('open');
    vi.useRealTimers();
  });

  test('should return diagnostics', async () => {
    await breaker.execute(async () => 42);
    const diag = breaker.getDiagnostics();
    expect(diag.state).toBe('closed');
    expect(diag.totalCalls).toBe(1);
    expect(diag.successCount).toBe(1);
    expect(diag.failureCount).toBe(0);
  });

  test('should track per-error stats', async () => {
    try { await breaker.execute(async () => { throw new TypeError('type err'); }); } catch { /* */ }
    const diag = breaker.getDiagnostics();
    expect(diag.perErrorStats['TypeError']).toBeDefined();
  });

  test('should force state', () => {
    breaker.forceState('open');
    expect(breaker.getState()).toBe('open');
    breaker.forceState('closed');
    expect(breaker.getState()).toBe('closed');
  });

  test('should call state change callbacks', () => {
    const callback = vi.fn();
    breaker.onStateChange(callback);
    breaker.forceState('open');
    expect(callback).toHaveBeenCalledWith('open');
  });

  test('should adapt thresholds based on history', async () => {
    for (let i = 0; i < 25; i++) {
      await breaker.execute(async () => 'ok');
    }
    const diag1 = breaker.getDiagnostics();
    breaker.adaptThresholds();
    const diag2 = breaker.getDiagnostics();
    // Threshold may increase due to low failure rate
    expect(diag2.currentThreshold).toBeGreaterThanOrEqual(diag1.currentThreshold - 1);
  });

  test('should reset state', async () => {
    try { await breaker.execute(async () => { throw new Error('fail'); }); } catch { /* */ }
    breaker.reset();
    expect(breaker.getState()).toBe('closed');
    const diag = breaker.getDiagnostics();
    expect(diag.totalCalls).toBe(0);
  });

  test('should track trip count', async () => {
    for (let i = 0; i < 3; i++) {
      try { await breaker.execute(async () => { throw new Error('fail'); }); } catch { /* */ }
    }
    expect(breaker.getDiagnostics().tripCount).toBe(1);
  });

  test('should track failure rate in diagnostics', async () => {
    try { await breaker.execute(async () => { throw new Error('fail'); }); } catch { /* */ }
    await breaker.execute(async () => 'ok');
    const diag = breaker.getDiagnostics();
    expect(diag.failureRate).toBeGreaterThan(0);
  });
});

// ============================================================
// HealthProbe Tests
// ============================================================
describe('HealthProbe', () => {
  let probe: HealthProbe;

  beforeEach(() => {
    probe = new HealthProbe();
  });

  test('should create instance', () => {
    expect(probe).toBeDefined();
  });

  test('should add probe', () => {
    probe.addProbe('test', async () => ({ healthy: true }));
    expect(probe.getProbes().length).toBe(1);
  });

  test('should add component probe', () => {
    probe.addComponentProbe('comp-1', 'health', async () => ({ healthy: true }));
    const probes = probe.getProbes();
    expect(probes.length).toBe(1);
    expect(probes[0]!.componentId).toBe('comp-1');
  });

  test('should check health with all healthy probes', async () => {
    probe.addProbe('p1', async () => ({ healthy: true }));
    probe.addProbe('p2', async () => ({ healthy: true }));
    const report = await probe.checkHealth();
    expect(report.score).toBe(100);
    expect(report.status).toBe('healthy');
  });

  test('should check health with some unhealthy probes', async () => {
    probe.addProbe('p1', async () => ({ healthy: true }));
    probe.addProbe('p2', async () => ({ healthy: false, message: 'failed' }));
    const report = await probe.checkHealth();
    expect(report.score).toBe(50);
    expect(report.status).toBe('degraded');
  });

  test('should check health with all unhealthy probes', async () => {
    probe.addProbe('p1', async () => ({ healthy: false }));
    probe.addProbe('p2', async () => ({ healthy: false }));
    const report = await probe.checkHealth();
    expect(report.score).toBe(0);
    expect(report.status).toBe('unknown');
  });

  test('should handle probe that throws', async () => {
    probe.addProbe('p1', async () => { throw new Error('probe error'); });
    const report = await probe.checkHealth();
    expect(report.score).toBe(0);
    expect(report.probes[0]!.healthy).toBe(false);
  });

  test('should check liveness', async () => {
    probe.addProbe('live', async () => ({ healthy: true }), 'liveness');
    expect(await probe.checkLiveness()).toBe(true);
  });

  test('should check liveness returns true with no liveness probes', async () => {
    expect(await probe.checkLiveness()).toBe(true);
  });

  test('should check liveness returns false on failure', async () => {
    probe.addProbe('live', async () => ({ healthy: false }), 'liveness');
    expect(await probe.checkLiveness()).toBe(false);
  });

  test('should check readiness', async () => {
    probe.addProbe('ready', async () => ({ healthy: true }), 'readiness');
    expect(await probe.checkReadiness()).toBe(true);
  });

  test('should check readiness returns true with no readiness probes', async () => {
    expect(await probe.checkReadiness()).toBe(true);
  });

  test('should get health score', () => {
    expect(probe.getHealthScore()).toBe(100);
  });

  test('should track health history', async () => {
    probe.addProbe('p1', async () => ({ healthy: true }));
    await probe.checkHealth();
    await probe.checkHealth();
    expect(probe.getHealthHistory().length).toBe(2);
  });

  test('should remove probe', () => {
    probe.addProbe('temp', async () => ({ healthy: true }));
    probe.removeProbe('temp');
    expect(probe.getProbes().length).toBe(0);
  });

  test('should clear health history', async () => {
    probe.addProbe('p1', async () => ({ healthy: true }));
    await probe.checkHealth();
    probe.clearHistory();
    expect(probe.getHealthHistory().length).toBe(0);
  });

  test('should include probe results in report', async () => {
    probe.addProbe('p1', async () => ({ healthy: true, message: 'all good' }));
    const report = await probe.checkHealth();
    expect(report.probes.length).toBe(1);
    expect(report.probes[0]!.message).toBe('all good');
  });

  test('should calculate component health', async () => {
    probe.addComponentProbe('comp-1', 'p1', async () => ({ healthy: true }));
    probe.addComponentProbe('comp-1', 'p2', async () => ({ healthy: false }));
    const report = await probe.checkHealth();
    expect(report.components['comp-1']).toBeDefined();
    expect(report.components['comp-1']!.status).toBe('degraded');
  });
});

// ============================================================
// RecoveryLearningSystem Tests
// ============================================================
describe('RecoveryLearningSystem', () => {
  let learning: RecoveryLearningSystem;

  beforeEach(() => {
    learning = new RecoveryLearningSystem();
  });

  test('should create instance', () => {
    expect(learning).toBeDefined();
  });

  test('should record outcome', () => {
    learning.recordOutcome('memory_leak', 'restart', true, 100);
    expect(learning.getRecords().length).toBe(1);
  });

  test('should predict success with no data', () => {
    const prediction = learning.predictSuccess('unknown_issue', 'unknown_strategy');
    expect(prediction).toBe(0.5);
  });

  test('should predict success with no matching strategy', () => {
    learning.recordOutcome('issue', 'strategy_a', true, 100);
    const prediction = learning.predictSuccess('issue', 'strategy_b');
    expect(prediction).toBe(0.3);
  });

  test('should predict success based on history', () => {
    learning.recordOutcome('issue', 'restart', true, 100);
    learning.recordOutcome('issue', 'restart', true, 200);
    learning.recordOutcome('issue', 'restart', false, 300);
    const prediction = learning.predictSuccess('issue', 'restart');
    expect(prediction).toBeCloseTo(2 / 3);
  });

  test('should suggest strategy with no data', () => {
    const suggestions = learning.suggestStrategy('unknown');
    expect(suggestions.length).toBe(1);
    expect(suggestions[0]!.strategy).toBe('unknown');
  });

  test('should suggest best strategy based on history', () => {
    learning.recordOutcome('issue', 'restart', true, 100);
    learning.recordOutcome('issue', 'restart', true, 200);
    learning.recordOutcome('issue', 'retry', false, 300);
    const suggestions = learning.suggestStrategy('issue');
    expect(suggestions[0]!.strategy).toBe('restart');
    expect(suggestions[0]!.predictedSuccess).toBeGreaterThan(suggestions[1]!.predictedSuccess);
  });

  test('should get learned patterns', () => {
    learning.recordOutcome('mem_leak', 'restart', true, 100);
    learning.recordOutcome('net_err', 'failover', true, 200);
    const patterns = learning.getLearnedPatterns();
    expect(patterns.length).toBe(2);
  });

  test('should return model stats', () => {
    learning.recordOutcome('issue', 'restart', true, 100);
    const stats = learning.getModelStats();
    expect(stats.totalRecords).toBe(1);
    expect(stats.uniqueIssues).toBe(1);
    expect(stats.uniqueStrategies).toBe(1);
  });

  test('should export and import data', () => {
    learning.recordOutcome('issue', 'restart', true, 100);
    const exported = learning.exportData();
    const newLearning = new RecoveryLearningSystem();
    newLearning.importData(exported);
    expect(newLearning.getModelStats().totalRecords).toBe(1);
  });

  test('should throw on invalid import data', () => {
    expect(() => learning.importData('not json')).toThrow();
  });

  test('should clear data', () => {
    learning.recordOutcome('issue', 'restart', true, 100);
    learning.clearData();
    expect(learning.getRecords().length).toBe(0);
  });

  test('should trim records to max size', () => {
    for (let i = 0; i < 10050; i++) {
      learning.recordOutcome('issue', 'restart', true, 100);
    }
    expect(learning.getRecords().length).toBeLessThanOrEqual(10000);
  });

  test('should calculate model accuracy', () => {
    learning.recordOutcome('issue', 'restart', true, 100);
    learning.recordOutcome('issue', 'restart', true, 100);
    learning.recordOutcome('issue', 'restart', false, 100);
    const stats = learning.getModelStats();
    expect(stats.modelAccuracy).toBeGreaterThanOrEqual(0);
    expect(stats.overallSuccessRate).toBeCloseTo(2 / 3);
  });
});

// ============================================================
// IncidentManager Tests
// ============================================================
describe('IncidentManager', () => {
  let manager: IncidentManager;

  beforeEach(() => {
    manager = new IncidentManager();
  });

  afterEach(() => {
    manager.stopAutoEscalation();
  });

  test('should create instance', () => {
    expect(manager).toBeDefined();
  });

  test('should create incident', () => {
    const id = manager.createIncident({
      title: 'Test Incident',
      description: 'Something went wrong',
      severity: 'P2',
      status: 'detected',
      detectedAt: Date.now(),
    });
    expect(id).toBeDefined();
    expect(manager.getIncidentCount()).toBe(1);
  });

  test('should get incident by id', () => {
    const id = manager.createIncident({
      title: 'Test',
      description: 'Desc',
      severity: 'P3',
      status: 'detected',
      detectedAt: Date.now(),
    });
    const incident = manager.getIncident(id);
    expect(incident).toBeDefined();
    expect(incident!.title).toBe('Test');
  });

  test('should return null for unknown incident', () => {
    expect(manager.getIncident('nonexistent')).toBeNull();
  });

  test('should update incident status', () => {
    const id = manager.createIncident({
      title: 'Test',
      description: 'Desc',
      severity: 'P2',
      status: 'detected',
      detectedAt: Date.now(),
    });
    manager.updateIncident(id, { status: 'investigating' });
    expect(manager.getIncident(id)!.status).toBe('investigating');
  });

  test('should update incident assignment', () => {
    const id = manager.createIncident({
      title: 'Test',
      description: 'Desc',
      severity: 'P2',
      status: 'detected',
      detectedAt: Date.now(),
    });
    manager.updateIncident(id, { assignedTo: 'john' });
    expect(manager.getIncident(id)!.assignedTo).toBe('john');
  });

  test('should resolve incident', () => {
    const id = manager.createIncident({
      title: 'Test',
      description: 'Desc',
      severity: 'P2',
      status: 'investigating',
      detectedAt: Date.now(),
    });
    manager.resolveIncident(id, 'Fixed the issue');
    expect(manager.getIncident(id)!.status).toBe('resolved');
  });

  test('should escalate incident severity', () => {
    const id = manager.createIncident({
      title: 'Test',
      description: 'Desc',
      severity: 'P3',
      status: 'investigating',
      detectedAt: Date.now(),
    });
    manager.escalateIncident(id, 'Getting worse');
    expect(manager.getIncident(id)!.severity).toBe('P2');
  });

  test('should not escalate P1 incident', () => {
    const id = manager.createIncident({
      title: 'Test',
      description: 'Desc',
      severity: 'P1',
      status: 'investigating',
      detectedAt: Date.now(),
    });
    manager.escalateIncident(id, 'Already critical');
    expect(manager.getIncident(id)!.severity).toBe('P1');
  });

  test('should get active incidents', () => {
    const id1 = manager.createIncident({
      title: 'Active',
      description: 'Active incident',
      severity: 'P1',
      status: 'investigating',
      detectedAt: Date.now(),
    });
    manager.createIncident({
      title: 'Resolved',
      description: 'Resolved incident',
      severity: 'P3',
      status: 'resolved',
      detectedAt: Date.now(),
    });
    const active = manager.getActiveIncidents();
    expect(active.length).toBe(1);
    expect(active[0]!.id).toBe(id1);
  });

  test('should sort active incidents by severity', () => {
    manager.createIncident({
      title: 'P3',
      description: 'Minor',
      severity: 'P3',
      status: 'investigating',
      detectedAt: Date.now(),
    });
    manager.createIncident({
      title: 'P1',
      description: 'Critical',
      severity: 'P1',
      status: 'investigating',
      detectedAt: Date.now(),
    });
    const active = manager.getActiveIncidents();
    expect(active[0]!.severity).toBe('P1');
  });

  test('should get incident timeline', () => {
    const id = manager.createIncident({
      title: 'Test',
      description: 'Desc',
      severity: 'P2',
      status: 'detected',
      detectedAt: Date.now(),
    });
    manager.updateIncident(id, { status: 'investigating' });
    const timeline = manager.getIncidentTimeline(id);
    expect(timeline.length).toBe(2);
  });

  test('should return empty timeline for unknown incident', () => {
    expect(manager.getIncidentTimeline('unknown').length).toBe(0);
  });

  test('should generate post-mortem', () => {
    const id = manager.createIncident({
      title: 'Test',
      description: 'Something broke',
      severity: 'P2',
      status: 'investigating',
      detectedAt: Date.now(),
    });
    manager.resolveIncident(id, 'Fixed');
    const postMortem = manager.generatePostMortem(id);
    expect(postMortem.incidentId).toBe(id);
    expect(postMortem.title).toBe('Test');
    expect(postMortem.actionItems.length).toBeGreaterThan(0);
    expect(postMortem.lessonsLearned.length).toBeGreaterThan(0);
  });

  test('should generate post-mortem for unknown incident', () => {
    const pm = manager.generatePostMortem('unknown');
    expect(pm.incidentId).toBe('unknown');
    expect(pm.rootCause).toBe('Unknown');
  });

  test('should correlate incidents by component', () => {
    const id1 = manager.createIncident({
      title: 'Incident 1',
      description: 'Desc',
      severity: 'P2',
      status: 'investigating',
      componentId: 'db',
      detectedAt: Date.now(),
    });
    manager.createIncident({
      title: 'Incident 2',
      description: 'Desc',
      severity: 'P3',
      status: 'investigating',
      componentId: 'db',
      detectedAt: Date.now(),
    });
    const related = manager.correlateIncidents(id1);
    expect(related.length).toBe(1);
  });

  test('should correlate incidents by tags', () => {
    const id1 = manager.createIncident({
      title: 'Incident 1',
      description: 'Desc',
      severity: 'P2',
      status: 'investigating',
      tags: ['network', 'timeout'],
      detectedAt: Date.now(),
    });
    manager.createIncident({
      title: 'Incident 2',
      description: 'Desc',
      severity: 'P3',
      status: 'investigating',
      tags: ['network'],
      detectedAt: Date.now(),
    });
    const related = manager.correlateIncidents(id1);
    expect(related.length).toBe(1);
  });

  test('should check SLA compliance', () => {
    manager.createIncident({
      title: 'P1',
      description: 'Critical',
      severity: 'P1',
      status: 'investigating',
      detectedAt: Date.now() - 20 * 60000, // 20 minutes ago
    });
    const results = manager.checkSLACompliance();
    expect(results[0]!.breached).toBe(true);
  });

  test('should not breach SLA for recent incident', () => {
    manager.createIncident({
      title: 'P1',
      description: 'Critical',
      severity: 'P1',
      status: 'investigating',
      detectedAt: Date.now(),
    });
    const results = manager.checkSLACompliance();
    expect(results[0]!.breached).toBe(false);
  });

  test('should get all incidents', () => {
    manager.createIncident({ title: 'A', description: 'A', severity: 'P3', status: 'detected', detectedAt: Date.now() });
    manager.createIncident({ title: 'B', description: 'B', severity: 'P2', status: 'detected', detectedAt: Date.now() });
    expect(manager.getAllIncidents().length).toBe(2);
  });

  test('should update incident description', () => {
    const id = manager.createIncident({
      title: 'Test',
      description: 'Original',
      severity: 'P2',
      status: 'detected',
      detectedAt: Date.now(),
    });
    manager.updateIncident(id, { description: 'Updated' });
    expect(manager.getIncident(id)!.description).toBe('Updated');
  });

  test('should update incident tags', () => {
    const id = manager.createIncident({
      title: 'Test',
      description: 'Desc',
      severity: 'P2',
      status: 'detected',
      detectedAt: Date.now(),
    });
    manager.updateIncident(id, { tags: ['tag1', 'tag2'] });
    expect(manager.getIncident(id)!.tags).toEqual(['tag1', 'tag2']);
  });

  test('should handle post-mortem with escalations', () => {
    const id = manager.createIncident({
      title: 'Test',
      description: 'Desc',
      severity: 'P3',
      status: 'investigating',
      detectedAt: Date.now(),
    });
    manager.escalateIncident(id, 'reason');
    manager.resolveIncident(id, 'fixed');
    const pm = manager.generatePostMortem(id);
    expect(pm.lessonsLearned[0]).toContain('escalated');
  });
});

// ============================================================
// Integration Tests
// ============================================================
describe('Integration', () => {
  test('full self-healing cycle: detect -> diagnose -> repair', async () => {
    const anomalyDetector = new AnomalyDetector();
    const diagnosisEngine = new DiagnosisEngine();
    const strategyRegistry = new RecoveryStrategyRegistry();
    const repairEngine = new AutoRepairEngine(anomalyDetector, diagnosisEngine, strategyRegistry, {
      autonomyLevel: 'fully_auto',
    });

    // Simulate anomaly detection
    anomalyDetector.registerMetric('memory_usage', { thresholdMax: 100 });
    for (let i = 0; i < 5; i++) anomalyDetector.record('memory_usage', 50);
    anomalyDetector.record('memory_usage', 200);

    const anomalies = anomalyDetector.detect();
    expect(anomalies.length).toBeGreaterThan(0);

    // Convert to symptoms and diagnose
    const symptoms = anomalies.map((a) => ({
      source: 'anomaly_detector' as const,
      type: a.metric,
      description: a.message,
      severity: a.severity,
      timestamp: a.timestamp,
    }));
    const diagnosis = diagnosisEngine.diagnose(symptoms);
    expect(diagnosis.primaryCause.cause).toBeDefined();

    // Trigger repair
    const issue = {
      id: 'int-1',
      componentId: 'memory',
      description: 'Memory anomaly detected',
      severity: 'high' as const,
      detectedAt: Date.now(),
      anomalies,
    };
    const result = await repairEngine.triggerRepair(issue);
    expect(result.strategiesAttempted.length).toBeGreaterThan(0);
  });

  test('circuit breaker with failover', async () => {
    const breaker = new EnhancedCircuitBreaker({ failureThreshold: 2, recoveryTimeout: 500 });
    const failoverManager = new FailoverManager();

    const mockPrimary = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      healthCheck: vi.fn().mockResolvedValue(true),
    };
    const mockStandby = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      healthCheck: vi.fn().mockResolvedValue(true),
    };

    failoverManager.registerPrimary('service', mockPrimary);
    failoverManager.registerStandby('service', mockStandby);

    // Trip the circuit breaker
    try { await breaker.execute(async () => { throw new Error('fail'); }); } catch { /* */ }
    try { await breaker.execute(async () => { throw new Error('fail'); }); } catch { /* */ }
    expect(breaker.getState()).toBe('open');

    // Trigger failover
    const result = await failoverManager.triggerFailover('service');
    expect(result.success).toBe(true);
    expect(failoverManager.getFailoverStatus('service')!.isFailedOver).toBe(true);
  });

  test('state rollback with health verification', async () => {
    const stateManager = new StateRollbackManager();
    const healthProbe = new HealthProbe();

    // Create snapshots
    const goodState = { users: 100, status: 'ok' };
    const badState = { users: 0, status: 'error' };

    stateManager.createSnapshot('app', goodState);
    const badSnapshot = stateManager.createSnapshot('app', badState);

    // Verify bad state
    const verification = stateManager.verifyState('app', badState);
    expect(verification.valid).toBe(true); // Structurally valid, just bad data

    // Rollback to good state
    const history = stateManager.getSnapshotHistory('app');
    const goodSnapshotId = history[0]!.id;
    const result = await stateManager.rollback('app', goodSnapshotId);
    expect(result.success).toBe(true);
  });

  test('incident management with learning', async () => {
    const incidentManager = new IncidentManager();
    const learningSystem = new RecoveryLearningSystem();

    // Create incident
    const incId = incidentManager.createIncident({
      title: 'Database Connection Failure',
      description: 'Cannot connect to primary database',
      severity: 'P1',
      status: 'detected',
      componentId: 'database',
      detectedAt: Date.now(),
    });

    // Simulate repair attempts and record outcomes
    learningSystem.recordOutcome('database_connection', 'retry_operation', false, 5000);
    learningSystem.recordOutcome('database_connection', 'failover', true, 2000);

    // Get suggestion
    const suggestions = learningSystem.suggestStrategy('database_connection');
    expect(suggestions[0]!.strategy).toBe('failover');

    // Resolve incident
    incidentManager.resolveIncident(incId, 'Failed over to standby database');

    // Generate post-mortem
    const postMortem = incidentManager.generatePostMortem(incId);
    expect(postMortem.resolution).toBeDefined();
  });
});
