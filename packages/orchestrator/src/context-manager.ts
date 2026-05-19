// ============================================================================
// ContextManager - Project Context Window Management
// ============================================================================

import type { ContextEntry, ContextWindowConfig } from './types.js';

// ---- Context ID generator ----

let contextCounter = 0;

function generateContextId(): string {
  contextCounter++;
  return `ctx-${Date.now().toString(36)}-${contextCounter.toString(36)}`;
}

// ---- Rough token estimation (1 token ~ 4 chars for English, ~2 chars for Chinese) ----

function estimateTokens(value: unknown): number {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (!str) return 0;
  const zhChars = (str.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherChars = str.length - zhChars;
  return Math.ceil(zhChars / 2 + otherChars / 4);
}

// ---- ContextManager Class ----

export class ContextManager {
  private entries: Map<string, ContextEntry> = new Map();
  private config: ContextWindowConfig;
  private persistencePath: string | null;

  constructor(config?: Partial<ContextWindowConfig>, persistencePath?: string) {
    const defaults: ContextWindowConfig = {
      maxTokens: 128000,
      reservedTokens: 1000,
      compressionThreshold: 0.8,
      strategy: 'lru',
    };
    this.config = { ...defaults, ...config };
    this.persistencePath = persistencePath ?? null;
  }

  /** Get current configuration */
  getConfig(): ContextWindowConfig {
    return { ...this.config };
  }

  /** Update configuration */
  updateConfig(config: Partial<ContextWindowConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** Get total token usage */
  getTotalTokens(): number {
    let total = 0;
    for (const entry of this.entries.values()) {
      total += entry.tokenCount;
    }
    return total;
  }

  /** Get available token budget */
  getAvailableTokens(): number {
    return this.config.maxTokens - this.config.reservedTokens - this.getTotalTokens();
  }

  /** Get number of entries */
  getEntryCount(): number {
    return this.entries.size;
  }

  /** Add a context entry */
  add(entry: Omit<ContextEntry, 'id' | 'tokenCount' | 'lastAccessedAt' | 'createdAt'>): ContextEntry {
    const tokenCount = estimateTokens(entry.value);
    const now = new Date();

    const contextEntry: ContextEntry = {
      ...entry,
      id: generateContextId(),
      tokenCount,
      lastAccessedAt: now,
      createdAt: now,
    };

    // Check if we need to compress before adding
    if (this.getTotalTokens() + tokenCount > this.config.maxTokens * this.config.compressionThreshold) {
      this.compress();
    }

    // Post-compression space verification
    if (this.getTotalTokens() + tokenCount > this.config.maxTokens) {
      // Still over budget after compression; skip adding to prevent overflow
      return contextEntry;
    }

    this.entries.set(contextEntry.id, contextEntry);
    return contextEntry;
  }

  /** Get a context entry by ID */
  get(id: string): ContextEntry | undefined {
    const entry = this.entries.get(id);
    if (entry) {
      entry.lastAccessedAt = new Date();
    }
    return entry;
  }

  /** Get entries by type */
  getByType(type: ContextEntry['type']): ContextEntry[] {
    return Array.from(this.entries.values())
      .filter((e) => e.type === type);
  }

  /** Get entries by key pattern */
  getByKeyPattern(pattern: RegExp): ContextEntry[] {
    return Array.from(this.entries.values())
      .filter((e) => pattern.test(e.key));
  }

  /** Remove a context entry */
  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  /** Update a context entry */
  update(id: string, updates: Partial<Pick<ContextEntry, 'value' | 'priority'>>): ContextEntry | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;

    if (updates.value !== undefined) {
      entry.value = updates.value;
      entry.tokenCount = estimateTokens(updates.value);
    }
    if (updates.priority !== undefined) {
      entry.priority = updates.priority;
    }
    entry.lastAccessedAt = new Date();

    return entry;
  }

  /** Compress context using the configured strategy */
  compress(): number {
    const availableBudget = this.config.maxTokens * this.config.compressionThreshold;
    const currentUsage = this.getTotalTokens();

    if (currentUsage <= availableBudget) return 0;

    const targetRemoval = currentUsage - availableBudget;
    let removedTokens = 0;
    const toRemove: string[] = [];

    const sortedEntries = this.getSortedEntries();

    for (const entry of sortedEntries) {
      if (removedTokens >= targetRemoval) break;
      // Don't remove high-priority entries
      if (entry.priority >= 8) continue;
      toRemove.push(entry.id);
      removedTokens += entry.tokenCount;
    }

    for (const id of toRemove) {
      this.entries.delete(id);
    }

    return removedTokens;
  }

  /** Get entries sorted by eviction strategy */
  private getSortedEntries(): ContextEntry[] {
    const entries = Array.from(this.entries.values());

    switch (this.config.strategy) {
      case 'lru':
        return entries.sort((a, b) => a.lastAccessedAt.getTime() - b.lastAccessedAt.getTime());
      case 'priority':
        return entries.sort((a, b) => a.priority - b.priority);
      case 'fifo':
        return entries.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      default:
        return entries;
    }
  }

  /** Get all entries */
  getAll(): ContextEntry[] {
    return Array.from(this.entries.values());
  }

  /** Clear all entries */
  clear(): void {
    this.entries.clear();
  }

  /** Auto-collect project context */
  collectProjectContext(projectPath: string, files: string[]): void {
    for (const file of files) {
      this.add({
        type: 'file',
        key: `project:${file}`,
        value: { path: file, projectRoot: projectPath },
        priority: 5,
      });
    }
  }

  /** Persist context to storage (simplified) */
  async persist(): Promise<void> {
    if (!this.persistencePath) return;
    // In a real implementation, this would serialize to disk
  }

  /** Load context from storage (simplified) */
  async load(): Promise<void> {
    if (!this.persistencePath) return;
    // In a real implementation, this would deserialize from disk
  }

  /** Export context as a serializable object */
  exportContext(): { entries: ContextEntry[]; config: ContextWindowConfig } {
    return {
      entries: Array.from(this.entries.values()),
      config: this.config,
    };
  }
}
