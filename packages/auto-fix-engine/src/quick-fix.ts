/**
 * @module quick-fix
 * @description Common quick fixes for linting and TypeScript errors.
 * Provides fast, high-confidence fixes for frequently encountered issues.
 */

import type { CodeChange, Diagnostic, FixResult } from './fix-strategy.js';

/** Style options for quote fixing */
export type QuoteStyle = 'single' | 'double' | 'backtick';

/** Style options for indentation fixing */
export type IndentStyle = 'spaces' | 'tabs';

/**
 * QuickFix - Provides common quick fixes for linting and TypeScript errors.
 * All methods are pure functions that take code strings and return fix results.
 */
export class QuickFix {
  /**
   * Fix missing import statements by adding import declarations at the top of the file.
   * @param code - The source code
   * @param missing - Array of missing module specifiers to import
   * @returns FixResult with the imports added
   */
  fixMissingImports(code: string, missing: string[]): FixResult {
    const changes: CodeChange[] = [];

    if (missing.length === 0) {
      return {
        fixed: false,
        code,
        changes: [],
        confidence: 1,
        strategyName: 'quick-fix',
      };
    }

    const importStatements = missing
      .map((mod) => {
        const defaultImport = mod.split('/').pop() || mod;
        const sanitizedName = defaultImport
          .replace(/[^a-zA-Z0-9_$]/g, '')
          .replace(/^[0-9]/, '_$&');
        return `import ${sanitizedName} from '${mod}';`;
      })
      .join('\n');

    const newCode = importStatements + '\n' + code;

    changes.push({
      description: `Added ${missing.length} missing import(s)`,
      original: '',
      replacement: importStatements,
      line: 1,
      column: 1,
    });

    return {
      fixed: true,
      code: newCode,
      changes,
      confidence: 0.9,
      strategyName: 'quick-fix',
    };
  }

  /**
   * Fix unused variables by prefixing them with an underscore.
   * @param code - The source code
   * @returns FixResult with unused variables renamed
   */
  fixUnusedVariables(code: string): FixResult {
    const changes: CodeChange[] = [];
    const lines = code.split('\n');
    let modified = false;

    // Match common unused variable patterns: const/let/var declarations
    const varPattern =
      /^\s*(const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(varPattern);
      if (match) {
        const varName = match[2];
        // Check if the variable name is already prefixed
        if (!varName.startsWith('_') && !code.includes(varName, lines[i].length + varName.length + i)) {
          // Simple heuristic: if the variable name appears only in its declaration line,
          // it might be unused. We'll prefix it.
          const occurrenceCount = code.split(varName).length - 1;
          if (occurrenceCount <= 1) {
            const newName = '_' + varName;
            lines[i] = lines[i].replace(varName, newName);
            changes.push({
              description: `Renamed unused variable '${varName}' to '${newName}'`,
              original: varName,
              replacement: newName,
              line: i + 1,
              column: lines[i].indexOf(newName) + 1,
            });
            modified = true;
          }
        }
      }
    }

    return {
      fixed: modified,
      code: modified ? lines.join('\n') : code,
      changes,
      confidence: 0.7,
      strategyName: 'quick-fix',
    };
  }

  /**
   * Fix missing semicolons at the end of statements.
   * @param code - The source code
   * @returns FixResult with semicolons added where needed
   */
  fixMissingSemicolons(code: string): FixResult {
    const changes: CodeChange[] = [];
    const lines = code.split('\n');
    let modified = false;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimEnd();

      // Skip empty lines, comments, lines ending with brackets, or lines that already have semicolons
      if (
        trimmed === '' ||
        trimmed.startsWith('//') ||
        trimmed.startsWith('*') ||
        trimmed.startsWith('/*') ||
        trimmed.endsWith('{') ||
        trimmed.endsWith('}') ||
        trimmed.endsWith(';') ||
        trimmed.endsWith(',') ||
        trimmed.endsWith('(') ||
        trimmed.endsWith('`') ||
        trimmed.endsWith("'") ||
        trimmed.endsWith('"') ||
        trimmed.endsWith(']') ||
        trimmed.includes('=>') ||
        trimmed.startsWith('import') ||
        trimmed.startsWith('export') && trimmed.includes('from')
      ) {
        continue;
      }

      // Add semicolon if the line looks like a statement
      if (
        /^[a-zA-Z_$]/.test(trimmed) ||
        /^\s*(return|throw|break|continue|yield|await|delete|typeof|void|new)\b/.test(trimmed)
      ) {
        const original = lines[i];
        lines[i] = trimmed + ';';
        if (original !== lines[i]) {
          changes.push({
            description: 'Added missing semicolon',
            original,
            replacement: lines[i],
            line: i + 1,
            column: trimmed.length + 1,
          });
          modified = true;
        }
      }
    }

    return {
      fixed: modified,
      code: modified ? lines.join('\n') : code,
      changes,
      confidence: 0.85,
      strategyName: 'quick-fix',
    };
  }

  /**
   * Fix trailing commas in object literals, arrays, and function parameters.
   * Removes trailing commas that may cause issues in older environments.
   * @param code - The source code
   * @returns FixResult with trailing commas removed
   */
  fixTrailingCommas(code: string): FixResult {
    const changes: CodeChange[] = [];
    const lines = code.split('\n');
    let modified = false;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimEnd();

      // Remove trailing comma before closing bracket/paren
      if (/,\s*$/.test(trimmed)) {
        const nextNonEmptyLine = lines
          .slice(i + 1)
          .find((l) => l.trim() !== '');

        if (
          nextNonEmptyLine &&
          /^\s*[}\])]/.test(nextNonEmptyLine)
        ) {
          const original = lines[i];
          lines[i] = trimmed.replace(/,\s*$/, '');
          changes.push({
            description: 'Removed trailing comma',
            original,
            replacement: lines[i],
            line: i + 1,
            column: trimmed.length,
          });
          modified = true;
        }
      }
    }

    return {
      fixed: modified,
      code: modified ? lines.join('\n') : code,
      changes,
      confidence: 0.95,
      strategyName: 'quick-fix',
    };
  }

  /**
   * Fix indentation to match a consistent style.
   * @param code - The source code
   * @param style - The indentation style ('spaces' or 'tabs')
   * @param size - Number of spaces per indent level (default: 2, only used when style is 'spaces')
   * @returns FixResult with consistent indentation
   */
  fixIndentation(code: string, style: IndentStyle, size: number = 2): FixResult {
    const changes: CodeChange[] = [];
    const lines = code.split('\n');
    let modified = false;
    const spaceIndent = ' '.repeat(size);

    for (let i = 0; i < lines.length; i++) {
      const original = lines[i];

      if (style === 'spaces') {
        // Replace tabs with spaces
        if (lines[i].includes('\t')) {
          lines[i] = lines[i].replace(/\t/g, spaceIndent);
          if (lines[i] !== original) {
            changes.push({
              description: 'Replaced tabs with spaces',
              original,
              replacement: lines[i],
              line: i + 1,
              column: 1,
            });
            modified = true;
          }
        }
      } else {
        // Replace leading spaces with tabs
        const match = lines[i].match(/^( +)(.*)$/);
        if (match) {
          const spaces = match[1];
          const rest = match[2];
          const tabCount = Math.round(spaces.length / size);
          const newIndent = '\t'.repeat(tabCount);
          lines[i] = newIndent + rest;
          if (lines[i] !== original) {
            changes.push({
              description: 'Replaced spaces with tabs',
              original,
              replacement: lines[i],
              line: i + 1,
              column: 1,
            });
            modified = true;
          }
        }
      }
    }

    return {
      fixed: modified,
      code: modified ? lines.join('\n') : code,
      changes,
      confidence: 0.95,
      strategyName: 'quick-fix',
    };
  }

  /**
   * Fix quote style to be consistent throughout the code.
   * @param code - The source code
   * @param style - The target quote style
   * @returns FixResult with consistent quote style
   */
  fixQuotes(code: string, style: QuoteStyle): FixResult {
    const changes: CodeChange[] = [];
    let result = code;
    let modified = false;

    if (style === 'single') {
      // Replace double quotes with single quotes (simple approach)
      const newResult = result.replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, (_match, content) => {
        // If content contains single quotes, keep double quotes
        if (content.includes("'")) return `"${content}"`;
        return `'${content}'`;
      });
      if (newResult !== result) {
        result = newResult;
        modified = true;
        changes.push({
          description: 'Normalized quotes to single quotes',
          original: code,
          replacement: result,
          line: 1,
          column: 1,
        });
      }
    } else if (style === 'double') {
      // Replace single quotes with double quotes (simple approach)
      const newResult = result.replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, (_match, content) => {
        // If content contains double quotes, keep single quotes
        if (content.includes('"')) return `'${content}'`;
        return `"${content}"`;
      });
      if (newResult !== result) {
        result = newResult;
        modified = true;
        changes.push({
          description: 'Normalized quotes to double quotes',
          original: code,
          replacement: result,
          line: 1,
          column: 1,
        });
      }
    }
    // backtick style: no conversion needed, template literals are left as-is

    return {
      fixed: modified,
      code: result,
      changes,
      confidence: 0.85,
      strategyName: 'quick-fix',
    };
  }

  /**
   * Apply a set of quick fixes based on diagnostics.
   * Intelligently selects and applies the appropriate fixes.
   * @param code - The source code
   * @param diagnostics - Array of diagnostics to fix
   * @returns FixResult with all applicable quick fixes applied
   */
  applyQuickFixes(code: string, diagnostics: Diagnostic[]): FixResult {
    const allChanges: CodeChange[] = [];
    let currentCode = code;
    let totalConfidence = 0;
    let fixCount = 0;

    for (const diagnostic of diagnostics) {
      const msg = diagnostic.message.toLowerCase();

      if (msg.includes('missing semicolon') || msg.includes('expected a semicolon')) {
        const result = this.fixMissingSemicolons(currentCode);
        if (result.fixed) {
          currentCode = result.code;
          allChanges.push(...result.changes);
          totalConfidence += result.confidence;
          fixCount++;
        }
      }

      if (msg.includes('unused variable') || msg.includes("'") && msg.includes('is defined but never used')) {
        const result = this.fixUnusedVariables(currentCode);
        if (result.fixed) {
          currentCode = result.code;
          allChanges.push(...result.changes);
          totalConfidence += result.confidence;
          fixCount++;
        }
      }

      if (msg.includes('trailing comma')) {
        const result = this.fixTrailingCommas(currentCode);
        if (result.fixed) {
          currentCode = result.code;
          allChanges.push(...result.changes);
          totalConfidence += result.confidence;
          fixCount++;
        }
      }
    }

    return {
      fixed: allChanges.length > 0,
      code: currentCode,
      changes: allChanges,
      confidence: fixCount > 0 ? totalConfidence / fixCount : 1,
      strategyName: 'quick-fix',
    };
  }
}
