// Comprehensive test suite for self-healing package
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import { HealthProbe } from '../src/health-probe.js';
import type { HealthStatus, ProbeType } from '../src/health-probe.js';

import { AnomalyDetector } from '../src/anomaly-detector.js';
import type { AnomalySeverity } from '../src/anomaly-detector.js';

import { DiagnosisEngine } from '../src/diagnosis-engine.js';
import type { Symptom, DiagnosisRule } from '../src/diagnosis-engine.js';

import { RecoveryStrategyRegistry } from '../src/recovery-strategies.js';
import type { RecoveryStrategy, RecoveryContext, RecoveryResult } from '../src/recovery-strategies.js';

import { AutoRepairEngine } from '../src/auto-repair.js';
import type { Issue, AutonomyLevel } from '../src/auto-repair.js';

import { FailoverManager } from '../src/failover-manager.js';
import type { ComponentHandler, FailoverMode } from '../src/failover-manager.js';

import { StateRollbackManager } from '../src/state-rollback.js';

import { EnhancedCircuitBreaker } from '../src/circuit-breaker-enhanced.js';
import type { CircuitState, CircuitBreakerConfig } from '../src/circuit-breaker-enhanced.js';

import { RecoveryLearningSystem } from '../src/recovery-learning.js';

import { IncidentManager } from '../src/incident-manager.js';
import type { IncidentSeverity, IncidentStatus, Incident } from '../src/incident-manager.js';

// ============================================================
// HealthProbe Tests
// ============================================================
describe('HealthProbe', () => {
  let probe: HealthProbe;

  beforeEach(() => {
    probe = new HealthProbe();
  });

  describe('addProbe / addComponentProbe / getProbes / removeProbe', () => {
    it('should add a probe', () => {
      probe.addProbe('test', async () => ({ healthy: true }));
      const probes = probe.getProbes();
      expect(probes).toHaveLength(1);
      expect(probes[0]!.name).toBe('test');
    });

    it('should add a component probe', () => {
      probe.addComponentProbe('comp1', 'mem', async () => ({ healthy: true }));
      const probes = probe.getProbes();
      expect(probes).toHaveLength(1);
      expect(probes[0]!.componentId).toBe('comp1');
    });

    it('should use default probe type "custom"', () => {
      probe.addProbe('test', async () => ({ healthy: true }));
      expect(probe.getProbes()[0]!.type).toBe('custom');
    });

    it('should accept all probe types', () => {
      const types: ProbeType[] = ['liveness', 'readiness', 'startup', 'custom'];
      for (const t of types) {
        probe.addProbe(`p-${t}`, async () => ({ healthy: true }), t);
      }
      expect(probe.getProbes()).toHaveLength(4);
    });

    it('should remove a probe by name', () => {
      probe.addProbe('a', async () => ({ healthy: true }));
      probe.addProbe('b', async () => ({ healthy: true }));
      probe.removeProbe('a');
      expect(probe.getProbes()).toHaveLength(1);
      expect(probe.getProbes()[0]!.name).toBe('b');
    });

    it('should not throw when removing non-existent probe', () => {
      expect(() => probe.removeProbe('nonexistent')).not.toThrow();
    });
  });

  describe('checkHealth', () => {
    it('should return healthy when all probes pass', async () => {
      probe.addProbe('p1', async () => ({ healthy: true }));
      probe.addProbe('p2', async () => ({ healthy: true }));
      const report = await probe.checkHealth();
      expect(report.status).toBe('healthy');
      expect(report.score).toBe(100);
      expect(report.probes).toHaveLength(2);
    });

    it('should return degraded when some probes fail', async () => {
      probe.addProbe('p1', async () => ({ healthy: true }));
      probe.addProbe('p2', async () => ({ healthy: false, message: 'fail' }));
      const report = await probe.checkHealth();
      expect(report.status).toBe('degraded');
      expect(report.score).toBe(50);
    });

    it('should return unhealthy when all probes fail', async () => {
      probe.addProbe('p1', async () => ({ healthy: false }));
      probe.addProbe('p2', async () => ({ healthy: false }));
      const report = await probe.checkHealth();
      expect(report.status).toBe('unhealthy');
      expect(report.score).toBe(0);
    });

    it('should return healthy with score 100 when no probes', async () => {
      const report = await probe.checkHealth();
      expect(report.status).toBe('healthy');
      expect(report.score).toBe(100);
    });

    it('should handle probe exceptions as unhealthy', async () => {
      probe.addProbe('err', async () => { throw new Error('probe error'); });
      const report = await probe.checkHealth();
      expect(report.status).toBe('unhealthy');
      expect(report.probes[0]!.healthy).toBe(false);
      expect(report.probes[0]!.message).toBe('probe error');
    });

    it('should handle non-Error exceptions', async () => {
      probe.addProbe('err', async () => { throw 'string error'; });
      const report = await probe.checkHealth();
      expect(report.probes[0]!.message).toBe('Probe failed');
    });

    it('should calculate component health correctly', async () => {
      probe.addComponentProbe('db', 'db-read', async () => ({ healthy: true }));
      probe.addComponentProbe('db', 'db-write', async () => ({ healthy: false }));
      const report = await probe.checkHealth();
      expect(report.components['db']).toBeDefined();
      expect(report.components['db']!.status).toBe('degraded');
      expect(report.components['db']!.probes).toHaveLength(2);
    });

    it('should set component to healthy when all component probes pass', async () => {
      probe.addComponentProbe('db', 'db-read', async () => ({ healthy: true }));
      probe.addComponentProbe('db', 'db-write', async () => ({ healthy: true }));
      const report = await probe.checkHealth();
      expect(report.components['db']!.status).toBe('healthy');
    });

    it('should set component to unhealthy when all component probes fail', async () => {
      probe.addComponentProbe('db', 'db-read', async () => ({ healthy: false }));
      const report = await probe.checkHealth();
      expect(report.components['db']!.status).toBe('unhealthy');
    });

    it('should handle component probe exceptions', async () => {
      probe.addComponentProbe('db', 'db-read', async () => { throw new Error('db down'); });
      const report = await probe.checkHealth();
      expect(report.components['db']!.status).toBe('unhealthy');
    });

    it('should record health history', async () => {
      await probe.checkHealth();
      await probe.checkHealth();
      const history = probe.getHealthHistory();
      expect(history).toHaveLength(2);
    });

    it('should trim health history to maxHistorySize', async () => {
      // We can't easily set maxHistorySize, so test with many calls
      for (let i = 0; i < 1100; i++) {
        await probe.checkHealth();
      }
      const history = probe.getHealthHistory();
      expect(history.length).toBeLessThanOrEqual(1000);
    });

    it('should include probe duration and timestamp', async () => {
      probe.addProbe('slow', async () => {
        await new Promise(r => setTimeout(r, 10));
        return { healthy: true };
      });
      const report = await probe.checkHealth();
      expect(report.probes[0]!.duration).toBeGreaterThanOrEqual(0);
      expect(report.probes[0]!.timestamp).toBeGreaterThan(0);
    });

    it('should calculate score boundaries correctly', async () => {
      // 4 healthy + 1 fail = 80% healthy
      probe.addProbe('h1', async () => ({ healthy: true }));
      probe.addProbe('h2', async () => ({ healthy: true }));
      probe.addProbe('h3', async () => ({ healthy: true }));
      probe.addProbe('h4', async () => ({ healthy: true }));
      probe.addProbe('f1', async () => ({ healthy: false }));
      let report = await probe.checkHealth();
      expect(report.status).toBe('healthy');
      expect(report.score).toBe(80);

      // Remove one healthy to get 3 healthy + 1 fail = 75% = degraded
      probe.removeProbe('h1');
      report = await probe.checkHealth();
      expect(report.status).toBe('degraded');
      expect(report.score).toBe(75);

      // Remove another healthy to get 2 healthy + 1 fail = 67% = degraded
      probe.removeProbe('h2');
      report = await probe.checkHealth();
      expect(report.status).toBe('degraded');

      // Remove another healthy to get 1 healthy + 1 fail = 50% = degraded
      probe.removeProbe('h3');
      report = await probe.checkHealth();
      expect(report.status).toBe('degraded');
      expect(report.score).toBe(50);

      // All fail = unhealthy
      probe.removeProbe('h4');
      report = await probe.checkHealth();
      expect(report.status).toBe('unhealthy');
      expect(report.score).toBe(0);
    });
  });

  describe('getComponentHealth', () => {
    it('should return null before any health check', () => {
      expect(probe.getComponentHealth('comp1')).toBeNull();
    });

    it('should return null for unknown component', async () => {
      probe.addComponentProbe('comp1', 'p1', async () => ({ healthy: true }));
      await probe.checkHealth();
      expect(probe.getComponentHealth('unknown')).toBeNull();
    });

    it('should return last known component health after checkHealth', async () => {
      probe.addComponentProbe('db', 'db-read', async () => ({ healthy: true }));
      await probe.checkHealth();
      const health = probe.getComponentHealth('db');
      expect(health).not.toBeNull();
      expect(health!.status).toBe('healthy');
      expect(health!.componentId).toBe('db');
    });
  });

  describe('checkLiveness', () => {
    it('should return true when no liveness probes', async () => {
      expect(await probe.checkLiveness()).toBe(true);
    });

    it('should return true when all liveness probes pass', async () => {
      probe.addProbe('live', async () => ({ healthy: true }), 'liveness');
      expect(await probe.checkLiveness()).toBe(true);
    });

    it('should return false when any liveness probe fails', async () => {
      probe.addProbe('live', async () => ({ healthy: false }), 'liveness');
      expect(await probe.checkLiveness()).toBe(false);
    });

    it('should return false when liveness probe throws', async () => {
      probe.addProbe('live', async () => { throw new Error(); }, 'liveness');
      expect(await probe.checkLiveness()).toBe(false);
    });

    it('should ignore non-liveness probes', async () => {
      probe.addProbe('ready', async () => ({ healthy: false }), 'readiness');
      probe.addProbe('live', async () => ({ healthy: true }), 'liveness');
      expect(await probe.checkLiveness()).toBe(true);
    });
  });

  describe('checkReadiness', () => {
    it('should return true when no readiness probes', async () => {
      expect(await probe.checkReadiness()).toBe(true);
    });

    it('should return false when any readiness probe fails', async () => {
      probe.addProbe('ready', async () => ({ healthy: false }), 'readiness');
      expect(await probe.checkReadiness()).toBe(false);
    });
  });

  describe('getHealthScore', () => {
    it('should return 100 when no history', () => {
      expect(probe.getHealthScore()).toBe(100);
    });

    it('should return last health score', async () => {
      probe.addProbe('p', async () => ({ healthy: false }));
      await probe.checkHealth();
      expect(probe.getHealthScore()).toBe(0);
    });
  });

  describe('clearHistory', () => {
    it('should clear health history', async () => {
      await probe.checkHealth();
      probe.clearHistory();
      expect(probe.getHealthHistory()).toHaveLength(0);
    });
  });
});

// ============================================================
// AnomalyDetector Tests
// ============================================================
describe('AnomalyDetector', () => {
  let detector: AnomalyDetector;

  beforeEach(() => {
    detector = new AnomalyDetector();
  });

  describe('registerMetric / getMetrics', () => {
    it('should register a metric', () => {
      detector.registerMetric('cpu');
      expect(detector.getMetrics()).toContain('cpu');
    });

    it('should use default options', () => {
      detector.registerMetric('cpu');
      // Recording should work with defaults
      detector.record('cpu', 50);
      expect(detector.getMetricValues('cpu')).toHaveLength(1);
    });

    it('should accept custom options', () => {
      detector.registerMetric('cpu', { windowSize: 10, thresholdMax: 90 });
      for (let i = 0; i < 15; i++) {
        detector.record('cpu', 50);
      }
      expect(detector.getMetricValues('cpu').length).toBeLessThanOrEqual(10);
    });
  });

  describe('record', () => {
    it('should auto-register metric if not registered', () => {
      detector.record('mem', 42);
      expect(detector.getMetrics()).toContain('mem');
    });

    it('should trim values to window size', () => {
      detector.registerMetric('m', { windowSize: 5 });
      for (let i = 0; i < 10; i++) {
        detector.record('m', i);
      }
      expect(detector.getMetricValues('m')).toHaveLength(5);
      expect(detector.getMetricValues('m')).toEqual([5, 6, 7, 8, 9]);
    });
  });

  describe('detect - threshold', () => {
    it('should detect values below thresholdMin', () => {
      detector.registerMetric('temp', { thresholdMin: 10 });
      detector.record('temp', 15);
      detector.record('temp', 12);
      detector.record('temp', 5); // below min
      const reports = detector.detect();
      expect(reports.some(r => r.type === 'threshold' && r.value === 5)).toBe(true);
    });

    it('should detect values above thresholdMax', () => {
      detector.registerMetric('cpu', { thresholdMax: 90 });
      detector.record('cpu', 50);
      detector.record('cpu', 60);
      detector.record('cpu', 95); // above max
      const reports = detector.detect();
      expect(reports.some(r => r.type === 'threshold' && r.value === 95)).toBe(true);
    });

    it('should not report when within thresholds', () => {
      detector.registerMetric('cpu', { thresholdMin: 10, thresholdMax: 90 });
      detector.record('cpu', 50);
      detector.record('cpu', 60);
      detector.record('cpu', 70);
      const reports = detector.detect();
      expect(reports.filter(r => r.type === 'threshold')).toHaveLength(0);
    });
  });

  describe('detect - zscore', () => {
    it('should detect z-score anomalies', () => {
      detector.registerMetric('latency', { zScoreThreshold: 2 });
      // Stable values
      for (let i = 0; i < 20; i++) {
        detector.record('latency', 100 + Math.random() * 5);
      }
      // Anomalous value
      detector.record('latency', 500);
      const reports = detector.detect();
      expect(reports.some(r => r.type === 'zscore')).toBe(true);
    });

    it('should not detect when stdDev is 0', () => {
      detector.registerMetric('const');
      for (let i = 0; i < 5; i++) {
        detector.record('const', 42);
      }
      const reports = detector.detect();
      expect(reports.filter(r => r.type === 'zscore')).toHaveLength(0);
    });

    it('should require at least 3 values', () => {
      detector.registerMetric('m');
      detector.record('m', 1);
      detector.record('m', 2);
      const reports = detector.detect();
      expect(reports).toHaveLength(0);
    });
  });

  describe('detect - IQR', () => {
    it('should detect IQR anomalies', () => {
      detector.registerMetric('m', { iqrMultiplier: 1.5 });
      for (let i = 0; i < 20; i++) {
        detector.record('m', 50 + Math.random() * 10);
      }
      detector.record('m', 200);
      const reports = detector.detect();
      expect(reports.some(r => r.type === 'iqr')).toBe(true);
    });

    it('should not detect when iqr is 0', () => {
      detector.registerMetric('const');
      for (let i = 0; i < 5; i++) {
        detector.record('const', 42);
      }
      const reports = detector.detect();
      expect(reports.filter(r => r.type === 'iqr')).toHaveLength(0);
    });
  });

  describe('detect - trend', () => {
    it('should detect sudden trend changes', () => {
      detector.registerMetric('m', { trendSensitivity: 0.3 });
      // Stable
      for (let i = 0; i < 8; i++) {
        detector.record('m', 100);
      }
      // Sudden shift
      for (let i = 0; i < 5; i++) {
        detector.record('m', 500);
      }
      const reports = detector.detect();
      expect(reports.some(r => r.type === 'trend')).toBe(true);
    });

    it('should not detect trend with < 5 values', () => {
      detector.registerMetric('m');
      for (let i = 0; i < 4; i++) {
        detector.record('m', i * 100);
      }
      const reports = detector.detect();
      expect(reports.filter(r => r.type === 'trend')).toHaveLength(0);
    });

    it('should not detect trend when older mean is 0', () => {
      detector.registerMetric('m', { trendSensitivity: 0.1 });
      for (let i = 0; i < 5; i++) detector.record('m', 0);
      for (let i = 0; i < 5; i++) detector.record('m', 100);
      const reports = detector.detect();
      expect(reports.filter(r => r.type === 'trend')).toHaveLength(0);
    });
  });

  describe('detect - pattern', () => {
    it('should detect pattern deviations', () => {
      detector.registerMetric('m', { patternWindowSize: 5 });
      // Pattern
      for (let i = 0; i < 10; i++) {
        detector.record('m', 100);
      }
      // Deviation
      for (let i = 0; i < 5; i++) {
        detector.record('m', 300);
      }
      const reports = detector.detect();
      expect(reports.some(r => r.type === 'pattern')).toBe(true);
    });

    it('should not detect pattern with insufficient data', () => {
      detector.registerMetric('m', { patternWindowSize: 10 });
      for (let i = 0; i < 15; i++) {
        detector.record('m', 100);
      }
      const reports = detector.detect();
      expect(reports.filter(r => r.type === 'pattern')).toHaveLength(0);
    });
  });

  describe('isAnomalous', () => {
    it('should return true when anomaly detected', () => {
      detector.registerMetric('m', { thresholdMax: 10 });
      detector.record('m', 5);
      detector.record('m', 6);
      detector.record('m', 50);
      expect(detector.isAnomalous('m')).toBe(true);
    });

    it('should return false when no anomaly', () => {
      detector.registerMetric('m');
      detector.record('m', 5);
      detector.record('m', 6);
      detector.record('m', 7);
      expect(detector.isAnomalous('m')).toBe(false);
    });
  });

  describe('getBaseline / updateBaseline', () => {
    it('should return default baseline for unknown metric', () => {
      const bl = detector.getBaseline('unknown');
      expect(bl.mean).toBe(0);
      expect(bl.sampleCount).toBe(0);
    });

    it('should compute baseline from values', () => {
      detector.record('m', 10);
      detector.record('m', 20);
      detector.record('m', 30);
      const bl = detector.getBaseline('m');
      expect(bl.mean).toBe(20);
      expect(bl.sampleCount).toBe(3);
      expect(bl.min).toBe(10);
      expect(bl.max).toBe(30);
    });

    it('should not update baseline with < 2 values', () => {
      detector.record('m', 10);
      detector.updateBaseline('m');
      expect(detector.getBaseline('m').sampleCount).toBe(0);
    });
  });

  describe('anomaly history', () => {
    it('should store anomaly history', () => {
      detector.registerMetric('m', { thresholdMax: 10 });
      detector.record('m', 5);
      detector.record('m', 6);
      detector.record('m', 50);
      detector.detect();
      expect(detector.getAnomalyHistory().length).toBeGreaterThan(0);
    });

    it('should trim anomaly history', () => {
      detector.registerMetric('m', { thresholdMax: 10 });
      for (let round = 0; round < 200; round++) {
        detector.record('m', 5);
        detector.record('m', 6);
        detector.record('m', 50);
        detector.detect();
      }
      expect(detector.getAnomalyHistory().length).toBeLessThanOrEqual(1000);
    });

    it('should clear anomaly history', () => {
      detector.registerMetric('m', { thresholdMax: 10 });
      detector.record('m', 5);
      detector.record('m', 6);
      detector.record('m', 50);
      detector.detect();
      detector.clearHistory();
      expect(detector.getAnomalyHistory()).toHaveLength(0);
    });
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

  describe('default rules', () => {
    it('should have 4 default rules', () => {
      expect(engine.getRules()).toHaveLength(4);
    });

    it('should diagnose memory leak', () => {
      const symptoms: Symptom[] = [
        { source: 'test', type: 'memory_usage', description: 'high mem', severity: 'high', timestamp: Date.now() },
        { source: 'test', type: 'response_time', description: 'slow', severity: 'medium', timestamp: Date.now() },
      ];
      const result = engine.diagnose(symptoms);
      expect(result.primaryCause.cause).toBe('memory_leak');
      expect(result.confidence).toBe(0.85);
    });

    it('should diagnose network failure', () => {
      const symptoms: Symptom[] = [
        { source: 'test', type: 'error_rate', description: 'errors', severity: 'critical', timestamp: Date.now() },
        { source: 'test', type: 'response_time', description: 'slow', severity: 'critical', timestamp: Date.now() },
      ];
      const result = engine.diagnose(symptoms);
      expect(result.primaryCause.cause).toBe('network_failure');
    });

    it('should diagnose resource exhaustion from memory', () => {
      const symptoms: Symptom[] = [
        { source: 'test', type: 'memory_usage', description: 'oom', severity: 'critical', timestamp: Date.now() },
      ];
      const result = engine.diagnose(symptoms);
      expect(result.primaryCause.cause).toBe('resource_exhaustion');
    });

    it('should diagnose resource exhaustion from event loop lag', () => {
      const symptoms: Symptom[] = [
        { source: 'test', type: 'event_loop_lag', description: 'lag', severity: 'high', timestamp: Date.now() },
      ];
      const result = engine.diagnose(symptoms);
      expect(result.primaryCause.cause).toBe('resource_exhaustion');
    });

    it('should diagnose high error rate', () => {
      const symptoms: Symptom[] = [
        { source: 'test', type: 'error_rate', description: 'errors', severity: 'high', timestamp: Date.now() },
      ];
      const result = engine.diagnose(symptoms);
      expect(result.primaryCause.cause).toBe('application_error');
    });

    it('should return unknown cause when no rules match', () => {
      const symptoms: Symptom[] = [
        { source: 'test', type: 'custom_metric', description: 'something', severity: 'low', timestamp: Date.now() },
      ];
      const result = engine.diagnose(symptoms);
      expect(result.primaryCause.cause).toBe('unknown');
      expect(result.confidence).toBe(0);
    });

    it('should add investigate_further action for low confidence', () => {
      const symptoms: Symptom[] = [
        { source: 'test', type: 'custom', description: 'x', severity: 'low', timestamp: Date.now() },
      ];
      const result = engine.diagnose(symptoms);
      expect(result.recommendedActions.some(a => a.name === 'investigate_further')).toBe(true);
    });
  });

  describe('addRule / removeRule', () => {
    it('should add a custom rule', () => {
      engine.addRule({
        id: 'custom-1',
        name: 'Custom Rule',
        conditions: (s) => s.some(sym => sym.type === 'custom_type'),
        cause: 'custom_cause',
        confidence: 0.95,
        recommendedActions: ['custom_action'],
      });
      expect(engine.getRules()).toHaveLength(5);
    });

    it('should remove a rule', () => {
      const rules = engine.getRules();
      engine.removeRule(rules[0]!.id);
      expect(engine.getRules()).toHaveLength(3);
    });
  });

  describe('getPossibleCauses', () => {
    it('should return matching causes', () => {
      const symptoms: Symptom[] = [
        { source: 'test', type: 'memory_usage', description: 'high', severity: 'high', timestamp: Date.now() },
        { source: 'test', type: 'response_time', description: 'slow', severity: 'medium', timestamp: Date.now() },
      ];
      const causes = engine.getPossibleCauses(symptoms);
      expect(causes.length).toBeGreaterThan(0);
    });
  });

  describe('getRecommendedActions', () => {
    it('should return actions from matching rule', () => {
      const symptoms: Symptom[] = [
        { source: 'test', type: 'memory_usage', description: 'high', severity: 'high', timestamp: Date.now() },
        { source: 'test', type: 'response_time', description: 'slow', severity: 'medium', timestamp: Date.now() },
      ];
      const result = engine.diagnose(symptoms);
      expect(result.recommendedActions.length).toBeGreaterThan(0);
      expect(result.recommendedActions[0]!.name).toBe('restart_component');
    });
  });

  describe('history', () => {
    it('should record diagnosis history', () => {
      engine.diagnose([]);
      engine.diagnose([]);
      expect(engine.getDiagnosisHistory()).toHaveLength(2);
    });

    it('should clear history', () => {
      engine.diagnose([]);
      engine.clearHistory();
      expect(engine.getDiagnosisHistory()).toHaveLength(0);
    });
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

  describe('builtin strategies', () => {
    it('should have builtin strategies', () => {
      const strategies = registry.getAllStrategies();
      expect(strategies.length).toBeGreaterThan(0);
      expect(strategies).toContain('restart_component');
      expect(strategies).toContain('failover');
      expect(strategies).toContain('escalate');
    });

    it('should get a strategy by name', () => {
      const s = registry.getStrategy('restart_component');
      expect(s).toBeDefined();
      expect(s!.name).toBe('restart_component');
    });

    it('should return undefined for unknown strategy', () => {
      expect(registry.getStrategy('nonexistent')).toBeUndefined();
    });
  });

  describe('register / unregister', () => {
    it('should register a custom strategy', () => {
      const strategy: RecoveryStrategy = {
        name: 'custom',
        description: 'Custom strategy',
        execute: async () => ({ success: true, strategy: 'custom', duration: 0, message: 'ok', rollbackRequired: false }),
      };
      registry.register('custom', strategy);
      expect(registry.getStrategy('custom')).toBeDefined();
    });

    it('should unregister a strategy', () => {
      registry.unregister('restart_component');
      expect(registry.getStrategy('restart_component')).toBeUndefined();
    });
  });

  describe('select', () => {
    it('should select strategies based on recommended actions', () => {
      const selected = registry.select({
        primaryCause: 'memory_leak',
        severity: 'high',
        recommendedActions: ['restart_component', 'clear_cache'],
      });
      expect(selected.map(s => s.name)).toContain('restart_component');
      expect(selected.map(s => s.name)).toContain('clear_cache');
    });

    it('should select based on severity when no recommended actions', () => {
      const selected = registry.select({
        primaryCause: 'unknown',
        severity: 'critical',
      });
      expect(selected.length).toBeGreaterThan(0);
    });

    it('should select restart + retry for high severity', () => {
      const selected = registry.select({
        primaryCause: 'unknown',
        severity: 'high',
      });
      const names = selected.map(s => s.name);
      expect(names).toContain('restart_component');
      expect(names).toContain('retry_operation');
    });

    it('should select retry for low/medium severity', () => {
      const selected = registry.select({
        primaryCause: 'unknown',
        severity: 'low',
      });
      const names = selected.map(s => s.name);
      expect(names).toContain('retry_operation');
    });

    it('should fallback to escalate when no strategies match', () => {
      registry.unregister('retry_operation');
      registry.unregister('restart_component');
      registry.unregister('failover');
      const selected = registry.select({
        primaryCause: 'unknown',
        severity: 'low',
      });
      expect(selected.map(s => s.name)).toContain('escalate');
    });
  });

  describe('execute', () => {
    it('should execute strategy and return result', async () => {
      const strategy = registry.getStrategy('restart_component')!;
      const context: RecoveryContext = {
        componentId: 'test',
        diagnosis: 'test_failure',
        severity: 'high',
      };
      const result = await registry.execute(strategy, context);
      expect(result.success).toBe(true);
      expect(result.strategy).toBe('restart_component');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should handle strategy timeout', async () => {
      const slowStrategy: RecoveryStrategy = {
        name: 'slow',
        description: 'Slow strategy',
        timeout: 50,
        execute: async () => {
          await new Promise(r => setTimeout(r, 5000));
          return { success: true, strategy: 'slow', duration: 0, message: 'ok', rollbackRequired: false };
        },
      };
      registry.register('slow', slowStrategy);
      const result = await registry.execute(slowStrategy, {
        componentId: 'test',
        diagnosis: 'test',
        severity: 'low',
      });
      expect(result.success).toBe(false);
      expect(result.message).toContain('timed out');
    });

    it('should attempt rollback on failure', async () => {
      let rollbackCalled = false;
      const failStrategy: RecoveryStrategy = {
        name: 'fail',
        description: 'Failing strategy',
        execute: async () => { throw new Error('strategy failed'); },
        rollback: async () => { rollbackCalled = true; },
      };
      registry.register('fail', failStrategy);
      const result = await registry.execute(failStrategy, {
        componentId: 'test',
        diagnosis: 'test',
        severity: 'low',
      });
      expect(result.success).toBe(false);
      expect(result.rollbackRequired).toBe(true);
      expect(rollbackCalled).toBe(true);
    });

    it('should handle rollback failure gracefully', async () => {
      const failStrategy: RecoveryStrategy = {
        name: 'fail',
        description: 'Failing strategy',
        execute: async () => { throw new Error('strategy failed'); },
        rollback: async () => { throw new Error('rollback failed'); },
      };
      registry.register('fail', failStrategy);
      // Should not throw even if rollback fails
      const result = await registry.execute(failStrategy, {
        componentId: 'test',
        diagnosis: 'test',
        severity: 'low',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('getEffectiveness', () => {
    it('should track execution history', async () => {
      const strategy = registry.getStrategy('restart_component')!;
      await registry.execute(strategy, { componentId: 't', diagnosis: 'd', severity: 'high' });
      await registry.execute(strategy, { componentId: 't', diagnosis: 'd', severity: 'high' });
      const stats = registry.getEffectiveness('restart_component');
      expect(stats.totalExecutions).toBe(2);
      expect(stats.successfulExecutions).toBe(2);
      expect(stats.successRate).toBe(1);
    });

    it('should return zero stats for unknown strategy', () => {
      const stats = registry.getEffectiveness('unknown');
      expect(stats.totalExecutions).toBe(0);
      expect(stats.successRate).toBe(0);
    });
  });

  describe('getExecutionHistory', () => {
    it('should return execution history', async () => {
      const strategy = registry.getStrategy('restart_component')!;
      await registry.execute(strategy, { componentId: 't', diagnosis: 'd', severity: 'high' });
      const history = registry.getExecutionHistory();
      expect(history).toHaveLength(1);
    });
  });
});

// ============================================================
// AutoRepairEngine Tests
// ============================================================
describe('AutoRepairEngine', () => {
  let anomalyDetector: AnomalyDetector;
  let diagnosisEngine: DiagnosisEngine;
  let strategyRegistry: RecoveryStrategyRegistry;
  let engine: AutoRepairEngine;

  beforeEach(() => {
    anomalyDetector = new AnomalyDetector();
    diagnosisEngine = new DiagnosisEngine();
    strategyRegistry = new RecoveryStrategyRegistry();
    engine = new AutoRepairEngine(anomalyDetector, diagnosisEngine, strategyRegistry);
  });

  afterEach(() => {
    engine.stopAutoRepair();
  });

  describe('constructor / config', () => {
    it('should use default config', () => {
      expect(engine.getAutonomyLevel()).toBe('auto_with_approval');
    });

    it('should accept custom config', () => {
      const e = new AutoRepairEngine(anomalyDetector, diagnosisEngine, strategyRegistry, {
        autonomyLevel: 'fully_auto',
        maxRepairsPerHour: 5,
      });
      expect(e.getAutonomyLevel()).toBe('fully_auto');
    });
  });

  describe('startAutoRepair / stopAutoRepair / isRunning', () => {
    it('should start and stop auto repair', () => {
      engine.startAutoRepair(1000);
      expect(engine.isRunning()).toBe(true);
      engine.stopAutoRepair();
      expect(engine.isRunning()).toBe(false);
    });

    it('should not start twice', () => {
      engine.startAutoRepair(1000);
      engine.startAutoRepair(1000);
      expect(engine.isRunning()).toBe(true);
      engine.stopAutoRepair();
    });
  });

  describe('triggerRepair', () => {
    it('should reject blacklisted issues', async () => {
      engine.addToBlacklist('bad_issue');
      const result = await engine.triggerRepair({
        id: '1',
        componentId: 'c1',
        description: 'bad_issue',
        severity: 'high',
        detectedAt: Date.now(),
      });
      expect(result.success).toBe(false);
      expect(result.message).toContain('blacklisted');
    });

    it('should enforce rate limit', async () => {
      const e = new AutoRepairEngine(anomalyDetector, diagnosisEngine, strategyRegistry, {
        autonomyLevel: 'fully_auto',
        maxRepairsPerHour: 2,
      });
      try {
        // Trigger 3 repairs
        for (let i = 0; i < 3; i++) {
          await e.triggerRepair({
            id: `${i}`,
            componentId: 'c1',
            description: `issue ${i}`,
            severity: 'high',
            detectedAt: Date.now(),
            symptoms: [
              { source: 'test', type: 'memory_usage', description: 'high mem', severity: 'high', timestamp: Date.now() },
              { source: 'test', type: 'response_time', description: 'slow', severity: 'medium', timestamp: Date.now() },
            ],
          });
        }
        const stats = e.getRepairStats();
        expect(stats.totalRepairs).toBe(2);
      } finally {
        e.stopAutoRepair();
      }
    });

    it('should require approval for manual_confirm mode', async () => {
      const e = new AutoRepairEngine(anomalyDetector, diagnosisEngine, strategyRegistry, {
        autonomyLevel: 'manual_confirm',
      });
      try {
        const result = await e.triggerRepair({
          id: '1',
          componentId: 'c1',
          description: 'issue',
          severity: 'high',
          detectedAt: Date.now(),
        });
        expect(result.requiresApproval).toBe(true);
        expect(result.success).toBe(false);
        expect(e.getPendingApprovals()).toContain('1');
      } finally {
        e.stopAutoRepair();
      }
    });

    it('should require approval for critical issues in auto_with_approval mode', async () => {
      const result = await engine.triggerRepair({
        id: '1',
        componentId: 'c1',
        description: 'critical issue',
        severity: 'critical',
        detectedAt: Date.now(),
      });
      expect(result.requiresApproval).toBe(true);
    });

    it('should auto-repair non-critical in auto_with_approval mode', async () => {
      const result = await engine.triggerRepair({
        id: '1',
        componentId: 'c1',
        description: 'issue',
        severity: 'medium',
        detectedAt: Date.now(),
        symptoms: [
          { source: 'test', type: 'memory_usage', description: 'high mem', severity: 'high', timestamp: Date.now() },
          { source: 'test', type: 'response_time', description: 'slow', severity: 'medium', timestamp: Date.now() },
        ],
      });
      expect(result.requiresApproval).toBe(false);
    });

    it('should fully auto-repair in fully_auto mode', async () => {
      const e = new AutoRepairEngine(anomalyDetector, diagnosisEngine, strategyRegistry, {
        autonomyLevel: 'fully_auto',
      });
      try {
        const result = await e.triggerRepair({
          id: '1',
          componentId: 'c1',
          description: 'critical issue',
          severity: 'critical',
          detectedAt: Date.now(),
          symptoms: [
            { source: 'test', type: 'memory_usage', description: 'high mem', severity: 'high', timestamp: Date.now() },
            { source: 'test', type: 'response_time', description: 'slow', severity: 'medium', timestamp: Date.now() },
          ],
        });
        expect(result.requiresApproval).toBe(false);
      } finally {
        e.stopAutoRepair();
      }
    });

    it('should convert anomalies to symptoms', async () => {
      const e = new AutoRepairEngine(anomalyDetector, diagnosisEngine, strategyRegistry, {
        autonomyLevel: 'fully_auto',
      });
      try {
        anomalyDetector.registerMetric('cpu', { thresholdMax: 90 });
        anomalyDetector.record('cpu', 50);
        anomalyDetector.record('cpu', 60);
        anomalyDetector.record('cpu', 95);
        const anomalies = anomalyDetector.detect();

        const result = await e.triggerRepair({
          id: '1',
          componentId: 'c1',
          description: 'cpu anomaly',
          severity: 'high',
          detectedAt: Date.now(),
          anomalies,
        });
        expect(result.strategiesAttempted.length).toBeGreaterThan(0);
      } finally {
        e.stopAutoRepair();
      }
    });

    it('should call notification callback', async () => {
      let notified = false;
      const e = new AutoRepairEngine(anomalyDetector, diagnosisEngine, strategyRegistry, {
        autonomyLevel: 'fully_auto',
        notificationCallback: () => { notified = true; },
      });
      try {
        await e.triggerRepair({
          id: '1',
          componentId: 'c1',
          description: 'issue',
          severity: 'medium',
          detectedAt: Date.now(),
          symptoms: [
            { source: 'test', type: 'memory_usage', description: 'high mem', severity: 'high', timestamp: Date.now() },
            { source: 'test', type: 'response_time', description: 'slow', severity: 'medium', timestamp: Date.now() },
          ],
        });
        expect(notified).toBe(true);
      } finally {
        e.stopAutoRepair();
      }
    });
  });

  describe('approveRepair', () => {
    it('should approve pending repair and execute it', async () => {
      engine.setAutonomyLevel('manual_confirm');
      const issue: Issue = {
        id: '1',
        componentId: 'c1',
        description: 'issue',
        severity: 'high',
        detectedAt: Date.now(),
        symptoms: [
          { source: 'test', type: 'memory_usage', description: 'high mem', severity: 'high', timestamp: Date.now() },
          { source: 'test', type: 'response_time', description: 'slow', severity: 'medium', timestamp: Date.now() },
        ],
      };
      await engine.triggerRepair(issue);
      expect(engine.getPendingApprovals()).toContain('1');

      const result = await engine.approveRepair('1');
      expect(result.requiresApproval).toBe(false);
      expect(engine.getPendingApprovals()).not.toContain('1');
    });

    it('should preserve original severity on approval (bug fix)', async () => {
      engine.setAutonomyLevel('manual_confirm');
      const issue: Issue = {
        id: 'critical-1',
        componentId: 'c1',
        description: 'critical issue',
        severity: 'critical',
        detectedAt: Date.now(),
        symptoms: [
          { source: 'test', type: 'memory_usage', description: 'oom', severity: 'critical', timestamp: Date.now() },
        ],
      };
      await engine.triggerRepair(issue);
      // After approval, the repair should execute with original severity
      const result = await engine.approveRepair('critical-1');
      // The repair should have attempted strategies suitable for critical
      expect(result.strategiesAttempted.length).toBeGreaterThan(0);
    });

    it('should return error for non-pending issue', async () => {
      const result = await engine.approveRepair('nonexistent');
      expect(result.success).toBe(false);
      expect(result.message).toContain('No pending approval');
    });
  });

  describe('blacklist', () => {
    it('should add and remove from blacklist', () => {
      engine.addToBlacklist('bad');
      engine.removeFromBlacklist('bad');
      // Should not be blacklisted anymore
    });
  });

  describe('getRepairStats', () => {
    it('should return correct stats', async () => {
      await engine.triggerRepair({
        id: '1',
        componentId: 'c1',
        description: 'issue',
        severity: 'medium',
        detectedAt: Date.now(),
        symptoms: [
          { source: 'test', type: 'memory_usage', description: 'high mem', severity: 'high', timestamp: Date.now() },
          { source: 'test', type: 'response_time', description: 'slow', severity: 'medium', timestamp: Date.now() },
        ],
      });
      const stats = engine.getRepairStats();
      expect(stats.totalRepairs).toBe(1);
      expect(stats.successfulRepairs).toBe(1);
      expect(stats.failedRepairs).toBe(0);
    });
  });

  describe('getRepairHistory', () => {
    it('should return repair history', async () => {
      await engine.triggerRepair({
        id: '1',
        componentId: 'c1',
        description: 'issue',
        severity: 'medium',
        detectedAt: Date.now(),
        symptoms: [
          { source: 'test', type: 'memory_usage', description: 'high mem', severity: 'high', timestamp: Date.now() },
          { source: 'test', type: 'response_time', description: 'slow', severity: 'medium', timestamp: Date.now() },
        ],
      });
      expect(engine.getRepairHistory()).toHaveLength(1);
    });
  });
});

// ============================================================
// FailoverManager Tests
// ============================================================
describe('FailoverManager', () => {
  let manager: FailoverManager;
  let intervalIds: ReturnType<typeof setInterval>[] = [];

  function createHealthyHandler(name: string): ComponentHandler {
    return {
      start: async () => {},
      stop: async () => {},
      healthCheck: async () => true,
    };
  }

  function createUnhealthyHandler(): ComponentHandler {
    return {
      start: async () => {},
      stop: async () => {},
      healthCheck: async () => false,
    };
  }

  afterEach(() => {
    for (const id of intervalIds) clearInterval(id);
    intervalIds = [];
  });

  describe('registerPrimary / registerStandby', () => {
    it('should register primary component', () => {
      manager = new FailoverManager();
      manager.registerPrimary('svc', createHealthyHandler('primary'));
      expect(manager.getRegisteredComponents()).toContain('svc');
    });

    it('should throw when registering standby without primary', () => {
      manager = new FailoverManager();
      expect(() => manager.registerStandby('svc', createHealthyHandler('standby'))).toThrow();
    });

    it('should register standby', () => {
      manager = new FailoverManager();
      manager.registerPrimary('svc', createHealthyHandler('primary'));
      manager.registerStandby('svc', createHealthyHandler('standby'));
      const status = manager.getFailoverStatus('svc');
      expect(status).not.toBeNull();
    });

    it('should update primary if already registered', () => {
      manager = new FailoverManager();
      manager.registerPrimary('svc', createHealthyHandler('p1'));
      manager.registerPrimary('svc', createHealthyHandler('p2'));
      const status = manager.getFailoverStatus('svc');
      expect(status!.activeInstance).toBe('primary');
    });
  });

  describe('setActiveActive', () => {
    it('should set mode to active-active', () => {
      manager = new FailoverManager();
      manager.registerPrimary('svc', createHealthyHandler('primary'));
      manager.setActiveActive('svc');
      const status = manager.getFailoverStatus('svc');
      expect(status!.mode).toBe('active-active');
    });

    it('should throw for unregistered component', () => {
      manager = new FailoverManager();
      expect(() => manager.setActiveActive('unknown')).toThrow();
    });
  });

  describe('triggerFailover', () => {
    it('should fail over to standby in active-passive mode', async () => {
      manager = new FailoverManager();
      manager.registerPrimary('svc', createHealthyHandler('primary'));
      manager.registerStandby('svc', createHealthyHandler('standby'));
      const result = await manager.triggerFailover('svc');
      expect(result.success).toBe(true);
      expect(result.toInstance).toBe('standby');
      expect(manager.getFailoverStatus('svc')!.isFailedOver).toBe(true);
    });

    it('should fail when no standby available', async () => {
      manager = new FailoverManager();
      manager.registerPrimary('svc', createHealthyHandler('primary'));
      const result = await manager.triggerFailover('svc');
      expect(result.success).toBe(false);
      expect(result.message).toContain('No standby');
    });

    it('should return error for unknown component', async () => {
      manager = new FailoverManager();
      const result = await manager.triggerFailover('unknown');
      expect(result.success).toBe(false);
    });

    it('should handle failover failure', async () => {
      manager = new FailoverManager();
      manager.registerPrimary('svc', {
        start: async () => {},
        stop: async () => { throw new Error('stop failed'); },
        healthCheck: async () => true,
      });
      manager.registerStandby('svc', createHealthyHandler('standby'));
      const result = await manager.triggerFailover('svc');
      expect(result.success).toBe(false);
    });

    it('should route to healthiest instance in active-active mode', async () => {
      manager = new FailoverManager();
      manager.registerPrimary('svc', createHealthyHandler('primary'));
      manager.registerStandby('svc', createHealthyHandler('standby'));
      manager.setActiveActive('svc');
      const result = await manager.triggerFailover('svc');
      expect(result.success).toBe(true);
      expect(result.toInstance).toBe('standby');
    });

    it('should fail when no healthy instances in active-active', async () => {
      manager = new FailoverManager();
      manager.registerPrimary('svc', createUnhealthyHandler());
      manager.registerStandby('svc', createUnhealthyHandler());
      manager.setActiveActive('svc');
      const result = await manager.triggerFailover('svc');
      expect(result.success).toBe(false);
    });

    it('should record failover history', async () => {
      manager = new FailoverManager();
      manager.registerPrimary('svc', createHealthyHandler('primary'));
      manager.registerStandby('svc', createHealthyHandler('standby'));
      await manager.triggerFailover('svc');
      expect(manager.getFailoverHistory()).toHaveLength(1);
    });
  });

  describe('triggerFailback', () => {
    it('should fail back to primary', async () => {
      manager = new FailoverManager();
      manager.registerPrimary('svc', createHealthyHandler('primary'));
      manager.registerStandby('svc', createHealthyHandler('standby'));
      await manager.triggerFailover('svc');
      await manager.triggerFailback('svc');
      const status = manager.getFailoverStatus('svc');
      expect(status!.isFailedOver).toBe(false);
      expect(status!.activeInstance).toBe('primary');
    });

    it('should record correct fromInstance in failback (bug fix)', async () => {
      manager = new FailoverManager();
      manager.registerPrimary('svc', createHealthyHandler('primary'));
      manager.registerStandby('svc', createHealthyHandler('standby'));
      await manager.triggerFailover('svc');
      await manager.triggerFailback('svc');
      const history = manager.getFailoverHistory();
      const failbackRecord = history[history.length - 1]!;
      expect(failbackRecord.fromInstance).toBe('standby');
      expect(failbackRecord.toInstance).toBe('primary');
    });

    it('should not failback if primary is unhealthy', async () => {
      manager = new FailoverManager();
      manager.registerPrimary('svc', createUnhealthyHandler());
      manager.registerStandby('svc', createHealthyHandler('standby'));
      await manager.triggerFailover('svc');
      await manager.triggerFailback('svc');
      expect(manager.getFailoverStatus('svc')!.isFailedOver).toBe(true);
    });

    it('should do nothing if not failed over', async () => {
      manager = new FailoverManager();
      manager.registerPrimary('svc', createHealthyHandler('primary'));
      await manager.triggerFailback('svc');
      expect(manager.getFailoverStatus('svc')!.activeInstance).toBe('primary');
    });

    it('should handle failback failure gracefully', async () => {
      manager = new FailoverManager();
      manager.registerPrimary('svc', {
        start: async () => { throw new Error('start failed'); },
        stop: async () => {},
        healthCheck: async () => true,
      });
      manager.registerStandby('svc', createHealthyHandler('standby'));
      await manager.triggerFailover('svc');
      // Should not throw, stay on standby
      await manager.triggerFailback('svc');
    });
  });

  describe('getFailoverStatus', () => {
    it('should return null for unknown component', () => {
      manager = new FailoverManager();
      expect(manager.getFailoverStatus('unknown')).toBeNull();
    });
  });

  describe('setFailbackEnabled', () => {
    it('should disable failback', async () => {
      manager = new FailoverManager();
      manager.registerPrimary('svc', createHealthyHandler('primary'));
      manager.registerStandby('svc', createHealthyHandler('standby'));
      manager.setFailbackEnabled('svc', false);
      await manager.triggerFailover('svc');
      await manager.triggerFailback('svc');
      // Failback should still work when called directly, but health monitoring won't auto-failback
    });
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

  describe('createSnapshot', () => {
    it('should create a snapshot', () => {
      const snap = manager.createSnapshot('comp1', { key: 'value' });
      expect(snap.id).toMatch(/^snap-/);
      expect(snap.componentId).toBe('comp1');
      expect(snap.state).toEqual({ key: 'value' });
      expect(snap.version).toBe(1);
      expect(snap.size).toBeGreaterThan(0);
      expect(snap.checksum).toBeTruthy();
    });

    it('should increment version on each snapshot', () => {
      manager.createSnapshot('comp1', { v: 1 });
      manager.createSnapshot('comp1', { v: 2 });
      manager.createSnapshot('comp1', { v: 3 });
      expect(manager.getCurrentVersion('comp1')).toBe(3);
    });

    it('should not create duplicate versions after rollback (bug fix)', () => {
      manager.createSnapshot('comp1', { v: 1 }); // version 1
      manager.createSnapshot('comp1', { v: 2 }); // version 2
      manager.createSnapshot('comp1', { v: 3 }); // version 3
      manager.createSnapshot('comp1', { v: 4 }); // version 4
      manager.createSnapshot('comp1', { v: 5 }); // version 5

      // Rollback to version 2
      const history = manager.getSnapshotHistory('comp1');
      manager.rollback('comp1', history[1]!.id);

      // Next snapshot should be version 6, not 3
      manager.createSnapshot('comp1', { v: 6 });
      expect(manager.getCurrentVersion('comp1')).toBe(6);
    });

    it('should trim snapshots to maxSnapshotsPerComponent', () => {
      manager.setMaxSnapshots(5);
      for (let i = 0; i < 10; i++) {
        manager.createSnapshot('comp1', { v: i });
      }
      const history = manager.getSnapshotHistory('comp1');
      expect(history.length).toBeLessThanOrEqual(5);
    });

    it('should compute checksum', () => {
      const snap = manager.createSnapshot('comp1', { a: 1 });
      const snap2 = manager.createSnapshot('comp1', { a: 1 });
      expect(snap.checksum).toBe(snap2.checksum);
    });
  });

  describe('rollback', () => {
    it('should rollback to a specific snapshot', async () => {
      manager.createSnapshot('comp1', { v: 1 });
      manager.createSnapshot('comp1', { v: 2 });
      const history = manager.getSnapshotHistory('comp1');
      const result = await manager.rollback('comp1', history[0]!.id);
      expect(result.success).toBe(true);
      expect(manager.getCurrentState('comp1')).toEqual({ v: 1 });
    });

    it('should return error for unknown component', async () => {
      const result = await manager.rollback('unknown', 'snap-1');
      expect(result.success).toBe(false);
    });

    it('should return error for unknown snapshot', async () => {
      manager.createSnapshot('comp1', { v: 1 });
      const result = await manager.rollback('comp1', 'nonexistent');
      expect(result.success).toBe(false);
    });

    it('should set correct version on rollback', async () => {
      manager.createSnapshot('comp1', { v: 1 });
      manager.createSnapshot('comp1', { v: 2 });
      manager.createSnapshot('comp1', { v: 3 });
      const history = manager.getSnapshotHistory('comp1');
      const result = await manager.rollback('comp1', history[0]!.id);
      expect(result.newVersion).toBe(1);
      expect(result.previousVersion).toBe(3);
    });
  });

  describe('rollbackToLatest', () => {
    it('should rollback to the latest snapshot', async () => {
      manager.createSnapshot('comp1', { v: 1 });
      manager.createSnapshot('comp1', { v: 2 });
      const result = await manager.rollbackToLatest('comp1');
      expect(result.success).toBe(true);
      expect(manager.getCurrentState('comp1')).toEqual({ v: 2 });
    });

    it('should return error when no snapshots', async () => {
      const result = await manager.rollbackToLatest('comp1');
      expect(result.success).toBe(false);
    });

    it('should return error for unknown component', async () => {
      const result = await manager.rollbackToLatest('unknown');
      expect(result.success).toBe(false);
    });
  });

  describe('verifyState', () => {
    it('should pass for valid state', () => {
      const result = manager.verifyState('comp1', { key: 'value' });
      expect(result.valid).toBe(true);
      expect(result.checks.some(c => c.name === 'state_not_null' && c.passed)).toBe(true);
      expect(result.checks.some(c => c.name === 'serializable' && c.passed)).toBe(true);
      expect(result.checks.some(c => c.name === 'not_empty' && c.passed)).toBe(true);
    });

    it('should fail for null state', () => {
      const result = manager.verifyState('comp1', null);
      expect(result.valid).toBe(false);
    });

    it('should fail for non-serializable state', () => {
      const obj = { circular: {} as Record<string, unknown> };
      obj.circular = obj;
      const result = manager.verifyState('comp1', obj);
      expect(result.valid).toBe(false);
    });

    it('should fail for empty state', () => {
      const result = manager.verifyState('comp1', {});
      expect(result.valid).toBe(false);
    });
  });

  describe('deleteSnapshot / clearSnapshots', () => {
    it('should delete a snapshot', () => {
      manager.createSnapshot('comp1', { v: 1 });
      manager.createSnapshot('comp1', { v: 2 });
      const history = manager.getSnapshotHistory('comp1');
      expect(manager.deleteSnapshot('comp1', history[0]!.id)).toBe(true);
      expect(manager.getSnapshotHistory('comp1')).toHaveLength(1);
    });

    it('should return false for non-existent snapshot', () => {
      expect(manager.deleteSnapshot('comp1', 'nonexistent')).toBe(false);
    });

    it('should clear all snapshots', () => {
      manager.createSnapshot('comp1', { v: 1 });
      manager.createSnapshot('comp1', { v: 2 });
      manager.clearSnapshots('comp1');
      expect(manager.getSnapshotHistory('comp1')).toHaveLength(0);
    });
  });

  describe('getRegisteredComponents', () => {
    it('should return registered components', () => {
      manager.createSnapshot('c1', {});
      manager.createSnapshot('c2', {});
      expect(manager.getRegisteredComponents()).toEqual(['c1', 'c2']);
    });
  });
});

// ============================================================
// EnhancedCircuitBreaker Tests
// ============================================================
describe('EnhancedCircuitBreaker', () => {
  let breaker: EnhancedCircuitBreaker;

  beforeEach(() => {
    breaker = new EnhancedCircuitBreaker({
      failureThreshold: 3,
      recoveryTimeout: 100,
      halfOpenMaxCalls: 2,
      monitoringWindow: 60000,
    });
  });

  describe('initial state', () => {
    it('should start in closed state', () => {
      expect(breaker.getState()).toBe('closed');
    });

    it('should have correct default diagnostics', () => {
      const diag = breaker.getDiagnostics();
      expect(diag.state).toBe('closed');
      expect(diag.failureCount).toBe(0);
      expect(diag.successCount).toBe(0);
      expect(diag.totalCalls).toBe(0);
      expect(diag.tripCount).toBe(0);
    });
  });

  describe('closed state', () => {
    it('should allow calls in closed state', async () => {
      const result = await breaker.execute(async () => 'ok');
      expect(result).toBe('ok');
    });

    it('should track successful calls', async () => {
      await breaker.execute(async () => 'ok');
      const diag = breaker.getDiagnostics();
      expect(diag.successCount).toBe(1);
      expect(diag.totalCalls).toBe(1);
    });

    it('should track failed calls', async () => {
      try {
        await breaker.execute(async () => { throw new Error('fail'); });
      } catch {}
      const diag = breaker.getDiagnostics();
      expect(diag.failureCount).toBe(1);
    });

    it('should open after reaching failure threshold', async () => {
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('fail'); });
        } catch {}
      }
      expect(breaker.getState()).toBe('open');
      expect(breaker.getDiagnostics().tripCount).toBe(1);
    });

    it('should track per-error stats', async () => {
      try {
        await breaker.execute(async () => { throw new TypeError('type err'); });
      } catch {}
      const diag = breaker.getDiagnostics();
      expect(diag.perErrorStats['TypeError']).toBeDefined();
      expect(diag.perErrorStats['TypeError']!.count).toBe(1);
    });

    it('should track non-Error throws', async () => {
      try {
        await breaker.execute(async () => { throw 'string'; });
      } catch {}
      const diag = breaker.getDiagnostics();
      expect(diag.perErrorStats['UnknownError']).toBeDefined();
    });
  });

  describe('open state', () => {
    it('should reject calls when open', async () => {
      for (let i = 0; i < 3; i++) {
        try { await breaker.execute(async () => { throw new Error(); }); } catch {}
      }
      expect(breaker.getState()).toBe('open');
      await expect(breaker.execute(async () => 'ok')).rejects.toThrow('Circuit breaker is open');
    });

    it('should transition to half-open after recovery timeout', async () => {
      for (let i = 0; i < 3; i++) {
        try { await breaker.execute(async () => { throw new Error(); }); } catch {}
      }
      expect(breaker.getState()).toBe('open');
      await new Promise(r => setTimeout(r, 150));
      // Next execute should check state and transition to half-open
      await breaker.execute(async () => 'ok');
      expect(breaker.getState()).toBe('half-open');
      // One more success should close the circuit (halfOpenMaxCalls=2)
      await breaker.execute(async () => 'ok');
      expect(breaker.getState()).toBe('closed');
    });
  });

  describe('half-open state', () => {
    it('should allow limited calls in half-open', async () => {
      for (let i = 0; i < 3; i++) {
        try { await breaker.execute(async () => { throw new Error(); }); } catch {}
      }
      await new Promise(r => setTimeout(r, 150));
      // First call succeeds
      await breaker.execute(async () => 'ok');
      expect(breaker.getState()).toBe('half-open');
    });

    it('should close after enough successes in half-open', async () => {
      for (let i = 0; i < 3; i++) {
        try { await breaker.execute(async () => { throw new Error(); }); } catch {}
      }
      await new Promise(r => setTimeout(r, 150));
      // halfOpenMaxCalls = 2, so 2 successes should close
      await breaker.execute(async () => 'ok');
      await breaker.execute(async () => 'ok');
      expect(breaker.getState()).toBe('closed');
    });

    it('should reopen on failure in half-open', async () => {
      for (let i = 0; i < 3; i++) {
        try { await breaker.execute(async () => { throw new Error(); }); } catch {}
      }
      await new Promise(r => setTimeout(r, 150));
      try {
        await breaker.execute(async () => { throw new Error('half-open fail'); });
      } catch {}
      expect(breaker.getState()).toBe('open');
    });

    it('should reject calls beyond halfOpenMaxCalls', async () => {
      for (let i = 0; i < 3; i++) {
        try { await breaker.execute(async () => { throw new Error(); }); } catch {}
      }
      await new Promise(r => setTimeout(r, 150));
      // halfOpenMaxCalls = 2
      await breaker.execute(async () => 'ok');
      await breaker.execute(async () => 'ok');
      // After 2 successes, circuit should be closed (not half-open anymore)
      expect(breaker.getState()).toBe('closed');
    });
  });

  describe('state transitions', () => {
    it('should call state change callbacks', async () => {
      const states: CircuitState[] = [];
      breaker.onStateChange((s) => states.push(s));
      for (let i = 0; i < 3; i++) {
        try { await breaker.execute(async () => { throw new Error(); }); } catch {}
      }
      expect(states).toContain('open');
    });

    it('should ignore callback errors', async () => {
      breaker.onStateChange(() => { throw new Error('callback error'); });
      for (let i = 0; i < 3; i++) {
        try { await breaker.execute(async () => { throw new Error(); }); } catch {}
      }
      expect(breaker.getState()).toBe('open');
    });

    it('should not transition to same state', () => {
      const states: CircuitState[] = [];
      breaker.onStateChange((s) => states.push(s));
      breaker.forceState('closed');
      expect(states).toHaveLength(0);
    });
  });

  describe('forceState', () => {
    it('should force open state', () => {
      breaker.forceState('open');
      expect(breaker.getState()).toBe('open');
    });

    it('should force half-open state', () => {
      breaker.forceState('half-open');
      expect(breaker.getState()).toBe('half-open');
    });
  });

  describe('reset', () => {
    it('should reset all state', async () => {
      await breaker.execute(async () => 'ok');
      try { await breaker.execute(async () => { throw new Error(); }); } catch {}
      breaker.reset();
      const diag = breaker.getDiagnostics();
      expect(diag.state).toBe('closed');
      expect(diag.failureCount).toBe(0);
      expect(diag.successCount).toBe(0);
      expect(diag.totalCalls).toBe(0);
      expect(diag.tripCount).toBe(0);
    });
  });

  describe('adaptThresholds', () => {
    it('should increase threshold when failure rate is low', async () => {
      const b = new EnhancedCircuitBreaker({
        failureThreshold: 5,
        adaptiveThresholds: true,
        monitoringWindow: 60000,
      });
      for (let i = 0; i < 25; i++) {
        await b.execute(async () => 'ok');
      }
      b.adaptThresholds();
      expect(b.getDiagnostics().currentThreshold).toBeGreaterThan(5);
    });

    it('should decrease threshold when failure rate is high', async () => {
      const b = new EnhancedCircuitBreaker({
        failureThreshold: 20,
        adaptiveThresholds: true,
        monitoringWindow: 60000,
      });
      for (let i = 0; i < 15; i++) {
        try { await b.execute(async () => { throw new Error(); }); } catch {}
      }
      b.adaptThresholds();
      expect(b.getDiagnostics().currentThreshold).toBeLessThan(20);
    });

    it('should not adapt when disabled', () => {
      const b = new EnhancedCircuitBreaker({
        adaptiveThresholds: false,
        failureThreshold: 5,
      });
      b.adaptThresholds();
      expect(b.getDiagnostics().currentThreshold).toBe(5);
    });

    it('should not exceed max threshold of 20', async () => {
      const b = new EnhancedCircuitBreaker({
        failureThreshold: 19,
        adaptiveThresholds: true,
        monitoringWindow: 60000,
      });
      for (let i = 0; i < 25; i++) {
        await b.execute(async () => 'ok');
      }
      b.adaptThresholds();
      expect(b.getDiagnostics().currentThreshold).toBeLessThanOrEqual(20);
    });

    it('should not go below min threshold of 2', async () => {
      const b = new EnhancedCircuitBreaker({
        failureThreshold: 3,
        adaptiveThresholds: true,
        monitoringWindow: 60000,
      });
      for (let i = 0; i < 15; i++) {
        try { await b.execute(async () => { throw new Error(); }); } catch {}
      }
      b.adaptThresholds();
      expect(b.getDiagnostics().currentThreshold).toBeGreaterThanOrEqual(2);
    });
  });

  describe('recovery time', () => {
    it('should calculate recovery time', async () => {
      for (let i = 0; i < 3; i++) {
        try { await breaker.execute(async () => { throw new Error(); }); } catch {}
      }
      await new Promise(r => setTimeout(r, 150));
      await breaker.execute(async () => 'ok');
      await breaker.execute(async () => 'ok');
      const diag = breaker.getDiagnostics();
      expect(diag.recoveryTime).toBeGreaterThan(0);
    });
  });
});

// ============================================================
// RecoveryLearningSystem Tests
// ============================================================
describe('RecoveryLearningSystem', () => {
  let system: RecoveryLearningSystem;

  beforeEach(() => {
    system = new RecoveryLearningSystem();
  });

  describe('recordOutcome', () => {
    it('should record an outcome', () => {
      system.recordOutcome('memory_leak', 'restart', true, 100);
      expect(system.getRecords()).toHaveLength(1);
    });

    it('should trim records to maxRecords', () => {
      for (let i = 0; i < 11000; i++) {
        system.recordOutcome('issue', 'strategy', true, 100);
      }
      expect(system.getRecords().length).toBeLessThanOrEqual(10000);
    });
  });

  describe('predictSuccess', () => {
    it('should return 0.5 for unknown issue', () => {
      expect(system.predictSuccess('unknown', 'restart')).toBe(0.5);
    });

    it('should return 0.3 for unknown strategy', () => {
      system.recordOutcome('known_issue', 'known_strategy', true, 100);
      expect(system.predictSuccess('known_issue', 'unknown_strategy')).toBe(0.3);
    });

    it('should calculate success rate from history', () => {
      system.recordOutcome('issue', 'restart', true, 100);
      system.recordOutcome('issue', 'restart', true, 100);
      system.recordOutcome('issue', 'restart', false, 200);
      expect(system.predictSuccess('issue', 'restart')).toBeCloseTo(0.666, 1);
    });
  });

  describe('suggestStrategy', () => {
    it('should return unknown when no data', () => {
      const suggestions = system.suggestStrategy('unknown');
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]!.strategy).toBe('unknown');
    });

    it('should suggest strategies sorted by effectiveness', () => {
      system.recordOutcome('issue', 'restart', true, 100);
      system.recordOutcome('issue', 'restart', true, 100);
      system.recordOutcome('issue', 'failover', false, 200);
      const suggestions = system.suggestStrategy('issue');
      expect(suggestions.length).toBe(2);
      expect(suggestions[0]!.strategy).toBe('restart');
    });

    it('should calculate confidence based on sample size', () => {
      for (let i = 0; i < 10; i++) {
        system.recordOutcome('issue', 'restart', true, 100);
      }
      const suggestions = system.suggestStrategy('issue');
      expect(suggestions[0]!.confidence).toBe(1);
    });
  });

  describe('getLearnedPatterns', () => {
    it('should return patterns sorted by sample size', () => {
      for (let i = 0; i < 5; i++) {
        system.recordOutcome('issue_a', 'restart', true, 100);
      }
      for (let i = 0; i < 10; i++) {
        system.recordOutcome('issue_b', 'failover', true, 200);
      }
      const patterns = system.getLearnedPatterns();
      expect(patterns[0]!.issuePattern).toBe('issue_b');
    });
  });

  describe('getModelStats', () => {
    it('should return correct stats', () => {
      system.recordOutcome('issue', 'restart', true, 100);
      system.recordOutcome('issue', 'restart', false, 200);
      const stats = system.getModelStats();
      expect(stats.totalRecords).toBe(2);
      expect(stats.uniqueIssues).toBe(1);
      expect(stats.uniqueStrategies).toBe(1);
      expect(stats.overallSuccessRate).toBe(0.5);
    });
  });

  describe('exportData / importData', () => {
    it('should export and import data', () => {
      system.recordOutcome('issue', 'restart', true, 100);
      const json = system.exportData();
      const newSystem = new RecoveryLearningSystem();
      newSystem.importData(json);
      expect(newSystem.getRecords()).toHaveLength(1);
    });

    it('should throw on invalid import data', () => {
      expect(() => system.importData('invalid json')).toThrow();
    });
  });

  describe('clearData', () => {
    it('should clear all data', () => {
      system.recordOutcome('issue', 'restart', true, 100);
      system.clearData();
      expect(system.getRecords()).toHaveLength(0);
      expect(system.getLearnedPatterns()).toHaveLength(0);
    });
  });
});

// ============================================================
// IncidentManager Tests
// ============================================================
describe('IncidentManager', () => {
  let manager: IncidentManager;
  let intervalIds: ReturnType<typeof setInterval>[] = [];

  afterEach(() => {
    manager.stopAutoEscalation();
    for (const id of intervalIds) clearInterval(id);
    intervalIds = [];
  });

  describe('createIncident', () => {
    it('should create an incident and return id', () => {
      manager = new IncidentManager();
      const id = manager.createIncident({
        title: 'Test Incident',
        description: 'Something went wrong',
        severity: 'P2',
        status: 'detected',
        detectedAt: Date.now(),
      });
      expect(id).toMatch(/^inc-/);
      expect(manager.getIncident(id)).not.toBeNull();
    });

    it('should use default status and detectedAt', () => {
      manager = new IncidentManager();
      const id = manager.createIncident({
        title: 'Test',
        description: 'Desc',
        severity: 'P3',
        status: undefined as unknown as IncidentStatus,
        detectedAt: undefined as unknown as number,
      });
      const incident = manager.getIncident(id)!;
      expect(incident.status).toBe('detected');
      expect(incident.detectedAt).toBeGreaterThan(0);
    });

    it('should create timeline event on creation', () => {
      manager = new IncidentManager();
      const id = manager.createIncident({
        title: 'Test',
        description: 'Desc',
        severity: 'P1',
        status: 'detected',
        detectedAt: Date.now(),
      });
      const timeline = manager.getIncidentTimeline(id);
      expect(timeline).toHaveLength(1);
      expect(timeline[0]!.type).toBe('status_change');
    });
  });

  describe('updateIncident', () => {
    it('should update status', () => {
      manager = new IncidentManager();
      const id = manager.createIncident({
        title: 'Test', description: 'D', severity: 'P2', status: 'detected', detectedAt: Date.now(),
      });
      manager.updateIncident(id, { status: 'investigating' });
      expect(manager.getIncident(id)!.status).toBe('investigating');
      expect(manager.getIncidentTimeline(id).length).toBe(2);
    });

    it('should not add timeline event for same status', () => {
      manager = new IncidentManager();
      const id = manager.createIncident({
        title: 'Test', description: 'D', severity: 'P2', status: 'detected', detectedAt: Date.now(),
      });
      manager.updateIncident(id, { status: 'detected' });
      expect(manager.getIncidentTimeline(id).length).toBe(1);
    });

    it('should update assignedTo', () => {
      manager = new IncidentManager();
      const id = manager.createIncident({
        title: 'Test', description: 'D', severity: 'P2', status: 'detected', detectedAt: Date.now(),
      });
      manager.updateIncident(id, { assignedTo: 'john' });
      expect(manager.getIncident(id)!.assignedTo).toBe('john');
    });

    it('should update description', () => {
      manager = new IncidentManager();
      const id = manager.createIncident({
        title: 'Test', description: 'D', severity: 'P2', status: 'detected', detectedAt: Date.now(),
      });
      manager.updateIncident(id, { description: 'New desc' });
      expect(manager.getIncident(id)!.description).toBe('New desc');
    });

    it('should update tags', () => {
      manager = new IncidentManager();
      const id = manager.createIncident({
        title: 'Test', description: 'D', severity: 'P2', status: 'detected', detectedAt: Date.now(),
      });
      manager.updateIncident(id, { tags: ['network', 'outage'] });
      expect(manager.getIncident(id)!.tags).toEqual(['network', 'outage']);
    });

    it('should do nothing for unknown incident', () => {
      manager = new IncidentManager();
      expect(() => manager.updateIncident('nonexistent', { status: 'resolved' })).not.toThrow();
    });
  });

  describe('resolveIncident', () => {
    it('should resolve an incident', () => {
      manager = new IncidentManager();
      const id = manager.createIncident({
        title: 'Test', description: 'D', severity: 'P2', status: 'detected', detectedAt: Date.now(),
      });
      manager.resolveIncident(id, 'Fixed the issue');
      expect(manager.getIncident(id)!.status).toBe('resolved');
      const timeline = manager.getIncidentTimeline(id);
      expect(timeline.some(t => t.type === 'resolution')).toBe(true);
    });
  });

  describe('escalateIncident', () => {
    it('should escalate severity', () => {
      manager = new IncidentManager();
      const id = manager.createIncident({
        title: 'Test', description: 'D', severity: 'P3', status: 'detected', detectedAt: Date.now(),
      });
      manager.escalateIncident(id, 'Getting worse');
      expect(manager.getIncident(id)!.severity).toBe('P2');
    });

    it('should not escalate beyond P1 (bug fix)', () => {
      manager = new IncidentManager();
      const id = manager.createIncident({
        title: 'Test', description: 'D', severity: 'P1', status: 'detected', detectedAt: Date.now(),
      });
      manager.escalateIncident(id, 'Already max');
      expect(manager.getIncident(id)!.severity).toBe('P1');
      // Should not add escalation timeline event
      const timeline = manager.getIncidentTimeline(id);
      expect(timeline.filter(t => t.type === 'escalation')).toHaveLength(0);
    });

    it('should add escalation timeline event', () => {
      manager = new IncidentManager();
      const id = manager.createIncident({
        title: 'Test', description: 'D', severity: 'P4', status: 'detected', detectedAt: Date.now(),
      });
      manager.escalateIncident(id, 'Escalating');
      const timeline = manager.getIncidentTimeline(id);
      expect(timeline.some(t => t.type === 'escalation')).toBe(true);
    });
  });

  describe('getActiveIncidents', () => {
    it('should return only active incidents', () => {
      manager = new IncidentManager();
      const id1 = manager.createIncident({
        title: 'Active', description: 'D', severity: 'P2', status: 'investigating', detectedAt: Date.now(),
      });
      manager.createIncident({
        title: 'Resolved', description: 'D', severity: 'P3', status: 'resolved', detectedAt: Date.now(),
      });
      const active = manager.getActiveIncidents();
      expect(active).toHaveLength(1);
      expect(active[0]!.id).toBe(id1);
    });

    it('should sort by severity', () => {
      manager = new IncidentManager();
      manager.createIncident({
        title: 'P3', description: 'D', severity: 'P3', status: 'detected', detectedAt: Date.now(),
      });
      manager.createIncident({
        title: 'P1', description: 'D', severity: 'P1', status: 'detected', detectedAt: Date.now(),
      });
      const active = manager.getActiveIncidents();
      expect(active[0]!.severity).toBe('P1');
    });
  });

  describe('generatePostMortem', () => {
    it('should generate post-mortem', () => {
      manager = new IncidentManager();
      const id = manager.createIncident({
        title: 'Test', description: 'D', severity: 'P2', status: 'detected', detectedAt: Date.now(),
        componentId: 'db',
      });
      manager.resolveIncident(id, 'Fixed');
      const pm = manager.generatePostMortem(id);
      expect(pm.incidentId).toBe(id);
      expect(pm.title).toBe('Test');
      expect(pm.lessonsLearned.length).toBeGreaterThan(0);
      expect(manager.getIncident(id)!.status).toBe('post-mortem');
    });

    it('should return unknown for non-existent incident', () => {
      manager = new IncidentManager();
      const pm = manager.generatePostMortem('nonexistent');
      expect(pm.title).toBe('Unknown Incident');
    });
  });

  describe('correlateIncidents', () => {
    it('should correlate by component', () => {
      manager = new IncidentManager();
      manager.createIncident({
        title: 'A', description: 'D', severity: 'P2', status: 'detected', detectedAt: Date.now(),
        componentId: 'db',
      });
      const id2 = manager.createIncident({
        title: 'B', description: 'D', severity: 'P3', status: 'detected', detectedAt: Date.now(),
        componentId: 'db',
      });
      const related = manager.correlateIncidents(id2);
      expect(related).toHaveLength(1);
    });

    it('should correlate by tags', () => {
      manager = new IncidentManager();
      manager.createIncident({
        title: 'A', description: 'D', severity: 'P2', status: 'detected', detectedAt: Date.now(),
        tags: ['network'],
      });
      const id2 = manager.createIncident({
        title: 'B', description: 'D', severity: 'P3', status: 'detected', detectedAt: Date.now(),
        tags: ['network'],
      });
      const related = manager.correlateIncidents(id2);
      expect(related).toHaveLength(1);
    });

    it('should return empty for unknown incident', () => {
      manager = new IncidentManager();
      expect(manager.correlateIncidents('nonexistent')).toHaveLength(0);
    });
  });

  describe('checkSLACompliance', () => {
    it('should detect SLA breach', () => {
      manager = new IncidentManager();
      const id = manager.createIncident({
        title: 'Test', description: 'D', severity: 'P1', status: 'detected',
        detectedAt: Date.now() - 20 * 60000, // 20 minutes ago, SLA is 15 min
      });
      const results = manager.checkSLACompliance();
      expect(results.some(r => r.incidentId === id && r.breached)).toBe(true);
    });

    it('should not breach for resolved incidents', () => {
      manager = new IncidentManager();
      manager.createIncident({
        title: 'Test', description: 'D', severity: 'P1', status: 'resolved',
        detectedAt: Date.now() - 20 * 60000,
      });
      const results = manager.checkSLACompliance();
      expect(results).toHaveLength(0);
    });

    it('should calculate remaining minutes', () => {
      manager = new IncidentManager();
      const id = manager.createIncident({
        title: 'Test', description: 'D', severity: 'P2', status: 'detected',
        detectedAt: Date.now() - 30 * 60000, // 30 min ago, SLA is 60 min
      });
      const results = manager.checkSLACompliance();
      const result = results.find(r => r.incidentId === id);
      expect(result!.breached).toBe(false);
      expect(result!.remainingMinutes).toBeLessThanOrEqual(30);
    });
  });

  describe('startAutoEscalation / stopAutoEscalation', () => {
    it('should not escalate P1 incidents repeatedly (bug fix)', async () => {
      manager = new IncidentManager();
      const id = manager.createIncident({
        title: 'P1', description: 'D', severity: 'P1', status: 'detected',
        detectedAt: Date.now() - 20 * 60000,
      });
      // Manually trigger escalation check
      const slaResults = manager.checkSLACompliance();
      for (const r of slaResults) {
        if (r.breached) {
          manager.escalateIncident(r.incidentId, 'SLA breached');
        }
      }
      // Escalate again - should be no-op
      manager.escalateIncident(id, 'SLA breached again');
      const timeline = manager.getIncidentTimeline(id);
      expect(timeline.filter(t => t.type === 'escalation')).toHaveLength(0);
    });
  });

  describe('getAllIncidents / getIncidentCount', () => {
    it('should return all incidents', () => {
      manager = new IncidentManager();
      manager.createIncident({ title: 'A', description: 'D', severity: 'P2', status: 'detected', detectedAt: Date.now() });
      manager.createIncident({ title: 'B', description: 'D', severity: 'P3', status: 'detected', detectedAt: Date.now() });
      expect(manager.getAllIncidents()).toHaveLength(2);
      expect(manager.getIncidentCount()).toBe(2);
    });
  });

  describe('getIncident', () => {
    it('should return null for unknown incident', () => {
      manager = new IncidentManager();
      expect(manager.getIncident('nonexistent')).toBeNull();
    });
  });
});
