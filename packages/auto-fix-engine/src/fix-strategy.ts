/**
 * @module fix-strategy
 * @description Base strategy interface and registry for the auto-fix engine.
 * Provides the foundational abstractions that all fix strategies build upon.
 */

/** Represents a single code change within a fix result */
export interface CodeChange {
  /** Description of what was changed */
  description: string;
  /** The original text that was replaced */
  original: string;
  /** The replacement text */
  replacement: string;
  /** Line number where the change was applied (1-based) */
  line: number;
  /** Column number where the change started (1-based) */
  column: number;
}

/** Context provided to a fix strategy when executing a fix */
export interface FixContext {
  /** Path to the file being fixed */
  filePath: string;
  /** The source code content */
  code: string;
  /** Diagnostic messages (errors, warnings) from linters/type checkers */
  diagnostics: Diagnostic[];
  /** Optional configuration options */
  options: FixOptions;
}

/** Represents a diagnostic message from a linter or type checker */
export interface Diagnostic {
  /** Error message text */
  message: string;
  /** Rule ID or error code */
  code: string;
  /** Severity level */
  severity: 'error' | 'warning' | 'info' | 'suggestion';
  /** 1-based line number */
  line: number;
  /** 1-based column number */
  column: number;
  /** End line (optional) */
  endLine?: number;
  /** End column (optional) */
  endColumn?: number;
  /** Additional data attached to the diagnostic */
  data?: Record<string, unknown>;
}

/** Options that control fix behavior */
export interface FixOptions {
  /** Whether to apply fixes automatically without confirmation */
  autoApply?: boolean;
  /** Maximum number of fixes to apply in a single pass */
  maxFixes?: number;
  /** Whether to format the code after fixing */
  formatAfterFix?: boolean;
  /** Dry run mode - compute fixes but don't apply them */
  dryRun?: boolean;
  /** Custom configuration key-value pairs */
  config?: Record<string, unknown>;
  /** Strategy selection mode: 'all', 'safe-only', 'high-confidence' */
  strategySelection?: 'all' | 'safe-only' | 'high-confidence';
  /** Minimum confidence threshold for strategy selection (0-1) */
  minConfidence?: number;
}

/** Result of applying a fix strategy */
export interface FixResult {
  /** Whether any changes were made */
  fixed: boolean;
  /** The resulting code after fixes */
  code: string;
  /** List of individual changes applied */
  changes: CodeChange[];
  /** Confidence score from 0 to 1 indicating fix reliability */
  confidence: number;
  /** Strategy name that produced this result */
  strategyName: string;
  /** Error message if the fix failed */
  error?: string;
}

/** Priority levels for fix strategies */
export type FixPriority = 'critical' | 'high' | 'medium' | 'low';

/** Category of a fix strategy */
export type FixCategory =
  | 'syntax'
  | 'linting'
  | 'typing'
  | 'refactoring'
  | 'performance'
  | 'compatibility'
  | 'deprecation'
  | 'style';

/**
 * Abstract base class for all fix strategies.
 * Subclasses must implement the `execute` method to provide specific fix logic.
 */
export abstract class FixStrategyBase {
  /** Unique name identifying this strategy */
  abstract readonly name: string;
  /** Human-readable description of what this strategy fixes */
  abstract readonly description: string;
  /** Priority level for scheduling */
  abstract readonly priority: FixPriority;
  /** Category this strategy belongs to */
  abstract readonly category: FixCategory;

  /**
   * Execute the fix strategy on the given context.
   * @param context - The fix context containing code and diagnostics
   * @returns A FixResult describing the changes made
   */
  abstract execute(context: FixContext): FixResult | Promise<FixResult>;

  /**
   * Execute the fix with rollback support. If validation fails, returns the original code.
   * @param context - The fix context containing code and diagnostics
   * @param validate - Optional validation function. If it returns false, the fix is rolled back.
   * @returns A FixResult, potentially rolled back to original code
   */
  async executeWithRollback(context: FixContext, validate?: (result: FixResult) => boolean): Promise<FixResult> {
    const originalCode = context.code;
    const result = await this.execute(context);

    if (validate && !validate(result)) {
      // Rollback: return original code unchanged
      return {
        fixed: false,
        code: originalCode,
        changes: [],
        confidence: 0,
        strategyName: this.name,
        error: 'Fix rolled back due to failed validation',
      };
    }

    return result;
  }

  /**
   * Check whether this strategy can handle a given diagnostic.
   * @param diagnostic - The diagnostic to check
   * @returns True if this strategy can potentially fix the diagnostic
   */
  canFix(diagnostic: Diagnostic): boolean {
    return true; // Default: can attempt any fix
  }

  /**
   * Estimate the confidence of a successful fix for the given context.
   * @param context - The fix context
   * @returns Confidence score from 0 to 1
   */
  estimateConfidence(context: FixContext): number {
    return 0.8; // Default confidence
  }
}

/**
 * Registry for managing fix strategies.
 * Allows registration, lookup, and retrieval of strategies by name, category, or priority.
 */
export class StrategyRegistry {
  private strategies: Map<string, FixStrategyBase> = new Map();

  /**
   * Register a fix strategy.
   * @param strategy - The strategy to register
   * @throws Error if a strategy with the same name is already registered
   */
  register(strategy: FixStrategyBase): void {
    if (this.strategies.has(strategy.name)) {
      throw new Error(`Strategy "${strategy.name}" is already registered`);
    }
    this.strategies.set(strategy.name, strategy);
  }

  /**
   * Unregister a fix strategy by name.
   * @param name - The name of the strategy to unregister
   * @returns True if the strategy was found and removed
   */
  unregister(name: string): boolean {
    return this.strategies.delete(name);
  }

  /**
   * Get a strategy by name.
   * @param name - The strategy name
   * @returns The strategy, or undefined if not found
   */
  get(name: string): FixStrategyBase | undefined {
    return this.strategies.get(name);
  }

  /**
   * Get all registered strategies.
   * @returns Array of all registered strategies
   */
  getAll(): FixStrategyBase[] {
    return Array.from(this.strategies.values());
  }

  /**
   * Get strategies filtered by category.
   * @param category - The category to filter by
   * @returns Array of strategies in the given category
   */
  getByCategory(category: FixCategory): FixStrategyBase[] {
    return this.getAll().filter((s) => s.category === category);
  }

  /**
   * Get strategies filtered by priority.
   * @param priority - The priority level to filter by
   * @returns Array of strategies with the given priority
   */
  getByPriority(priority: FixPriority): FixStrategyBase[] {
    return this.getAll().filter((s) => s.priority === priority);
  }

  /**
   * Get strategies sorted by priority (critical first).
   * @returns Array of strategies ordered by priority
   */
  getSortedByPriority(): FixStrategyBase[] {
    const priorityOrder: Record<FixPriority, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    return this.getAll().sort(
      (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
    );
  }

  /**
   * Find strategies that can handle a specific diagnostic.
   * Results are sorted by confidence (highest first).
   * @param diagnostic - The diagnostic to match
   * @returns Array of strategies that claim to handle the diagnostic, sorted by confidence
   */
  findStrategiesForDiagnostic(diagnostic: Diagnostic): FixStrategyBase[] {
    const context: FixContext = {
      filePath: '',
      code: '',
      diagnostics: [diagnostic],
      options: {},
    };
    return this.getAll()
      .filter((s) => s.canFix(diagnostic))
      .sort((a, b) => b.estimateConfidence(context) - a.estimateConfidence(context));
  }

  /**
   * Get the number of registered strategies.
   * @returns The count of registered strategies
   */
  get size(): number {
    return this.strategies.size;
  }

  /**
   * Clear all registered strategies.
   */
  clear(): void {
    this.strategies.clear();
  }

  /**
   * Check if a strategy with the given name is registered.
   * @param name - The strategy name
   * @returns True if registered
   */
  has(name: string): boolean {
    return this.strategies.has(name);
  }
}
