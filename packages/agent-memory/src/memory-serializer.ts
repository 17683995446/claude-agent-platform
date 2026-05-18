/**
 * MemorySerializer - Serialize/deserialize memory state for persistence.
 */

import type { MemoryManager } from './memory-manager.js';
import type { WorkingMemory } from './working-memory.js';
import type { ShortTermMemory } from './short-term-memory.js';
import type { LongTermMemory } from './long-term-memory.js';
import type { EpisodicMemory } from './episodic-memory.js';
import type { SemanticMemory } from './semantic-memory.js';

export interface SerializedMemoryState {
  version: string;
  timestamp: number;
  workingMemory: ReturnType<WorkingMemory['getAll']>;
  shortTermMemory: ReturnType<ShortTermMemory['getRecent']>;
  longTermMemory: ReturnType<LongTermMemory['export']>;
  episodicMemory: ReturnType<EpisodicMemory['getAll']>;
  semanticMemory: ReturnType<SemanticMemory['export']>;
}

export interface MemoryStateDiff {
  added: {
    working: number;
    shortTerm: number;
    longTerm: number;
    episodic: number;
    semantic: number;
  };
  removed: {
    working: number;
    shortTerm: number;
    longTerm: number;
    episodic: number;
    semantic: number;
  };
  modified: {
    longTerm: number;
  };
}

export class MemorySerializer {
  private version = '1.0.0';

  /**
   * Serialize the entire memory manager state.
   */
  serialize(manager: MemoryManager): SerializedMemoryState {
    return {
      version: this.version,
      timestamp: Date.now(),
      workingMemory: manager.getWorkingMemory().getAll(),
      shortTermMemory: manager.getShortTermMemory().getRecent(10000),
      longTermMemory: manager.getLongTermMemory().export(),
      episodicMemory: manager.getEpisodicMemory().getAll(),
      semanticMemory: manager.getSemanticMemory().export(),
    };
  }

  /**
   * Deserialize and restore memory manager state.
   */
  deserialize(data: SerializedMemoryState, manager?: MemoryManager): void {
    if (!this.validateState(data)) {
      throw new Error('Invalid memory state data');
    }
    // Note: In a real implementation, this would restore state to the manager.
    // For now, we validate and return.
    if (manager) {
      // Restore working memory
      const wm = manager.getWorkingMemory();
      wm.clear();
      for (const item of data.workingMemory) {
        wm.add(item);
      }
      // Restore long-term memory
      const ltm = manager.getLongTermMemory();
      ltm.import(data.longTermMemory);
      // Restore episodic memory
      const em = manager.getEpisodicMemory();
      for (const ep of data.episodicMemory) {
        em.record(ep);
      }
      // Restore semantic memory
      const sm = manager.getSemanticMemory();
      sm.import(data.semanticMemory);
    }
  }

  /**
   * Serialize a single memory tier.
   */
  serializeTier(
    memory: WorkingMemory | ShortTermMemory | LongTermMemory | EpisodicMemory | SemanticMemory,
    type: string
  ): unknown {
    switch (type) {
      case 'working':
        return (memory as WorkingMemory).getAll();
      case 'short-term':
        return (memory as ShortTermMemory).getRecent(10000);
      case 'long-term':
        return (memory as LongTermMemory).export();
      case 'episodic':
        return (memory as EpisodicMemory).getAll();
      case 'semantic':
        return (memory as SemanticMemory).export();
      default:
        throw new Error(`Unknown memory tier type: ${type}`);
    }
  }

  /**
   * Deserialize a single memory tier.
   */
  deserializeTier(data: unknown, type: string): unknown {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid tier data');
    }
    switch (type) {
      case 'working':
      case 'short-term':
      case 'long-term':
      case 'episodic':
      case 'semantic':
        return data;
      default:
        throw new Error(`Unknown memory tier type: ${type}`);
    }
  }

  /**
   * Export as formatted JSON string.
   */
  exportToJSON(manager: MemoryManager): string {
    const state = this.serialize(manager);
    return JSON.stringify(state, null, 2);
  }

  /**
   * Import from JSON string.
   */
  importFromJSON(json: string): SerializedMemoryState {
    const data = JSON.parse(json) as SerializedMemoryState;
    if (!this.validateState(data)) {
      throw new Error('Invalid JSON memory state');
    }
    return data;
  }

  /**
   * Diff two memory states.
   */
  diff(oldState: SerializedMemoryState, newState: SerializedMemoryState): MemoryStateDiff {
    const oldWorkingIds = new Set(oldState.workingMemory.map((i) => i.id));
    const newWorkingIds = new Set(newState.workingMemory.map((i) => i.id));
    const oldLtKeys = new Set(oldState.longTermMemory.map((e) => e.key));
    const newLtKeys = new Set(newState.longTermMemory.map((e) => e.key));

    return {
      added: {
        working: newState.workingMemory.filter((i) => !oldWorkingIds.has(i.id)).length,
        shortTerm: newState.shortTermMemory.length - oldState.shortTermMemory.length,
        longTerm: newState.longTermMemory.filter((e) => !oldLtKeys.has(e.key)).length,
        episodic: newState.episodicMemory.length - oldState.episodicMemory.length,
        semantic: newState.semanticMemory.concepts.length - oldState.semanticMemory.concepts.length,
      },
      removed: {
        working: oldState.workingMemory.filter((i) => !newWorkingIds.has(i.id)).length,
        shortTerm: Math.max(0, oldState.shortTermMemory.length - newState.shortTermMemory.length),
        longTerm: oldState.longTermMemory.filter((e) => !newLtKeys.has(e.key)).length,
        episodic: Math.max(0, oldState.episodicMemory.length - newState.episodicMemory.length),
        semantic: Math.max(0, oldState.semanticMemory.concepts.length - newState.semanticMemory.concepts.length),
      },
      modified: {
        longTerm: newState.longTermMemory.filter(
          (e) => oldLtKeys.has(e.key) && e.accessCount !== oldState.longTermMemory.find((o) => o.key === e.key)?.accessCount
        ).length,
      },
    };
  }

  /**
   * Merge multiple memory states.
   */
  mergeStates(states: SerializedMemoryState[]): SerializedMemoryState {
    if (states.length === 0) {
      throw new Error('No states to merge');
    }
    const base = states[0]!;
    const merged: SerializedMemoryState = {
      version: this.version,
      timestamp: Date.now(),
      workingMemory: [...base.workingMemory],
      shortTermMemory: [...base.shortTermMemory],
      longTermMemory: [...base.longTermMemory],
      episodicMemory: [...base.episodicMemory],
      semanticMemory: {
        concepts: [...base.semanticMemory.concepts],
        relations: [...base.semanticMemory.relations],
      },
    };

    const wmIds = new Set(merged.workingMemory.map((i) => i.id));
    const ltKeys = new Set(merged.longTermMemory.map((e) => e.key));
    const epIds = new Set(merged.episodicMemory.map((e) => e.id));
    const conceptNames = new Set(merged.semanticMemory.concepts.map((c) => c.name));

    for (let i = 1; i < states.length; i++) {
      const state = states[i]!;
      for (const item of state.workingMemory) {
        if (!wmIds.has(item.id)) {
          merged.workingMemory.push(item);
          wmIds.add(item.id);
        }
      }
      merged.shortTermMemory.push(...state.shortTermMemory);
      for (const entry of state.longTermMemory) {
        if (!ltKeys.has(entry.key)) {
          merged.longTermMemory.push(entry);
          ltKeys.add(entry.key);
        }
      }
      for (const ep of state.episodicMemory) {
        if (!epIds.has(ep.id)) {
          merged.episodicMemory.push(ep);
          epIds.add(ep.id);
        }
      }
      for (const concept of state.semanticMemory.concepts) {
        if (!conceptNames.has(concept.name)) {
          merged.semanticMemory.concepts.push(concept);
          conceptNames.add(concept.name);
        }
      }
      for (const rel of state.semanticMemory.relations) {
        const exists = merged.semanticMemory.relations.some(
          (r) => r.from === rel.from && r.to === rel.to && r.type === rel.type
        );
        if (!exists) {
          merged.semanticMemory.relations.push(rel);
        }
      }
    }

    return merged;
  }

  /**
   * Validate memory state integrity.
   */
  validateState(state: unknown): state is SerializedMemoryState {
    if (!state || typeof state !== 'object') return false;
    const s = state as Record<string, unknown>;
    return (
      typeof s.version === 'string' &&
      typeof s.timestamp === 'number' &&
      Array.isArray(s.workingMemory) &&
      Array.isArray(s.shortTermMemory) &&
      Array.isArray(s.longTermMemory) &&
      Array.isArray(s.episodicMemory) &&
      typeof s.semanticMemory === 'object' &&
      s.semanticMemory !== null &&
      Array.isArray((s.semanticMemory as Record<string, unknown>).concepts) &&
      Array.isArray((s.semanticMemory as Record<string, unknown>).relations)
    );
  }
}
