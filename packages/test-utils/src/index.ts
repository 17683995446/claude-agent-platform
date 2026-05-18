// @claude-agent/test-utils - Shared testing utilities

export {
  createMockGraphStore,
  createMockStateStore,
  createMockEventSourcedStore,
  createMockReplicationManager,
  createMockWorkflowEngine,
  createMockPipelineBuilder,
  createMockLLMProvider,
  createMockDatabaseConnection,
  createMockHealthProbe,
  createMockAnomalyDetector,
  createMockCircuitBreaker,
} from './mock-factory.js';

export type {
  GraphNode,
  GraphEdge,
  MockGraphStoreConfig,
  CallTracker,
  MockGraphStore,
  MockStateStore,
  StoredEvent,
  MockEventSourcedStore,
  ReplicationStatus,
  MockReplicationManager,
  WorkflowInstance,
  MockWorkflowEngine,
  PipelineStage,
  MockPipelineBuilder,
  LLMResponse,
  MockLLMProvider,
  MockDatabaseConnection,
  HealthStatus,
  MockHealthProbe,
  AnomalyRecord,
  MockAnomalyDetector,
  CircuitState,
  MockCircuitBreaker,
} from './mock-factory.js';

export {
  generateCodeSnippet,
  generateGraphData,
  generateTimelineEvents,
  generateCRDTOperations,
  generateWorkflowDefinition,
  generatePipelineStages,
  generateUserSessions,
  generateAPIMockResponses,
} from './fixture-generator.js';

export type {
  CodeSnippet,
  GraphData,
  TimelineEvent,
  CRDTOperation,
  WorkflowStep,
  WorkflowBranch,
  WorkflowDefinition,
  PipelineStageDef,
  UserSession,
  APIMockResponse,
} from './fixture-generator.js';

export {
  assertGraphIntegrity,
  assertCRDTConvergence,
  assertEventOrdering,
  assertQuorumMet,
  assertPipelineResult,
  assertWorkflowCompleted,
  assertConsistency,
  assertPerformance,
  assertDeepEqual,
  assertNoLeaks,
} from './assertions.js';

export { AssertionError } from './assertions.js';
export type { CRDTStoreLike, InvariantFn } from './assertions.js';

export {
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
} from './test-helpers.js';

export type { TempStore, MockConsole, MockTimer } from './test-helpers.js';

export { ScenarioBuilder, createScenarioBuilder } from './scenario-builder.js';
export type { ScenarioConfig } from './scenario-builder.js';

export {
  forAll,
  shrink,
  generators,
  stringArbitrary,
  integerArbitrary,
  floatArbitrary,
  booleanArbitrary,
  arrayArbitrary,
  objectArbitrary,
  oneOfArbitrary,
  tupleArbitrary,
  recordArbitrary,
} from './property-based.js';

export type { Arbitrary, PropertyTestOptions, PropertyTestResult } from './property-based.js';

export {
  fuzzString,
  fuzzNumber,
  fuzzObject,
  fuzzJSON,
  mutateString,
  mutateNumber,
  mutateJSON,
} from './fuzz-helpers.js';

export type { FuzzResult } from './fuzz-helpers.js';

export {
  deepDiff,
  deepClone,
  deepMerge,
  isEqual,
  sortBy,
  groupBy,
  countBy,
  uniqBy,
} from './comparison-utils.js';

export type { DiffResult } from './comparison-utils.js';

export { MockClock, freezeTime, advanceTime, unfreezeTime, createTimestamp } from './time-helpers.js';

export { TestContext, createIsolatedContext } from './test-context.js';
export type { ContextSnapshot } from './test-context.js';
