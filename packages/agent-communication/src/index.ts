// src/index.ts - Export everything

export { MessageBus } from './message-bus.ts';
export type { Message, MessageType, MessageHandler, Subscription } from './message-bus.ts';

export { ProtocolNegotiator } from './protocol-negotiator.ts';
export type {
  ProtocolType,
  ProtocolVersion,
  AgentCapabilities,
  NegotiationResult,
} from './protocol-negotiator.ts';

export { TaskDelegationManager } from './task-delegation.ts';
export type {
  TaskState,
  LoadBalanceStrategy,
  AgentTask,
  AssignmentCriteria,
  TaskAssignment,
  TaskResult,
  TaskStatus,
} from './task-delegation.ts';

export { ConsensusEngine } from './consensus-engine.ts';
export type {
  VoteType,
  ConsensusAlgorithm,
  Proposal,
  Vote,
  ConsensusResult,
  ConsensusState,
} from './consensus-engine.ts';

export { AgentRegistry } from './agent-registry.ts';
export type { HealthStatus, AgentInfo, DiscoveryQuery } from './agent-registry.ts';

export { StreamingChannel } from './streaming-channel.ts';
export type { StreamEvent, StreamOptions, AgentStream } from './streaming-channel.ts';

export { RetryManager } from './retry-strategies.ts';
export type { RetryStrategy, CircuitState, RetryOptions } from './retry-strategies.ts';

export { MessageEncryptionLayer } from './message-encryption.ts';
export type { EncryptedMessage, KeyPair } from './message-encryption.ts';

export { CommunicationMetrics } from './communication-metrics.ts';
export type {
  MessageEvent,
  CommunicationMetricsReport,
  AgentCommunicationStats,
  TopicStats,
} from './communication-metrics.ts';

export { AgentGroupManager } from './group-manager.ts';
export type {
  GroupRole,
  GroupPhase,
  GroupConfig,
  GroupMember,
  AgentGroup,
  GroupInfo,
} from './group-manager.ts';
