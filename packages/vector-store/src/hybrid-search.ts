/**
 * HybridSearch - Combines vector similarity search with keyword (TF-IDF) search
 */

import { cosineSimilarity } from './vector-operations.js';

interface HybridDocument {
  id: string;
  content: string;
  vector: number[];
  metadata?: Record<string, unknown>;
}

export class HybridSearch {
  private documents: Map<string, HybridDocument> = new Map();
  private alpha: number;
  private vectorSearches = 0;
  private keywordSearches = 0;
  private hybridSearches = 0;

  constructor(options?: { alpha?: number }) {
    this.alpha = options?.alpha ?? 0.7;
  }

  addDocument(id: string, content: string, vector: number[], metadata?: Record<string, unknown>): void {
    this.documents.set(id, { id, content, vector, metadata });
  }

  removeDocument(id: string): void {
    this.documents.delete(id);
  }

  search(
    queryText: string,
    queryVector: number[],
    topK: number
  ): Array<{ id: string; content: string; score: number; vectorScore: number; keywordScore: number }> {
    if (topK <= 0 || this.documents.size === 0) return [];
    this.hybridSearches++;
    this.vectorSearches++;
    this.keywordSearches++;

    const queryTerms = this.tokenize(queryText);
    const results: Array<{ id: string; content: string; score: number; vectorScore: number; keywordScore: number }> = [];

    for (const doc of this.documents.values()) {
      if (queryVector.length !== doc.vector.length) continue;
      const vectorScore = cosineSimilarity(queryVector, doc.vector);
      const keywordScore = this.tfidfScore(queryTerms, doc.content);
      const score = this.alpha * vectorScore + (1 - this.alpha) * keywordScore;
      results.push({
        id: doc.id,
        content: doc.content,
        score,
        vectorScore,
        keywordScore,
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  setAlpha(alpha: number): void {
    if (alpha < 0 || alpha > 1) throw new Error('alpha must be between 0 and 1');
    this.alpha = alpha;
  }

  getStats(): { totalDocuments: number; vectorSearches: number; keywordSearches: number; hybridSearches: number } {
    return {
      totalDocuments: this.documents.size,
      vectorSearches: this.vectorSearches,
      keywordSearches: this.keywordSearches,
      hybridSearches: this.hybridSearches,
    };
  }

  private tokenize(text: string): string[] {
    return text.toLowerCase().split(/\s+/).filter(t => t.length > 0);
  }

  private tfidfScore(queryTerms: string[], document: string): number {
    const docTerms = this.tokenize(document);
    const allDocs = Array.from(this.documents.values()).map(d => this.tokenize(d.content));

    let score = 0;
    for (const term of queryTerms) {
      const tf = this.termFrequency(term, docTerms);
      const idf = this.inverseDocumentFrequency(term, allDocs);
      score += tf * idf;
    }
    return score;
  }

  private termFrequency(term: string, terms: string[]): number {
    if (terms.length === 0) return 0;
    const count = terms.filter(t => t === term).length;
    return count / terms.length;
  }

  private inverseDocumentFrequency(term: string, allDocs: string[][]): number {
    const docsWithTerm = allDocs.filter(doc => doc.includes(term)).length;
    if (docsWithTerm === 0) return 0;
    return Math.log((allDocs.length + 1) / (docsWithTerm + 1)) + 1;
  }
}
