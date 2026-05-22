/**
 * TextChunker - Split text into chunks for embedding and retrieval
 */

export interface ChunkOptions {
  maxSize?: number;
  overlap?: number;
}

export class TextChunker {
  /**
   * Split text into chunks of approximately maxSize characters with overlap.
   */
  chunk(text: string, options?: ChunkOptions): string[] {
    const maxSize = options?.maxSize ?? 500;
    const overlap = options?.overlap ?? 50;

    if (text.length === 0) return [];
    if (text.length <= maxSize) return [text];

    const chunks: string[] = [];
    let start = 0;
    let lastStart = 0;

    while (start < text.length) {
      let end = Math.min(start + maxSize, text.length);

      // Try to break at a word boundary
      if (end < text.length) {
        const lastSpace = text.lastIndexOf(' ', end);
        if (lastSpace > start) {
          end = lastSpace;
        }
      }

      chunks.push(text.slice(start, end).trim());
      if (end >= text.length) break;

      start = end - overlap;
      if (start < 0) start = 0;
      // Avoid infinite loop when overlap >= maxSize
      if (start <= lastStart) start = lastStart + 1;
      if (start >= text.length) break;
      lastStart = start;
    }

    return chunks.filter(c => c.length > 0);
  }

  /**
   * Split text by sentences, grouping up to maxSentences per chunk.
   */
  chunkBySentence(text: string, maxSentences?: number): string[] {
    const limit = maxSentences ?? 5;
    if (text.length === 0) return [];

    // Split by sentence boundaries
    let sentences = text.match(/[^.!?]+[.!?]+/g);
    if (!sentences || sentences.length === 0) {
      // No sentence-ending punctuation found; treat entire text as one sentence
      sentences = [text];
    }
    // Trim whitespace from each sentence
    sentences = sentences.map(s => s.trim()).filter(s => s.length > 0);
    if (sentences.length === 0) return [];

    const chunks: string[] = [];
    for (let i = 0; i < sentences.length; i += limit) {
      const group = sentences.slice(i, i + limit).join(' ').trim();
      if (group.length > 0) {
        chunks.push(group);
      }
    }
    return chunks;
  }

  /**
   * Split text by paragraphs (double newline).
   */
  chunkByParagraph(text: string): string[] {
    if (text.length === 0) return [];
    return text
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(p => p.length > 0);
  }

  /**
   * Merge small chunks together up to maxSize.
   */
  mergeChunks(chunks: string[], maxSize: number): string[] {
    if (chunks.length === 0) return [];
    const merged: string[] = [];
    let current = '';

    for (const chunk of chunks) {
      if (current.length === 0) {
        current = chunk;
      } else if (current.length + chunk.length + 1 <= maxSize) {
        current += ' ' + chunk;
      } else {
        merged.push(current);
        current = chunk;
      }
    }
    if (current.length > 0) {
      merged.push(current);
    }
    return merged;
  }

  /**
   * Get statistics about a set of chunks.
   */
  getStats(chunks: string[]): { count: number; avgLength: number; minLength: number; maxLength: number } {
    if (chunks.length === 0) {
      return { count: 0, avgLength: 0, minLength: 0, maxLength: 0 };
    }
    const lengths = chunks.map(c => c.length);
    const total = lengths.reduce((s, l) => s + l, 0);
    return {
      count: chunks.length,
      avgLength: total / chunks.length,
      minLength: Math.min(...lengths),
      maxLength: Math.max(...lengths),
    };
  }
}
