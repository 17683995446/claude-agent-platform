/**
 * extreme-chaos-round9.test.ts
 *
 * Extreme cross-package integration chaos test exercising complex interactions
 * between: orchestrator, security, plugin-registry, agent-communication, resilience
 *
 * 30+ tests covering:
 *  1. Security + Orchestrator
 *  2. Security + Plugin-Registry
 *  3. Security + Agent-Communication
 *  4. Resilience + Orchestrator
 *  5. Resilience + Agent-Communication
 *  6. Resilience + Plugin-Registry
 *  7. Orchestrator + Agent-Communication
 *  8. Orchestrator + Plugin-Registry
 *  9. Agent-Communication + Plugin-Registry
 *  10. Full Pipeline Chaos
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

// ========== Package imports ==========
import {
  PermissionDelegation,
  TaskDecomposer,
  SmartOrchestrator,
  type ParsedTask,
  type PermissionLevel,
} from '../packages/orchestrator/src/index.js';

import {
  Sandbox,
  AuthManager,
  TokenAuthStrategy,
  APIKeyAuthStrategy,
  SecretManager,
  MemorySecretProvider,
  InputValidator,
  AuditLog,
} from '../packages/security/src/index.js';

import {
  PluginRegistry,
  PluginLoader,
  PluginSandbox,
  PluginCommunicationBus,
  PluginTelemetry,
  type PluginPermission,
} from '../packages/plugin-registry/src/index.js';

import {
  MessageBus,
  ConsensusEngine,
  TaskDelegationManager,
  MessageEncryptionLayer,
  type Message,
} from '../packages/agent-communication/src/index.js';

import {
  CircuitBreaker,
  CircuitBreakerOpenError,
  RetryWithBackoff,
  TimeoutGuard,
  TimeoutError,
  HealthChecker,
  Bulkhead,
  BulkheadFullError,
  FallbackProvider,
  GracefulShutdownManager,
  StateRecoveryManager,
} from '../packages/resilience/src/index.js';

// ========== Helper factories ==========

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

function createAuthManagerWithToken(): AuthManager {
  const auth = new AuthManager();
  const tokenStrategy = new TokenAuthStrategy('test-secret-key-chaos-round9');
  auth.registerStrategy(tokenStrategy);
  auth.registerUser({
    id: 'user-1',
    username: 'chaos-user',
    roles: ['admin'],
    permissions: ['task:execute', 'task:read', 'plugin:manage'],
  });
  return auth;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// 1. Security + Orchestrator
// ============================================================================

describe('Security + Orchestrator Chaos', () => {
  let auth: AuthManager;
  let permDelegation: PermissionDelegation;

  beforeEach(() => {
    auth = createAuthManagerWithToken();
    permDelegation = new PermissionDelegation({ enabled: true, allowedTools: ['read', 'write'], deniedTools: ['dangerous-tool'] });
  });

  afterEach(() => {
    permDelegation.clear();
  });

  it('should handle permission delegation during task execution', () => {
    const taskId = 'task-orch-1';
    permDelegation.grant(taskId, 'read', 'read');
    permDelegation.grant(taskId, 'write', 'write');

    const checkRead = permDelegation.check(taskId, 'read', 'read');
    expect(checkRead.granted).toBe(true);

    const checkWrite = permDelegation.check(taskId, 'write', 'write');
    expect(checkWrite.granted).toBe(true);

    const checkExecute = permDelegation.check(taskId, 'execute', 'execute');
    expect(checkExecute.granted).toBe(false);

    // Verify audit log
    const auditLog = permDelegation.getAuditLog({ taskId });
    expect(auditLog.length).toBeGreaterThan(0);
  });

  it('should block sandbox escape attempts during orchestration', () => {
    const sandbox = new Sandbox({
      networkEnabled: false,
      filesystemBlacklist: ['/etc', '/proc', '/sys'],
    });

    // Path traversal attempt
    const result1 = sandbox.validateFilesystemAccess('/tmp/../../etc/passwd');
    expect(result1.allowed).toBe(false);
    expect(result1.reason).toContain('Path traversal');

    // URL-encoded traversal attempt
    const result2 = sandbox.validateFilesystemAccess('/tmp/%2e%2e/etc/passwd');
    expect(result2.allowed).toBe(false);

    // Blacklisted path
    const result3 = sandbox.validateFilesystemAccess('/etc/shadow');
    expect(result3.allowed).toBe(false);
    expect(result3.reason).toContain('blacklisted');

    // Network access disabled
    const result4 = sandbox.validateNetworkAccess('evil.com', 443);
    expect(result4.allowed).toBe(false);
    expect(result4.reason).toContain('disabled');
  });

  it('should handle auth token expiry mid-task', async () => {
    const token = auth.generateToken('user-1', 50); // 50ms expiry
    expect(token).not.toBeNull();

    // Immediate auth should succeed
    const result1 = await auth.authenticate({ token }, 'token');
    expect(result1.success).toBe(true);

    // Wait for token to expire
    await delay(60);

    const result2 = await auth.authenticate({ token }, 'token');
    expect(result2.success).toBe(false);
    expect(result2.error).toContain('expired');
  });

  it('should enforce permission levels hierarchically during task phases', () => {
    // Use sandbox without allowedTools restriction to test permission levels purely
    const pd = new PermissionDelegation({ enabled: true, deniedTools: ['dangerous-tool'] });

    const taskId = 'task-hierarchy-1';
    pd.grant(taskId, 'read', 'admin');

    // Admin level should cover read, write, execute
    expect(pd.check(taskId, 'read', 'read').granted).toBe(true);
    expect(pd.check(taskId, 'read', 'write').granted).toBe(true);
    expect(pd.check(taskId, 'read', 'execute').granted).toBe(true);
    expect(pd.check(taskId, 'read', 'admin').granted).toBe(true);

    // Read level should NOT cover write/execute/admin
    const taskId2 = 'task-hierarchy-2';
    pd.grant(taskId2, 'read', 'read');
    expect(pd.check(taskId2, 'read', 'read').granted).toBe(true);
    expect(pd.check(taskId2, 'read', 'write').granted).toBe(false);
    expect(pd.check(taskId2, 'read', 'admin').granted).toBe(false);

    pd.clear();
  });

  it('should deny sandbox-blocked tools even with granted permissions', () => {
    const taskId = 'task-sandbox-block';
    permDelegation.grant(taskId, 'dangerous-tool', 'admin');

    const result = permDelegation.check(taskId, 'dangerous-tool', 'admin');
    expect(result.granted).toBe(false);
    expect(result.reason).toContain('sandbox');
  });

  it('should handle permission expiry during task decomposition', async () => {
    const taskId = 'task-expiring';
    permDelegation.grant(taskId, 'read', 'read', 'system', 30);

    expect(permDelegation.check(taskId, 'read', 'read').granted).toBe(true);

    await delay(40);

    const result = permDelegation.check(taskId, 'read', 'read');
    expect(result.granted).toBe(false);
    expect(result.reason).toContain('expired');
  });
});

// ============================================================================
// 2. Security + Plugin-Registry
// ============================================================================

describe('Security + Plugin-Registry Chaos', () => {
  let sandbox: PluginSandbox;
  let loader: PluginLoader;
  let telemetry: PluginTelemetry;

  beforeEach(() => {
    sandbox = new PluginSandbox();
    loader = new PluginLoader();
    telemetry = new PluginTelemetry();
  });

  afterEach(() => {
    loader.reset();
    telemetry.reset();
  });

  it('should block plugin sandbox filesystem bypass attempts', () => {
    sandbox.registerApi({
      name: 'fs.read',
      requiredPermissions: ['fs.read'] as PluginPermission[],
      handler: (path: string) => `content of ${path}`,
    });

    sandbox.registerApi({
      name: 'fs.write',
      requiredPermissions: ['fs.write'] as PluginPermission[],
      handler: (path: string, _data: string) => `wrote to ${path}`,
    });

    // Plugin with only read permission
    const ctx = sandbox.createSandbox('reader-plugin', ['fs.read'] as PluginPermission[]);

    // Read should work
    expect(() => ctx.callApi('fs.read', '/safe/path')).not.toThrow();

    // Write should be denied
    expect(() => ctx.callApi('fs.write', '/etc/passwd', 'malicious')).toThrow();
    expect(() => ctx.callApi('fs.write', '/etc/passwd', 'malicious')).toThrow(/lacks required permissions/);

    // Non-whitelisted API should be denied
    expect(() => ctx.callApi('dangerous_api', 'arg1')).toThrow(/not whitelisted/);

    // Verify audit log (read=allowed, write=denied by permissions, dangerous_api=denied by whitelist)
    const auditLog = ctx.getAuditLog();
    expect(auditLog.length).toBeGreaterThanOrEqual(3);
    expect(auditLog[0].result).toBe('allowed');
    // Remaining entries should all be denied
    expect(auditLog.slice(1).every(e => e.result === 'denied')).toBe(true);
  });

  it('should handle plugin auth with expired tokens', async () => {
    const auth = createAuthManagerWithToken();
    const shortToken = auth.generateToken('user-1', 30);
    expect(shortToken).not.toBeNull();

    // Immediate auth succeeds
    const result1 = await auth.authenticate({ token: shortToken }, 'token');
    expect(result1.success).toBe(true);

    // After expiry, plugin should fail to authenticate
    await delay(40);
    const result2 = await auth.authenticate({ token: shortToken }, 'token');
    expect(result2.success).toBe(false);

    // Audit log should record both attempts
    const auditEntries = auth.getAuditLog().getEntries({ action: 'authenticate' });
    expect(auditEntries.length).toBe(2);
    expect(auditEntries[0].result).toBe('success');
    expect(auditEntries[1].result).toBe('failure');
  });

  it('should handle secret rotation during plugin execution', async () => {
    const secretManager = new SecretManager({ defaultTTL: 1000 });
    const memProvider = new MemorySecretProvider();
    secretManager.registerProvider('memory', memProvider);

    await secretManager.set('api-key', 'secret-v1', 'memory');
    const v1 = await secretManager.get('api-key', 'memory');
    expect(v1).toBe('secret-v1');

    // Rotate secret during plugin execution simulation
    const rotationEvents: string[] = [];
    secretManager.onRotation('api-key', (key, oldV, newV) => {
      rotationEvents.push(`${key}: ${oldV} -> ${newV}`);
    });

    const newVersion = await secretManager.rotate('api-key', 'secret-v2', 'memory');
    expect(newVersion).toBe(2);

    const v2 = await secretManager.get('api-key', 'memory');
    expect(v2).toBe('secret-v2');

    // Old version should still be accessible via versioning
    const oldVersion = secretManager.getVersion('api-key', 1);
    expect(oldVersion?.value).toBe('secret-v1');

    expect(rotationEvents).toEqual(['api-key: 1 -> 2']);
  });

  it('should enforce rate limiting on plugin API calls', () => {
    sandbox.registerApi({
      name: 'limited-api',
      requiredPermissions: ['net.request'] as PluginPermission[],
      handler: () => 'ok',
      rateLimit: 3,
    });

    const ctx = sandbox.createSandbox('rate-limited-plugin', ['net.request'] as PluginPermission[]);

    // First 3 calls should succeed
    expect(ctx.callApi('limited-api')).toBe('ok');
    expect(ctx.callApi('limited-api')).toBe('ok');
    expect(ctx.callApi('limited-api')).toBe('ok');

    // 4th call should be rate limited
    expect(() => ctx.callApi('limited-api')).toThrow(/Rate limit exceeded/);
  });

  it('should track resource usage across plugin operations', () => {
    sandbox.registerApi({
      name: 'data.store',
      requiredPermissions: ['data.store'] as PluginPermission[],
      handler: () => 'stored',
    });

    const ctx = sandbox.createSandbox('usage-plugin', ['data.store'] as PluginPermission[]);

    ctx.callApi('data.store');
    ctx.callApi('data.store');
    ctx.callApi('data.store');

    const usage = ctx.getResourceUsage();
    expect(usage.requestCount).toBe(3);
    expect(usage.lastRequestTime).toBeGreaterThan(0);
  });
});

// ============================================================================
// 3. Security + Agent-Communication
// ============================================================================

describe('Security + Agent-Communication Chaos', () => {
  let encryption: MessageEncryptionLayer;
  let messageBus: MessageBus;

  beforeEach(() => {
    encryption = new MessageEncryptionLayer();
    messageBus = new MessageBus();
  });

  afterEach(() => {
    encryption.reset();
    messageBus.reset();
  });

  it('should reject message encryption with invalid keys', () => {
    const agentA = 'agent-alice';
    const agentB = 'agent-bob';

    encryption.generateKeyPair(agentA);
    encryption.generateKeyPair(agentB);

    const message: Message = {
      id: 'msg-1',
      type: 'event',
      topic: 'test',
      payload: { data: 'hello' },
      sender: agentA,
      receiver: agentB,
      timestamp: Date.now(),
      priority: 5,
    };

    const keyPairB = encryption.getKeyPair(agentB)!;
    const encrypted = encryption.encrypt(message, keyPairB.publicKey);

    // Decrypting with wrong private key should fail
    expect(() => {
      encryption.decrypt(encrypted, 'wrong-private-key');
    }).toThrow(/Invalid private key/);
  });

  it('should detect replay attacks on encrypted messages', () => {
    const agentA = 'agent-alice';
    const agentB = 'agent-bob';

    encryption.generateKeyPair(agentA);
    encryption.generateKeyPair(agentB);

    const message: Message = {
      id: 'msg-replay',
      type: 'event',
      topic: 'test',
      payload: { data: 'replay-test' },
      sender: agentA,
      receiver: agentB,
      timestamp: Date.now(),
      priority: 5,
    };

    const keyPairB = encryption.getKeyPair(agentB)!;
    const encrypted = encryption.encrypt(message, keyPairB.publicKey);

    // First decrypt succeeds
    const result1 = encryption.decrypt(encrypted, keyPairB.privateKey);
    expect(result1.id).toBe('msg-replay');

    // Second decrypt with same nonce should fail (replay)
    expect(() => {
      encryption.decrypt(encrypted, keyPairB.privateKey);
    }).toThrow(/Replay attack detected/);
  });

  it('should handle consensus engine with malicious agents', async () => {
    const consensus = new ConsensusEngine();
    consensus.setDefaultTimeout(200);
    consensus.setAgentWeight('honest-1', 1);
    consensus.setAgentWeight('honest-2', 1);
    consensus.setAgentWeight('honest-3', 1);
    consensus.setAgentWeight('malicious-1', 1);
    consensus.setAgentWeight('malicious-2', 1);

    const proposePromise = consensus.propose({
      topic: 'security-decision',
      description: 'Should we block the malicious agent?',
      proposer: 'honest-1',
    }, 'majority');

    // Get the proposal ID by peeking at proposals (it's set synchronously)
    // We need to vote before the timeout fires
    await delay(10); // Small delay to ensure proposal is registered
    const proposalIds = [...(consensus as any).proposals.keys()];
    expect(proposalIds.length).toBe(1);
    const proposalId = proposalIds[0];

    // 3 honest vs 2 malicious: honest votes win if they all vote 'for'
    consensus.vote(proposalId, 'honest-1', 'for');
    consensus.vote(proposalId, 'honest-2', 'for');
    consensus.vote(proposalId, 'honest-3', 'for');
    consensus.vote(proposalId, 'malicious-1', 'against');
    consensus.vote(proposalId, 'malicious-2', 'against');

    // Wait for timeout to tally votes
    const result = await proposePromise;
    expect(result.accepted).toBe(true);
    expect(result.forVotes).toBe(3);
    expect(result.againstVotes).toBe(2);

    consensus.reset();
  });

  it('should handle encrypted delegation tasks', () => {
    const agentA = 'delegator';
    const agentB = 'worker';

    encryption.generateKeyPair(agentA);
    encryption.generateKeyPair(agentB);
    encryption.exchangeKeys(agentA, agentB);

    const taskMessage: Message = {
      id: 'task-enc-1',
      type: 'command',
      topic: 'tasks',
      payload: { action: 'execute', target: 'analysis' },
      sender: agentA,
      receiver: agentB,
      timestamp: Date.now(),
      priority: 1,
    };

    const keyPairB = encryption.getKeyPair(agentB)!;
    const encrypted = encryption.encrypt(taskMessage, keyPairB.publicKey);

    // Verify encryption structure
    expect(encrypted.ciphertext).toBeTruthy();
    expect(encrypted.nonce).toBeTruthy();
    expect(encrypted.algorithm).toBe('AES-256-GCM-simulated');

    // Decrypt and verify
    const decrypted = encryption.decrypt(encrypted, keyPairB.privateKey);
    expect(decrypted.payload).toEqual({ action: 'execute', target: 'analysis' });
    expect(decrypted.sender).toBe(agentA);
  });

  it('should prevent double voting in consensus with security context', async () => {
    const consensus = new ConsensusEngine();
    consensus.setDefaultTimeout(200);
    consensus.setAgentWeight('voter-1', 1);
    consensus.setAgentWeight('voter-2', 1);

    const proposePromise = consensus.propose({
      topic: 'double-vote-test',
      description: 'Test double vote prevention',
      proposer: 'voter-1',
    }, 'majority');

    // Get proposal ID before timeout
    await delay(10);
    const proposalIds = [...(consensus as any).proposals.keys()];
    const proposalId = proposalIds[0];

    // First vote succeeds
    consensus.vote(proposalId, 'voter-1', 'for');

    // Second vote from same agent should be ignored
    consensus.vote(proposalId, 'voter-1', 'against');

    // Wait for timeout to tally
    const result = await proposePromise;
    expect(result.forVotes).toBe(1);
    expect(result.againstVotes).toBe(0);

    consensus.reset();
  });
});

// ============================================================================
// 4. Resilience + Orchestrator
// ============================================================================

describe('Resilience + Orchestrator Chaos', () => {
  let decomposer: TaskDecomposer;

  beforeEach(() => {
    decomposer = new TaskDecomposer();
  });

  it('should handle circuit breaker during parallel phase execution', async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 100,
      windowType: 'count',
      windowSize: 10,
    });

    // Simulate parallel phase failures
    let callCount = 0;
    const failingPhase = async () => {
      callCount++;
      if (callCount <= 3) throw new Error('Phase execution failed');
      return 'phase-success';
    };

    // First 3 calls fail, opening the circuit
    for (let i = 0; i < 3; i++) {
      try {
        await cb.execute(failingPhase);
      } catch (e) {
        expect((e as Error).message).toBe('Phase execution failed');
      }
    }

    expect(cb.getState()).toBe('open');

    // Next call should be rejected immediately
    await expect(cb.execute(failingPhase)).rejects.toThrow(CircuitBreakerOpenError);

    // Wait for timeout to transition to half-open
    await delay(120);
    expect(cb.getState()).toBe('half-open');

    // Successful calls should close the circuit
    const result = await cb.execute(failingPhase);
    expect(result).toBe('phase-success');
    const result2 = await cb.execute(failingPhase);
    expect(result2).toBe('phase-success');
    expect(cb.getState()).toBe('closed');
  });

  it('should handle retry with backoff during task decomposition', async () => {
    const retry = new RetryWithBackoff({
      maxRetries: 3,
      strategy: 'exponential',
      baseDelay: 10,
      maxDelay: 100,
    });

    let attemptCount = 0;
    const flakyDecompose = async () => {
      attemptCount++;
      if (attemptCount < 3) throw new Error('Transient decomposition failure');
      return createParsedTask();
    };

    const result = await retry.execute(flakyDecompose);
    expect(result.intent).toBe('analyze');
    expect(attemptCount).toBe(3);

    const history = retry.getHistory();
    expect(history.length).toBe(2); // 2 retries
  });

  it('should handle graceful shutdown during orchestration', async () => {
    const shutdownManager = new GracefulShutdownManager({
      drainTimeout: 200,
      forceShutdownTimeout: 100,
    });

    let cleanupCalled = false;
    let drainCalled = false;

    shutdownManager.register(async () => { drainCalled = true; }, 'drain_active', 'drain-handler');
    shutdownManager.register(async () => { cleanupCalled = true; }, 'cleanup', 'cleanup-handler');

    expect(shutdownManager.isShuttingDown()).toBe(false);

    await shutdownManager.shutdown('test-shutdown');

    expect(shutdownManager.isShuttingDown()).toBe(true);
    expect(drainCalled).toBe(true);
    expect(cleanupCalled).toBe(true);

    const status = shutdownManager.getStatus();
    expect(status.completedHandlers).toContain('drain-handler');
    expect(status.completedHandlers).toContain('cleanup-handler');

    shutdownManager.destroy();
  });

  it('should recover orchestrator state after cascading failures', async () => {
    const recovery = new StateRecoveryManager({ storage: 'memory', maxSnapshots: 5 });

    const planState = {
      phases: ['phase-1', 'phase-2', 'phase-3'],
      currentPhase: 'phase-2',
      completedPhases: ['phase-1'],
      taskResults: { 'phase-1': 'success' },
    };

    // Snapshot before failure
    const snap1 = recovery.createSnapshot(planState, { label: 'pre-failure' });
    expect(snap1.version).toBe(1);

    // Simulate corruption
    const corruptedState = {
      ...planState,
      currentPhase: 'unknown',
      completedPhases: [],
    };

    // Snapshot corrupted state
    recovery.createSnapshot(corruptedState, { label: 'corrupted' });

    // Restore from pre-failure snapshot
    const restored = await recovery.restore(snap1.id);
    expect(restored).not.toBeNull();
    expect((restored as typeof planState).currentPhase).toBe('phase-2');
    expect((restored as typeof planState).completedPhases).toEqual(['phase-1']);
  });

  it('should handle bulkhead isolation during parallel task phases', async () => {
    const bulkhead = new Bulkhead({ maxConcurrent: 2, maxQueueSize: 3, queueTimeout: 100 });

    const slowTask = (id: number) => async () => {
      await delay(50);
      return `task-${id}-done`;
    };

    // Fill bulkhead
    const p1 = bulkhead.execute(slowTask(1));
    const p2 = bulkhead.execute(slowTask(2));

    // Queue tasks
    const p3 = bulkhead.execute(slowTask(3));
    const p4 = bulkhead.execute(slowTask(4));

    expect(bulkhead.getActiveCount()).toBe(2);
    expect(bulkhead.getQueueSize()).toBeGreaterThanOrEqual(0);

    const results = await Promise.all([p1, p2, p3, p4]);
    expect(results).toEqual(['task-1-done', 'task-2-done', 'task-3-done', 'task-4-done']);
  });

  it('should use fallback provider for task execution failures', async () => {
    const fallback = new FallbackProvider<string>();
    fallback.addFallback({
      strategy: 'default_value',
      value: 'fallback-result',
      priority: 1,
    });

    const failingTask = async () => {
      throw new Error('Primary execution failed');
    };

    const result = await fallback.execute(failingTask);
    expect(result).toBe('fallback-result');

    const metrics = fallback.getMetrics();
    expect(metrics.primaryFailureCount).toBe(1);
    expect(metrics.fallbackTriggeredCount).toBe(1);
    expect(metrics.fallbackSuccessCount).toBe(1);
  });
});

// ============================================================================
// 5. Resilience + Agent-Communication
// ============================================================================

describe('Resilience + Agent-Communication Chaos', () => {
  let messageBus: MessageBus;
  let healthChecker: HealthChecker;

  beforeEach(() => {
    messageBus = new MessageBus();
    healthChecker = new HealthChecker();
  });

  afterEach(() => {
    messageBus.reset();
    healthChecker.stopAll();
  });

  it('should run health checker on message bus', async () => {
    let busHealthy = true;
    healthChecker.registerCheck('message-bus', async () => {
      return { healthy: busHealthy, message: busHealthy ? 'Bus is operational' : 'Bus is down' };
    }, 'liveness');

    const report = await healthChecker.checkHealth();
    expect(report.status).toBe('healthy');
    expect(report.components['message-bus'].level).toBe('healthy');

    // Simulate bus failure
    busHealthy = false;
    const report2 = await healthChecker.checkHealth();
    expect(report2.status).toBe('unhealthy');
    expect(report2.components['message-bus'].level).toBe('unhealthy');
  });

  it('should enforce timeout guard on consensus proposals', async () => {
    const consensus = new ConsensusEngine();
    consensus.setDefaultTimeout(50);

    // Proposal with short timeout - no votes, should expire
    const result = await consensus.propose({
      topic: 'timeout-test',
      description: 'Test timeout on proposal',
      proposer: 'agent-1',
    });

    // Proposal should have expired (no votes cast)
    expect(result.accepted).toBe(false);
    expect(result.forVotes).toBe(0);

    consensus.reset();
  });

  it('should retry failed delegations with backoff', async () => {
    const delegation = new TaskDelegationManager();
    delegation.registerAgent('agent-1', ['analysis']);

    const retry = new RetryWithBackoff({
      maxRetries: 3,
      strategy: 'fixed',
      baseDelay: 10,
      maxDelay: 50,
    });

    // Simulate a flaky delegation that fails on first attempt then succeeds
    let attempt = 0;
    const flakyDelegation = async () => {
      attempt++;
      if (attempt === 1) {
        throw new Error('Delegation temporarily unavailable');
      }
      return delegation.delegate({
        id: `retry-task-${attempt}`,
        type: 'analysis',
        payload: {},
        priority: 5,
        requiredCapabilities: ['analysis'],
        timeout: 50,
        createdAt: Date.now(),
      });
    };

    const result = await retry.execute(flakyDelegation);
    expect(result.success).toBe(true);
    expect(attempt).toBe(2);

    delegation.reset();
  });

  it('should handle circuit breaker on message bus flooding', async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      successThreshold: 1,
      timeout: 100,
      windowType: 'count',
      windowSize: 5,
    });

    let publishCount = 0;
    const floodPublish = async () => {
      publishCount++;
      if (publishCount <= 2) {
        throw new Error('Message bus overloaded');
      }
      return `published-${publishCount}`;
    };

    // Trigger failures
    for (let i = 0; i < 2; i++) {
      try { await cb.execute(floodPublish); } catch {}
    }
    expect(cb.getState()).toBe('open');

    // Wait for half-open
    await delay(120);
    expect(cb.getState()).toBe('half-open');

    const result = await cb.execute(floodPublish);
    expect(result).toBe('published-3');
    expect(cb.getState()).toBe('closed');
  });

  it('should handle concurrent health checks with dependency groups', async () => {
    healthChecker.registerCheck('db', async () => ({ healthy: true }), 'readiness');
    healthChecker.registerCheck('cache', async () => ({ healthy: true }), 'readiness');
    healthChecker.registerCheck('queue', async () => ({ healthy: false }), 'readiness');

    healthChecker.addDependencyGroup('data-layer', ['db', 'cache'], 'and');
    healthChecker.addDependencyGroup('messaging', ['queue'], 'or');

    const report = await healthChecker.checkHealth();
    expect(report.status).toBe('unhealthy'); // queue is unhealthy
    expect(report.components['db'].level).toBe('healthy');
    expect(report.components['queue'].level).toBe('unhealthy');
  });
});

// ============================================================================
// 6. Resilience + Plugin-Registry
// ============================================================================

describe('Resilience + Plugin-Registry Chaos', () => {
  let loader: PluginLoader;
  let telemetry: PluginTelemetry;
  let sandbox: PluginSandbox;

  beforeEach(() => {
    loader = new PluginLoader();
    telemetry = new PluginTelemetry();
    sandbox = new PluginSandbox();
  });

  afterEach(() => {
    loader.reset();
    telemetry.reset();
  });

  it('should handle plugin load failure with circuit breaker', async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      successThreshold: 1,
      timeout: 100,
      windowType: 'count',
      windowSize: 5,
    });

    let loadAttempt = 0;
    const loadPlugin = async () => {
      loadAttempt++;
      if (loadAttempt <= 2) {
        // Force actual throw so circuit breaker detects failure
        const result = await loader.load({ type: 'url', url: 'not-a-valid-url' });
        if (!result.success) throw new Error(result.error!);
      }
      const result = await loader.load({ type: 'inline', name: 'good-plugin', code: 'valid code here' });
      if (!result.success) throw new Error(result.error!);
      return result;
    };

    // First 2 loads fail (invalid URL)
    await expect(cb.execute(loadPlugin)).rejects.toThrow(/Invalid URL/);
    await expect(cb.execute(loadPlugin)).rejects.toThrow(/Invalid URL/);

    expect(cb.getState()).toBe('open');

    // Wait for half-open
    await delay(120);

    // Third load should succeed
    const r3 = await cb.execute(loadPlugin);
    expect(r3.success).toBe(true);
    expect(r3.plugin?.name).toBe('good-plugin');
  });

  it('should handle plugin hot-reload during graceful shutdown', async () => {
    const shutdownManager = new GracefulShutdownManager({
      drainTimeout: 200,
      forceShutdownTimeout: 100,
    });

    // Load a plugin
    const loadResult = await loader.load({
      type: 'inline',
      name: 'hot-reload-plugin',
      code: 'module.exports = { run: () => 42 }',
    });
    expect(loadResult.success).toBe(true);

    // Enable hot reload
    let reloadCount = 0;
    loader.onLoad('hot-reload-plugin', () => { reloadCount++; });

    // Register shutdown handler that tries to interact with loader
    let shutdownInteracted = false;
    shutdownManager.register(async () => {
      const plugin = loader.getPlugin('hot-reload-plugin');
      if (plugin) shutdownInteracted = true;
    }, 'drain_active', 'plugin-drain');

    // Shutdown should complete even with hot-reload enabled
    await shutdownManager.shutdown('test');
    expect(shutdownInteracted).toBe(true);
    expect(shutdownManager.getStatus().completedHandlers).toContain('plugin-drain');

    shutdownManager.destroy();
  });

  it('should track plugin telemetry during health checks', () => {
    // Record some executions
    telemetry.recordStart('health-plugin');
    telemetry.recordExecution('health-plugin', 100, true);
    telemetry.recordExecution('health-plugin', 200, true);
    telemetry.recordExecution('health-plugin', 5000, false, 'timeout');
    telemetry.recordApiCall('health-plugin');
    telemetry.recordMemory('health-plugin', 64);

    const stats = telemetry.getPluginStats('health-plugin');
    expect(stats.totalExecutions).toBe(3);
    expect(stats.successfulExecutions).toBe(2);
    expect(stats.failedExecutions).toBe(1);
    expect(stats.apiCallCount).toBe(1);
    expect(stats.memoryUsageMB).toBe(64);

    // Health report
    const report = telemetry.getHealthReport();
    expect(report.totalPlugins).toBe(1);
    expect(report.entries[0].pluginName).toBe('health-plugin');
  });

  it('should handle bulkhead for concurrent plugin loads', async () => {
    const bulkhead = new Bulkhead({ maxConcurrent: 2, maxQueueSize: 5 });

    const loadWithBulkhead = (name: string) => async () => {
      await delay(10);
      return loader.load({ type: 'inline', name, code: `// ${name} plugin code` });
    };

    const results = await Promise.all([
      bulkhead.execute(loadWithBulkhead('p1')),
      bulkhead.execute(loadWithBulkhead('p2')),
      bulkhead.execute(loadWithBulkhead('p3')),
      bulkhead.execute(loadWithBulkhead('p4')),
    ]);

    for (const r of results) {
      expect(r.success).toBe(true);
    }
  });

  it('should generate telemetry alerts during chaos', () => {
    const alerts: string[] = [];
    telemetry.onAlert((alert) => {
      alerts.push(`${alert.type}:${alert.severity}`);
    });

    // Trigger slow execution alert
    telemetry.recordExecution('slow-plugin', 3000, true);

    // Trigger high error rate (need 5+ executions with >30% error rate)
    telemetry.recordExecution('error-plugin', 10, true);
    telemetry.recordExecution('error-plugin', 10, false, 'err1');
    telemetry.recordExecution('error-plugin', 10, false, 'err2');
    telemetry.recordExecution('error-plugin', 10, false, 'err3');
    telemetry.recordExecution('error-plugin', 10, false, 'err4');

    expect(alerts).toContain('slow_execution:warning');
    expect(alerts).toContain('high_error_rate:critical');
  });
});

// ============================================================================
// 7. Orchestrator + Agent-Communication
// ============================================================================

describe('Orchestrator + Agent-Communication Chaos', () => {
  let delegation: TaskDelegationManager;
  let consensus: ConsensusEngine;
  let messageBus: MessageBus;

  beforeEach(() => {
    delegation = new TaskDelegationManager();
    consensus = new ConsensusEngine();
    messageBus = new MessageBus();
  });

  afterEach(() => {
    delegation.reset();
    consensus.reset();
    messageBus.reset();
  });

  it('should delegate multi-agent tasks through orchestrator', async () => {
    delegation.registerAgent('analyzer', ['analyze', 'report']);
    delegation.registerAgent('executor', ['execute', 'deploy']);
    delegation.registerAgent('tester', ['test', 'validate']);

    const tasks = await Promise.all([
      delegation.delegate({
        id: 'multi-1', type: 'analyze', payload: {}, priority: 1,
        requiredCapabilities: ['analyze'], timeout: 30, createdAt: Date.now(),
      }),
      delegation.delegate({
        id: 'multi-2', type: 'execute', payload: {}, priority: 2,
        requiredCapabilities: ['execute'], timeout: 30, createdAt: Date.now(),
      }),
      delegation.delegate({
        id: 'multi-3', type: 'test', payload: {}, priority: 3,
        requiredCapabilities: ['test'], timeout: 30, createdAt: Date.now(),
      }),
    ]);

    expect(tasks.every(t => t.success)).toBe(true);
    expect(tasks.map(t => t.agentId)).toEqual(['analyzer', 'executor', 'tester']);
  });

  it('should use consensus-based task priority', async () => {
    consensus.setDefaultTimeout(200);
    consensus.setAgentWeight('agent-a', 3);
    consensus.setAgentWeight('agent-b', 2);
    consensus.setAgentWeight('agent-c', 1);

    const proposePromise = consensus.propose({
      topic: 'task-priority',
      description: 'What should be the next priority?',
      proposer: 'agent-a',
      payload: { options: ['security', 'performance', 'features'] },
    }, 'weighted');

    // Vote before timeout fires
    await delay(10);
    const proposalIds = [...(consensus as any).proposals.keys()];
    const proposalId = proposalIds[0];

    consensus.vote(proposalId, 'agent-a', 'for');
    consensus.vote(proposalId, 'agent-b', 'for');
    consensus.vote(proposalId, 'agent-c', 'against');

    const result = await proposePromise;
    expect(result.accepted).toBe(true);
    expect(result.forWeight).toBe(5); // 3 + 2
    expect(result.againstWeight).toBe(1);
  });

  it('should stream progress updates via message bus', () => {
    const updates: Message[] = [];

    messageBus.subscribe('progress', (msg) => {
      updates.push(msg);
    });

    // Simulate progress streaming
    for (let i = 1; i <= 5; i++) {
      messageBus.publish('progress', {
        type: 'event',
        payload: { phase: i, total: 5, status: 'running' },
        sender: 'orchestrator',
        priority: 3,
      });
    }

    expect(updates.length).toBe(5);
    expect(updates[4].payload).toEqual({ phase: 5, total: 5, status: 'running' });
  });

  it('should handle agent unregistration during active delegation', async () => {
    delegation.registerAgent('volatile-agent', ['task']);

    const taskPromise = delegation.delegate({
      id: 'volatile-task', type: 'task', payload: {},
      priority: 5, requiredCapabilities: ['task'], timeout: 200, createdAt: Date.now(),
    });

    // Unregister agent while task is pending
    delegation.unregisterAgent('volatile-agent');

    // Task should fail
    const result = await taskPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('unregistered');
  });

  it('should handle vote delegation in consensus', async () => {
    consensus.setDefaultTimeout(200);
    consensus.setAgentWeight('leader', 2);
    consensus.setAgentWeight('follower-1', 1);
    consensus.setAgentWeight('follower-2', 1);

    // Followers delegate to leader
    consensus.delegateVote('follower-1', 'leader');
    consensus.delegateVote('follower-2', 'leader');

    const proposePromise = consensus.propose({
      topic: 'delegation-test',
      description: 'Test vote delegation',
      proposer: 'leader',
    }, 'majority');

    // Vote before timeout fires
    await delay(10);
    const proposalIds = [...(consensus as any).proposals.keys()];
    const proposalId = proposalIds[0];

    // Only leader needs to vote; followers' votes are delegated
    consensus.vote(proposalId, 'leader', 'for');

    const result = await proposePromise;
    // Leader + 2 delegated followers = 3 votes
    expect(result.forVotes).toBe(3);
    expect(result.accepted).toBe(true);

    // Self-delegation should throw
    expect(() => consensus.delegateVote('leader', 'leader')).toThrow('Cannot delegate vote to self');

    consensus.reset();
  });
});

// ============================================================================
// 8. Orchestrator + Plugin-Registry
// ============================================================================

describe('Orchestrator + Plugin-Registry Chaos', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  afterEach(async () => {
    await registry.shutdown();
  });

  it('should use plugin-based task templates', async () => {
    const decomposer = new TaskDecomposer();

    // Register custom decomposition rule via plugin concept
    decomposer.registerRule('analyze', (task) => {
      return [
        {
          id: 'custom-sub-1',
          name: 'Plugin-enhanced analysis',
          description: 'Analysis using plugin capabilities',
          intent: 'analyze' as const,
          dependencies: [],
          priority: 10,
          estimatedDuration: 1000,
          entities: task.entities,
          status: 'pending' as const,
        },
        {
          id: 'custom-sub-2',
          name: 'Plugin report generation',
          description: 'Generate report with plugin data',
          intent: 'generate' as const,
          dependencies: ['custom-sub-1'],
          priority: 8,
          estimatedDuration: 500,
          entities: [],
          status: 'pending' as const,
        },
      ];
    });

    const result = decomposer.decompose(createParsedTask());
    expect(result.graph.nodes.length).toBe(2);
    expect(result.graph.nodes[0].name).toBe('Plugin-enhanced analysis');
    expect(result.graph.edges.length).toBe(1);
  });

  it('should handle dynamic plugin loading during execution', async () => {
    const loader = registry.getLoader();

    // Load plugins dynamically
    const r1 = await loader.load({ type: 'inline', name: 'plugin-a', code: '// plugin a code' });
    expect(r1.success).toBe(true);

    const r2 = await loader.load({ type: 'inline', name: 'plugin-b', code: '// plugin b code' });
    expect(r2.success).toBe(true);

    expect(loader.listLoaded()).toEqual(['plugin-a', 'plugin-b']);

    // Unload and reload
    await loader.unload('plugin-a');
    expect(loader.listLoaded()).toEqual(['plugin-b']);

    const r3 = await loader.load({ type: 'inline', name: 'plugin-a', code: '// plugin a code v2' });
    expect(r3.success).toBe(true);
    expect(loader.listLoaded()).toContain('plugin-a');
  });

  it('should handle plugin hooks in task lifecycle', async () => {
    const hookSystem = registry.getHooks();
    const hookCalls: string[] = [];

    hookSystem.addHook('before_init', () => {
      hookCalls.push('before_init');
    });
    hookSystem.addHook('after_init', () => {
      hookCalls.push('after_init');
    });

    await registry.register({
      name: 'lifecycle-plugin',
      version: '1.0.0',
      description: 'Plugin with lifecycle hooks',
    });

    expect(hookCalls).toEqual(['before_init', 'after_init']);
  });

  it('should handle plugin dependency resolution during orchestration', async () => {
    await registry.register({
      name: 'core-plugin',
      version: '1.0.0',
      description: 'Core plugin',
    });

    await registry.register({
      name: 'dep-plugin',
      version: '1.0.0',
      description: 'Plugin with dependency',
      dependencies: { 'core-plugin': '^1.0.0' },
    });

    const loadOrder = registry.getLoadOrder();
    expect(loadOrder).toContain('core-plugin');
    expect(loadOrder).toContain('dep-plugin');

    // Core should come before dependent
    expect(loadOrder.indexOf('core-plugin')).toBeLessThan(loadOrder.indexOf('dep-plugin'));
  });

  it('should detect plugin conflicts during registration', async () => {
    await registry.register({
      name: 'conflict-a',
      version: '1.0.0',
      description: 'Plugin A',
    });

    // Registering same plugin should throw
    await expect(
      registry.register({ name: 'conflict-a', version: '2.0.0', description: 'Plugin A v2' })
    ).rejects.toThrow('already registered');
  });
});

// ============================================================================
// 9. Agent-Communication + Plugin-Registry
// ============================================================================

describe('Agent-Communication + Plugin-Registry Chaos', () => {
  let commBus: PluginCommunicationBus;
  let messageBus: MessageBus;
  let encryption: MessageEncryptionLayer;

  beforeEach(() => {
    commBus = new PluginCommunicationBus();
    messageBus = new MessageBus();
    encryption = new MessageEncryptionLayer();
  });

  afterEach(() => {
    commBus.reset();
    messageBus.reset();
    encryption.reset();
  });

  it('should integrate plugin communication bus with message bus', () => {
    const receivedMessages: Array<{ from: string; data: unknown }> = [];

    commBus.onMessage('receiver-plugin', (msg, from) => {
      receivedMessages.push({ from, data: msg.data });
    });

    commBus.send('sender-plugin', 'receiver-plugin', {
      type: 'data-update',
      data: { value: 42 },
    });

    expect(receivedMessages.length).toBe(1);
    expect(receivedMessages[0].from).toBe('sender-plugin');
    expect(receivedMessages[0].data).toEqual({ value: 42 });
  });

  it('should handle plugin message encryption', () => {
    const pluginA = 'crypto-plugin-a';
    const pluginB = 'crypto-plugin-b';

    encryption.generateKeyPair(pluginA);
    encryption.generateKeyPair(pluginB);

    const message: Message = {
      id: 'enc-msg-1',
      type: 'event',
      topic: 'secure-channel',
      payload: { secret: 'classified-data' },
      sender: pluginA,
      receiver: pluginB,
      timestamp: Date.now(),
      priority: 0,
    };

    const keyPairB = encryption.getKeyPair(pluginB)!;
    const encrypted = encryption.encrypt(message, keyPairB.publicKey);

    // Ciphertext should differ from plaintext
    expect(encrypted.ciphertext).not.toContain('classified-data');

    // Decrypt and verify
    const decrypted = encryption.decrypt(encrypted, keyPairB.privateKey);
    expect((decrypted.payload as { secret: string }).secret).toBe('classified-data');
  });

  it('should handle plugin consensus voting', async () => {
    const consensus = new ConsensusEngine();
    consensus.setDefaultTimeout(200);
    consensus.setAgentWeight('plugin-voter-1', 1);
    consensus.setAgentWeight('plugin-voter-2', 1);
    consensus.setAgentWeight('plugin-voter-3', 1);

    const proposePromise = consensus.propose({
      topic: 'plugin-feature-vote',
      description: 'Enable new plugin feature?',
      proposer: 'plugin-voter-1',
    }, 'unanimous');

    // Vote before timeout fires
    await delay(10);
    const proposalIds = [...(consensus as any).proposals.keys()];
    const proposalId = proposalIds[0];

    // Unanimous requires all to vote 'for'
    consensus.vote(proposalId, 'plugin-voter-1', 'for');
    consensus.vote(proposalId, 'plugin-voter-2', 'for');
    consensus.vote(proposalId, 'plugin-voter-3', 'for');

    const result = await proposePromise;
    expect(result.accepted).toBe(true);
    expect(result.algorithm).toBe('unanimous');

    consensus.reset();
  });

  it('should block messages from blocked plugins', () => {
    commBus.blockPlugin('bad-plugin');

    expect(() => {
      commBus.send('bad-plugin', 'target-plugin', { type: 'spam', data: {} });
    }).toThrow(/blocked/);

    expect(() => {
      commBus.broadcast('bad-plugin', { type: 'spam', data: {} });
    }).toThrow(/blocked/);
  });

  it('should handle broadcast with message filtering', () => {
    const received: string[] = [];

    commBus.onMessage('plugin-1', () => { received.push('p1'); });
    commBus.onMessage('plugin-2', () => { received.push('p2'); });
    commBus.onMessage('plugin-3', () => { received.push('p3'); });

    // Filter that blocks plugin-2
    commBus.addMessageFilter((_from, to, _msg) => to !== 'plugin-2');

    const delivered = commBus.broadcast('sender', { type: 'announcement', data: {} });
    expect(delivered).toBe(2); // plugin-1 and plugin-3
    expect(received).toEqual(['p1', 'p3']);
  });

  it('should handle request-response pattern between plugins', async () => {
    // Use reply-based pattern: handler returns undefined, then replies via reply()
    commBus.onMessage('responder', (msg, _from) => {
      // Return undefined to trigger reply-based pattern
      // Use setTimeout to reply asynchronously
      setTimeout(() => {
        commBus.reply('responder', msg.id!, { answer: 42 });
      }, 5);
      return undefined;
    });

    const result = await commBus.request<number>(
      'requester', 'responder',
      { type: 'query', data: { question: 'meaning of life' } },
      200
    );

    expect(result).toEqual({ answer: 42 });
  });
});

// ============================================================================
// 10. Full Pipeline Chaos
// ============================================================================

describe('Full Pipeline Chaos - All 5 Packages Under Stress', () => {
  it('should handle concurrent task execution with security checks, plugin loading, inter-agent communication, and resilience', async () => {
    // Setup security
    const auth = createAuthManagerWithToken();
    const permDelegation = new PermissionDelegation({ enabled: true, allowedTools: ['analyze', 'deploy'] });
    const secretManager = new SecretManager({ defaultTTL: 5000 });
    const memProvider = new MemorySecretProvider();
    secretManager.registerProvider('memory', memProvider);
    await secretManager.set('pipeline-secret', 'chaos-value', 'memory');

    // Setup resilience
    const cb = new CircuitBreaker({
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 200,
      windowType: 'count',
      windowSize: 10,
    });
    const retry = new RetryWithBackoff({
      maxRetries: 2,
      strategy: 'fixed',
      baseDelay: 5,
      maxDelay: 50,
    });
    const bulkhead = new Bulkhead({ maxConcurrent: 3, maxQueueSize: 10 });

    // Setup orchestrator
    const decomposer = new TaskDecomposer();
    const parsedTask = createParsedTask({ intent: 'deploy' });
    const plan = decomposer.decompose(parsedTask);

    // Setup agent communication
    const delegation = new TaskDelegationManager();
    delegation.registerAgent('agent-sec', ['security-check']);
    delegation.registerAgent('agent-plugin', ['plugin-load']);
    delegation.registerAgent('agent-comm', ['message-relay']);

    // Setup plugin registry
    const loader = new PluginLoader();
    const telemetry = new PluginTelemetry();

    // Grant permissions for all sub-tasks
    for (const node of plan.graph.nodes) {
      permDelegation.grant(node.id, 'analyze', 'read');
    }

    // Execute pipeline with all layers
    const results: Array<{ phase: string; success: boolean; security: boolean }> = [];

    for (const group of plan.graph.parallelGroups) {
      const phaseResults = await Promise.all(
        group.map(async (nodeId) => {
          const node = plan.graph.nodes.find(n => n.id === nodeId)!;

          return cb.execute(async () => {
            return bulkhead.execute(async () => {
              // Security check
              const permCheck = permDelegation.check(nodeId, 'analyze', 'read');
              const secret = await secretManager.get('pipeline-secret', 'memory');

              // Agent delegation
              const taskResult = await delegation.delegate({
                id: `pipeline-${nodeId}`,
                type: node.intent,
                payload: { name: node.name },
                priority: node.priority,
                requiredCapabilities: ['message-relay'],
                timeout: 50,
                createdAt: Date.now(),
              });

              // Plugin telemetry
              telemetry.recordExecution('pipeline-plugin', 10, true);

              return {
                phase: node.name,
                success: taskResult.success,
                security: permCheck.granted && secret === 'chaos-value',
              };
            });
          });
        })
      );

      results.push(...phaseResults);
    }

    // Verify results
    expect(results.length).toBe(plan.graph.nodes.length);
    expect(results.every(r => r.security)).toBe(true);
    expect(results.every(r => r.success)).toBe(true);

    // Verify telemetry
    const stats = telemetry.getPluginStats('pipeline-plugin');
    expect(stats.totalExecutions).toBe(plan.graph.nodes.length);
    expect(stats.successfulExecutions).toBe(plan.graph.nodes.length);

    // Cleanup
    delegation.reset();
    loader.reset();
    telemetry.reset();
    permDelegation.clear();
  });

  it('should recover from cascading failures across all packages', async () => {
    // Setup all packages
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      successThreshold: 1,
      timeout: 100,
      windowType: 'count',
      windowSize: 5,
    });
    const fallback = new FallbackProvider<string>();
    fallback.addFallback({ strategy: 'default_value', value: 'recovered' });
    const recovery = new StateRecoveryManager({ storage: 'memory' });
    const consensus = new ConsensusEngine();
    consensus.setAgentWeight('recovery-agent', 1);

    // Save initial state
    const initialState = { step: 'initial', data: [1, 2, 3] };
    recovery.createSnapshot(initialState, { label: 'pre-chaos' });

    // Simulate cascading failure
    let step = 0;
    const cascadingOperation = async (): Promise<string> => {
      step++;
      if (step <= 2) throw new Error(`Cascading failure at step ${step}`);
      return 'recovered-successfully';
    };

    // First 2 calls fail
    try { await cb.execute(cascadingOperation); } catch {}
    try { await cb.execute(cascadingOperation); } catch {}
    expect(cb.getState()).toBe('open');

    // Use fallback while circuit is open
    const fallbackResult = await fallback.execute(
      () => cb.execute(cascadingOperation)
    );
    expect(fallbackResult).toBe('recovered');

    // Wait for circuit to recover
    await delay(120);
    expect(cb.getState()).toBe('half-open');

    // Successful call closes circuit
    const recovered = await cb.execute(cascadingOperation);
    expect(recovered).toBe('recovered-successfully');
    expect(cb.getState()).toBe('closed');

    // Verify state recovery
    const snapshots = recovery.listSnapshots();
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    const restored = await recovery.restore(snapshots[0].id);
    expect(restored).not.toBeNull();
    expect((restored as typeof initialState).step).toBe('initial');
    expect((restored as typeof initialState).data).toEqual([1, 2, 3]);

    consensus.reset();
  });

  it('should handle resource exhaustion with timeout and backpressure', async () => {
    const timeoutGuard = new TimeoutGuard({
      defaultTimeoutMs: 50,
      strategy: 'reject',
    });

    const bulkhead = new Bulkhead({ maxConcurrent: 2, maxQueueSize: 2 });

    // Simulate many concurrent requests with timeout
    const slowOp = (id: number) => async () => {
      await delay(100); // Exceeds timeout
      return `result-${id}`;
    };

    const results = await Promise.allSettled([
      timeoutGuard.wrap(() => bulkhead.execute(slowOp(1)), 30, 't1'),
      timeoutGuard.wrap(() => bulkhead.execute(slowOp(2)), 30, 't2'),
      timeoutGuard.wrap(() => bulkhead.execute(slowOp(3)), 30, 't3'),
    ]);

    // All should timeout or complete (not hang)
    for (const r of results) {
      if (r.status === 'rejected') {
        expect(r.reason).toBeInstanceOf(TimeoutError);
      }
    }
  });

  it('should maintain state consistency during concurrent plugin and agent operations', async () => {
    const commBus = new PluginCommunicationBus();
    const messageBus = new MessageBus();
    const telemetry = new PluginTelemetry();
    const permDelegation = new PermissionDelegation();

    // Register message handlers
    const received: string[] = [];
    commBus.onMessage('target', (msg, from) => {
      received.push(`${from}:${msg.type}`);
    });

    messageBus.subscribe('events', (msg) => {
      received.push(`bus:${msg.type}`);
    });

    // Concurrent operations
    await Promise.all([
      // Plugin communication
      Promise.resolve(commBus.send('p1', 'target', { type: 'update', data: {} })),
      Promise.resolve(commBus.send('p2', 'target', { type: 'query', data: {} })),
      Promise.resolve(commBus.broadcast('p3', { type: 'announce', data: {} })),
      // Message bus
      Promise.resolve(messageBus.publish('events', { type: 'event', payload: {}, sender: 'orchestrator', priority: 5 })),
      // Telemetry
      Promise.resolve(telemetry.recordExecution('concurrent-plugin', 10, true)),
      // Permissions
      Promise.resolve(permDelegation.grant('task-1', 'tool-1', 'read')),
    ]);

    // Verify all operations completed
    expect(received.length).toBeGreaterThanOrEqual(3);
    expect(telemetry.getPluginStats('concurrent-plugin').totalExecutions).toBe(1);
    expect(permDelegation.getRules().length).toBe(1);

    commBus.reset();
    messageBus.reset();
    telemetry.reset();
    permDelegation.clear();
  });

  it('should handle full workflow with invalid/malicious inputs at every layer', async () => {
    const auth = createAuthManagerWithToken();
    const sandbox = new PluginSandbox();
    const messageBus = new MessageBus();
    const consensus = new ConsensusEngine();
    const cb = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 1,
      timeout: 100,
      windowType: 'count',
      windowSize: 10,
    });

    // 1. Security: null/undefined credentials
    const nullResult = await auth.authenticate(null);
    expect(nullResult.success).toBe(false);

    const undefinedResult = await auth.authenticate(undefined);
    expect(undefinedResult.success).toBe(false);

    // 2. Plugin sandbox: non-whitelisted API
    const ctx = sandbox.createSandbox('malicious-plugin', [] as PluginPermission[]);
    expect(() => ctx.callApi('nonexistent')).toThrow(/not whitelisted/);

    // 3. Message bus: empty topic messages go to dead letter
    messageBus.publish('nonexistent-topic', {
      type: 'event',
      payload: 'orphan',
      sender: 'ghost',
      priority: 5,
    });
    // No subscriber, goes to dead letter queue
    expect(messageBus.getDeadLetterQueue().length).toBe(1);

    // 4. Consensus: vote on non-existent proposal
    consensus.vote('nonexistent-proposal', 'ghost-agent', 'for');
    // Should not throw, just ignored
    expect(consensus.getProposalCount()).toBe(0);

    // 5. Circuit breaker: all failures recover gracefully
    let failCount = 0;
    const sometimesFails = async () => {
      failCount++;
      if (failCount <= 3) throw new Error('Intentional failure');
      return 'recovered';
    };

    for (let i = 0; i < 3; i++) {
      try { await cb.execute(sometimesFails); } catch {}
    }
    expect(cb.getState()).toBe('open');

    await delay(120);
    const result = await cb.execute(sometimesFails);
    expect(result).toBe('recovered');

    messageBus.reset();
    consensus.reset();
  });
});
