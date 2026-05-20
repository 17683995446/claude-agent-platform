/**
 * @module auto-fix-engine
 * @description Automatic code repair and fixing engine.
 * Provides a comprehensive toolkit for detecting, scheduling, and applying code fixes.
 */

// Strategy & Registry
export {
  FixStrategyBase,
  StrategyRegistry,
} from './fix-strategy.js';
export type {
  CodeChange,
  FixContext,
  Diagnostic,
  FixOptions,
  FixResult,
  FixPriority,
  FixCategory,
} from './fix-strategy.js';

// Quick Fixes
export { QuickFix } from './quick-fix.js';
export type { QuoteStyle, IndentStyle, Locale } from './quick-fix.js';

// Refactoring Engine
export { RefactoringEngine } from './refactoring-engine.js';
export type { SourceRange } from './refactoring-engine.js';

// Type Fixes
export { TypeFix } from './type-fix.js';
export type { InferredType } from './type-fix.js';

// Deprecation Fixes
export { DeprecationFix } from './deprecation-fix.js';
export type {
  DeprecationMap,
  DeprecationInfo,
  DeprecationUsage,
  MigrationStep,
} from './deprecation-fix.js';

// Performance Fixes
export { PerformanceFix } from './performance-fix.js';
export type { PerformanceIssue } from './performance-fix.js';

// Compatibility Fixes
export { CompatibilityFix } from './compatibility-fix.js';
export type { CompatTarget, CompatReport, CompatIssue } from './compatibility-fix.js';

// Fix Validator
export { FixValidator } from './fix-validator.js';
export type { ValidationResult, ValidationConfig } from './fix-validator.js';

// Fix Scheduler
export { FixScheduler } from './fix-scheduler.js';
export type {
  FixPriorityLevel,
  FixCategoryType,
  ScheduledFix,
  FixPlan,
} from './fix-scheduler.js';

// Fix History
export { FixHistory } from './fix-history.js';
export type {
  FixRecord,
  FixStats,
  FrequentFix,
  PreventiveSuggestion,
  HistoryFormat,
} from './fix-history.js';
