/**
 * MemoryConsolidator - Move memories between tiers and manage consolidation.
 */

import type { MemoryItem } from './working-memory.js';
import type { Message } from './short-term-memory.js';
import type { LongTermMemoryEntry } from './long-term-memory.js';
import type { LongTermMemory } from './long-term-memory.js';
import type { WorkingMemory } from './working-memory.js';
import type { ShortTermMemory } from './short-term-memory.js';
import { MemoryPrioritizer } from './memory-prioritizer.js';

export interface ConsolidationStats {
  workingToShortTerm: number;
  shortToLongTerm: number;
  keyPointsExtracted: number;
  memoriesMerged: number;
  memoriesPruned: number;
  lastConsolidation: number;
}

export class MemoryConsolidator {
  private prioritizer = new MemoryPrioritizer();
  private stats: ConsolidationStats = {
    workingToShortTerm: 0,
    shortToLongTerm: 0,
    keyPointsExtracted: 0,
    memoriesMerged: 0,
    memoriesPruned: 0,
    lastConsolidation: 0,
  };

  /**
   * Consolidate working memory items into short-term memory as messages.
   */
  consolidateWorkingToShortTerm(working: WorkingMemory, shortTerm: ShortTermMemory): number {
    const items = working.consolidate(); // removes low-priority items
    let count = 0;
    for (const item of items) {
      shortTerm.addMessage('system', `[consolidated] ${item.type}: ${item.content}`, {
        source: 'working-memory',
        originalId: item.id,
        relevance: item.relevance,
      });
      count++;
    }
    this.stats.workingToShortTerm += count;
    this.stats.lastConsolidation = Date.now();
    return count;
  }

  /**
   * Consolidate short-term messages into long-term memory.
   */
  consolidateShortToLongTerm(shortTerm: ShortTermMemory, longTerm: LongTermMemory): number {
    const messages = shortTerm.getRecent(50); // get recent messages
    const keyPoints = this.extractKeyPoints(messages);
    let count = 0;
    for (const point of keyPoints) {
      longTerm.store(point.key, point.value, point.tags, {
        source: 'short-term-memory',
        consolidatedAt: Date.now(),
      });
      count++;
    }
    this.stats.shortToLongTerm += count;
    this.stats.keyPointsExtracted += keyPoints.length;
    this.stats.lastConsolidation = Date.now();
    return count;
  }

  /**
   * Extract key points from conversation messages.
   */
  extractKeyPoints(messages: Message[]): Array<{ key: string; value: string; tags: string[] }> {
    if (messages.length === 0) return [];
    const points: Array<{ key: string; value: string; tags: string[] }> = [];
    const seen = new Set<string>();

    // Extract from user messages (likely contain important info)
    const userMessages = messages.filter((m) => m.role === 'user');
    for (const msg of userMessages) {
      const key = `user-input-${msg.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        points.push({
          key,
          value: msg.content,
          tags: ['user-input', 'conversation'],
        });
      }
    }

    // Extract from assistant messages (likely contain decisions/answers)
    const assistantMessages = messages.filter((m) => m.role === 'assistant');
    for (const msg of assistantMessages) {
      const key = `assistant-response-${msg.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        points.push({
          key,
          value: msg.content,
          tags: ['assistant-response', 'conversation'],
        });
      }
    }

    return points;
  }

  /**
   * Generate a summary from a set of memories.
   */
  generateSummary(memories: LongTermMemoryEntry[]): string {
    if (memories.length === 0) return 'No memories to summarize.';
    const tags = new Set(memories.flatMap((m) => m.tags));
    const totalImportance = memories.reduce((s, m) => s + m.importance, 0);
    const avgImportance = totalImportance / memories.length;
    return `Summary of ${memories.length} memories. Tags: ${Array.from(tags).join(', ') || 'none'}. Average importance: ${avgImportance.toFixed(2)}.`;
  }

  /**
   * Merge related long-term memories.
   */
  mergeRelated(longTerm: LongTermMemory): number {
    const all = longTerm.export();
    let merged = 0;
    const mergedAway = new Set<string>();

    for (let i = 0; i < all.length; i++) {
      if (mergedAway.has(all[i]!.key)) continue;
      for (let j = i + 1; j < all.length; j++) {
        if (mergedAway.has(all[j]!.key)) continue;
        // Check tag overlap
        const commonTags = all[i]!.tags.filter((t) => all[j]!.tags.includes(t));
        if (commonTags.length >= 2) {
          // Merge j into i
          all[i]!.tags = [...new Set([...all[i]!.tags, ...all[j]!.tags])];
          all[i]!.importance = Math.max(all[i]!.importance, all[j]!.importance);
          all[i]!.accessCount += all[j]!.accessCount;
          mergedAway.add(all[j]!.key);
          merged++;
        }
      }
    }

    // Delete all merged-away entries from long-term memory
    for (const key of mergedAway) {
      longTerm.delete(key);
    }

    // Update surviving entries that were modified during merge
    // Delete surviving entries first, then re-import with merged values
    const surviving = all.filter((e) => !mergedAway.has(e.key));
    for (const entry of surviving) {
      longTerm.delete(entry.key);
    }
    longTerm.import(surviving);

    this.stats.memoriesMerged += merged;
    return merged;
  }

  /**
   * Remove low-importance memories from long-term storage.
   */
  pruneUnimportant(longTerm: LongTermMemory, threshold: number = 0.2): number {
    const all = longTerm.export();
    let pruned = 0;
    for (const entry of all) {
      const memory = {
        id: entry.key,
        content: typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value),
        timestamp: entry.timestamp,
        accessCount: entry.accessCount,
        relevance: entry.importance,
      };
      if (this.prioritizer.shouldForget(memory, threshold)) {
        longTerm.delete(entry.key);
        pruned++;
      }
    }
    this.stats.memoriesPruned += pruned;
    return pruned;
  }

  getConsolidationStats(): ConsolidationStats {
    return { ...this.stats };
  }
}
