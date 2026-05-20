/**
 * @module fix-scheduler
 * @description Schedule and prioritize fixes for optimal application order.
 * Manages fix queuing, batching, and safe vs. risky fix application.
 */

import type { CodeChange, Diagnostic, FixResult, FixOptions } from './fix-strategy.js';

/** Priority levels for fixes */
export type FixPriorityLevel = 'critical' | 'high' | 'medium' | 'low';

/** Category of a fix */
export type FixCategoryType =
  | 'syntax'
  | 'linting'
  | 'typing'
  | 'refactoring'
  | 'performance'
  | 'compatibility'
  | 'deprecation'
  | 'style';

/** A scheduled fix item */
export interface ScheduledFix {
  /** Unique ID for this fix */
  id: string;
  /** Human-readable description */
  description: string;
  /** Priority level */
  priority: FixPriorityLevel;
  /** Category of the fix */
  category: FixCategoryType;
  /** The fix function to execute */
  fixFn: (code: string, diagnostics: Diagnostic[]) => FixResult;
  /** Whether this fix is considered safe (high confidence) */
  safe: boolean;
  /** Estimated time to apply (ms) */
  estimatedTime: number;
  /** Timestamp when the fix was added */
  addedAt: number;
}

/** A fix plan describing the order and grouping of fixes */
export interface FixPlan {
  /** Planned fixes in order of application */
  fixes: ScheduledFix[];
  /** Grouped fixes by category */
  byCategory: Record<string, ScheduledFix[]>;
  /** Grouped fixes by priority */
  byPriority: Record<FixPriorityLevel, ScheduledFix[]>;
  /** Safe fixes that can be applied automatically */
  safeFixes: ScheduledFix[];
  /** Risky fixes that require approval */
  riskyFixes: ScheduledFix[];
  /** Total estimated time for all fixes */
  totalEstimatedTime: number;
}

/**
 * FixScheduler - Schedules and prioritizes code fixes.
 * Manages the order of fix application to maximize safety and efficiency.
 */
export class FixScheduler {
  private fixes: Map<string, ScheduledFix> = new Map();
  private nextId = 1;
  private maxConcurrency: number;
  private retryCount: number;

  /**
   * @param maxConcurrency - Maximum number of fixes that can run concurrently (default: 5)
   * @param retryCount - Number of times to retry failed fixes (default: 0)
   */
  constructor(maxConcurrency: number = 5, retryCount: number = 0) {
    this.maxConcurrency = maxConcurrency;
    this.retryCount = retryCount;
  }

  /**
   * Add a fix to the scheduler.
   * @param fix - The fix function to execute
   * @param priority - Priority level
   * @param category - Fix category
   * @param description - Human-readable description
   * @param safe - Whether the fix is safe to apply automatically
   * @returns The ID of the scheduled fix
   */
  addFix(
    fix: (code: string, diagnostics: Diagnostic[]) => FixResult,
    priority: FixPriorityLevel,
    category: FixCategoryType,
    description: string = '',
    safe: boolean = true,
  ): string {
    // Deduplication: check if same description+category+priority already exists
    // Only deduplicate when description is non-empty (to avoid false positives)
    if (description) {
      for (const existing of this.fixes.values()) {
        if (existing.description === description && existing.category === category && existing.priority === priority) {
          return existing.id;
        }
      }
    }

    const id = `fix-${this.nextId++}`;
    const scheduledFix: ScheduledFix = {
      id,
      description,
      priority,
      category,
      fixFn: fix,
      safe,
      estimatedTime: this.estimateFixTime([fix]),
      addedAt: Date.now(),
    };
    this.fixes.set(id, scheduledFix);
    return id;
  }

  /**
   * Schedule a batch of fixes at once.
   * @param fixes - Array of fix configurations
   * @returns Array of scheduled fix IDs
   */
  scheduleBatch(
    fixes: Array<{
      fix: (code: string, diagnostics: Diagnostic[]) => FixResult;
      priority: FixPriorityLevel;
      category: FixCategoryType;
      description?: string;
      safe?: boolean;
    }>,
  ): string[] {
    return fixes.map((f) =>
      this.addFix(f.fix, f.priority, f.category, f.description, f.safe),
    );
  }

  /**
   * Get a fix plan for the given code and diagnostics.
   * @param code - The source code
   * @param diagnostics - Array of diagnostics
   * @returns A FixPlan describing the optimal fix order
   */
  getFixPlan(code: string, diagnostics: Diagnostic[]): FixPlan {
    const allFixes = this.getAllFixes();

    // Sort by priority
    const priorityOrder: Record<FixPriorityLevel, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };

    const sortedFixes = [...allFixes].sort(
      (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
    );

    // Group by category
    const byCategory: Record<string, ScheduledFix[]> = {};
    for (const fix of sortedFixes) {
      if (!byCategory[fix.category]) byCategory[fix.category] = [];
      byCategory[fix.category].push(fix);
    }

    // Group by priority
    const byPriority: Record<FixPriorityLevel, ScheduledFix[]> = {
      critical: [],
      high: [],
      medium: [],
      low: [],
    };
    for (const fix of sortedFixes) {
      byPriority[fix.priority].push(fix);
    }

    // Separate safe and risky fixes
    const safeFixes = sortedFixes.filter((f) => f.safe);
    const riskyFixes = sortedFixes.filter((f) => !f.safe);

    const totalEstimatedTime = sortedFixes.reduce(
      (sum, f) => sum + f.estimatedTime,
      0,
    );

    return {
      fixes: sortedFixes,
      byCategory,
      byPriority,
      safeFixes,
      riskyFixes,
      totalEstimatedTime,
    };
  }

  /**
   * Estimate the time required to apply a set of fixes.
   * @param fixes - Array of fix functions
   * @returns Estimated time in milliseconds
   */
  estimateFixTime(
    fixes: Array<(code: string, diagnostics: Diagnostic[]) => FixResult>,
  ): number {
    // Base estimate: 10ms per fix
    return fixes.length * 10;
  }

  /**
   * Apply only safe fixes to the code.
   * @param code - The source code
   * @param diagnostics - Array of diagnostics
   * @returns FixResult with all safe fixes applied
   */
  applySafeFixes(code: string, diagnostics: Diagnostic[]): FixResult {
    const allChanges: CodeChange[] = [];
    let currentCode = code;
    let totalConfidence = 0;
    let fixCount = 0;

    const safeFixes = this.getAllFixes().filter((f) => f.safe);

    // Apply up to maxConcurrency fixes at a time
    const batchSize = this.maxConcurrency;
    for (let batchStart = 0; batchStart < safeFixes.length; batchStart += batchSize) {
      const batch = safeFixes.slice(batchStart, batchStart + batchSize);
      for (const scheduledFix of batch) {
        let applied = false;
        for (let attempt = 0; attempt <= this.retryCount; attempt++) {
          try {
            const result = scheduledFix.fixFn(currentCode, diagnostics);
            if (result.fixed) {
              currentCode = result.code;
              allChanges.push(...result.changes);
              totalConfidence += result.confidence;
              fixCount++;
              applied = true;
              break;
            }
          } catch {
            if (attempt === this.retryCount) {
              // All retries exhausted, skip this fix
            }
          }
        }
      }
    }

    return {
      fixed: fixCount > 0,
      code: currentCode,
      changes: allChanges,
      confidence: fixCount > 0 ? totalConfidence / fixCount : 1,
      strategyName: 'fix-scheduler',
    };
  }

  /**
   * Apply risky fixes to the code (requires explicit approval).
   * @param code - The source code
   * @param diagnostics - Array of diagnostics
   * @param approval - Whether the user has approved risky fixes
   * @returns FixResult with risky fixes applied (or not if not approved)
   */
  applyRiskyFixes(
    code: string,
    diagnostics: Diagnostic[],
    approval: boolean,
  ): FixResult {
    if (!approval) {
      return {
        fixed: false,
        code,
        changes: [],
        confidence: 1,
        strategyName: 'fix-scheduler',
        error: 'Risky fixes require explicit approval',
      };
    }

    const allChanges: CodeChange[] = [];
    let currentCode = code;
    let totalConfidence = 0;
    let fixCount = 0;

    const riskyFixes = this.getAllFixes().filter((f) => !f.safe);

    for (const scheduledFix of riskyFixes) {
      try {
        const result = scheduledFix.fixFn(currentCode, diagnostics);
        if (result.fixed) {
          currentCode = result.code;
          allChanges.push(...result.changes);
          totalConfidence += result.confidence;
          fixCount++;
        }
      } catch {
        // Skip failed risky fixes silently
      }
    }

    return {
      fixed: fixCount > 0,
      code: currentCode,
      changes: allChanges,
      confidence: fixCount > 0 ? totalConfidence / fixCount : 1,
      strategyName: 'fix-scheduler',
    };
  }

  /**
   * Get all scheduled fixes sorted by priority.
   * @returns Array of all scheduled fixes
   */
  getAllFixes(): ScheduledFix[] {
    const priorityOrder: Record<FixPriorityLevel, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    return Array.from(this.fixes.values()).sort(
      (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
    );
  }

  /**
   * Remove a fix by ID.
   * @param id - The fix ID to remove
   * @returns True if the fix was found and removed
   */
  removeFix(id: string): boolean {
    return this.fixes.delete(id);
  }

  /**
   * Clear all scheduled fixes.
   */
  clear(): void {
    this.fixes.clear();
  }

  /**
   * Get the number of scheduled fixes.
   * @returns The count of scheduled fixes
   */
  get size(): number {
    return this.fixes.size;
  }
}
