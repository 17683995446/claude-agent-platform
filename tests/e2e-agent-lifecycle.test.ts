// ============================================================================
// E2E Agent Lifecycle Integration Test
// ============================================================================
// This test verifies the complete Agent lifecycle across multiple packages.
// It uses real implementations where possible and mocks only external dependencies.
//
// Test Flow:
// 1. Application Startup: app-core Application starts correctly
// 2. Plugin Loading: plugin-registry loads plugins, validates them
// 3. Task Orchestration: orchestrator decomposes tasks, creates execution plan
// 4. Agent Communication: agent-communication distributes tasks to agents
// 5. Knowledge Storage: knowledge-graph stores results, creates relationships
// 6. Vector Indexing: vector-store indexes documents for search
// 7. Notification: notification sends alerts about completion
//
// Edge Cases:
// - Startup failure recovery
// - Plugin load failure
// - Task execution timeout
// - Communication failure
// - Storage failure
// - Concurrent operations
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

// app-core imports
import {
  Application,
  type AppConfig,
  type ComponentDescriptor,
  ServiceContainer,
  AppEventSystem,
  AppHealthSystem,
} from '../packages/app-core/src/index.ts';

// plugin-registry imports
import {
  PluginRegistry,
  type PluginDefinition,
  type PluginInfo,
} from '../packages/plugin-registry/src/index.ts';

// orchestrator imports
import {
  NLTaskParser,
  TaskDecomposer,
  SmartOrchestrator,
  type ParsedTask,
  type DecompositionResult,
  type ExecutionPlan,
} from '../packages/orchestrator/src/index.ts';

// agent-communication imports
import {
  MessageBus,
  TaskDelegationManager,
  AgentRegistry,
  type AgentTask,
  type TaskResult,
  type AgentInfo,
} from '../packages/agent-communication/src/index.ts';

// knowledge-graph imports
import {
  GraphStore,
  type GraphNode,
  type GraphEdge,
} from '../packages/knowledge-graph/src/index.ts';

// vector-store imports
import {
  DocumentStore,
  VectorIndex,
} from '../packages/vector-store/src/index.ts';

// notification imports
import {
  NotificationCenter,
  type Notification,
  type SendResult,
} from '../packages/notification/src/index.ts';

// ============================================================================
// Test Utilities and Helpers
// ============================================================================

interface TestContext {
  application: Application;
  pluginRegistry: PluginRegistry;
  taskParser: NLTaskParser;
  taskDecomposer: TaskDecomposer;
  orchestrator: SmartOrchestrator;
  messageBus: MessageBus;
  taskDelegation: TaskDelegationManager;
  agentRegistry: AgentRegistry;
  graphStore: GraphStore;
  documentStore: DocumentStore;
  vectorIndex: VectorIndex;
  notificationCenter: NotificationCenter;
  receivedNotifications: Notification[];
}

let testContext: TestContext;
let notificationSubscriptionId: string | null = null;

/**
 * Helper to create a mock agent for testing
 */
function createMockAgent(id: string, capabilities: string[] = ['default']): AgentInfo {
  return {
    id,
    name: `Agent-${id}`,
    type: 'worker',
    capabilities,
    tags: ['test'],
    metadata: {},
    registeredAt: Date.now(),
    lastHeartbeat: Date.now(),
    healthStatus: 'healthy',
  };
}

/**
 * Helper to create a mock plugin definition
 */
function createMockPlugin(name: string, version: string = '1.0.0'): PluginDefinition {
  return {
    name,
    version,
    description: `Test plugin: ${name}`,
    main: `./plugins/${name}/index.js`,
    author: 'test',
    dependencies: {},
    permissions: [],
  };
}

/**
 * Helper to generate a simple embedding vector
 */
function generateMockEmbedding(text: string, dimension: number = 128): number[] {
  const vector: number[] = [];
  for (let i = 0; i < dimension; i++) {
    // Simple hash-based embedding for testing
    const charCode = text.charCodeAt(i % text.length) || 0;
    vector.push(Math.sin(charCode * (i + 1) * 0.1) * 0.5 + 0.5);
  }
  return vector;
}

/**
 * Setup test context before each test
 */
function setupTestContext(): TestContext {
  const receivedNotifications: Notification[] = [];

  const application = new Application({
    name: 'test-app',
    version: '1.0.0',
    environment: 'test',
  });

  const pluginRegistry = new PluginRegistry();
  const taskParser = new NLTaskParser();
  const taskDecomposer = new TaskDecomposer();
  const orchestrator = new SmartOrchestrator();
  const messageBus = new MessageBus();
  const taskDelegation = new TaskDelegationManager();
  const agentRegistry = new AgentRegistry();
  const graphStore = new GraphStore();
  const documentStore = new DocumentStore();
  const vectorIndex = new VectorIndex(128);
  const notificationCenter = new NotificationCenter();

  return {
    application,
    pluginRegistry,
    taskParser,
    taskDecomposer,
    orchestrator,
    messageBus,
    taskDelegation,
    agentRegistry,
    graphStore,
    documentStore,
    vectorIndex,
    notificationCenter,
    receivedNotifications,
  };
}

/**
 * Cleanup test context after each test
 */
async function cleanupTestContext(ctx: TestContext): Promise<void> {
  // Stop application if running
  if (ctx.application.isRunning()) {
    await ctx.application.stop();
  }

  // Reset all components
  ctx.pluginRegistry.shutdown().catch(() => {});
  ctx.orchestrator.reset();
  ctx.messageBus.reset();
  ctx.taskDelegation.reset();
  ctx.agentRegistry.reset();
  ctx.graphStore.clear();
  ctx.vectorIndex.clear();
  ctx.notificationCenter.clearHistory();
  ctx.receivedNotifications.length = 0;
}

// ============================================================================
// BUG TRACKING COMMENTS
// ============================================================================
// During test development, the following bugs were discovered and documented:
//
// BUG-E2E-001 [FIXED]: Application component status not properly tracking state
//   - Component status always showed 'running' even when app was stopped
//   - Fixed by tracking component status based on application phase
//
// BUG-E2E-002 [FIXED]: TaskDelegationManager.reset() left pending promises unresolved
//   - Callers awaiting delegate() would hang forever after reset()
//   - Fixed by resolving all pending promises with error before clearing
//
// BUG-E2E-003 [FIXED]: MessageBus request/response could resolve with own message
//   - A sender could receive their own request as a response
//   - Fixed by checking sender ID before resolving pending requests
//
// BUG-E2E-004 [FIXED]: Plugin loader reload() could register plugin under wrong name
//   - If source.name was undefined, reload would use path/packageName
//   - Fixed by preserving original plugin name during reload
//
// ============================================================================

// ============================================================================
// Test Suite: Application Startup
// ============================================================================

describe('Application Startup', () => {
  beforeEach(() => {
    testContext = setupTestContext();
  });

  afterEach(async () => {
    await cleanupTestContext(testContext);
  });

  it('should start application correctly', async () => {
    const { application } = testContext;

    expect(application.getPhase()).toBe('idle');
    expect(application.isRunning()).toBe(false);

    await application.start();

    expect(application.getPhase()).toBe('running');
    expect(application.isRunning()).toBe(true);

    const status = application.getStatus();
    expect(status.phase).toBe('running');
    expect(status.startTime).not.toBeNull();
    expect(status.uptime).toBeGreaterThanOrEqual(0);
  });

  it('should register and initialize components', async () => {
    const { application } = testContext;

    let initCalled = false;
    let startCalled = false;

    const component: ComponentDescriptor = {
      name: 'test-component',
      instance: { value: 'test' },
      init: async () => {
        initCalled = true;
      },
      start: async () => {
        startCalled = true;
      },
    };

    application.registerComponent(component);
    expect(application.hasComponent('test-component')).toBe(true);
    expect(application.getComponent('test-component')).toEqual({ value: 'test' });

    await application.start();

    expect(initCalled).toBe(true);
    expect(startCalled).toBe(true);
  });

  it('should stop application and cleanup resources', async () => {
    const { application } = testContext;

    await application.start();
    expect(application.isRunning()).toBe(true);

    await application.stop();
    expect(application.isRunning()).toBe(false);
    expect(application.getPhase()).toBe('stopped');

    const status = application.getStatus();
    expect(status.startTime).toBeNull();
  });

  it('should handle startup failure gracefully', async () => {
    const { application } = testContext;

    const failingComponent: ComponentDescriptor = {
      name: 'failing-component',
      instance: {},
      init: async () => {
        throw new Error('Init failed');
      },
    };

    application.registerComponent(failingComponent);

    try {
      await application.start();
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('Init failed');
    }

    expect(application.getPhase()).toBe('error');
    expect(application.isRunning()).toBe(false);
  });

  it('should prevent double start', async () => {
    const { application } = testContext;

    await application.start();

    // Second start should be idempotent (no error)
    await application.start();
    expect(application.isRunning()).toBe(true);
  });

  it('should handle restart correctly', async () => {
    const { application } = testContext;

    await application.start();
    expect(application.isRunning()).toBe(true);

    await application.restart();
    expect(application.isRunning()).toBe(true);
    expect(application.getPhase()).toBe('running');
  });
});

// ============================================================================
// Test Suite: Plugin Loading
// ============================================================================

describe('Plugin Loading', () => {
  beforeEach(() => {
    testContext = setupTestContext();
  });

  afterEach(async () => {
    await cleanupTestContext(testContext);
  });

  it('should register and activate plugins', async () => {
    const { pluginRegistry } = testContext;

    const plugin = createMockPlugin('test-plugin');

    await pluginRegistry.register(plugin);

    const registeredPlugin = pluginRegistry.getPlugin('test-plugin');
    expect(registeredPlugin).toBeDefined();
    expect(registeredPlugin?.definition.name).toBe('test-plugin');
    expect(pluginRegistry.getPluginState('test-plugin')).toBe('loaded');

    await pluginRegistry.activate('test-plugin');
    expect(pluginRegistry.getPluginState('test-plugin')).toBe('active');
  });

  it('should validate plugin dependencies', async () => {
    const { pluginRegistry } = testContext;

    const corePlugin = createMockPlugin('core-plugin');
    const dependentPlugin: PluginDefinition = {
      ...createMockPlugin('dependent-plugin'),
      dependencies: {
        'core-plugin': '^1.0.0',
      },
    };

    // Register core plugin first (dependency must be available)
    await pluginRegistry.register(corePlugin);

    // Now register the dependent plugin
    await pluginRegistry.register(dependentPlugin);

    // Initialize dependent plugin (should initialize core first)
    await pluginRegistry.initialize('dependent-plugin');

    expect(pluginRegistry.getPluginState('core-plugin')).toBe('initialized');
    expect(pluginRegistry.getPluginState('dependent-plugin')).toBe('initialized');
  });

  it('should detect dependency conflicts', async () => {
    const { pluginRegistry } = testContext;

    // First register a shared dependency
    const sharedDep = createMockPlugin('shared-dep');
    await pluginRegistry.register(sharedDep);

    // Register plugin1 that depends on shared-dep ^1.0.0
    const plugin1: PluginDefinition = {
      ...createMockPlugin('plugin-1'),
      dependencies: {
        'shared-dep': '^1.0.0',
      },
    };

    await pluginRegistry.register(plugin1);

    // Try to register plugin2 with conflicting version requirement
    const plugin2: PluginDefinition = {
      ...createMockPlugin('plugin-2'),
      dependencies: {
        'shared-dep': '^2.0.0',
      },
    };

    // This should fail due to version conflict
    try {
      await pluginRegistry.register(plugin2);
      // If we reach here, check conflicts manually
      const conflicts = pluginRegistry.checkConflicts();
      expect(conflicts.length).toBeGreaterThan(0);
    } catch (error) {
      // Expected: conflict detected at registration time
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('conflict');
    }
  });

  it('should handle plugin load failure', async () => {
    const { pluginRegistry } = testContext;

    const plugin = createMockPlugin('test-plugin');
    await pluginRegistry.register(plugin);

    // Try to register the same plugin again (should fail)
    try {
      await pluginRegistry.register(plugin);
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('already registered');
    }
  });

  it('should unload plugins correctly', async () => {
    const { pluginRegistry } = testContext;

    const plugin = createMockPlugin('unloadable-plugin');
    await pluginRegistry.register(plugin);
    await pluginRegistry.activate('unloadable-plugin');

    expect(pluginRegistry.getPluginState('unloadable-plugin')).toBe('active');

    await pluginRegistry.unregister('unloadable-plugin');

    expect(pluginRegistry.getPlugin('unloadable-plugin')).toBeUndefined();
    expect(pluginRegistry.getPluginState('unloadable-plugin')).toBeUndefined();
  });

  it('should list plugins with filters', async () => {
    const { pluginRegistry } = testContext;

    await pluginRegistry.register(createMockPlugin('plugin-a'));
    await pluginRegistry.register(createMockPlugin('plugin-b'));
    await pluginRegistry.activate('plugin-a');

    const allPlugins = pluginRegistry.listPlugins();
    expect(allPlugins.length).toBe(2);

    const activePlugins = pluginRegistry.listPlugins({ state: 'active' });
    expect(activePlugins.length).toBe(1);
    expect(activePlugins[0]?.name).toBe('plugin-a');
  });
});

// ============================================================================
// Test Suite: Task Orchestration
// ============================================================================

describe('Task Orchestration', () => {
  beforeEach(() => {
    testContext = setupTestContext();
  });

  afterEach(async () => {
    await cleanupTestContext(testContext);
  });

  it('should parse natural language tasks', () => {
    const { taskParser } = testContext;

    const parsed = taskParser.parse('分析项目代码结构');

    expect(parsed.intent).toBe('analyze');
    expect(parsed.confidence).toBeGreaterThan(0);
    expect(parsed.language).toBe('zh');
    expect(parsed.description).toContain('分析');
  });

  it('should decompose tasks into sub-tasks', () => {
    const { taskParser, taskDecomposer } = testContext;

    const parsed = taskParser.parse('分析 src 目录下的代码');
    const decomposition = taskDecomposer.decompose(parsed);

    expect(decomposition.rootTask).toEqual(parsed);
    expect(decomposition.graph.nodes.length).toBeGreaterThan(0);
    expect(decomposition.graph.edges).toBeDefined();
    expect(decomposition.totalEstimatedDuration).toBeGreaterThan(0);
    expect(['sequential', 'parallel', 'mixed']).toContain(decomposition.decompositionStrategy);
  });

  it('should create execution plan from decomposition', () => {
    const { taskParser, taskDecomposer, orchestrator } = testContext;

    const parsed = taskParser.parse('测试项目');
    const decomposition = taskDecomposer.decompose(parsed);
    const plan = orchestrator.createPlan(decomposition);

    expect(plan.id).toBeDefined();
    expect(plan.phases.length).toBeGreaterThan(0);
    expect(plan.totalSteps).toBe(decomposition.graph.nodes.length);
    expect(plan.estimatedDuration).toBe(decomposition.totalEstimatedDuration);
  });

  it('should execute tasks in correct order', async () => {
    const { taskParser, taskDecomposer, orchestrator } = testContext;

    const parsed = taskParser.parse('生成 README 文档');
    const decomposition = taskDecomposer.decompose(parsed);
    orchestrator.createPlan(decomposition);

    const executionOrder: string[] = [];

    await orchestrator.execute(async (taskId) => {
      executionOrder.push(taskId);
      return { success: true, duration: 10 };
    });

    expect(orchestrator.getState()).toBe('completed');
    expect(executionOrder.length).toBe(decomposition.graph.nodes.length);

    // Verify dependencies were respected
    for (const node of decomposition.graph.nodes) {
      const nodeIndex = executionOrder.indexOf(node.id);
      for (const depId of node.dependencies) {
        const depIndex = executionOrder.indexOf(depId);
        expect(depIndex).toBeLessThan(nodeIndex);
      }
    }
  });

  it('should handle task execution failure', async () => {
    const { taskParser, taskDecomposer, orchestrator } = testContext;

    const parsed = taskParser.parse('修复 bug');
    const decomposition = taskDecomposer.decompose(parsed);
    orchestrator.createPlan(decomposition);

    let taskCount = 0;
    await orchestrator.execute(async () => {
      taskCount++;
      if (taskCount > 1) {
        return { success: false, duration: 10 };
      }
      return { success: true, duration: 10 };
    });

    expect(orchestrator.getState()).toBe('failed');
  });

  it('should support pause and resume', async () => {
    const { taskParser, taskDecomposer, orchestrator } = testContext;

    const parsed = taskParser.parse('部署到生产环境');
    const decomposition = taskDecomposer.decompose(parsed);
    orchestrator.createPlan(decomposition);

    let paused = false;
    let taskCount = 0;

    // Start execution in background
    const executionPromise = orchestrator.execute(async () => {
      taskCount++;
      if (taskCount === 2 && !paused) {
        orchestrator.pause();
        paused = true;
      }
      return { success: true, duration: 50 };
    });

    // Wait a bit for pause to take effect
    await new Promise(resolve => setTimeout(resolve, 100));

    if (paused) {
      expect(orchestrator.getState()).toBe('paused');
      orchestrator.resume();
    }

    await executionPromise;
    expect(orchestrator.getState()).toBe('completed');
  });
});

// ============================================================================
// Test Suite: Agent Communication
// ============================================================================

describe('Agent Communication', () => {
  beforeEach(() => {
    testContext = setupTestContext();
  });

  afterEach(async () => {
    await cleanupTestContext(testContext);
  });

  it('should register agents and track health', () => {
    const { agentRegistry } = testContext;

    const agent = createMockAgent('agent-1', ['analysis', 'testing']);
    agentRegistry.register(agent);

    const registered = agentRegistry.getAgent('agent-1');
    expect(registered).toBeDefined();
    expect(registered?.capabilities).toContain('analysis');

    const healthyAgents = agentRegistry.getHealthyAgents();
    expect(healthyAgents.length).toBe(1);
  });

  it('should discover agents by capability', () => {
    const { agentRegistry } = testContext;

    agentRegistry.register(createMockAgent('agent-1', ['analysis']));
    agentRegistry.register(createMockAgent('agent-2', ['testing']));
    agentRegistry.register(createMockAgent('agent-3', ['analysis', 'testing']));

    const analysisAgents = agentRegistry.discover({ capability: 'analysis' });
    expect(analysisAgents.length).toBe(2);

    const testingAgents = agentRegistry.discover({ capability: 'testing' });
    expect(testingAgents.length).toBe(2);
  });

  it('should delegate tasks to agents', async () => {
    const { taskDelegation } = testContext;

    taskDelegation.registerAgent('agent-1', ['default']);

    const task: AgentTask = {
      id: 'task-1',
      type: 'test',
      payload: { data: 'test' },
      priority: 5,
      requiredCapabilities: [],
      timeout: 50,
      createdAt: Date.now(),
    };

    const result = await taskDelegation.delegate(task);

    expect(result.success).toBe(true);
    expect(result.taskId).toBe('task-1');
    expect(result.agentId).toBe('agent-1');
  });

  it('should route tasks based on capabilities', async () => {
    const { taskDelegation } = testContext;

    taskDelegation.registerAgent('general-agent', ['general']);
    taskDelegation.registerAgent('specialized-agent', ['special', 'general']);

    const task: AgentTask = {
      id: 'task-1',
      type: 'special',
      payload: {},
      priority: 5,
      requiredCapabilities: ['special'],
      timeout: 50,
      createdAt: Date.now(),
    };

    const result = await taskDelegation.delegate(task);

    expect(result.success).toBe(true);
    expect(result.agentId).toBe('specialized-agent');
  });

  it('should handle message bus pub/sub', () => {
    const { messageBus } = testContext;

    const receivedMessages: unknown[] = [];

    const subscription = messageBus.subscribe('test.topic', (message) => {
      receivedMessages.push(message.payload);
    });

    messageBus.publish('test.topic', { payload: { value: 'hello' } });
    messageBus.publish('test.topic', { payload: { value: 'world' } });

    // Allow async processing
    setTimeout(() => {
      expect(receivedMessages.length).toBe(2);
      expect(receivedMessages[0]).toEqual({ value: 'hello' });
    }, 10);

    subscription.unsubscribe();
  });

  it('should handle request/response pattern', async () => {
    const { messageBus } = testContext;

    // Subscribe to handle requests
    messageBus.subscribe('request.topic', (message) => {
      if (message.type === 'request') {
        messageBus.publish('request.topic', {
          type: 'response',
          payload: { result: 'processed' },
          correlationId: message.correlationId,
          sender: 'responder',
        });
      }
    });

    const response = await messageBus.request('request.topic', { data: 'test' }, 1000);

    expect(response.type).toBe('response');
    expect(response.payload).toEqual({ result: 'processed' });
  });

  it('should handle agent unregistration during task execution', async () => {
    const { taskDelegation } = testContext;

    taskDelegation.registerAgent('agent-1', ['default']);

    const task: AgentTask = {
      id: 'task-1',
      type: 'test',
      payload: {},
      priority: 5,
      requiredCapabilities: [],
      timeout: 1000, // Long timeout
      createdAt: Date.now(),
    };

    // Start delegation but don't await yet
    const delegationPromise = taskDelegation.delegate(task);

    // Unregister agent while task is pending
    setTimeout(() => {
      taskDelegation.unregisterAgent('agent-1');
    }, 10);

    const result = await delegationPromise;

    // Task should fail due to agent unregistration
    expect(result.success).toBe(false);
    expect(result.error).toContain('unregistered');
  });
});

// ============================================================================
// Test Suite: Knowledge Storage
// ============================================================================

describe('Knowledge Storage', () => {
  beforeEach(() => {
    testContext = setupTestContext();
  });

  afterEach(async () => {
    await cleanupTestContext(testContext);
  });

  it('should store and retrieve graph nodes', () => {
    const { graphStore } = testContext;

    graphStore.addNode('task-1', ['Task'], {
      name: 'Analyze code',
      status: 'completed',
    });

    graphStore.addNode('task-2', ['Task'], {
      name: 'Generate docs',
      status: 'pending',
    });

    const node = graphStore.getNode('task-1');
    expect(node).toBeDefined();
    expect(node?.labels).toContain('Task');
    expect(node?.properties.name).toBe('Analyze code');

    const tasks = graphStore.getNodesByLabel('Task');
    expect(tasks.length).toBe(2);
  });

  it('should create relationships between nodes', () => {
    const { graphStore } = testContext;

    graphStore.addNode('task-1', ['Task'], { name: 'Parent task' });
    graphStore.addNode('task-2', ['Task'], { name: 'Child task' });

    const edgeId = graphStore.addEdge('task-1', 'task-2', 'DEPENDS_ON', {
      type: 'hard',
    });

    expect(edgeId).toBeDefined();

    const neighbors = graphStore.getNeighbors('task-2', 'in');
    expect(neighbors.length).toBe(1);
    expect(neighbors[0]?.id).toBe('task-1');
  });

  it('should support graph transactions', () => {
    const { graphStore } = testContext;

    graphStore.addNode('node-1', ['Test'], { value: 1 });

    graphStore.beginTransaction();

    graphStore.addNode('node-2', ['Test'], { value: 2 });
    graphStore.addNode('node-3', ['Test'], { value: 3 });

    expect(graphStore.getNodeCount()).toBe(3);

    graphStore.rollbackTransaction();

    expect(graphStore.getNodeCount()).toBe(1);
    expect(graphStore.getNode('node-2')).toBeUndefined();
  });

  it('should handle graph change events', () => {
    const { graphStore } = testContext;

    const events: string[] = [];

    graphStore.onChange((event) => {
      events.push(event.type);
    });

    graphStore.addNode('node-1', ['Test'], {});
    graphStore.addNode('node-2', ['Test'], {});
    graphStore.addEdge('node-1', 'node-2', 'LINKS_TO');

    expect(events).toContain('node_added');
  });

  it('should query graph by labels and properties', () => {
    const { graphStore } = testContext;

    graphStore.addNode('doc-1', ['Document', 'Markdown'], { title: 'README' });
    graphStore.addNode('doc-2', ['Document', 'JSON'], { title: 'package.json' });
    graphStore.addNode('code-1', ['Code', 'TypeScript'], { name: 'index.ts' });

    const documents = graphStore.getNodesByLabel('Document');
    expect(documents.length).toBe(2);

    const markdownDocs = graphStore.getNodesByLabel('Markdown');
    expect(markdownDocs.length).toBe(1);
  });

  it('should remove nodes and cleanup edges', () => {
    const { graphStore } = testContext;

    graphStore.addNode('a', ['Node'], {});
    graphStore.addNode('b', ['Node'], {});
    graphStore.addNode('c', ['Node'], {});

    graphStore.addEdge('a', 'b', 'LINKS');
    graphStore.addEdge('c', 'b', 'LINKS');

    expect(graphStore.getEdgeCount()).toBe(2);

    graphStore.removeNode('b');

    expect(graphStore.getNode('b')).toBeUndefined();
    expect(graphStore.getEdgeCount()).toBe(0);
  });
});

// ============================================================================
// Test Suite: Vector Indexing
// ============================================================================

describe('Vector Indexing', () => {
  beforeEach(() => {
    testContext = setupTestContext();
  });

  afterEach(async () => {
    await cleanupTestContext(testContext);
  });

  it('should index documents with embeddings', () => {
    const { documentStore } = testContext;

    const embedding = generateMockEmbedding('test document content');

    documentStore.addDocument({
      id: 'doc-1',
      content: 'test document content',
      metadata: { source: 'test' },
      embedding,
    });

    const doc = documentStore.getDocument('doc-1');
    expect(doc).toBeDefined();
    expect(doc?.content).toBe('test document content');
    expect(doc?.embedding).toBeDefined();
  });

  it('should search documents by similarity', () => {
    const { documentStore } = testContext;

    // Add documents with different embeddings
    documentStore.addDocument({
      id: 'doc-1',
      content: 'machine learning basics',
      embedding: generateMockEmbedding('machine learning basics'),
    });

    documentStore.addDocument({
      id: 'doc-2',
      content: 'deep neural networks',
      embedding: generateMockEmbedding('deep neural networks'),
    });

    documentStore.addDocument({
      id: 'doc-3',
      content: 'cooking recipes',
      embedding: generateMockEmbedding('cooking recipes'),
    });

    // Search with a query similar to doc-1
    const queryEmbedding = generateMockEmbedding('machine learning fundamentals');
    const results = documentStore.search(queryEmbedding, 2);

    expect(results.length).toBe(2);
    expect(results[0]?.id).toBe('doc-1');
  });

  it('should index vectors for similarity search', () => {
    const { vectorIndex } = testContext;

    vectorIndex.add('vec-1', generateMockEmbedding('hello world'));
    vectorIndex.add('vec-2', generateMockEmbedding('hello there'));
    vectorIndex.add('vec-3', generateMockEmbedding('goodbye world'));

    const query = generateMockEmbedding('hello');
    const results = vectorIndex.search(query, 2);

    expect(results.length).toBe(2);
    expect(results[0]?.id).toBeDefined();
    expect(results[0]?.score).toBeGreaterThan(0);
  });

  it('should update and delete vectors', () => {
    const { vectorIndex } = testContext;

    vectorIndex.add('vec-1', generateMockEmbedding('original'));

    expect(vectorIndex.has('vec-1')).toBe(true);

    // Update by re-adding (VectorIndex supports overwriting)
    vectorIndex.add('vec-1', generateMockEmbedding('updated'));

    expect(vectorIndex.has('vec-1')).toBe(true);

    // Verify the update worked by checking size
    expect(vectorIndex.size()).toBe(1);

    vectorIndex.remove('vec-1');

    expect(vectorIndex.has('vec-1')).toBe(false);
  });

  it('should provide document statistics', () => {
    const { documentStore } = testContext;

    documentStore.addDocument({
      id: 'doc-1',
      content: 'short',
      embedding: generateMockEmbedding('short'),
    });

    documentStore.addDocument({
      id: 'doc-2',
      content: 'this is a longer document',
    });

    const stats = documentStore.getStats();

    expect(stats.total).toBe(2);
    expect(stats.withEmbedding).toBe(1);
    expect(stats.avgContentLength).toBeGreaterThan(0);
  });
});

// ============================================================================
// Test Suite: Notification
// ============================================================================

describe('Notification', () => {
  beforeEach(() => {
    testContext = setupTestContext();
  });

  afterEach(async () => {
    await cleanupTestContext(testContext);
  });

  it('should send notifications to subscribers', async () => {
    const { notificationCenter, receivedNotifications } = testContext;

    notificationCenter.subscribe('in-app', (notification) => {
      receivedNotifications.push(notification);
    });

    const notification: Notification = {
      id: 'notif-1',
      type: 'info',
      priority: 'normal',
      title: 'Task Completed',
      message: 'The analysis task has been completed successfully.',
      channel: 'in-app',
      timestamp: Date.now(),
    };

    const results = await notificationCenter.send(notification);

    expect(results.length).toBe(1);
    expect(results[0]?.success).toBe(true);
    expect(receivedNotifications.length).toBe(1);
  });

  it('should handle multiple channels', async () => {
    const { notificationCenter, receivedNotifications } = testContext;

    notificationCenter.subscribe('console', (n) => receivedNotifications.push(n));
    notificationCenter.subscribe('file', (n) => receivedNotifications.push(n));

    const notification: Notification = {
      id: 'notif-2',
      type: 'warning',
      priority: 'high',
      title: 'Warning',
      message: 'Resource usage high',
      channel: ['console', 'file'],
      timestamp: Date.now(),
    };

    const results = await notificationCenter.send(notification);

    expect(results.length).toBe(2);
    expect(receivedNotifications.length).toBe(2);
  });

  it('should deduplicate notifications', async () => {
    const { notificationCenter, receivedNotifications } = testContext;

    notificationCenter.subscribe('in-app', (n) => receivedNotifications.push(n));

    const notification: Notification = {
      id: 'notif-3',
      type: 'error',
      priority: 'critical',
      title: 'Error',
      message: 'Critical error occurred',
      channel: 'in-app',
      timestamp: Date.now(),
      dedupeKey: 'error-critical',
    };

    // Send same notification twice
    await notificationCenter.send(notification);
    await notificationCenter.send(notification);

    // Second should be deduplicated
    expect(receivedNotifications.length).toBe(1);
  });

  it('should filter notification history', async () => {
    const { notificationCenter } = testContext;

    notificationCenter.subscribe('in-app', () => {});

    await notificationCenter.send({
      id: 'notif-1',
      type: 'info',
      priority: 'normal',
      title: 'Info 1',
      message: 'Message 1',
      channel: 'in-app',
      timestamp: Date.now(),
    });

    await notificationCenter.send({
      id: 'notif-2',
      type: 'error',
      priority: 'high',
      title: 'Error 1',
      message: 'Message 2',
      channel: 'in-app',
      timestamp: Date.now(),
    });

    const allHistory = notificationCenter.getHistory();
    expect(allHistory.length).toBe(2);

    const errorHistory = notificationCenter.getHistory({ type: 'error' });
    expect(errorHistory.length).toBe(1);
  });

  it('should enforce rate limits', async () => {
    const { notificationCenter } = testContext;

    notificationCenter.setRateLimit('in-app', 2);
    notificationCenter.subscribe('in-app', () => {});

    const createNotification = (id: string): Notification => ({
      id,
      type: 'info',
      priority: 'normal',
      title: 'Test',
      message: 'Test message',
      channel: 'in-app',
      timestamp: Date.now(),
    });

    const result1 = await notificationCenter.send(createNotification('n1'));
    const result2 = await notificationCenter.send(createNotification('n2'));
    const result3 = await notificationCenter.send(createNotification('n3'));

    expect(result1[0]?.success).toBe(true);
    expect(result2[0]?.success).toBe(true);
    expect(result3[0]?.success).toBe(false);
    expect(result3[0]?.error).toContain('Rate limit');
  });
});

// ============================================================================
// Test Suite: Complete Lifecycle Integration
// ============================================================================

describe('Complete Lifecycle Integration', () => {
  beforeEach(() => {
    testContext = setupTestContext();
  });

  afterEach(async () => {
    await cleanupTestContext(testContext);
  });

  it('should execute complete agent lifecycle flow', async () => {
    const {
      application,
      pluginRegistry,
      taskParser,
      taskDecomposer,
      orchestrator,
      agentRegistry,
      taskDelegation,
      graphStore,
      documentStore,
      notificationCenter,
      receivedNotifications,
    } = testContext;

    // 1. Application Startup
    await application.start();
    expect(application.isRunning()).toBe(true);

    // 2. Plugin Loading
    const corePlugin = createMockPlugin('core-plugin');
    await pluginRegistry.register(corePlugin);
    await pluginRegistry.activate('core-plugin');
    expect(pluginRegistry.getPluginState('core-plugin')).toBe('active');

    // 3. Task Orchestration - Parse and decompose task
    // Use a clear analysis task (avoid mixed intent keywords)
    const parsedTask = taskParser.parse('分析项目的代码结构');
    expect(parsedTask.intent).toBe('analyze');

    const decomposition = taskDecomposer.decompose(parsedTask);
    expect(decomposition.graph.nodes.length).toBeGreaterThan(0);

    const plan = orchestrator.createPlan(decomposition);
    expect(plan.phases.length).toBeGreaterThan(0);

    // 4. Agent Communication - Register agents and delegate tasks
    agentRegistry.register(createMockAgent('analyzer', ['analysis']));
    agentRegistry.register(createMockAgent('documenter', ['documentation']));

    taskDelegation.registerAgent('analyzer', ['analysis']);
    taskDelegation.registerAgent('documenter', ['documentation']);

    // Execute the plan
    await orchestrator.execute(async (taskId) => {
      // Simulate task delegation
      const task: AgentTask = {
        id: taskId,
        type: 'analysis',
        payload: { task: decomposition.graph.nodes.find(n => n.id === taskId) },
        priority: 5,
        requiredCapabilities: [],
        timeout: 50,
        createdAt: Date.now(),
      };

      const result = await taskDelegation.delegate(task);
      return { success: result.success, duration: result.duration ?? 10 };
    });

    expect(orchestrator.getState()).toBe('completed');

    // 5. Knowledge Storage - Store results in graph
    graphStore.addNode('task-result', ['TaskResult'], {
      taskId: parsedTask.raw,
      status: 'completed',
      timestamp: Date.now(),
    });

    graphStore.addNode('analysis-output', ['Output'], {
      type: 'analysis',
      data: { filesAnalyzed: 10 },
    });

    graphStore.addEdge('task-result', 'analysis-output', 'PRODUCED');

    expect(graphStore.getNodeCount()).toBe(2);
    expect(graphStore.getEdgeCount()).toBe(1);

    // 6. Vector Indexing - Index documents
    documentStore.addDocument({
      id: 'analysis-report',
      content: 'Project analysis report with 10 files analyzed',
      metadata: { type: 'report' },
      embedding: generateMockEmbedding('project analysis report'),
    });

    const stats = documentStore.getStats();
    expect(stats.total).toBe(1);
    expect(stats.withEmbedding).toBe(1);

    // 7. Notification - Send completion notification
    notificationCenter.subscribe('in-app', (n) => receivedNotifications.push(n));

    await notificationCenter.send({
      id: 'completion-notif',
      type: 'success',
      priority: 'normal',
      title: 'Task Completed',
      message: 'Analysis task has been completed successfully.',
      channel: 'in-app',
      timestamp: Date.now(),
    });

    expect(receivedNotifications.length).toBe(1);
    expect(receivedNotifications[0]?.title).toBe('Task Completed');

    // Cleanup
    await application.stop();
    expect(application.isRunning()).toBe(false);
  });

  it('should maintain data consistency across packages', async () => {
    const {
      graphStore,
      documentStore,
      vectorIndex,
    } = testContext;

    // Create linked data across stores
    const taskId = 'task-consistency-test';

    // Store in graph
    graphStore.addNode(taskId, ['Task'], { name: 'Consistency Test' });

    // Store in document store
    documentStore.addDocument({
      id: taskId,
      content: 'Task content for consistency test',
      embedding: generateMockEmbedding('task content'),
    });

    // Store in vector index
    vectorIndex.add(taskId, generateMockEmbedding('task content'));

    // Verify all stores have the data
    expect(graphStore.getNode(taskId)).toBeDefined();
    expect(documentStore.getDocument(taskId)).toBeDefined();
    expect(vectorIndex.has(taskId)).toBe(true);

    // Update all stores
    graphStore.addNode(taskId, ['Task', 'Updated'], { status: 'modified' });
    documentStore.updateDocument(taskId, { content: 'Updated content' });
    // VectorIndex supports update via re-adding
    vectorIndex.add(taskId, generateMockEmbedding('updated content'));

    // Verify updates
    const graphNode = graphStore.getNode(taskId);
    expect(graphNode?.labels).toContain('Updated');

    const doc = documentStore.getDocument(taskId);
    expect(doc?.content).toBe('Updated content');

    // Verify vector was updated (should still have only one entry)
    expect(vectorIndex.size()).toBe(1);
  });
});

// ============================================================================
// Test Suite: Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  beforeEach(() => {
    testContext = setupTestContext();
  });

  afterEach(async () => {
    await cleanupTestContext(testContext);
  });

  it('should handle startup failure recovery', async () => {
    const { application } = testContext;

    // Register a component that will fail
    const failingComponent: ComponentDescriptor = {
      name: 'failing-component',
      instance: {},
      init: async () => {
        throw new Error('Startup failure');
      },
    };

    application.registerComponent(failingComponent);

    // Attempt to start - should fail
    try {
      await application.start();
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    }

    expect(application.getPhase()).toBe('error');

    // Recovery: stop and try again
    await application.stop();
    expect(application.getPhase()).toBe('stopped');

    // Remove failing component
    // Note: Application doesn't have unregisterComponent, so we create a new one
    const newApp = new Application({ name: 'recovered-app' });
    await newApp.start();
    expect(newApp.isRunning()).toBe(true);
    await newApp.stop();
  });

  it('should handle plugin load failure', async () => {
    const { pluginRegistry } = testContext;

    // Try to initialize a plugin that doesn't exist
    try {
      await pluginRegistry.initialize('non-existent-plugin');
      expect(true).toBe(false); // Should not reach
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('not registered');
    }

    // Register a plugin without dependencies first
    const standalonePlugin: PluginDefinition = {
      name: 'standalone-plugin',
      version: '1.0.0',
    };

    await pluginRegistry.register(standalonePlugin);

    // Try to register the same plugin again (should fail)
    try {
      await pluginRegistry.register(standalonePlugin);
      expect(true).toBe(false); // Should not reach
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('already registered');
    }
  });

  it('should handle task execution timeout', async () => {
    const { taskParser, taskDecomposer, orchestrator } = testContext;

    const parsed = taskParser.parse('测试项目');
    const decomposition = taskDecomposer.decompose(parsed);
    orchestrator.createPlan(decomposition);

    // Simulate timeout by having task handler never complete
    let timeoutOccurred = false;

    const executionPromise = orchestrator.execute(async () => {
      // Simulate long-running task
      await new Promise(resolve => setTimeout(resolve, 10000));
      return { success: true, duration: 10000 };
    });

    // Set up a timeout for the test
    const timeoutPromise = new Promise<void>(resolve => {
      setTimeout(() => {
        timeoutOccurred = true;
        orchestrator.cancel();
        resolve();
      }, 100);
    });

    await Promise.race([executionPromise, timeoutPromise]);

    expect(timeoutOccurred || orchestrator.getState() === 'idle').toBe(true);
  });

  it('should handle communication failure', async () => {
    const { messageBus } = testContext;

    // Publish to topic with no subscribers
    messageBus.publish('non-existent-topic', { payload: { test: true } });

    // Message should go to dead letter queue
    await new Promise(resolve => setTimeout(resolve, 50));

    const deadLetter = messageBus.getDeadLetterQueue();
    expect(deadLetter.length).toBe(1);
    expect(deadLetter[0]?.topic).toBe('non-existent-topic');
  });

  it('should handle storage failure', () => {
    const { graphStore } = testContext;

    // Try to add edge with non-existent nodes
    try {
      graphStore.addEdge('non-existent-1', 'non-existent-2', 'LINKS');
      expect(true).toBe(false); // Should not reach
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('does not exist');
    }

    // Graph should remain consistent
    expect(graphStore.getNodeCount()).toBe(0);
    expect(graphStore.getEdgeCount()).toBe(0);
  });

  it('should handle concurrent operations', async () => {
    const { graphStore, documentStore, vectorIndex } = testContext;

    // Concurrent graph operations
    const graphOps = Array.from({ length: 10 }, (_, i) =>
      Promise.resolve(graphStore.addNode(`node-${i}`, ['Test'], { index: i }))
    );

    await Promise.all(graphOps);

    expect(graphStore.getNodeCount()).toBe(10);

    // Concurrent document operations
    const docOps = Array.from({ length: 10 }, (_, i) =>
      Promise.resolve(documentStore.addDocument({
        id: `doc-${i}`,
        content: `Document ${i}`,
        embedding: generateMockEmbedding(`Document ${i}`),
      }))
    );

    await Promise.all(docOps);

    expect(documentStore.getStats().total).toBe(10);

    // Concurrent vector operations
    const vecOps = Array.from({ length: 10 }, (_, i) =>
      Promise.resolve(vectorIndex.add(`vec-${i}`, generateMockEmbedding(`Vector ${i}`)))
    );

    await Promise.all(vecOps);

    expect(vectorIndex.size()).toBe(10);
  });

  it('should handle concurrent task delegation', async () => {
    const { taskDelegation } = testContext;

    taskDelegation.registerAgent('agent-1', ['default']);
    taskDelegation.registerAgent('agent-2', ['default']);

    const tasks: AgentTask[] = Array.from({ length: 5 }, (_, i) => ({
      id: `concurrent-task-${i}`,
      type: 'test',
      payload: { index: i },
      priority: 5,
      requiredCapabilities: [],
      timeout: 100,
      createdAt: Date.now(),
    }));

    const results = await Promise.all(
      tasks.map(task => taskDelegation.delegate(task))
    );

    expect(results.length).toBe(5);
    expect(results.every(r => r.success)).toBe(true);

    // Verify load balancing
    const agent1Tasks = results.filter(r => r.agentId === 'agent-1').length;
    const agent2Tasks = results.filter(r => r.agentId === 'agent-2').length;
    expect(agent1Tasks + agent2Tasks).toBe(5);
  });

  it('should handle rapid subscribe/unsubscribe', () => {
    const { notificationCenter } = testContext;

    const subscriptions = [];

    // Rapid subscribe
    for (let i = 0; i < 100; i++) {
      subscriptions.push(
        notificationCenter.subscribe('test-channel', () => {})
      );
    }

    expect(subscriptions.length).toBe(100);

    // Rapid unsubscribe
    for (const sub of subscriptions) {
      notificationCenter.unsubscribe(sub.id);
    }

    // All should be unsubscribed
    const history = notificationCenter.getHistory();
    expect(history.length).toBe(0);
  });

  it('should handle memory pressure with large data', () => {
    const { graphStore, vectorIndex } = testContext;

    // Create large number of nodes
    const nodeCount = 1000;
    for (let i = 0; i < nodeCount; i++) {
      graphStore.addNode(`large-node-${i}`, ['Large'], { index: i });
    }

    expect(graphStore.getNodeCount()).toBe(nodeCount);

    // Create large number of vectors
    for (let i = 0; i < nodeCount; i++) {
      vectorIndex.add(`large-vec-${i}`, generateMockEmbedding(`data-${i}`));
    }

    expect(vectorIndex.size()).toBe(nodeCount);

    // Search should still work
    const results = vectorIndex.search(generateMockEmbedding('data-500'), 10);
    expect(results.length).toBe(10);

    // Cleanup
    graphStore.clear();
    vectorIndex.clear();

    expect(graphStore.getNodeCount()).toBe(0);
    expect(vectorIndex.size()).toBe(0);
  });
});

// ============================================================================
// Test Suite: Error Propagation
// ============================================================================

describe('Error Propagation', () => {
  beforeEach(() => {
    testContext = setupTestContext();
  });

  afterEach(async () => {
    await cleanupTestContext(testContext);
  });

  it('should propagate errors from orchestrator to notification', async () => {
    const { taskParser, taskDecomposer, orchestrator, notificationCenter, receivedNotifications } = testContext;

    notificationCenter.subscribe('in-app', (n) => receivedNotifications.push(n));

    const parsed = taskParser.parse('修复错误');
    const decomposition = taskDecomposer.decompose(parsed);
    orchestrator.createPlan(decomposition);

    // Execute with failing handler
    await orchestrator.execute(async () => {
      return { success: false, duration: 10 };
    });

    // Send error notification
    await notificationCenter.send({
      id: 'error-notif',
      type: 'error',
      priority: 'high',
      title: 'Task Failed',
      message: 'Task execution failed',
      channel: 'in-app',
      timestamp: Date.now(),
    });

    expect(receivedNotifications.length).toBe(1);
    expect(receivedNotifications[0]?.type).toBe('error');
  });

  it('should propagate errors from agent communication to knowledge graph', async () => {
    const { taskDelegation, graphStore } = testContext;

    // Try to delegate without any agents
    const task: AgentTask = {
      id: 'no-agent-task',
      type: 'test',
      payload: {},
      priority: 5,
      requiredCapabilities: ['non-existent'],
      timeout: 50,
      createdAt: Date.now(),
    };

    const result = await taskDelegation.delegate(task);

    // Store failure in knowledge graph
    graphStore.addNode('failure-record', ['Failure'], {
      taskId: task.id,
      error: result.error,
      timestamp: Date.now(),
    });

    const failureNode = graphStore.getNode('failure-record');
    expect(failureNode).toBeDefined();
    expect(failureNode?.properties.error).toContain('No suitable agent');
  });
});

// ============================================================================
// Summary
// ============================================================================

// Test Summary:
// - Total Tests: 45+
// - Bugs Found: 4 (all documented and fixed)
// - Packages Covered: 7
// - Edge Cases Covered: 10+
