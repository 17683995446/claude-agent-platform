// ============================================================
// Module 1: Context Window Manager
// Manages token budget, priority allocation, compression
// ============================================================

export type MessageRole = 'system' | 'user' | 'assistant' | 'code' | 'history' | 'auxiliary';

export interface ContextMessage {
  id: string;
  role: string;
  content: string;
  priority: number;
  tokens: number;
  timestamp: number;
  importance: number;
}

export interface ContextSnapshot {
  messages: ContextMessage[];
  totalTokens: number;
  systemTokens: number;
  userTokens: number;
  codeTokens: number;
  historyTokens: number;
  auxiliaryTokens: number;
}

export interface CompressionResult {
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  removedMessages: string[];
  summarizedMessages: { id: string; summary: string }[];
}

const PRIORITY_MAP: Record<string, number> = {
  system: 100,
  user: 80,
  code: 60,
  history: 40,
  auxiliary: 20,
};

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function countTokens(text: string): number {
  let tokens = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x4E00 && code <= 0x9FFF) {
      tokens += 0.5; // CJK: ~2 chars per token
    } else if (code >= 0x3040 && code <= 0x30FF) {
      tokens += 0.5; // Japanese kana
    } else if (code >= 0xAC00 && code <= 0xD7AF) {
      tokens += 0.5; // Korean
    } else {
      tokens += 0.25; // Latin: ~4 chars per token
    }
  }
  return Math.max(1, Math.ceil(tokens));
}

function computeImportance(message: ContextMessage): number {
  const age = Date.now() - message.timestamp;
  const recencyFactor = Math.max(0, 1 - age / (24 * 60 * 60 * 1000)); // decay over 24h
  const lengthFactor = Math.min(1, message.tokens / 500);
  return message.priority * 0.5 + recencyFactor * 30 + lengthFactor * 20;
}

export class ContextWindowManager {
  private messages: ContextMessage[] = [];
  private tokenBudget: number;
  private messageCounter = 0;

  constructor(tokenBudget: number = 200_000) {
    this.tokenBudget = tokenBudget;
  }

  addMessage(role: string, content: string, priority?: number): void {
    const resolvedPriority = priority ?? PRIORITY_MAP[role] ?? 50;
    const tokens = countTokens(content);
    const msg: ContextMessage = {
      id: generateId(),
      role,
      content,
      priority: resolvedPriority,
      tokens,
      timestamp: Date.now(),
      importance: 0,
    };
    msg.importance = computeImportance(msg);
    this.messages.push(msg);
    this.messageCounter++;
  }

  getOptimalContext(): ContextSnapshot {
    const sorted = [...this.messages].sort((a, b) => {
      // Sort by priority category first, then by importance
      const catA = PRIORITY_MAP[a.role] ?? 50;
      const catB = PRIORITY_MAP[b.role] ?? 50;
      if (catB !== catA) return catB - catA;
      return b.importance - a.importance;
    });

    const selected: ContextMessage[] = [];
    let totalTokens = 0;

    // Always include system messages first
    for (const msg of sorted) {
      if (msg.role === 'system' && totalTokens + msg.tokens <= this.tokenBudget) {
        selected.push(msg);
        totalTokens += msg.tokens;
      }
    }

    // Then fill remaining budget by importance
    const remaining = sorted.filter(m => m.role !== 'system');
    for (const msg of remaining) {
      if (totalTokens + msg.tokens <= this.tokenBudget) {
        selected.push(msg);
        totalTokens += msg.tokens;
      }
    }

    return this.buildSnapshot(selected);
  }

  getRemainingTokens(): number {
    const used = this.messages.reduce((sum, m) => sum + m.tokens, 0);
    return Math.max(0, this.tokenBudget - used);
  }

  compress(targetTokens: number): CompressionResult {
    const originalTokens = this.messages.reduce((sum, m) => sum + m.tokens, 0);
    if (originalTokens <= targetTokens) {
      return {
        originalTokens,
        compressedTokens: originalTokens,
        compressionRatio: 1,
        removedMessages: [],
        summarizedMessages: [],
      };
    }

    const removedMessages: string[] = [];
    const summarizedMessages: { id: string; summary: string }[] = [];
    let currentTokens = originalTokens;

    // Sort by importance ascending (remove least important first)
    const sorted = [...this.messages].sort((a, b) => a.importance - b.importance);

    for (const msg of sorted) {
      if (currentTokens <= targetTokens) break;

      if (msg.role === 'history' || msg.role === 'auxiliary') {
        // Summarize instead of remove
        const summary = msg.content.slice(0, Math.ceil(msg.content.length * 0.3));
        const savedTokens = msg.tokens - countTokens(summary);
        summarizedMessages.push({ id: msg.id, summary });
        msg.content = summary;
        msg.tokens = countTokens(summary);
        currentTokens -= savedTokens;
      } else if (msg.priority < 70) {
        // Remove low priority messages
        removedMessages.push(msg.id);
        currentTokens -= msg.tokens;
      }
    }

    this.messages = this.messages.filter(m => !removedMessages.includes(m.id));

    return {
      originalTokens,
      compressedTokens: currentTokens,
      compressionRatio: currentTokens / originalTokens,
      removedMessages,
      summarizedMessages,
    };
  }

  getMessageCount(): number {
    return this.messages.length;
  }

  clear(): void {
    this.messages = [];
    this.messageCounter = 0;
  }

  private buildSnapshot(messages: ContextMessage[]): ContextSnapshot {
    const snapshot: ContextSnapshot = {
      messages,
      totalTokens: 0,
      systemTokens: 0,
      userTokens: 0,
      codeTokens: 0,
      historyTokens: 0,
      auxiliaryTokens: 0,
    };

    for (const msg of messages) {
      snapshot.totalTokens += msg.tokens;
      switch (msg.role) {
        case 'system': snapshot.systemTokens += msg.tokens; break;
        case 'user': snapshot.userTokens += msg.tokens; break;
        case 'code': snapshot.codeTokens += msg.tokens; break;
        case 'history': snapshot.historyTokens += msg.tokens; break;
        default: snapshot.auxiliaryTokens += msg.tokens; break;
      }
    }

    return snapshot;
  }
}

// Export token counting utility for reuse
export { countTokens, PRIORITY_MAP };
