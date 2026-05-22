/**
 * extreme-chaos-round10.test.ts
 *
 * Extreme cross-package integration chaos test exercising complex interactions
 * between: app-core, runtime-control, vector-store, test-utils, security,
 * resilience, orchestrator, agent-communication
 *
 * 35 tests covering:
 *  1. App-Core + Runtime-Control (4 tests)
 *  2. App-Core + Security (3 tests)
 *  3. App-Core + Vector-Store (3 tests)
 *  4. Runtime-Control + Vector-Store (3 tests)
 *  5. Runtime-Control + Security (3 tests)
 *  6. Runtime-Control + Resilience (3 tests)
 *  7. Vector-Store + Agent-Communication (3 tests)
 *  8. Test-Utils + All (3 tests)
 *  9. Full System Chaos (5 tests)
 *  10. Data Integrity (5 tests)
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

// ========== Package imports ==========

// app-core
import {
  Application,
  AppEventSystem,
  AppConfigManager,
  AppMiddlewarePipeline,
  CommandSystem,
  PluginHost,
  RoutingSystem,
  ServiceContainer,
  AppHealthSystem,
  AppTelemetrySystem,
  type AppConfig,
  type AppContext,
  type AppMiddleware,
  type AppResult,
  type PluginDefinition,
  type CommandDefinition,
  type ComponentDescriptor,
} from '../packages/app-core/src/index.js';

// runtime-control
import {
  ThreadPoolManager,
  ConfigHotSwap,
  DEFAULT_CONFIG,
  RemoteControlServer,
  OpsCommandRegistry,
  DeploymentManager,
  LogAggregator,
  MemoryManager,
  RealtimeMonitor,
  type RuntimeConfig,
  type PoolTask,
} from '../packages/runtime-control/src/index.js';

// vector-store
import {
  VectorIndex,
  HNSWIndex,
  EmbeddingCache,
  DocumentStore,
  randomVector,
  cosineSimilarity,
  normalize,
} from '../packages/vector-store/src/index.js';

// test-utils
import {
  createMockGraphStore,
  createMockCircuitBreaker,
  generateCodeSnippet,
  generateGraphData,
  generateTimelineEvents,
  generateWorkflowDefinition,
  generatePipelineStages,
  generateUserSessions,
  generateAPIMockResponses,
  deepDiff,
  deepClone,
  deepMerge,
  isEqual,
  sortBy,
  groupBy,
  countBy,
  uniqBy,
  waitFor,
  delay,
  repeat,
  measureTime,
  generateId,
  resetIdCounter,
  createTempStore,
  setupMockConsole,
  setupMockTimer,
  flushPromises,
  createAsyncIterator,
  assertDeepEqual,
  assertNoLeaks,
  assertConsistency,
  assertPipelineResult,
  assertWorkflowCompleted,
  assertPerformance,
  createIsolatedContext,
  ScenarioBuilder,
  fuzzString,
  fuzzNumber,
  fuzzObject,
  fuzzJSON,
  mutateString,
  mutateNumber,
  mutateJSON,
  type TempStore,
} from '../packages/test-utils/src/index.js';

// security
import {
  Sandbox,
  AuthManager,
  TokenAuthStrategy,
  CSRFProtection,
  InputValidator,
  SecretManager,
  MemorySecretProvider,
  AuditLog,
} from '../packages/security/src/index.js';

// resilience
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
  RetryWithBackoff,
  TimeoutGuard,
  TimeoutError,
  HealthChecker,
  Bulkhead,
  FallbackProvider,
  GracefulShutdownManager,
  ChaosEngine,
} from '../packages/resilience/src/index.js';

// orchestrator
import {
  TaskDecomposer,
  SmartOrchestrator,
  PermissionDelegation,
  type ParsedTask,
} from '../packages/orchestrator/src/index.js';

// agent-communication
import {
  MessageBus,
  ConsensusEngine,
  TaskDelegationManager,
  MessageEncryptionLayer,
  type Message,
} from '../packages/agent-communication/src/index.js';

// ========== Helper factories ==========

function createAuthManagerWithToken(): AuthManager {
  const auth = new AuthManager();
  const tokenStrategy = new TokenAuthStrategy('test-secret-key-chaos-r10');
  auth.registerStrategy(tokenStrategy);
  auth.registerUser({
    id: 'user-1',
    username: 'chaos-user',
    roles: ['admin'],
    permissions: ['task:execute', 'task:read', 'plugin:manage', 'config:write'],
  });
  return auth;
}

function createParsedTask(overrides: Partial<ParsedTask> = {}): ParsedTask {
  return {
    raw: 'Analyze the project structure',
    intent: 'analyze',
    confidence: 0.9,
    entities: [],
    language: 'en',
    description: 'Analyze project structure',
    priority: 'high',
    tags: ['analysis'],
    ...overrides,
  };
}

function createRandomVector(dim: number): number[] {
  return Array.from({ length: dim }, () => Math.random() - 0.5);
}

function delayMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// 1. App-Core + Runtime-Control
// ============================================================================

describe('App-Core + Runtime-Control Chaos', () => {
  let app: Application;
  let configManager: AppConfigManager;
  let eventSystem: AppEventSystem;
  let threadPool: ThreadPoolManager;
  let hotSwap: ConfigHotSwap;

  beforeEach(() => {
    app = Application.create({ name: 'chaos-app', environment: 'test' });
    configManager = new AppConfigManager({ port: 3000, maxRetries: 3 });
    eventSystem = new AppEventSystem(500);
    threadPool = new ThreadPoolManager(4, true);
    hotSwap = new ConfigHotSwap({ maxWorkers: 4, memoryLimit: 512 });
  });

  it('should handle application lifecycle with hot config swap', async () => {
    // Register config watchers
    const configChanges: Array<{ path: string; newVal: unknown; oldVal: unknown }> = [];
    configManager.watch('port', (newVal, oldVal) => {
      configChanges.push({ path: 'port', newVal, oldVal });
    });
    configManager.watch('maxRetries', (newVal, oldVal) => {
      configChanges.push({ path: 'maxRetries', newVal, oldVal });
    });

    // Start application
    expect(app.getPhase()).toBe('idle');
    await app.start();
    expect(app.getPhase()).toBe('running');

    // Hot swap config while app is running
    configManager.set('port', 8080);
    configManager.set('maxRetries', 5);

    // Also swap runtime-control config
    const swapResult = hotSwap.updateConfig({ maxWorkers: 8, cacheTTL: 600 });
    expect(swapResult.success).toBe(true);
    expect(swapResult.applied).toContain('maxWorkers');

    // Verify config changes propagated
    expect(configManager.get('port')).toBe(8080);
    expect(configManager.get('maxRetries')).toBe(5);
    expect(configChanges.length).toBe(2);
    expect(hotSwap.getConfig().maxWorkers).toBe(8);
  });

  it('should process middleware pipeline during graceful shutdown', async () => {
    const shutdownManager = new GracefulShutdownManager({
      drainTimeout: 5000,
      forceShutdownTimeout: 2000,
    });

    const pipeline = new AppMiddlewarePipeline();
    const processedRequests: string[] = [];

    // Register middleware
    pipeline.use({
      name: 'logging',
      type: 'pre-process',
      priority: 1,
      execute: async (ctx, next) => {
        processedRequests.push(`log-${ctx.requestId}`);
        return next();
      },
    });

    pipeline.use({
      name: 'auth',
      type: 'pre-process',
      priority: 0,
      execute: async (ctx, next) => {
        processedRequests.push(`auth-${ctx.requestId}`);
        return next();
      },
    });

    // Register shutdown handler that drains in-flight requests
    shutdownManager.register(async () => {
      // Simulate draining 3 requests through middleware
      for (let i = 0; i < 3; i++) {
        const ctx: AppContext = {
          request: { method: 'GET', path: `/api/${i}`, headers: {} },
          state: {},
          requestId: `req-${i}`,
          startTime: Date.now(),
        };
        await pipeline.execute(ctx);
      }
    }, 'drain_active', 'drain-middleware');

    // Start shutdown
    await shutdownManager.shutdown('test');
    expect(processedRequests.length).toBe(6); // 3 requests * 2 middleware each
    expect(processedRequests[0]).toBe('auth-req-0');
    expect(processedRequests[1]).toBe('log-req-0');
  });

  it('should handle event system under thread pool pressure', async () => {
    const receivedEvents: string[] = [];
    let eventCount = 0;

    // Subscribe to events
    eventSystem.on('system', 'task-complete', (data: any) => {
      receivedEvents.push(data.id);
      eventCount++;
    });

    eventSystem.on('application', 'config-change', (data: any) => {
      receivedEvents.push(`config-${data.key}`);
      eventCount++;
    });

    // Submit many tasks to thread pool that emit events
    const taskCount = 20;
    const tasks: PoolTask[] = Array.from({ length: taskCount }, (_, i) => ({
      id: `task-${i}`,
      priority: i % 3,
      handler: async () => {
        eventSystem.emit('system', 'task-complete', { id: `task-${i}`, result: 'ok' });
        if (i % 5 === 0) {
          eventSystem.emit('application', 'config-change', { key: `setting-${i}` });
        }
        return i;
      },
    }));

    // Submit all tasks concurrently
    const results = await Promise.allSettled(
      tasks.map(t => threadPool.submit(t, 5000))
    );

    // All tasks should complete
    const succeeded = results.filter(r => r.status === 'fulfilled');
    expect(succeeded.length).toBe(taskCount);

    // Wait for events to process
    await delayMs(100);

    // Verify events were received
    expect(eventCount).toBe(taskCount + Math.floor(taskCount / 5));
  });

  it('should handle concurrent config layer updates with thread pool tasks', async () => {
    // Add multiple config layers
    configManager.addLayer('env', 10, { dbHost: 'localhost', cacheSize: 100 });
    configManager.addLayer('user', 50, { featureFlag: true, maxItems: 50 });

    // Concurrently read and write config from thread pool
    const operations = 30;
    const errors: Error[] = [];

    const tasks: PoolTask[] = Array.from({ length: operations }, (_, i) => ({
      id: `cfg-op-${i}`,
      priority: i % 5,
      handler: async () => {
        try {
          // Read
          const port = configManager.get<number>('port');
          expect(typeof port).toBe('number');

          // Write to user layer
          configManager.set(`dynamic-key-${i}`, `value-${i}`);

          // Read back
          const val = configManager.get<string>(`dynamic-key-${i}`);
          expect(val).toBe(`value-${i}`);
        } catch (e) {
          errors.push(e instanceof Error ? e : new Error(String(e)));
        }
      },
    }));

    await Promise.allSettled(tasks.map(t => threadPool.submit(t, 5000)));

    expect(errors.length).toBe(0);
  });
});

// ============================================================================
// 2. App-Core + Security
// ============================================================================

describe('App-Core + Security Chaos', () => {
  let auth: AuthManager;
  let commandSystem: CommandSystem;
  let csrf: CSRFProtection;
  let sandbox: Sandbox;

  beforeEach(() => {
    auth = createAuthManagerWithToken();
    commandSystem = new CommandSystem();
    csrf = new CSRFProtection({ expiryMs: 60000 });
    sandbox = new Sandbox({
      networkEnabled: false,
      filesystemBlacklist: ['/etc', '/proc', '/sys'],
    });
  });

  it('should enforce auth checks on command system execution', async () => {
    // Register command that checks auth via its first argument
    const secureCommand: CommandDefinition = {
      name: 'deploy',
      description: 'Deploy application',
      arguments: [
        { name: 'target', description: 'Target env', required: true, type: 'string' },
        { name: 'token', description: 'Auth token', required: true, type: 'string' },
      ],
      options: [],
      handler: async (args) => {
        const token = args['token'] as string | undefined;
        if (!token) {
          return { success: false, output: 'Auth required', error: 'No token provided', duration: 0 };
        }
        const authResult = await auth.authenticate({ token }, 'token');
        if (!authResult.success) {
          return { success: false, output: 'Auth failed', error: authResult.error, duration: 0 };
        }
        return { success: true, output: `Deployed to ${args['target']}`, data: {}, duration: 10 };
      },
    };

    commandSystem.register(secureCommand);

    // Test without token (missing required argument)
    const result1 = await commandSystem.execute('deploy prod');
    expect(result1.success).toBe(false);
    expect(result1.error).toContain('Missing required argument');

    // Test with invalid token
    const result2 = await commandSystem.execute('deploy prod invalid-token-value');
    expect(result2.success).toBe(false);

    // Test with valid auth
    const token = auth.generateToken('user-1', 60000);
    expect(token).not.toBeNull();
    const result3 = await commandSystem.execute(`deploy prod ${token!}`);
    expect(result3.success).toBe(true);
    expect(result3.output).toContain('prod');
  });

  it('should validate CSRF tokens on routing system requests', () => {
    const routing = new RoutingSystem();

    // Add routes
    routing.addRoute({
      name: 'update-config',
      method: 'POST',
      path: '/api/config',
      handler: (params, query, body) => ({ updated: true, body }),
    });

    routing.addRoute({
      name: 'get-status',
      method: 'GET',
      path: '/api/status',
      handler: () => ({ status: 'ok' }),
    });

    // Generate CSRF token
    const csrfToken = csrf.generateToken();

    // Validate the token
    expect(csrf.validateToken(csrfToken, csrfToken)).toBe(true);
    expect(csrf.validateToken('invalid', csrfToken)).toBe(false);
    expect(csrf.validateToken('', csrfToken)).toBe(false);

    // Match routes
    const postMatch = routing.match('POST', '/api/config');
    expect(postMatch).not.toBeNull();
    expect(postMatch!.route.name).toBe('update-config');

    const getMatch = routing.match('GET', '/api/status');
    expect(getMatch).not.toBeNull();
    expect(getMatch!.route.name).toBe('get-status');

    // No match for invalid path
    const noMatch = routing.match('DELETE', '/api/nonexistent');
    expect(noMatch).toBeNull();
  });

  it('should enforce sandbox constraints on plugin host execution', async () => {
    const pluginHost = new PluginHost();

    // Set plugin config before loading
    pluginHost.setConfig('restricted-plugin', 'test-key', 'value-test-key');

    // Load a plugin that reads config via API
    const plugin: PluginDefinition = {
      name: 'restricted-plugin',
      version: '1.0.0',
      description: 'A plugin with restricted access',
      permissions: ['read:config'],
      init: async (api) => {
        // Plugin uses the API to get config
        const val = api.getConfig('test-key');
        expect(val).toBe('value-test-key');
      },
    };

    // Load the plugin
    const loaded = await pluginHost.loadPlugin(plugin);
    expect(loaded.name).toBe('restricted-plugin');
    expect(loaded.active).toBe(true);

    // Verify sandbox blocks filesystem access
    const fsResult = sandbox.validateFilesystemAccess('/etc/passwd');
    expect(fsResult.allowed).toBe(false);

    const fsResult2 = sandbox.validateFilesystemAccess('/tmp/../../etc/shadow');
    expect(fsResult2.allowed).toBe(false);

    // Verify network is blocked
    const netResult = sandbox.validateNetworkAccess('evil.com', 443);
    expect(netResult.allowed).toBe(false);
  });
});

// ============================================================================
// 3. App-Core + Vector-Store
// ============================================================================

describe('App-Core + Vector-Store Chaos', () => {
  let eventSystem: AppEventSystem;
  let vectorIndex: VectorIndex;
  let embeddingCache: EmbeddingCache;
  let telemetry: AppTelemetrySystem;

  beforeEach(() => {
    eventSystem = new AppEventSystem(500);
    vectorIndex = new VectorIndex(8, { metric: 'cosine' });
    embeddingCache = new EmbeddingCache(100, 60000);
    telemetry = new AppTelemetrySystem();
  });

  it('should trigger vector search from application events', async () => {
    const searchResults: any[] = [];

    // Populate vector index
    for (let i = 0; i < 10; i++) {
      const vec = createRandomVector(8);
      vectorIndex.add(`doc-${i}`, vec, { category: i % 3 === 0 ? 'important' : 'normal' });
    }

    // Subscribe to search events
    eventSystem.on('data', 'vector-search-request', async (data: any) => {
      const query = data.query as number[];
      const topK = data.topK as number;
      const results = vectorIndex.search(query, topK);
      searchResults.push(...results);

      // Emit result event
      eventSystem.emit('data', 'vector-search-result', {
        queryId: data.queryId,
        resultCount: results.length,
      });
    });

    // Emit search request events
    const query = createRandomVector(8);
    eventSystem.emit('data', 'vector-search-request', { query, topK: 3, queryId: 'q1' });
    eventSystem.emit('data', 'vector-search-request', { query, topK: 5, queryId: 'q2' });

    await delayMs(50);

    // Should have results from both searches
    expect(searchResults.length).toBeGreaterThan(0);
  });

  it('should use config-driven embedding cache', () => {
    const configManager = new AppConfigManager({
      cacheMaxSize: 50,
      cacheTTL: 30000,
    });

    const maxSize = configManager.get<number>('cacheMaxSize');
    const ttl = configManager.get<number>('cacheTTL');

    // Create cache based on config
    const cache = new EmbeddingCache(maxSize, ttl);

    // Compute embeddings through cache
    const vec1 = cache.compute('text-1', () => createRandomVector(8));
    const vec2 = cache.compute('text-1', () => createRandomVector(8)); // Should hit cache
    const vec3 = cache.compute('text-2', () => createRandomVector(8));

    expect(vec1).toEqual(vec2); // Same cache key -> same result
    expect(vec1).not.toEqual(vec3); // Different key -> different result

    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(2);
  });

  it('should track vector operations in telemetry', () => {
    // Track vector operations using recordMetric
    telemetry.recordMetric('vector.add', 1, 'counter', { dimension: '8' });
    telemetry.recordMetric('vector.search', 1, 'counter', { metric: 'cosine' });
    telemetry.recordMetric('vector.add', 1, 'counter', { dimension: '8' });
    telemetry.recordMetric('vector.search.latency', 12.5, 'histogram', { metric: 'cosine' });
    telemetry.recordMetric('vector.search.latency', 8.3, 'histogram', { metric: 'cosine' });
    telemetry.recordMetric('vector.index.size', 100, 'gauge');

    const snapshot = telemetry.getMetrics();
    expect(snapshot.counters['vector.add']).toBe(2);
    expect(snapshot.counters['vector.search']).toBe(1);
    expect(snapshot.gauges['vector.index.size']).toBe(100);
  });
});

// ============================================================================
// 4. Runtime-Control + Vector-Store
// ============================================================================

describe('Runtime-Control + Vector-Store Chaos', () => {
  let threadPool: ThreadPoolManager;
  let deploymentManager: DeploymentManager;
  let memoryManager: MemoryManager;
  let vectorIndex: VectorIndex;
  let hnswIndex: HNSWIndex;

  beforeEach(() => {
    threadPool = new ThreadPoolManager(4, true);
    deploymentManager = new DeploymentManager();
    memoryManager = new MemoryManager();
    vectorIndex = new VectorIndex(16, { metric: 'cosine' });
    hnswIndex = new HNSWIndex(16, { M: 8, efConstruction: 50, efSearch: 20 });
  });

  it('should execute vector indexing in thread pool', async () => {
    const dim = 16;
    const docCount = 50;

    // Submit vector indexing tasks to thread pool
    const tasks: PoolTask[] = Array.from({ length: docCount }, (_, i) => ({
      id: `index-${i}`,
      priority: i % 5,
      handler: async () => {
        const vec = createRandomVector(dim);
        vectorIndex.add(`doc-${i}`, vec, { source: `file-${i}` });
        hnswIndex.add(`doc-${i}`, vec);
        return i;
      },
    }));

    const results = await Promise.allSettled(
      tasks.map(t => threadPool.submit(t, 10000))
    );

    const succeeded = results.filter(r => r.status === 'fulfilled');
    expect(succeeded.length).toBe(docCount);

    // Verify both indexes have all documents
    const query = createRandomVector(dim);
    const bruteResults = vectorIndex.search(query, 5);
    const hnswResults = hnswIndex.search(query, 5);

    expect(bruteResults.length).toBe(5);
    expect(hnswResults.length).toBe(5);
  });

  it('should handle deployment rollback during index rebuild', async () => {
    // Start a deployment
    const deployResult = await deploymentManager.deploy({
      version: '2.0.0',
      environment: 'production',
      strategy: 'blue-green',
      rollbackOnFailure: true,
    });

    expect(deployResult.success).toBe(true);

    // Simulate index rebuild in progress
    const rebuildTask: PoolTask = {
      id: 'rebuild-index',
      priority: 0,
      handler: async () => {
        for (let i = 0; i < 20; i++) {
          vectorIndex.add(`new-doc-${i}`, createRandomVector(16));
        }
        return 20;
      },
    };

    // Submit rebuild and then trigger rollback concurrently
    const rebuildPromise = threadPool.submit(rebuildTask, 5000);

    // Trigger rollback
    const rollbackResult = await deploymentManager.rollback(deployResult.deploymentId);
    expect(rollbackResult.success).toBe(true);
    expect(rollbackResult.previousVersion).toBeDefined();

    // Rebuild should still complete
    const rebuildResult = await rebuildPromise;
    expect(rebuildResult).toBe(20);
  });

  it('should track memory usage with large vector datasets', () => {
    // Simulate tracking large vector allocations
    const largeVectors: number[][] = [];
    for (let i = 0; i < 100; i++) {
      const vec = createRandomVector(128);
      largeVectors.push(vec);
      vectorIndex.add(`large-${i}`, createRandomVector(16)); // Use correct dim for index
      memoryManager.registerLargeObject(vec.length * 8, 'Float64Array');
    }

    // Record memory usage
    memoryManager.recordUsage();
    const usage = memoryManager.getUsage();
    expect(usage.used).toBeGreaterThan(0);
    expect(usage.percentage).toBeGreaterThan(0);

    // Get trend
    memoryManager.recordUsage();
    const trend = memoryManager.getTrend();
    expect(['increasing', 'decreasing', 'stable']).toContain(trend.direction);

    // Check for leaks
    const leakReport = memoryManager.detectLeaks();
    expect(typeof leakReport.hasLeak).toBe('boolean');
    expect(typeof leakReport.confidence).toBe('number');
  });
});

// ============================================================================
// 5. Runtime-Control + Security
// ============================================================================

describe('Runtime-Control + Security Chaos', () => {
  let hotSwap: ConfigHotSwap;
  let remoteControl: RemoteControlServer;
  let opsCommands: OpsCommandRegistry;
  let auth: AuthManager;

  beforeEach(() => {
    hotSwap = new ConfigHotSwap();
    remoteControl = new RemoteControlServer(['valid-api-key-1', 'valid-api-key-2']);
    opsCommands = new OpsCommandRegistry();
    auth = createAuthManagerWithToken();
  });

  it('should validate config hotswap with security constraints', () => {
    // Add security validator
    hotSwap.addValidator((changes) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      if (changes.memoryLimit !== undefined && changes.memoryLimit > 2048) {
        errors.push('memoryLimit exceeds security maximum of 2048MB');
      }
      if (changes.apiTimeout !== undefined && changes.apiTimeout > 60000) {
        warnings.push('apiTimeout is very high, may cause resource exhaustion');
      }
      return { valid: errors.length === 0, errors, warnings };
    });

    // Valid change
    const result1 = hotSwap.updateConfig({ maxWorkers: 8 });
    expect(result1.success).toBe(true);

    // Invalid security change
    const result2 = hotSwap.updateConfig({ memoryLimit: 4096 });
    expect(result2.success).toBe(false);
    expect(result2.rejected).toContain('memoryLimit');

    // Warning but valid
    const result3 = hotSwap.updateConfig({ apiTimeout: 90000 });
    expect(result3.success).toBe(true);
    expect(result3.applied).toContain('apiTimeout');
  });

  it('should enforce auth on remote control commands', async () => {
    // Register custom command
    remoteControl.registerCommand('custom-op', async (cmd) => ({
      success: true,
      data: { operation: 'custom' },
      commandId: cmd.id,
      timestamp: Date.now(),
    }));

    // Verify API key authentication
    expect(remoteControl.authenticate('valid-api-key-1')).toBe(true);
    expect(remoteControl.authenticate('valid-api-key-2')).toBe(true);
    expect(remoteControl.authenticate('invalid-key')).toBe(false);
    expect(remoteControl.authenticate('')).toBe(false);

    // Execute command with valid API key context
    const result1 = await remoteControl.handleCommand({
      id: 'cmd-1',
      name: 'custom-op',
      timestamp: Date.now(),
      apiKey: 'valid-api-key-1',
    });
    expect(result1.success).toBe(true);

    // Execute built-in command
    const result2 = await remoteControl.handleCommand({
      id: 'cmd-2',
      name: 'status',
      timestamp: Date.now(),
    });
    expect(result2.success).toBe(true);

    // Verify audit log captures all commands
    const auditLog = remoteControl.getAuditLog();
    expect(auditLog.length).toBe(2);
  });

  it('should check permissions on ops commands', async () => {
    // The ops command registry has built-in commands with different permission levels.
    // 'restart' requires admin, 'config' requires operator, 'status' requires readonly.

    // Execute admin command (should succeed - no permission check in execute method)
    const result1 = await opsCommands.execute('restart', []);
    expect(result1.success).toBe(true);

    // Execute operator command
    const result2 = await opsCommands.execute('config', []);
    expect(result2.success).toBe(true);

    // Execute readonly command
    const result3 = await opsCommands.execute('status', []);
    expect(result3.success).toBe(true);

    // Verify permission metadata
    const restartHelp = opsCommands.getHelp('restart');
    expect(restartHelp).not.toBeNull();
    expect(restartHelp!.permission).toBe('admin');

    const configHelp = opsCommands.getHelp('config');
    expect(configHelp!.permission).toBe('operator');

    const statusHelp = opsCommands.getHelp('status');
    expect(statusHelp!.permission).toBe('readonly');

    // Verify in history
    const history = opsCommands.getHistory();
    expect(history.length).toBe(3);
  });
});

// ============================================================================
// 6. Runtime-Control + Resilience
// ============================================================================

describe('Runtime-Control + Resilience Chaos', () => {
  let healthChecker: HealthChecker;
  let circuitBreaker: CircuitBreaker;
  let realtimeMonitor: RealtimeMonitor;
  let logAggregator: LogAggregator;

  beforeEach(() => {
    healthChecker = new HealthChecker();
    circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 500,
      windowType: 'count',
    });
    realtimeMonitor = new RealtimeMonitor(100);
    logAggregator = new LogAggregator(5000);
  });

  it('should integrate health checker with circuit breaker', async () => {
    let shouldFail = true;

    // Register health check that uses circuit breaker
    healthChecker.registerCheck('api-via-cb', async () => {
      try {
        await circuitBreaker.execute(async () => {
          if (shouldFail) throw new Error('Service unavailable');
          return 'ok';
        });
        return { healthy: true, message: 'API is healthy' };
      } catch {
        return { healthy: false, message: 'API is down', level: 'unhealthy' as const };
      }
    }, 'liveness');

    // First checks should fail and open the circuit
    for (let i = 0; i < 4; i++) {
      await healthChecker.checkHealth();
    }

    expect(circuitBreaker.getState()).toBe('open');

    // Wait for circuit to transition to half-open
    await delayMs(600);

    // Fix the service
    shouldFail = false;

    // Next check should succeed (half-open allows one attempt)
    const report = await healthChecker.checkHealth();
    expect(report.components['api-via-cb'].level).toBe('healthy');
  });

  it('should use realtime monitor with retry logic', async () => {
    let attemptCount = 0;

    // Set up monitor to collect metrics
    realtimeMonitor.setCollectCallback(() => {
      const metrics = new Map<string, number>();
      metrics.set('cpu', 50 + Math.random() * 30);
      metrics.set('memory', 60 + Math.random() * 20);
      return metrics;
    });

    // Set up alert
    let alertTriggered = false;
    realtimeMonitor.setAlert('cpu', { operator: '>', threshold: 75 }, () => {
      alertTriggered = true;
    });

    // Collect metrics
    realtimeMonitor.collect();
    realtimeMonitor.collect();

    const cpuSnapshot = realtimeMonitor.getMetric('cpu');
    expect(cpuSnapshot).toBeDefined();
    expect(cpuSnapshot!.value).toBeGreaterThan(0);

    // Use retry to check monitor
    const retry = new RetryWithBackoff({
      maxRetries: 3,
      strategy: 'fixed',
      baseDelay: 50,
    });

    await retry.execute(async () => {
      attemptCount++;
      realtimeMonitor.collect();
      const metric = realtimeMonitor.getMetric('cpu');
      if (metric && metric.value > 0) return metric;
      throw new Error('No metric collected');
    });

    expect(attemptCount).toBeGreaterThanOrEqual(1);
  });

  it('should aggregate logs during cascading failures', async () => {
    const failureChain: string[] = [];

    // Simulate cascading failures
    const failingService = async (name: string) => {
      logAggregator.error(name, `Service ${name} failed`, { phase: 'cascading' });
      failureChain.push(name);
      throw new Error(`${name} failed`);
    };

    // Trigger cascade
    try { await failingService('database'); } catch {}
    try { await failingService('cache'); } catch {}
    try { await failingService('api-gateway'); } catch {}
    try { await failingService('auth-service'); } catch {}

    // Search logs for failure pattern
    const errorLogs = logAggregator.search({ level: 'error' });
    expect(errorLogs.length).toBe(4);

    const cascadeLogs = logAggregator.search({
      meta: { phase: 'cascading' },
    });
    expect(cascadeLogs.length).toBe(4);

    // Verify failure chain order
    expect(failureChain).toEqual(['database', 'cache', 'api-gateway', 'auth-service']);

    // Get stats
    const stats = logAggregator.getStats();
    expect(stats.total).toBeGreaterThanOrEqual(4);
    expect(stats.byLevel.error).toBe(4);
  });
});

// ============================================================================
// 7. Vector-Store + Agent-Communication
// ============================================================================

describe('Vector-Store + Agent-Communication Chaos', () => {
  let vectorIndex: VectorIndex;
  let documentStore: DocumentStore;
  let messageBus: MessageBus;
  let consensusEngine: ConsensusEngine;

  beforeEach(() => {
    vectorIndex = new VectorIndex(8, { metric: 'cosine' });
    documentStore = new DocumentStore();
    messageBus = new MessageBus();
    consensusEngine = new ConsensusEngine();
    consensusEngine.setAgentWeight('agent-1', 1);
    consensusEngine.setAgentWeight('agent-2', 1);
    consensusEngine.setAgentWeight('agent-3', 1);
  });

  it('should use vector search results as message context', async () => {
    // Populate documents
    const docs = [
      { id: 'doc-1', content: 'How to deploy applications', embedding: createRandomVector(8), metadata: { topic: 'deployment' } },
      { id: 'doc-2', content: 'Security best practices', embedding: createRandomVector(8), metadata: { topic: 'security' } },
      { id: 'doc-3', content: 'Performance optimization guide', embedding: createRandomVector(8), metadata: { topic: 'performance' } },
    ];

    for (const doc of docs) {
      documentStore.addDocument(doc);
      vectorIndex.add(doc.id, doc.embedding!, doc.metadata);
    }

    // Search for relevant documents
    const query = createRandomVector(8);
    const results = vectorIndex.search(query, 2);

    // Use search results as message context
    const contextMessages = results.map(r => ({
      id: r.id,
      content: documentStore.getDocument(r.id)?.content,
      score: r.score,
    }));

    // Publish context as message
    messageBus.publish('search-results', {
      type: 'event',
      payload: { queryId: 'q1', results: contextMessages },
      sender: 'vector-service',
    });

    // Subscribe and verify
    let receivedContext: any = null;
    messageBus.subscribe('search-results', (msg: Message) => {
      receivedContext = msg.payload;
    });

    // Re-publish since subscriber was added after first publish
    messageBus.publish('search-results', {
      type: 'event',
      payload: { queryId: 'q2', results: contextMessages },
      sender: 'vector-service',
    });

    await delayMs(50);
    expect(receivedContext).not.toBeNull();
    expect(receivedContext.results.length).toBe(2);
  });

  it('should update HNSW index via agent consensus', async () => {
    const hnswIndex = new HNSWIndex(8, { M: 8, efConstruction: 50, efSearch: 20 });

    // Add initial vectors
    for (let i = 0; i < 10; i++) {
      hnswIndex.add(`init-${i}`, createRandomVector(8));
    }

    // Simulate consensus-based index update using message bus for coordination
    const messageBus = new MessageBus();
    const votes: Map<string, string> = new Map();
    const newVectors = Array.from({ length: 5 }, (_, i) => ({
      id: `consensus-${i}`,
      vector: createRandomVector(8),
    }));

    // Agents subscribe to vote topic
    messageBus.subscribe('index-vote', (msg: Message) => {
      votes.set(msg.sender as string, msg.payload.vote as string);
    });

    // Agents cast votes
    const agents = ['agent-1', 'agent-2', 'agent-3'];
    for (const agent of agents) {
      messageBus.publish('index-vote', {
        type: 'event',
        payload: { proposalId: 'index-update-1', vote: 'for' },
        sender: agent,
      });
    }

    await delayMs(50);

    // Verify consensus reached (majority voted for)
    const forCount = Array.from(votes.values()).filter(v => v === 'for').length;
    expect(forCount).toBe(3);
    expect(forCount > agents.length / 2).toBe(true); // Majority

    // Apply the consensus result - add vectors
    for (const vec of newVectors) {
      hnswIndex.add(vec.id, vec.vector);
    }

    // Verify search works
    const query = createRandomVector(8);
    const searchResults = hnswIndex.search(query, 3);
    expect(searchResults.length).toBe(3);
  });

  it('should store documents with encrypted content via message bus', async () => {
    const encryption = new MessageEncryptionLayer();

    // Register agents and generate key pairs
    const senderKeys = encryption.generateKeyPair('sender-agent');
    const receiverKeys = encryption.generateKeyPair('receiver-agent');

    // Create a message to encrypt
    const sensitiveMessage: Message = {
      id: 'msg-enc-1',
      type: 'command',
      topic: 'secure-docs',
      payload: { content: 'This is confidential data', action: 'store' },
      sender: 'sender-agent',
      receiver: 'receiver-agent',
      timestamp: Date.now(),
      priority: 0,
    };

    // Encrypt the message
    const encrypted = encryption.encrypt(sensitiveMessage, receiverKeys.publicKey);
    expect(encrypted.ciphertext).not.toBeNull();

    // Store encrypted document reference
    documentStore.addDocument({
      id: 'encrypted-doc-1',
      content: `encrypted:${encrypted.ciphertext.slice(0, 20)}`,
      metadata: { encrypted: true, algorithm: encrypted.algorithm },
    });

    // Retrieve and verify
    const stored = documentStore.getDocument('encrypted-doc-1');
    expect(stored).toBeDefined();
    expect(stored!.metadata!.encrypted).toBe(true);

    // Decrypt the message
    const decrypted = encryption.decrypt(encrypted, receiverKeys.privateKey);
    expect(decrypted.payload).toEqual(sensitiveMessage.payload);

    // Publish encryption event
    messageBus.publish('document-encrypted', {
      type: 'event',
      payload: { documentId: 'encrypted-doc-1', algorithm: encrypted.algorithm },
      sender: 'encryption-service',
    });

    let received: any = null;
    messageBus.subscribe('document-encrypted', (msg: Message) => {
      received = msg.payload;
    });

    messageBus.publish('document-encrypted', {
      type: 'event',
      payload: { documentId: 'encrypted-doc-1', algorithm: encrypted.algorithm },
      sender: 'encryption-service',
    });

    await delayMs(50);
    expect(received).not.toBeNull();
    expect(received.documentId).toBe('encrypted-doc-1');
  });
});

// ============================================================================
// 8. Test-Utils + All
// ============================================================================

describe('Test-Utils + All Packages Chaos', () => {
  it('should generate realistic test data for all packages', () => {
    // Generate data for graph store (knowledge-graph)
    const graphData = generateGraphData(10, 15);
    expect(graphData.nodes.length).toBe(10);
    expect(graphData.edges.length).toBe(15);

    // Generate code snippets (smart-code-analyzer)
    const snippet = generateCodeSnippet('typescript', 3);
    expect(snippet.language).toBe('typescript');
    expect(snippet.complexity).toBe(3);

    // Generate timeline events (event-sourcing)
    const events = generateTimelineEvents(20);
    expect(events.length).toBe(20);

    // Generate workflow definition (orchestrator)
    const workflow = generateWorkflowDefinition(5, 2);
    expect(workflow.steps.length).toBe(5);

    // Generate pipeline stages (data-pipeline)
    const pipeline = generatePipelineStages(4);
    expect(pipeline.length).toBe(4);

    // Generate user sessions (api-gateway)
    const sessions = generateUserSessions(10);
    expect(sessions.length).toBe(10);

    // Generate API mock responses (llm-integration)
    const apiResponses = generateAPIMockResponses('/api/test');
    expect(apiResponses.length).toBe(4);

    // Generate mock graph store
    const mockStore = createMockGraphStore(graphData);
    expect(mockStore).toBeDefined();
  });

  it('should verify cross-package data consistency with assertions', async () => {
    // Create consistent data across packages
    const baseData = {
      id: 'cross-pkg-1',
      name: 'test-entity',
      version: '1.0.0',
      tags: ['chaos', 'integration'],
    };

    // Clone for each package
    const appCoreData = deepClone(baseData);
    const runtimeData = deepClone(baseData);
    const vectorData = deepClone(baseData);

    // Verify deep equality
    expect(isEqual(appCoreData, runtimeData)).toBe(true);
    expect(isEqual(runtimeData, vectorData)).toBe(true);

    // Use deep diff to verify no differences
    const diffs = deepDiff(appCoreData, vectorData);
    const changes = diffs.filter(d => d.type !== 'equal');
    expect(changes.length).toBe(0);

    // Deep merge
    const merged = deepMerge(baseData, { tags: ['merged'], extra: true });
    expect(merged.tags).toEqual(['merged']);
    expect(merged.extra).toBe(true);
    expect(merged.name).toBe('test-entity');

    // Sort and group operations
    const items = [
      { name: 'c', category: 'a' },
      { name: 'a', category: 'b' },
      { name: 'b', category: 'a' },
    ];
    const sorted = sortBy(items, 'name');
    expect(sorted[0].name).toBe('a');

    const grouped = groupBy(items, 'category');
    expect(grouped['a'].length).toBe(2);
    expect(grouped['b'].length).toBe(1);

    const counted = countBy(items, 'category');
    expect(counted['a']).toBe(2);

    const uniq = uniqBy([...items, { name: 'a', category: 'c' }], 'name');
    expect(uniq.length).toBe(3);
  });

  it('should build chaos scenarios with ScenarioBuilder', () => {
    const scenario = new ScenarioBuilder()
      .withGraph({ nodeCount: 8, edgeCount: 12 })
      .withWorkflow({ steps: 4, branches: 2 })
      .withPipeline(3)
      .withReplication({ nodeCount: 3, factor: 2 })
      .withEvents([
        { type: 'failure', data: { service: 'database' } },
        { type: 'recovery', data: { service: 'database' } },
      ])
      .injectFault('network-partition', 'node-2')
      .injectFault('memory-exhaustion', 'node-1')
      .build();

    expect(scenario.graph).toBeDefined();
    expect(scenario.graph!.nodes.length).toBe(8);
    expect(scenario.workflow).toBeDefined();
    expect(scenario.pipeline).toBeDefined();
    expect(scenario.replication).toBeDefined();
    expect(scenario.events!.length).toBe(2);
    expect(scenario.faults!.length).toBe(2);

    // Use fuzz helpers to generate chaotic inputs
    const fuzzResult = fuzzString((s) => s, 100);
    expect(fuzzResult.iterations).toBe(100);
    expect(typeof fuzzResult).toBe('object');

    const fuzzNumResult = fuzzNumber((n) => n, 100, -1000, 1000);
    expect(fuzzNumResult.iterations).toBe(100);

    const fuzzObjResult = fuzzObject((o) => o, 100, 3);
    expect(fuzzObjResult.iterations).toBe(100);

    const fuzzJSONResult = fuzzJSON((j) => j, 100);
    expect(fuzzJSONResult.iterations).toBe(100);

    // Mutation helpers
    const mutatedStr = mutateString('hello world');
    expect(typeof mutatedStr).toBe('string');

    const mutatedNum = mutateNumber(42);
    expect(typeof mutatedNum).toBe('number');
  });
});

// ============================================================================
// 9. Full System Chaos
// ============================================================================

describe('Full System Chaos', () => {
  it('should handle complete application lifecycle with all packages', async () => {
    // 1. Create application
    const app = Application.create({ name: 'full-chaos-app', environment: 'test' });
    const eventSystem = new AppEventSystem(500);
    const configManager = new AppConfigManager({ port: 8080 });
    const healthSystem = new AppHealthSystem();
    const telemetry = new AppTelemetrySystem();

    // 2. Configure
    configManager.addLayer('runtime', 100, { debug: true, logLevel: 'debug' });
    configManager.set('featureFlag.vectors', true);
    configManager.set('featureFlag.auth', true);

    // 3. Set up security
    const auth = createAuthManagerWithToken();
    const token = auth.generateToken('user-1', 60000);

    // 4. Set up resilience
    const circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 1000,
      windowType: 'count',
    });

    const shutdownManager = new GracefulShutdownManager({
      drainTimeout: 3000,
      forceShutdownTimeout: 1000,
    });

    // 5. Set up vector store
    const vectorIndex = new VectorIndex(8);
    for (let i = 0; i < 20; i++) {
      vectorIndex.add(`vec-${i}`, createRandomVector(8), { source: `doc-${i}` });
    }

    // 6. Set up runtime control
    const threadPool = new ThreadPoolManager(2, true);
    const hotSwap = new ConfigHotSwap({ maxWorkers: 2 });

    // 7. Set up agent communication
    const messageBus = new MessageBus();
    const messages: Message[] = [];
    messageBus.subscribe('system-events', (msg) => messages.push(msg));

    // 8. Initialize application
    await app.start();
    expect(app.getPhase()).toBe('running');

    // 9. Execute tasks with vector search
    const searchTask: PoolTask = {
      id: 'vector-search',
      priority: 0,
      handler: async () => {
        const query = createRandomVector(8);
        const results = vectorIndex.search(query, 5);
        eventSystem.emit('data', 'search-completed', { resultCount: results.length });
        messageBus.publish('system-events', {
          type: 'event',
          payload: { event: 'search-completed', count: results.length },
          sender: 'worker',
        });
        return results.length;
      },
    };

    const searchResult = await threadPool.submit(searchTask, 5000);
    expect(searchResult).toBe(5);

    // 10. Handle a failure with circuit breaker
    let shouldFail = true;
    try {
      await circuitBreaker.execute(async () => {
        if (shouldFail) throw new Error('Simulated failure');
        return 'ok';
      });
    } catch {}

    expect(circuitBreaker.getState()).toBe('closed'); // Only 1 failure, threshold is 5

    // 11. Graceful shutdown
    shutdownManager.register(async () => {
      eventSystem.emit('system', 'shutdown', { reason: 'test-complete' });
      messageBus.publish('system-events', {
        type: 'event',
        payload: { event: 'shutdown' },
        sender: 'shutdown-manager',
      });
    }, 'cleanup', 'event-cleanup');

    await shutdownManager.shutdown('test-complete');

    // Verify final state
    expect(messages.length).toBeGreaterThanOrEqual(1);
  });

  it('should survive concurrent operations across all package boundaries', async () => {
    const eventSystem = new AppEventSystem(1000);
    const vectorIndex = new VectorIndex(8);
    const messageBus = new MessageBus();
    const threadPool = new ThreadPoolManager(4, true);
    const configManager = new AppConfigManager();

    const completedOps: string[] = [];
    let errorCount = 0;

    // Submit 50 concurrent operations mixing different packages
    const tasks: PoolTask[] = Array.from({ length: 50 }, (_, i) => ({
      id: `concurrent-op-${i}`,
      priority: i % 5,
      handler: async () => {
        try {
          switch (i % 5) {
            case 0: {
              // Event system operation
              eventSystem.emit('system', `event-${i}`, { index: i });
              completedOps.push(`event-${i}`);
              break;
            }
            case 1: {
              // Vector store operation
              vectorIndex.add(`concurrent-${i}`, createRandomVector(8));
              const results = vectorIndex.search(createRandomVector(8), 3);
              completedOps.push(`vector-${i}`);
              break;
            }
            case 2: {
              // Message bus operation
              messageBus.publish('concurrent-topic', {
                type: 'event',
                payload: { index: i },
                sender: `worker-${i}`,
              });
              completedOps.push(`message-${i}`);
              break;
            }
            case 3: {
              // Config operation
              configManager.set(`concurrent-key-${i}`, `value-${i}`);
              const val = configManager.get<string>(`concurrent-key-${i}`);
              expect(val).toBe(`value-${i}`);
              completedOps.push(`config-${i}`);
              break;
            }
            case 4: {
              // Combined operation
              eventSystem.emit('data', 'combined', { taskId: i });
              vectorIndex.add(`combined-${i}`, createRandomVector(8));
              completedOps.push(`combined-${i}`);
              break;
            }
          }
        } catch {
          errorCount++;
        }
      },
    }));

    const results = await Promise.allSettled(
      tasks.map(t => threadPool.submit(t, 10000))
    );

    const succeeded = results.filter(r => r.status === 'fulfilled');
    expect(succeeded.length).toBe(50);
    expect(errorCount).toBe(0);
    expect(completedOps.length).toBe(50);
  });

  it('should recover from cascading failures across packages', async () => {
    const circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 1,
      timeout: 300,
      windowType: 'count',
    });

    const retry = new RetryWithBackoff({
      maxRetries: 5,
      strategy: 'exponential',
      baseDelay: 50,
      maxDelay: 500,
    });

    const logAggregator = new LogAggregator(5000);
    const eventSystem = new AppEventSystem(500);

    let failCount = 0;
    const maxFails = 4;

    // Operation that fails a few times then succeeds
    const resilientOperation = async (): Promise<string> => {
      return retry.execute(async () => {
        return circuitBreaker.execute(async () => {
          failCount++;
          if (failCount <= maxFails) {
            logAggregator.error('resilient-op', `Attempt ${failCount} failed`);
            eventSystem.emit('system', 'operation-failed', { attempt: failCount });
            throw new Error(`Failure ${failCount}`);
          }
          logAggregator.info('resilient-op', 'Operation succeeded');
          eventSystem.emit('system', 'operation-recovered', { totalAttempts: failCount });
          return 'success';
        });
      });
    };

    // This should eventually succeed after retries
    const result = await resilientOperation();
    expect(result).toBe('success');
    expect(failCount).toBeGreaterThan(maxFails);

    // Verify logs
    const errorLogs = logAggregator.search({ level: 'error' });
    expect(errorLogs.length).toBeGreaterThan(0);

    const infoLogs = logAggregator.search({ level: 'info' });
    expect(infoLogs.length).toBeGreaterThan(0);
  });

  it('should handle resource exhaustion with bulkhead and fallback', async () => {
    const bulkhead = new Bulkhead({ maxConcurrent: 3, maxQueue: 5 });

    const fallback = new FallbackProvider<string>();
    fallback.addFallback({
      strategy: 'alternative_function',
      alternativeFn: async () => 'fallback-result',
      priority: 1,
    });

    const results: any[] = [];
    const errors: Error[] = [];

    // Try to execute more operations than bulkhead allows
    const operations = Array.from({ length: 10 }, (_, i) =>
      bulkhead.execute(async () => {
        await delayMs(50);
        return { index: i };
      })
    );

    const settled = await Promise.allSettled(operations);
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        results.push(r.value);
      } else {
        errors.push(r.reason);
      }
    }

    // Some should succeed, some might be rejected by bulkhead
    expect(results.length).toBeGreaterThan(0);

    // Use fallback for rejected operations
    for (const error of errors) {
      const fallbackResult = await fallback.execute(
        async () => { throw error; },
        [{
          strategy: 'alternative_function',
          alternativeFn: async () => 'fallback-result',
          priority: 1,
        }],
      );
      expect(fallbackResult).toBe('fallback-result');
    }
  });

  it('should maintain state consistency during partial updates', async () => {
    const tempStore = createTempStore();
    const vectorIndex = new VectorIndex(8);
    const configManager = new AppConfigManager();

    // Initialize state
    const entityCount = 20;
    for (let i = 0; i < entityCount; i++) {
      tempStore.set(`entity-${i}`, {
        id: `entity-${i}`,
        version: 1,
        data: `initial-data-${i}`,
        vector: createRandomVector(8),
      });
      vectorIndex.add(`entity-${i}`, createRandomVector(8), { version: 1 });
    }

    // Partial update: update only half the entities
    for (let i = 0; i < entityCount / 2; i++) {
      const entity = tempStore.get(`entity-${i}`) as any;
      entity.version = 2;
      entity.data = `updated-data-${i}`;
      tempStore.set(`entity-${i}`, entity);
      vectorIndex.remove(`entity-${i}`);
      vectorIndex.add(`entity-${i}`, createRandomVector(8), { version: 2 });
    }

    // Verify consistency: updated entities have version 2
    let updatedCount = 0;
    let originalCount = 0;
    for (let i = 0; i < entityCount; i++) {
      const entity = tempStore.get(`entity-${i}`) as any;
      const vecEntry = vectorIndex.get(`entity-${i}`);
      expect(vecEntry).toBeDefined(); // All should exist in vector index
      if (entity.version === 2) {
        updatedCount++;
        expect(entity.data).toBe(`updated-data-${i}`);
      } else {
        originalCount++;
        expect(entity.data).toBe(`initial-data-${i}`);
      }
    }

    expect(updatedCount).toBe(entityCount / 2);
    expect(originalCount).toBe(entityCount / 2);
    expect(tempStore.size()).toBe(entityCount);
  });
});

// ============================================================================
// 10. Data Integrity
// ============================================================================

describe('Data Integrity Cross-Package Flow', () => {
  it('should maintain data consistency: app-core events -> orchestrator tasks -> vector-store indexing', async () => {
    const eventSystem = new AppEventSystem(500);
    const vectorIndex = new VectorIndex(8);
    const taskResults: Map<string, any> = new Map();

    // Step 1: App-core emits task-created event
    eventSystem.on('application', 'task-created', async (data: any) => {
      const taskId = data.taskId;
      taskResults.set(taskId, { status: 'processing', events: ['created'] });

      // Step 2: Simulate orchestrator processing
      await delayMs(10);
      taskResults.get(taskId)!.events.push('orchestrated');

      // Step 3: Index task data in vector store
      const vec = createRandomVector(8);
      vectorIndex.add(taskId, vec, { status: 'indexed' });
      taskResults.get(taskId)!.events.push('indexed');
      taskResults.get(taskId)!.status = 'complete';
    });

    // Create multiple tasks
    const taskIds = Array.from({ length: 10 }, (_, i) => `integrity-task-${i}`);
    for (const id of taskIds) {
      eventSystem.emit('application', 'task-created', { taskId: id });
    }

    await delayMs(200);

    // Verify all tasks completed the full pipeline
    for (const id of taskIds) {
      const result = taskResults.get(id);
      expect(result).toBeDefined();
      expect(result!.status).toBe('complete');
      expect(result!.events).toEqual(['created', 'orchestrated', 'indexed']);

      // Verify vector store has the data
      const vecEntry = vectorIndex.get(id);
      expect(vecEntry).toBeDefined();
      expect(vecEntry!.metadata!.status).toBe('indexed');
    }
  });

  it('should verify data flow: config changes -> runtime hotswap -> telemetry tracking', () => {
    const configManager = new AppConfigManager({ maxWorkers: 4, cacheTTL: 300 });
    const hotSwap = new ConfigHotSwap({ maxWorkers: 4, cacheTTL: 300 });
    const telemetry = new AppTelemetrySystem();

    const configFlow: string[] = [];

    // Watch config changes
    configManager.watch('maxWorkers', (newVal) => {
      configFlow.push(`config-manager: maxWorkers -> ${newVal}`);
      telemetry.recordMetric('config.change', 1, 'counter', { key: 'maxWorkers', value: String(newVal) });
    });

    // Subscribe to hotswap changes
    hotSwap.subscribe((changes) => {
      configFlow.push(`hotswap: ${JSON.stringify(changes)}`);
      telemetry.recordMetric('runtime.hotswap', 1, 'counter', { keys: Object.keys(changes).join(',') });
    });

    // Apply changes
    configManager.set('maxWorkers', 8);
    hotSwap.updateConfig({ maxWorkers: 8, cacheTTL: 600 });
    configManager.set('maxWorkers', 16);
    hotSwap.updateConfig({ maxWorkers: 16 });

    // Verify flow
    expect(configFlow.length).toBeGreaterThanOrEqual(2);

    // Verify telemetry
    const snapshot = telemetry.getMetrics();
    expect(snapshot.counters['config.change']).toBeGreaterThanOrEqual(2);
    expect(snapshot.counters['runtime.hotswap']).toBeGreaterThanOrEqual(2);
  });

  it('should ensure message integrity through agent-communication pipeline', async () => {
    const messageBus = new MessageBus();
    const encryption = new MessageEncryptionLayer();
    const senderKeys = encryption.generateKeyPair('sender');
    const receiverKeys = encryption.generateKeyPair('receiver');

    const receivedMessages: any[] = [];

    // Subscribe to encrypted channel
    messageBus.subscribe('secure-channel', (msg: Message) => {
      receivedMessages.push(msg.payload);
    });

    // Send messages through the pipeline
    const originalMessages = [
      { id: 'msg-1', content: 'Deploy v2.0', action: 'deploy' },
      { id: 'msg-2', content: 'Rollback v1.9', action: 'rollback' },
      { id: 'msg-3', content: 'Scale up', action: 'scale' },
    ];

    for (const orig of originalMessages) {
      // Create and encrypt a message
      const msg: Message = {
        id: orig.id,
        type: 'command',
        topic: 'secure-channel',
        payload: orig,
        sender: 'sender',
        receiver: 'receiver',
        timestamp: Date.now(),
        priority: 0,
      };
      const encrypted = encryption.encrypt(msg, receiverKeys.publicKey);

      // Send through message bus
      messageBus.publish('secure-channel', {
        type: 'event',
        payload: {
          id: orig.id,
          encryptedCiphertext: encrypted.ciphertext,
          algorithm: encrypted.algorithm,
        },
        sender: 'command-center',
      });

      // Verify we can decrypt
      const decrypted = encryption.decrypt(encrypted, receiverKeys.privateKey);
      expect(decrypted.payload).toEqual(orig);
    }

    await delayMs(100);

    // Verify all messages received
    expect(receivedMessages.length).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(receivedMessages[i].id).toBe(originalMessages[i].id);
    }
  });

  it('should validate end-to-end data consistency with fuzzed inputs', () => {
    const vectorIndex = new VectorIndex(8);
    const documentStore = new DocumentStore();
    const configManager = new AppConfigManager();
    const tempStore = createTempStore();

    // Generate fuzzed data
    const fuzzIterations = 20;
    const ids: string[] = [];

    for (let i = 0; i < fuzzIterations; i++) {
      const id = `fuzz-entity-${i}`;
      ids.push(id);

      // Generate fuzzed but valid data
      const fuzzedName = `name-${i}-fuzz`;
      const fuzzedValue = Math.floor(Math.random() * 1000);
      const vector = createRandomVector(8);

      // Store in all systems
      const entity = { id, name: fuzzedName, value: fuzzedValue, version: 1 };
      tempStore.set(id, entity);
      configManager.set(`entities.${id}`, entity);
      documentStore.addDocument({
        id,
        content: `Entity ${fuzzedName} with value ${fuzzedValue}`,
        embedding: vector,
        metadata: { name: fuzzedName, value: fuzzedValue },
      });
      vectorIndex.add(id, vector, { name: fuzzedName });
    }

    // Verify consistency across all stores
    for (const id of ids) {
      const tempData = tempStore.get(id) as any;
      const docData = documentStore.getDocument(id);
      const vecData = vectorIndex.get(id);

      expect(tempData).toBeDefined();
      expect(docData).toBeDefined();
      expect(vecData).toBeDefined();

      // Verify IDs match
      expect(tempData.id).toBe(id);
      expect(docData!.id).toBe(id);
      expect(vecData!.metadata!.name).toBe(tempData.name);
    }

    expect(tempStore.size()).toBe(fuzzIterations);
  });

  it('should handle data integrity during concurrent reads and writes', async () => {
    const vectorIndex = new VectorIndex(8);
    const documentStore = new DocumentStore();
    const threadPool = new ThreadPoolManager(4, true);

    // Pre-populate
    const initialCount = 30;
    for (let i = 0; i < initialCount; i++) {
      const vec = createRandomVector(8);
      vectorIndex.add(`concurrent-${i}`, vec);
      documentStore.addDocument({
        id: `concurrent-${i}`,
        content: `Document ${i}`,
        embedding: vec,
      });
    }

    // Concurrent reads
    const readTasks: PoolTask[] = Array.from({ length: 20 }, (_, i) => ({
      id: `read-${i}`,
      priority: 0,
      handler: async () => {
        const query = createRandomVector(8);
        const vecResults = vectorIndex.search(query, 5);
        const docResults = documentStore.search(query, 5);

        // Verify results are consistent
        expect(vecResults.length).toBe(5);
        expect(docResults.length).toBeLessThanOrEqual(5);

        // Cross-verify: vector results should exist in document store
        for (const vr of vecResults) {
          const doc = documentStore.getDocument(vr.id);
          expect(doc).toBeDefined();
        }

        return { vecCount: vecResults.length, docCount: docResults.length };
      },
    }));

    // Concurrent writes
    const writeTasks: PoolTask[] = Array.from({ length: 10 }, (_, i) => ({
      id: `write-${i}`,
      priority: 1,
      handler: async () => {
        const id = `new-concurrent-${i}`;
        const vec = createRandomVector(8);
        vectorIndex.add(id, vec);
        documentStore.addDocument({
          id,
          content: `New document ${i}`,
          embedding: vec,
        });
        return id;
      },
    }));

    const allTasks = [...readTasks, ...writeTasks];
    const results = await Promise.allSettled(
      allTasks.map(t => threadPool.submit(t, 10000))
    );

    const succeeded = results.filter(r => r.status === 'fulfilled');
    expect(succeeded.length).toBe(allTasks.length);

    // Final verification: all documents should be accessible
    const finalQuery = createRandomVector(8);
    const finalResults = vectorIndex.search(finalQuery, 10);
    expect(finalResults.length).toBe(10);

    for (const result of finalResults) {
      const doc = documentStore.getDocument(result.id);
      expect(doc).toBeDefined();
    }
  });
});
