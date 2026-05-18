/**
 * MemoryRetriever - Unified memory retrieval across all memory tiers.
 */

import type { WorkingMemory } from './working-memory.js';
import type { ShortTermMemory } from './short-term-memory.js';
import type { LongTermMemory } from './long-term-memory.js';
import type { EpisodicMemory } from './episodic-memory.js';
import type { SemanticMemory } from './semantic-memory.js';
import { MemoryPrioritizer } from './memory-prioritizer.js';
import type { MemoryForScoring } from './memory-prioritizer.js';

export interface RetrievalOptions {
  maxItems?: number;
  tiers?: Array<'working' | 'short-term' | 'long-term' | 'episodic' | 'semantic'>;
  minImportance?: number;
  tags?: string[];
}

export interface RetrievedMemory {
  tier: string;
  id: string;
  content: string;
  relevance: number;
  metadata: Record<string, unknown>;
  timestamp: number;
}

export class MemoryRetriever {
  private working: WorkingMemory;
  private shortTerm: ShortTermMemory;
  private longTerm: LongTermMemory;
  private episodic: EpisodicMemory;
  private semantic: SemanticMemory;
  private prioritizer = new MemoryPrioritizer();

  constructor(
    working: WorkingMemory,
    shortTerm: ShortTermMemory,
    longTerm: LongTermMemory,
    episodic: EpisodicMemory,
    semantic: SemanticMemory
  ) {
    this.working = working;
    this.shortTerm = shortTerm;
    this.longTerm = longTerm;
    this.episodic = episodic;
    this.semantic = semantic;
  }

  retrieve(query: string, options: RetrievalOptions = {}): RetrievedMemory[] {
    const results: RetrievedMemory[] = [];
    const tiers = options.tiers ?? ['working', 'short-term', 'long-term', 'episodic', 'semantic'];

    if (tiers.includes('working')) {
      const items = this.working.search(query);
      for (const item of items) {
        results.push({
          tier: 'working',
          id: item.id,
          content: item.content,
          relevance: this.prioritizer.relevanceScore(
            { content: item.content, timestamp: item.timestamp, accessCount: item.accessCount, id: item.id },
            query
          ),
          metadata: item.metadata,
          timestamp: item.timestamp,
        });
      }
    }

    if (tiers.includes('short-term')) {
      const messages = this.shortTerm.search(query);
      for (const msg of messages) {
        results.push({
          tier: 'short-term',
          id: msg.id,
          content: msg.content,
          relevance: this.prioritizer.relevanceScore(
            { content: msg.content, timestamp: msg.timestamp, accessCount: 0, id: msg.id },
            query
          ),
          metadata: msg.metadata,
          timestamp: msg.timestamp,
        });
      }
    }

    if (tiers.includes('long-term')) {
      const entries = this.longTerm.search(query, { limit: options.maxItems });
      for (const entry of entries) {
        results.push({
          tier: 'long-term',
          id: entry.key,
          content: typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value),
          relevance: entry.importance,
          metadata: { ...entry.metadata, tags: entry.tags },
          timestamp: entry.timestamp,
        });
      }
    }

    if (tiers.includes('episodic')) {
      const episodes = this.episodic.recall(query, { limit: options.maxItems });
      for (const ep of episodes) {
        results.push({
          tier: 'episodic',
          id: ep.id,
          content: `${ep.context} -> ${ep.outcome}`,
          relevance: ep.importance,
          metadata: { emotion: ep.emotion, tags: ep.tags, lessons: ep.lessons },
          timestamp: ep.timestamp,
        });
      }
    }

    if (tiers.includes('semantic')) {
      const concepts = this.semantic.query(query, { limit: options.maxItems });
      for (const concept of concepts) {
        results.push({
          tier: 'semantic',
          id: concept.name,
          content: concept.description,
          relevance: 0.7,
          metadata: concept.properties,
          timestamp: Date.now(),
        });
      }
    }

    return this.rankResults(results, query).slice(0, options.maxItems ?? results.length);
  }

  retrieveRelevant(context: string, maxItems: number = 10): RetrievedMemory[] {
    return this.retrieve(context, { maxItems }).slice(0, maxItems);
  }

  retrieveRecent(timeWindow: number): RetrievedMemory[] {
    const cutoff = Date.now() - timeWindow;
    const results: RetrievedMemory[] = [];

    for (const item of this.working.getAll()) {
      if (item.timestamp >= cutoff) {
        results.push({
          tier: 'working',
          id: item.id,
          content: item.content,
          relevance: item.relevance,
          metadata: item.metadata,
          timestamp: item.timestamp,
        });
      }
    }

    for (const msg of this.shortTerm.getRecent(100)) {
      if (msg.timestamp >= cutoff) {
        results.push({
          tier: 'short-term',
          id: msg.id,
          content: msg.content,
          relevance: 0.5,
          metadata: msg.metadata,
          timestamp: msg.timestamp,
        });
      }
    }

    const ltEntries = this.longTerm.getByTimeRange(cutoff, Date.now());
    for (const entry of ltEntries) {
      results.push({
        tier: 'long-term',
        id: entry.key,
        content: typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value),
        relevance: entry.importance,
        metadata: { ...entry.metadata, tags: entry.tags },
        timestamp: entry.timestamp,
      });
    }

    return results.sort((a, b) => b.timestamp - a.timestamp);
  }

  retrieveByTag(tag: string): RetrievedMemory[] {
    const results: RetrievedMemory[] = [];

    const ltEntries = this.longTerm.getByTag(tag);
    for (const entry of ltEntries) {
      results.push({
        tier: 'long-term',
        id: entry.key,
        content: typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value),
        relevance: entry.importance,
        metadata: { ...entry.metadata, tags: entry.tags },
        timestamp: entry.timestamp,
      });
    }

    return results;
  }

  rankResults(results: RetrievedMemory[], context: string): RetrievedMemory[] {
    return [...results].sort((a, b) => b.relevance - a.relevance);
  }

  formatContext(memories: RetrievedMemory[]): string {
    if (memories.length === 0) return 'No relevant memories found.';
    const sections: string[] = [];
    const grouped = new Map<string, RetrievedMemory[]>();
    for (const mem of memories) {
      const tier = mem.tier;
      if (!grouped.has(tier)) grouped.set(tier, []);
      grouped.get(tier)!.push(mem);
    }
    for (const [tier, items] of grouped) {
      sections.push(`[${tier.toUpperCase()}]`);
      for (const item of items) {
        sections.push(`  - ${item.content}`);
      }
    }
    return sections.join('\n');
  }
}
