/**
 * @module deprecation-fix
 * @description Fix deprecated API usage by detecting, suggesting, and applying replacements.
 * Helps migrate code away from deprecated APIs to modern alternatives.
 */

import type { CodeChange, FixResult } from './fix-strategy.js';

/** Maps deprecated API patterns to their replacements */
export type DeprecationMap = Record<string, DeprecationInfo>;

/** Information about a deprecated API */
export interface DeprecationInfo {
  /** Description of the deprecation */
  description: string;
  /** Suggested replacement(s) */
  alternatives: string[];
  /** The replacement pattern (supports $1, $2 for capture groups) */
  replacement?: string;
  /** Whether this deprecation is a breaking change */
  breaking?: boolean;
  /** Version in which the API was deprecated */
  deprecatedIn?: string;
  /** Version in which the API will be removed */
  removalIn?: string;
}

/** A detected deprecation usage */
export interface DeprecationUsage {
  /** The deprecated pattern that was found */
  pattern: string;
  /** Line number where it was found */
  line: number;
  /** Column number where it was found */
  column: number;
  /** The full line of code containing the usage */
  lineContent: string;
  /** Deprecation info for this usage */
  info: DeprecationInfo;
}

/** A migration plan step */
export interface MigrationStep {
  /** Description of the migration step */
  description: string;
  /** The deprecated pattern */
  from: string;
  /** The replacement pattern */
  to: string;
  /** Number of occurrences */
  occurrences: number;
  /** Whether this is a breaking change */
  breaking: boolean;
}

/**
 * DeprecationFix - Detects and fixes deprecated API usage.
 * Supports pattern-based detection and automated migration.
 */
export class DeprecationFix {
  /**
   * Detect deprecated API usage in the given code.
   * @param code - The source code to scan
   * @param deprecationMap - Map of deprecated patterns to their info
   * @returns Array of detected deprecation usages
   */
  detectDeprecatedUsage(code: string, deprecationMap: DeprecationMap): DeprecationUsage[] {
    const usages: DeprecationUsage[] = [];
    const lines = code.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const [pattern, info] of Object.entries(deprecationMap)) {
        // Try as a simple string match first
        const colIndex = line.indexOf(pattern);
        if (colIndex !== -1) {
          usages.push({
            pattern,
            line: i + 1,
            column: colIndex + 1,
            lineContent: line,
            info,
          });
        }
      }
    }

    return usages;
  }

  /**
   * Suggest replacements for a deprecated API.
   * @param deprecated - The deprecated API identifier
   * @param alternatives - Array of alternative APIs
   * @returns Array of suggestion strings
   */
  suggestReplacement(deprecated: string, alternatives: string[]): string[] {
    if (alternatives.length === 0) {
      return [`No direct replacement found for '${deprecated}'. Consider refactoring.`];
    }

    return alternatives.map((alt) => {
      return `Replace '${deprecated}' with '${alt}'`;
    });
  }

  /**
   * Apply deprecation fixes to the code based on the deprecation map.
   * @param code - The source code
   * @param deprecationMap - Map of deprecated patterns to their info
   * @returns FixResult with deprecated APIs replaced
   */
  applyDeprecationFixes(code: string, deprecationMap: DeprecationMap): FixResult {
    const changes: CodeChange[] = [];
    let currentCode = code;

    for (const [pattern, info] of Object.entries(deprecationMap)) {
      if (!info.replacement) continue;

      if (currentCode.includes(pattern)) {
        const original = currentCode;
        currentCode = currentCode.split(pattern).join(info.replacement);

        if (currentCode !== original) {
          const lines = original.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(pattern)) {
              changes.push({
                description: `Fixed deprecated API: ${info.description}`,
                original: pattern,
                replacement: info.replacement,
                line: i + 1,
                column: lines[i].indexOf(pattern) + 1,
              });
            }
          }
        }
      }
    }

    return {
      fixed: changes.length > 0,
      code: currentCode,
      changes,
      confidence: 0.85,
      strategyName: 'deprecation-fix',
    };
  }

  /**
   * Generate a migration plan for transitioning away from deprecated APIs.
   * @param code - The source code
   * @param deprecationMap - Map of deprecated patterns to their info
   * @returns Array of migration steps
   */
  generateMigrationPlan(code: string, deprecationMap: DeprecationMap): MigrationStep[] {
    const steps: MigrationStep[] = [];

    for (const [pattern, info] of Object.entries(deprecationMap)) {
      // Count occurrences
      const occurrences = code.split(pattern).length - 1;
      if (occurrences === 0) continue;

      steps.push({
        description: info.description,
        from: pattern,
        to: info.replacement || info.alternatives[0] || '<manual migration required>',
        occurrences,
        breaking: info.breaking ?? false,
      });
    }

    // Sort by number of occurrences (most used first)
    steps.sort((a, b) => b.occurrences - a.occurrences);

    return steps;
  }
}
