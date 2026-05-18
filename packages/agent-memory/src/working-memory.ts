/**
 * WorkingMemory - Short-term scratchpad for active task context.
 * Based on Miller's Law of 7 +/- 2 items in working memory.
 */

export interface MemoryItem {
  id: string;
  content: string;
  type: 'fact' | 'task' | 'context' | 'goal' | 'intermediate';
  relevance: number;
  timestamp: number;
  accessCount: number;
  metadata: Record<string, unknown>;
}

export interface WorkingMemoryStats {
  itemCount: number;
  capacity: number;
  utilization: number;
  averageRelevance: number;
  totalAccessCount: number;
  oldestItemAge: number;
  newestItemAge: number;
}

export class WorkingMemory {
  private items: Map<string, MemoryItem> = new Map();
  private capacity: number;
  private accessLog: Array<{ id: string; timestamp: number }> = [];

  constructor(capacity: number = 7) {
    if (capacity <= 0) throw new Error('Capacity must be positive');
    this.capacity = capacity;
  }

  add(item: MemoryItem): void {
    if (!item.id || !item.content) {
      throw new Error('MemoryItem must have id and content');
    }
    const enriched: MemoryItem = {
      relevance: item.relevance ?? 0.5,
      timestamp: item.timestamp ?? Date.now(),
      accessCount: item.accessCount ?? 0,
      metadata: item.metadata ?? {},
      type: item.type ?? 'context',
      ...item,
    };
    // If at capacity, evict lowest relevance item
    if (this.items.size >= this.capacity && !this.items.has(enriched.id)) {
      this.evictLowest();
    }
    this.items.set(enriched.id, enriched);
    this.accessLog.push({ id: enriched.id, timestamp: Date.now() });
  }

  remove(id: string): boolean {
    const deleted = this.items.delete(id);
    if (deleted) {
      this.accessLog = this.accessLog.filter((e) => e.id !== id);
    }
    return deleted;
  }

  get(id: string): MemoryItem | undefined {
    const item = this.items.get(id);
    if (item) {
      item.accessCount++;
      item.timestamp = Date.now();
      this.accessLog.push({ id, timestamp: Date.now() });
    }
    return item;
  }

  getAll(): MemoryItem[] {
    return Array.from(this.items.values());
  }

  search(query: string): MemoryItem[] {
    const lowerQuery = query.toLowerCase();
    return this.getAll().filter(
      (item) =>
        item.content.toLowerCase().includes(lowerQuery) ||
        item.type.toLowerCase().includes(lowerQuery) ||
        Object.values(item.metadata).some(
          (v) => typeof v === 'string' && v.toLowerCase().includes(lowerQuery)
        )
    );
  }

  prioritize(): void {
    const sorted = this.getAll().sort((a, b) => {
      const scoreA = a.relevance * 0.6 + (a.accessCount / Math.max(1, this.accessLog.filter((l) => l.id === a.id).length)) * 0.4;
      const scoreB = b.relevance * 0.6 + (b.accessCount / Math.max(1, this.accessLog.filter((l) => l.id === b.id).length)) * 0.4;
      return scoreB - scoreA;
    });
    this.items.clear();
    for (const item of sorted) {
      this.items.set(item.id, item);
    }
  }

  decay(factor: number): void {
    if (factor < 0 || factor > 1) throw new Error('Decay factor must be between 0 and 1');
    for (const item of this.items.values()) {
      item.relevance = Math.max(0, item.relevance * (1 - factor));
    }
  }

  consolidate(): MemoryItem[] {
    const threshold = 0.3;
    const consolidated: MemoryItem[] = [];
    const toRemove: string[] = [];
    for (const [id, item] of this.items) {
      if (item.relevance < threshold) {
        consolidated.push({ ...item });
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      this.remove(id);
    }
    return consolidated;
  }

  clear(): void {
    this.items.clear();
    this.accessLog = [];
  }

  getStats(): WorkingMemoryStats {
    const all = this.getAll();
    const now = Date.now();
    const totalRelevance = all.reduce((sum, i) => sum + i.relevance, 0);
    const totalAccess = all.reduce((sum, i) => sum + i.accessCount, 0);
    const timestamps = all.map((i) => i.timestamp);
    return {
      itemCount: all.length,
      capacity: this.capacity,
      utilization: all.length / this.capacity,
      averageRelevance: all.length > 0 ? totalRelevance / all.length : 0,
      totalAccessCount: totalAccess,
      oldestItemAge: timestamps.length > 0 ? now - Math.min(...timestamps) : 0,
      newestItemAge: timestamps.length > 0 ? now - Math.max(...timestamps) : 0,
    };
  }

  private evictLowest(): void {
    let lowestId: string | undefined;
    let lowestScore = Infinity;
    for (const [id, item] of this.items) {
      const score = item.relevance - item.accessCount * 0.1;
      if (score < lowestScore) {
        lowestScore = score;
        lowestId = id;
      }
    }
    if (lowestId !== undefined) {
      this.remove(lowestId);
    }
  }
}
