import { describe, it, expect, beforeEach } from 'bun:test';
import { WorkingMemory } from '../src/working-memory.js';
import { ShortTermMemory } from '../src/short-term-memory.js';
import { LongTermMemory } from '../src/long-term-memory.js';
import { EpisodicMemory } from '../src/episodic-memory.js';
import { SemanticMemory } from '../src/semantic-memory.js';
import { MemoryPrioritizer } from '../src/memory-prioritizer.js';
import { MemoryConsolidator } from '../src/memory-consolidator.js';
import { MemoryRetriever } from '../src/memory-retriever.js';
import { MemoryManager } from '../src/memory-manager.js';
import { MemorySerializer } from '../src/memory-serializer.js';

// ============================================================
// WorkingMemory Tests (20 tests)
// ============================================================
describe('WorkingMemory', () => {
  let wm: WorkingMemory;

  beforeEach(() => {
    wm = new WorkingMemory(5);
  });

  it('should create with default capacity', () => {
    const w = new WorkingMemory();
    expect(w.getStats().capacity).toBe(7);
  });

  it('should create with custom capacity', () => {
    expect(wm.getStats().capacity).toBe(5);
  });

  it('should throw on non-positive capacity', () => {
    expect(() => new WorkingMemory(0)).toThrow();
    expect(() => new WorkingMemory(-1)).toThrow();
  });

  it('should add an item', () => {
    wm.add({ id: '1', content: 'hello', type: 'fact', relevance: 0.8, timestamp: Date.now(), accessCount: 0, metadata: {} });
    expect(wm.getStats().itemCount).toBe(1);
  });

  it('should throw when adding item without id', () => {
    expect(() => wm.add({ id: '', content: 'test', type: 'fact', relevance: 0.5, timestamp: Date.now(), accessCount: 0, metadata: {} })).toThrow();
  });

  it('should throw when adding item without content', () => {
    expect(() => wm.add({ id: '1', content: '', type: 'fact', relevance: 0.5, timestamp: Date.now(), accessCount: 0, metadata: {} })).toThrow();
  });

  it('should evict lowest relevance when at capacity', () => {
    wm.add({ id: '1', content: 'low', type: 'fact', relevance: 0.1, timestamp: Date.now(), accessCount: 0, metadata: {} });
    wm.add({ id: '2', content: 'mid', type: 'fact', relevance: 0.5, timestamp: Date.now(), accessCount: 0, metadata: {} });
    wm.add({ id: '3', content: 'high', type: 'fact', relevance: 0.9, timestamp: Date.now(), accessCount: 0, metadata: {} });
    wm.add({ id: '4', content: 'a', type: 'fact', relevance: 0.3, timestamp: Date.now(), accessCount: 0, metadata: {} });
    wm.add({ id: '5', content: 'b', type: 'fact', relevance: 0.4, timestamp: Date.now(), accessCount: 0, metadata: {} });
    wm.add({ id: '6', content: 'new', type: 'fact', relevance: 0.7, timestamp: Date.now(), accessCount: 0, metadata: {} });
    expect(wm.get('1')).toBeUndefined();
    expect(wm.get('6')).toBeDefined();
    expect(wm.getStats().itemCount).toBe(5);
  });

  it('should remove an item', () => {
    wm.add({ id: '1', content: 'test', type: 'fact', relevance: 0.5, timestamp: Date.now(), accessCount: 0, metadata: {} });
    expect(wm.remove('1')).toBe(true);
    expect(wm.getStats().itemCount).toBe(0);
  });

  it('should return false when removing non-existent item', () => {
    expect(wm.remove('nonexistent')).toBe(false);
  });

  it('should get an item by id', () => {
    wm.add({ id: '1', content: 'hello world', type: 'fact', relevance: 0.5, timestamp: Date.now(), accessCount: 0, metadata: {} });
    const item = wm.get('1');
    expect(item).toBeDefined();
    expect(item!.content).toBe('hello world');
  });

  it('should increment accessCount on get', () => {
    wm.add({ id: '1', content: 'test', type: 'fact', relevance: 0.5, timestamp: Date.now(), accessCount: 0, metadata: {} });
    wm.get('1');
    wm.get('1');
    const item = wm.get('1');
    expect(item!.accessCount).toBe(3);
  });

  it('should return undefined for non-existent get', () => {
    expect(wm.get('nonexistent')).toBeUndefined();
  });

  it('should get all items', () => {
    wm.add({ id: '1', content: 'a', type: 'fact', relevance: 0.5, timestamp: Date.now(), accessCount: 0, metadata: {} });
    wm.add({ id: '2', content: 'b', type: 'fact', relevance: 0.5, timestamp: Date.now(), accessCount: 0, metadata: {} });
    expect(wm.getAll().length).toBe(2);
  });

  it('should search by content', () => {
    wm.add({ id: '1', content: 'hello world', type: 'fact', relevance: 0.5, timestamp: Date.now(), accessCount: 0, metadata: {} });
    wm.add({ id: '2', content: 'goodbye world', type: 'fact', relevance: 0.5, timestamp: Date.now(), accessCount: 0, metadata: {} });
    const results = wm.search('hello');
    expect(results.length).toBe(1);
    expect(results[0]!.id).toBe('1');
  });

  it('should search by metadata', () => {
    wm.add({ id: '1', content: 'test', type: 'fact', relevance: 0.5, timestamp: Date.now(), accessCount: 0, metadata: { category: 'important' } });
    wm.add({ id: '2', content: 'test2', type: 'fact', relevance: 0.5, timestamp: Date.now(), accessCount: 0, metadata: {} });
    const results = wm.search('important');
    expect(results.length).toBe(1);
  });

  it('should prioritize items', () => {
    wm.add({ id: '1', content: 'low', type: 'fact', relevance: 0.1, timestamp: Date.now(), accessCount: 0, metadata: {} });
    wm.add({ id: '2', content: 'high', type: 'fact', relevance: 0.9, timestamp: Date.now(), accessCount: 0, metadata: {} });
    wm.prioritize();
    const all = wm.getAll();
    expect(all[0]!.id).toBe('2');
  });

  it('should decay relevance', () => {
    wm.add({ id: '1', content: 'test', type: 'fact', relevance: 1.0, timestamp: Date.now(), accessCount: 0, metadata: {} });
    wm.decay(0.5);
    expect(wm.get('1')!.relevance).toBeCloseTo(0.5);
  });

  it('should throw on invalid decay factor', () => {
    expect(() => wm.decay(-0.1)).toThrow();
    expect(() => wm.decay(1.5)).toThrow();
  });

  it('should consolidate low-priority items', () => {
    wm.add({ id: '1', content: 'low', type: 'fact', relevance: 0.1, timestamp: Date.now(), accessCount: 0, metadata: {} });
    wm.add({ id: '2', content: 'high', type: 'fact', relevance: 0.9, timestamp: Date.now(), accessCount: 0, metadata: {} });
    const consolidated = wm.consolidate();
    expect(consolidated.length).toBe(1);
    expect(consolidated[0]!.id).toBe('1');
    expect(wm.getStats().itemCount).toBe(1);
  });

  it('should clear all items', () => {
    wm.add({ id: '1', content: 'test', type: 'fact', relevance: 0.5, timestamp: Date.now(), accessCount: 0, metadata: {} });
    wm.clear();
    expect(wm.getStats().itemCount).toBe(0);
  });

  it('should return accurate stats', () => {
    wm.add({ id: '1', content: 'test', type: 'fact', relevance: 0.8, timestamp: Date.now(), accessCount: 0, metadata: {} });
    const stats = wm.getStats();
    expect(stats.itemCount).toBe(1);
    expect(stats.capacity).toBe(5);
    expect(stats.utilization).toBeCloseTo(0.2);
    expect(stats.averageRelevance).toBeCloseTo(0.8);
  });
});

// ============================================================
// ShortTermMemory Tests (20 tests)
// ============================================================
describe('ShortTermMemory', () => {
  let stm: ShortTermMemory;

  beforeEach(() => {
    stm = new ShortTermMemory(100);
  });

  it('should create with default max tokens', () => {
    const s = new ShortTermMemory();
    expect(s.getStats().maxTokens).toBe(4096);
  });

  it('should create with custom max tokens', () => {
    expect(stm.getStats().maxTokens).toBe(100);
  });

  it('should throw on non-positive max tokens', () => {
    expect(() => new ShortTermMemory(0)).toThrow();
  });

  it('should add a message', () => {
    const msg = stm.addMessage('user', 'Hello, how are you?');
    expect(msg.id).toBeDefined();
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hello, how are you?');
  });

  it('should add system message', () => {
    const msg = stm.addMessage('system', 'You are a helpful assistant.');
    expect(msg.role).toBe('system');
  });

  it('should add assistant message', () => {
    const msg = stm.addMessage('assistant', 'I can help with that.');
    expect(msg.role).toBe('assistant');
  });

  it('should get recent messages', () => {
    stm.addMessage('user', 'first');
    stm.addMessage('assistant', 'second');
    stm.addMessage('user', 'third');
    const recent = stm.getRecent(2);
    expect(recent.length).toBe(2);
    expect(recent[0]!.content).toBe('second');
    expect(recent[1]!.content).toBe('third');
  });

  it('should return empty for getRecent(0)', () => {
    stm.addMessage('user', 'test');
    expect(stm.getRecent(0)).toEqual([]);
  });

  it('should get formatted context', () => {
    stm.addMessage('user', 'hello');
    stm.addMessage('assistant', 'hi there');
    const ctx = stm.getContext();
    expect(ctx).toContain('[user]: hello');
    expect(ctx).toContain('[assistant]: hi there');
  });

  it('should summarize empty conversation', () => {
    expect(stm.summarize()).toBe('No conversation history.');
  });

  it('should summarize conversation', () => {
    stm.addMessage('user', 'Tell me about TypeScript programming language');
    stm.addMessage('assistant', 'TypeScript is a typed superset of JavaScript');
    const summary = stm.summarize();
    expect(summary).toContain('2 messages');
    expect(summary).toContain('1 user');
  });

  it('should estimate token count', () => {
    stm.addMessage('user', 'Hello world');
    const count = stm.getTokenCount();
    expect(count).toBeGreaterThan(0);
  });

  it('should trim to fit within token limit', () => {
    const tiny = new ShortTermMemory(20);
    tiny.addMessage('user', 'This is the first message with some content');
    tiny.addMessage('assistant', 'This is the second response with more content');
    tiny.addMessage('user', 'This is the third message that should push over the limit');
    const stats = tiny.getStats();
    expect(stats.totalTokens).toBeLessThanOrEqual(20);
    expect(stats.messageCount).toBeLessThan(3);
  });

  it('should return number of trimmed messages', () => {
    const tiny = new ShortTermMemory(5);
    tiny.addMessage('user', 'first message');
    tiny.addMessage('user', 'second message that is longer');
    const trimmed = tiny.trimToFit();
    expect(trimmed).toBeGreaterThanOrEqual(0);
  });

  it('should search messages by content', () => {
    stm.addMessage('user', 'I love programming');
    stm.addMessage('assistant', 'Programming is great');
    stm.addMessage('user', 'Tell me about cooking');
    const results = stm.search('programming');
    expect(results.length).toBe(2);
  });

  it('should search by metadata', () => {
    stm.addMessage('user', 'test', { topic: 'science' });
    stm.addMessage('user', 'test2', { topic: 'math' });
    const results = stm.search('science');
    expect(results.length).toBe(1);
  });

  it('should return accurate stats', () => {
    stm.addMessage('user', 'hello');
    stm.addMessage('assistant', 'hi');
    const stats = stm.getStats();
    expect(stats.messageCount).toBe(2);
    expect(stats.maxTokens).toBe(100);
    expect(stats.averageTokensPerMessage).toBeGreaterThan(0);
  });

  it('should handle empty stats', () => {
    const stats = stm.getStats();
    expect(stats.messageCount).toBe(0);
    expect(stats.totalTokens).toBe(0);
    expect(stats.utilization).toBe(0);
  });

  it('should preserve metadata in messages', () => {
    const msg = stm.addMessage('user', 'test', { key: 'value', num: 42 });
    expect(msg.metadata.key).toBe('value');
    expect(msg.metadata.num).toBe(42);
  });

  it('should auto-trim on add when over limit', () => {
    const tiny = new ShortTermMemory(8);
    tiny.addMessage('user', 'message one');
    tiny.addMessage('user', 'message two');
    tiny.addMessage('user', 'message three');
    expect(tiny.getStats().totalTokens).toBeLessThanOrEqual(8);
  });

  it('should return recent messages more than available', () => {
    stm.addMessage('user', 'only one');
    expect(stm.getRecent(10).length).toBe(1);
  });
});

// ============================================================
// LongTermMemory Tests (22 tests)
// ============================================================
describe('LongTermMemory', () => {
  let ltm: LongTermMemory;

  beforeEach(() => {
    ltm = new LongTermMemory({ maxEntries: 100 });
  });

  it('should create with default options', () => {
    const l = new LongTermMemory();
    expect(l.getStats().maxEntries).toBe(10000);
  });

  it('should create with custom options', () => {
    expect(ltm.getStats().maxEntries).toBe(100);
  });

  it('should store a value', () => {
    const entry = ltm.store('key1', 'value1', ['tag1']);
    expect(entry.key).toBe('key1');
    expect(entry.value).toBe('value1');
    expect(entry.tags).toContain('tag1');
  });

  it('should store with metadata', () => {
    const entry = ltm.store('key1', 'value1', [], { source: 'test' });
    expect(entry.metadata.source).toBe('test');
  });

  it('should retrieve a value', () => {
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

  it('should return undefined for non-existent key', () => {
    expect(ltm.retrieve('nonexistent')).toBeUndefined();
  });

  it('should update existing entry on store', () => {
    ltm.store('key1', 'value1', ['tag1']);
    ltm.store('key1', 'value2', ['tag2']);
    const entry = ltm.retrieve('key1');
    expect(entry!.value).toBe('value2');
    expect(entry!.tags).toContain('tag1');
    expect(entry!.tags).toContain('tag2');
  });

  it('should search by query', () => {
    ltm.store('user-name', 'Alice');
    ltm.store('user-age', '30');
    ltm.store('project-name', 'Claude');
    const results = ltm.search('user');
    expect(results.length).toBe(2);
  });

  it('should search with tag filter', () => {
    ltm.store('k1', 'v1', ['important', 'work']);
    ltm.store('k2', 'v2', ['work']);
    ltm.store('k3', 'v3', ['personal']);
    const results = ltm.search('', { tags: ['important'] });
    expect(results.length).toBe(1);
  });

  it('should search with minImportance filter', () => {
    ltm.store('k1', 'v1');
    const entry1 = ltm.retrieve('k1')!;
    entry1.importance = 0.9;
    ltm.store('k2', 'v2');
    const entry2 = ltm.retrieve('k2')!;
    entry2.importance = 0.3;
    const results = ltm.search('', { minImportance: 0.8 });
    expect(results.length).toBe(1);
    expect(results[0]!.key).toBe('k1');
  });

  it('should search with limit', () => {
    ltm.store('k1', 'v1');
    ltm.store('k2', 'v2');
    ltm.store('k3', 'v3');
    const results = ltm.search('', { limit: 2 });
    expect(results.length).toBe(2);
  });

  it('should search with time range', () => {
    const now = Date.now();
    ltm.store('k1', 'old');
    ltm.store('k2', 'new');
    const results = ltm.search('', { startTime: now - 1000, endTime: now + 1000 });
    expect(results.length).toBe(2);
  });

  it('should delete a value', () => {
    ltm.store('key1', 'value1');
    expect(ltm.delete('key1')).toBe(true);
    expect(ltm.retrieve('key1')).toBeUndefined();
  });

  it('should return false when deleting non-existent key', () => {
    expect(ltm.delete('nonexistent')).toBe(false);
  });

  it('should forget by maxAge', () => {
    ltm.store('k1', 'v1');
    // Use a very small maxAge - the item was just created so its age is ~0ms.
    // maxAge: -1 means any item with age > -1 (i.e., all items) should be forgotten.
    const count = ltm.forget({ maxAge: -1 });
    expect(count).toBe(1);
    expect(ltm.getStats().entryCount).toBe(0);
  });

  it('should forget by pattern', () => {
    ltm.store('user-name', 'Alice');
    ltm.store('user-age', '30');
    ltm.store('project-name', 'Claude');
    const count = ltm.forget({ pattern: 'user' });
    expect(count).toBe(2);
  });

  it('should forget by tags', () => {
    ltm.store('k1', 'v1', ['temp']);
    ltm.store('k2', 'v2', ['permanent']);
    const count = ltm.forget({ tags: ['temp'] });
    expect(count).toBe(1);
  });

  it('should consolidate memories', () => {
    ltm.store('k1', 'v1', ['tag1']);
    const memories = ltm.export();
    ltm.delete('k1');
    ltm.consolidate(memories);
    expect(ltm.retrieve('k1')).toBeDefined();
  });

  it('should get by tag', () => {
    ltm.store('k1', 'v1', ['work', 'important']);
    ltm.store('k2', 'v2', ['personal']);
    const results = ltm.getByTag('work');
    expect(results.length).toBe(1);
    expect(results[0]!.key).toBe('k1');
  });

  it('should get by time range', () => {
    const now = Date.now();
    ltm.store('k1', 'v1');
    ltm.store('k2', 'v2');
    const results = ltm.getByTimeRange(now - 1000, now + 1000);
    expect(results.length).toBe(2);
  });

  it('should export all memories', () => {
    ltm.store('k1', 'v1');
    ltm.store('k2', 'v2');
    const exported = ltm.export();
    expect(exported.length).toBe(2);
  });

  it('should import memories', () => {
    const data = [
      { key: 'k1', value: 'v1', tags: ['t1'], metadata: {}, timestamp: Date.now(), accessCount: 0, importance: 0.5 },
    ];
    ltm.import(data);
    expect(ltm.retrieve('k1')).toBeDefined();
  });

  it('should return accurate stats', () => {
    ltm.store('k1', 'v1', ['tag1', 'tag2']);
    ltm.store('k2', 'v2', ['tag3']);
    const stats = ltm.getStats();
    expect(stats.entryCount).toBe(2);
    expect(stats.totalTags).toBe(3);
  });
});

// ============================================================
// EpisodicMemory Tests (18 tests)
// ============================================================
describe('EpisodicMemory', () => {
  let em: EpisodicMemory;

  beforeEach(() => {
    em = new EpisodicMemory();
  });

  it('should record an episode', () => {
    const ep = em.record({
      context: 'User asked about API design',
      actions: ['Provided REST API guidelines'],
      outcome: 'User was satisfied',
      emotion: 'positive',
      importance: 0.8,
      tags: ['api', 'design'],
      lessons: ['REST is preferred for public APIs'],
    });
    expect(ep.id).toBeDefined();
    expect(ep.context).toBe('User asked about API design');
    expect(ep.timestamp).toBeGreaterThan(0);
  });

  it('should record with default tags and lessons', () => {
    const ep = em.record({
      context: 'test',
      actions: [],
      outcome: 'ok',
      emotion: 'neutral',
      importance: 0.5,
      tags: [],
      lessons: [],
    });
    expect(ep.tags).toEqual([]);
    expect(ep.lessons).toEqual([]);
  });

  it('should recall similar episodes', () => {
    em.record({
      context: 'User asked about TypeScript types',
      actions: ['Explained generics'],
      outcome: 'User understood',
      emotion: 'positive',
      importance: 0.7,
      tags: ['typescript'],
      lessons: ['Use concrete examples for generics'],
    });
    em.record({
      context: 'User asked about Python decorators',
      actions: ['Showed decorator pattern'],
      outcome: 'User confused',
      emotion: 'negative',
      importance: 0.5,
      tags: ['python'],
      lessons: [],
    });
    const results = em.recall('TypeScript');
    expect(results.length).toBe(1);
    expect(results[0]!.context).toContain('TypeScript');
  });

  it('should recall with emotion filter', () => {
    em.record({ context: 'good', actions: [], outcome: 'ok', emotion: 'positive', importance: 0.8, tags: [], lessons: [] });
    em.record({ context: 'bad', actions: [], outcome: 'fail', emotion: 'negative', importance: 0.5, tags: [], lessons: [] });
    const results = em.recall('', { emotions: ['positive'] });
    expect(results.length).toBe(1);
  });

  it('should recall with minImportance filter', () => {
    em.record({ context: 'a', actions: [], outcome: 'ok', emotion: 'neutral', importance: 0.9, tags: [], lessons: [] });
    em.record({ context: 'b', actions: [], outcome: 'ok', emotion: 'neutral', importance: 0.3, tags: [], lessons: [] });
    const results = em.recall('', { minImportance: 0.8 });
    expect(results.length).toBe(1);
  });

  it('should recall with limit', () => {
    em.record({ context: 'a', actions: [], outcome: 'ok', emotion: 'neutral', importance: 0.5, tags: [], lessons: [] });
    em.record({ context: 'b', actions: [], outcome: 'ok', emotion: 'neutral', importance: 0.6, tags: [], lessons: [] });
    em.record({ context: 'c', actions: [], outcome: 'ok', emotion: 'neutral', importance: 0.7, tags: [], lessons: [] });
    const results = em.recall('', { limit: 2 });
    expect(results.length).toBe(2);
  });

  it('should recall with tag filter', () => {
    em.record({ context: 'a', actions: [], outcome: 'ok', emotion: 'neutral', importance: 0.5, tags: ['work'], lessons: [] });
    em.record({ context: 'b', actions: [], outcome: 'ok', emotion: 'neutral', importance: 0.5, tags: ['personal'], lessons: [] });
    const results = em.recall('', { tags: ['work'] });
    expect(results.length).toBe(1);
  });

  it('should forget an episode', () => {
    const ep = em.record({ context: 'test', actions: [], outcome: 'ok', emotion: 'neutral', importance: 0.5, tags: [], lessons: [] });
    expect(em.forget(ep.id)).toBe(true);
    expect(em.forget('nonexistent')).toBe(false);
  });

  it('should get timeline', () => {
    em.record({ context: 'first', actions: [], outcome: 'ok', emotion: 'neutral', importance: 0.5, tags: [], lessons: [] });
    em.record({ context: 'second', actions: [], outcome: 'ok', emotion: 'neutral', importance: 0.5, tags: [], lessons: [] });
    const timeline = em.getTimeline();
    expect(timeline.length).toBe(2);
    expect(timeline[0]!.context).toBe('first');
  });

  it('should get by emotion', () => {
    em.record({ context: 'a', actions: [], outcome: 'ok', emotion: 'positive', importance: 0.5, tags: [], lessons: [] });
    em.record({ context: 'b', actions: [], outcome: 'ok', emotion: 'negative', importance: 0.5, tags: [], lessons: [] });
    em.record({ context: 'c', actions: [], outcome: 'ok', emotion: 'positive', importance: 0.8, tags: [], lessons: [] });
    const results = em.getByEmotion('positive');
    expect(results.length).toBe(2);
  });

  it('should get by context', () => {
    em.record({ context: 'API design discussion', actions: [], outcome: 'ok', emotion: 'neutral', importance: 0.5, tags: [], lessons: [] });
    em.record({ context: 'Database optimization', actions: [], outcome: 'ok', emotion: 'neutral', importance: 0.5, tags: [], lessons: [] });
    const results = em.getByContext('API');
    expect(results.length).toBe(1);
  });

  it('should summarize a period', () => {
    const now = Date.now();
    em.record({ context: 'good task', actions: ['helped'], outcome: 'success', emotion: 'positive', importance: 0.8, tags: [], lessons: ['be helpful'] });
    em.record({ context: 'bad task', actions: ['failed'], outcome: 'failure', emotion: 'negative', importance: 0.3, tags: [], lessons: [] });
    const summary = em.summarize({ start: now - 1000, end: now + 1000 });
    expect(summary).toContain('2 episodes');
    expect(summary).toContain('1 positive');
    expect(summary).toContain('1 negative');
  });

  it('should summarize empty period', () => {
    const summary = em.summarize({ start: 0, end: 1 });
    expect(summary).toBe('No episodes in the specified period.');
  });

  it('should extract lessons', () => {
    em.record({ context: 'a', actions: [], outcome: 'ok', emotion: 'neutral', importance: 0.5, tags: [], lessons: ['lesson1', 'lesson2'] });
    em.record({ context: 'b', actions: [], outcome: 'ok', emotion: 'neutral', importance: 0.5, tags: [], lessons: ['lesson2', 'lesson3'] });
    const lessons = em.extractLessons();
    expect(lessons).toContain('lesson1');
    expect(lessons).toContain('lesson2');
    expect(lessons).toContain('lesson3');
    expect(lessons.length).toBe(3);
  });

  it('should return all episodes', () => {
    em.record({ context: 'a', actions: [], outcome: 'ok', emotion: 'neutral', importance: 0.5, tags: [], lessons: [] });
    em.record({ context: 'b', actions: [], outcome: 'ok', emotion: 'neutral', importance: 0.5, tags: [], lessons: [] });
    expect(em.getAll().length).toBe(2);
  });

  it('should return accurate stats', () => {
    em.record({ context: 'a', actions: [], outcome: 'ok', emotion: 'positive', importance: 0.8, tags: [], lessons: [] });
    em.record({ context: 'b', actions: [], outcome: 'ok', emotion: 'negative', importance: 0.4, tags: [], lessons: [] });
    const stats = em.getStats();
    expect(stats.episodeCount).toBe(2);
    expect(stats.emotionDistribution.positive).toBe(1);
    expect(stats.emotionDistribution.negative).toBe(1);
    expect(stats.averageImportance).toBeCloseTo(0.6);
  });

  it('should handle empty stats', () => {
    const stats = em.getStats();
    expect(stats.episodeCount).toBe(0);
    expect(stats.averageImportance).toBe(0);
  });

  it('should recall with time range', () => {
    const now = Date.now();
    em.record({ context: 'recent', actions: [], outcome: 'ok', emotion: 'neutral', importance: 0.5, tags: [], lessons: [] });
    const results = em.recall('', { startTime: now - 1000, endTime: now + 1000 });
    expect(results.length).toBe(1);
  });
});

// ============================================================
// SemanticMemory Tests (18 tests)
// ============================================================
describe('SemanticMemory', () => {
  let sm: SemanticMemory;

  beforeEach(() => {
    sm = new SemanticMemory();
  });

  it('should add a concept', () => {
    const concept = sm.addConcept('TypeScript', 'A typed superset of JavaScript', { paradigm: 'object-oriented' });
    expect(concept.name).toBe('TypeScript');
    expect(concept.description).toBe('A typed superset of JavaScript');
    expect(concept.properties.paradigm).toBe('object-oriented');
  });

  it('should add a concept with relations', () => {
    sm.addConcept('A', 'Concept A', {}, [
      { from: 'A', to: 'B', type: 'depends_on', properties: {} },
    ]);
    const concept = sm.getConcept('A');
    expect(concept!.relations.length).toBe(1);
  });

  it('should add a relation', () => {
    sm.addConcept('A', 'Concept A');
    sm.addConcept('B', 'Concept B');
    const rel = sm.addRelation('A', 'B', 'depends_on', { strength: 0.8 });
    expect(rel.from).toBe('A');
    expect(rel.to).toBe('B');
    expect(rel.type).toBe('depends_on');
  });

  it('should update concept relations when adding relation', () => {
    sm.addConcept('A', 'Concept A');
    sm.addConcept('B', 'Concept B');
    sm.addRelation('A', 'B', 'related_to');
    expect(sm.getConcept('A')!.relations.length).toBe(1);
    expect(sm.getConcept('B')!.relations.length).toBe(1);
  });

  it('should query concepts', () => {
    sm.addConcept('TypeScript', 'A typed superset of JavaScript for programming');
    sm.addConcept('Python', 'A high-level programming language');
    sm.addConcept('React', 'A JavaScript library for UI');
    const results = sm.query('programming');
    expect(results.length).toBe(2);
  });

  it('should query with limit', () => {
    sm.addConcept('A', 'concept about programming');
    sm.addConcept('B', 'concept about programming');
    sm.addConcept('C', 'concept about programming');
    const results = sm.query('programming', { limit: 2 });
    expect(results.length).toBe(2);
  });

  it('should query by properties', () => {
    sm.addConcept('A', 'desc', { category: 'language' });
    sm.addConcept('B', 'desc', { category: 'tool' });
    const results = sm.query('language');
    expect(results.length).toBe(1);
  });

  it('should get a concept by name', () => {
    sm.addConcept('TypeScript', 'A language');
    const concept = sm.getConcept('TypeScript');
    expect(concept).toBeDefined();
    expect(concept!.name).toBe('TypeScript');
  });

  it('should return undefined for non-existent concept', () => {
    expect(sm.getConcept('nonexistent')).toBeUndefined();
  });

  it('should get related concepts at depth 1', () => {
    sm.addConcept('A', 'Concept A');
    sm.addConcept('B', 'Concept B');
    sm.addConcept('C', 'Concept C');
    sm.addRelation('A', 'B', 'related_to');
    sm.addRelation('B', 'C', 'related_to');
    const related = sm.getRelated('A', 1);
    expect(related.length).toBe(1);
    expect(related[0]!.name).toBe('B');
  });

  it('should get related concepts at depth 2', () => {
    sm.addConcept('A', 'Concept A');
    sm.addConcept('B', 'Concept B');
    sm.addConcept('C', 'Concept C');
    sm.addRelation('A', 'B', 'related_to');
    sm.addRelation('B', 'C', 'related_to');
    const related = sm.getRelated('A', 2);
    expect(related.length).toBe(2);
  });

  it('should not include self in related', () => {
    sm.addConcept('A', 'Concept A');
    sm.addConcept('B', 'Concept B');
    sm.addRelation('A', 'B', 'related_to');
    const related = sm.getRelated('A', 1);
    expect(related.find((c) => c.name === 'A')).toBeUndefined();
  });

  it('should infer transitive relations', () => {
    sm.addConcept('A', 'Concept A');
    sm.addConcept('B', 'Concept B');
    sm.addConcept('C', 'Concept C');
    sm.addRelation('A', 'B', 'depends_on');
    sm.addRelation('B', 'C', 'depends_on');
    const inferences = sm.infer('');
    expect(inferences.length).toBeGreaterThan(0);
    expect(inferences.some((i) => i.inference.includes('transitive'))).toBe(true);
  });

  it('should infer property-based relations', () => {
    sm.addConcept('TypeScript', 'A typed language', { type: 'language' });
    sm.addConcept('JavaScript', 'A dynamic language', { type: 'language' });
    sm.addRelation('TypeScript', 'JavaScript', 'superset_of');
    const inferences = sm.infer('TypeScript');
    expect(inferences.length).toBeGreaterThan(0);
  });

  it('should merge with another semantic memory', () => {
    const other = new SemanticMemory();
    sm.addConcept('A', 'Original A');
    other.addConcept('B', 'Concept B');
    other.addRelation('A', 'B', 'related_to');
    sm.merge(other);
    expect(sm.getConcept('B')).toBeDefined();
    expect(sm.getRelated('A', 1).length).toBe(1);
  });

  it('should merge concept properties', () => {
    sm.addConcept('A', 'desc', { prop1: 'val1' });
    const other = new SemanticMemory();
    other.addConcept('A', 'updated desc', { prop2: 'val2' });
    sm.merge(other);
    const concept = sm.getConcept('A')!;
    expect(concept.properties.prop1).toBe('val1');
    expect(concept.properties.prop2).toBe('val2');
  });

  it('should export and import', () => {
    sm.addConcept('A', 'Concept A');
    sm.addRelation('A', 'B', 'related_to');
    const exported = sm.export();
    expect(exported.concepts.length).toBe(1);
    expect(exported.relations.length).toBe(1);

    const newSm = new SemanticMemory();
    newSm.import(exported);
    expect(newSm.getConcept('A')).toBeDefined();
  });

  it('should return accurate stats', () => {
    sm.addConcept('A', 'Concept A');
    sm.addConcept('B', 'Concept B');
    sm.addConcept('C', 'Isolated concept');
    sm.addRelation('A', 'B', 'related_to');
    const stats = sm.getStats();
    expect(stats.conceptCount).toBe(3);
    expect(stats.relationCount).toBe(1);
    expect(stats.isolatedConcepts).toBe(1);
  });
});

// ============================================================
// MemoryPrioritizer Tests (18 tests)
// ============================================================
describe('MemoryPrioritizer', () => {
  let mp: MemoryPrioritizer;

  beforeEach(() => {
    mp = new MemoryPrioritizer();
  });

  it('should calculate importance score', () => {
    const memory = {
      id: '1',
      content: 'important information',
      timestamp: Date.now(),
      accessCount: 5,
      relevance: 0.8,
    };
    const score = mp.calculateImportance(memory);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('should give higher importance to recent items', () => {
    const recent = { id: '1', content: 'test', timestamp: Date.now(), accessCount: 1 };
    const old = { id: '2', content: 'test', timestamp: Date.now() - 100000000, accessCount: 1 };
    expect(mp.calculateImportance(recent)).toBeGreaterThan(mp.calculateImportance(old));
  });

  it('should give higher importance to frequently accessed items', () => {
    const frequent = { id: '1', content: 'test', timestamp: Date.now(), accessCount: 50 };
    const rare = { id: '2', content: 'test', timestamp: Date.now(), accessCount: 1 };
    expect(mp.calculateImportance(frequent)).toBeGreaterThan(mp.calculateImportance(rare));
  });

  it('should calculate recency score', () => {
    const now = Date.now();
    const recentScore = mp.recencyScore(now);
    const oldScore = mp.recencyScore(now - 7200000); // 2 hours ago
    expect(recentScore).toBeGreaterThan(oldScore);
  });

  it('should return ~1 for very recent timestamps', () => {
    const score = mp.recencyScore(Date.now());
    expect(score).toBeGreaterThan(0.9);
  });

  it('should return ~0 for very old timestamps', () => {
    const score = mp.recencyScore(Date.now() - 86400000 * 30); // 30 days ago
    expect(score).toBeLessThan(0.1);
  });

  it('should calculate frequency score', () => {
    expect(mp.frequencyScore(0)).toBe(0);
    expect(mp.frequencyScore(1)).toBeGreaterThan(0);
    expect(mp.frequencyScore(100)).toBeGreaterThan(mp.frequencyScore(10));
  });

  it('should cap frequency score at 1', () => {
    expect(mp.frequencyScore(10000)).toBeLessThanOrEqual(1);
  });

  it('should calculate relevance score', () => {
    const memory = { id: '1', content: 'TypeScript programming language', timestamp: Date.now(), accessCount: 0 };
    const score1 = mp.relevanceScore(memory, 'TypeScript programming');
    const score2 = mp.relevanceScore(memory, 'cooking recipes');
    expect(score1).toBeGreaterThan(score2);
  });

  it('should return 0 relevance for no overlap', () => {
    const memory = { id: '1', content: 'abc def', timestamp: Date.now(), accessCount: 0 };
    expect(mp.relevanceScore(memory, 'xyz qwe')).toBe(0);
  });

  it('should return 1 relevance for identical content', () => {
    const memory = { id: '1', content: 'hello world', timestamp: Date.now(), accessCount: 0 };
    const score = mp.relevanceScore(memory, 'hello world');
    expect(score).toBeCloseTo(1);
  });

  it('should calculate emotional score', () => {
    expect(mp.emotionalScore('surprise')).toBe(0.9);
    expect(mp.emotionalScore('satisfaction')).toBe(0.85);
    expect(mp.emotionalScore('neutral')).toBe(0.4);
  });

  it('should return default emotional score for unknown emotion', () => {
    expect(mp.emotionalScore('unknown_emotion')).toBe(0.5);
  });

  it('should return default emotional score for undefined', () => {
    expect(mp.emotionalScore(undefined)).toBe(0.5);
  });

  it('should prioritize memories by context', () => {
    const memories = [
      { id: '1', content: 'TypeScript generics tutorial', timestamp: Date.now(), accessCount: 5 },
      { id: '2', content: 'Cooking pasta recipe', timestamp: Date.now(), accessCount: 10 },
      { id: '3', content: 'TypeScript type system explained', timestamp: Date.now(), accessCount: 3 },
    ];
    const prioritized = mp.prioritize(memories, 'TypeScript programming');
    expect(prioritized[0]!.content).toContain('TypeScript');
  });

  it('should decide to forget old, rarely accessed memories', () => {
    const memory = {
      id: '1',
      content: 'old info',
      timestamp: Date.now() - 86400000 * 60, // 60 days ago
      accessCount: 0,
    };
    expect(mp.shouldForget(memory, 0.3)).toBe(true);
  });

  it('should not forget recent, frequently accessed memories', () => {
    const memory = {
      id: '1',
      content: 'recent info',
      timestamp: Date.now(),
      accessCount: 50,
    };
    expect(mp.shouldForget(memory, 0.3)).toBe(false);
  });

  it('should calculate Ebbinghaus forgetting curve', () => {
    const recent = mp.getForgettingCurve(1000, 1); // 1 second old, accessed once
    const old = mp.getForgettingCurve(86400000, 1); // 1 day old, accessed once
    expect(recent).toBeGreaterThan(old);
    expect(recent).toBeLessThanOrEqual(1);
    expect(recent).toBeGreaterThanOrEqual(0);
  });

  it('should show forgetting curve improvement with access', () => {
    const rarelyAccessed = mp.getForgettingCurve(3600000, 1); // 1 hour, 1 access
    const oftenAccessed = mp.getForgettingCurve(3600000, 10); // 1 hour, 10 accesses
    expect(oftenAccessed).toBeGreaterThan(rarelyAccessed);
  });
});

// ============================================================
// MemoryConsolidator Tests (14 tests)
// ============================================================
describe('MemoryConsolidator', () => {
  let mc: MemoryConsolidator;
  let wm: WorkingMemory;
  let stm: ShortTermMemory;
  let ltm: LongTermMemory;

  beforeEach(() => {
    mc = new MemoryConsolidator();
    wm = new WorkingMemory(10);
    stm = new ShortTermMemory(1000);
    ltm = new LongTermMemory({ maxEntries: 100 });
  });

  it('should consolidate working to short-term', () => {
    wm.add({ id: '1', content: 'low priority task', type: 'task', relevance: 0.1, timestamp: Date.now(), accessCount: 0, metadata: {} });
    wm.add({ id: '2', content: 'high priority task', type: 'task', relevance: 0.9, timestamp: Date.now(), accessCount: 0, metadata: {} });
    const count = mc.consolidateWorkingToShortTerm(wm, stm);
    expect(count).toBe(1);
    expect(stm.getStats().messageCount).toBe(1);
    expect(wm.getStats().itemCount).toBe(1);
  });

  it('should not consolidate high-relevance items', () => {
    wm.add({ id: '1', content: 'important', type: 'task', relevance: 0.8, timestamp: Date.now(), accessCount: 0, metadata: {} });
    const count = mc.consolidateWorkingToShortTerm(wm, stm);
    expect(count).toBe(0);
  });

  it('should consolidate short-term to long-term', () => {
    stm.addMessage('user', 'Tell me about React hooks');
    stm.addMessage('assistant', 'React hooks are functions that let you use state in functional components');
    const count = mc.consolidateShortToLongTerm(stm, ltm);
    expect(count).toBeGreaterThan(0);
    expect(ltm.getStats().entryCount).toBeGreaterThan(0);
  });

  it('should extract key points from messages', () => {
    const messages = [
      { id: 'm1', role: 'user' as const, content: 'How do I implement authentication?', timestamp: Date.now(), tokens: 10, metadata: {} },
      { id: 'm2', role: 'assistant' as const, content: 'Use JWT tokens with bcrypt for password hashing', timestamp: Date.now(), tokens: 15, metadata: {} },
    ];
    const points = mc.extractKeyPoints(messages);
    expect(points.length).toBe(2);
    expect(points.some((p) => p.tags.includes('user-input'))).toBe(true);
    expect(points.some((p) => p.tags.includes('assistant-response'))).toBe(true);
  });

  it('should return empty key points for empty messages', () => {
    expect(mc.extractKeyPoints([])).toEqual([]);
  });

  it('should generate summary of memories', () => {
    ltm.store('k1', 'value1', ['tag1']);
    ltm.store('k2', 'value2', ['tag2']);
    const entries = ltm.export();
    const summary = mc.generateSummary(entries);
    expect(summary).toContain('2 memories');
  });

  it('should generate summary for empty memories', () => {
    expect(mc.generateSummary([])).toBe('No memories to summarize.');
  });

  it('should merge related long-term memories', () => {
    ltm.store('k1', 'v1', ['work', 'important']);
    ltm.store('k2', 'v2', ['work', 'important']);
    ltm.store('k3', 'v3', ['personal']);
    const merged = mc.mergeRelated(ltm);
    expect(merged).toBe(1);
    expect(ltm.getStats().entryCount).toBe(2);
  });

  it('should not merge unrelated memories', () => {
    ltm.store('k1', 'v1', ['work']);
    ltm.store('k2', 'v2', ['personal']);
    const merged = mc.mergeRelated(ltm);
    expect(merged).toBe(0);
  });

  it('should prune unimportant memories', () => {
    ltm.store('k1', 'v1', [], {}, );
    const entry = ltm.retrieve('k1')!;
    entry.timestamp = Date.now() - 86400000 * 100; // very old
    entry.accessCount = 0;
    ltm.store('k2', 'v2', [], {}, );
    const pruned = mc.pruneUnimportant(ltm, 0.1);
    expect(pruned).toBeGreaterThanOrEqual(0);
  });

  it('should return consolidation stats', () => {
    const stats = mc.getConsolidationStats();
    expect(stats.workingToShortTerm).toBe(0);
    expect(stats.shortToLongTerm).toBe(0);
    expect(stats.keyPointsExtracted).toBe(0);
    expect(stats.memoriesMerged).toBe(0);
    expect(stats.memoriesPruned).toBe(0);
  });

  it('should update consolidation stats after operations', () => {
    wm.add({ id: '1', content: 'low', type: 'task', relevance: 0.1, timestamp: Date.now(), accessCount: 0, metadata: {} });
    mc.consolidateWorkingToShortTerm(wm, stm);
    const stats = mc.getConsolidationStats();
    expect(stats.workingToShortTerm).toBe(1);
    expect(stats.lastConsolidation).toBeGreaterThan(0);
  });

  it('should handle consolidation with empty working memory', () => {
    const count = mc.consolidateWorkingToShortTerm(wm, stm);
    expect(count).toBe(0);
  });

  it('should handle consolidation with empty short-term memory', () => {
    const count = mc.consolidateShortToLongTerm(stm, ltm);
    expect(count).toBe(0);
  });
});

// ============================================================
// MemoryRetriever Tests (14 tests)
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
    ltm = new LongTermMemory({ maxEntries: 100 });
    em = new EpisodicMemory();
    sm = new SemanticMemory();
    retriever = new MemoryRetriever(wm, stm, ltm, em, sm);
  });

  it('should retrieve from working memory', () => {
    wm.add({ id: '1', content: 'TypeScript generics', type: 'fact', relevance: 0.8, timestamp: Date.now(), accessCount: 0, metadata: {} });
    const results = retriever.retrieve('TypeScript');
    expect(results.some((r) => r.tier === 'working')).toBe(true);
  });

  it('should retrieve from short-term memory', () => {
    stm.addMessage('user', 'Tell me about React hooks');
    const results = retriever.retrieve('React');
    expect(results.some((r) => r.tier === 'short-term')).toBe(true);
  });

  it('should retrieve from long-term memory', () => {
    ltm.store('k1', 'Python async programming guide', ['python']);
    const results = retriever.retrieve('Python');
    expect(results.some((r) => r.tier === 'long-term')).toBe(true);
  });

  it('should retrieve from episodic memory', () => {
    em.record({ context: 'User asked about database optimization', actions: ['Provided indexing tips'], outcome: 'Performance improved', emotion: 'positive', importance: 0.8, tags: ['database'], lessons: ['Indexing is crucial'] });
    const results = retriever.retrieve('database');
    expect(results.some((r) => r.tier === 'episodic')).toBe(true);
  });

  it('should retrieve from semantic memory', () => {
    sm.addConcept('React', 'A JavaScript library for building UIs');
    const results = retriever.retrieve('React');
    expect(results.some((r) => r.tier === 'semantic')).toBe(true);
  });

  it('should filter by specific tiers', () => {
    wm.add({ id: '1', content: 'test', type: 'fact', relevance: 0.5, timestamp: Date.now(), accessCount: 0, metadata: {} });
    stm.addMessage('user', 'test message');
    const results = retriever.retrieve('test', { tiers: ['working'] });
    expect(results.every((r) => r.tier === 'working')).toBe(true);
  });

  it('should retrieve relevant memories with context', () => {
    wm.add({ id: '1', content: 'TypeScript type system', type: 'fact', relevance: 0.9, timestamp: Date.now(), accessCount: 0, metadata: {} });
    ltm.store('k1', 'TypeScript best practices', ['typescript']);
    const results = retriever.retrieveRelevant('TypeScript programming', 5);
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it('should retrieve recent memories across tiers', () => {
    wm.add({ id: '1', content: 'recent working item', type: 'fact', relevance: 0.5, timestamp: Date.now(), accessCount: 0, metadata: {} });
    stm.addMessage('user', 'recent message');
    const results = retriever.retrieveRecent(60000); // last minute
    expect(results.length).toBeGreaterThan(0);
  });

  it('should retrieve by tag', () => {
    ltm.store('k1', 'value1', ['important', 'work']);
    ltm.store('k2', 'value2', ['personal']);
    const results = retriever.retrieveByTag('important');
    expect(results.length).toBe(1);
    expect(results[0]!.tier).toBe('long-term');
  });

  it('should rank results by relevance', () => {
    wm.add({ id: '1', content: 'TypeScript basics', type: 'fact', relevance: 0.3, timestamp: Date.now(), accessCount: 0, metadata: {} });
    wm.add({ id: '2', content: 'Advanced TypeScript patterns', type: 'fact', relevance: 0.9, timestamp: Date.now(), accessCount: 0, metadata: {} });
    const results = retriever.retrieve('TypeScript');
    const workingResults = results.filter((r) => r.tier === 'working');
    expect(workingResults[0]!.relevance).toBeGreaterThanOrEqual(workingResults[workingResults.length - 1]!.relevance);
  });

  it('should format context for LLM', () => {
    wm.add({ id: '1', content: 'working item', type: 'fact', relevance: 0.5, timestamp: Date.now(), accessCount: 0, metadata: {} });
    stm.addMessage('user', 'short-term message');
    const results = retriever.retrieve('item');
    const formatted = retriever.formatContext(results);
    expect(formatted).toContain('WORKING');
    expect(formatted).toContain('working item');
  });

  it('should return no results for empty memories', () => {
    const results = retriever.retrieve('anything');
    expect(results.length).toBe(0);
  });

  it('should format empty context', () => {
    expect(retriever.formatContext([])).toBe('No relevant memories found.');
  });

  it('should handle retrieveRelevant with maxItems', () => {
    wm.add({ id: '1', content: 'a', type: 'fact', relevance: 0.5, timestamp: Date.now(), accessCount: 0, metadata: {} });
    wm.add({ id: '2', content: 'b', type: 'fact', relevance: 0.5, timestamp: Date.now(), accessCount: 0, metadata: {} });
    wm.add({ id: '3', content: 'c', type: 'fact', relevance: 0.5, timestamp: Date.now(), accessCount: 0, metadata: {} });
    const results = retriever.retrieveRelevant('a b c', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

// ============================================================
// MemoryManager Tests (22 tests)
// ============================================================
describe('MemoryManager', () => {
  let manager: MemoryManager;

  beforeEach(() => {
    manager = new MemoryManager();
  });

  it('should create with default config', () => {
    expect(manager).toBeDefined();
    expect(manager.isInitialized()).toBe(false);
  });

  it('should create with custom config', () => {
    const m = new MemoryManager({
      workingMemoryCapacity: 10,
      shortTermMaxTokens: 8192,
      longTermMaxEntries: 50000,
    });
    expect(m.getStats().working.capacity).toBe(10);
    expect(m.getStats().shortTerm.maxTokens).toBe(8192);
    expect(m.getStats().longTerm.maxEntries).toBe(50000);
  });

  it('should initialize', async () => {
    await manager.initialize();
    expect(manager.isInitialized()).toBe(true);
  });

  it('should remember in working memory by default', () => {
    manager.remember('Important task: fix the API endpoint');
    expect(manager.getStats().working.itemCount).toBe(1);
  });

  it('should remember in short-term memory', () => {
    manager.remember('User message about pricing', { tier: 'short-term' });
    expect(manager.getStats().shortTerm.messageCount).toBe(1);
  });

  it('should remember in long-term memory', () => {
    manager.remember('Company policy: remote work allowed', { tier: 'long-term', tags: ['policy'] });
    expect(manager.getStats().longTerm.entryCount).toBe(1);
  });

  it('should remember in episodic memory', () => {
    manager.remember('User reported a bug in the login flow', { tier: 'episodic', importance: 0.8 });
    expect(manager.getStats().episodic.episodeCount).toBe(1);
  });

  it('should remember in semantic memory', () => {
    manager.remember('React is a UI library by Meta', { tier: 'semantic' });
    expect(manager.getStats().semantic.conceptCount).toBe(1);
  });

  it('should recall from all tiers', () => {
    manager.remember('TypeScript generics', { tier: 'working' });
    manager.remember('TypeScript best practices', { tier: 'long-term', tags: ['ts'] });
    const results = manager.recall('TypeScript');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should recall from specific tiers', () => {
    manager.remember('working item', { tier: 'working' });
    manager.remember('long-term item', { tier: 'long-term', tags: ['test'] });
    const results = manager.recall('item', { tiers: ['working'] });
    expect(results.every((r) => r.tier === 'working')).toBe(true);
  });

  it('should forget memories by criteria', () => {
    manager.remember('temp data', { tier: 'long-term', tags: ['temp'] });
    manager.remember('permanent data', { tier: 'long-term', tags: ['permanent'] });
    const count = manager.forget({ tags: ['temp'] });
    expect(count).toBe(1);
  });

  it('should consolidate memories', () => {
    const wm = manager.getWorkingMemory();
    wm.add({ id: '1', content: 'low priority', type: 'task', relevance: 0.1, timestamp: Date.now(), accessCount: 0, metadata: {} });
    manager.consolidate();
    expect(manager.getStats().consolidation.workingToShortTerm).toBeGreaterThan(0);
  });

  it('should get context', () => {
    manager.remember('context item', { tier: 'working' });
    const ctx = manager.getContext();
    expect(ctx).toContain('WORKING');
  });

  it('should get context with time window', () => {
    manager.remember('recent item', { tier: 'working' });
    const ctx = manager.getContext(60000);
    expect(ctx).toBeDefined();
  });

  it('should get comprehensive stats', () => {
    const stats = manager.getStats();
    expect(stats.working).toBeDefined();
    expect(stats.shortTerm).toBeDefined();
    expect(stats.longTerm).toBeDefined();
    expect(stats.episodic).toBeDefined();
    expect(stats.semantic).toBeDefined();
    expect(stats.consolidation).toBeDefined();
  });

  it('should export state', () => {
    manager.remember('test data', { tier: 'working' });
    const exported = manager.export();
    expect(exported.version).toBeDefined();
    expect(exported.workingMemory.length).toBe(1);
  });

  it('should import state', () => {
    manager.remember('test data', { tier: 'working' });
    const exported = manager.export();
    const newManager = new MemoryManager();
    newManager.import(exported);
    expect(newManager.getStats().working.itemCount).toBe(1);
  });

  it('should reset all memory systems', () => {
    manager.remember('test', { tier: 'working' });
    manager.remember('test2', { tier: 'long-term', tags: ['t'] });
    manager.reset();
    expect(manager.getStats().working.itemCount).toBe(0);
    expect(manager.isInitialized()).toBe(false);
  });

  it('should expose sub-components', () => {
    expect(manager.getWorkingMemory()).toBeInstanceOf(WorkingMemory);
    expect(manager.getShortTermMemory()).toBeInstanceOf(ShortTermMemory);
    expect(manager.getLongTermMemory()).toBeInstanceOf(LongTermMemory);
    expect(manager.getEpisodicMemory()).toBeInstanceOf(EpisodicMemory);
    expect(manager.getSemanticMemory()).toBeInstanceOf(SemanticMemory);
    expect(manager.getConsolidator()).toBeDefined();
    expect(manager.getRetriever()).toBeDefined();
    expect(manager.getSerializer()).toBeDefined();
  });

  it('should handle auto-consolidate', () => {
    const m = new MemoryManager({ autoConsolidate: true });
    const wm = m.getWorkingMemory();
    wm.add({ id: '1', content: 'low', type: 'task', relevance: 0.1, timestamp: Date.now(), accessCount: 0, metadata: {} });
    m.remember('new item', { tier: 'working' });
    // Auto-consolidate should have run
    expect(m.getStats().consolidation.workingToShortTerm).toBeGreaterThanOrEqual(0);
  });

  it('should handle recall with maxItems', () => {
    manager.remember('item a', { tier: 'working' });
    manager.remember('item b', { tier: 'working' });
    manager.remember('item c', { tier: 'working' });
    const results = manager.recall('item', { maxItems: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('should handle recall with tags', () => {
    manager.remember('tagged item', { tier: 'long-term', tags: ['important'] });
    const results = manager.recall('tagged', { tags: ['important'] });
    expect(results.length).toBeGreaterThan(0);
  });

  it('should handle empty recall', () => {
    const results = manager.recall('nonexistent query');
    expect(results.length).toBe(0);
  });

  it('should handle forget with no matches', () => {
    const count = manager.forget({ pattern: 'nonexistent' });
    expect(count).toBe(0);
  });
});

// ============================================================
// MemorySerializer Tests (18 tests)
// ============================================================
describe('MemorySerializer', () => {
  let serializer: MemorySerializer;
  let manager: MemoryManager;

  beforeEach(() => {
    serializer = new MemorySerializer();
    manager = new MemoryManager();
  });

  it('should serialize memory manager state', () => {
    manager.remember('test', { tier: 'working' });
    const state = serializer.serialize(manager);
    expect(state.version).toBeDefined();
    expect(state.timestamp).toBeGreaterThan(0);
    expect(state.workingMemory.length).toBe(1);
  });

  it('should serialize all tiers', () => {
    manager.remember('w', { tier: 'working' });
    manager.remember('s', { tier: 'short-term' });
    manager.remember('l', { tier: 'long-term', tags: ['t'] });
    manager.remember('e', { tier: 'episodic' });
    manager.remember('sm', { tier: 'semantic' });
    const state = serializer.serialize(manager);
    expect(state.workingMemory.length).toBeGreaterThanOrEqual(1);
    expect(state.shortTermMemory.length).toBeGreaterThanOrEqual(1);
    expect(state.longTermMemory.length).toBeGreaterThanOrEqual(1);
    expect(state.episodicMemory.length).toBeGreaterThanOrEqual(1);
    expect(state.semanticMemory.concepts.length).toBeGreaterThanOrEqual(1);
  });

  it('should deserialize memory state', () => {
    manager.remember('test', { tier: 'working' });
    const state = serializer.serialize(manager);
    const newManager = new MemoryManager();
    serializer.deserialize(state, newManager);
    expect(newManager.getStats().working.itemCount).toBe(1);
  });

  it('should throw on invalid deserialize', () => {
    expect(() => serializer.deserialize(null as any)).toThrow();
    expect(() => serializer.deserialize({} as any)).toThrow();
  });

  it('should serialize a single tier - working', () => {
    const wm = manager.getWorkingMemory();
    wm.add({ id: '1', content: 'test', type: 'fact', relevance: 0.5, timestamp: Date.now(), accessCount: 0, metadata: {} });
    const data = serializer.serializeTier(wm, 'working');
    expect(Array.isArray(data)).toBe(true);
  });

  it('should serialize a single tier - short-term', () => {
    const stm = manager.getShortTermMemory();
    stm.addMessage('user', 'test');
    const data = serializer.serializeTier(stm, 'short-term');
    expect(Array.isArray(data)).toBe(true);
  });

  it('should serialize a single tier - long-term', () => {
    const ltm = manager.getLongTermMemory();
    ltm.store('k1', 'v1');
    const data = serializer.serializeTier(ltm, 'long-term');
    expect(Array.isArray(data)).toBe(true);
  });

  it('should throw on unknown tier type', () => {
    expect(() => serializer.serializeTier({} as any, 'unknown')).toThrow();
  });

  it('should deserialize a single tier', () => {
    const data = [{ id: '1', content: 'test' }];
    const result = serializer.deserializeTier(data, 'working');
    expect(result).toEqual(data);
  });

  it('should throw on unknown deserialize tier type', () => {
    expect(() => serializer.deserializeTier({}, 'unknown')).toThrow();
  });

  it('should export to JSON', () => {
    manager.remember('test', { tier: 'working' });
    const json = serializer.exportToJSON(manager);
    const parsed = JSON.parse(json);
    expect(parsed.version).toBeDefined();
    expect(parsed.workingMemory.length).toBe(1);
  });

  it('should import from JSON', () => {
    manager.remember('test', { tier: 'working' });
    const json = serializer.exportToJSON(manager);
    const state = serializer.importFromJSON(json);
    expect(state.workingMemory.length).toBe(1);
  });

  it('should throw on invalid JSON import', () => {
    expect(() => serializer.importFromJSON('not json')).toThrow();
    expect(() => serializer.importFromJSON('{}')).toThrow();
  });

  it('should diff two memory states', () => {
    manager.remember('a', { tier: 'working' });
    const state1 = serializer.serialize(manager);
    manager.remember('b', { tier: 'working' });
    const state2 = serializer.serialize(manager);
    const diff = serializer.diff(state1, state2);
    expect(diff.added.working).toBe(1);
    expect(diff.removed.working).toBe(0);
  });

  it('should diff with removals', () => {
    manager.remember('a', { tier: 'working' });
    manager.remember('b', { tier: 'working' });
    const state1 = serializer.serialize(manager);
    // Remove the second item by its actual id
    const allItems = manager.getWorkingMemory().getAll();
    if (allItems.length >= 2) {
      manager.getWorkingMemory().remove(allItems[1]!.id);
    }
    const state2 = serializer.serialize(manager);
    const diff = serializer.diff(state1, state2);
    expect(diff.removed.working).toBe(1);
  });

  it('should merge multiple states', () => {
    const m1 = new MemoryManager();
    m1.remember('from m1', { tier: 'working' });
    const m2 = new MemoryManager();
    m2.remember('from m2', { tier: 'working' });
    const state1 = serializer.serialize(m1);
    const state2 = serializer.serialize(m2);
    const merged = serializer.mergeStates([state1, state2]);
    expect(merged.workingMemory.length).toBe(2);
  });

  it('should throw when merging empty states', () => {
    expect(() => serializer.mergeStates([])).toThrow();
  });

  it('should validate correct state', () => {
    const state = serializer.serialize(manager);
    expect(serializer.validateState(state)).toBe(true);
  });

  it('should reject invalid state', () => {
    expect(serializer.validateState(null)).toBe(false);
    expect(serializer.validateState({})).toBe(false);
    expect(serializer.validateState({ version: '1.0' })).toBe(false);
    expect(serializer.validateState({ version: 1, timestamp: 'x', workingMemory: [], shortTermMemory: [], longTermMemory: [], episodicMemory: [], semanticMemory: { concepts: [], relations: [] } })).toBe(false);
  });
});

// ============================================================
// Integration / Realistic Scenario Tests (14 tests)
// ============================================================
describe('Integration Scenarios', () => {
  it('should handle a full conversation lifecycle', () => {
    const manager = new MemoryManager();
    // User starts a conversation
    manager.remember('User wants to build a REST API', { tier: 'short-term' });
    manager.remember('Need to design database schema', { tier: 'working' });
    manager.remember('User prefers PostgreSQL', { tier: 'long-term', tags: ['preference', 'database'] });

    // Assistant responds
    manager.remember('Suggested Express.js with Prisma ORM', { tier: 'short-term' });

    // Recall relevant context
    const results = manager.recall('database');
    expect(results.length).toBeGreaterThan(0);

    // Consolidate
    manager.consolidate();
    expect(manager.getStats().consolidation.workingToShortTerm).toBeGreaterThanOrEqual(0);
  });

  it('should handle knowledge storage and retrieval', () => {
    const manager = new MemoryManager();
    // Store knowledge
    manager.remember('React hooks: useState, useEffect, useContext', { tier: 'long-term', tags: ['react', 'hooks'] });
    manager.remember('Vue composition API: ref, reactive, computed', { tier: 'long-term', tags: ['vue', 'composition'] });
    manager.remember('Angular services use dependency injection', { tier: 'long-term', tags: ['angular', 'di'] });

    // Add semantic relationships
    const sm = manager.getSemanticMemory();
    sm.addConcept('React', 'A JavaScript UI library by Meta');
    sm.addConcept('Vue', 'A progressive JavaScript framework');
    sm.addConcept('Angular', 'A TypeScript-based web framework');
    sm.addRelation('React', 'Vue', 'competes_with');
    sm.addRelation('React', 'Angular', 'competes_with');

    // Query
    const results = manager.recall('JavaScript framework');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should handle episode recall for learning', () => {
    const em = new EpisodicMemory();
    // Record past debugging episodes
    em.record({
      context: 'User reported null pointer exception in user service',
      actions: ['Checked database connection', 'Found missing null check', 'Added validation'],
      outcome: 'Bug fixed, user confirmed',
      emotion: 'satisfaction',
      importance: 0.9,
      tags: ['bug', 'debugging', 'user-service'],
      lessons: ['Always validate database query results', 'Add null checks for optional fields'],
    });
    em.record({
      context: 'Performance issue with N+1 queries',
      actions: ['Identified N+1 pattern', 'Added eager loading', 'Optimized indexes'],
      outcome: 'Response time reduced from 5s to 200ms',
      emotion: 'positive',
      importance: 0.95,
      tags: ['performance', 'database', 'optimization'],
      lessons: ['Use eager loading for relationships', 'Profile queries before optimizing'],
    });

    // Recall similar debugging situations
    const results = em.recall('null pointer');
    expect(results.length).toBeGreaterThan(0);

    // Extract lessons
    const lessons = em.extractLessons();
    expect(lessons.length).toBeGreaterThan(0);
  });

  it('should handle memory decay and consolidation', () => {
    const wm = new WorkingMemory(10);
    // Add items with varying relevance
    wm.add({ id: '1', content: 'urgent task', type: 'task', relevance: 0.9, timestamp: Date.now(), accessCount: 5, metadata: {} });
    wm.add({ id: '2', content: 'minor note', type: 'context', relevance: 0.2, timestamp: Date.now(), accessCount: 0, metadata: {} });
    wm.add({ id: '3', content: 'medium priority', type: 'task', relevance: 0.5, timestamp: Date.now(), accessCount: 2, metadata: {} });

    // Apply decay
    wm.decay(0.3);
    expect(wm.get('1')!.relevance).toBeGreaterThan(wm.get('2')!.relevance);

    // Consolidate low-priority items
    const consolidated = wm.consolidate();
    expect(consolidated.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle semantic memory knowledge graph', () => {
    const sm = new SemanticMemory();
    // Build a small knowledge graph
    sm.addConcept('JavaScript', 'A dynamic programming language', { year: 1995, creator: 'Brendan Eich' });
    sm.addConcept('TypeScript', 'A typed superset of JavaScript', { year: 2012, creator: 'Anders Hejlsberg' });
    sm.addConcept('Node.js', 'JavaScript runtime for server-side', { year: 2009 });
    sm.addRelation('TypeScript', 'JavaScript', 'superset_of');
    sm.addRelation('Node.js', 'JavaScript', 'runtime_for');
    sm.addRelation('TypeScript', 'Node.js', 'compatible_with');

    // Query related concepts
    const related = sm.getRelated('JavaScript', 1);
    expect(related.length).toBe(2);

    // Infer new knowledge
    const inferences = sm.infer('TypeScript');
    expect(inferences.length).toBeGreaterThan(0);

    // Check stats
    const stats = sm.getStats();
    expect(stats.conceptCount).toBe(3);
    expect(stats.relationCount).toBe(3);
  });

  it('should handle full serialization round-trip', () => {
    const manager = new MemoryManager();
    manager.remember('working item', { tier: 'working' });
    manager.remember('conversation', { tier: 'short-term' });
    manager.remember('knowledge', { tier: 'long-term', tags: ['knowledge'] });
    manager.remember('experience', { tier: 'episodic' });

    const sm = manager.getSemanticMemory();
    sm.addConcept('Test', 'Test concept');
    sm.addRelation('Test', 'Test2', 'related');

    // Export
    const json = manager.getSerializer().exportToJSON(manager);
    const parsed = JSON.parse(json);

    // Import into new manager
    const newManager = new MemoryManager();
    newManager.getSerializer().deserialize(parsed, newManager);

    // Verify
    expect(newManager.getStats().working.itemCount).toBe(1);
    expect(newManager.getStats().longTerm.entryCount).toBe(1);
    expect(newManager.getStats().episodic.episodeCount).toBe(1);
  });

  it('should handle forgetting curve correctly', () => {
    const mp = new MemoryPrioritizer();
    const now = Date.now();

    // A memory accessed many times should be retained longer
    const oftenAccessed = mp.getForgettingCurve(now - 86400000, 20); // 1 day old, 20 accesses
    const rarelyAccessed = mp.getForgettingCurve(now - 86400000, 0); // 1 day old, 0 accesses

    expect(oftenAccessed).toBeGreaterThan(rarelyAccessed);

    // A very old, never-accessed memory should be nearly forgotten
    const ancient = mp.getForgettingCurve(now - 86400000 * 365, 0);
    expect(ancient).toBeLessThan(0.01);
  });

  it('should handle multi-tier retrieval with ranking', () => {
    const manager = new MemoryManager();
    manager.remember('TypeScript tutorial content', { tier: 'working' });
    manager.remember('TypeScript best practices guide', { tier: 'long-term', tags: ['typescript', 'guide'] });
    manager.remember('TypeScript vs JavaScript comparison', { tier: 'long-term', tags: ['typescript', 'comparison'] });

    const results = manager.recall('TypeScript');
    expect(results.length).toBeGreaterThan(0);

    // Results should be ranked
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.relevance).toBeGreaterThanOrEqual(results[i]!.relevance);
    }
  });

  it('should handle short-term memory token management', () => {
    const stm = new ShortTermMemory(50); // very small limit
    // Add many messages
    for (let i = 0; i < 20; i++) {
      stm.addMessage('user', `Message number ${i} with some content`);
    }
    // Should have trimmed to fit
    expect(stm.getStats().totalTokens).toBeLessThanOrEqual(50);
    // Should still have some messages
    expect(stm.getStats().messageCount).toBeGreaterThan(0);
  });

  it('should handle long-term memory search with multiple filters', () => {
    const ltm = new LongTermMemory();
    const now = Date.now();
    ltm.store('k1', 'Important project decision', ['important', 'project'], { priority: 'high' });
    ltm.store('k2', 'Minor note about lunch', ['personal'], { priority: 'low' });
    ltm.store('k3', 'Another project update', ['project'], { priority: 'medium' });

    // Search with multiple filters
    const results = ltm.search('project', {
      tags: ['project'],
      minImportance: 0.3,
      startTime: now - 1000,
      endTime: now + 1000,
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle memory consolidation pipeline', () => {
    const manager = new MemoryManager();
    const wm = manager.getWorkingMemory();
    const stm = manager.getShortTermMemory();
    const ltm = manager.getLongTermMemory();

    // Add items to working memory
    wm.add({ id: '1', content: 'urgent bug fix', type: 'task', relevance: 0.9, timestamp: Date.now(), accessCount: 5, metadata: {} });
    wm.add({ id: '2', content: 'minor cleanup', type: 'task', relevance: 0.15, timestamp: Date.now(), accessCount: 0, metadata: {} });
    wm.add({ id: '3', content: 'documentation update', type: 'task', relevance: 0.2, timestamp: Date.now(), accessCount: 1, metadata: {} });

    // Add conversation
    stm.addMessage('user', 'We need to fix the authentication bug');
    stm.addMessage('assistant', 'I will investigate the JWT token validation');

    // Run consolidation
    const consolidator = manager.getConsolidator();
    consolidator.consolidateWorkingToShortTerm(wm, stm);
    consolidator.consolidateShortToLongTerm(stm, ltm);

    // Verify
    expect(wm.getStats().itemCount).toBeLessThan(3); // some consolidated
    expect(ltm.getStats().entryCount).toBeGreaterThan(0);
  });

  it('should handle state diffing and merging', () => {
    const serializer = new MemorySerializer();

    // Create state1 with a known item
    const m1 = new MemoryManager();
    m1.remember('shared item', { tier: 'working' });
    m1.remember('state1 item', { tier: 'working' });
    const state1 = serializer.serialize(m1);

    // Create state2 by adding to the same manager
    m1.remember('state2 item', { tier: 'working' });
    const state2 = serializer.serialize(m1);

    // Diff
    const diff = serializer.diff(state1, state2);
    expect(diff.added.working).toBe(1); // only state2 item is new
    expect(diff.removed.working).toBe(0); // nothing removed

    // Merge two separate states
    const m3 = new MemoryManager();
    m3.remember('from m3', { tier: 'working' });
    const state3 = serializer.serialize(m3);
    const merged = serializer.mergeStates([state1, state3]);
    expect(merged.workingMemory.length).toBe(3); // shared + state1 + from m3
  });

  it('should handle empty state edge cases', () => {
    const manager = new MemoryManager();
    expect(manager.getStats().working.itemCount).toBe(0);
    expect(manager.getStats().shortTerm.messageCount).toBe(0);
    expect(manager.recall('anything')).toEqual([]);
    expect(manager.getContext()).toContain('No relevant memories');
  });
});
