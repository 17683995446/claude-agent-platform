// src/duplication-detector.ts

import type { FileEntry } from './dependency-analyzer.js';

export interface DetectionOptions {
  minLines?: number;
  minTokens?: number;
  similarityThreshold?: number;
  ignoreWhitespace?: boolean;
  ignoreComments?: boolean;
}

export interface DuplicationResult {
  clonePairs: ClonePair[];
  duplicationRate: number;
  totalDuplicates: number;
  summary: DuplicationSummary;
}

export interface ClonePair {
  file1: string;
  file2: string;
  startLine1: number;
  endLine1: number;
  startLine2: number;
  endLine2: number;
  cloneType: CloneType;
  similarity: number;
  duplicatedLines: string[];
}

export type CloneType = 'type1' | 'type2' | 'type3';

export interface DuplicationSummary {
  totalFiles: number;
  filesWithDuplicates: number;
  averageSimilarity: number;
  cloneTypeCounts: Record<CloneType, number>;
}

const DEFAULT_OPTIONS: DetectionOptions = {
  minLines: 3,
  minTokens: 10,
  similarityThreshold: 0.8,
  ignoreWhitespace: true,
  ignoreComments: true,
};

export class DuplicationDetector {
  private options: DetectionOptions;
  private files: FileEntry[] = [];

  constructor(options?: DetectionOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  detect(files: FileEntry[], options?: DetectionOptions): DuplicationResult {
    const opts = { ...this.options, ...options };
    this.files = files;

    const clonePairs = this.findClones(opts.similarityThreshold || 0.8);
    const totalLines = files.reduce((sum, f) => sum + f.content.split('\n').length, 0);

    // Track duplicated lines per file to avoid cross-file line number conflicts
    const duplicatedLineSet = new Set<string>();
    for (const pair of clonePairs) {
      for (let i = pair.startLine1; i <= pair.endLine1; i++) {
        duplicatedLineSet.add(`${pair.file1}:${i}`);
      }
      for (let i = pair.startLine2; i <= pair.endLine2; i++) {
        duplicatedLineSet.add(`${pair.file2}:${i}`);
      }
    }

    const duplicationRate = totalLines > 0 ? duplicatedLineSet.size / totalLines : 0;

    const filesWithDuplicates = new Set<string>();
    for (const pair of clonePairs) {
      filesWithDuplicates.add(pair.file1);
      filesWithDuplicates.add(pair.file2);
    }

    const cloneTypeCounts: Record<CloneType, number> = { type1: 0, type2: 0, type3: 0 };
    for (const pair of clonePairs) {
      cloneTypeCounts[pair.cloneType]++;
    }

    const averageSimilarity = clonePairs.length > 0
      ? clonePairs.reduce((sum, p) => sum + p.similarity, 0) / clonePairs.length
      : 0;

    return {
      clonePairs,
      duplicationRate,
      totalDuplicates: clonePairs.length,
      summary: {
        totalFiles: files.length,
        filesWithDuplicates: filesWithDuplicates.size,
        averageSimilarity,
        cloneTypeCounts,
      },
    };
  }

  findClones(threshold?: number): ClonePair[] {
    const simThreshold = threshold ?? this.options.similarityThreshold ?? 0.8;
    const clones: ClonePair[] = [];

    for (let i = 0; i < this.files.length; i++) {
      for (let j = i + 1; j < this.files.length; j++) {
        const pairs = this.compareFiles(this.files[i], this.files[j], simThreshold);
        clones.push(...pairs);
      }
    }

    return clones;
  }

  getDuplicationRate(): number {
    if (this.files.length === 0) return 0;
    const result = this.detect(this.files);
    return result.duplicationRate;
  }

  private compareFiles(file1: FileEntry, file2: FileEntry, threshold: number): ClonePair[] {
    const clones: ClonePair[] = [];
    const lines1 = this.normalizeLines(file1.content.split('\n'));
    const lines2 = this.normalizeLines(file2.content.split('\n'));

    const minLines = this.options.minLines ?? 3;

    for (let i = 0; i <= lines1.length - minLines; i++) {
      for (let j = 0; j <= lines2.length - minLines; j++) {
        const similarity = this.calculateSimilarity(lines1, i, lines2, j, minLines);
        if (similarity >= threshold) {
          const cloneType = this.classifyClone(lines1, i, lines2, j, minLines, similarity);
          clones.push({
            file1: file1.path,
            file2: file2.path,
            startLine1: i + 1,
            endLine1: i + minLines,
            startLine2: j + 1,
            endLine2: j + minLines,
            cloneType,
            similarity,
            duplicatedLines: lines1.slice(i, i + minLines),
          });
        }
      }
    }

    return clones;
  }

  private normalizeLines(lines: string[]): string[] {
    return lines.map(line => {
      let normalized = line.trim();
      // Remove comments
      normalized = normalized.replace(/\/\/.*$/, '');
      normalized = normalized.replace(/\/\*.*?\*\//g, '');
      if (this.options.ignoreWhitespace) {
        normalized = normalized.replace(/\s+/g, ' ');
      }
      return normalized;
    });
  }

  private calculateSimilarity(
    lines1: string[], start1: number,
    lines2: string[], start2: number,
    length: number
  ): number {
    let matches = 0;
    for (let k = 0; k < length; k++) {
      if (start1 + k < lines1.length && start2 + k < lines2.length) {
        if (this.options.ignoreWhitespace) {
          if (lines1[start1 + k].replace(/\s+/g, '') === lines2[start2 + k].replace(/\s+/g, '')) {
            matches++;
          }
        } else {
          if (lines1[start1 + k] === lines2[start2 + k]) {
            matches++;
          }
        }
      }
    }
    return matches / length;
  }

  private classifyClone(
    lines1: string[], start1: number,
    lines2: string[], start2: number,
    length: number,
    similarity: number
  ): CloneType {
    if (similarity === 1) return 'type1';

    // Check structural similarity (type2) vs semantic (type3)
    const tokens1 = this.extractTokens(lines1, start1, length);
    const tokens2 = this.extractTokens(lines2, start2, length);

    let structuralMatches = 0;
    const minLen = Math.min(tokens1.length, tokens2.length);
    for (let i = 0; i < minLen; i++) {
      if (this.isStructurallySimilar(tokens1[i], tokens2[i])) {
        structuralMatches++;
      }
    }

    const structuralSimilarity = minLen > 0 ? structuralMatches / minLen : 0;
    return structuralSimilarity >= 0.8 ? 'type2' : 'type3';
  }

  private extractTokens(lines: string[], start: number, length: number): string[] {
    const tokens: string[] = [];
    for (let i = 0; i < length && start + i < lines.length; i++) {
      tokens.push(...lines[start + i].split(/[\s(),;{}[\]=<>+\-*/!&|?:]+/).filter(t => t.length > 0));
    }
    return tokens;
  }

  private isStructurallySimilar(token1: string, token2: string): boolean {
    // Same token
    if (token1 === token2) return true;
    // Both are identifiers (same pattern)
    const isIdent1 = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(token1);
    const isIdent2 = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(token2);
    if (isIdent1 && isIdent2) return true;
    // Both are literals
    const isLit1 = /^["'`].*["'`]$/.test(token1) || /^\d+$/.test(token1);
    const isLit2 = /^["'`].*["'`]$/.test(token2) || /^\d+$/.test(token2);
    if (isLit1 && isLit2) return true;
    return false;
  }
}
