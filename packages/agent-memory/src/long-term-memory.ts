/**
 * LongTermMemory - Persistent knowledge storage with retrieval capabilities.
 */

export interface LongTermMemoryEntry {
  key: string;
  value: unknown;
  tags: string[];
  metadata: Record<string, unknown>;
  timestamp: number;
  accessCount: number;
  importance: number;
}

export interface LongTermMemoryOptions {
  maxEntries?: number;
  defaultImportance?: number;
}

export interface SearchOptions {
  limit?: number;
  tags?: string[];
  minImportance?: number;
  startTime?: number;
  endTime?: number;
}

export interface LongTermMemoryStats {
  entryCount: number;
  maxEntries: number;
  totalTags: number;
  averageImportance: number;
  totalAccessCount: number;
  oldestEntryAge: number;
  newestEntryAge: number;
}

export class LongTermMemory {
  private entries: Map<string, LongTermMemoryEntry> = new Map();
  private maxEntries: number;
  private defaultImportance: number;

  constructor(options: LongTermMemoryOptions = {}) {
    this.maxEntries = options.maxEntries ?? 10000;
    this.defaultImportance = options.defaultImportance ?? 0.5;
  }

  store(
    key: string,
    value: unknown,
    tags: string[] = [],
    metadata: Record<string, unknown> = {}
  ): LongTermMemoryEntry {
    const existing = this.entries.get(key);
    const entry: LongTermMemoryEntry = {
      key,
      value,
      tags: existing ? [...new Set([...existing.tags, ...tags])] : [...tags],
      metadata: existing ? { ...existing.metadata, ...metadata } : { ...metadata },
      timestamp: existing?.timestamp ?? Date.now(),
      accessCount: existing?.accessCount ?? 0,
      importance: existing?.importance ?? this.defaultImportance,
    };
    if (!existing && this.entries.size >= this.maxEntries) {
      this.evictOldest();
    }
    this.entries.set(key, entry);
    return entry;
  }

  retrieve(key: string): LongTermMemoryEntry | undefined {
    const entry = this.entries.get(key);
    if (entry) {
      entry.accessCount++;
    }
    return entry;
  }

  search(query: string, options: SearchOptions = {}): LongTermMemoryEntry[] {
    const lowerQuery = query.toLowerCase();
    let results = Array.from(this.entries.values()).filter((entry) => {
      const matchesQuery =
        entry.key.toLowerCase().includes(lowerQuery) ||
        JSON.stringify(entry.value).toLowerCase().includes(lowerQuery);
      const matchesTags =
        options.tags === undefined ||
        options.tags.length === 0 ||
        options.tags.some((t) => entry.tags.includes(t));
      const matchesImportance =
        options.minImportance === undefined || entry.importance >= options.minImportance;
      const matchesTime =
        (options.startTime === undefined || entry.timestamp >= options.startTime) &&
        (options.endTime === undefined || entry.timestamp <= options.endTime);
      return matchesQuery && matchesTags && matchesImportance && matchesTime;
    });
    if (options.limit !== undefined && options.limit > 0) {
      results = results.slice(0, options.limit);
    }
    return results;
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  forget(criteria: {
    tags?: string[];
    maxAge?: number;
    minImportance?: number;
    pattern?: string;
  }): number {
    let count = 0;
    const now = Date.now();
    const toDelete: string[] = [];
    for (const [key, entry] of this.entries) {
      const shouldForget =
        (criteria.maxAge !== undefined ? now - entry.timestamp > criteria.maxAge : true) &&
        (criteria.minImportance !== undefined ? entry.importance < criteria.minImportance : true) &&
        (criteria.tags !== undefined && criteria.tags.length > 0
          ? criteria.tags.some((t) => entry.tags.includes(t))
          : true) &&
        (criteria.pattern !== undefined
          ? key.toLowerCase().includes(criteria.pattern.toLowerCase())
          : true);
      if (shouldForget) {
        toDelete.push(key);
      }
    }
    for (const key of toDelete) {
      this.entries.delete(key);
      count++;
    }
    return count;
  }

  consolidate(memories: LongTermMemoryEntry[]): void {
    for (const mem of memories) {
      const existing = this.entries.get(mem.key);
      if (existing) {
        existing.importance = Math.max(existing.importance, mem.importance);
        existing.tags = [...new Set([...existing.tags, ...mem.tags])];
        existing.accessCount += mem.accessCount;
      } else {
        this.entries.set(mem.key, { ...mem });
      }
    }
  }

  getByTag(tag: string): LongTermMemoryEntry[] {
    return Array.from(this.entries.values()).filter((e) => e.tags.includes(tag));
  }

  getByTimeRange(start: number, end: number): LongTermMemoryEntry[] {
    return Array.from(this.entries.values()).filter(
      (e) => e.timestamp >= start && e.timestamp <= end
    );
  }

  getStats(): LongTermMemoryStats {
    const all = Array.from(this.entries.values());
    const now = Date.now();
    const timestamps = all.map((e) => e.timestamp);
    const totalImportance = all.reduce((s, e) => s + e.importance, 0);
    const totalAccess = all.reduce((s, e) => s + e.accessCount, 0);
    const allTags = new Set(all.flatMap((e) => e.tags));
    return {
      entryCount: all.length,
      maxEntries: this.maxEntries,
      totalTags: allTags.size,
      averageImportance: all.length > 0 ? totalImportance / all.length : 0,
      totalAccessCount: totalAccess,
      oldestEntryAge: timestamps.length > 0 ? now - Math.min(...timestamps) : 0,
      newestEntryAge: timestamps.length > 0 ? now - Math.max(...timestamps) : 0,
    };
  }

  export(): LongTermMemoryEntry[] {
    return Array.from(this.entries.values()).map((e) => ({ ...e, tags: [...e.tags], metadata: { ...e.metadata } }));
  }

  import(data: LongTermMemoryEntry[]): void {
    for (const entry of data) {
      this.entries.set(entry.key, {
        ...entry,
        tags: [...(entry.tags ?? [])],
        metadata: { ...(entry.metadata ?? {}) },
      });
    }
  }

  private evictOldest(): void {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;
    for (const [key, entry] of this.entries) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) {
      this.entries.delete(oldestKey);
    }
  }
}
