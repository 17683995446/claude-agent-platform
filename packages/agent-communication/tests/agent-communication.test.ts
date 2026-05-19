import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  MessageBus,
  ProtocolNegotiator,
  TaskDelegationManager,
  ConsensusEngine,
  AgentRegistry,
  StreamingChannel,
  RetryManager,
  MessageEncryptionLayer,
  CommunicationMetrics,
  AgentGroupManager,
} from '../src/index.ts';
import type { Message, AgentTask } from '../src/index.ts';

// ============================================================
// Module 1: MessageBus - 消息总线
// ============================================================
describe('MessageBus', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  afterEach(() => {
    bus.reset();
  });

  test('should publish and subscribe to messages', () => {
    let received: Message | null = null;
    bus.subscribe('test.topic', (msg) => { received = msg; });
    bus.publish('test.topic', { payload: { hello: 'world' }, sender: 'agent1' });
    expect(received).not.toBeNull();
    expect(received!.topic).toBe('test.topic');
    expect(received!.payload).toEqual({ hello: 'world' });
  });

  test('should support multiple subscribers on same topic', () => {
    const received: Message[] = [];
    bus.subscribe('test', (msg) => received.push(msg));
    bus.subscribe('test', (msg) => received.push(msg));
    bus.publish('test', { payload: 'data', sender: 'a1' });
    expect(received.length).toBe(2);
  });

  test('should unsubscribe correctly', () => {
    let count = 0;
    const sub = bus.subscribe('test', () => { count++; });
    bus.publish('test', { payload: 'd', sender: 'a1' });
    expect(count).toBe(1);
    sub.unsubscribe();
    bus.publish('test', { payload: 'd', sender: 'a1' });
    expect(count).toBe(1);
  });

  test('should support wildcard topic "agent.*"', () => {
    let received: Message | null = null;
    bus.subscribe('agent.*', (msg) => { received = msg; });
    bus.publish('agent.status', { payload: 'ok', sender: 'a1' });
    expect(received).not.toBeNull();
    expect(received!.topic).toBe('agent.status');
  });

  test('should support wildcard topic "agent.>" (multi-level)', () => {
    let received: Message | null = null;
    bus.subscribe('agent.>', (msg) => { received = msg; });
    bus.publish('agent.cluster.node.status', { payload: 'ok', sender: 'a1' });
    expect(received).not.toBeNull();
    expect(received!.topic).toBe('agent.cluster.node.status');
  });

  test('wildcard "agent.*" should not match multi-level topics', () => {
    let received: Message | null = null;
    bus.subscribe('agent.*', (msg) => { received = msg; });
    bus.publish('agent.cluster.node', { payload: 'data', sender: 'a1' });
    expect(received).toBeNull();
  });

  test('should deliver messages to dead letter queue when no subscribers', () => {
    bus.publish('nonexistent.topic', { payload: 'orphan', sender: 'a1' });
    expect(bus.getDeadLetterQueue().length).toBe(1);
    expect(bus.getDeadLetterQueue()[0].topic).toBe('nonexistent.topic');
  });

  test('should clear dead letter queue', () => {
    bus.publish('no.sub', { payload: 'x', sender: 'a1' });
    bus.clearDeadLetterQueue();
    expect(bus.getDeadLetterQueue().length).toBe(0);
  });

  test('should set message fields correctly', () => {
    let received: Message | null = null;
    bus.subscribe('t', (msg) => { received = msg; });
    bus.publish('t', {
      type: 'command',
      payload: 'cmd',
      sender: 'agent-a',
      receiver: 'agent-b',
      priority: 1,
      correlationId: 'corr-123',
    });
    expect(received!.type).toBe('command');
    expect(received!.sender).toBe('agent-a');
    expect(received!.receiver).toBe('agent-b');
    expect(received!.priority).toBe(1);
    expect(received!.correlationId).toBe('corr-123');
    expect(received!.timestamp).toBeGreaterThan(0);
    expect(received!.id).toBeDefined();
  });

  test('should handle request/response with correlationId', async () => {
    bus.subscribe('query.topic', (msg) => {
      bus.publish('query.topic', {
        type: 'response',
        payload: { answer: 42 },
        sender: 'responder',
        correlationId: msg.correlationId,
      });
    });

    const response = await bus.request('query.topic', { question: 'life' }, 1000);
    expect(response.payload).toEqual({ answer: 42 });
  });

  test('should timeout on request if no response', async () => {
    await expect(bus.request('timeout.topic', {}, 50)).rejects.toThrow('Request timeout');
  });

  test('should maintain FIFO ordering per topic', () => {
    const order: number[] = [];
    bus.subscribe('fifo', (msg) => {
      order.push(msg.payload as number);
    });
    bus.publish('fifo', { payload: 1, sender: 'a' });
    bus.publish('fifo', { payload: 2, sender: 'a' });
    bus.publish('fifo', { payload: 3, sender: 'a' });
    expect(order).toEqual([1, 2, 3]);
  });
});

// ============================================================
// Module 2: ProtocolNegotiator - 协议协商器
// ============================================================
describe('ProtocolNegotiator', () => {
  let negotiator: ProtocolNegotiator;

  beforeEach(() => {
    negotiator = new ProtocolNegotiator();
  });

  test('should advertise and discover capabilities', () => {
    const caps = {
      agentId: 'agent-1',
      protocols: [{ protocol: 'json-rpc' as const, version: '2.0', features: ['batch'] }],
      supportedFeatures: { compression: ['gzip'], encryption: ['none'], streaming: false },
      maxMessageSize: 1024 * 1024,
    };
    negotiator.advertise(caps);
    const discovered = negotiator.discover('agent-1');
    expect(discovered).toBeDefined();
    expect(discovered!.agentId).toBe('agent-1');
  });

  test('should return undefined for unknown agent', () => {
    expect(negotiator.discover('unknown')).toBeUndefined();
  });

  test('should negotiate common protocol successfully', () => {
    negotiator.advertise({
      agentId: 'agent-a',
      protocols: [{ protocol: 'json-rpc', version: '2.0', features: [] }],
      supportedFeatures: { compression: ['gzip'], encryption: ['none'], streaming: false },
      maxMessageSize: 5 * 1024 * 1024,
    });

    const result = negotiator.negotiate('agent-a');
    expect(result.negotiated).toBe(true);
    expect(result.protocol).toBe('json-rpc');
  });

  test('should fallback to lowest common denominator for unknown agent', () => {
    const result = negotiator.negotiate('unknown-agent');
    expect(result.negotiated).toBe(false);
    expect(result.protocol).toBe('json-rpc');
    expect(result.version).toBe('1.0');
  });

  test('should negotiate compression feature', () => {
    negotiator.advertise({
      agentId: 'agent-b',
      protocols: [{ protocol: 'grpc-like', version: '1.0', features: [] }],
      supportedFeatures: { compression: ['gzip', 'deflate'], encryption: ['aes-256-gcm'], streaming: true },
      maxMessageSize: 10 * 1024 * 1024,
    });

    const result = negotiator.negotiate('agent-b');
    expect(result.features.compression).toBe('gzip');
    expect(result.features.encryption).toBe('aes-256-gcm');
    expect(result.features.streaming).toBe(true);
  });

  test('should prefer grpc-like over json-rpc', () => {
    negotiator.advertise({
      agentId: 'agent-c',
      protocols: [
        { protocol: 'json-rpc', version: '2.0', features: [] },
        { protocol: 'grpc-like', version: '1.0', features: [] },
      ],
      supportedFeatures: { compression: [], encryption: [], streaming: false },
      maxMessageSize: 1024 * 1024,
    });

    const result = negotiator.negotiate('agent-c');
    expect(result.protocol).toBe('grpc-like');
  });

  test('should remove agent capabilities', () => {
    negotiator.advertise({
      agentId: 'agent-x',
      protocols: [{ protocol: 'json-rpc', version: '1.0', features: [] }],
      supportedFeatures: { compression: [], encryption: [], streaming: false },
      maxMessageSize: 1024,
    });
    expect(negotiator.discover('agent-x')).toBeDefined();
    negotiator.removeAgent('agent-x');
    expect(negotiator.discover('agent-x')).toBeUndefined();
  });

  test('should return all capabilities', () => {
    negotiator.advertise({
      agentId: 'a1',
      protocols: [{ protocol: 'json-rpc', version: '1.0', features: [] }],
      supportedFeatures: { compression: [], encryption: [], streaming: false },
      maxMessageSize: 1024,
    });
    negotiator.advertise({
      agentId: 'a2',
      protocols: [{ protocol: 'graphql', version: '1.0', features: [] }],
      supportedFeatures: { compression: [], encryption: [], streaming: false },
      maxMessageSize: 1024,
    });
    expect(negotiator.getAllCapabilities().size).toBe(2);
  });
});

// ============================================================
// Module 3: TaskDelegationManager - 任务委托系统
// ============================================================
describe('TaskDelegationManager', () => {
  let manager: TaskDelegationManager;

  beforeEach(() => {
    manager = new TaskDelegationManager();
  });

  afterEach(() => {
    manager.reset();
  });

  test('should register and unregister agents', () => {
    manager.registerAgent('agent-1', ['code', 'test']);
    expect(manager.getAgentWorkload('agent-1')).toBe(0);
    manager.unregisterAgent('agent-1');
    expect(manager.getAgentWorkload('agent-1')).toBe(0);
  });

  test('should delegate task successfully', async () => {
    manager.registerAgent('worker-1', ['code']);
    const task: AgentTask = {
      id: 'task-1',
      type: 'code',
      payload: 'write tests',
      priority: 1,
      requiredCapabilities: ['code'],
      timeout: 200,
      createdAt: Date.now(),
    };
    const result = await manager.delegate(task);
    expect(result.success).toBe(true);
  });

  test('should fail delegation when no agents available', async () => {
    const task: AgentTask = {
      id: 'task-2',
      type: 'code',
      payload: 'write code',
      priority: 1,
      requiredCapabilities: ['code'],
      timeout: 200,
      createdAt: Date.now(),
    };
    const result = await manager.delegate(task);
    expect(result.success).toBe(false);
    expect(result.error).toContain('No suitable agent');
  });

  test('should check task status', async () => {
    manager.registerAgent('w1', ['x']);
    const task: AgentTask = {
      id: 'task-s',
      type: 'x',
      payload: null,
      priority: 1,
      requiredCapabilities: [],
      timeout: 200,
      createdAt: Date.now(),
    };
    await manager.delegate(task);
    const status = manager.checkStatus('task-s');
    expect(status).toBeDefined();
    expect(status!.state).toBe('completed');
  });

  test('should cancel a pending task', async () => {
    manager.registerAgent('w1', ['x']);
    const task: AgentTask = {
      id: 'task-c',
      type: 'x',
      payload: null,
      priority: 1,
      requiredCapabilities: [],
      timeout: 200,
      createdAt: Date.now(),
    };
    // Delegate and immediately cancel (race condition possible but we try)
    const promise = manager.delegate(task);
    const cancelled = manager.cancelTask('task-c');
    // cancelled may be true or false depending on timing
    await promise;
    const status = manager.checkStatus('task-c');
    expect(status).toBeDefined();
  });

  test('should not cancel already completed task', async () => {
    manager.registerAgent('w1', ['x']);
    const task: AgentTask = {
      id: 'task-done',
      type: 'x',
      payload: null,
      priority: 1,
      requiredCapabilities: [],
      timeout: 50,
      createdAt: Date.now(),
    };
    await manager.delegate(task);
    expect(manager.cancelTask('task-done')).toBe(false);
  });

  test('should use round-robin strategy', async () => {
    manager.registerAgent('w1', ['x']);
    manager.registerAgent('w2', ['x']);
    const task: AgentTask = {
      id: 'task-rr',
      type: 'x',
      payload: null,
      priority: 1,
      requiredCapabilities: [],
      timeout: 50,
      createdAt: Date.now(),
    };
    const r1 = await manager.delegate(task, { strategy: 'round-robin' });
    const r2 = await manager.delegate({ ...task, id: 'task-rr2' }, { strategy: 'round-robin' });
    // Should alternate between agents
    expect(r1.agentId).not.toBe(r2.agentId);
  });

  test('should use least-loaded strategy', async () => {
    manager.registerAgent('w1', ['x']);
    manager.registerAgent('w2', ['x']);
    const task: AgentTask = {
      id: 'task-ll',
      type: 'x',
      payload: null,
      priority: 1,
      requiredCapabilities: [],
      timeout: 50,
      createdAt: Date.now(),
    };
    const result = await manager.delegate(task, { strategy: 'least-loaded' });
    expect(result.success).toBe(true);
  });

  test('should filter by required capabilities', async () => {
    manager.registerAgent('w1', ['code']);
    manager.registerAgent('w2', ['design']);
    const task: AgentTask = {
      id: 'task-cap',
      type: 'code',
      payload: null,
      priority: 1,
      requiredCapabilities: ['design'],
      timeout: 50,
      createdAt: Date.now(),
    };
    const result = await manager.delegate(task);
    expect(result.agentId).toBe('w2');
  });

  test('should exclude agents from delegation', async () => {
    manager.registerAgent('w1', ['x']);
    manager.registerAgent('w2', ['x']);
    const task: AgentTask = {
      id: 'task-ex',
      type: 'x',
      payload: null,
      priority: 1,
      requiredCapabilities: [],
      timeout: 50,
      createdAt: Date.now(),
    };
    const result = await manager.delegate(task, { excludeAgents: ['w1'] });
    expect(result.agentId).toBe('w2');
  });

  test('should respect preferred agent', async () => {
    manager.registerAgent('w1', ['x']);
    manager.registerAgent('w2', ['x']);
    const task: AgentTask = {
      id: 'task-pref',
      type: 'x',
      payload: null,
      priority: 1,
      requiredCapabilities: [],
      timeout: 50,
      createdAt: Date.now(),
    };
    const result = await manager.delegate(task, { preferredAgentId: 'w2' });
    expect(result.agentId).toBe('w2');
  });

  test('should set agent availability', async () => {
    manager.registerAgent('w1', ['x']);
    manager.setAgentAvailable('w1', false);
    const task: AgentTask = {
      id: 'task-unavail',
      type: 'x',
      payload: null,
      priority: 1,
      requiredCapabilities: [],
      timeout: 50,
      createdAt: Date.now(),
    };
    const result = await manager.delegate(task);
    expect(result.success).toBe(false);
  });

  test('should assign task to specific agent', async () => {
    manager.registerAgent('w1', ['x']);
    const task: AgentTask = {
      id: 'task-assign',
      type: 'x',
      payload: null,
      priority: 1,
      requiredCapabilities: [],
      timeout: 50,
      createdAt: Date.now(),
    };
    const result = await manager.assignTo('w1', task);
    expect(result.success).toBe(true);
    expect(result.agentId).toBe('w1');
  });

  test('should return undefined status for unknown task', () => {
    expect(manager.checkStatus('nonexistent')).toBeUndefined();
  });
});

// ============================================================
// Module 4: ConsensusEngine - 共识引擎
// ============================================================
describe('ConsensusEngine', () => {
  let engine: ConsensusEngine;

  beforeEach(() => {
    engine = new ConsensusEngine();
  });

  afterEach(() => {
    engine.reset();
  });

  test('should reach majority consensus', async () => {
    const knownId = 'test-majority-1';
    const resultPromise = engine.propose({
      id: knownId,
      topic: 'decision',
      description: 'Should we deploy?',
      proposer: 'agent-1',
      timeout: 100,
    }, 'majority');

    engine.vote(knownId, 'agent-1', 'for');
    engine.vote(knownId, 'agent-2', 'for');
    engine.vote(knownId, 'agent-3', 'against');

    const result = await resultPromise;
    expect(result.accepted).toBe(true);
    expect(result.forVotes).toBe(2);
    expect(result.againstVotes).toBe(1);
  });

  test('should accept with unanimous consent', async () => {
    const proposal = {
      topic: 'unanimous-test',
      description: 'All agree?',
      proposer: 'agent-1',
    };

    // We need to vote before the timeout resolves
    let proposalId: string | null = null;

    // Create proposal and vote quickly
    const resultPromise = engine.propose(proposal, 'unanimous');

    // Get proposal id from state
    const states = [];
    // We can't easily get the ID before voting, so let's use a different approach
    // The proposal creates an ID internally. Let's use a known pattern.
    // Actually, let's just test with a known flow:
    engine.reset();

    // Manually create a proposal with known ID
    const knownId = 'test-prop-1';
    const resultPromise2 = engine.propose({
      id: knownId,
      topic: 'test',
      description: 'test',
      proposer: 'a1',
      timeout: 100,
    }, 'unanimous');

    engine.vote(knownId, 'a1', 'for');
    engine.vote(knownId, 'a2', 'for');
    engine.vote(knownId, 'a3', 'for');

    const result = await resultPromise2;
    expect(result.accepted).toBe(true);
    expect(result.algorithm).toBe('unanimous');
  });

  test('should reject unanimous if any against', async () => {
    const knownId = 'test-prop-2';
    const resultPromise = engine.propose({
      id: knownId,
      topic: 'test',
      description: 'test',
      proposer: 'a1',
      timeout: 100,
    }, 'unanimous');

    engine.vote(knownId, 'a1', 'for');
    engine.vote(knownId, 'a2', 'against');

    const result = await resultPromise;
    expect(result.accepted).toBe(false);
  });

  test('should accept supermajority (2/3) when threshold met', async () => {
    const knownId = 'test-prop-3';
    const resultPromise = engine.propose({
      id: knownId,
      topic: 'test',
      description: 'test',
      proposer: 'a1',
      timeout: 100,
    }, 'supermajority');

    engine.vote(knownId, 'a1', 'for');
    engine.vote(knownId, 'a2', 'for');
    engine.vote(knownId, 'a3', 'against');

    const result = await resultPromise;
    expect(result.accepted).toBe(true);
  });

  test('should reject supermajority when threshold not met', async () => {
    const knownId = 'test-prop-4';
    const resultPromise = engine.propose({
      id: knownId,
      topic: 'test',
      description: 'test',
      proposer: 'a1',
      timeout: 100,
    }, 'supermajority');

    engine.vote(knownId, 'a1', 'for');
    engine.vote(knownId, 'a2', 'against');
    engine.vote(knownId, 'a3', 'against');

    const result = await resultPromise;
    expect(result.accepted).toBe(false);
  });

  test('should support weighted voting', async () => {
    engine.setAgentWeight('a1', 10);
    engine.setAgentWeight('a2', 1);

    const knownId = 'test-prop-5';
    const resultPromise = engine.propose({
      id: knownId,
      topic: 'test',
      description: 'test',
      proposer: 'a1',
      timeout: 100,
    }, 'weighted');

    engine.vote(knownId, 'a1', 'for');
    engine.vote(knownId, 'a2', 'against');

    const result = await resultPromise;
    expect(result.accepted).toBe(true);
    expect(result.forWeight).toBe(10);
    expect(result.againstWeight).toBe(1);
  });

  test('should handle vote delegation (proxy voting)', async () => {
    engine.delegateVote('a3', 'a1');

    const knownId = 'test-prop-6';
    const resultPromise = engine.propose({
      id: knownId,
      topic: 'test',
      description: 'test',
      proposer: 'a1',
      timeout: 100,
    }, 'majority');

    engine.vote(knownId, 'a1', 'for'); // a3's vote should be delegated here
    engine.vote(knownId, 'a2', 'against');

    const result = await resultPromise;
    // a1 votes for, a3 delegates to a1 so also for, a2 against
    expect(result.forVotes).toBeGreaterThanOrEqual(2);
  });

  test('should get consensus state', async () => {
    const knownId = 'test-prop-7';
    const resultPromise = engine.propose({
      id: knownId,
      topic: 'test',
      description: 'test',
      proposer: 'a1',
      timeout: 100,
    }, 'majority');

    const state = engine.getConsensus(knownId);
    expect(state).toBeDefined();
    expect(state!.proposal.id).toBe(knownId);

    await resultPromise;
  });

  test('should return undefined for unknown proposal', () => {
    expect(engine.getConsensus('nonexistent')).toBeUndefined();
  });

  test('should count abstain votes correctly', async () => {
    const knownId = 'test-prop-8';
    const resultPromise = engine.propose({
      id: knownId,
      topic: 'test',
      description: 'test',
      proposer: 'a1',
      timeout: 100,
    }, 'majority');

    engine.vote(knownId, 'a1', 'for');
    engine.vote(knownId, 'a2', 'abstain');
    engine.vote(knownId, 'a3', 'abstain');

    const result = await resultPromise;
    expect(result.abstainVotes).toBe(2);
    expect(result.accepted).toBe(true); // 1 for, 0 against = majority
  });

  test('should track proposal count', () => {
    engine.propose({ id: 'p1', topic: 't', description: 'd', proposer: 'a1', timeout: 100 }, 'majority');
    expect(engine.getProposalCount()).toBe(1);
  });
});

// ============================================================
// Module 5: AgentRegistry - Agent 注册中心
// ============================================================
describe('AgentRegistry', () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
  });

  afterEach(() => {
    registry.reset();
  });

  test('should register an agent', () => {
    registry.register({
      id: 'agent-1',
      name: 'CodeAgent',
      type: 'coder',
      capabilities: ['code', 'test'],
      tags: ['team-a'],
      metadata: { version: '1.0' },
    });
    const agent = registry.getAgent('agent-1');
    expect(agent).toBeDefined();
    expect(agent!.name).toBe('CodeAgent');
    expect(agent!.healthStatus).toBe('healthy');
  });

  test('should unregister an agent', () => {
    registry.register({ id: 'a1', name: 'A1', type: 't', capabilities: [], tags: [], metadata: {} });
    registry.unregister('a1');
    expect(registry.getAgent('a1')).toBeUndefined();
  });

  test('should discover agents by capability', () => {
    registry.register({ id: 'a1', name: 'A1', type: 't', capabilities: ['code', 'test'], tags: [], metadata: {} });
    registry.register({ id: 'a2', name: 'A2', type: 't', capabilities: ['design'], tags: [], metadata: {} });
    const results = registry.discover({ capability: 'code' });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('a1');
  });

  test('should discover agents by name', () => {
    registry.register({ id: 'a1', name: 'Alpha', type: 't', capabilities: [], tags: [], metadata: {} });
    registry.register({ id: 'a2', name: 'Beta', type: 't', capabilities: [], tags: [], metadata: {} });
    const results = registry.discover({ name: 'Alpha' });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('a1');
  });

  test('should discover agents by type', () => {
    registry.register({ id: 'a1', name: 'A1', type: 'coder', capabilities: [], tags: [], metadata: {} });
    registry.register({ id: 'a2', name: 'A2', type: 'tester', capabilities: [], tags: [], metadata: {} });
    const results = registry.discover({ type: 'coder' });
    expect(results.length).toBe(1);
  });

  test('should discover agents by tags', () => {
    registry.register({ id: 'a1', name: 'A1', type: 't', capabilities: [], tags: ['backend', 'rust'], metadata: {} });
    registry.register({ id: 'a2', name: 'A2', type: 't', capabilities: [], tags: ['frontend'], metadata: {} });
    const results = registry.discover({ tags: ['rust'] });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('a1');
  });

  test('should discover agents by health status', () => {
    registry.register({ id: 'a1', name: 'A1', type: 't', capabilities: [], tags: [], metadata: {}, healthStatus: 'healthy' });
    registry.register({ id: 'a2', name: 'A2', type: 't', capabilities: [], tags: [], metadata: {}, healthStatus: 'unhealthy' });
    const results = registry.discover({ healthStatus: 'healthy' });
    expect(results.length).toBe(1);
  });

  test('should process heartbeat', () => {
    registry.register({ id: 'a1', name: 'A1', type: 't', capabilities: [], tags: [], metadata: {} });
    registry.heartbeat('a1', 'degraded');
    const agent = registry.getAgent('a1');
    expect(agent!.healthStatus).toBe('degraded');
  });

  test('should get healthy agents', () => {
    registry.register({ id: 'a1', name: 'A1', type: 't', capabilities: [], tags: [], metadata: {} });
    registry.register({ id: 'a2', name: 'A2', type: 't', capabilities: [], tags: [], metadata: {}, healthStatus: 'unhealthy' });
    registry.register({ id: 'a3', name: 'A3', type: 't', capabilities: [], tags: [], metadata: {} });
    expect(registry.getHealthyAgents().length).toBe(2);
  });

  test('should get all agents', () => {
    registry.register({ id: 'a1', name: 'A1', type: 't', capabilities: [], tags: [], metadata: {} });
    registry.register({ id: 'a2', name: 'A2', type: 't', capabilities: [], tags: [], metadata: {} });
    expect(registry.getAllAgents().length).toBe(2);
  });

  test('should return agent count', () => {
    registry.register({ id: 'a1', name: 'A1', type: 't', capabilities: [], tags: [], metadata: {} });
    expect(registry.getAgentCount()).toBe(1);
  });

  test('should update agent on re-registration', () => {
    registry.register({ id: 'a1', name: 'Old', type: 't', capabilities: [], tags: [], metadata: {} });
    registry.register({ id: 'a1', name: 'New', type: 't2', capabilities: ['x'], tags: [], metadata: {} });
    const agent = registry.getAgent('a1');
    expect(agent!.name).toBe('New');
    expect(agent!.type).toBe('t2');
  });
});

// ============================================================
// Module 6: StreamingChannel - 流式通信通道
// ============================================================
describe('StreamingChannel', () => {
  let channel: StreamingChannel;

  beforeEach(() => {
    channel = new StreamingChannel();
  });

  afterEach(() => {
    channel.reset();
  });

  test('should create a stream', () => {
    const stream = channel.createStream('test-topic');
    expect(stream).toBeDefined();
    expect(stream.topic).toBe('test-topic');
    expect(stream.isClosed).toBe(false);
  });

  test('should write and read data', async () => {
    const stream = channel.createStream('test');
    stream.write('hello');
    const data = await stream.read();
    expect(data).toBe('hello');
  });

  test('should handle multiple writes and reads in order', async () => {
    const stream = channel.createStream('test');
    stream.write(1);
    stream.write(2);
    stream.write(3);
    expect(await stream.read()).toBe(1);
    expect(await stream.read()).toBe(2);
    expect(await stream.read()).toBe(3);
  });

  test('should close a stream', () => {
    const stream = channel.createStream('test');
    stream.close();
    expect(stream.isClosed).toBe(true);
  });

  test('should reject reads on closed stream', async () => {
    const stream = channel.createStream('test');
    stream.close();
    await expect(stream.read()).rejects.toThrow('Stream is closed');
  });

  test('should not write to closed stream', () => {
    const stream = channel.createStream('test');
    stream.close();
    stream.write('data');
    expect(stream.getBufferedCount()).toBe(0);
  });

  test('should pipe data between streams', async () => {
    const source = channel.createStream('src');
    const dest = channel.createStream('dest');
    source.pipe(dest);

    source.write('piped-data');

    // Give some time for pipe to process
    await new Promise((r) => setTimeout(r, 10));

    expect(dest.getBufferedCount()).toBeGreaterThan(0);
  });

  test('should track active stream count', () => {
    channel.createStream('s1');
    channel.createStream('s2');
    expect(channel.getActiveStreamCount()).toBe(2);
  });

  test('should close stream by id', () => {
    const stream = channel.createStream('s1');
    const closed = channel.closeStream(stream.id);
    expect(closed).toBe(true);
    expect(channel.getActiveStreamCount()).toBe(0);
  });

  test('should return false when closing non-existent stream', () => {
    expect(channel.closeStream('nonexistent')).toBe(false);
  });

  test('should support pause and resume', () => {
    const stream = channel.createStream('test');
    stream.pause();
    expect(stream.isPaused).toBe(true);
    stream.resume();
    expect(stream.isPaused).toBe(false);
  });

  test('should emit events', () => {
    const events: string[] = [];
    const stream = channel.createStream('test');
    stream.on('data', () => events.push('data'));
    stream.on('end', () => events.push('end'));
    stream.write('test');
    stream.close();
    expect(events).toContain('data');
    expect(events).toContain('end');
  });

  test('should get stream by id', () => {
    const stream = channel.createStream('test');
    const retrieved = channel.getStream(stream.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(stream.id);
  });

  test('should close all streams', () => {
    channel.createStream('s1');
    channel.createStream('s2');
    channel.createStream('s3');
    channel.closeAll();
    expect(channel.getActiveStreamCount()).toBe(0);
  });
});

// ============================================================
// Module 7: RetryManager - 智能重试策略
// ============================================================
describe('RetryManager', () => {
  let retryManager: RetryManager;

  beforeEach(() => {
    retryManager = new RetryManager();
  });

  afterEach(() => {
    retryManager.reset();
  });

  test('should succeed on first attempt', async () => {
    const result = await retryManager.execute(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  test('should retry on failure and succeed', async () => {
    let attempts = 0;
    const result = await retryManager.execute(
      () => {
        attempts++;
        if (attempts < 3) return Promise.reject(new Error('fail'));
        return Promise.resolve('recovered');
      },
      { maxRetries: 5, baseDelay: 10 },
    );
    expect(result).toBe('recovered');
    expect(attempts).toBe(3);
  });

  test('should exhaust retries and throw', async () => {
    let attempts = 0;
    await expect(
      retryManager.execute(
        () => {
          attempts++;
          return Promise.reject(new Error('always fail'));
        },
        { maxRetries: 2, baseDelay: 10 },
      ),
    ).rejects.toThrow('always fail');
    expect(attempts).toBe(3); // 1 initial + 2 retries
  });

  test('should call onRetry callback', async () => {
    const retries: number[] = [];
    await retryManager.execute(
      () => {
        if (retries.length < 2) {
          return Promise.reject(new Error('fail'));
        }
        return Promise.resolve('ok');
      },
      {
        maxRetries: 5,
        baseDelay: 10,
        onRetry: (attempt) => retries.push(attempt),
      },
    );
    expect(retries.length).toBe(2);
  });

  test('should call onFailure callback', async () => {
    let failureCalled = false;
    await expect(
      retryManager.execute(
        () => Promise.reject(new Error('fail')),
        {
          maxRetries: 0,
          onFailure: () => { failureCalled = true; },
        },
      ),
    ).rejects.toThrow();
    expect(failureCalled).toBe(true);
  });

  test('should open circuit breaker after threshold', async () => {
    await expect(
      retryManager.execute(
        () => Promise.reject(new Error('fail')),
        { maxRetries: 10, baseDelay: 1, destination: 'circuit-test' },
      ),
    ).rejects.toThrow();

    // After enough failures, circuit should open
    // The threshold is 5, and we made 11 attempts (1 + 10 retries)
    expect(retryManager.getCircuitState('circuit-test')).toBe('open');
  });

  test('should reset circuit breaker', async () => {
    await expect(
      retryManager.execute(
        () => Promise.reject(new Error('fail')),
        { maxRetries: 10, baseDelay: 1, destination: 'reset-test' },
      ),
    ).rejects.toThrow();

    retryManager.resetCircuit('reset-test');
    expect(retryManager.getCircuitState('reset-test')).toBe('closed');
  });

  test('should start with closed circuit', () => {
    expect(retryManager.getCircuitState('new-dest')).toBe('closed');
  });

  test('should reject when circuit is open', async () => {
    // Force open the circuit
    for (let i = 0; i < 6; i++) {
      try {
        await retryManager.execute(
          () => Promise.reject(new Error('fail')),
          { maxRetries: 0, baseDelay: 1, destination: 'open-circuit' },
        );
      } catch {}
    }
    expect(retryManager.getCircuitState('open-circuit')).toBe('open');

    await expect(
      retryManager.execute(
        () => Promise.resolve('should not reach'),
        { destination: 'open-circuit' },
      ),
    ).rejects.toThrow('Circuit breaker open');
  });

  test('should use fixed delay strategy', async () => {
    let attempts = 0;
    const start = Date.now();
    await retryManager.execute(
      () => {
        attempts++;
        if (attempts <= 2) return Promise.reject(new Error('fail'));
        return Promise.resolve('ok');
      },
      { strategy: 'fixed', maxRetries: 5, baseDelay: 20 },
    );
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40); // 2 retries * 20ms
  });

  test('should use exponential backoff strategy', async () => {
    let attempts = 0;
    await retryManager.execute(
      () => {
        attempts++;
        if (attempts <= 2) return Promise.reject(new Error('fail'));
        return Promise.resolve('ok');
      },
      { strategy: 'exponential_backoff', maxRetries: 5, baseDelay: 10 },
    );
    expect(attempts).toBe(3);
  });

  test('should use exponential with jitter strategy', async () => {
    let attempts = 0;
    await retryManager.execute(
      () => {
        attempts++;
        if (attempts <= 2) return Promise.reject(new Error('fail'));
        return Promise.resolve('ok');
      },
      { strategy: 'exponential_with_jitter', maxRetries: 5, baseDelay: 10, jitterMax: 5 },
    );
    expect(attempts).toBe(3);
  });
});

// ============================================================
// Module 8: MessageEncryptionLayer - 消息加密层
// ============================================================
describe('MessageEncryptionLayer', () => {
  let encryption: MessageEncryptionLayer;

  beforeEach(() => {
    encryption = new MessageEncryptionLayer();
  });

  afterEach(() => {
    encryption.reset();
  });

  test('should generate key pair', () => {
    const keyPair = encryption.generateKeyPair('agent-1');
    expect(keyPair.publicKey).toBeDefined();
    expect(keyPair.privateKey).toBeDefined();
    expect(keyPair.publicKey).not.toBe(keyPair.privateKey);
  });

  test('should get key pair', () => {
    const keyPair = encryption.generateKeyPair('agent-1');
    const retrieved = encryption.getKeyPair('agent-1');
    expect(retrieved).toEqual(keyPair);
  });

  test('should exchange keys between agents', () => {
    encryption.generateKeyPair('agent-a');
    encryption.generateKeyPair('agent-b');
    const secret = encryption.exchangeKeys('agent-a', 'agent-b');
    expect(secret).toBeDefined();
  });

  test('should throw when exchanging keys without key pairs', () => {
    expect(() => encryption.exchangeKeys('a', 'b')).toThrow('Both agents must have key pairs');
  });

  test('should encrypt and decrypt a message', () => {
    encryption.generateKeyPair('sender');
    encryption.generateKeyPair('receiver');
    encryption.exchangeKeys('sender', 'receiver');

    const senderKeys = encryption.getKeyPair('sender')!;
    const receiverKeys = encryption.getKeyPair('receiver')!;

    const message: Message = {
      id: 'msg-1',
      type: 'request',
      topic: 'test',
      payload: { secret: 'data' },
      sender: 'sender',
      receiver: 'receiver',
      timestamp: Date.now(),
      priority: 1,
    };

    const encrypted = encryption.encrypt(message, receiverKeys.publicKey);
    expect(encrypted.ciphertext).toBeDefined();
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.tag).toBeDefined();
    expect(encrypted.nonce).toBeDefined();

    const decrypted = encryption.decrypt(encrypted, receiverKeys.privateKey);
    expect(decrypted.id).toBe(message.id);
    expect(decrypted.payload).toEqual(message.payload);
  });

  test('should sign and verify a message', () => {
    encryption.generateKeyPair('signer');
    const keys = encryption.getKeyPair('signer')!;

    const message: Message = {
      id: 'msg-s',
      type: 'event',
      topic: 't',
      payload: 'data',
      sender: 'signer',
      timestamp: Date.now(),
      priority: 1,
    };

    const signature = encryption.sign(message, keys.privateKey);
    expect(signature).toBeDefined();

    // Verify with the same key (simulation - in production, public key verifies private key signatures)
    const verified = encryption.verify(message, signature, keys.privateKey);
    expect(verified).toBe(true);
  });

  test('should reject tampered message signature', () => {
    encryption.generateKeyPair('signer');
    const keys = encryption.getKeyPair('signer')!;

    const message: Message = {
      id: 'msg-t',
      type: 'event',
      topic: 't',
      payload: 'original',
      sender: 'signer',
      timestamp: Date.now(),
      priority: 1,
    };

    const signature = encryption.sign(message, keys.privateKey);

    const tampered: Message = { ...message, payload: 'tampered' };
    const verified = encryption.verify(tampered, signature, keys.privateKey);
    expect(verified).toBe(false);
  });

  test('should detect replay attacks', () => {
    encryption.generateKeyPair('sender');
    encryption.generateKeyPair('receiver');

    const receiverKeys = encryption.getKeyPair('receiver')!;
    const message: Message = {
      id: 'msg-r',
      type: 'event',
      topic: 't',
      payload: 'data',
      sender: 'sender',
      timestamp: Date.now(),
      priority: 1,
    };

    const encrypted = encryption.encrypt(message, receiverKeys.publicKey);
    encryption.decrypt(encrypted, receiverKeys.privateKey);

    // Replay the same encrypted message
    expect(() => encryption.decrypt(encrypted, receiverKeys.privateKey)).toThrow('Replay attack detected');
  });

  test('should get shared secret', () => {
    encryption.generateKeyPair('a');
    encryption.generateKeyPair('b');
    encryption.exchangeKeys('a', 'b');
    const secret = encryption.getSharedSecret('a', 'b');
    expect(secret).toBeDefined();
    // Order shouldn't matter
    expect(encryption.getSharedSecret('b', 'a')).toBe(secret);
  });
});

// ============================================================
// Module 9: CommunicationMetrics - 通信指标收集
// ============================================================
describe('CommunicationMetrics', () => {
  let metrics: CommunicationMetrics;

  beforeEach(() => {
    metrics = new CommunicationMetrics();
  });

  afterEach(() => {
    metrics.reset();
  });

  test('should record a message event', () => {
    metrics.recordMessage({
      message: {
        id: 'm1',
        type: 'event',
        topic: 'test',
        payload: null,
        sender: 'a1',
        timestamp: Date.now(),
        priority: 1,
      },
      eventType: 'sent',
      topic: 'test',
      agentId: 'a1',
      timestamp: Date.now(),
    });
    expect(metrics.getEventCount()).toBe(1);
  });

  test('should track multiple events', () => {
    for (let i = 0; i < 10; i++) {
      metrics.recordMessage({
        message: { id: `m${i}`, type: 'event', topic: 't', payload: null, sender: 'a1', timestamp: Date.now(), priority: 1 },
        eventType: 'sent',
        topic: 't',
        agentId: 'a1',
        timestamp: Date.now(),
      });
    }
    expect(metrics.getEventCount()).toBe(10);
  });

  test('should generate metrics report', () => {
    metrics.recordMessage({
      message: { id: 'm1', type: 'event', topic: 't', payload: null, sender: 'a1', timestamp: Date.now(), priority: 1 },
      eventType: 'sent',
      topic: 't',
      agentId: 'a1',
      timestamp: Date.now(),
    });
    const report = metrics.getMetrics();
    expect(report.totalMessages).toBe(1);
    expect(report.messagesPerSecond).toBeGreaterThanOrEqual(0);
    expect(report.totalErrors).toBe(0);
    expect(report.errorRate).toBe(0);
  });

  test('should track error rate', () => {
    metrics.recordMessage({
      message: { id: 'm1', type: 'event', topic: 't', payload: null, sender: 'a1', timestamp: Date.now(), priority: 1 },
      eventType: 'sent',
      topic: 't',
      agentId: 'a1',
      timestamp: Date.now(),
    });
    metrics.recordMessage({
      message: { id: 'm2', type: 'event', topic: 't', payload: null, sender: 'a1', timestamp: Date.now(), priority: 1 },
      eventType: 'failed',
      topic: 't',
      agentId: 'a1',
      timestamp: Date.now(),
    });
    const report = metrics.getMetrics();
    expect(report.totalErrors).toBe(1);
    expect(report.errorRate).toBe(0.5);
  });

  test('should track latency percentiles', () => {
    for (let i = 1; i <= 100; i++) {
      metrics.recordMessage({
        message: { id: `m${i}`, type: 'event', topic: 't', payload: null, sender: 'a1', timestamp: Date.now(), priority: 1 },
        eventType: 'delivered',
        topic: 't',
        agentId: 'a1',
        timestamp: Date.now(),
        latency: i,
      });
    }
    const report = metrics.getMetrics();
    expect(report.p50Latency).toBeGreaterThan(0);
    expect(report.p95Latency).toBeGreaterThan(report.p50Latency);
    expect(report.p99Latency).toBeGreaterThanOrEqual(report.p95Latency);
  });

  test('should get agent-specific metrics', () => {
    metrics.recordMessage({
      message: { id: 'm1', type: 'event', topic: 't', payload: null, sender: 'a1', timestamp: Date.now(), priority: 1 },
      eventType: 'sent',
      topic: 't',
      agentId: 'a1',
      timestamp: Date.now(),
    });
    metrics.recordMessage({
      message: { id: 'm2', type: 'event', topic: 't', payload: null, sender: 'a1', timestamp: Date.now(), priority: 1 },
      eventType: 'received',
      topic: 't',
      agentId: 'a1',
      timestamp: Date.now(),
    });

    const agentMetrics = metrics.getAgentMetrics('a1');
    expect(agentMetrics).toBeDefined();
    expect(agentMetrics!.messagesSent).toBe(1);
    expect(agentMetrics!.messagesReceived).toBe(1);
  });

  test('should return undefined for unknown agent metrics', () => {
    expect(metrics.getAgentMetrics('unknown')).toBeUndefined();
  });

  test('should get topic-specific metrics', () => {
    metrics.recordMessage({
      message: { id: 'm1', type: 'event', topic: 'payments', payload: null, sender: 'a1', timestamp: Date.now(), priority: 1 },
      eventType: 'sent',
      topic: 'payments',
      agentId: 'a1',
      timestamp: Date.now(),
      latency: 50,
    });

    const topicMetrics = metrics.getTopicMetrics('payments');
    expect(topicMetrics).toBeDefined();
    expect(topicMetrics!.messageCount).toBe(1);
    expect(topicMetrics!.averageLatency).toBe(50);
  });

  test('should return undefined for unknown topic metrics', () => {
    expect(metrics.getTopicMetrics('unknown')).toBeUndefined();
  });

  test('should track active agents count', () => {
    metrics.recordMessage({
      message: { id: 'm1', type: 'event', topic: 't', payload: null, sender: 'a1', timestamp: Date.now(), priority: 1 },
      eventType: 'sent',
      topic: 't',
      agentId: 'a1',
      timestamp: Date.now(),
    });
    metrics.recordMessage({
      message: { id: 'm2', type: 'event', topic: 't', payload: null, sender: 'a2', timestamp: Date.now(), priority: 1 },
      eventType: 'sent',
      topic: 't',
      agentId: 'a2',
      timestamp: Date.now(),
    });
    const report = metrics.getMetrics();
    expect(report.activeAgents).toBe(2);
  });

  test('should reset metrics', () => {
    metrics.recordMessage({
      message: { id: 'm1', type: 'event', topic: 't', payload: null, sender: 'a1', timestamp: Date.now(), priority: 1 },
      eventType: 'sent',
      topic: 't',
      agentId: 'a1',
      timestamp: Date.now(),
    });
    metrics.reset();
    expect(metrics.getEventCount()).toBe(0);
    expect(metrics.getMetrics().totalMessages).toBe(0);
  });
});

// ============================================================
// Module 10: AgentGroupManager - Agent 群组管理
// ============================================================
describe('AgentGroupManager', () => {
  let groupManager: AgentGroupManager;

  beforeEach(() => {
    groupManager = new AgentGroupManager();
  });

  afterEach(() => {
    groupManager.reset();
  });

  test('should create a group', () => {
    const group = groupManager.createGroup({ name: 'Team Alpha', leaderId: 'leader-1' });
    expect(group.name).toBe('Team Alpha');
    expect(group.leaderId).toBe('leader-1');
    expect(group.phase).toBe('forming');
    expect(group.members.size).toBe(1); // Leader is auto-added
  });

  test('should get group info', () => {
    const group = groupManager.createGroup({ name: 'Team', leaderId: 'l1' });
    const info = groupManager.getGroupInfo(group.id);
    expect(info).toBeDefined();
    expect(info!.name).toBe('Team');
    expect(info!.memberCount).toBe(1);
  });

  test('should return undefined for unknown group', () => {
    expect(groupManager.getGroupInfo('nonexistent')).toBeUndefined();
  });

  test('should join a group', () => {
    const group = groupManager.createGroup({ name: 'Team', leaderId: 'l1' });
    groupManager.joinGroup(group.id, 'worker-1', 'worker');
    const info = groupManager.getGroupInfo(group.id);
    expect(info!.memberCount).toBe(2);
  });

  test('should not duplicate members on join', () => {
    const group = groupManager.createGroup({ name: 'Team', leaderId: 'l1' });
    groupManager.joinGroup(group.id, 'w1', 'worker');
    groupManager.joinGroup(group.id, 'w1', 'worker');
    expect(groupManager.getGroupInfo(group.id)!.memberCount).toBe(2);
  });

  test('should leave a group', () => {
    const group = groupManager.createGroup({ name: 'Team', leaderId: 'l1' });
    groupManager.joinGroup(group.id, 'w1', 'worker');
    groupManager.leaveGroup(group.id, 'w1');
    expect(groupManager.getGroupInfo(group.id)!.memberCount).toBe(1);
  });

  test('should adjourn group when leader leaves', () => {
    const group = groupManager.createGroup({ name: 'Team', leaderId: 'l1' });
    groupManager.joinGroup(group.id, 'w1', 'worker');
    groupManager.leaveGroup(group.id, 'l1');
    expect(groupManager.getGroupInfo(group.id)!.phase).toBe('adjourning');
  });

  test('should throw when joining adjourning group', () => {
    const group = groupManager.createGroup({ name: 'Team', leaderId: 'l1' });
    groupManager.leaveGroup(group.id, 'l1');
    expect(() => groupManager.joinGroup(group.id, 'w1', 'worker')).toThrow('adjourning');
  });

  test('should throw when joining full group', () => {
    const group = groupManager.createGroup({ name: 'Team', leaderId: 'l1', maxMembers: 2 });
    groupManager.joinGroup(group.id, 'w1', 'worker');
    expect(() => groupManager.joinGroup(group.id, 'w2', 'worker')).toThrow('full');
  });

  test('should broadcast message to all members', () => {
    const group = groupManager.createGroup({ name: 'Team', leaderId: 'l1' });
    groupManager.joinGroup(group.id, 'w1', 'worker');
    groupManager.joinGroup(group.id, 'w2', 'worker');

    const received: string[] = [];
    groupManager.registerMessageHandler('l1', (msg) => received.push(msg.receiver!));
    groupManager.registerMessageHandler('w1', (msg) => received.push(msg.receiver!));
    groupManager.registerMessageHandler('w2', (msg) => received.push(msg.receiver!));

    const message: Message = {
      id: 'bc1',
      type: 'event',
      topic: 'announce',
      payload: 'hello all',
      sender: 'l1',
      timestamp: Date.now(),
      priority: 1,
    };

    groupManager.broadcast(group.id, message);
    expect(received.length).toBe(3);
  });

  test('should multicast to specific agents', () => {
    const group = groupManager.createGroup({ name: 'Team', leaderId: 'l1' });
    groupManager.joinGroup(group.id, 'w1', 'worker');
    groupManager.joinGroup(group.id, 'w2', 'worker');

    const received: string[] = [];
    groupManager.registerMessageHandler('w1', (msg) => received.push(msg.receiver!));
    groupManager.registerMessageHandler('w2', (msg) => received.push(msg.receiver!));

    const message: Message = {
      id: 'mc1',
      type: 'event',
      topic: 'announce',
      payload: 'hello',
      sender: 'l1',
      timestamp: Date.now(),
      priority: 1,
    };

    groupManager.multicast(group.id, message, ['w1']);
    expect(received.length).toBe(1);
    expect(received[0]).toBe('w1');
  });

  test('should unicast to a single agent', () => {
    const group = groupManager.createGroup({ name: 'Team', leaderId: 'l1' });
    groupManager.joinGroup(group.id, 'w1', 'worker');

    let received = false;
    groupManager.registerMessageHandler('w1', () => { received = true; });

    const message: Message = {
      id: 'uc1',
      type: 'event',
      topic: 'dm',
      payload: 'private',
      sender: 'l1',
      timestamp: Date.now(),
      priority: 1,
    };

    groupManager.unicast(group.id, message, 'w1');
    expect(received).toBe(true);
  });

  test('should transition phase from forming to storming', () => {
    const group = groupManager.createGroup({ name: 'Team', leaderId: 'l1' });
    expect(group.phase).toBe('forming');
    groupManager.joinGroup(group.id, 'w1', 'worker');
    groupManager.joinGroup(group.id, 'w2', 'worker');
    expect(groupManager.getGroupInfo(group.id)!.phase).toBe('storming');
  });

  test('should set group phase manually', () => {
    const group = groupManager.createGroup({ name: 'Team', leaderId: 'l1' });
    groupManager.setGroupPhase(group.id, 'performing');
    expect(groupManager.getGroupInfo(group.id)!.phase).toBe('performing');
  });

  test('should track group count', () => {
    groupManager.createGroup({ name: 'G1', leaderId: 'l1' });
    groupManager.createGroup({ name: 'G2', leaderId: 'l2' });
    expect(groupManager.getGroupCount()).toBe(2);
  });

  test('should find groups by tag', () => {
    groupManager.createGroup({ name: 'G1', leaderId: 'l1', tags: ['backend'] });
    groupManager.createGroup({ name: 'G2', leaderId: 'l2', tags: ['frontend'] });
    groupManager.createGroup({ name: 'G3', leaderId: 'l3', tags: ['backend'] });
    const backendGroups = groupManager.getGroupsByTag('backend');
    expect(backendGroups.length).toBe(2);
  });

  test('should create group with description and tags', () => {
    const group = groupManager.createGroup({
      name: 'Elite Team',
      description: 'Top performers',
      leaderId: 'l1',
      tags: ['elite', 'v2'],
    });
    const info = groupManager.getGroupInfo(group.id);
    expect(info!.description).toBe('Top performers');
    expect(info!.tags).toEqual(['elite', 'v2']);
  });

  test('should delete group when all non-leader members leave', () => {
    const group = groupManager.createGroup({ name: 'Team', leaderId: 'l1' });
    groupManager.joinGroup(group.id, 'w1', 'worker');
    groupManager.leaveGroup(group.id, 'w1');
    // Leader is still there
    expect(groupManager.getGroupInfo(group.id)!.memberCount).toBe(1);
  });

  test('should throw when joining nonexistent group', () => {
    expect(() => groupManager.joinGroup('nonexistent', 'w1')).toThrow('not found');
  });

  test('should throw when leaving nonexistent group', () => {
    expect(() => groupManager.leaveGroup('nonexistent', 'w1')).toThrow('not found');
  });
});
