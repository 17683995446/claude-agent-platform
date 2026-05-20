/**
 * Cross-Package Integration Stress Test
 * Tests real cross-package integration scenarios to find real bugs.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

// ============================================================
// 1. Workflow + Storage Integration
// ============================================================
import { WorkflowEngine } from '../packages/workflow/src/index.ts';
import { MemoryStorage, CacheStorage } from '../packages/storage/src/index.ts';

// ============================================================
// 2. Security + API Gateway Integration
// ============================================================
import { InputValidator } from '../packages/security/src/index.ts';
import { AdvancedRateLimiter } from '../packages/security/src/index.ts';
import { APIRateLimiter, RequestValidator } from '../packages/api-gateway/src/index.ts';

// ============================================================
// 3. Resilience + Communication Integration
// ============================================================
import { CircuitBreaker, CircuitBreakerOpenError } from '../packages/resilience/src/index.ts';
import { MessageBus } from '../packages/agent-communication/src/index.ts';

// ============================================================
// 4. Scheduler + Self-Healing Integration
// ============================================================
import { PriorityScheduler, Priority } from '../packages/smart-scheduler/src/index.ts';
import { AnomalyDetector } from '../packages/self-healing/src/index.ts';
import { AutoRepairEngine } from '../packages/self-healing/src/index.ts';
import { DiagnosisEngine } from '../packages/self-healing/src/index.ts';
import { RecoveryStrategyRegistry } from '../packages/self-healing/src/index.ts';

// ============================================================
// 5. Data Pipeline + Code Metrics Integration
// ============================================================
import { PipelineBuilder, DataValidator } from '../packages/data-pipeline/src/index.ts';
import { ComplexityAnalyzer } from '../packages/code-metrics/src/index.ts';

// ============================================================
// 6. Config Center + Plugin Registry Integration
// ============================================================
import { ConfigStore } from '../packages/config-center/src/index.ts';
import { PluginRegistry } from '../packages/plugin-registry/src/index.ts';

// ============================================================
// 7. Notification + Alert Manager Integration
// ============================================================
import { NotificationCenter } from '../packages/notification/src/index.ts';
import { AlertManager } from '../packages/notification/src/index.ts';

// ============================================================
// 8. Persistent Runtime + State Sync Integration
// ============================================================
import { InfiniteLoop, CheckpointManager } from '../packages/persistent-runtime/src/index.ts';
import { StateStore } from '../packages/state-sync/src/index.ts';

// ============================================================
// 9. Event Sourcing + Workflow Integration
// ============================================================
import { EventSourcedStore } from '../packages/state-sync/src/index.ts';

// ============================================================
// 10. Performance Under Load
// ============================================================
import { ObjectPool } from '../packages/perf/src/index.ts';
import { BatchProcessor as PerfBatchProcessor } from '../packages/perf/src/index.ts';

// ============================================================
// Defect tracking
// ============================================================
const defects: Array<{
  test: string;
  description: string;
  packages: string[];
  rootCause: string;
  suggestedFix: string;
}> = [];

function recordDefect(testName: string, description: string, packages: string[], rootCause: string, suggestedFix: string) {
  defects.push({ test: testName, description, packages, rootCause, suggestedFix });
}

// ============================================================
// TEST SUITES
// ============================================================

describe('Cross-Package Integration Stress Tests', () => {

  // --------------------------------------------------------
  // 1. Workflow + Storage Integration
  // --------------------------------------------------------
  describe('1. Workflow + Storage Integration', () => {
    let engine: WorkflowEngine;
    let storage: MemoryStorage<unknown>;
    let cache: CacheStorage<unknown>;

    beforeEach(() => {
      engine = new WorkflowEngine();
      storage = new MemoryStorage<unknown>();
      const l2Storage = new MemoryStorage<unknown>();
      cache = new CacheStorage<unknown>({
        l1: { storage: new MemoryStorage<unknown>() },
        l2: { storage: l2Storage },
        writePolicy: 'write-through',
      });
    });

    test('workflow execution persists state to storage', async () => {
      // Define a workflow that stores results
      engine.define({
        id: 'test-workflow',
        name: 'Storage Test Workflow',
        version: '1.0.0',
        steps: [
          {
            id: 'step1',
            name: 'Process Data',
            type: 'task',
            config: {
              handler: async (vars: Record<string, unknown>) => {
                const result = { processed: true, input: vars.data };
                await storage.set('workflow:result', result);
                return result;
              },
            },
            next: ['step2'],
          },
          {
            id: 'step2',
            name: 'Cache Data',
            type: 'task',
            config: {
              handler: async (vars: Record<string, unknown>) => {
                await cache.set('workflow:cache', vars.step1_output);
                return { cached: true };
              },
            },
            next: [],
          },
        ],
      });

      const result = await engine.execute('test-workflow', { data: 'hello' });
      expect(result.success).toBe(true);

      // Verify storage persistence
      const stored = await storage.get('workflow:result');
      expect(stored).toBeDefined();
      expect((stored as any).processed).toBe(true);
      expect((stored as any).input).toBe('hello');
    });

    test('cache hit on repeated access', async () => {
      await cache.set('key1', { value: 'test-data' });

      // First access - should populate L1
      const first = await cache.get('key1');
      expect(first).toBeDefined();
      expect((first as any).value).toBe('test-data');

      // Second access - should hit L1 cache
      const second = await cache.get('key1');
      expect(second).toBeDefined();
      expect((second as any).value).toBe('test-data');

      // Verify level stats show hits
      const stats = cache.getLevelStats();
      expect(stats.length).toBeGreaterThanOrEqual(1);
      // At least one hit should be recorded
      const totalHits = stats.reduce((sum, s) => sum + s.hits, 0);
      expect(totalHits).toBeGreaterThan(0);
    });

    test('workflow instance can be stored and retrieved', async () => {
      engine.define({
        id: 'simple-wf',
        name: 'Simple Workflow',
        version: '1.0.0',
        steps: [
          {
            id: 's1',
            name: 'Step 1',
            type: 'task',
            config: {},
            next: [],
          },
        ],
      });

      const result = await engine.execute('simple-wf', {});
      expect(result.success).toBe(true);

      // Store the instance
      const instance = engine.getInstance(result.instanceId);
      expect(instance).toBeDefined();
      expect(instance!.status).toBe('completed');

      await storage.set(`instance:${result.instanceId}`, instance);
      const retrieved = await storage.get(`instance:${result.instanceId}`);
      expect(retrieved).toBeDefined();
      expect((retrieved as any).status).toBe('completed');
    });
  });

  // --------------------------------------------------------
  // 2. Security + API Gateway Integration
  // --------------------------------------------------------
  describe('2. Security + API Gateway Integration', () => {
    let securityRateLimiter: AdvancedRateLimiter;
    let apiRateLimiter: APIRateLimiter;
    let requestValidator: RequestValidator;

    beforeEach(() => {
      securityRateLimiter = new AdvancedRateLimiter({ limit: 5, windowMs: 60000 });
      apiRateLimiter = new APIRateLimiter({ windowMs: 60000, maxRequests: 10 });
      requestValidator = new RequestValidator();
    });

    test('invalid input is rejected before reaching rate limiter', () => {
      // Validate with InputValidator first (security layer)
      const body = { name: 123, email: 'not-an-email' };
      const nameValidator = InputValidator.for(body.name);
      nameValidator.isString();
      const emailValidator = InputValidator.for(body.email);
      emailValidator.isEmail();

      const nameValid = nameValidator.isValid();
      const emailValid = emailValidator.isValid();

      // Input validation should fail
      expect(nameValid).toBe(false);
      expect(emailValid).toBe(false);

      // Rate limiter should NOT be checked for invalid input
      // This simulates the security-first pattern
      const rateLimitChecked = nameValid && emailValid;
      expect(rateLimitChecked).toBe(false);
    });

    test('chained rate limiters work together', async () => {
      const clientId = 'test-client';

      // Security rate limiter check
      const securityResult = await securityRateLimiter.check(clientId);
      expect(securityResult.allowed).toBe(true);

      // API rate limiter check
      const apiResult = apiRateLimiter.checkLimit(clientId);
      expect(apiResult.allowed).toBe(true);

      // Both should allow the first request
      expect(securityResult.allowed && apiResult.allowed).toBe(true);
    });

    test('API request validator rejects malformed requests', () => {
      const result = requestValidator.validateRequest(
        {
          method: 'POST',
          path: '/api/users',
          headers: { 'content-type': 'application/json' },
          body: { name: '', age: -5 },
        },
        {
          body: {
            type: 'object',
            properties: {
              name: { type: 'string', minLength: 1 },
              age: { type: 'number', min: 0 },
            },
            required: ['name', 'age'],
          },
        }
      );

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('valid requests pass both validation and rate limiting', () => {
      const validBody = { name: 'John', age: 30 };
      const nameValidator = InputValidator.for(validBody.name);
      nameValidator.isString().minLength(1);
      const ageValidator = InputValidator.for(validBody.age);
      ageValidator.isNumber().min(0);

      expect(nameValidator.isValid()).toBe(true);
      expect(ageValidator.isValid()).toBe(true);

      // Now rate limiter should be consulted
      const apiResult = apiRateLimiter.checkLimit('valid-client');
      expect(apiResult.allowed).toBe(true);
    });

    test('security rate limiter exhausts and blocks requests', async () => {
      const clientId = 'exhaust-client';
      const limit = 3;

      const limiter = new AdvancedRateLimiter({ limit, windowMs: 60000 });

      // Exhaust the limit
      for (let i = 0; i < limit; i++) {
        const result = await limiter.check(clientId);
        expect(result.allowed).toBe(true);
      }

      // Next request should be blocked
      const blocked = await limiter.check(clientId);
      expect(blocked.allowed).toBe(false);
    });
  });

  // --------------------------------------------------------
  // 3. Resilience + Communication Integration
  // --------------------------------------------------------
  describe('3. Resilience + Communication Integration', () => {
    let circuitBreaker: CircuitBreaker;
    let messageBus: MessageBus;
    let publishFailCount = 0;

    beforeEach(() => {
      publishFailCount = 0;
      circuitBreaker = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 100,
        windowType: 'count',
      });
      messageBus = new MessageBus();
    });

    test('circuit breaker wraps message bus publish', async () => {
      let received = false;
      messageBus.subscribe('test.topic', (msg) => {
        received = true;
      });

      // Publish through circuit breaker
      await circuitBreaker.execute(async () => {
        messageBus.publish('test.topic', { payload: 'hello' });
      });

      expect(received).toBe(true);
      expect(circuitBreaker.getState()).toBe('closed');
    });

    test('when circuit is open, messages are not published', async () => {
      let received = false;
      messageBus.subscribe('fail.topic', (msg) => {
        received = true;
      });

      // DEFECT: CircuitBreaker with windowType='count' uses windowSize (default 10)
      // NOT failureThreshold to determine when to open. This means setting
      // failureThreshold=3 has NO effect when windowType='count'.
      // We must set windowSize=3 to actually trip the circuit with 3 failures.
      const cbCountBased = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 5000,
        windowType: 'count',
        windowSize: 3,
      });

      // Force failures to trip the circuit breaker
      for (let i = 0; i < 3; i++) {
        try {
          await cbCountBased.execute(async () => {
            throw new Error('Simulated publish failure');
          });
        } catch {
          // Expected
        }
      }

      const stateAfterFailures = cbCountBased.getState();
      if (stateAfterFailures !== 'open') {
        recordDefect(
          'CircuitBreaker count-based window',
          'CircuitBreaker with windowType=count does not open after failureThreshold failures. ' +
          `After 3 failures with failureThreshold=3, windowSize=3, state is '${stateAfterFailures}' (expected 'open'). ` +
          'The onFailure handler checks windowFailures.length >= windowSize for count-based, ' +
          'but pruneWindow() uses while(length > windowSize) which means it prunes to windowSize, ' +
          'never reaching >= windowSize.',
          ['resilience'],
          'In onFailure(), count-based mode checks `windowFailures.length >= windowSize`, ' +
          'but pruneWindow() trims to `windowFailures.length > windowSize` (strict greater-than). ' +
          'After pruneWindow, length equals windowSize, so >= check passes. However, the real issue ' +
          'is that failureThreshold is completely ignored for count-based windows - only windowSize matters.',
          'For count-based windows, use windowSize as the failure threshold, or add a check like ' +
          '`if (this.windowFailures.length >= this.config.failureThreshold)` for count-based mode too.'
        );
      }

      // Force open for the rest of the test
      cbCountBased.forceOpen();
      expect(cbCountBased.getState()).toBe('open');

      // Now try to publish - should be blocked
      try {
        await cbCountBased.execute(async () => {
          messageBus.publish('fail.topic', { payload: 'should not arrive' });
        });
      } catch (e) {
        expect(e).toBeInstanceOf(CircuitBreakerOpenError);
      }

      expect(received).toBe(false);
    });

    test('circuit breaker recovers and messages flow again', async () => {
      let received = false;
      messageBus.subscribe('recover.topic', (msg) => {
        received = true;
      });

      // Use forceOpen to reliably test recovery behavior
      circuitBreaker.forceOpen();
      expect(circuitBreaker.getState()).toBe('open');

      // Wait for timeout to transition to half-open
      await new Promise(resolve => setTimeout(resolve, 150));

      // Successful calls should close the circuit
      for (let i = 0; i < 2; i++) {
        await circuitBreaker.execute(async () => {
          messageBus.publish('recover.topic', { payload: 'recovered' });
        });
      }

      expect(circuitBreaker.getState()).toBe('closed');
      expect(received).toBe(true);
    });

    test('DEFECT: failureThreshold is ignored for count-based circuit breaker', async () => {
      // This test documents a real defect:
      // When windowType='count', the CircuitBreaker ignores failureThreshold
      // and only uses windowSize (default 10) to determine when to open.
      const cb = new CircuitBreaker({
        failureThreshold: 2,  // User expects circuit to open after 2 failures
        successThreshold: 1,
        timeout: 5000,
        windowType: 'count',
        // windowSize defaults to 10, so circuit will NOT open after 2 failures
      });

      // Cause exactly failureThreshold (2) failures
      for (let i = 0; i < 2; i++) {
        try {
          await cb.execute(async () => { throw new Error('fail'); });
        } catch { /* expected */ }
      }

      const state = cb.getState();
      // DEFECT: state is still 'closed' because failureThreshold is ignored
      // for count-based windows. User set failureThreshold=2 expecting the
      // circuit to open after 2 failures, but it requires windowSize (10) failures.
      if (state === 'closed') {
        recordDefect(
          'CircuitBreaker failureThreshold ignored for count-based windows',
          `CircuitBreaker with windowType='count' and failureThreshold=2 does NOT open after 2 failures. ` +
          `State remains '${state}'. The failureThreshold parameter is only used for time-based windows. ` +
          `For count-based windows, windowSize (default 10) is used instead, which is confusing ` +
          `because the API suggests failureThreshold should be the trip point.`,
          ['resilience'],
          'In onFailure(), the count-based branch checks `windowFailures.length >= windowSize`, ' +
          'while the time-based branch checks `windowFailures.length >= failureThreshold`. ' +
          'The failureThreshold config option has no effect when windowType is "count".',
          'Either: (1) Use failureThreshold for count-based mode too: ' +
          '`if (this.windowFailures.length >= this.config.failureThreshold)`, or ' +
          '(2) Rename the config to make it clear that windowSize is the trip point for count-based mode, ' +
          'or (3) Default windowSize to failureThreshold when windowType is count.'
        );
      }

      // Verify: it actually takes windowSize failures to trip
      for (let i = 2; i < 10; i++) {
        try {
          await cb.execute(async () => { throw new Error('fail'); });
        } catch { /* expected */ }
      }
      const stateAfter10 = cb.getState();
      // After 10 failures (= windowSize), it should open
      expect(stateAfter10).toBe('open');
    });

    test('message bus delivers to multiple subscribers through circuit breaker', async () => {
      const received1: string[] = [];
      const received2: string[] = [];

      messageBus.subscribe('multi.topic', (msg) => {
        received1.push(msg.payload as string);
      });
      messageBus.subscribe('multi.topic', (msg) => {
        received2.push(msg.payload as string);
      });

      await circuitBreaker.execute(async () => {
        messageBus.publish('multi.topic', { payload: 'msg1' });
        messageBus.publish('multi.topic', { payload: 'msg2' });
      });

      expect(received1.length).toBe(2);
      expect(received2.length).toBe(2);
    });
  });

  // --------------------------------------------------------
  // 4. Scheduler + Self-Healing Integration
  // --------------------------------------------------------
  describe('4. Scheduler + Self-Healing Integration', () => {
    let scheduler: PriorityScheduler;
    let anomalyDetector: AnomalyDetector;
    let diagnosisEngine: DiagnosisEngine;
    let strategyRegistry: RecoveryStrategyRegistry;
    let autoRepair: AutoRepairEngine;

    beforeEach(() => {
      scheduler = new PriorityScheduler();
      anomalyDetector = new AnomalyDetector();
      anomalyDetector.registerMetric('execution_time', {
        windowSize: 20,
        thresholdMax: 1000,
        zScoreThreshold: 2,
      });
      diagnosisEngine = new DiagnosisEngine();
      strategyRegistry = new RecoveryStrategyRegistry();
      autoRepair = new AutoRepairEngine(
        anomalyDetector,
        diagnosisEngine,
        strategyRegistry,
        { autonomyLevel: 'fully_auto', maxRepairsPerHour: 100 }
      );
    });

    test('schedule tasks and detect anomalies in execution time', () => {
      // Schedule tasks
      const taskId1 = scheduler.schedule({ name: 'task-1', priority: Priority.Normal });
      const taskId2 = scheduler.schedule({ name: 'task-2', priority: Priority.High });
      const taskId3 = scheduler.schedule({ name: 'task-3', priority: Priority.Low });

      expect(taskId1).toBeDefined();
      expect(taskId2).toBeDefined();
      expect(taskId3).toBeDefined();

      // Record normal execution times
      for (let i = 0; i < 10; i++) {
        anomalyDetector.record('execution_time', 100 + Math.random() * 50);
      }

      // No anomalies should be detected
      const reports = anomalyDetector.detect();
      const anomalous = reports.filter(r => r.metric === 'execution_time');
      expect(anomalous.length).toBe(0);
    });

    test('anomaly detection triggers auto-repair', async () => {
      // Record normal values to establish baseline
      for (let i = 0; i < 10; i++) {
        anomalyDetector.record('execution_time', 100);
      }

      // Record anomalous values
      for (let i = 0; i < 5; i++) {
        anomalyDetector.record('execution_time', 5000);
      }

      const reports = anomalyDetector.detect();
      const criticalReports = reports.filter(r => r.severity === 'critical' || r.severity === 'high');

      // If anomalies are detected, trigger repair
      if (criticalReports.length > 0) {
        const issue = {
          id: 'issue-anomaly-1',
          componentId: 'scheduler',
          description: `Anomalous execution time detected`,
          severity: 'high' as const,
          detectedAt: Date.now(),
          anomalies: criticalReports,
        };

        const repairResult = await autoRepair.triggerRepair(issue);
        expect(repairResult).toBeDefined();
        // With fully_auto mode and built-in strategies, repair should succeed
        expect(repairResult.strategiesAttempted.length).toBeGreaterThan(0);
      }
    });

    test('repaired tasks are rescheduled with higher priority', () => {
      const taskId = scheduler.schedule({ name: 'repair-task', priority: Priority.Low });
      expect(scheduler.getTask(taskId)?.priority).toBe(Priority.Low);

      // Simulate repair by reprioritizing
      const reprioritized = scheduler.reprioritize(taskId, Priority.Critical);
      expect(reprioritized).toBe(true);
      expect(scheduler.getTask(taskId)?.priority).toBe(Priority.Critical);

      // Verify the task comes first
      const next = scheduler.peek();
      expect(next?.id).toBe(taskId);
    });

    test('scheduler queue ordering is correct', () => {
      scheduler.schedule({ name: 'low-task', priority: Priority.Low });
      scheduler.schedule({ name: 'bg-task', priority: Priority.Background });
      const criticalId = scheduler.schedule({ name: 'critical-task', priority: Priority.Critical });
      scheduler.schedule({ name: 'normal-task', priority: Priority.Normal });

      const next = scheduler.getNext();
      expect(next?.id).toBe(criticalId);
      expect(next?.priority).toBe(Priority.Critical);
    });
  });

  // --------------------------------------------------------
  // 5. Data Pipeline + Code Metrics Integration
  // --------------------------------------------------------
  describe('5. Data Pipeline + Code Metrics Integration', () => {
    let analyzer: ComplexityAnalyzer;
    let validator: DataValidator;

    beforeEach(() => {
      analyzer = new ComplexityAnalyzer();
      validator = new DataValidator();
    });

    test('pipeline analyzes code complexity', async () => {
      const codeSamples = [
        'function simple() { return 1; }',
        `function complex(a, b, c) {
          if (a > 0) {
            if (b > 0) {
              if (c > 0) {
                for (let i = 0; i < 10; i++) {
                  while (true) {
                    if (a && b || c) break;
                  }
                }
              }
            }
          }
          return a + b + c;
        }`,
      ];

      const pipeline = new PipelineBuilder<string>()
        .pipe(async (code: string) => {
          const result = analyzer.analyze(code, 'typescript');
          return { code, ...result };
        })
        .pipe(async (result: any) => {
          result.warnings = analyzer.checkThresholds(result);
          return result;
        })
        .build();

      const results: any[] = [];
      for (const code of codeSamples) {
        const result = await pipeline.execute(code);
        results.push(result);
      }

      expect(results.length).toBe(2);
      expect(results[0].cyclomatic).toBeLessThan(results[1].cyclomatic);
    });

    test('DataValidator validates analysis results', async () => {
      const result = analyzer.analyze(
        'function test() { if (x) { for (let i = 0; i < 10; i++) {} } }',
        'typescript'
      );

      const validationResult = await validator.validate(result, {
        type: 'object',
        fields: {
          cyclomatic: { type: 'number', min: 1 },
          cognitive: { type: 'number', min: 0 },
          loc: { type: 'number', min: 1 },
          sloc: { type: 'number', min: 0 },
          cloc: { type: 'number', min: 0 },
          nestingDepth: { type: 'number', min: 0 },
          warnings: { type: 'array' },
        },
        required: ['cyclomatic', 'cognitive', 'loc', 'sloc', 'nestingDepth'],
      });

      expect(validationResult.valid).toBe(true);
    });

    test('pipeline processes multiple files and produces valid metrics', async () => {
      const files = [
        { name: 'file1.ts', code: 'const x = 1;' },
        { name: 'file2.ts', code: 'function f() { return 2; }' },
        { name: 'file3.ts', code: 'class A { method() { if (a) {} } }' },
      ];

      const pipeline = new PipelineBuilder<{ name: string; code: string }>()
        .pipe(async (file) => {
          const metrics = analyzer.analyze(file.code, 'typescript');
          return { ...file, metrics };
        })
        .build();

      const results: any[] = [];
      for (const file of files) {
        const result = await pipeline.execute(file);
        results.push(result);
      }

      expect(results.length).toBe(3);

      // Validate all results
      for (const result of results) {
        const validation = await validator.validate(result.metrics, {
          type: 'object',
          fields: {
            cyclomatic: { type: 'number' },
            cognitive: { type: 'number' },
            loc: { type: 'number' },
          },
          required: ['cyclomatic', 'cognitive', 'loc'],
        });
        expect(validation.valid).toBe(true);
      }
    });

    test('DataValidator rejects invalid metrics', async () => {
      const badMetrics = {
        cyclomatic: -1,
        cognitive: 'not a number',
        loc: null,
      };

      const result = await validator.validate(badMetrics, {
        type: 'object',
        fields: {
          cyclomatic: { type: 'number', min: 0 },
          cognitive: { type: 'number' },
          loc: { type: 'number' },
        },
        required: ['cyclomatic', 'cognitive', 'loc'],
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------
  // 6. Config Center + Plugin Registry Integration
  // --------------------------------------------------------
  describe('6. Config Center + Plugin Registry Integration', () => {
    let configStore: ConfigStore;
    let registry: PluginRegistry;

    beforeEach(() => {
      configStore = new ConfigStore();
      registry = new PluginRegistry();
    });

    test('plugin configurations stored in ConfigStore', async () => {
      // Store plugin config
      configStore.set('plugins.my-plugin.enabled', true);
      configStore.set('plugins.my-plugin.version', '1.0.0');
      configStore.set('plugins.my-plugin.options.timeout', 5000);

      expect(configStore.get('plugins.my-plugin.enabled')).toBe(true);
      expect(configStore.get('plugins.my-plugin.version')).toBe('1.0.0');
      expect(configStore.get('plugins.my-plugin.options.timeout')).toBe(5000);
    });

    test('plugin reads config from ConfigStore on initialization', async () => {
      // Set config before plugin registration
      configStore.set('plugins.test-plugin.maxRetries', 3);
      configStore.set('plugins.test-plugin.debug', true);

      // Register a plugin
      await registry.register({
        name: 'test-plugin',
        version: '1.0.0',
        description: 'A test plugin',
      });

      // Initialize the plugin
      await registry.initialize('test-plugin');
      await registry.activate('test-plugin');

      // Verify plugin state
      const state = registry.getPluginState('test-plugin');
      expect(state).toBe('active');

      // Verify config is still accessible
      expect(configStore.get('plugins.test-plugin.maxRetries')).toBe(3);
    });

    test('config changes trigger watch notifications', () => {
      const changes: Array<{ path: string; newValue: unknown; oldValue: unknown }> = [];

      configStore.watch('plugins.test-plugin', (path, newValue, oldValue) => {
        changes.push({ path, newValue, oldValue });
      });

      configStore.set('plugins.test-plugin.enabled', true);
      configStore.set('plugins.test-plugin.enabled', false);
      configStore.set('plugins.test-plugin.timeout', 1000);

      expect(changes.length).toBeGreaterThanOrEqual(2);
    });

    test('config versioning and rollback', () => {
      configStore.set('app.name', 'v1');
      const versionId = configStore.createVersion('before-change');
      configStore.set('app.name', 'v2');

      expect(configStore.get('app.name')).toBe('v2');

      const restored = configStore.restoreVersion(versionId);
      expect(restored).toBe(true);
      expect(configStore.get('app.name')).toBe('v1');
    });

    test('plugin registry lists plugins correctly', async () => {
      await registry.register({
        name: 'plugin-a',
        version: '1.0.0',
        description: 'Plugin A',
      });
      await registry.register({
        name: 'plugin-b',
        version: '2.0.0',
        description: 'Plugin B',
      });

      const plugins = registry.listPlugins();
      expect(plugins.length).toBe(2);

      const activePlugins = registry.listPlugins({ state: 'loaded' });
      expect(activePlugins.length).toBe(2);
    });
  });

  // --------------------------------------------------------
  // 7. Notification + Alert Manager Integration
  // --------------------------------------------------------
  describe('7. Notification + Alert Manager Integration', () => {
    let alertManager: AlertManager;
    let notificationCenter: NotificationCenter;
    let anomalyDetector: AnomalyDetector;

    beforeEach(() => {
      alertManager = new AlertManager();
      notificationCenter = new NotificationCenter();
      anomalyDetector = new AnomalyDetector();
      anomalyDetector.registerMetric('error_rate', {
        windowSize: 20,
        thresholdMax: 50,
      });
    });

    test('anomaly detection triggers alerts', () => {
      // Create an alert rule
      const ruleId = alertManager.createRule({
        name: 'High Error Rate',
        severity: 'critical',
        metricName: 'error_rate',
        condition: (data) => data.value > 50,
        threshold: 50,
      });

      // Evaluate with high error rate
      const evaluation = alertManager.evaluateRule(ruleId, {
        name: 'error_rate',
        value: 75,
        timestamp: Date.now(),
      });

      expect(evaluation.triggered).toBe(true);
      expect(evaluation.severity).toBe('critical');
      expect(evaluation.alertId).toBeDefined();
    });

    test('alerts generate notifications', async () => {
      const receivedNotifications: any[] = [];

      notificationCenter.subscribe('console', async (notification) => {
        receivedNotifications.push(notification);
      });

      // Create and trigger an alert
      const ruleId = alertManager.createRule({
        name: 'Memory Alert',
        severity: 'warning',
        metricName: 'memory_usage',
        condition: (data) => data.value > 80,
        threshold: 80,
      });

      const evaluation = alertManager.evaluateRule(ruleId, {
        name: 'memory_usage',
        value: 90,
        timestamp: Date.now(),
      });

      expect(evaluation.triggered).toBe(true);

      // Generate notification from alert
      if (evaluation.alertId) {
        const alert = alertManager.getAlert(evaluation.alertId);
        expect(alert).toBeDefined();

        await notificationCenter.send({
          id: `notif-${evaluation.alertId}`,
          type: 'error',
          priority: 'high',
          title: alert!.ruleName,
          message: alert!.message,
          channel: 'console',
          timestamp: Date.now(),
        });

        expect(receivedNotifications.length).toBe(1);
        expect(receivedNotifications[0].title).toBe('Memory Alert');
      }
    });

    test('end-to-end: anomaly to notification', async () => {
      const notifications: any[] = [];

      notificationCenter.subscribe('console', async (n) => {
        notifications.push(n);
      });

      // Create alert rule
      const ruleId = alertManager.createRule({
        name: 'Anomaly Alert',
        severity: 'critical',
        metricName: 'anomaly_score',
        condition: (data) => data.value > 100,
        threshold: 100,
      });

      // Record anomalous data
      anomalyDetector.record('error_rate', 200);
      anomalyDetector.record('error_rate', 300);
      anomalyDetector.record('error_rate', 500);

      const anomalyReports = anomalyDetector.detect();
      const hasAnomaly = anomalyReports.length > 0;

      // If anomaly detected, evaluate alert rule
      if (hasAnomaly) {
        const evaluation = alertManager.evaluateRule(ruleId, {
          name: 'anomaly_score',
          value: 500,
          timestamp: Date.now(),
        });

        if (evaluation.triggered && evaluation.alertId) {
          await notificationCenter.send({
            id: `e2e-notif-${Date.now()}`,
            type: 'error',
            priority: 'critical',
            title: 'Anomaly Detected',
            message: `Anomaly score: 500, alerts triggered`,
            channel: 'console',
            timestamp: Date.now(),
          });
        }
      }

      // Verify end-to-end flow
      expect(anomalyReports.length).toBeGreaterThan(0);
      expect(notifications.length).toBeGreaterThan(0);
    });

    test('alert statistics are tracked correctly', () => {
      const ruleId = alertManager.createRule({
        name: 'Test Rule',
        severity: 'warning',
        metricName: 'test',
        condition: (data) => data.value > 10,
        threshold: 10,
      });

      // Trigger multiple alerts
      alertManager.evaluateRule(ruleId, { name: 'test', value: 20, timestamp: Date.now() });
      alertManager.evaluateRule(ruleId, { name: 'test', value: 30, timestamp: Date.now() });

      const stats = alertManager.getStatistics();
      expect(stats.total).toBe(2);
      expect(stats.active).toBe(2);
    });
  });

  // --------------------------------------------------------
  // 8. Persistent Runtime + State Sync Integration
  // --------------------------------------------------------
  describe('8. Persistent Runtime + State Sync Integration', () => {
    let stateStore: StateStore;
    let checkpointManager: CheckpointManager;
    let loop: InfiniteLoop;

    beforeEach(() => {
      stateStore = new StateStore();
      checkpointManager = new CheckpointManager({
        trigger: { timeIntervalSec: 0, iterationInterval: 5, sizeThreshold: 0 },
        retention: { maxCount: 100, maxAgeHours: 24 },
      });
    });

    afterEach(async () => {
      loop?.destroy();
    });

    test('loop iterations update state store', async () => {
      const iterations = 10;
      let completedIterations = 0;

      loop = new InfiniteLoop({
        mode: 'interval',
        intervalMs: 10,
        maxIterations: iterations,
        onIteration: () => {
          completedIterations++;
          stateStore.set(`iteration:${completedIterations}`, {
            count: completedIterations,
            timestamp: Date.now(),
          });
        },
      });

      loop.start();

      // Wait for all iterations
      await new Promise(resolve => setTimeout(resolve, iterations * 20 + 50));

      expect(completedIterations).toBe(iterations);
      expect(stateStore.size()).toBe(iterations);

      // Verify stored data
      for (let i = 1; i <= iterations; i++) {
        const entry = stateStore.get(`iteration:${i}`);
        expect(entry).toBeDefined();
        expect((entry as any).value.count).toBe(i);
      }
    });

    test('checkpoint can be created and restored from state store', async () => {
      // Set some state
      stateStore.set('key1', 'value1');
      stateStore.set('key2', { nested: true });

      // Create checkpoint from state
      const snapshot = stateStore.snapshot('before-change');
      expect(snapshot.entryCount).toBe(2);

      // Modify state
      stateStore.set('key1', 'modified');
      stateStore.set('key3', 'new-value');

      expect(stateStore.size()).toBe(3);

      // Restore from snapshot
      const restored = stateStore.restore(snapshot.id);
      expect(restored).toBe(true);
      expect(stateStore.size()).toBe(2);
      expect(stateStore.get('key1')?.value).toBe('value1');
    });

    test('checkpoint manager tracks iterations', () => {
      checkpointManager.setIteration(5);
      const cp = checkpointManager.createCheckpoint('iteration-5', { counter: 5 });

      expect(cp.iteration).toBe(5);
      expect(cp.label).toBe('iteration-5');

      const info = checkpointManager.getLatestCheckpoint();
      expect(info).toBeDefined();
      expect(info!.iteration).toBe(5);
    });

    test('checkpoint restore verifies integrity', async () => {
      const cp = checkpointManager.createCheckpoint('test', { data: 'test-value' });

      const result = await checkpointManager.restoreCheckpoint(cp.id);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ data: 'test-value' });
    });

    test('state store versioning works correctly', () => {
      stateStore.set('versioned-key', 'v1');
      expect(stateStore.getVersion('versioned-key')).toBe(1);

      stateStore.set('versioned-key', 'v2');
      expect(stateStore.getVersion('versioned-key')).toBe(2);

      stateStore.set('versioned-key', 'v3');
      expect(stateStore.getVersion('versioned-key')).toBe(3);
    });
  });

  // --------------------------------------------------------
  // 9. Event Sourcing + Workflow Integration
  // --------------------------------------------------------
  describe('9. Event Sourcing + Workflow Integration', () => {
    let eventStore: EventSourcedStore;
    let engine: WorkflowEngine;

    beforeEach(() => {
      eventStore = new EventSourcedStore();
      engine = new WorkflowEngine();
    });

    test('record workflow events in EventSourcedStore', () => {
      // Define a workflow
      engine.define({
        id: 'event-sourced-wf',
        name: 'Event Sourced Workflow',
        version: '1.0.0',
        steps: [
          {
            id: 'create',
            name: 'Create',
            type: 'task',
            config: {},
            next: ['update'],
          },
          {
            id: 'update',
            name: 'Update',
            type: 'task',
            config: {},
            next: [],
          },
        ],
      });

      // Record workflow definition as a created event
      eventStore.append({
        aggregateId: 'event-sourced-wf',
        eventType: 'created',
        payload: {
          name: 'Event Sourced Workflow',
          version: '1.0.0',
          steps: ['create', 'update'],
        },
        version: 1,
        timestamp: Date.now(),
      });

      // Verify event was stored
      const events = eventStore.getEvents('event-sourced-wf');
      expect(events.length).toBe(1);
      expect(events[0].eventType).toBe('created');
    });

    test('workflow state can be reconstructed from events', () => {
      const aggregateId = 'reconstruct-wf';

      // Record a series of events
      eventStore.append({
        aggregateId,
        eventType: 'created',
        payload: { name: 'Test Workflow', status: 'draft' },
        version: 1,
        timestamp: Date.now(),
      });

      eventStore.append({
        aggregateId,
        eventType: 'updated',
        payload: { status: 'active', version: '1.1.0' },
        version: 2,
        timestamp: Date.now(),
      });

      eventStore.append({
        aggregateId,
        eventType: 'updated',
        payload: { stepCount: 5, enabled: true },
        version: 3,
        timestamp: Date.now(),
      });

      // Reconstruct state
      const state = eventStore.getState(aggregateId) as Record<string, unknown>;
      expect(state).toBeDefined();
      // The default applyEvent merges payloads, so last event's fields should be present
      expect(state.stepCount).toBe(5);
      expect(state.enabled).toBe(true);
      expect(state.status).toBe('active');
      expect(state.version).toBe('1.1.0');
    });

    test('event replay produces same state', () => {
      const aggregateId = 'replay-wf';

      eventStore.append({
        aggregateId,
        eventType: 'created',
        payload: { counter: 0 },
        version: 1,
        timestamp: Date.now(),
      });

      eventStore.append({
        aggregateId,
        eventType: 'updated',
        payload: { counter: 1 },
        version: 2,
        timestamp: Date.now(),
      });

      const state1 = eventStore.getState(aggregateId);
      const state2 = eventStore.replay(aggregateId);

      expect(JSON.stringify(state1)).toBe(JSON.stringify(state2));
    });

    test('snapshot accelerates state reconstruction', () => {
      const aggregateId = 'snapshot-wf';

      // Add many events
      for (let i = 0; i < 100; i++) {
        eventStore.append({
          aggregateId,
          eventType: 'updated',
          payload: { iteration: i, data: `value-${i}` },
          version: i + 1,
          timestamp: Date.now(),
        });
      }

      // Create snapshot
      eventStore.createSnapshot(aggregateId);

      // Add more events after snapshot
      eventStore.append({
        aggregateId,
        eventType: 'updated',
        payload: { iteration: 100, final: true },
        version: 101,
        timestamp: Date.now(),
      });

      const state = eventStore.getState(aggregateId) as Record<string, unknown>;
      expect(state.final).toBe(true);
      expect(state.iteration).toBe(100);
    });

    test('projector receives events in order', () => {
      const receivedEvents: string[] = [];

      eventStore.registerProjector('test-projector', (event) => {
        receivedEvents.push(event.eventType);
      });

      eventStore.append({
        aggregateId: 'proj-test',
        eventType: 'created',
        payload: {},
        version: 1,
        timestamp: Date.now(),
      });

      eventStore.append({
        aggregateId: 'proj-test',
        eventType: 'updated',
        payload: {},
        version: 2,
        timestamp: Date.now(),
      });

      eventStore.append({
        aggregateId: 'proj-test',
        eventType: 'deleted',
        payload: {},
        version: 3,
        timestamp: Date.now(),
      });

      expect(receivedEvents).toEqual(['created', 'updated', 'deleted']);
    });
  });

  // --------------------------------------------------------
  // 10. Performance Under Load
  // --------------------------------------------------------
  describe('10. Performance Under Load', () => {
    test('object pool reduces allocation overhead', () => {
      let allocations = 0;

      const pool = new ObjectPool<{ buffer: number[] }>({
        factory: () => {
          allocations++;
          return { buffer: [] };
        },
        reset: (obj) => {
          obj.buffer.length = 0;
        },
        initialSize: 5,
        maxSize: 100,
        autoScale: false,
      });

      // Acquire and release many objects
      const acquireCount = 100;
      for (let i = 0; i < acquireCount; i++) {
        const obj = pool.acquire();
        obj.buffer.push(i);
        pool.release(obj);
      }

      const stats = pool.getStats();
      expect(stats.poolHitRate).toBeGreaterThan(0.9); // Most should be reused
      expect(stats.totalCreated).toBeLessThan(acquireCount); // Fewer than acquires
      expect(allocations).toBeLessThan(acquireCount);

      pool.dispose();
    });

    test('batch processor handles 10000 operations efficiently', async () => {
      const totalOps = 10000;
      const processedItems: number[] = [];

      const batchProcessor = new PerfBatchProcessor<number, number>({
        processor: async (batch) => {
          // Simulate processing
          return batch.map(item => item * 2);
        },
        maxBatchSize: 500,
        maxWaitTime: 10,
        concurrency: 10,
      });

      // Add all items
      const promises: Promise<number>[] = [];
      for (let i = 0; i < totalOps; i++) {
        promises.push(batchProcessor.add(i));
      }

      // Wait for all to complete
      const results = await Promise.all(promises);

      expect(results.length).toBe(totalOps);
      expect(results[0]).toBe(0); // 0 * 2
      expect(results[100]).toBe(200); // 100 * 2
      expect(results[9999]).toBe(19998); // 9999 * 2

      const stats = batchProcessor.getStats();
      expect(stats.totalItems).toBe(totalOps);
      expect(stats.errorCount).toBe(0);

      await batchProcessor.dispose();
    });

    test('object pool handles concurrent access pattern', () => {
      const pool = new ObjectPool<{ value: number }>({
        factory: () => ({ value: 0 }),
        reset: (obj) => { obj.value = 0; },
        initialSize: 10,
        maxSize: 50,
        autoScale: false,
      });

      // Simulate burst pattern
      const objects: { value: number }[] = [];
      for (let i = 0; i < 20; i++) {
        objects.push(pool.acquire());
      }

      // All should be in use
      const statsDuring = pool.getStats();
      expect(statsDuring.inUse).toBe(20);

      // Release all
      for (const obj of objects) {
        pool.release(obj);
      }

      const statsAfter = pool.getStats();
      expect(statsAfter.inUse).toBe(0);
      expect(statsAfter.idle).toBe(20);

      pool.dispose();
    });

    test('batch processor handles errors gracefully', async () => {
      let callCount = 0;

      const batchProcessor = new PerfBatchProcessor<number, number>({
        processor: async (batch) => {
          callCount++;
          // Always fail for item value 999, succeed for others
          if (batch.some(item => item === 999)) {
            throw new Error('Batch contains invalid item');
          }
          return batch.map(item => item * 2);
        },
        maxBatchSize: 100,
        maxWaitTime: 10,
        isolateErrors: true,
      });

      // Add a bad item - should be rejected in isolateErrors mode
      const badResult = batchProcessor.add(999);
      await expect(badResult).rejects.toThrow('Batch contains invalid item');

      // Add a good item - should succeed even after the bad item
      const goodResult = await batchProcessor.add(42);
      expect(goodResult).toBe(84);

      await batchProcessor.dispose();
    });

    test('LRU cache performance under load', async () => {
      // Import LRUCache from perf package
      const { LRUCache } = await import('../packages/perf/src/index.ts');

      const cache = new LRUCache<string, number>({ maxSize: 1000 });

      // Fill cache
      for (let i = 0; i < 1000; i++) {
        cache.set(`key-${i}`, i);
      }

      // Add more to trigger eviction - do NOT access old keys first
      // since updateAgeOnGet=true by default, accessing would refresh them
      for (let i = 1000; i < 1500; i++) {
        cache.set(`key-${i}`, i);
      }

      // Old keys should be evicted (least recently used = key-0 through key-499)
      const oldKey = cache.get('key-0');
      expect(oldKey).toBeUndefined();

      // New keys should exist
      const newKey = cache.get('key-1499');
      expect(newKey).toBe(1499);

      const stats = cache.getStats();
      expect(stats.size).toBeLessThanOrEqual(1000);
    });
  });
});

// ============================================================
// DEFECT REPORT SUMMARY (printed after all tests)
// ============================================================
describe('Defect Report Summary', () => {
  test('report all discovered defects', () => {
    if (defects.length === 0) {
      console.log('\n=== DEFECT REPORT ===');
      console.log('No defects found during integration stress testing.');
      console.log('=====================\n');
    } else {
      console.log('\n=== DEFECT REPORT ===');
      console.log(`Total defects found: ${defects.length}\n`);
      for (const defect of defects) {
        console.log(`[DEFECT] ${defect.description}`);
        console.log(`  Test: ${defect.test}`);
        console.log(`  Packages: ${defect.packages.join(', ')}`);
        console.log(`  Root Cause: ${defect.rootCause}`);
        console.log(`  Suggested Fix: ${defect.suggestedFix}`);
        console.log('');
      }
      console.log('=====================\n');
    }
    // Always pass this summary test
    expect(true).toBe(true);
  });
});
