/**
 * Clone Detector Module
 *
 * Detect code clones and duplications using Type 1, Type 2, and Type 3
 * clone detection algorithms.
 */

/** A detected code clone */
export interface CodeClone {
  type: "type1" | "type2" | "type3";
  fragments: CloneFragment[];
  similarity: number;
  linesMatched: number;
  totalLines: number;
}

/** A fragment of cloned code */
export interface CloneFragment {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
}

/** Clone detection metrics */
export interface CloneMetrics {
  totalClones: number;
  type1Count: number;
  type2Count: number;
  type3Count: number;
  duplicationPercentage: number;
  largestClone: number;
  averageCloneSize: number;
  cloneDensity: number;
}

/** Refactoring suggestion */
export interface RefactoringSuggestion {
  type: string;
  description: string;
  fragments: CloneFragment[];
  suggestedLocation: string;
  estimatedSavings: number;
  priority: "high" | "medium" | "low";
}

/** A file for clone detection */
export interface CloneFile {
  filePath: string;
  content: string;
  lines: string[];
}

/**
 * CloneDetector - Detect code clones and duplications.
 */
export class CloneDetector {
  private minCloneLines = 6;
  private type3Threshold = 0.7;

  /**
   * Detect Type 1 clones (exact duplicates, ignoring whitespace and comments).
   * @param files - Array of files to analyze
   * @returns Array of Type 1 clones
   */
  detectType1Clones(files: CloneFile[]): CodeClone[] {
    const clones: CodeClone[] = [];

    for (let i = 0; i < files.length; i++) {
      for (let j = i; j < files.length; j++) {
        const fileA = files[i];
        const fileB = files[j];

        const normalizedA = this.normalizeLines(fileA.lines);
        const normalizedB = this.normalizeLines(fileB.lines);

        const sameFile = fileA.filePath === fileB.filePath;

        // Find matching blocks
        const matches = this.findExactMatches(normalizedA, normalizedB, sameFile);

        for (const match of matches) {
          if (match.linesA.length >= this.minCloneLines) {
            clones.push({
              type: "type1",
              fragments: [
                {
                  filePath: fileA.filePath,
                  startLine: match.startA,
                  endLine: match.startA + match.linesA.length - 1,
                  content: match.linesA.join("\n"),
                },
                {
                  filePath: fileB.filePath,
                  startLine: match.startB,
                  endLine: match.startB + match.linesB.length - 1,
                  content: match.linesB.join("\n"),
                },
              ],
              similarity: 1.0,
              linesMatched: match.linesA.length,
              totalLines: Math.max(match.linesA.length, match.linesB.length),
            });
          }
        }
      }
    }

    return clones;
  }

  /**
   * Detect Type 2 clones (structural clones with renamed identifiers).
   * @param files - Array of files to analyze
   * @returns Array of Type 2 clones
   */
  detectType2Clones(files: CloneFile[]): CodeClone[] {
    const clones: CodeClone[] = [];

    for (let i = 0; i < files.length; i++) {
      for (let j = i; j < files.length; j++) {
        const fileA = files[i];
        const fileB = files[j];

        const sameFile = fileA.filePath === fileB.filePath;

        // Extract structural patterns
        const patternsA = this.extractStructuralPatterns(fileA.lines);
        const patternsB = this.extractStructuralPatterns(fileB.lines);

        // Find structurally similar blocks
        const matches = this.findStructuralMatches(patternsA, patternsB, sameFile);

        for (const match of matches) {
          if (match.patternA.length >= this.minCloneLines) {
            const similarity = this.calculatePatternSimilarity(match.patternA, match.patternB);

            clones.push({
              type: "type2",
              fragments: [
                {
                  filePath: fileA.filePath,
                  startLine: match.startA,
                  endLine: match.startA + match.patternA.length - 1,
                  content: fileA.lines.slice(match.startA - 1, match.startA - 1 + match.patternA.length).join("\n"),
                },
                {
                  filePath: fileB.filePath,
                  startLine: match.startB,
                  endLine: match.startB + match.patternB.length - 1,
                  content: fileB.lines.slice(match.startB - 1, match.startB - 1 + match.patternB.length).join("\n"),
                },
              ],
              similarity,
              linesMatched: match.patternA.length,
              totalLines: Math.max(match.patternA.length, match.patternB.length),
            });
          }
        }
      }
    }

    return clones;
  }

  /**
   * Detect Type 3 clones (clones with additions, deletions, or modifications).
   * @param files - Array of files to analyze
   * @returns Array of Type 3 clones
   */
  detectType3Clones(files: CloneFile[]): CodeClone[] {
    const clones: CodeClone[] = [];

    for (let i = 0; i < files.length; i++) {
      for (let j = i; j < files.length; j++) {
        const fileA = files[i];
        const fileB = files[j];

        const sameFile = fileA.filePath === fileB.filePath;

        // Use sliding window comparison with fuzzy matching
        const matches = this.findFuzzyMatches(fileA.lines, fileB.lines, sameFile);

        for (const match of matches) {
          if (match.similarity >= this.type3Threshold && match.linesA.length >= this.minCloneLines) {
            clones.push({
              type: "type3",
              fragments: [
                {
                  filePath: fileA.filePath,
                  startLine: match.startA,
                  endLine: match.startA + match.linesA.length - 1,
                  content: match.linesA.join("\n"),
                },
                {
                  filePath: fileB.filePath,
                  startLine: match.startB,
                  endLine: match.startB + match.linesB.length - 1,
                  content: match.linesB.join("\n"),
                },
              ],
              similarity: match.similarity,
              linesMatched: Math.min(match.linesA.length, match.linesB.length),
              totalLines: Math.max(match.linesA.length, match.linesB.length),
            });
          }
        }
      }
    }

    return clones;
  }

  /**
   * Get comprehensive clone metrics for a set of files.
   * @param files - Array of files to analyze
   * @returns Clone metrics
   */
  getCloneMetrics(files: CloneFile[]): CloneMetrics {
    const type1 = this.detectType1Clones(files);
    const type2 = this.detectType2Clones(files);
    const type3 = this.detectType3Clones(files);

    const allClones = [...type1, ...type2, ...type3];
    const totalLines = files.reduce((sum, f) => sum + f.lines.length, 0);
    const duplicatedLines = allClones.reduce((sum, c) => sum + c.linesMatched, 0);

    const largestClone = allClones.length > 0
      ? Math.max(...allClones.map((c) => c.totalLines))
      : 0;

    const averageCloneSize = allClones.length > 0
      ? allClones.reduce((sum, c) => sum + c.totalLines, 0) / allClones.length
      : 0;

    return {
      totalClones: allClones.length,
      type1Count: type1.length,
      type2Count: type2.length,
      type3Count: type3.length,
      duplicationPercentage: totalLines > 0 ? (duplicatedLines / totalLines) * 100 : 0,
      largestClone,
      averageCloneSize,
      cloneDensity: totalLines > 0 ? allClones.length / (totalLines / 100) : 0,
    };
  }

  /**
   * Suggest refactoring opportunities based on detected clones.
   * @param clones - Array of detected clones
   * @returns Array of refactoring suggestions
   */
  suggestRefactoring(clones: CodeClone[]): RefactoringSuggestion[] {
    const suggestions: RefactoringSuggestion[] = [];

    // Group clones by similarity
    const grouped = new Map<string, CodeClone[]>();
    for (const clone of clones) {
      const key = clone.fragments.map((f) => f.content.substring(0, 50)).join("|");
      const existing = grouped.get(key) ?? [];
      existing.push(clone);
      grouped.set(key, existing);
    }

    for (const [, groupClones] of grouped) {
      if (groupClones.length >= 2 || (groupClones[0]?.fragments.length ?? 0) >= 2) {
        const clone = groupClones[0];
        if (!clone) continue;

        const allFragments = groupClones.flatMap((c) => c.fragments);
        const totalLines = allFragments.reduce((sum, f) => sum + (f.endLine - f.startLine + 1), 0);

        let priority: RefactoringSuggestion["priority"];
        if (totalLines > 30) priority = "high";
        else if (totalLines > 15) priority = "medium";
        else priority = "low";

        suggestions.push({
          type: clone.type === "type1" ? "Extract Method" : "Extract and Parameterize",
          description: `Found ${allFragments.length} similar code fragments (${clone.type} clone)`,
          fragments: allFragments,
          suggestedLocation: "shared/utils.ts",
          estimatedSavings: totalLines - Math.ceil(totalLines / allFragments.length) - 5,
          priority,
        });
      }
    }

    // Sort by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return suggestions;
  }

  // --- Private helpers ---

  private normalizeLines(lines: string[]): string[] {
    return lines.map((line) => {
      // Remove comments
      let normalized = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
      // Normalize whitespace
      normalized = normalized.trim().replace(/\s+/g, " ");
      return normalized;
    });
  }

  private findExactMatches(
    linesA: string[],
    linesB: string[],
    sameFile: boolean
  ): Array<{ startA: number; startB: number; linesA: string[]; linesB: string[] }> {
    const matches: Array<{ startA: number; startB: number; linesA: string[]; linesB: string[] }> = [];

    for (let i = 0; i < linesA.length; i++) {
      for (let j = sameFile ? i + 1 : 0; j < linesB.length; j++) {
        if (linesA[i] === linesB[j] && linesA[i].length > 0) {
          // Extend the match
          let k = 0;
          while (
            i + k < linesA.length &&
            j + k < linesB.length &&
            linesA[i + k] === linesB[j + k] &&
            linesA[i + k].length > 0
          ) {
            k++;
          }

          if (k >= this.minCloneLines) {
            matches.push({
              startA: i + 1,
              startB: j + 1,
              linesA: linesA.slice(i, i + k),
              linesB: linesB.slice(j, j + k),
            });
          }
        }
      }
    }

    return matches;
  }

  private extractStructuralPatterns(lines: string[]): string[] {
    return lines.map((line) => {
      // Replace identifiers with placeholders
      let pattern = line
        .replace(/\b[a-zA-Z_]\w*\b/g, "ID")
        .replace(/\b\d+\b/g, "NUM")
        .replace(/"[^"]*"/g, "STR")
        .replace(/'[^']*'/g, "STR")
        .trim();
      return pattern;
    });
  }

  private findStructuralMatches(
    patternsA: string[],
    patternsB: string[],
    sameFile: boolean
  ): Array<{ startA: number; startB: number; patternA: string[]; patternB: string[] }> {
    const matches: Array<{ startA: number; startB: number; patternA: string[]; patternB: string[] }> = [];

    for (let i = 0; i < patternsA.length; i++) {
      for (let j = sameFile ? i + 1 : 0; j < patternsB.length; j++) {
        if (patternsA[i] === patternsB[j] && patternsA[i].length > 0) {
          let k = 0;
          while (
            i + k < patternsA.length &&
            j + k < patternsB.length &&
            patternsA[i + k] === patternsB[j + k] &&
            patternsA[i + k].length > 0
          ) {
            k++;
          }

          if (k >= this.minCloneLines) {
            matches.push({
              startA: i + 1,
              startB: j + 1,
              patternA: patternsA.slice(i, i + k),
              patternB: patternsB.slice(j, j + k),
            });
          }
        }
      }
    }

    return matches;
  }

  private calculatePatternSimilarity(patternA: string[], patternB: string[]): number {
    if (patternA.length !== patternB.length) return 0;
    if (patternA.length === 0) return 1;

    let matches = 0;
    for (let i = 0; i < patternA.length; i++) {
      if (patternA[i] === patternB[i]) matches++;
    }

    return matches / patternA.length;
  }

  private findFuzzyMatches(
    linesA: string[],
    linesB: string[],
    sameFile: boolean
  ): Array<{ startA: number; startB: number; linesA: string[]; linesB: string[]; similarity: number }> {
    const matches: Array<{ startA: number; startB: number; linesA: string[]; linesB: string[]; similarity: number }> = [];
    const windowSize = this.minCloneLines;

    for (let i = 0; i <= linesA.length - windowSize; i++) {
      const windowA = linesA.slice(i, i + windowSize);

      for (let j = sameFile ? i + windowSize : 0; j <= linesB.length - windowSize; j++) {
        const windowB = linesB.slice(j, j + windowSize);
        const similarity = this.calculateLineSimilarity(windowA, windowB);

        if (similarity >= this.type3Threshold) {
          // Extend the match
          let endA = i + windowSize;
          let endB = j + windowSize;

          while (endA < linesA.length && endB < linesB.length) {
            const sim = this.calculateStringSimilarity(linesA[endA], linesB[endB]);
            if (sim < 0.5) break;
            endA++;
            endB++;
          }

          const extendedA = linesA.slice(i, endA);
          const extendedB = linesB.slice(j, endB);
          const extendedSimilarity = this.calculateLineSimilarity(extendedA, extendedB);

          if (extendedSimilarity >= this.type3Threshold) {
            matches.push({
              startA: i + 1,
              startB: j + 1,
              linesA: extendedA,
              linesB: extendedB,
              similarity: extendedSimilarity,
            });
          }
        }
      }
    }

    return matches;
  }

  private calculateLineSimilarity(linesA: string[], linesB: string[]): number {
    if (linesA.length !== linesB.length) {
      const minLen = Math.min(linesA.length, linesB.length);
      const maxLen = Math.max(linesA.length, linesB.length);
      let matches = 0;
      for (let i = 0; i < minLen; i++) {
        if (this.calculateStringSimilarity(linesA[i], linesB[i]) > 0.5) {
          matches++;
        }
      }
      return (matches / maxLen) * (minLen / maxLen);
    }

    if (linesA.length === 0) return 1;

    let totalSimilarity = 0;
    for (let i = 0; i < linesA.length; i++) {
      totalSimilarity += this.calculateStringSimilarity(linesA[i], linesB[i]);
    }

    return totalSimilarity / linesA.length;
  }

  private calculateStringSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length === 0 || b.length === 0) return 0;

    // Normalized Levenshtein similarity
    const normalizedA = a.trim().toLowerCase();
    const normalizedB = b.trim().toLowerCase();
    const maxLen = Math.max(normalizedA.length, normalizedB.length);
    if (maxLen === 0) return 1;

    const distance = this.levenshteinDistance(normalizedA, normalizedB);
    return 1 - distance / maxLen;
  }

  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= a.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= b.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    return matrix[a.length][b.length];
  }
}
