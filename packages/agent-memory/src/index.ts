/**
 * @claude-agent/agent-memory
 * Intelligent agent memory management with short-term, long-term, and working memory.
 */

// Types
export type { MemoryItem, WorkingMemoryStats } from './working-memory.js';
export type { Message, ShortTermMemoryStats } from './short-term-memory.js';
export type { LongTermMemoryEntry, LongTermMemoryOptions, SearchOptions, LongTermMemoryStats } from './long-term-memory.js';
export type { Episode, RecallOptions } from './episodic-memory.js';
export type { Concept, Relation, SemanticQueryOptions, SemanticStats } from './semantic-memory.js';
export type { MemoryForScoring } from './memory-prioritizer.js';
export type { ConsolidationStats } from './memory-consolidator.js';
export type { RetrievalOptions, RetrievedMemory } from './memory-retriever.js';
export type { MemoryManagerConfig, MemoryStats, RememberOptions, RecallOptions as ManagerRecallOptions } from './memory-manager.js';
export type { SerializedMemoryState, MemoryStateDiff } from './memory-serializer.js';

// Classes
export { WorkingMemory } from './working-memory.js';
export { ShortTermMemory } from './short-term-memory.js';
export { LongTermMemory } from './long-term-memory.js';
export { EpisodicMemory } from './episodic-memory.js';
export { SemanticMemory } from './semantic-memory.js';
export { MemoryPrioritizer } from './memory-prioritizer.js';
export { MemoryConsolidator } from './memory-consolidator.js';
export { MemoryRetriever } from './memory-retriever.js';
export { MemoryManager } from './memory-manager.js';
export { MemorySerializer } from './memory-serializer.js';
