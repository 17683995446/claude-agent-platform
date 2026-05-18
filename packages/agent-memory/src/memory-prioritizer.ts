/**
 * MemoryPrioritizer - Prioritize and manage memory importance.
 * Implements Ebbinghaus forgetting curve and multi-factor scoring.
 */

export interface MemoryForScoring {
  id: string;
  content: string;
  timestamp: number;
  accessCount: number;
  relevance?: number;
  emotion?: string;
  importance?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export class MemoryPrioritizer {
  /**
   * Calculate a combined importance score (0-1) for a memory.
   */
  calculateImportance(memory: MemoryForScoring): number {
    const recency = this.recencyScore(memory.timestamp);
    const frequency = this.frequencyScore(memory.accessCount);
    const relevance = memory.relevance ?? 0.5;
    const emotional = this.emotionalScore(memory.emotion);

    // Weighted combination
    const score = recency * 0.3 + frequency * 0.25 + relevance * 0.25 + emotional * 0.2;
    return Math.min(1, Math.max(0, score));
  }

  /**
   * Time-based recency score. Newer items score higher.
   */
  recencyScore(timestamp: number): number {
    const now = Date.now();
    const ageMs = now - timestamp;
    // Half-life of 1 hour (3,600,000 ms)
    const halfLife = 3_600_000;
    const score = Math.pow(0.5, ageMs / halfLife);
    return Math.min(1, Math.max(0, score));
  }

  /**
   * Access frequency score. More accesses = higher score.
   * Uses logarithmic scaling to prevent runaway scores.
   */
  frequencyScore(accessCount: number): number {
    if (accessCount <= 0) return 0;
    // Logarithmic scaling: score approaches 1 asymptotically
    return Math.min(1, Math.log(1 + accessCount) / Math.log(1 + 100));
  }

  /**
   * Context relevance score based on string similarity.
   */
  relevanceScore(memory: MemoryForScoring, context: string): number {
    const memoryWords = new Set(memory.content.toLowerCase().split(/\s+/));
    const contextWords = new Set(context.toLowerCase().split(/\s+/));
    let overlap = 0;
    for (const word of memoryWords) {
      if (contextWords.has(word)) overlap++;
    }
    const denominator = Math.max(memoryWords.size, contextWords.size, 1);
    return overlap / denominator;
  }

  /**
   * Emotional significance score.
   */
  emotionalScore(emotion?: string): number {
    if (!emotion) return 0.5;
    const scores: Record<string, number> = {
      positive: 0.8,
      satisfaction: 0.85,
      negative: 0.7,
      frustration: 0.75,
      surprise: 0.9,
      neutral: 0.4,
      fear: 0.8,
      joy: 0.85,
      anger: 0.7,
      sadness: 0.6,
    };
    return scores[emotion.toLowerCase()] ?? 0.5;
  }

  /**
   * Rank memories by combined importance score given a context.
   */
  prioritize(memories: MemoryForScoring[], context: string): MemoryForScoring[] {
    return [...memories].sort((a, b) => {
      const scoreA = this.calculateImportance(a) + this.relevanceScore(a, context) * 0.3;
      const scoreB = this.calculateImportance(b) + this.relevanceScore(b, context) * 0.3;
      return scoreB - scoreA;
    });
  }

  /**
   * Decide if a memory should be forgotten based on its age and access pattern.
   */
  shouldForget(memory: MemoryForScoring, threshold: number = 0.2): boolean {
    const ageMs = Date.now() - memory.timestamp;
    const curve = this.getForgettingCurve(ageMs, memory.accessCount);
    return curve < threshold;
  }

  /**
   * Ebbinghaus forgetting curve: S(t) = e^(-t/S)
   * where S is stability (increases with access count).
   * @param ageMs - Age in milliseconds (time elapsed since the memory was created)
   */
  getForgettingCurve(ageMs: number, accessCount: number): number {
    // Stability increases with each access
    const stability = 3_600_000 * Math.pow(2, Math.min(accessCount, 10));
    const retention = Math.exp(-ageMs / stability);
    return Math.min(1, Math.max(0, retention));
  }
}
