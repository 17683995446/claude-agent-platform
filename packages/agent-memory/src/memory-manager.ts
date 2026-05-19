/**
 * MemoryManager - Main entry point coordinating all memory systems.
 */

import { WorkingMemory } from './working-memory.js';
import { ShortTermMemory } from './short-term-memory.js';
import { LongTermMemory } from './long-term-memory.js';
import { EpisodicMemory } from './episodic-memory.js';
import { SemanticMemory } from './semantic-memory.js';
import { MemoryConsolidator } from './memory-consolidator.js';
import { MemoryRetriever } from './memory-retriever.js';
import { MemorySerializer } from './memory-serializer.js';

export interface MemoryManagerConfig {
  workingMemoryCapacity?: number;
  shortTermMaxTokens?: number;
  longTermMaxEntries?: number;
  autoConsolidate?: boolean;
}

export interface MemoryStats {
  working: ReturnType<WorkingMemory['getStats']>;
  shortTerm: ReturnType<ShortTermMemory['getStats']>;
  longTerm: ReturnType<LongTermMemory['getStats']>;
  episodic: ReturnType<EpisodicMemory['getStats']>;
  semantic: ReturnType<SemanticMemory['getStats']>;
  consolidation: ReturnType<MemoryConsolidator['getConsolidationStats']>;
}

export interface RememberOptions {
  tier?: 'working' | 'short-term' | 'long-term' | 'episodic' | 'semantic';
  tags?: string[];
  importance?: number;
  metadata?: Record<string, unknown>;
}

export interface RecallOptions {
  tiers?: Array<'working' | 'short-term' | 'long-term' | 'episodic' | 'semantic'>;
  maxItems?: number;
  tags?: string[];
}

export class MemoryManager {
  private config: MemoryManagerConfig;
  private workingMemory: WorkingMemory;
  private shortTermMemory: ShortTermMemory;
  private longTermMemory: LongTermMemory;
  private episodicMemory: EpisodicMemory;
  private semanticMemory: SemanticMemory;
  private consolidator: MemoryConsolidator;
  private retriever: MemoryRetriever;
  private serializer: MemorySerializer;
  private initialized: boolean = false;

  constructor(config: MemoryManagerConfig = {}) {
    this.config = {
      workingMemoryCapacity: config.workingMemoryCapacity ?? 7,
      shortTermMaxTokens: config.shortTermMaxTokens ?? 4096,
      longTermMaxEntries: config.longTermMaxEntries ?? 10000,
      autoConsolidate: config.autoConsolidate ?? false,
    };

    this.workingMemory = new WorkingMemory(this.config.workingMemoryCapacity);
    this.shortTermMemory = new ShortTermMemory(this.config.shortTermMaxTokens);
    this.longTermMemory = new LongTermMemory({ maxEntries: this.config.longTermMaxEntries });
    this.episodicMemory = new EpisodicMemory();
    this.semanticMemory = new SemanticMemory();
    this.consolidator = new MemoryConsolidator();
    this.serializer = new MemorySerializer();
    this.retriever = new MemoryRetriever(
      this.workingMemory,
      this.shortTermMemory,
      this.longTermMemory,
      this.episodicMemory,
      this.semanticMemory
    );
  }

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  remember(content: string, options: RememberOptions = {}): void {
    const tier = options.tier ?? 'working';
    const timestamp = Date.now();

    switch (tier) {
      case 'working':
        this.workingMemory.add({
          id: `wm-${timestamp}-${Math.random().toString(36).slice(2, 7)}`,
          content,
          type: 'context',
          relevance: options.importance ?? 0.5,
          timestamp,
          accessCount: 0,
          metadata: options.metadata ?? {},
        });
        break;
      case 'short-term':
        this.shortTermMemory.addMessage('user', content, options.metadata);
        break;
      case 'long-term':
        this.longTermMemory.store(
          `lt-${timestamp}-${Math.random().toString(36).slice(2, 7)}`,
          content,
          options.tags ?? [],
          { ...options.metadata, importance: options.importance }
        );
        break;
      case 'episodic':
        this.episodicMemory.record({
          context: content,
          actions: [],
          outcome: '',
          emotion: 'neutral',
          importance: options.importance ?? 0.5,
          tags: options.tags ?? [],
          lessons: [],
        });
        break;
      case 'semantic':
        this.semanticMemory.addConcept(
          `concept-${timestamp}`,
          content,
          options.metadata ?? {}
        );
        break;
    }

    if (this.config.autoConsolidate) {
      this.consolidate();
    }
  }

  recall(query: string, options: RecallOptions = {}): ReturnType<MemoryRetriever['retrieve']> {
    return this.retriever.retrieve(query, {
      maxItems: options.maxItems,
      tiers: options.tiers,
      tags: options.tags,
    });
  }

  forget(criteria: {
    tags?: string[];
    maxAge?: number;
    minImportance?: number;
    pattern?: string;
  }): number {
    return this.longTermMemory.forget(criteria);
  }

  consolidate(): void {
    this.consolidator.consolidateWorkingToShortTerm(this.workingMemory, this.shortTermMemory);
    this.consolidator.consolidateShortToLongTerm(this.shortTermMemory, this.longTermMemory);
  }

  getContext(window?: number): string {
    const recentMemories = window
      ? this.retriever.retrieveRecent(window)
      : this.retriever.retrieveRelevant('', 20);
    return this.retriever.formatContext(recentMemories);
  }

  getStats(): MemoryStats {
    return {
      working: this.workingMemory.getStats(),
      shortTerm: this.shortTermMemory.getStats(),
      longTerm: this.longTermMemory.getStats(),
      episodic: this.episodicMemory.getStats(),
      semantic: this.semanticMemory.getStats(),
      consolidation: this.consolidator.getConsolidationStats(),
    };
  }

  export(): ReturnType<MemorySerializer['serialize']> {
    return this.serializer.serialize(this);
  }

  import(data: ReturnType<MemorySerializer['serialize']>): void {
    this.serializer.deserialize(data, this);
  }

  reset(): void {
    this.workingMemory.clear();
    this.shortTermMemory.clear();
    // Clear long-term entries
    const entries = this.longTermMemory.export();
    for (const entry of entries) {
      this.longTermMemory.delete(entry.key);
    }
    this.episodicMemory.clear();
    this.semanticMemory.clear();
    this.initialized = false;
  }

  // Expose sub-components for advanced usage
  getWorkingMemory(): WorkingMemory { return this.workingMemory; }
  getShortTermMemory(): ShortTermMemory { return this.shortTermMemory; }
  getLongTermMemory(): LongTermMemory { return this.longTermMemory; }
  getEpisodicMemory(): EpisodicMemory { return this.episodicMemory; }
  getSemanticMemory(): SemanticMemory { return this.semanticMemory; }
  getConsolidator(): MemoryConsolidator { return this.consolidator; }
  getRetriever(): MemoryRetriever { return this.retriever; }
  getSerializer(): MemorySerializer { return this.serializer; }
  isInitialized(): boolean { return this.initialized; }
}
