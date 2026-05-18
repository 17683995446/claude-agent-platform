/**
 * ShortTermMemory - Conversation-level context window with token management.
 */

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  tokens: number;
  metadata: Record<string, unknown>;
}

export interface ShortTermMemoryStats {
  messageCount: number;
  totalTokens: number;
  maxTokens: number;
  utilization: number;
  oldestMessageAge: number;
  newestMessageAge: number;
  averageTokensPerMessage: number;
}

export class ShortTermMemory {
  private messages: Message[] = [];
  private maxTokens: number;
  private totalTokens: number = 0;
  private idCounter: number = 0;

  constructor(maxTokens: number = 4096) {
    if (maxTokens <= 0) throw new Error('maxTokens must be positive');
    this.maxTokens = maxTokens;
  }

  addMessage(
    role: Message['role'],
    content: string,
    metadata: Record<string, unknown> = {}
  ): Message {
    const tokens = this.estimateTokens(content);
    const message: Message = {
      id: `msg-${++this.idCounter}`,
      role,
      content,
      timestamp: Date.now(),
      tokens,
      metadata,
    };
    this.messages.push(message);
    this.totalTokens += tokens;
    this.trimToFit();
    return message;
  }

  getRecent(count: number): Message[] {
    if (count <= 0) return [];
    return this.messages.slice(-count);
  }

  getContext(): string {
    return this.messages
      .map((m) => `[${m.role}]: ${m.content}`)
      .join('\n');
  }

  summarize(): string {
    if (this.messages.length === 0) return 'No conversation history.';
    const userMsgs = this.messages.filter((m) => m.role === 'user');
    const assistantMsgs = this.messages.filter((m) => m.role === 'assistant');
    const topics = this.extractTopics();
    return `Conversation summary: ${this.messages.length} messages (${userMsgs.length} user, ${assistantMsgs.length} assistant). Topics: ${topics.join(', ') || 'general'}.`;
  }

  getTokenCount(): number {
    return this.totalTokens;
  }

  trimToFit(): number {
    let trimmed = 0;
    while (this.totalTokens > this.maxTokens && this.messages.length > 1) {
      const removed = this.messages.shift()!;
      this.totalTokens -= removed.tokens;
      trimmed++;
    }
    return trimmed;
  }

  search(query: string): Message[] {
    const lowerQuery = query.toLowerCase();
    return this.messages.filter(
      (m) =>
        m.content.toLowerCase().includes(lowerQuery) ||
        m.role.toLowerCase().includes(lowerQuery) ||
        Object.values(m.metadata).some(
          (v) => typeof v === 'string' && v.toLowerCase().includes(lowerQuery)
        )
    );
  }

  getStats(): ShortTermMemoryStats {
    const now = Date.now();
    const timestamps = this.messages.map((m) => m.timestamp);
    return {
      messageCount: this.messages.length,
      totalTokens: this.totalTokens,
      maxTokens: this.maxTokens,
      utilization: this.maxTokens > 0 ? this.totalTokens / this.maxTokens : 0,
      oldestMessageAge: timestamps.length > 0 ? now - Math.min(...timestamps) : 0,
      newestMessageAge: timestamps.length > 0 ? now - Math.max(...timestamps) : 0,
      averageTokensPerMessage:
        this.messages.length > 0 ? this.totalTokens / this.messages.length : 0,
    };
  }

  /** Estimate tokens: ~4 chars per token as a rough heuristic */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private extractTopics(): string[] {
    const words = this.messages
      .flatMap((m) => m.content.split(/\s+/))
      .map((w) => w.toLowerCase().replace(/[^a-z]/g, ''))
      .filter((w) => w.length > 4);
    const freq = new Map<string, number>();
    for (const w of words) {
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([w]) => w);
  }
}
