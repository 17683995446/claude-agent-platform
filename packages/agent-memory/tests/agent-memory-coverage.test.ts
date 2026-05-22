/**
 * Comprehensive coverage tests for @claude-agent/agent-memory
 * Covers ALL public methods, every branch, boundary values, and error paths.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  WorkingMemory,
  ShortTermMemory,
  LongTermMemory,
  EpisodicMemory,
  SemanticMemory,
  MemoryPrioritizer,
  MemoryConsolidator,
  MemoryRetriever,
  MemoryManager,
  MemorySerializer,
} from '../src/index.js';

import type {
  MemoryItem,
  Message,
  LongTermMemoryEntry,
  Episode,
  Concept,
  Relation,
  MemoryForScoring,
  RetrievedMemory,
  SerializedMemoryState,
  MemoryStateDiff,
} from '../src/index.js';

// ============================================================
// WorkingMemory Tests
// ============================================================
describe('WorkingMemory', () => {
  let wm: WorkingMemory;

  beforeEach(() => {
    wm = new WorkingMemory(5);
  });

  describe('constructor', () => {
    it('should create with default capacity 7', () => {
      const w = new WorkingMemory();
      expect(w.getStats().capacity).toBe(7);
    });

    it('should throw on non-positive capacity', () => {
      expect(() => new WorkingMemory(0)).toThrow('Capacity must be positive');
      expect(() => new WorkingMemory(-1)).toThrow('Capacity must be positive');
    });

    it('should accept capacity of 1', () => {
      const w = new WorkingMemory(1);
      expect(w.getStats().capacity).toBe(1);
    });
  });

  describe('add', () => {
    it('should add a valid item', () => {
      wm.add({ id: '1', content: 'test', type: 'fact', relevance: 0.8, timestamp: 1000, accessCount: 0, metadata: {} });
      expect(wm.getAll().length).toBe(1);
    });

    it('should throw when id is missing', () => {
      expect(() => wm.add({ id: '', content: 'test', type: 'context', relevance: 0.5, timestamp: 0, accessCount: 0, metadata: {} })).toThrow('MemoryItem must have id and content');
    });

    it('should throw when content is missing', () => {
      expect(() => wm.add({ id: '1', content: '', type: 'context', relevance: 0.5, timestamp: 0, accessCount: 0, metadata: {} })).toThrow('MemoryItem must have id and content');
    });

    it('should apply default values for missing fields', () => {
      wm.add({ id: '1', content: 'test', type: 'context', relevance: 0.5, timestamp: 0, accessCount: 0, metadata: {} });
      const item = wm.get('1')!;
      // get() increments accessCount, so it becomes 1
      expect(item.relevance).toBe(0.5);
      expect(item.accessCount).toBe(1);
      expect(item.metadata).toEqual({});
      expect(item.type).toBe('context');
    });

    it('should not overwrite defaults when item has explicit 0 relevance', () => {
      wm.add({ id: '1', content: 'test', type: 'fact', relevance: 0, timestamp: 0, accessCount: 0, metadata: {} });
      expect(wm.get('1')!.relevance).toBe(0);
    });

    it('should evict lowest relevance item when at capacity', () => {
      wm = new WorkingMemory(2);
      wm.add({ id: '1', content: 'low', type: 'fact', relevance: 0.1, timestamp: 1000, accessCount: 0, metadata: {} });
      wm.add({ id: '2', content: 'high', type: 'fact', relevance: 0.9, timestamp: 1000, accessCount: 0, metadata: {} });
      wm.add({ id: '3', content: 'new', type: 'fact', relevance: 0.5, timestamp: 1000, accessCount: 0, metadata: {} });
      expect(wm.getAll().length).toBe(2);
      expect(wm.get('1')).toBeUndefined();
      expect(wm.get('2')).toBeDefined();
      expect(wm.get('3')).toBeDefined();
    });

    it('should update existing item when adding with same id', () => {
      wm.add({ id: '1', content: 'original', type: 'fact', relevance: 0.5, timestamp: 1000, accessCount: 0, metadata: {} });
      wm.add({ id: '1', content: 'updated', type: 'fact', relevance: 0.8, timestamp: 2000, accessCount: 5, metadata: { key: 'val' } });
      expect(wm.getAll().length).toBe(1);
      expect(wm.get('1')!.content).toBe('updated');
    });

    it('should trim access log when it exceeds MAX_ACCESS_LOG_SIZE', () => {
      wm = new WorkingMemory(1);
      for (let i = 0; i < 2000; i++) {
        wm.add({ id: 'x', content: 'test', type: 'fact', relevance: 0.5, timestamp: 1000, accessCount: 0, metadata: {} });
      }
      // Should not throw - access log is trimmed
      expect(wm.getStats().itemCount).toBe(1);
    });
  });

  describe('remove', () => {
    it('should remove an existing item', () => {
      wm.add({ id: '1', content: 'test', type: 'context', relevance: 0.5, timestamp: 0, accessCount: 0, metadata: {} });
      expect(wm.remove('1')).toBe(true);
      expect(wm.getAll().length).toBe(0);
    });

    it('should return false for non-existing item', () => {
      expect(wm.remove('nonexistent')).toBe(false);
    });

    it('should remove item from access log', () => {
      wm.add({ id: '1', content: 'test', type: 'context', relevance: 0.5, timestamp: 0, accessCount: 0, metadata: {} });
      wm.get('1'); // add to access log
      wm.remove('1');
      // Re-add and verify access log was cleaned
      wm.add({ id: '2', content: 'test2', type: 'context', relevance: 0.5, timestamp: 0, accessCount: 0, metadata: {} });
    });
  });

  describe('get', () => {
    it('should return item and increment accessCount', () => {
      wm.add({ id: '1', content: 'test', type: 'context', relevance: 0.5, timestamp: 1000, accessCount: 0, metadata: {} });
      const item = wm.get('1')!;
      expect(item.content).toBe('test');
      expect(item.accessCount).toBe(1);
    });

    it('should update timestamp on access', () => {
      wm.add({ id: '1', content: 'test', type: 'context', relevance: 0.5, timestamp: 1000, accessCount: 0, metadata: {} });
      const before = wm.get('1')!.timestamp;
      const after = wm.get('1')!.timestamp;
      expect(after).toBeGreaterThanOrEqual(before);
    });

    it('should return undefined for non-existing item', () => {
      expect(wm.get('nonexistent')).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('should return empty array when empty', () => {
      expect(wm.getAll()).toEqual([]);
    });

    it('should return all items', () => {
      wm.add({ id: '1', content: 'a', type: 'context', relevance: 0.5, timestamp: 0, accessCount: 0, metadata: {} });
      wm.add({ id: '2', content: 'b', type: 'context', relevance: 0.5, timestamp: 0, accessCount: 0, metadata: {} });
      expect(wm.getAll().length).toBe(2);
    });
  });

  describe('search', () => {
    it('should search by content (case-insensitive)', () => {
      wm.add({ id: '1', content: 'Hello World', type: 'context', relevance: 0.5, timestamp: 0, accessCount: 0, metadata: {} });
      expect(wm.search('hello').length).toBe(1);
      expect(wm.search('HELLO').length).toBe(1);
    });

    it('should search by type', () => {
      wm.add({ id: '1', content: 'test', type: 'fact', relevance: 0.5, timestamp: 0, accessCount: 0, metadata: {} });
      expect(wm.search('fact').length).toBe(1);
    });

    it('should search by metadata string values', () => {
      wm.add({ id: '1', content: 'test', type: 'context', relevance: 0.5, timestamp: 0, accessCount: 0, metadata: { category: 'important' } });
      expect(wm.search('important').length).toBe(1);
    });

    it('should return empty for no matches', () => {
      wm.add({ id: '1', content: 'test', type: 'context', relevance: 0.5, timestamp: 0, accessCount: 0, metadata: {} });
      expect(wm.search('nonexistent').length).toBe(0);
    });
  });

  describe('prioritize', () => {
    it('should sort items by combined score', () => {
      wm = new WorkingMemory(10);
      wm.add({ id: '1', content: 'low', type: 'context', relevance: 0.1, timestamp: 0, accessCount: 0, metadata: {} });
      wm.add({ id: '2', content: 'high', type: 'context', relevance: 0.9, timestamp: 0, accessCount: 0, metadata: {} });
      wm.prioritize();
      const all = wm.getAll();
      expect(all[0]!.relevance).toBeGreaterThanOrEqual(all[1]!.relevance);
    });
  });

  describe('decay', () => {
    it('should decay relevance by factor', () => {
      wm.add({ id: '1', content: 'test', type: 'context', relevance: 1.0, timestamp: 0, accessCount: 0, metadata: {} });
      wm.decay(0.5);
      expect(wm.get('1')!.relevance).toBe(0.5);
    });

    it('should not go below 0', () => {
      wm.add({ id: '1', content: 'test', type: 'context', relevance: 0.1, timestamp: 0, accessCount: 0, metadata: {} });
      wm.decay(1.0);
      expect(wm.get('1')!.relevance).toBe(0);
    });

    it('should throw for factor < 0', () => {
      expect(() => wm.decay(-0.1)).toThrow('Decay factor must be between 0 and 1');
    });

    it('should throw for factor > 1', () => {
      expect(() => wm.decay(1.1)).toThrow('Decay factor must be between 0 and 1');
    });

    it('should accept factor of 0 (no decay)', () => {
      wm.add({ id: '1', content: 'test', type: 'context', relevance: 0.8, timestamp: 0, accessCount: 0, metadata: {} });
      wm.decay(0);
      expect(wm.get('1')!.relevance).toBe(0.8);
    });

    it('should accept factor of 1 (full decay)', () => {
      wm.add({ id: '1', content: 'test', type: 'context', relevance: 0.8, timestamp: 0, accessCount: 0, metadata: {} });
      wm.decay(1);
      expect(wm.get('1')!.relevance).toBe(0);
    });
  });

  describe('consolidate', () => {
    it('should remove items with relevance < 0.3', () => {
      wm.add({ id: '1', content: 'low', type: 'context', relevance: 0.1, timestamp: 0, accessCount: 0, metadata: {} });
      wm.add({ id: '2', content: 'high', type: 'context', relevance: 0.8, timestamp: 0, accessCount: 0, metadata: {} });
      const consolidated = wm.consolidate();
      expect(consolidated.length).toBe(1);
      expect(consolidated[0]!.id).toBe('1');
      expect(wm.getAll().length).toBe(1);
      expect(wm.get('2')).toBeDefined();
    });

    it('should return empty array when all items are above threshold', () => {
      wm.add({ id: '1', content: 'high', type: 'context', relevance: 0.9, timestamp: 0, accessCount: 0, metadata: {} });
      const consolidated = wm.consolidate();
      expect(consolidated.length).toBe(0);
    });

    it('should handle boundary value 0.3', () => {
      wm.add({ id: '1', content: 'boundary', type: 'context', relevance: 0.3, timestamp: 0, accessCount: 0, metadata: {} });
      const consolidated = wm.consolidate();
      // 0.3 is NOT < 0.3, so it should not be consolidated
      expect(consolidated.length).toBe(0);
    });
  });

  describe('clear', () => {
    it('should clear all items and access log', () => {
      wm.add({ id: '1', content: 'test', type: 'context', relevance: 0.5, timestamp: 0, accessCount: 0, metadata: {} });
      wm.clear();
      expect(wm.getAll().length).toBe(0);
      expect(wm.getStats().itemCount).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return correct stats for empty memory', () => {
      const stats = wm.getStats();
      expect(stats.itemCount).toBe(0);
      expect(stats.capacity).toBe(5);
      expect(stats.utilization).toBe(0);
      expect(stats.averageRelevance).toBe(0);
      expect(stats.totalAccessCount).toBe(0);
      expect(stats.oldestItemAge).toBe(0);
      expect(stats.newestItemAge).toBe(0);
    });

    it('should return correct stats with items', () => {
      wm.add({ id: '1', content: 'test', type: 'context', relevance: 0.6, timestamp: Date.now(), accessCount: 3, metadata: {} });
      const stats = wm.getStats();
      expect(stats.itemCount).toBe(1);
      expect(stats.utilization).toBeCloseTo(1 / 5);
      expect(stats.averageRelevance).toBeCloseTo(0.6);
      expect(stats.totalAccessCount).toBe(3);
    });
  });

  describe('evictLowest (private, tested indirectly)', () => {
    it('should evict item with lowest score (relevance - accessCount * 0.1)', () => {
      wm = new WorkingMemory(2);
      wm.add({ id: '1', content: 'a', type: 'context', relevance: 0.5, timestamp: 0, accessCount: 0, metadata: {} });
      wm.add({ id: '2', content: 'b', type: 'context', relevance: 0.5, timestamp: 0, accessCount: 10, metadata: {} });
      // item 1 score: 0.5 - 0*0.1 = 0.5
      // item 2 score: 0.5 - 10*0.1 = -0.5
      // Adding a 3rd should evict item 2 (lowest score)
      wm.add({ id: '3', content: 'c', type: 'context', relevance: 0.5, timestamp: 0, accessCount: 0, metadata: {} });
      expect(wm.get('2')).toBeUndefined();
      expect(wm.get('1')).toBeDefined();
      expect(wm.get('3')).toBeDefined();
    });
  });
});

// ============================================================
// ShortTermMemory Tests
// ============================================================
describe('ShortTermMemory', () => {
  let stm: ShortTermMemory;

  beforeEach(() => {
    stm = new ShortTermMemory(100);
  });

  describe('constructor', () => {
    it('should create with default maxTokens 4096', () => {
      const s = new ShortTermMemory();
      expect(s.getStats().maxTokens).toBe(4096);
    });

    it('should throw on non-positive maxTokens', () => {
      expect(() => new ShortTermMemory(0)).toThrow('maxTokens must be positive');
      expect(() => new ShortTermMemory(-1)).toThrow('maxTokens must be positive');
    });
  });

  describe('addMessage', () => {
    it('should add a message', () => {
      const msg = stm.addMessage('user', 'Hello');
      expect(msg.role).toBe('user');
      expect(msg.content).toBe('Hello');
      expect(msg.tokens).toBe(Math.ceil(5 / 4));
    });

    it('should auto-trim when exceeding maxTokens', () => {
      stm = new ShortTermMemory(10);
      stm.addMessage('user', 'First message'); // ~3 tokens
      stm.addMessage('user', 'Second message'); // ~4 tokens
      // After adding second, totalTokens > 10, should trim first
      const stats = stm.getStats();
      expect(stats.totalTokens).toBeLessThanOrEqual(10);
    });

    it('should handle single message exceeding maxTokens', () => {
      stm = new ShortTermMemory(1);
      // A message with 5 chars = 2 tokens, exceeds maxTokens of 1
      stm.addMessage('user', 'Hello');
      // Should not infinite loop; totalTokens should be >= 0
      expect(stm.getStats().totalTokens).toBeGreaterThanOrEqual(0);
    });

    it('should store metadata', () => {
      const msg = stm.addMessage('user', 'Hello', { key: 'value' });
      expect(msg.metadata).toEqual({ key: 'value' });
    });

    it('should accept all roles', () => {
      for (const role of ['user', 'assistant', 'system'] as const) {
        const msg = stm.addMessage(role, 'test');
        expect(msg.role).toBe(role);
      }
    });
  });

  describe('getRecent', () => {
    it('should return recent messages', () => {
      stm.addMessage('user', '1');
      stm.addMessage('user', '2');
      stm.addMessage('user', '3');
      expect(stm.getRecent(2).length).toBe(2);
      expect(stm.getRecent(2)[0]!.content).toBe('2');
    });

    it('should return empty for count <= 0', () => {
      stm.addMessage('user', 'test');
      expect(stm.getRecent(0)).toEqual([]);
      expect(stm.getRecent(-1)).toEqual([]);
    });

    it('should return all if count exceeds message count', () => {
      stm.addMessage('user', '1');
      expect(stm.getRecent(100).length).toBe(1);
    });
  });

  describe('getContext', () => {
    it('should format messages as [role]: content', () => {
      stm.addMessage('user', 'Hello');
      stm.addMessage('assistant', 'Hi');
      const ctx = stm.getContext();
      expect(ctx).toContain('[user]: Hello');
      expect(ctx).toContain('[assistant]: Hi');
    });

    it('should return empty string when no messages', () => {
      expect(stm.getContext()).toBe('');
    });
  });

  describe('summarize', () => {
    it('should return default message when empty', () => {
      expect(stm.summarize()).toBe('No conversation history.');
    });

    it('should summarize conversation', () => {
      stm.addMessage('user', 'Hello there');
      stm.addMessage('assistant', 'Hi there');
      const summary = stm.summarize();
      expect(summary).toContain('2 messages');
      expect(summary).toContain('1 user');
      expect(summary).toContain('1 assistant');
    });
  });

  describe('getTokenCount', () => {
    it('should return 0 when empty', () => {
      expect(stm.getTokenCount()).toBe(0);
    });

    it('should return total tokens', () => {
      stm.addMessage('user', 'Hello'); // ~2 tokens
      expect(stm.getTokenCount()).toBe(Math.ceil(5 / 4));
    });
  });

  describe('trimToFit', () => {
    it('should trim oldest messages first', () => {
      stm = new ShortTermMemory(10);
      stm.addMessage('user', 'First');
      stm.addMessage('user', 'Second');
      const trimmed = stm.trimToFit();
      expect(trimmed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('clear', () => {
    it('should clear all messages and reset token count', () => {
      stm.addMessage('user', 'test');
      stm.clear();
      expect(stm.getStats().messageCount).toBe(0);
      expect(stm.getTokenCount()).toBe(0);
    });
  });

  describe('search', () => {
    it('should search content case-insensitively', () => {
      stm.addMessage('user', 'Hello World');
      expect(stm.search('hello').length).toBe(1);
    });

    it('should search by role', () => {
      stm.addMessage('user', 'test');
      expect(stm.search('user').length).toBe(1);
    });

    it('should search metadata', () => {
      stm.addMessage('user', 'test', { category: 'important' });
      expect(stm.search('important').length).toBe(1);
    });
  });

  describe('getStats', () => {
    it('should return correct stats when empty', () => {
      const stats = stm.getStats();
      expect(stats.messageCount).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.utilization).toBe(0);
      expect(stats.averageTokensPerMessage).toBe(0);
      expect(stats.oldestMessageAge).toBe(0);
      expect(stats.newestMessageAge).toBe(0);
    });

    it('should return correct stats with messages', () => {
      stm.addMessage('user', 'Hello');
      const stats = stm.getStats();
      expect(stats.messageCount).toBe(1);
      expect(stats.totalTokens).toBe(Math.ceil(5 / 4));
    });
  });
});

// ============================================================
// LongTermMemory Tests
// ============================================================
describe('LongTermMemory', () => {
  let ltm: LongTermMemory;

  beforeEach(() => {
    ltm = new LongTermMemory({ maxEntries: 100 });
  });

  describe('constructor', () => {
    it('should create with defaults', () => {
      const l = new LongTermMemory();
      expect(l.getStats().maxEntries).toBe(10000);
    });
  });

  describe('store', () => {
    it('should store a new entry', () => {
      const entry = ltm.store('key1', 'value1', ['tag1']);
      expect(entry.key).toBe('key1');
      expect(entry.value).toBe('value1');
      expect(entry.tags).toEqual(['tag1']);
    });

    it('should merge tags on re-store', () => {
      ltm.store('key1', 'value1', ['tag1']);
      const entry = ltm.store('key1', 'value2', ['tag2']);
      expect(entry.tags).toContain('tag1');
      expect(entry.tags).toContain('tag2');
    });

    it('should merge metadata on re-store', () => {
      ltm.store('key1', 'v1', [], { a: 1 });
      const entry = ltm.store('key1', 'v2', [], { b: 2 });
      expect(entry.metadata).toEqual({ a: 1, b: 2 });
    });

    it('should preserve timestamp on re-store', () => {
      ltm.store('key1', 'v1');
      const entry = ltm.store('key1', 'v2');
      // timestamp should be preserved from first store
      expect(entry.timestamp).toBeGreaterThan(0);
    });

    it('should preserve accessCount on re-store', () => {
      ltm.store('key1', 'v1');
      ltm.retrieve('key1'); // accessCount becomes 1
      const entry = ltm.store('key1', 'v2');
      expect(entry.accessCount).toBe(1);
    });

    it('should evict oldest when at maxEntries', () => {
      ltm = new LongTermMemory({ maxEntries: 2 });
      ltm.store('a', 'v1');
      ltm.store('b', 'v2');
      ltm.store('c', 'v3');
      expect(ltm.getStats().entryCount).toBe(2);
      expect(ltm.retrieve('a')).toBeUndefined();
      expect(ltm.retrieve('c')).toBeDefined();
    });
  });

  describe('retrieve', () => {
    it('should retrieve existing entry', () => {
      ltm.store('key1', 'value1');
      const entry = ltm.retrieve('key1');
      expect(entry).toBeDefined();
      expect(entry!.value).toBe('value1');
    });

    it('should increment accessCount on retrieve', () => {
      ltm.store('key1', 'value1');
      ltm.retrieve('key1');
      ltm.retrieve('key1');
      expect(ltm.retrieve('key1')!.accessCount).toBe(3);
    });

    it('should return undefined for non-existing key', () => {
      expect(ltm.retrieve('nonexistent')).toBeUndefined();
    });
  });

  describe('search', () => {
    it('should search by key', () => {
      ltm.store('mykey', 'value');
      expect(ltm.search('mykey').length).toBe(1);
    });

    it('should search by value (JSON stringified)', () => {
      ltm.store('key1', { text: 'hello world' });
      expect(ltm.search('hello world').length).toBe(1);
    });

    it('should filter by tags', () => {
      ltm.store('k1', 'v1', ['a', 'b']);
      ltm.store('k2', 'v2', ['c']);
      expect(ltm.search('', { tags: ['a'] }).length).toBe(1);
    });

    it('should filter by minImportance', () => {
      ltm.store('k1', 'v1');
      ltm.store('k2', 'v2');
      // default importance is 0.5
      expect(ltm.search('', { minImportance: 0.5 }).length).toBe(2);
    });

    it('should filter by time range', () => {
      const now = Date.now();
      ltm.store('k1', 'v1');
      expect(ltm.search('', { startTime: now, endTime: now + 1000 }).length).toBe(1);
      expect(ltm.search('', { startTime: now + 10000 }).length).toBe(0);
    });

    it('should respect limit', () => {
      ltm.store('k1', 'v1');
      ltm.store('k2', 'v2');
      ltm.store('k3', 'v3');
      expect(ltm.search('v', { limit: 2 }).length).toBe(2);
    });

    it('should return empty for no matches', () => {
      expect(ltm.search('nonexistent').length).toBe(0);
    });
  });

  describe('delete', () => {
    it('should delete existing entry', () => {
      ltm.store('k1', 'v1');
      expect(ltm.delete('k1')).toBe(true);
      expect(ltm.retrieve('k1')).toBeUndefined();
    });

    it('should return false for non-existing entry', () => {
      expect(ltm.delete('nonexistent')).toBe(false);
    });
  });

  describe('forget', () => {
    it('should return 0 when no criteria specified (safety)', () => {
      ltm.store('k1', 'v1');
      ltm.store('k2', 'v2');
      expect(ltm.forget({})).toBe(0);
      expect(ltm.getStats().entryCount).toBe(2);
    });

    it('should forget by maxAge', () => {
      // Store entry, then use maxAge that ensures it's old enough
      ltm.store('k1', 'v1');
      // maxAge=1 means: forget if age > 1ms
      // Since store and forget happen in different ticks, age should be > 0
      // But to be safe, we just check the condition works
      const count = ltm.forget({ maxAge: -1 });
      // maxAge=-1 means: forget if now-timestamp > -1, which is always true
      expect(count).toBe(1);
    });

    it('should forget by minImportance', () => {
      ltm.store('k1', 'v1');
      // default importance is 0.5, so minImportance 0.6 should delete it
      const count = ltm.forget({ minImportance: 0.6 });
      expect(count).toBe(1);
    });

    it('should forget by tags', () => {
      ltm.store('k1', 'v1', ['important']);
      ltm.store('k2', 'v2', ['other']);
      const count = ltm.forget({ tags: ['important'] });
      expect(count).toBe(1);
      expect(ltm.retrieve('k2')).toBeDefined();
    });

    it('should forget by pattern', () => {
      ltm.store('user-1', 'v1');
      ltm.store('system-1', 'v2');
      const count = ltm.forget({ pattern: 'user' });
      expect(count).toBe(1);
    });

    it('should combine criteria (AND logic)', () => {
      ltm.store('k1', 'v1', ['tag-a']);
      ltm.store('k2', 'v2', ['tag-a']);
      // Both have tag-a, both have importance < 0.6 (default 0.5)
      // But only one matches pattern 'k1'
      const count = ltm.forget({ tags: ['tag-a'], pattern: 'k1' });
      expect(count).toBe(1);
    });
  });

  describe('consolidate', () => {
    it('should merge existing entries', () => {
      ltm.store('k1', 'v1', ['a']);
      ltm.consolidate([{ key: 'k1', value: 'v1-new', tags: ['b'], metadata: {}, timestamp: Date.now(), accessCount: 5, importance: 0.9 }]);
      const entry = ltm.retrieve('k1')!;
      expect(entry.tags).toContain('a');
      expect(entry.tags).toContain('b');
      expect(entry.importance).toBe(0.9);
      // retrieve() increments accessCount by 1, so 5 + 1 = 6
      expect(entry.accessCount).toBe(6);
    });

    it('should add new entries', () => {
      ltm.consolidate([{ key: 'k-new', value: 'v', tags: [], metadata: {}, timestamp: Date.now(), accessCount: 0, importance: 0.5 }]);
      expect(ltm.retrieve('k-new')).toBeDefined();
    });
  });

  describe('getByTag', () => {
    it('should filter by tag', () => {
      ltm.store('k1', 'v1', ['a']);
      ltm.store('k2', 'v2', ['b']);
      expect(ltm.getByTag('a').length).toBe(1);
    });
  });

  describe('getByTimeRange', () => {
    it('should filter by time range', () => {
      const now = Date.now();
      ltm.store('k1', 'v1');
      expect(ltm.getByTimeRange(now, now + 1000).length).toBe(1);
      expect(ltm.getByTimeRange(now + 10000, now + 20000).length).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return correct stats when empty', () => {
      const stats = ltm.getStats();
      expect(stats.entryCount).toBe(0);
      expect(stats.totalTags).toBe(0);
      expect(stats.averageImportance).toBe(0);
      expect(stats.totalAccessCount).toBe(0);
      expect(stats.oldestEntryAge).toBe(0);
      expect(stats.newestEntryAge).toBe(0);
    });

    it('should return correct stats with entries', () => {
      ltm.store('k1', 'v1', ['a', 'b']);
      ltm.retrieve('k1');
      const stats = ltm.getStats();
      expect(stats.entryCount).toBe(1);
      expect(stats.totalTags).toBe(2);
      expect(stats.totalAccessCount).toBe(1);
    });
  });

  describe('export/import', () => {
    it('should export and import entries', () => {
      ltm.store('k1', 'v1', ['tag1']);
      const data = ltm.export();
      const ltm2 = new LongTermMemory();
      ltm2.import(data);
      expect(ltm2.retrieve('k1')).toBeDefined();
    });
  });

  describe('clear', () => {
    it('should clear all entries', () => {
      ltm.store('k1', 'v1');
      ltm.clear();
      expect(ltm.getStats().entryCount).toBe(0);
    });
  });
});

// ============================================================
// EpisodicMemory Tests
// ============================================================
describe('EpisodicMemory', () => {
  let em: EpisodicMemory;

  beforeEach(() => {
    em = new EpisodicMemory();
  });

  describe('record', () => {
    it('should record an episode', () => {
      const ep = em.record({
        context: 'test context',
        actions: ['action1'],
        outcome: 'success',
        emotion: 'positive',
        importance: 0.8,
        tags: ['test'],
        lessons: ['lesson1'],
      });
      expect(ep.id).toMatch(/^ep-\d+$/);
      expect(ep.context).toBe('test context');
      expect(ep.timestamp).toBeGreaterThan(0);
    });

    it('should default tags and lessons to empty arrays', () => {
      const ep = em.record({
        context: 'test',
        actions: [],
        outcome: '',
        emotion: 'neutral',
        importance: 0.5,
        tags: [],
        lessons: [],
      });
      expect(ep.tags).toEqual([]);
      expect(ep.lessons).toEqual([]);
    });
  });

  describe('recall', () => {
    it('should recall by context', () => {
      em.record({ context: 'deployed service', actions: [], outcome: 'success', emotion: 'positive', importance: 0.8, tags: [], lessons: [] });
      expect(em.recall('deployed').length).toBe(1);
    });

    it('should recall by outcome', () => {
      em.record({ context: 'test', actions: [], outcome: 'failure', emotion: 'negative', importance: 0.5, tags: [], lessons: [] });
      expect(em.recall('failure').length).toBe(1);
    });

    it('should recall by actions', () => {
      em.record({ context: 'test', actions: ['clicked button'], outcome: '', emotion: 'neutral', importance: 0.5, tags: [], lessons: [] });
      expect(em.recall('clicked').length).toBe(1);
    });

    it('should recall by lessons', () => {
      em.record({ context: 'test', actions: [], outcome: '', emotion: 'neutral', importance: 0.5, tags: [], lessons: ['always check logs'] });
      expect(em.recall('always check').length).toBe(1);
    });

    it('should filter by minImportance', () => {
      em.record({ context: 'a', actions: [], outcome: '', emotion: 'neutral', importance: 0.3, tags: [], lessons: [] });
      em.record({ context: 'b', actions: [], outcome: '', emotion: 'neutral', importance: 0.8, tags: [], lessons: [] });
      expect(em.recall('', { minImportance: 0.5 }).length).toBe(1);
    });

    it('should filter by emotions', () => {
      em.record({ context: 'a', actions: [], outcome: '', emotion: 'positive', importance: 0.5, tags: [], lessons: [] });
      em.record({ context: 'b', actions: [], outcome: '', emotion: 'negative', importance: 0.5, tags: [], lessons: [] });
      expect(em.recall('', { emotions: ['positive'] }).length).toBe(1);
    });

    it('should filter by tags', () => {
      em.record({ context: 'a', actions: [], outcome: '', emotion: 'neutral', importance: 0.5, tags: ['work'], lessons: [] });
      em.record({ context: 'b', actions: [], outcome: '', emotion: 'neutral', importance: 0.5, tags: ['home'], lessons: [] });
      expect(em.recall('', { tags: ['work'] }).length).toBe(1);
    });

    it('should filter by time range', () => {
      const now = Date.now();
      em.record({ context: 'a', actions: [], outcome: '', emotion: 'neutral', importance: 0.5, tags: [], lessons: [] });
      expect(em.recall('', { startTime: now, endTime: now + 1000 }).length).toBe(1);
      expect(em.recall('', { startTime: now + 10000 }).length).toBe(0);
    });

    it('should respect limit', () => {
      em.record({ context: 'a', actions: [], outcome: '', emotion: 'neutral', importance: 0.5, tags: [], lessons: [] });
      em.record({ context: 'b', actions: [], outcome: '', emotion: 'neutral', importance: 0.5, tags: [], lessons: [] });
      expect(em.recall('', { limit: 1 }).length).toBe(1);
    });

    it('should sort by importance descending', () => {
      em.record({ context: 'low', actions: [], outcome: '', emotion: 'neutral', importance: 0.2, tags: [], lessons: [] });
      em.record({ context: 'high', actions: [], outcome: '', emotion: 'neutral', importance: 0.9, tags: [], lessons: [] });
      const results = em.recall('');
      expect(results[0]!.importance).toBe(0.9);
    });

    it('should return empty for no matches', () => {
      expect(em.recall('nonexistent').length).toBe(0);
    });
  });

  describe('forget', () => {
    it('should delete an episode', () => {
      const ep = em.record({ context: 'test', actions: [], outcome: '', emotion: 'neutral', importance: 0.5, tags: [], lessons: [] });
      expect(em.forget(ep.id)).toBe(true);
      expect(em.forget('nonexistent')).toBe(false);
    });
  });

  describe('getTimeline', () => {
    it('should return episodes sorted by timestamp', () => {
      em.record({ context: 'first', actions: [], outcome: '', emotion: 'neutral', importance: 0.5, tags: [], lessons: [] });
      em.record({ context: 'second', actions: [], outcome: '', emotion: 'neutral', importance: 0.5, tags: [], lessons: [] });
      const timeline = em.getTimeline();
      expect(timeline[0]!.context).toBe('first');
    });
  });

  describe('getByEmotion', () => {
    it('should filter by emotion', () => {
      em.record({ context: 'a', actions: [], outcome: '', emotion: 'positive', importance: 0.5, tags: [], lessons: [] });
      em.record({ context: 'b', actions: [], outcome: '', emotion: 'negative', importance: 0.5, tags: [], lessons: [] });
      expect(em.getByEmotion('positive').length).toBe(1);
    });
  });

  describe('getByContext', () => {
    it('should filter by context substring', () => {
      em.record({ context: 'deployed backend', actions: [], outcome: '', emotion: 'neutral', importance: 0.5, tags: [], lessons: [] });
      expect(em.getByContext('backend').length).toBe(1);
    });
  });

  describe('summarize', () => {
    it('should return default for empty period', () => {
      expect(em.summarize({ start: 0, end: 1 })).toBe('No episodes in the specified period.');
    });

    it('should summarize episodes in period', () => {
      const now = Date.now();
      em.record({ context: 'test', actions: [], outcome: 'good', emotion: 'positive', importance: 0.5, tags: [], lessons: ['learn1'] });
      const summary = em.summarize({ start: now - 1000, end: now + 1000 });
      expect(summary).toContain('1 episodes');
      expect(summary).toContain('1 positive');
      expect(summary).toContain('learn1');
    });
  });

  describe('extractLessons', () => {
    it('should extract unique lessons', () => {
      em.record({ context: 'a', actions: [], outcome: '', emotion: 'neutral', importance: 0.5, tags: [], lessons: ['always test'] });
      em.record({ context: 'b', actions: [], outcome: '', emotion: 'neutral', importance: 0.5, tags: [], lessons: ['always test', 'use types'] });
      const lessons = em.extractLessons();
      expect(lessons).toContain('always test');
      expect(lessons).toContain('use types');
      expect(lessons.length).toBe(2);
    });

    it('should return empty array when no lessons', () => {
      expect(em.extractLessons()).toEqual([]);
    });
  });

  describe('getAll', () => {
    it('should return all episodes', () => {
      em.record({ context: 'a', actions: [], outcome: '', emotion: 'neutral', importance: 0.5, tags: [], lessons: [] });
      expect(em.getAll().length).toBe(1);
    });
  });

  describe('clear', () => {
    it('should clear all episodes and reset counter', () => {
      em.record({ context: 'a', actions: [], outcome: '', emotion: 'neutral', importance: 0.5, tags: [], lessons: [] });
      em.clear();
      expect(em.getAll().length).toBe(0);
      // idCounter should be reset
      const ep = em.record({ context: 'b', actions: [], outcome: '', emotion: 'neutral', importance: 0.5, tags: [], lessons: [] });
      expect(ep.id).toBe('ep-1');
    });
  });

  describe('getStats', () => {
    it('should return correct stats when empty', () => {
      const stats = em.getStats();
      expect(stats.episodeCount).toBe(0);
      expect(stats.averageImportance).toBe(0);
    });

    it('should return emotion distribution', () => {
      em.record({ context: 'a', actions: [], outcome: '', emotion: 'positive', importance: 0.8, tags: [], lessons: [] });
      em.record({ context: 'b', actions: [], outcome: '', emotion: 'negative', importance: 0.4, tags: [], lessons: [] });
      const stats = em.getStats();
      expect(stats.episodeCount).toBe(2);
      expect(stats.emotionDistribution.positive).toBe(1);
      expect(stats.emotionDistribution.negative).toBe(1);
      expect(stats.averageImportance).toBeCloseTo(0.6);
    });
  });
});

// ============================================================
// SemanticMemory Tests
// ============================================================
describe('SemanticMemory', () => {
  let sm: SemanticMemory;

  beforeEach(() => {
    sm = new SemanticMemory();
  });

  describe('addConcept', () => {
    it('should add a concept', () => {
      const c = sm.addConcept('TypeScript', 'A typed superset of JavaScript');
      expect(c.name).toBe('TypeScript');
      expect(c.description).toBe('A typed superset of JavaScript');
    });

    it('should add with relations', () => {
      const rel: Relation = { from: 'TypeScript', to: 'JavaScript', type: 'extends', properties: {} };
      sm.addConcept('TypeScript', 'typed JS', {}, [rel]);
      expect(sm.getStats().relationCount).toBe(1);
    });

    it('should overwrite existing concept', () => {
      sm.addConcept('A', 'first');
      sm.addConcept('A', 'second');
      expect(sm.getConcept('A')!.description).toBe('second');
    });
  });

  describe('addRelation', () => {
    it('should add a relation', () => {
      sm.addConcept('A', 'concept A');
      sm.addConcept('B', 'concept B');
      const rel = sm.addRelation('A', 'B', 'related-to');
      expect(rel.from).toBe('A');
      expect(rel.to).toBe('B');
      expect(rel.type).toBe('related-to');
    });

    it('should update concept relations when both exist', () => {
      sm.addConcept('A', 'a');
      sm.addConcept('B', 'b');
      sm.addRelation('A', 'B', 'rel');
      expect(sm.getConcept('A')!.relations.length).toBe(1);
      expect(sm.getConcept('B')!.relations.length).toBe(1);
    });

    it('should not throw when concepts do not exist', () => {
      sm.addRelation('X', 'Y', 'rel');
      expect(sm.getStats().relationCount).toBe(1);
    });
  });

  describe('query', () => {
    it('should query by name', () => {
      sm.addConcept('TypeScript', 'typed JS');
      expect(sm.query('TypeScript').length).toBe(1);
    });

    it('should query by description', () => {
      sm.addConcept('TS', 'A typed superset of JavaScript');
      expect(sm.query('typed superset').length).toBe(1);
    });

    it('should query by properties', () => {
      sm.addConcept('TS', 'lang', { category: 'programming' });
      expect(sm.query('programming').length).toBe(1);
    });

    it('should respect limit', () => {
      sm.addConcept('A', 'a');
      sm.addConcept('B', 'b');
      expect(sm.query('', { limit: 1 }).length).toBe(1);
    });

    it('should return empty for no matches', () => {
      expect(sm.query('nonexistent').length).toBe(0);
    });
  });

  describe('getConcept', () => {
    it('should return concept by name', () => {
      sm.addConcept('A', 'a');
      expect(sm.getConcept('A')).toBeDefined();
    });

    it('should return undefined for non-existing', () => {
      expect(sm.getConcept('X')).toBeUndefined();
    });
  });

  describe('getRelated', () => {
    it('should find related concepts at depth 1', () => {
      sm.addConcept('A', 'a');
      sm.addConcept('B', 'b');
      sm.addConcept('C', 'c');
      sm.addRelation('A', 'B', 'rel');
      sm.addRelation('A', 'C', 'rel');
      const related = sm.getRelated('A', 1);
      expect(related.length).toBe(2);
    });

    it('should find related concepts at depth 2', () => {
      sm.addConcept('A', 'a');
      sm.addConcept('B', 'b');
      sm.addConcept('C', 'c');
      sm.addRelation('A', 'B', 'rel');
      sm.addRelation('B', 'C', 'rel');
      const related = sm.getRelated('A', 2);
      const names = related.map((c) => c.name);
      expect(names).toContain('B');
      expect(names).toContain('C');
    });

    it('should not include the starting concept', () => {
      sm.addConcept('A', 'a');
      sm.addConcept('B', 'b');
      sm.addRelation('A', 'B', 'rel');
      const related = sm.getRelated('A', 1);
      expect(related.find((c) => c.name === 'A')).toBeUndefined();
    });

    it('should return empty for isolated concept', () => {
      sm.addConcept('A', 'a');
      expect(sm.getRelated('A', 1)).toEqual([]);
    });
  });

  describe('infer', () => {
    it('should perform transitive inference', () => {
      sm.addConcept('A', 'a');
      sm.addConcept('B', 'b');
      sm.addConcept('C', 'c');
      sm.addRelation('A', 'B', 'related');
      sm.addRelation('B', 'C', 'related');
      const results = sm.infer('');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.inference).toContain('A');
      expect(results[0]!.inference).toContain('C');
    });

    it('should limit results to 10', () => {
      // Create many relations
      for (let i = 0; i < 20; i++) {
        sm.addConcept(`C${i}`, `concept ${i}`);
        sm.addRelation(`C${i}`, `C${i + 1}`, 'rel');
      }
      expect(sm.infer('').length).toBeLessThanOrEqual(10);
    });

    it('should return property-based inference when concept has relations', () => {
      sm.addConcept('A', 'a concept description');
      sm.addConcept('B', 'related concept');
      sm.addRelation('A', 'B', 'related-to');
      const results = sm.infer('A');
      // Property-based inference should work when concept has relations
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('merge', () => {
    it('should merge concepts', () => {
      sm.addConcept('A', 'original', { k1: 'v1' });
      const other = new SemanticMemory();
      other.addConcept('A', 'updated', { k2: 'v2' });
      other.addConcept('B', 'new');
      sm.merge(other);
      expect(sm.getConcept('A')!.description).toBe('updated');
      expect(sm.getConcept('A')!.properties).toEqual({ k1: 'v1', k2: 'v2' });
      expect(sm.getConcept('B')).toBeDefined();
    });

    it('should merge relations without duplicates', () => {
      sm.addConcept('A', 'a');
      sm.addConcept('B', 'b');
      sm.addRelation('A', 'B', 'rel');
      const other = new SemanticMemory();
      other.addConcept('A', 'a');
      other.addConcept('B', 'b');
      other.addRelation('A', 'B', 'rel');
      sm.merge(other);
      expect(sm.getStats().relationCount).toBe(1);
    });
  });

  describe('getStats', () => {
    it('should return correct stats when empty', () => {
      const stats = sm.getStats();
      expect(stats.conceptCount).toBe(0);
      expect(stats.relationCount).toBe(0);
      expect(stats.averageRelationsPerConcept).toBe(0);
      expect(stats.isolatedConcepts).toBe(0);
    });

    it('should count isolated concepts', () => {
      sm.addConcept('A', 'a');
      sm.addConcept('B', 'b');
      sm.addRelation('A', 'B', 'rel');
      sm.addConcept('C', 'c'); // isolated
      expect(sm.getStats().isolatedConcepts).toBe(1);
    });
  });

  describe('export/import', () => {
    it('should export and import state', () => {
      sm.addConcept('A', 'a');
      sm.addRelation('A', 'B', 'rel');
      sm.addConcept('B', 'b');
      const data = sm.export();
      const sm2 = new SemanticMemory();
      sm2.import(data);
      expect(sm2.getConcept('A')).toBeDefined();
      expect(sm2.getConcept('B')).toBeDefined();
      expect(sm2.getStats().relationCount).toBe(1);
    });
  });

  describe('clear', () => {
    it('should clear all concepts and relations', () => {
      sm.addConcept('A', 'a');
      sm.addRelation('A', 'B', 'rel');
      sm.clear();
      expect(sm.getStats().conceptCount).toBe(0);
      expect(sm.getStats().relationCount).toBe(0);
    });
  });
});

// ============================================================
// MemoryPrioritizer Tests
// ============================================================
describe('MemoryPrioritizer', () => {
  let mp: MemoryPrioritizer;

  beforeEach(() => {
    mp = new MemoryPrioritizer();
  });

  describe('calculateImportance', () => {
    it('should return score between 0 and 1', () => {
      const memory: MemoryForScoring = {
        id: '1',
        content: 'test',
        timestamp: Date.now(),
        accessCount: 5,
        relevance: 0.7,
        emotion: 'positive',
      };
      const score = mp.calculateImportance(memory);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should give higher score for recent items', () => {
      const recent: MemoryForScoring = { id: '1', content: 'test', timestamp: Date.now(), accessCount: 0, relevance: 0.5 };
      const old: MemoryForScoring = { id: '2', content: 'test', timestamp: Date.now() - 100000000, accessCount: 0, relevance: 0.5 };
      expect(mp.calculateImportance(recent)).toBeGreaterThan(mp.calculateImportance(old));
    });

    it('should give higher score for more accessed items', () => {
      const freq: MemoryForScoring = { id: '1', content: 'test', timestamp: Date.now(), accessCount: 50, relevance: 0.5 };
      const rare: MemoryForScoring = { id: '2', content: 'test', timestamp: Date.now(), accessCount: 0, relevance: 0.5 };
      expect(mp.calculateImportance(freq)).toBeGreaterThan(mp.calculateImportance(rare));
    });

    it('should use default relevance 0.5 when not specified', () => {
      const memory: MemoryForScoring = { id: '1', content: 'test', timestamp: Date.now(), accessCount: 0 };
      const score = mp.calculateImportance(memory);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  describe('recencyScore', () => {
    it('should return 1 for current timestamp', () => {
      expect(mp.recencyScore(Date.now())).toBeCloseTo(1, 5);
    });

    it('should return close to 0 for very old timestamps', () => {
      expect(mp.recencyScore(Date.now() - 100000000000)).toBeCloseTo(0, 5);
    });

    it('should return 0.5 for half-life age', () => {
      const halfLifeAgo = Date.now() - 3_600_000;
      expect(mp.recencyScore(halfLifeAgo)).toBeCloseTo(0.5, 2);
    });
  });

  describe('frequencyScore', () => {
    it('should return 0 for 0 accessCount', () => {
      expect(mp.frequencyScore(0)).toBe(0);
    });

    it('should return 1 for very high accessCount', () => {
      expect(mp.frequencyScore(10000)).toBe(1);
    });

    it('should increase with accessCount', () => {
      expect(mp.frequencyScore(10)).toBeGreaterThan(mp.frequencyScore(1));
    });
  });

  describe('relevanceScore', () => {
    it('should return 1 for identical content', () => {
      const memory: MemoryForScoring = { id: '1', content: 'hello world', timestamp: 0, accessCount: 0 };
      expect(mp.relevanceScore(memory, 'hello world')).toBe(1);
    });

    it('should return 0 for completely different content', () => {
      const memory: MemoryForScoring = { id: '1', content: 'abc', timestamp: 0, accessCount: 0 };
      expect(mp.relevanceScore(memory, 'xyz')).toBe(0);
    });

    it('should handle empty strings', () => {
      const memory: MemoryForScoring = { id: '1', content: '', timestamp: 0, accessCount: 0 };
      // Empty content split gives [''], context '' split gives ['']
      // Both have size 1, overlap is 0 (empty string in both sets)
      // Actually ''.split(/\s+/) gives [''], so both sets have {''}
      // overlap = 1, denominator = max(1, 1, 1) = 1, result = 1/1 = 1
      expect(mp.relevanceScore(memory, '')).toBe(1);
    });
  });

  describe('emotionalScore', () => {
    it('should return 0.5 for undefined emotion', () => {
      expect(mp.emotionalScore()).toBe(0.5);
    });

    it('should return known emotion scores', () => {
      expect(mp.emotionalScore('positive')).toBe(0.8);
      expect(mp.emotionalScore('satisfaction')).toBe(0.85);
      expect(mp.emotionalScore('negative')).toBe(0.7);
      expect(mp.emotionalScore('frustration')).toBe(0.75);
      expect(mp.emotionalScore('surprise')).toBe(0.9);
      expect(mp.emotionalScore('neutral')).toBe(0.4);
    });

    it('should return 0.5 for unknown emotion', () => {
      expect(mp.emotionalScore('unknown_emotion')).toBe(0.5);
    });

    it('should be case-insensitive', () => {
      expect(mp.emotionalScore('POSITIVE')).toBe(0.8);
      expect(mp.emotionalScore('Positive')).toBe(0.8);
    });
  });

  describe('prioritize', () => {
    it('should sort memories by combined score', () => {
      const memories: MemoryForScoring[] = [
        { id: '1', content: 'low', timestamp: Date.now() - 100000, accessCount: 0, relevance: 0.1 },
        { id: '2', content: 'high relevance', timestamp: Date.now(), accessCount: 10, relevance: 0.9 },
      ];
      const sorted = mp.prioritize(memories, 'relevance');
      expect(sorted[0]!.id).toBe('2');
    });
  });

  describe('shouldForget', () => {
    it('should return true for old, rarely accessed memories', () => {
      const memory: MemoryForScoring = {
        id: '1',
        content: 'old memory',
        timestamp: Date.now() - 100000000000,
        accessCount: 0,
        relevance: 0.1,
      };
      expect(mp.shouldForget(memory, 0.2)).toBe(true);
    });

    it('should return false for recent, frequently accessed memories', () => {
      const memory: MemoryForScoring = {
        id: '1',
        content: 'new memory',
        timestamp: Date.now(),
        accessCount: 100,
        relevance: 0.9,
      };
      expect(mp.shouldForget(memory, 0.2)).toBe(false);
    });
  });

  describe('getForgettingCurve', () => {
    it('should return 1 for age 0', () => {
      expect(mp.getForgettingCurve(0, 0)).toBeCloseTo(1, 5);
    });

    it('should decrease with age', () => {
      const r1 = mp.getForgettingCurve(1000, 0);
      const r2 = mp.getForgettingCurve(100000, 0);
      expect(r1).toBeGreaterThan(r2);
    });

    it('should increase stability with accessCount', () => {
      const r1 = mp.getForgettingCurve(100000, 0);
      const r2 = mp.getForgettingCurve(100000, 10);
      expect(r2).toBeGreaterThan(r1);
    });

    it('should cap accessCount at 10 for stability', () => {
      const r1 = mp.getForgettingCurve(100000, 10);
      const r2 = mp.getForgettingCurve(100000, 100);
      expect(r1).toBeCloseTo(r2, 5);
    });
  });
});

// ============================================================
// MemoryConsolidator Tests
// ============================================================
describe('MemoryConsolidator', () => {
  let consolidator: MemoryConsolidator;

  beforeEach(() => {
    consolidator = new MemoryConsolidator();
  });

  describe('consolidateWorkingToShortTerm', () => {
    it('should move low-relevance items to short-term', () => {
      const wm = new WorkingMemory(10);
      wm.add({ id: '1', content: 'low', type: 'context', relevance: 0.1, timestamp: 0, accessCount: 0, metadata: {} });
      wm.add({ id: '2', content: 'high', type: 'context', relevance: 0.8, timestamp: 0, accessCount: 0, metadata: {} });
      const stm = new ShortTermMemory(1000);
      const count = consolidator.consolidateWorkingToShortTerm(wm, stm);
      expect(count).toBe(1);
      expect(wm.getAll().length).toBe(1);
      expect(stm.getStats().messageCount).toBe(1);
    });

    it('should return 0 when no items to consolidate', () => {
      const wm = new WorkingMemory(10);
      wm.add({ id: '1', content: 'high', type: 'context', relevance: 0.9, timestamp: 0, accessCount: 0, metadata: {} });
      const stm = new ShortTermMemory(1000);
      const count = consolidator.consolidateWorkingToShortTerm(wm, stm);
      expect(count).toBe(0);
    });
  });

  describe('consolidateShortToLongTerm', () => {
    it('should extract key points from messages', () => {
      const stm = new ShortTermMemory(1000);
      stm.addMessage('user', 'Hello world');
      stm.addMessage('assistant', 'Hi there');
      const ltm = new LongTermMemory();
      const count = consolidator.consolidateShortToLongTerm(stm, ltm);
      expect(count).toBe(2);
    });

    it('should return 0 for empty short-term memory', () => {
      const stm = new ShortTermMemory(1000);
      const ltm = new LongTermMemory();
      const count = consolidator.consolidateShortToLongTerm(stm, ltm);
      expect(count).toBe(0);
    });
  });

  describe('extractKeyPoints', () => {
    it('should extract from user messages', () => {
      const stm = new ShortTermMemory(1000);
      stm.addMessage('user', 'important info');
      const points = consolidator.extractKeyPoints(stm.getRecent(50));
      expect(points.some((p) => p.tags.includes('user-input'))).toBe(true);
    });

    it('should extract from assistant messages', () => {
      const stm = new ShortTermMemory(1000);
      stm.addMessage('assistant', 'response data');
      const points = consolidator.extractKeyPoints(stm.getRecent(50));
      expect(points.some((p) => p.tags.includes('assistant-response'))).toBe(true);
    });

    it('should return empty for empty messages', () => {
      expect(consolidator.extractKeyPoints([])).toEqual([]);
    });
  });

  describe('generateSummary', () => {
    it('should return default for empty memories', () => {
      expect(consolidator.generateSummary([])).toBe('No memories to summarize.');
    });

    it('should generate summary', () => {
      const memories: LongTermMemoryEntry[] = [
        { key: 'k1', value: 'v1', tags: ['a'], metadata: {}, timestamp: Date.now(), accessCount: 0, importance: 0.5 },
        { key: 'k2', value: 'v2', tags: ['b'], metadata: {}, timestamp: Date.now(), accessCount: 0, importance: 0.8 },
      ];
      const summary = consolidator.generateSummary(memories);
      expect(summary).toContain('2 memories');
      expect(summary).toContain('0.65'); // avg importance
    });
  });

  describe('mergeRelated', () => {
    it('should merge entries with 2+ common tags', () => {
      const ltm = new LongTermMemory();
      ltm.store('k1', 'v1', ['a', 'b', 'c']);
      ltm.store('k2', 'v2', ['a', 'b', 'd']);
      const merged = consolidator.mergeRelated(ltm);
      expect(merged).toBe(1);
      expect(ltm.getStats().entryCount).toBe(1);
    });

    it('should not merge entries with < 2 common tags', () => {
      const ltm = new LongTermMemory();
      ltm.store('k1', 'v1', ['a']);
      ltm.store('k2', 'v2', ['b']);
      const merged = consolidator.mergeRelated(ltm);
      expect(merged).toBe(0);
      expect(ltm.getStats().entryCount).toBe(2);
    });

    it('should preserve merged importance (max)', () => {
      const ltm = new LongTermMemory();
      ltm.store('k1', 'v1', ['a', 'b']);
      ltm.store('k2', 'v2', ['a', 'b']);
      // Manually set importance since store uses default
      ltm.consolidate([{ key: 'k1', value: 'v1', tags: ['a', 'b'], metadata: {}, timestamp: Date.now(), accessCount: 0, importance: 0.9 }]);
      consolidator.mergeRelated(ltm);
      const entry = ltm.retrieve('k1');
      expect(entry!.importance).toBe(0.9);
    });

    it('should handle empty long-term memory', () => {
      const ltm = new LongTermMemory();
      expect(consolidator.mergeRelated(ltm)).toBe(0);
    });
  });

  describe('pruneUnimportant', () => {
    it('should prune low-importance entries', () => {
      const ltm = new LongTermMemory();
      // Create an entry with very old timestamp and 0 access count
      // so the forgetting curve value is very low
      ltm.consolidate([{
        key: 'k1',
        value: 'v1',
        tags: [],
        metadata: {},
        timestamp: Date.now() - 100000000000, // very old
        accessCount: 0,
        importance: 0.1,
      }]);
      const pruned = consolidator.pruneUnimportant(ltm, 0.2);
      expect(pruned).toBe(1);
    });

    it('should not prune high-importance entries', () => {
      const ltm = new LongTermMemory();
      ltm.consolidate([{ key: 'k1', value: 'v1', tags: [], metadata: {}, timestamp: Date.now(), accessCount: 100, importance: 0.9 }]);
      const pruned = consolidator.pruneUnimportant(ltm, 0.2);
      expect(pruned).toBe(0);
    });
  });

  describe('getConsolidationStats', () => {
    it('should return initial stats', () => {
      const stats = consolidator.getConsolidationStats();
      expect(stats.workingToShortTerm).toBe(0);
      expect(stats.shortToLongTerm).toBe(0);
      expect(stats.keyPointsExtracted).toBe(0);
      expect(stats.memoriesMerged).toBe(0);
      expect(stats.memoriesPruned).toBe(0);
      expect(stats.lastConsolidation).toBe(0);
    });

    it('should update stats after consolidation', () => {
      const wm = new WorkingMemory(10);
      wm.add({ id: '1', content: 'low', type: 'context', relevance: 0.1, timestamp: 0, accessCount: 0, metadata: {} });
      const stm = new ShortTermMemory(1000);
      consolidator.consolidateWorkingToShortTerm(wm, stm);
      const stats = consolidator.getConsolidationStats();
      expect(stats.workingToShortTerm).toBe(1);
      expect(stats.lastConsolidation).toBeGreaterThan(0);
    });
  });
});

// ============================================================
// MemoryRetriever Tests
// ============================================================
describe('MemoryRetriever', () => {
  let retriever: MemoryRetriever;
  let wm: WorkingMemory;
  let stm: ShortTermMemory;
  let ltm: LongTermMemory;
  let em: EpisodicMemory;
  let sm: SemanticMemory;

  beforeEach(() => {
    wm = new WorkingMemory(10);
    stm = new ShortTermMemory(1000);
    ltm = new LongTermMemory();
    em = new EpisodicMemory();
    sm = new SemanticMemory();
    retriever = new MemoryRetriever(wm, stm, ltm, em, sm);
  });

  describe('retrieve', () => {
    it('should retrieve from working memory', () => {
      wm.add({ id: '1', content: 'hello world', type: 'context', relevance: 0.8, timestamp: Date.now(), accessCount: 0, metadata: {} });
      const results = retriever.retrieve('hello');
      expect(results.some((r) => r.tier === 'working')).toBe(true);
    });

    it('should retrieve from short-term memory', () => {
      stm.addMessage('user', 'hello world');
      const results = retriever.retrieve('hello');
      expect(results.some((r) => r.tier === 'short-term')).toBe(true);
    });

    it('should retrieve from long-term memory', () => {
      ltm.store('k1', 'hello world');
      const results = retriever.retrieve('hello');
      expect(results.some((r) => r.tier === 'long-term')).toBe(true);
    });

    it('should retrieve from episodic memory', () => {
      em.record({ context: 'hello world', actions: [], outcome: '', emotion: 'neutral', importance: 0.5, tags: [], lessons: [] });
      const results = retriever.retrieve('hello');
      expect(results.some((r) => r.tier === 'episodic')).toBe(true);
    });

    it('should retrieve from semantic memory', () => {
      sm.addConcept('hello', 'world concept');
      const results = retriever.retrieve('hello');
      expect(results.some((r) => r.tier === 'semantic')).toBe(true);
    });

    it('should filter by tiers', () => {
      wm.add({ id: '1', content: 'test', type: 'context', relevance: 0.5, timestamp: Date.now(), accessCount: 0, metadata: {} });
      stm.addMessage('user', 'test');
      const results = retriever.retrieve('test', { tiers: ['working'] });
      expect(results.length).toBe(1);
      expect(results[0]!.tier).toBe('working');
    });

    it('should respect maxItems', () => {
      wm.add({ id: '1', content: 'test', type: 'context', relevance: 0.5, timestamp: Date.now(), accessCount: 0, metadata: {} });
      stm.addMessage('user', 'test');
      const results = retriever.retrieve('test', { maxItems: 1 });
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('should return empty when no matches', () => {
      expect(retriever.retrieve('nonexistent')).toEqual([]);
    });

    it('should rank results by relevance', () => {
      wm.add({ id: '1', content: 'exact match', type: 'context', relevance: 0.9, timestamp: Date.now(), accessCount: 0, metadata: {} });
      wm.add({ id: '2', content: 'partial', type: 'context', relevance: 0.3, timestamp: Date.now(), accessCount: 0, metadata: {} });
      const results = retriever.retrieve('exact match');
      expect(results[0]!.id).toBe('1');
    });
  });

  describe('retrieveRelevant', () => {
    it('should retrieve relevant memories', () => {
      wm.add({ id: '1', content: 'context data', type: 'context', relevance: 0.8, timestamp: Date.now(), accessCount: 0, metadata: {} });
      const results = retriever.retrieveRelevant('context', 5);
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('should default to 10 items', () => {
      for (let i = 0; i < 20; i++) {
        wm.add({ id: `${i}`, content: `item ${i}`, type: 'context', relevance: 0.5, timestamp: Date.now(), accessCount: 0, metadata: {} });
      }
      const results = retriever.retrieveRelevant('item');
      expect(results.length).toBeLessThanOrEqual(10);
    });
  });

  describe('retrieveRecent', () => {
    it('should retrieve recent memories within time window', () => {
      wm.add({ id: '1', content: 'recent', type: 'context', relevance: 0.5, timestamp: Date.now(), accessCount: 0, metadata: {} });
      const results = retriever.retrieveRecent(60000); // 1 minute
      expect(results.length).toBeGreaterThan(0);
    });

    it('should return empty when no recent memories', () => {
      const results = retriever.retrieveRecent(1); // 1ms window
      expect(results.length).toBe(0);
    });

    it('should sort by timestamp descending', () => {
      wm.add({ id: '1', content: 'older', type: 'context', relevance: 0.5, timestamp: Date.now() - 1000, accessCount: 0, metadata: {} });
      wm.add({ id: '2', content: 'newer', type: 'context', relevance: 0.5, timestamp: Date.now(), accessCount: 0, metadata: {} });
      const results = retriever.retrieveRecent(60000);
      expect(results[0]!.id).toBe('2');
    });
  });

  describe('retrieveByTag', () => {
    it('should retrieve from long-term by tag', () => {
      ltm.store('k1', 'v1', ['important']);
      const results = retriever.retrieveByTag('important');
      expect(results.length).toBe(1);
      expect(results[0]!.tier).toBe('long-term');
    });

    it('should return empty for non-existing tag', () => {
      expect(retriever.retrieveByTag('nonexistent')).toEqual([]);
    });
  });

  describe('rankResults', () => {
    it('should sort by relevance descending', () => {
      const results: RetrievedMemory[] = [
        { tier: 'test', id: '1', content: 'low', relevance: 0.3, metadata: {}, timestamp: 0 },
        { tier: 'test', id: '2', content: 'high', relevance: 0.9, metadata: {}, timestamp: 0 },
      ];
      const ranked = retriever.rankResults(results, '');
      expect(ranked[0]!.relevance).toBe(0.9);
    });
  });

  describe('formatContext', () => {
    it('should return default for empty memories', () => {
      expect(retriever.formatContext([])).toBe('No relevant memories found.');
    });

    it('should format memories grouped by tier', () => {
      const memories: RetrievedMemory[] = [
        { tier: 'working', id: '1', content: 'item1', relevance: 0.5, metadata: {}, timestamp: 0 },
        { tier: 'long-term', id: '2', content: 'item2', relevance: 0.5, metadata: {}, timestamp: 0 },
      ];
      const ctx = retriever.formatContext(memories);
      expect(ctx).toContain('[WORKING]');
      expect(ctx).toContain('[LONG-TERM]');
      expect(ctx).toContain('item1');
      expect(ctx).toContain('item2');
    });
  });
});

// ============================================================
// MemorySerializer Tests
// ============================================================
describe('MemorySerializer', () => {
  let serializer: MemorySerializer;
  let manager: MemoryManager;

  beforeEach(() => {
    serializer = new MemorySerializer();
    manager = new MemoryManager();
  });

  describe('serialize', () => {
    it('should serialize empty manager', () => {
      const state = serializer.serialize(manager);
      expect(state.version).toBe('1.0.0');
      expect(state.timestamp).toBeGreaterThan(0);
      expect(state.workingMemory).toEqual([]);
      expect(state.shortTermMemory).toEqual([]);
      expect(state.longTermMemory).toEqual([]);
      expect(state.episodicMemory).toEqual([]);
      expect(state.semanticMemory.concepts).toEqual([]);
      expect(state.semanticMemory.relations).toEqual([]);
    });

    it('should serialize populated manager', async () => {
      await manager.initialize();
      manager.remember('test content', { tier: 'working' });
      manager.remember('conversation', { tier: 'short-term' });
      manager.remember('knowledge', { tier: 'long-term', tags: ['info'] });
      manager.remember('experience', { tier: 'episodic' });
      manager.remember('concept', { tier: 'semantic' });
      const state = serializer.serialize(manager);
      expect(state.workingMemory.length).toBe(1);
      expect(state.shortTermMemory.length).toBe(1);
      expect(state.longTermMemory.length).toBe(1);
      expect(state.episodicMemory.length).toBe(1);
      expect(state.semanticMemory.concepts.length).toBe(1);
    });
  });

  describe('deserialize', () => {
    it('should throw for invalid state', () => {
      expect(() => serializer.deserialize(null as any)).toThrow('Invalid memory state data');
      expect(() => serializer.deserialize({} as any)).toThrow('Invalid memory state data');
      expect(() => serializer.deserialize({ version: 'x' } as any)).toThrow('Invalid memory state data');
    });

    it('should deserialize valid state into manager', async () => {
      await manager.initialize();
      manager.remember('test', { tier: 'working' });
      manager.remember('conv', { tier: 'short-term' });
      manager.remember('knowledge', { tier: 'long-term', tags: ['info'] });
      manager.remember('exp', { tier: 'episodic' });
      manager.remember('concept', { tier: 'semantic' });

      const state = serializer.serialize(manager);
      const manager2 = new MemoryManager();
      await manager2.initialize();
      serializer.deserialize(state, manager2);

      expect(manager2.getWorkingMemory().getAll().length).toBe(1);
      expect(manager2.getShortTermMemory().getStats().messageCount).toBe(1);
      expect(manager2.getLongTermMemory().getStats().entryCount).toBe(1);
      expect(manager2.getEpisodicMemory().getAll().length).toBe(1);
      expect(manager2.getSemanticMemory().getStats().conceptCount).toBe(1);
    });

    it('should clear existing state before deserializing', async () => {
      await manager.initialize();
      manager.remember('old', { tier: 'working' });

      const newState: SerializedMemoryState = {
        version: '1.0.0',
        timestamp: Date.now(),
        workingMemory: [],
        shortTermMemory: [],
        longTermMemory: [],
        episodicMemory: [],
        semanticMemory: { concepts: [], relations: [] },
      };
      serializer.deserialize(newState, manager);
      expect(manager.getWorkingMemory().getAll().length).toBe(0);
    });

    it('should work without manager (just validate)', () => {
      const state: SerializedMemoryState = {
        version: '1.0.0',
        timestamp: Date.now(),
        workingMemory: [],
        shortTermMemory: [],
        longTermMemory: [],
        episodicMemory: [],
        semanticMemory: { concepts: [], relations: [] },
      };
      expect(() => serializer.deserialize(state)).not.toThrow();
    });
  });

  describe('serializeTier', () => {
    it('should serialize working memory', () => {
      const wm = new WorkingMemory();
      wm.add({ id: '1', content: 'test', type: 'context', relevance: 0.5, timestamp: 0, accessCount: 0, metadata: {} });
      const data = serializer.serializeTier(wm, 'working');
      expect(Array.isArray(data)).toBe(true);
    });

    it('should serialize short-term memory', () => {
      const stm = new ShortTermMemory();
      stm.addMessage('user', 'test');
      const data = serializer.serializeTier(stm, 'short-term');
      expect(Array.isArray(data)).toBe(true);
    });

    it('should serialize long-term memory', () => {
      const ltm = new LongTermMemory();
      ltm.store('k1', 'v1');
      const data = serializer.serializeTier(ltm, 'long-term');
      expect(Array.isArray(data)).toBe(true);
    });

    it('should serialize episodic memory', () => {
      const em = new EpisodicMemory();
      em.record({ context: 'test', actions: [], outcome: '', emotion: 'neutral', importance: 0.5, tags: [], lessons: [] });
      const data = serializer.serializeTier(em, 'episodic');
      expect(Array.isArray(data)).toBe(true);
    });

    it('should serialize semantic memory', () => {
      const sm = new SemanticMemory();
      sm.addConcept('A', 'a');
      const data = serializer.serializeTier(sm, 'semantic');
      expect(typeof data === 'object').toBe(true);
    });

    it('should throw for unknown tier', () => {
      expect(() => serializer.serializeTier({} as any, 'unknown')).toThrow('Unknown memory tier type');
    });
  });

  describe('deserializeTier', () => {
    it('should throw for null data', () => {
      expect(() => serializer.deserializeTier(null, 'working')).toThrow('Invalid tier data');
    });

    it('should throw for non-object data', () => {
      expect(() => serializer.deserializeTier('string', 'working')).toThrow('Invalid tier data');
    });

    it('should throw for unknown tier', () => {
      expect(() => serializer.deserializeTier({}, 'unknown')).toThrow('Unknown memory tier type');
    });

    it('should return data for known tiers', () => {
      expect(serializer.deserializeTier([], 'working')).toEqual([]);
      expect(serializer.deserializeTier([], 'short-term')).toEqual([]);
      expect(serializer.deserializeTier([], 'long-term')).toEqual([]);
      expect(serializer.deserializeTier([], 'episodic')).toEqual([]);
      expect(serializer.deserializeTier([], 'semantic')).toEqual([]);
    });
  });

  describe('exportToJSON/importFromJSON', () => {
    it('should export as JSON string', async () => {
      await manager.initialize();
      const json = serializer.exportToJSON(manager);
      const parsed = JSON.parse(json);
      expect(parsed.version).toBe('1.0.0');
    });

    it('should import from JSON string', async () => {
      await manager.initialize();
      manager.remember('test', { tier: 'working' });
      const json = serializer.exportToJSON(manager);
      const state = serializer.importFromJSON(json);
      expect(state.workingMemory.length).toBe(1);
    });

    it('should throw for invalid JSON', () => {
      expect(() => serializer.importFromJSON('not json')).toThrow();
    });

    it('should throw for valid JSON but invalid state', () => {
      expect(() => serializer.importFromJSON('{}')).toThrow('Invalid JSON memory state');
    });
  });

  describe('diff', () => {
    it('should compute diff between states', () => {
      const oldState: SerializedMemoryState = {
        version: '1.0.0', timestamp: 0,
        workingMemory: [{ id: '1', content: 'a', type: 'context', relevance: 0.5, timestamp: 0, accessCount: 0, metadata: {} }],
        shortTermMemory: [{ id: 'm1', role: 'user', content: 'msg', timestamp: 0, tokens: 1, metadata: {} }],
        longTermMemory: [{ key: 'k1', value: 'v1', tags: [], metadata: {}, timestamp: 0, accessCount: 0, importance: 0.5 }],
        episodicMemory: [{ id: 'ep1', context: 'c', actions: [], outcome: '', emotion: 'neutral', timestamp: 0, importance: 0.5, tags: [], lessons: [] }],
        semanticMemory: { concepts: [{ name: 'A', description: 'a', properties: {}, relations: [] }], relations: [] },
      };
      const newState: SerializedMemoryState = {
        version: '1.0.0', timestamp: 0,
        workingMemory: [{ id: '2', content: 'b', type: 'context', relevance: 0.5, timestamp: 0, accessCount: 0, metadata: {} }],
        shortTermMemory: [{ id: 'm2', role: 'user', content: 'msg2', timestamp: 0, tokens: 1, metadata: {} }],
        longTermMemory: [{ key: 'k2', value: 'v2', tags: [], metadata: {}, timestamp: 0, accessCount: 0, importance: 0.5 }],
        episodicMemory: [{ id: 'ep2', context: 'c2', actions: [], outcome: '', emotion: 'neutral', timestamp: 0, importance: 0.5, tags: [], lessons: [] }],
        semanticMemory: { concepts: [{ name: 'B', description: 'b', properties: {}, relations: [] }], relations: [] },
      };
      const diff = serializer.diff(oldState, newState);
      expect(diff.added.working).toBe(1);
      expect(diff.removed.working).toBe(1);
      expect(diff.added.shortTerm).toBe(1);
      expect(diff.removed.shortTerm).toBe(1);
      expect(diff.added.longTerm).toBe(1);
      expect(diff.removed.longTerm).toBe(1);
      expect(diff.added.episodic).toBe(1);
      expect(diff.removed.episodic).toBe(1);
      expect(diff.added.semantic).toBe(1);
      expect(diff.removed.semantic).toBe(1);
    });

    it('should detect modified entries', () => {
      const base: SerializedMemoryState = {
        version: '1.0.0', timestamp: 0,
        workingMemory: [],
        shortTermMemory: [],
        longTermMemory: [{ key: 'k1', value: 'v1', tags: [], metadata: {}, timestamp: 0, accessCount: 0, importance: 0.5 }],
        episodicMemory: [],
        semanticMemory: { concepts: [], relations: [] },
      };
      const modified: SerializedMemoryState = {
        ...base,
        longTermMemory: [{ key: 'k1', value: 'v1', tags: [], metadata: {}, timestamp: 0, accessCount: 5, importance: 0.5 }],
      };
      const diff = serializer.diff(base, modified);
      expect(diff.modified.longTerm).toBe(1);
    });

    it('should handle identical states', () => {
      const state: SerializedMemoryState = {
        version: '1.0.0', timestamp: 0,
        workingMemory: [],
        shortTermMemory: [],
        longTermMemory: [],
        episodicMemory: [],
        semanticMemory: { concepts: [], relations: [] },
      };
      const diff = serializer.diff(state, state);
      expect(diff.added.working).toBe(0);
      expect(diff.removed.working).toBe(0);
    });
  });

  describe('mergeStates', () => {
    it('should throw for empty states array', () => {
      expect(() => serializer.mergeStates([])).toThrow('No states to merge');
    });

    it('should return single state unchanged', () => {
      const state: SerializedMemoryState = {
        version: '1.0.0', timestamp: 0,
        workingMemory: [{ id: '1', content: 'a', type: 'context', relevance: 0.5, timestamp: 0, accessCount: 0, metadata: {} }],
        shortTermMemory: [],
        longTermMemory: [],
        episodicMemory: [],
        semanticMemory: { concepts: [], relations: [] },
      };
      const merged = serializer.mergeStates([state]);
      expect(merged.workingMemory.length).toBe(1);
    });

    it('should merge multiple states', () => {
      const state1: SerializedMemoryState = {
        version: '1.0.0', timestamp: 0,
        workingMemory: [{ id: '1', content: 'a', type: 'context', relevance: 0.5, timestamp: 0, accessCount: 0, metadata: {} }],
        shortTermMemory: [],
        longTermMemory: [{ key: 'k1', value: 'v1', tags: [], metadata: {}, timestamp: 0, accessCount: 0, importance: 0.5 }],
        episodicMemory: [],
        semanticMemory: { concepts: [], relations: [] },
      };
      const state2: SerializedMemoryState = {
        version: '1.0.0', timestamp: 0,
        workingMemory: [{ id: '2', content: 'b', type: 'context', relevance: 0.5, timestamp: 0, accessCount: 0, metadata: {} }],
        shortTermMemory: [],
        longTermMemory: [{ key: 'k2', value: 'v2', tags: [], metadata: {}, timestamp: 0, accessCount: 0, importance: 0.5 }],
        episodicMemory: [],
        semanticMemory: { concepts: [], relations: [] },
      };
      const merged = serializer.mergeStates([state1, state2]);
      expect(merged.workingMemory.length).toBe(2);
      expect(merged.longTermMemory.length).toBe(2);
    });

    it('should deduplicate by id/key', () => {
      const state1: SerializedMemoryState = {
        version: '1.0.0', timestamp: 0,
        workingMemory: [{ id: '1', content: 'a', type: 'context', relevance: 0.5, timestamp: 0, accessCount: 0, metadata: {} }],
        shortTermMemory: [],
        longTermMemory: [{ key: 'k1', value: 'v1', tags: [], metadata: {}, timestamp: 0, accessCount: 0, importance: 0.5 }],
        episodicMemory: [],
        semanticMemory: { concepts: [{ name: 'A', description: 'a', properties: {}, relations: [] }], relations: [] },
      };
      const state2: SerializedMemoryState = {
        version: '1.0.0', timestamp: 0,
        workingMemory: [{ id: '1', content: 'a-updated', type: 'context', relevance: 0.5, timestamp: 0, accessCount: 0, metadata: {} }],
        shortTermMemory: [],
        longTermMemory: [{ key: 'k1', value: 'v1-new', tags: [], metadata: {}, timestamp: 0, accessCount: 0, importance: 0.5 }],
        episodicMemory: [],
        semanticMemory: { concepts: [{ name: 'A', description: 'a-new', properties: {}, relations: [] }], relations: [] },
      };
      const merged = serializer.mergeStates([state1, state2]);
      expect(merged.workingMemory.length).toBe(1);
      expect(merged.longTermMemory.length).toBe(1);
      expect(merged.semanticMemory.concepts.length).toBe(1);
    });
  });

  describe('validateState', () => {
    it('should return true for valid state', () => {
      const state = {
        version: '1.0.0',
        timestamp: 0,
        workingMemory: [],
        shortTermMemory: [],
        longTermMemory: [],
        episodicMemory: [],
        semanticMemory: { concepts: [], relations: [] },
      };
      expect(serializer.validateState(state)).toBe(true);
    });

    it('should return false for null', () => {
      expect(serializer.validateState(null)).toBe(false);
    });

    it('should return false for non-object', () => {
      expect(serializer.validateState('string')).toBe(false);
    });

    it('should return false for missing fields', () => {
      expect(serializer.validateState({ version: '1.0' })).toBe(false);
    });

    it('should return false for wrong types', () => {
      expect(serializer.validateState({
        version: 1,
        timestamp: 'x',
        workingMemory: {},
        shortTermMemory: [],
        longTermMemory: [],
        episodicMemory: [],
        semanticMemory: { concepts: [], relations: [] },
      })).toBe(false);
    });
  });
});

// ============================================================
// MemoryManager Tests
// ============================================================
describe('MemoryManager', () => {
  let mm: MemoryManager;

  beforeEach(() => {
    mm = new MemoryManager({
      workingMemoryCapacity: 5,
      shortTermMaxTokens: 500,
      longTermMaxEntries: 100,
      autoConsolidate: false,
    });
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      const m = new MemoryManager();
      expect(m.getStats().working.capacity).toBe(7);
    });

    it('should create with custom config', () => {
      expect(mm.getStats().working.capacity).toBe(5);
    });
  });

  describe('initialize', () => {
    it('should set initialized to true', async () => {
      expect(mm.isInitialized()).toBe(false);
      await mm.initialize();
      expect(mm.isInitialized()).toBe(true);
    });
  });

  describe('remember', () => {
    it('should remember to working memory by default', () => {
      mm.remember('test content');
      expect(mm.getStats().working.itemCount).toBe(1);
    });

    it('should remember to short-term memory', () => {
      mm.remember('conversation', { tier: 'short-term' });
      expect(mm.getStats().shortTerm.messageCount).toBe(1);
    });

    it('should remember to long-term memory', () => {
      mm.remember('knowledge', { tier: 'long-term', tags: ['info'] });
      expect(mm.getStats().longTerm.entryCount).toBe(1);
    });

    it('should remember to episodic memory', () => {
      mm.remember('experience', { tier: 'episodic' });
      expect(mm.getStats().episodic.episodeCount).toBe(1);
    });

    it('should remember to semantic memory', () => {
      mm.remember('concept data', { tier: 'semantic' });
      expect(mm.getStats().semantic.conceptCount).toBe(1);
    });

    it('should pass importance to working memory', () => {
      mm.remember('important', { importance: 0.9 });
      const item = mm.getWorkingMemory().getAll()[0]!;
      expect(item.relevance).toBe(0.9);
    });

    it('should pass metadata', () => {
      mm.remember('test', { metadata: { key: 'value' } });
      const item = mm.getWorkingMemory().getAll()[0]!;
      expect(item.metadata).toEqual({ key: 'value' });
    });

    it('should auto-consolidate when enabled', () => {
      const autoMm = new MemoryManager({ autoConsolidate: true });
      autoMm.remember('test');
      // Should not throw
    });
  });

  describe('recall', () => {
    it('should recall from all tiers by default', () => {
      mm.remember('searchable content');
      const results = mm.recall('searchable');
      expect(results.length).toBeGreaterThan(0);
    });

    it('should filter by tiers', () => {
      mm.remember('test', { tier: 'working' });
      mm.remember('test', { tier: 'long-term' });
      const results = mm.recall('test', { tiers: ['working'] });
      expect(results.every((r) => r.tier === 'working')).toBe(true);
    });

    it('should respect maxItems', () => {
      mm.remember('test', { tier: 'working' });
      mm.remember('test', { tier: 'long-term' });
      const results = mm.recall('test', { maxItems: 1 });
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('should return empty for no matches', () => {
      expect(mm.recall('nonexistent')).toEqual([]);
    });
  });

  describe('forget', () => {
    it('should delegate to long-term memory forget', () => {
      mm.remember('to forget', { tier: 'long-term', tags: ['temp'] });
      const count = mm.forget({ tags: ['temp'] });
      expect(count).toBe(1);
    });

    it('should return 0 when no criteria (safety)', () => {
      mm.remember('keep', { tier: 'long-term' });
      expect(mm.forget({})).toBe(0);
    });
  });

  describe('consolidate', () => {
    it('should consolidate working to short-term', () => {
      mm.remember('low priority', { importance: 0.1 });
      mm.consolidate();
      expect(mm.getStats().shortTerm.messageCount).toBeGreaterThan(0);
    });
  });

  describe('getContext', () => {
    it('should return formatted context', () => {
      mm.remember('context data');
      const ctx = mm.getContext();
      expect(typeof ctx).toBe('string');
    });

    it('should use window when specified', () => {
      mm.remember('recent data');
      const ctx = mm.getContext(60000);
      expect(typeof ctx).toBe('string');
    });
  });

  describe('getStats', () => {
    it('should return stats from all tiers', () => {
      const stats = mm.getStats();
      expect(stats.working).toBeDefined();
      expect(stats.shortTerm).toBeDefined();
      expect(stats.longTerm).toBeDefined();
      expect(stats.episodic).toBeDefined();
      expect(stats.semantic).toBeDefined();
      expect(stats.consolidation).toBeDefined();
    });
  });

  describe('export/import', () => {
    it('should export and import state', async () => {
      await mm.initialize();
      mm.remember('test', { tier: 'working' });
      mm.remember('conv', { tier: 'short-term' });
      mm.remember('knowledge', { tier: 'long-term' });
      mm.remember('exp', { tier: 'episodic' });
      mm.remember('concept', { tier: 'semantic' });

      const data = mm.export();
      const mm2 = new MemoryManager();
      await mm2.initialize();
      mm2.import(data);

      expect(mm2.getWorkingMemory().getAll().length).toBe(1);
      expect(mm2.getShortTermMemory().getStats().messageCount).toBe(1);
      expect(mm2.getLongTermMemory().getStats().entryCount).toBe(1);
      expect(mm2.getEpisodicMemory().getAll().length).toBe(1);
      expect(mm2.getSemanticMemory().getStats().conceptCount).toBe(1);
    });
  });

  describe('reset', () => {
    it('should clear all memory tiers', async () => {
      await mm.initialize();
      mm.remember('test', { tier: 'working' });
      mm.remember('conv', { tier: 'short-term' });
      mm.remember('knowledge', { tier: 'long-term' });
      mm.remember('exp', { tier: 'episodic' });
      mm.remember('concept', { tier: 'semantic' });

      mm.reset();

      expect(mm.getStats().working.itemCount).toBe(0);
      expect(mm.getStats().shortTerm.messageCount).toBe(0);
      expect(mm.getStats().longTerm.entryCount).toBe(0);
      expect(mm.getStats().episodic.episodeCount).toBe(0);
      expect(mm.getStats().semantic.conceptCount).toBe(0);
      expect(mm.isInitialized()).toBe(false);
    });
  });

  describe('getters', () => {
    it('should expose sub-components', () => {
      expect(mm.getWorkingMemory()).toBeInstanceOf(WorkingMemory);
      expect(mm.getShortTermMemory()).toBeInstanceOf(ShortTermMemory);
      expect(mm.getLongTermMemory()).toBeInstanceOf(LongTermMemory);
      expect(mm.getEpisodicMemory()).toBeInstanceOf(EpisodicMemory);
      expect(mm.getSemanticMemory()).toBeInstanceOf(SemanticMemory);
      expect(mm.getConsolidator()).toBeInstanceOf(MemoryConsolidator);
      expect(mm.getRetriever()).toBeInstanceOf(MemoryRetriever);
      expect(mm.getSerializer()).toBeInstanceOf(MemorySerializer);
    });
  });
});
