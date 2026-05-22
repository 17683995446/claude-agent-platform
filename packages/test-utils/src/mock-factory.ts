// MockFactory: Create mock objects for all platform packages

export interface GraphNode {
  id: string;
  label: string;
  properties: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  weight: number;
}

export interface MockGraphStoreConfig {
  nodes?: GraphNode[];
  edges?: GraphEdge[];
}

export interface CallTracker {
  calls: Array<{ method: string; args: unknown[]; timestamp: number }>;
  track(method: string, args: unknown[]): void;
  getCallCount(method: string): number;
  getCallArgs(method: string): unknown[][];
  reset(): void;
}

function createCallTracker(): CallTracker {
  const tracker: CallTracker = {
    calls: [],
    track(method: string, args: unknown[]) {
      tracker.calls.push({ method, args, timestamp: Date.now() });
    },
    getCallCount(method: string) {
      return tracker.calls.filter((c) => c.method === method).length;
    },
    getCallArgs(method: string) {
      return tracker.calls.filter((c) => c.method === method).map((c) => c.args);
    },
    reset() {
      tracker.calls = [];
    },
  };
  return tracker;
}

export interface MockGraphStore {
  tracker: CallTracker;
  addNode(node: GraphNode): Promise<void>;
  getNode(id: string): Promise<GraphNode | undefined>;
  addEdge(edge: GraphEdge): Promise<void>;
  getEdge(id: string): Promise<GraphEdge | undefined>;
  getNeighbors(nodeId: string): Promise<GraphNode[]>;
  queryNodes(predicate: (node: GraphNode) => boolean): Promise<GraphNode[]>;
  removeNode(id: string): Promise<void>;
  removeEdge(id: string): Promise<void>;
  getAllNodes(): Promise<GraphNode[]>;
  getAllEdges(): Promise<GraphEdge[]>;
}

export function createMockGraphStore(config?: MockGraphStoreConfig): MockGraphStore {
  const tracker = createCallTracker();
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  for (const node of config?.nodes ?? []) {
    nodes.set(node.id, node);
  }
  for (const edge of config?.edges ?? []) {
    edges.set(edge.id, edge);
  }

  return {
    tracker,
    async addNode(node: GraphNode) {
      tracker.track('addNode', [node]);
      nodes.set(node.id, node);
    },
    async getNode(id: string) {
      tracker.track('getNode', [id]);
      return nodes.get(id);
    },
    async addEdge(edge: GraphEdge) {
      tracker.track('addEdge', [edge]);
      edges.set(edge.id, edge);
    },
    async getEdge(id: string) {
      tracker.track('getEdge', [id]);
      return edges.get(id);
    },
    async getNeighbors(nodeId: string) {
      tracker.track('getNeighbors', [nodeId]);
      const neighborIds = new Set<string>();
      for (const edge of edges.values()) {
        if (edge.source === nodeId) neighborIds.add(edge.target);
        if (edge.target === nodeId) neighborIds.add(edge.source);
      }
      return [...neighborIds]
        .map((id) => nodes.get(id))
        .filter((n): n is GraphNode => n !== undefined);
    },
    async queryNodes(predicate: (node: GraphNode) => boolean) {
      tracker.track('queryNodes', [predicate]);
      return [...nodes.values()].filter(predicate);
    },
    async removeNode(id: string) {
      tracker.track('removeNode', [id]);
      nodes.delete(id);
    },
    async removeEdge(id: string) {
      tracker.track('removeEdge', [id]);
      edges.delete(id);
    },
    async getAllNodes() {
      tracker.track('getAllNodes', []);
      return [...nodes.values()];
    },
    async getAllEdges() {
      tracker.track('getAllEdges', []);
      return [...edges.values()];
    },
  };
}

export interface MockStateStore {
  tracker: CallTracker;
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
  entries(): Promise<Array<[string, unknown]>>;
}

export function createMockStateStore(presetData?: Record<string, unknown>): MockStateStore {
  const tracker = createCallTracker();
  const store = new Map<string, unknown>(Object.entries(presetData ?? {}));

  return {
    tracker,
    async get(key: string) {
      tracker.track('get', [key]);
      return store.get(key);
    },
    async set(key: string, value: unknown) {
      tracker.track('set', [key, value]);
      store.set(key, value);
    },
    async delete(key: string) {
      tracker.track('delete', [key]);
      store.delete(key);
    },
    async has(key: string) {
      tracker.track('has', [key]);
      return store.has(key);
    },
    async clear() {
      tracker.track('clear', []);
      store.clear();
    },
    async keys() {
      tracker.track('keys', []);
      return [...store.keys()];
    },
    async entries() {
      tracker.track('entries', []);
      return [...store.entries()];
    },
  };
}

export interface StoredEvent {
  id: string;
  aggregateId: string;
  type: string;
  data: unknown;
  timestamp: number;
  version: number;
}

export interface MockEventSourcedStore {
  tracker: CallTracker;
  append(event: StoredEvent): Promise<void>;
  getEvents(aggregateId: string): Promise<StoredEvent[]>;
  getEventsByType(type: string): Promise<StoredEvent[]>;
  getSnapshot(aggregateId: string): Promise<unknown | null>;
  saveSnapshot(aggregateId: string, state: unknown): Promise<void>;
}

export function createMockEventSourcedStore(): MockEventSourcedStore {
  const tracker = createCallTracker();
  const events = new Map<string, StoredEvent[]>();
  const snapshots = new Map<string, unknown>();

  return {
    tracker,
    async append(event: StoredEvent) {
      tracker.track('append', [event]);
      const existing = events.get(event.aggregateId) ?? [];
      existing.push(event);
      events.set(event.aggregateId, existing);
    },
    async getEvents(aggregateId: string) {
      tracker.track('getEvents', [aggregateId]);
      return events.get(aggregateId) ?? [];
    },
    async getEventsByType(type: string) {
      tracker.track('getEventsByType', [type]);
      const result: StoredEvent[] = [];
      for (const evts of events.values()) {
        for (const evt of evts) {
          if (evt.type === type) result.push(evt);
        }
      }
      return result;
    },
    async getSnapshot(aggregateId: string) {
      tracker.track('getSnapshot', [aggregateId]);
      return snapshots.get(aggregateId) ?? null;
    },
    async saveSnapshot(aggregateId: string, state: unknown) {
      tracker.track('saveSnapshot', [aggregateId, state]);
      snapshots.set(aggregateId, state);
    },
  };
}

export interface ReplicationStatus {
  nodeId: string;
  lag: number;
  lastSync: number;
  state: 'syncing' | 'synced' | 'error';
}

export interface MockReplicationManager {
  tracker: CallTracker;
  replicate(data: unknown): Promise<void>;
  getStatus(): Promise<ReplicationStatus[]>;
  sync(nodeId: string): Promise<void>;
  addNode(nodeId: string): Promise<void>;
  removeNode(nodeId: string): Promise<void>;
}

export function createMockReplicationManager(): MockReplicationManager {
  const tracker = createCallTracker();
  const nodes = new Map<string, ReplicationStatus>();

  return {
    tracker,
    async replicate(_data: unknown) {
      tracker.track('replicate', [_data]);
    },
    async getStatus() {
      tracker.track('getStatus', []);
      return [...nodes.values()];
    },
    async sync(nodeId: string) {
      tracker.track('sync', [nodeId]);
      const status = nodes.get(nodeId);
      if (status) {
        status.state = 'synced';
        status.lastSync = Date.now();
        status.lag = 0;
      }
    },
    async addNode(nodeId: string) {
      tracker.track('addNode', [nodeId]);
      nodes.set(nodeId, {
        nodeId,
        lag: 0,
        lastSync: Date.now(),
        state: 'synced',
      });
    },
    async removeNode(nodeId: string) {
      tracker.track('removeNode', [nodeId]);
      nodes.delete(nodeId);
    },
  };
}

export interface WorkflowInstance {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
  currentStep: string;
  result?: unknown;
  error?: Error;
}

export interface MockWorkflowEngine {
  tracker: CallTracker;
  start(workflowId: string, input: unknown): Promise<WorkflowInstance>;
  pause(workflowId: string): Promise<void>;
  resume(workflowId: string): Promise<void>;
  cancel(workflowId: string): Promise<void>;
  getStatus(workflowId: string): Promise<WorkflowInstance | undefined>;
}

export function createMockWorkflowEngine(): MockWorkflowEngine {
  const tracker = createCallTracker();
  const instances = new Map<string, WorkflowInstance>();

  return {
    tracker,
    async start(workflowId: string, input: unknown) {
      tracker.track('start', [workflowId, input]);
      const instance: WorkflowInstance = {
        id: workflowId,
        status: 'running',
        currentStep: 'step-1',
      };
      instances.set(workflowId, instance);
      return instance;
    },
    async pause(workflowId: string) {
      tracker.track('pause', [workflowId]);
      const instance = instances.get(workflowId);
      if (instance) instance.status = 'paused';
    },
    async resume(workflowId: string) {
      tracker.track('resume', [workflowId]);
      const instance = instances.get(workflowId);
      if (instance && instance.status === 'paused') instance.status = 'running';
    },
    async cancel(workflowId: string) {
      tracker.track('cancel', [workflowId]);
      const instance = instances.get(workflowId);
      if (instance) instance.status = 'failed';
    },
    async getStatus(workflowId: string) {
      tracker.track('getStatus', [workflowId]);
      return instances.get(workflowId);
    },
  };
}

export interface PipelineStage {
  name: string;
  transform: (data: unknown) => Promise<unknown>;
}

export interface MockPipelineBuilder {
  tracker: CallTracker;
  stage(name: string, transform: (data: unknown) => Promise<unknown>): MockPipelineBuilder;
  build(): PipelineStage[];
  execute(data: unknown): Promise<unknown>;
}

export function createMockPipelineBuilder(): MockPipelineBuilder {
  const tracker = createCallTracker();
  const stages: PipelineStage[] = [];

  return {
    tracker,
    stage(name: string, transform: (data: unknown) => Promise<unknown>) {
      tracker.track('stage', [name, transform]);
      stages.push({ name, transform });
      return { ...createMockPipelineBuilder(), tracker, stage: this.stage, build: this.build, execute: this.execute } as unknown as MockPipelineBuilder;
    },
    async build() {
      tracker.track('build', []);
      return [...stages];
    },
    async execute(data: unknown) {
      tracker.track('execute', [data]);
      let result = data;
      for (const s of stages) {
        result = await s.transform(result);
      }
      return result;
    },
  };
}

export interface LLMResponse {
  content: string;
  tokens: number;
  model: string;
  finishReason: string;
}

export interface MockLLMProvider {
  tracker: CallTracker;
  complete(prompt: string, options?: Record<string, unknown>): Promise<LLMResponse>;
  stream(prompt: string): AsyncIterable<string>;
  embed(text: string): Promise<number[]>;
}

export function createMockLLMProvider(): MockLLMProvider {
  const tracker = createCallTracker();

  return {
    tracker,
    async complete(prompt: string, _options?: Record<string, unknown>) {
      tracker.track('complete', [prompt, _options]);
      return {
        content: `Mock response for: ${prompt}`,
        tokens: prompt.length,
        model: 'mock-model',
        finishReason: 'stop',
      };
    },
    async *stream(prompt: string) {
      tracker.track('stream', [prompt]);
      const words = `Mock stream for: ${prompt}`.split(' ');
      for (const word of words) {
        yield word + ' ';
      }
    },
    async embed(text: string) {
      tracker.track('embed', [text]);
      return Array.from({ length: 10 }, (_, i) => text.charCodeAt(i % text.length) / 255);
    },
  };
}

export interface MockDatabaseConnection {
  tracker: CallTracker;
  query(sql: string, params?: unknown[]): Promise<unknown[]>;
  execute(sql: string, params?: unknown[]): Promise<number>;
  transaction<T>(fn: (conn: MockDatabaseConnection) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  isConnected(): boolean;
}

export function createMockDatabaseConnection(): MockDatabaseConnection {
  const tracker = createCallTracker();
  let connected = true;

  return {
    tracker,
    async query(sql: string, params?: unknown[]) {
      tracker.track('query', [sql, params]);
      return [{ id: 1, result: 'mock' }];
    },
    async execute(sql: string, params?: unknown[]) {
      tracker.track('execute', [sql, params]);
      return 1;
    },
    async transaction<T>(fn: (conn: MockDatabaseConnection) => Promise<T>) {
      tracker.track('transaction', [fn]);
      return fn({ ...this, tracker });
    },
    async close() {
      tracker.track('close', []);
      connected = false;
    },
    isConnected() {
      return connected;
    },
  };
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: Array<{ name: string; status: string; latencyMs: number }>;
  timestamp: number;
}

export interface MockHealthProbe {
  tracker: CallTracker;
  check(component: string): Promise<HealthStatus>;
  checkAll(): Promise<Record<string, HealthStatus>>;
}

export function createMockHealthProbe(): MockHealthProbe {
  const tracker = createCallTracker();

  return {
    tracker,
    async check(component: string) {
      tracker.track('check', [component]);
      return {
        status: 'healthy',
        checks: [{ name: component, status: 'healthy', latencyMs: 1 }],
        timestamp: Date.now(),
      };
    },
    async checkAll() {
      tracker.track('checkAll', []);
      return {
        default: {
          status: 'healthy',
          checks: [{ name: 'default', status: 'healthy', latencyMs: 1 }],
          timestamp: Date.now(),
        },
      };
    },
  };
}

export interface AnomalyRecord {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  timestamp: number;
  data: unknown;
}

export interface MockAnomalyDetector {
  tracker: CallTracker;
  detect(data: unknown): Promise<AnomalyRecord[]>;
  train(data: unknown[]): Promise<void>;
  reset(): Promise<void>;
}

export function createMockAnomalyDetector(): MockAnomalyDetector {
  const tracker = createCallTracker();

  return {
    tracker,
    async detect(_data: unknown) {
      tracker.track('detect', [_data]);
      return [];
    },
    async train(_data: unknown[]) {
      tracker.track('train', [_data]);
    },
    async reset() {
      tracker.track('reset', []);
    },
  };
}

export interface CircuitState {
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  successCount: number;
  lastFailure: number | null;
}

export interface MockCircuitBreaker {
  tracker: CallTracker;
  execute<T>(fn: () => Promise<T>): Promise<T>;
  getState(): CircuitState;
  reset(): void;
  forceOpen(): void;
  forceClose(): void;
}

export function createMockCircuitBreaker(): MockCircuitBreaker {
  const tracker = createCallTracker();
  let state: CircuitState = {
    state: 'closed',
    failureCount: 0,
    successCount: 0,
    lastFailure: null,
  };

  return {
    tracker,
    async execute<T>(fn: () => Promise<T>) {
      tracker.track('execute', [fn]);
      if (state.state === 'open') {
        throw new Error('Circuit breaker is open');
      }
      try {
        const result = await fn();
        state.successCount++;
        if (state.state === 'half-open') {
          // BUG-006 [MEDIUM] When transitioning from half-open to closed, failureCount
          // was not reset. This meant the next failure would immediately re-open the
          // circuit since failureCount was still >= 5.
          state.state = 'closed';
          state.failureCount = 0;
        }
        return result;
      } catch (err) {
        state.failureCount++;
        state.lastFailure = Date.now();
        if (state.failureCount >= 5) {
          state.state = 'open';
        }
        throw err;
      }
    },
    getState() {
      tracker.track('getState', []);
      return { ...state };
    },
    reset() {
      tracker.track('reset', []);
      state = { state: 'closed', failureCount: 0, successCount: 0, lastFailure: null };
    },
    forceOpen() {
      tracker.track('forceOpen', []);
      state.state = 'open';
    },
    forceClose() {
      tracker.track('forceClose', []);
      state = { state: 'closed', failureCount: 0, successCount: 0, lastFailure: null };
    },
  };
}
