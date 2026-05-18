/**
 * @module fix-history
 * @description Track fix history and learn from patterns.
 * Records applied fixes, analyzes patterns, and suggests preventive measures.
 */

import type { FixResult } from './fix-strategy.js';

/** A recorded fix entry in the history */
export interface FixRecord {
  /** Unique ID for this record */
  id: string;
  /** Timestamp when the fix was applied */
  timestamp: number;
  /** The strategy that produced the fix */
  strategyName: string;
  /** File path that was fixed */
  filePath: string;
  /** Description of the fix */
  description: string;
  /** Number of changes applied */
  changeCount: number;
  /** Confidence score of the fix */
  confidence: number;
  /** Whether the fix was validated */
  validated: boolean;
  /** Whether the fix was later reverted */
  reverted: boolean;
  /** Categories of the fix */
  categories: string[];
}

/** Statistics about fix history */
export interface FixStats {
  /** Total number of fixes applied */
  totalFixes: number;
  /** Number of fixes by strategy */
  byStrategy: Record<string, number>;
  /** Number of fixes by category */
  byCategory: Record<string, number>;
  /** Average confidence score */
  averageConfidence: number;
  /** Number of reverted fixes */
  revertedCount: number;
  /** Most common fix patterns */
  topPatterns: Array<{ pattern: string; count: number }>;
  /** Time range of the history */
  timeRange: { first: number; last: number };
}

/** A frequent fix pattern */
export interface FrequentFix {
  /** The pattern description */
  pattern: string;
  /** How often this pattern occurs */
  count: number;
  /** Strategies that handle this pattern */
  strategies: string[];
  /** Suggested preventive action */
  prevention: string;
}

/** A preventive fix suggestion */
export interface PreventiveSuggestion {
  /** Description of the suggestion */
  description: string;
  /** Category of the suggestion */
  category: string;
  /** Priority of the suggestion */
  priority: 'high' | 'medium' | 'low';
  /** Estimated impact */
  impact: string;
}

/** Export format for history data */
export type HistoryFormat = 'json' | 'csv';

/**
 * FixHistory - Tracks fix history and learns from patterns.
 * Provides analytics, pattern detection, and preventive suggestions.
 */
export class FixHistory {
  private records: FixRecord[] = [];
  private nextId = 1;

  /**
   * Record a fix in the history.
   * @param fixResult - The result of the applied fix
   * @param filePath - Path of the file that was fixed
   * @param categories - Categories of the fix
   * @returns The ID of the recorded fix
   */
  recordFix(
    fixResult: FixResult,
    filePath: string = '',
    categories: string[] = [],
  ): string {
    const id = `record-${this.nextId++}`;
    const record: FixRecord = {
      id,
      timestamp: Date.now(),
      strategyName: fixResult.strategyName,
      filePath,
      description: fixResult.changes
        .map((c) => c.description)
        .join('; ') || 'No changes',
      changeCount: fixResult.changes.length,
      confidence: fixResult.confidence,
      validated: fixResult.fixed,
      reverted: false,
      categories,
    };
    this.records.push(record);
    return id;
  }

  /**
   * Get statistics about the fix history.
   * @returns FixStats with aggregated statistics
   */
  getFixStats(): FixStats {
    if (this.records.length === 0) {
      return {
        totalFixes: 0,
        byStrategy: {},
        byCategory: {},
        averageConfidence: 0,
        revertedCount: 0,
        topPatterns: [],
        timeRange: { first: 0, last: 0 },
      };
    }

    const byStrategy: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    let totalConfidence = 0;
    let revertedCount = 0;

    for (const record of this.records) {
      byStrategy[record.strategyName] =
        (byStrategy[record.strategyName] || 0) + 1;

      for (const cat of record.categories) {
        byCategory[cat] = (byCategory[cat] || 0) + 1;
      }

      totalConfidence += record.confidence;
      if (record.reverted) revertedCount++;
    }

    // Find top patterns
    const patternCounts: Record<string, number> = {};
    for (const record of this.records) {
      const desc = record.description.split(';')[0].trim();
      if (desc) {
        patternCounts[desc] = (patternCounts[desc] || 0) + 1;
      }
    }

    const topPatterns = Object.entries(patternCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([pattern, count]) => ({ pattern, count }));

    const timestamps = this.records.map((r) => r.timestamp);

    return {
      totalFixes: this.records.length,
      byStrategy,
      byCategory,
      averageConfidence: totalConfidence / this.records.length,
      revertedCount,
      topPatterns,
      timeRange: {
        first: Math.min(...timestamps),
        last: Math.max(...timestamps),
      },
    };
  }

  /**
   * Get the most frequent fix patterns.
   * @param limit - Maximum number of patterns to return
   * @returns Array of frequent fix patterns
   */
  getFrequentFixes(limit: number = 10): FrequentFix[] {
    const patternMap: Record<string, { count: number; strategies: Set<string> }> = {};

    for (const record of this.records) {
      const desc = record.description.split(';')[0].trim();
      if (!desc) continue;

      if (!patternMap[desc]) {
        patternMap[desc] = { count: 0, strategies: new Set() };
      }
      patternMap[desc].count++;
      patternMap[desc].strategies.add(record.strategyName);
    }

    return Object.entries(patternMap)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, limit)
      .map(([pattern, data]) => ({
        pattern,
        count: data.count,
        strategies: Array.from(data.strategies),
        prevention: this.generatePrevention(pattern),
      }));
  }

  /**
   * Learn from history to improve future fixes.
   * Analyzes patterns and returns insights.
   * @param history - Optional external history data to merge
   * @returns Array of learned insights
   */
  learnFromHistory(history?: FixRecord[]): string[] {
    const allRecords = history
      ? [...this.records, ...history]
      : this.records;

    if (allRecords.length === 0) return [];

    const insights: string[] = [];

    // Analyze revert rate
    const revertedCount = allRecords.filter((r) => r.reverted).length;
    const revertRate = revertedCount / allRecords.length;
    if (revertRate > 0.1) {
      insights.push(
        `High revert rate detected (${(revertRate * 100).toFixed(1)}%). Consider improving fix confidence thresholds.`,
      );
    }

    // Analyze strategy effectiveness
    const strategyConfidence: Record<string, number[]> = {};
    for (const record of allRecords) {
      if (!strategyConfidence[record.strategyName]) {
        strategyConfidence[record.strategyName] = [];
      }
      strategyConfidence[record.strategyName].push(record.confidence);
    }

    for (const [strategy, confidences] of Object.entries(strategyConfidence)) {
      const avg = confidences.reduce((a, b) => a + b, 0) / confidences.length;
      if (avg < 0.7) {
        insights.push(
          `Strategy '${strategy}' has low average confidence (${avg.toFixed(2)}). Consider improving its logic.`,
        );
      }
    }

    // Analyze category frequency
    const categoryCounts: Record<string, number> = {};
    for (const record of allRecords) {
      for (const cat of record.categories) {
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
      }
    }

    const topCategory = Object.entries(categoryCounts).sort(
      (a, b) => b[1] - a[1],
    )[0];
    if (topCategory) {
      insights.push(
        `Most common fix category: '${topCategory[0]}' with ${topCategory[1]} fixes. Consider adding linting rules to prevent these.`,
      );
    }

    if (insights.length === 0) {
      insights.push('Fix history looks healthy. No major issues detected.');
    }

    return insights;
  }

  /**
   * Suggest preventive fixes based on the code and history patterns.
   * @param code - The source code to analyze
   * @returns Array of preventive suggestions
   */
  suggestPreventiveFixes(code: string): PreventiveSuggestion[] {
    const suggestions: PreventiveSuggestion[] = [];

    // Analyze code for common patterns that lead to fixes
    const lines = code.split('\n');

    // Check for missing semicolons pattern
    const statementLines = lines.filter(
      (l) =>
        l.trim() !== '' &&
        !l.trim().startsWith('//') &&
        !l.trim().endsWith(';') &&
        !l.trim().endsWith('{') &&
        !l.trim().endsWith('}') &&
        !l.trim().endsWith(',') &&
        /^[a-zA-Z_$]/.test(l.trim()),
    );
    if (statementLines.length > 0) {
      suggestions.push({
        description: `Found ${statementLines.length} lines that may need semicolons`,
        category: 'style',
        priority: 'low',
        impact: 'Low - cosmetic improvement',
      });
    }

    // Check for 'any' type usage
    const anyTypeLines = lines.filter((l) => /\b:\s*any\b/.test(l));
    if (anyTypeLines.length > 0) {
      suggestions.push({
        description: `Found ${anyTypeLines.length} 'any' type annotations that should be replaced with specific types`,
        category: 'typing',
        priority: 'medium',
        impact: 'Medium - improves type safety',
      });
    }

    // Check for console.log statements
    const consoleLines = lines.filter((l) => /console\.(log|debug|info)\s*\(/.test(l));
    if (consoleLines.length > 0) {
      suggestions.push({
        description: `Found ${consoleLines.length} console logging statements that may need removal for production`,
        category: 'style',
        priority: 'low',
        impact: 'Low - code hygiene',
      });
    }

    // Check for var usage
    const varLines = lines.filter((l) => /\bvar\s+/.test(l));
    if (varLines.length > 0) {
      suggestions.push({
        description: `Found ${varLines.length} 'var' declarations that should be converted to 'const' or 'let'`,
        category: 'style',
        priority: 'medium',
        impact: 'Medium - improves code quality',
      });
    }

    // Check for TODO/FIXME comments
    const todoLines = lines.filter(
      (l) => /\/\/\s*(TODO|FIXME|HACK|XXX)/i.test(l),
    );
    if (todoLines.length > 0) {
      suggestions.push({
        description: `Found ${todoLines.length} TODO/FIXME comments that may need attention`,
        category: 'maintenance',
        priority: 'low',
        impact: 'Low - code maintenance',
      });
    }

    // Cross-reference with history
    if (this.records.length > 0) {
      const stats = this.getFixStats();
      if (stats.averageConfidence < 0.75) {
        suggestions.push({
          description: 'Historical fix confidence is below optimal. Consider reviewing fix strategies.',
          category: 'process',
          priority: 'medium',
          impact: 'Medium - improves fix reliability',
        });
      }
    }

    return suggestions.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  /**
   * Export fix history in the specified format.
   * @param format - The export format ('json' or 'csv')
   * @returns The exported history as a string
   */
  exportHistory(format: HistoryFormat): string {
    if (format === 'json') {
      return JSON.stringify(this.records, null, 2);
    }

    if (format === 'csv') {
      const headers = [
        'id',
        'timestamp',
        'strategyName',
        'filePath',
        'description',
        'changeCount',
        'confidence',
        'validated',
        'reverted',
        'categories',
      ];
      const rows = this.records.map((r) =>
        [
          r.id,
          r.timestamp,
          r.strategyName,
          r.filePath,
          `"${r.description.replace(/"/g, '""')}"`,
          r.changeCount,
          r.confidence,
          r.validated,
          r.reverted,
          `"${r.categories.join(';')}"`,
        ].join(','),
      );
      return [headers.join(','), ...rows].join('\n');
    }

    throw new Error(`Unsupported export format: ${format}`);
  }

  /**
   * Import fix history from external data.
   * @param data - The history data to import
   * @param format - The format of the data ('json' or 'csv')
   * @returns The number of records imported
   */
  importHistory(data: string, format: HistoryFormat): number {
    if (format === 'json') {
      try {
        const parsed = JSON.parse(data) as FixRecord[];
        if (!Array.isArray(parsed)) throw new Error('Expected an array');
        for (const record of parsed) {
          this.records.push({
            ...record,
            id: record.id || `import-${this.nextId++}`,
          });
          if (record.id && record.id.startsWith('import-')) {
            this.nextId++;
          }
        }
        return parsed.length;
      } catch (e) {
        throw new Error(`Failed to parse JSON history: ${(e as Error).message}`);
      }
    }

    if (format === 'csv') {
      const lines = data.split('\n').filter((l) => l.trim() !== '');
      if (lines.length < 2) return 0; // Only header or empty

      // Skip header
      let imported = 0;
      for (let i = 1; i < lines.length; i++) {
        const values = this.parseCSVLine(lines[i]);
        if (values.length < 10) continue;

        this.records.push({
          id: values[0] || `import-${this.nextId++}`,
          timestamp: parseInt(values[1], 10) || Date.now(),
          strategyName: values[2],
          filePath: values[3],
          description: values[4],
          changeCount: parseInt(values[5], 10) || 0,
          confidence: parseFloat(values[6]) || 0,
          validated: values[7] === 'true',
          reverted: values[8] === 'true',
          categories: values[9].split(';').filter(Boolean),
        });
        imported++;
      }

      return imported;
    }

    throw new Error(`Unsupported import format: ${format}`);
  }

  /**
   * Get all records in the history.
   * @returns Array of all fix records
   */
  getRecords(): FixRecord[] {
    return [...this.records];
  }

  /**
   * Clear all history records.
   */
  clear(): void {
    this.records = [];
  }

  /**
   * Get the number of records in the history.
   * @returns The count of records
   */
  get size(): number {
    return this.records.length;
  }

  /**
   * Generate a prevention suggestion for a fix pattern.
   * @param pattern - The fix pattern description
   * @returns A prevention suggestion string
   */
  private generatePrevention(pattern: string): string {
    const lower = pattern.toLowerCase();

    if (lower.includes('semicolon')) return 'Add a semicolon linter rule (e.g., @typescript-eslint/semi)';
    if (lower.includes('import')) return 'Use auto-import features in your editor';
    if (lower.includes('unused')) return 'Configure unused variable detection in your linter';
    if (lower.includes('type')) return 'Enable strict TypeScript mode and use type inference';
    if (lower.includes('quote')) return 'Add a quote style rule to your linter configuration';
    if (lower.includes('indent')) return 'Configure an editor formatter (e.g., Prettier)';
    if (lower.includes('trailing comma')) return 'Add trailing comma rule to your linter';
    if (lower.includes('deprecated')) return 'Update dependencies and review changelogs regularly';
    if (lower.includes('performance')) return 'Add performance linting rules and use profiling tools';

    return 'Review and add appropriate linting rules to prevent this pattern';
  }

  /**
   * Parse a CSV line handling quoted fields.
   * @param line - The CSV line to parse
   * @returns Array of field values
   */
  private parseCSVLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (inQuotes) {
        if (char === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          current += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ',') {
          values.push(current);
          current = '';
        } else {
          current += char;
        }
      }
    }

    values.push(current);
    return values;
  }
}
