// ============================================================
// Module 5: Conversation Memory System
// Short-term, long-term, episodic, semantic memory
// ============================================================

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: Record<string, string>;
}

export interface RecallOptions {
  maxResults?: number;
  memoryTypes?: ('short_term' | 'long_term' | 'episodic' | 'semantic')[];
  minRelevance?: number;
  timeRange?: { start: number; end: number };
}

export interface MemoryResult {
  shortTerm: ConversationMessage[];
  longTerm: LongTermMemory[];
  episodic: EpisodicMemory[];
  semantic: SemanticMemory[];
  totalRelevance: number;
}

export interface LongTermMemory {
  id: string;
  topic: string;
  summary: string;
  keyPoints: string[];
  timestamp: number;
  messageCount: number;
  relevanceScore: number;
}

export interface EpisodicMemory {
  id: string;
  event: string;
  outcome: string;
  importance: number;
  timestamp: number;
  tags: string[];
}

export interface SemanticMemory {
  id: string;
  pattern: string;
  rule: string;
  confidence: number;
  learnedFrom: string;
  timestamp: number;
}

export interface ConversationSummary {
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  topics: string[];
  keyDecisions: string[];
  userPreferences: string[];
  startTime: number;
  lastActivity: number;
}

let memIdCounter = 0;
function newMemId(prefix: string): string {
  return `${prefix}_${++memIdCounter}_${Date.now()}`;
}

function computeRelevance(query: string, text: string): number {
  const queryWords = new Set(query.toLowerCase().split(/\s+/));
  const textWords = text.toLowerCase().split(/\s+/);
  let matches = 0;
  for (const word of textWords) {
    if (queryWords.has(word)) matches++;
  }
  return queryWords.size > 0 ? matches / queryWords.size : 0;
}

export class ConversationMemory {
  private shortTermMemory: ConversationMessage[] = [];
  private longTermMemory: LongTermMemory[] = [];
  private episodicMemory: EpisodicMemory[] = [];
  private semanticMemory: SemanticMemory[] = [];
  private shortTermWindowSize: number;
  private userPreferences: Set<string> = new Set();

  constructor(shortTermWindowSize: number = 50) {
    this.shortTermWindowSize = shortTermWindowSize;
  }

  addMessage(message: ConversationMessage): void {
    this.shortTermMemory.push(message);

    // Sliding window for short-term memory
    if (this.shortTermMemory.length > this.shortTermWindowSize) {
      const evicted = this.shortTermMemory.shift()!;
      this.consolidateToLongTerm(evicted);
    }

    // Extract episodic events from user messages
    if (message.role === 'user') {
      this.extractEpisodicEvent(message);
    }
  }

  recall(query: string, options?: RecallOptions): MemoryResult {
    const maxResults = options?.maxResults ?? 10;
    const minRelevance = options?.minRelevance ?? 0;
    const types = options?.memoryTypes ?? ['short_term', 'long_term', 'episodic', 'semantic'];

    const result: MemoryResult = {
      shortTerm: [],
      longTerm: [],
      episodic: [],
      semantic: [],
      totalRelevance: 0,
    };

    // Search short-term memory
    if (types.includes('short_term')) {
      const scored = this.shortTermMemory
        .map(m => ({ msg: m, score: computeRelevance(query, m.content) }))
        .filter(s => s.score >= minRelevance)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);
      result.shortTerm = scored.map(s => s.msg);
      result.totalRelevance += scored.reduce((sum, s) => sum + s.score, 0);
    }

    // Search long-term memory
    if (types.includes('long_term')) {
      const scored = this.longTermMemory
        .map(m => ({ mem: m, score: computeRelevance(query, `${m.topic} ${m.summary} ${m.keyPoints.join(' ')}`) }))
        .filter(s => s.score >= minRelevance)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);
      result.longTerm = scored.map(s => s.mem);
      result.totalRelevance += scored.reduce((sum, s) => sum + s.score, 0);
    }

    // Search episodic memory
    if (types.includes('episodic')) {
      const scored = this.episodicMemory
        .map(m => ({ mem: m, score: computeRelevance(query, `${m.event} ${m.outcome} ${m.tags.join(' ')}`) }))
        .filter(s => s.score >= minRelevance)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);
      result.episodic = scored.map(s => s.mem);
      result.totalRelevance += scored.reduce((sum, s) => sum + s.score, 0);
    }

    // Search semantic memory
    if (types.includes('semantic')) {
      const scored = this.semanticMemory
        .map(m => ({ mem: m, score: computeRelevance(query, `${m.pattern} ${m.rule}`) }))
        .filter(s => s.score >= minRelevance)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);
      result.semantic = scored.map(s => s.mem);
      result.totalRelevance += scored.reduce((sum, s) => sum + s.score, 0);
    }

    return result;
  }

  getSummary(): ConversationSummary {
    const userMsgs = this.shortTermMemory.filter(m => m.role === 'user');
    const assistantMsgs = this.shortTermMemory.filter(m => m.role === 'assistant');

    const topics = this.extractTopics();
    const keyDecisions = this.longTermMemory
      .filter(m => m.importance > 0.7)
      .map(m => m.summary);

    return {
      totalMessages: this.shortTermMemory.length + this.longTermMemory.reduce((s, m) => s + m.messageCount, 0),
      userMessages: userMsgs.length,
      assistantMessages: assistantMsgs.length,
      topics,
      keyDecisions,
      userPreferences: Array.from(this.userPreferences),
      startTime: this.shortTermMemory[0]?.timestamp ?? Date.now(),
      lastActivity: this.shortTermMemory[this.shortTermMemory.length - 1]?.timestamp ?? Date.now(),
    };
  }

  exportMemory(format: 'json' | 'markdown'): string {
    if (format === 'json') {
      return JSON.stringify({
        shortTerm: this.shortTermMemory,
        longTerm: this.longTermMemory,
        episodic: this.episodicMemory,
        semantic: this.semanticMemory,
        preferences: Array.from(this.userPreferences),
      }, null, 2);
    }

    // Markdown format
    const lines: string[] = ['# Conversation Memory', ''];

    lines.push('## Short-term Memory');
    lines.push(`Messages: ${this.shortTermMemory.length}`);
    for (const msg of this.shortTermMemory.slice(-10)) {
      lines.push(`- **${msg.role}**: ${msg.content.slice(0, 100)}`);
    }
    lines.push('');

    lines.push('## Long-term Memory');
    for (const mem of this.longTermMemory) {
      lines.push(`### ${mem.topic}`);
      lines.push(mem.summary);
      lines.push(`Key points: ${mem.keyPoints.join(', ')}`);
      lines.push('');
    }

    lines.push('## Episodic Memory');
    for (const mem of this.episodicMemory) {
      lines.push(`- **${mem.event}** -> ${mem.outcome} (importance: ${mem.importance})`);
    }
    lines.push('');

    lines.push('## Semantic Memory');
    for (const mem of this.semanticMemory) {
      lines.push(`- Pattern: ${mem.pattern} -> Rule: ${mem.rule} (confidence: ${mem.confidence})`);
    }

    return lines.join('\n');
  }

  addSemanticMemory(pattern: string, rule: string, learnedFrom: string): void {
    const existing = this.semanticMemory.find(m => m.pattern === pattern);
    if (existing) {
      existing.rule = rule;
      existing.confidence = Math.min(1, existing.confidence + 0.1);
      existing.timestamp = Date.now();
    } else {
      this.semanticMemory.push({
        id: newMemId('sem'),
        pattern,
        rule,
        confidence: 0.5,
        learnedFrom,
        timestamp: Date.now(),
      });
    }
  }

  getShortTermMessageCount(): number {
    return this.shortTermMemory.length;
  }

  getLongTermMemoryCount(): number {
    return this.longTermMemory.length;
  }

  clear(): void {
    this.shortTermMemory = [];
    this.longTermMemory = [];
    this.episodicMemory = [];
    this.semanticMemory = [];
    this.userPreferences.clear();
  }

  private consolidateToLongTerm(message: ConversationMessage): void {
    // Group similar messages by topic
    const topic = this.extractTopic(message.content);
    const existing = this.longTermMemory.find(m => m.topic === topic);

    if (existing) {
      existing.messageCount++;
      existing.summary = `${existing.summary}. ${message.content.slice(0, 100)}`;
      if (message.content.length > 20) {
        existing.keyPoints.push(message.content.slice(0, 50));
      }
      if (existing.keyPoints.length > 5) existing.keyPoints.shift();
    } else {
      this.longTermMemory.push({
        id: newMemId('ltm'),
        topic,
        summary: message.content.slice(0, 200),
        keyPoints: message.content.length > 20 ? [message.content.slice(0, 50)] : [],
        timestamp: Date.now(),
        messageCount: 1,
        relevanceScore: 0,
      });
    }

    // Keep long-term memory bounded
    if (this.longTermMemory.length > 100) {
      this.longTermMemory.shift();
    }
  }

  private extractEpisodicEvent(message: ConversationMessage): void {
    const content = message.content.toLowerCase();
    const importanceKeywords = ['important', 'critical', 'decided', 'chose', 'final', '关键', '决定', '重要'];

    let importance = 0;
    for (const kw of importanceKeywords) {
      if (content.includes(kw)) importance += 0.3;
    }

    if (importance > 0.3) {
      this.episodicMemory.push({
        id: newMemId('epi'),
        event: message.content.slice(0, 100),
        outcome: '',
        importance: Math.min(1, importance),
        timestamp: Date.now(),
        tags: this.extractTags(message.content),
      });

      if (this.episodicMemory.length > 50) {
        this.episodicMemory.shift();
      }
    }
  }

  private extractTopic(content: string): string {
    const words = content.split(/\s+/).filter(w => w.length > 3);
    return words.slice(0, 3).join(' ') || 'general';
  }

  private extractTopics(): string[] {
    return this.longTermMemory.map(m => m.topic);
  }

  private extractTags(content: string): string[] {
    return content.split(/\s+/).filter(w => w.startsWith('#')).map(w => w.slice(1));
  }
}
