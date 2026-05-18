/**
 * DocumentStore - Store documents with optional embeddings for semantic search
 */

import { cosineSimilarity } from './vector-operations.js';

interface StoredDocument {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  embedding?: number[];
}

export class DocumentStore {
  private documents: Map<string, StoredDocument> = new Map();

  addDocument(doc: { id: string; content: string; metadata?: Record<string, unknown>; embedding?: number[] }): void {
    this.documents.set(doc.id, {
      id: doc.id,
      content: doc.content,
      metadata: doc.metadata,
      embedding: doc.embedding,
    });
  }

  getDocument(id: string): StoredDocument | undefined {
    return this.documents.get(id);
  }

  search(query: number[], topK: number): Array<{ id: string; content: string; metadata?: Record<string, unknown>; score: number }> {
    if (topK <= 0) return [];

    const results: Array<{ id: string; content: string; metadata?: Record<string, unknown>; score: number }> = [];

    for (const doc of this.documents.values()) {
      if (!doc.embedding) continue;
      const score = cosineSimilarity(query, doc.embedding);
      results.push({
        id: doc.id,
        content: doc.content,
        metadata: doc.metadata,
        score,
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  updateDocument(id: string, updates: Partial<{ content: string; metadata: Record<string, unknown>; embedding: number[] }>): boolean {
    const doc = this.documents.get(id);
    if (!doc) return false;
    if (updates.content !== undefined) doc.content = updates.content;
    if (updates.metadata !== undefined) doc.metadata = updates.metadata;
    if (updates.embedding !== undefined) doc.embedding = updates.embedding;
    return true;
  }

  deleteDocument(id: string): boolean {
    return this.documents.delete(id);
  }

  listDocuments(filter?: Partial<{ metadata: Record<string, unknown> }>): StoredDocument[] {
    if (!filter || !filter.metadata) {
      return Array.from(this.documents.values());
    }
    return Array.from(this.documents.values()).filter(doc => {
      if (!doc.metadata) return false;
      for (const [key, value] of Object.entries(filter.metadata!)) {
        if (doc.metadata[key] !== value) return false;
      }
      return true;
    });
  }

  getStats(): { total: number; withEmbedding: number; avgContentLength: number } {
    let withEmbedding = 0;
    let totalLength = 0;
    for (const doc of this.documents.values()) {
      if (doc.embedding) withEmbedding++;
      totalLength += doc.content.length;
    }
    return {
      total: this.documents.size,
      withEmbedding,
      avgContentLength: this.documents.size > 0 ? totalLength / this.documents.size : 0,
    };
  }
}
