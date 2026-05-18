/**
 * @module fix-validator
 * @description Validates that applied fixes don't break code.
 * Provides syntax, semantic, type, and test validation for fix results.
 */

import type { FixResult } from './fix-strategy.js';

/** Result of a validation check */
export interface ValidationResult {
  /** Whether the validation passed */
  valid: boolean;
  /** Error messages if validation failed */
  errors: string[];
  /** Warning messages */
  warnings: string[];
  /** Validation score from 0 to 1 */
  score: number;
}

/** Configuration for validation */
export interface ValidationConfig {
  /** Whether to check syntax */
  checkSyntax?: boolean;
  /** Whether to check semantics */
  checkSemantics?: boolean;
  /** Whether to check types */
  checkTypes?: boolean;
  /** Whether to run tests */
  runTests?: boolean;
  /** Maximum allowed change ratio (changes / total lines) */
  maxChangeRatio?: number;
}

/**
 * FixValidator - Validates that fixes don't break code.
 * Performs multiple levels of validation to ensure fix safety.
 */
export class FixValidator {
  private config: ValidationConfig;

  constructor(config: ValidationConfig = {}) {
    this.config = {
      checkSyntax: true,
      checkSemantics: false,
      checkTypes: false,
      runTests: false,
      maxChangeRatio: 0.5,
      ...config,
    };
  }

  /**
   * Validate JavaScript/TypeScript syntax.
   * Uses basic heuristics to check for common syntax errors.
   * @param code - The source code to validate
   * @returns ValidationResult indicating syntax correctness
   */
  validateSyntax(code: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!this.config.checkSyntax) {
      return { valid: true, errors: [], warnings: [], score: 1 };
    }

    // Check balanced braces
    const braceCount = this.countBraces(code, '{', '}');
    if (braceCount.open !== braceCount.close) {
      errors.push(`Unbalanced braces: ${braceCount.open} opening vs ${braceCount.close} closing`);
    }

    // Check balanced parentheses
    const parenCount = this.countBraces(code, '(', ')');
    if (parenCount.open !== parenCount.close) {
      errors.push(`Unbalanced parentheses: ${parenCount.open} opening vs ${parenCount.close} closing`);
    }

    // Check balanced brackets
    const bracketCount = this.countBraces(code, '[', ']');
    if (bracketCount.open !== bracketCount.close) {
      errors.push(`Unbalanced brackets: ${bracketCount.open} opening vs ${bracketCount.close} closing`);
    }

    // Check for empty code
    if (code.trim() === '') {
      warnings.push('Code is empty');
    }

    // Check for lines that are too long (over 200 chars)
    const lines = code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].length > 200) {
        warnings.push(`Line ${i + 1} is very long (${lines[i].length} characters)`);
      }
    }

    // Check for obvious syntax issues
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // Check for double semicolons
      if (line.includes(';;')) {
        errors.push(`Line ${i + 1}: Double semicolons detected`);
      }
      // Check for missing operator between expressions
      if (/(\w)\s+(\w)\s*[\(;]/.test(line) && !line.includes('function') && !line.includes('if') && !line.includes('for') && !line.includes('while') && !line.includes('return') && !line.includes('const') && !line.includes('let') && !line.includes('var') && !line.includes('class') && !line.includes('new') && !line.includes('import') && !line.includes('export') && !line.includes('async') && !line.includes('await')) {
        // This is a very rough heuristic, only flag as warning
        warnings.push(`Line ${i + 1}: Possible missing operator between expressions`);
      }
    }

    const score = errors.length === 0 ? (warnings.length === 0 ? 1 : 0.9) : Math.max(0, 1 - errors.length * 0.2);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      score,
    };
  }

  /**
   * Validate that the code semantics are preserved.
   * Compares structural patterns between original and fixed code.
   * @param code - The fixed code
   * @param originalBehavior - Description of the original code's expected behavior
   * @returns ValidationResult indicating semantic preservation
   */
  validateSemantics(code: string, originalBehavior: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!this.config.checkSemantics) {
      return { valid: true, errors: [], warnings: [], score: 1 };
    }

    // Check that exported symbols are preserved
    const exports = code.match(/export\s+(?:default\s+)?(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g);
    if ((!exports || exports.length === 0) && originalBehavior.includes('export')) {
      warnings.push('No exports found in the fixed code');
    }

    // Check that function definitions are preserved
    const functions = code.match(/function\s+(\w+)/g);
    if ((!functions || functions.length === 0) && originalBehavior.includes('function')) {
      warnings.push('No function definitions found in the fixed code');
    }

    // Check that class definitions are preserved
    const classes = code.match(/class\s+(\w+)/g);
    if ((!classes || classes.length === 0) && originalBehavior.includes('class')) {
      warnings.push('No class definitions found in the fixed code');
    }

    // Check for obvious infinite loops
    if (/while\s*\(\s*true\s*\)/.test(code) && !originalBehavior.includes('infinite')) {
      warnings.push('Possible infinite loop detected (while true)');
    }

    const score = errors.length === 0 ? (warnings.length === 0 ? 1 : 0.85) : Math.max(0, 1 - errors.length * 0.3);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      score,
    };
  }

  /**
   * Validate TypeScript types (basic heuristic check).
   * @param code - The source code
   * @param tsConfig - Optional path to tsconfig.json (not used in heuristic mode)
   * @returns ValidationResult indicating type correctness
   */
  validateTypes(code: string, tsConfig?: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!this.config.checkTypes) {
      return { valid: true, errors: [], warnings: [], score: 1 };
    }

    // Check for obvious type issues
    const lines = code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for 'any' type usage
      if (/\b:\s*any\b/.test(line)) {
        warnings.push(`Line ${i + 1}: Uses 'any' type - consider using a more specific type`);
      }

      // Check for type assertions (as keyword)
      if (/\bas\s+\w+/.test(line) && !line.includes('//')) {
        warnings.push(`Line ${i + 1}: Type assertion found - verify correctness`);
      }

      // Check for non-null assertions
      if (/\w+!./.test(line)) {
        warnings.push(`Line ${i + 1}: Non-null assertion found - verify the value is not null`);
      }

      // Check for @ts-ignore
      if (line.includes('@ts-ignore') || line.includes('@ts-expect-error')) {
        warnings.push(`Line ${i + 1}: TypeScript error suppression directive found`);
      }
    }

    const score = errors.length === 0 ? (warnings.length === 0 ? 1 : 0.8) : Math.max(0, 1 - errors.length * 0.3);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      score,
    };
  }

  /**
   * Validate that tests still pass after a fix.
   * Note: This is a placeholder that simulates test validation.
   * @param code - The source code
   * @param testRunner - The test runner command (e.g., 'bun test', 'jest')
   * @returns ValidationResult indicating test status
   */
  validateTests(code: string, testRunner: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!this.config.runTests) {
      return { valid: true, errors: [], warnings: [], score: 1 };
    }

    // In a real implementation, this would spawn a test process
    // For now, we do basic heuristic checks
    if (!testRunner || testRunner.trim() === '') {
      warnings.push('No test runner specified - tests were not executed');
      return {
        valid: true,
        errors,
        warnings,
        score: 0.5,
      };
    }

    // Check if the code contains test files references
    if (code.includes('describe(') || code.includes('it(') || code.includes('test(')) {
      warnings.push('Code contains test assertions - verify tests pass independently');
    }

    return {
      valid: true,
      errors,
      warnings,
      score: 0.9,
    };
  }

  /**
   * Validate a complete fix result against the original code.
   * Runs all applicable validations.
   * @param fixResult - The fix result to validate
   * @param originalCode - The original code before the fix
   * @returns ValidationResult combining all validation checks
   */
  validateFix(fixResult: FixResult, originalCode: string): ValidationResult {
    const allErrors: string[] = [];
    const allWarnings: string[] = [];

    // If the fix wasn't applied, it's trivially valid
    if (!fixResult.fixed) {
      return { valid: true, errors: [], warnings: [], score: 1 };
    }

    // Check confidence threshold
    if (fixResult.confidence < 0.5) {
      allWarnings.push(`Low confidence fix: ${fixResult.confidence.toFixed(2)}`);
    }

    // Check change ratio
    const originalLines = originalCode.split('\n').length;
    if (originalLines > 0 && this.config.maxChangeRatio !== undefined) {
      const changeRatio = fixResult.changes.length / originalLines;
      if (changeRatio > this.config.maxChangeRatio) {
        allWarnings.push(
          `Change ratio ${(changeRatio * 100).toFixed(1)}% exceeds maximum ${this.config.maxChangeRatio * 100}%`,
        );
      }
    }

    // Validate syntax of the fixed code
    const syntaxResult = this.validateSyntax(fixResult.code);
    allErrors.push(...syntaxResult.errors);
    allWarnings.push(...syntaxResult.warnings);

    // Check that the fixed code is not empty when the original wasn't
    if (originalCode.trim() !== '' && fixResult.code.trim() === '') {
      allErrors.push('Fix resulted in empty code');
    }

    // Check that the fixed code is significantly different (if changes were reported)
    if (fixResult.changes.length > 0 && fixResult.code === originalCode) {
      allErrors.push('Fix reported changes but code is identical to original');
    }

    // Calculate overall score
    const syntaxScore = syntaxResult.score;
    const confidenceScore = fixResult.confidence;
    const overallScore = (syntaxScore + confidenceScore) / 2;

    return {
      valid: allErrors.length === 0,
      errors: allErrors,
      warnings: allWarnings,
      score: Math.max(0, Math.min(1, overallScore)),
    };
  }

  /**
   * Count balanced brace/paren/bracket pairs, ignoring those in strings and comments.
   * @param code - The source code
   * @param open - The opening character
   * @param close - The closing character
   * @returns Object with open and close counts
   */
  private countBraces(code: string, open: string, close: string): { open: number; close: number } {
    let openCount = 0;
    let closeCount = 0;
    let inString: string | null = null;
    let inTemplate = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < code.length; i++) {
      const char = code[i];
      const prev = i > 0 ? code[i - 1] : '';

      if (inLineComment) {
        if (char === '\n') inLineComment = false;
        continue;
      }

      if (inBlockComment) {
        if (prev === '*' && char === '/') inBlockComment = false;
        continue;
      }

      if (inString) {
        if (char === '\\') {
          i++; // Skip escaped character
          continue;
        }
        if (char === inString) inString = null;
        continue;
      }

      if (inTemplate) {
        if (char === '`') inTemplate = false;
        continue;
      }

      // Check for comment start
      if (prev === '/' && char === '/') {
        inLineComment = true;
        openCount--; // Undo the count for the '/' that was part of '//'  (it wasn't a brace)
        continue;
      }
      if (prev === '/' && char === '*') {
        inBlockComment = true;
        openCount--; // Undo
        continue;
      }

      // Check for string start
      if (char === "'" || char === '"') {
        inString = char;
        continue;
      }
      if (char === '`') {
        inTemplate = true;
        continue;
      }

      if (char === open) openCount++;
      if (char === close) closeCount++;
    }

    return { open: openCount, close: closeCount };
  }
}
