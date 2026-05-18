/**
 * @module refactoring-engine
 * @description Automated refactoring operations for code transformation.
 * Provides safe, pattern-based refactoring capabilities.
 */

import type { CodeChange, FixResult } from './fix-strategy.js';

/** Represents a source code range */
export interface SourceRange {
  /** Start line (1-based) */
  startLine: number;
  /** Start column (1-based) */
  startColumn: number;
  /** End line (1-based) */
  endLine: number;
  /** End column (1-based) */
  endColumn: number;
}

/**
 * RefactoringEngine - Performs automated refactoring operations.
 * Uses pattern matching and AST-like heuristics to transform code safely.
 */
export class RefactoringEngine {
  /**
   * Extract a block of code into a named method/function.
   * @param code - The source code
   * @param range - The range of code to extract
   * @param name - The name for the new method
   * @returns FixResult with the extracted method
   */
  extractMethod(code: string, range: SourceRange, name: string): FixResult {
    const lines = code.split('\n');
    const changes: CodeChange[] = [];

    if (range.startLine < 1 || range.endLine > lines.length || range.startLine > range.endLine || code.trim() === '') {
      return {
        fixed: false,
        code,
        changes: [],
        confidence: 0,
        strategyName: 'refactoring-engine',
        error: 'Invalid range',
      };
    }

    // Extract the selected lines
    const selectedLines = lines.slice(range.startLine - 1, range.endLine);
    const extractedCode = selectedLines.join('\n');

    // Build the new method
    const indent = (lines[range.startLine - 1].match(/^(\s*)/) || [''])[1];
    const newMethod =
      `\n${indent}function ${name}() {\n` +
      selectedLines.map((l) => indent + '  ' + l).join('\n') +
      `\n${indent}}\n`;

    // Replace the selected lines with a call to the new method
    const callStatement = `${indent}${name}();`;
    const newLines = [
      ...lines.slice(0, range.startLine - 1),
      callStatement,
      ...lines.slice(range.endLine),
    ];

    const newCode = newLines.join('\n') + newMethod;

    changes.push({
      description: `Extracted method '${name}'`,
      original: extractedCode,
      replacement: `${name}();`,
      line: range.startLine,
      column: range.startColumn,
    });

    return {
      fixed: true,
      code: newCode,
      changes,
      confidence: 0.75,
      strategyName: 'refactoring-engine',
    };
  }

  /**
   * Extract an expression into a named variable.
   * @param code - The source code
   * @param expression - The expression to extract
   * @param name - The name for the new variable
   * @returns FixResult with the extracted variable
   */
  extractVariable(code: string, expression: string, name: string): FixResult {
    const changes: CodeChange[] = [];

    if (!code.includes(expression)) {
      return {
        fixed: false,
        code,
        changes: [],
        confidence: 0,
        strategyName: 'refactoring-engine',
        error: `Expression '${expression}' not found in code`,
      };
    }

    // Find the line containing the expression
    const lines = code.split('\n');
    let targetLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(expression)) {
        targetLine = i;
        break;
      }
    }

    if (targetLine === -1) {
      return {
        fixed: false,
        code,
        changes: [],
        confidence: 0,
        strategyName: 'refactoring-engine',
        error: 'Expression not found',
      };
    }

    const indent = (lines[targetLine].match(/^(\s*)/) || [''])[1];
    const declaration = `${indent}const ${name} = ${expression};`;

    // Replace first occurrence with the variable name
    const newCode = code.replace(expression, name);
    // Insert the declaration before the line
    const newLines = [...lines];
    newLines.splice(targetLine, 0, declaration);
    const finalCode = newLines.join('\n');

    changes.push({
      description: `Extracted variable '${name}'`,
      original: expression,
      replacement: name,
      line: targetLine + 1,
      column: 1,
    });

    return {
      fixed: true,
      code: finalCode,
      changes,
      confidence: 0.8,
      strategyName: 'refactoring-engine',
    };
  }

  /**
   * Rename a symbol throughout the code within a given scope.
   * @param code - The source code
   * @param oldName - The current symbol name
   * @param newName - The new symbol name
   * @param scope - Optional scope restriction (line range)
   * @returns FixResult with the symbol renamed
   */
  renameSymbol(
    code: string,
    oldName: string,
    newName: string,
    scope?: SourceRange,
  ): FixResult {
    const changes: CodeChange[] = [];
    const lines = code.split('\n');

    // Validate names
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(newName)) {
      return {
        fixed: false,
        code,
        changes: [],
        confidence: 0,
        strategyName: 'refactoring-engine',
        error: `Invalid symbol name: '${newName}'`,
      };
    }

    if (oldName === newName) {
      return {
        fixed: false,
        code,
        changes: [],
        confidence: 1,
        strategyName: 'refactoring-engine',
      };
    }

    const startLine = scope ? scope.startLine - 1 : 0;
    const endLine = scope ? scope.endLine : lines.length;

    let modified = false;
    const newLines = lines.map((line, i) => {
      if (i < startLine || i >= endLine) return line;

      // Use word boundary matching to avoid partial replacements
      const regex = new RegExp(`\\b${oldName}\\b`, 'g');
      if (regex.test(line)) {
        modified = true;
        return line.replace(new RegExp(`\\b${oldName}\\b`, 'g'), newName);
      }
      return line;
    });

    if (modified) {
      changes.push({
        description: `Renamed symbol '${oldName}' to '${newName}'`,
        original: oldName,
        replacement: newName,
        line: startLine + 1,
        column: 1,
      });
    }

    return {
      fixed: modified,
      code: modified ? newLines.join('\n') : code,
      changes,
      confidence: 0.85,
      strategyName: 'refactoring-engine',
    };
  }

  /**
   * Inline a variable by replacing its usages with its value.
   * @param code - The source code
   * @param varName - The name of the variable to inline
   * @returns FixResult with the variable inlined
   */
  inlineVariable(code: string, varName: string): FixResult {
    const changes: CodeChange[] = [];
    const lines = code.split('\n');

    // Find the variable declaration
    const declPattern = new RegExp(
      `^\\s*(const|let|var)\\s+${varName}\\s*=\\s*(.+?)\\s*;?\\s*$`,
    );

    let declLine = -1;
    let varValue = '';

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(declPattern);
      if (match) {
        declLine = i;
        varValue = match[2].replace(/;$/, '').trim();
        break;
      }
    }

    if (declLine === -1) {
      return {
        fixed: false,
        code,
        changes: [],
        confidence: 0,
        strategyName: 'refactoring-engine',
        error: `Variable '${varName}' declaration not found`,
      };
    }

    // Remove the declaration line and replace usages
    const newLines = lines.filter((_, i) => i !== declLine);
    const usageRegex = new RegExp(`\\b${varName}\\b`, 'g');
    const inlinedCode = newLines
      .map((line) => line.replace(usageRegex, varValue))
      .join('\n');

    changes.push({
      description: `Inlined variable '${varName}' with value '${varValue}'`,
      original: `${varName}`,
      replacement: varValue,
      line: declLine + 1,
      column: 1,
    });

    return {
      fixed: true,
      code: inlinedCode,
      changes,
      confidence: 0.7,
      strategyName: 'refactoring-engine',
    };
  }

  /**
   * Simplify conditional expressions (e.g., `if (x === true)` to `if (x)`).
   * @param code - The source code
   * @returns FixResult with simplified conditionals
   */
  simplifyConditional(code: string): FixResult {
    const changes: CodeChange[] = [];
    let result = code;
    let modified = false;

    // Simplify `=== true` and `!== false`
    const patterns: [RegExp, string][] = [
      [/(\w+)\s*===\s*true/g, '$1'],
      [/(\w+)\s*!==\s*false/g, '$1'],
      [/(\w+)\s*===\s*false/g, '!($1)'],
      [/(\w+)\s*!==\s*true/g, '!($1)'],
      [/if\s*\(\s*true\s*\)/g, 'if (true)'],
    ];

    for (const [pattern, replacement] of patterns) {
      const newResult = result.replace(pattern, replacement);
      if (newResult !== result) {
        result = newResult;
        modified = true;
      }
    }

    if (modified) {
      changes.push({
        description: 'Simplified conditional expressions',
        original: code,
        replacement: result,
        line: 1,
        column: 1,
      });
    }

    return {
      fixed: modified,
      code: result,
      changes,
      confidence: 0.8,
      strategyName: 'refactoring-engine',
    };
  }

  /**
   * Encapsulate a public field by making it private and adding getter/setter.
   * @param code - The source code
   * @param field - The field name to encapsulate
   * @param classRange - The range of the class definition
   * @returns FixResult with the field encapsulated
   */
  encapsulateField(
    code: string,
    field: string,
    classRange: SourceRange,
  ): FixResult {
    const lines = code.split('\n');
    const changes: CodeChange[] = [];

    if (classRange.startLine < 1 || classRange.endLine > lines.length) {
      return {
        fixed: false,
        code,
        changes: [],
        confidence: 0,
        strategyName: 'refactoring-engine',
        error: 'Invalid class range',
      };
    }

    // Find the field declaration in the class
    const fieldPattern = new RegExp(
      `^\\s*(public\\s+)?(${field})\\s*(=|:)`,
    );

    let fieldLine = -1;
    let fieldIndent = '';

    for (let i = classRange.startLine - 1; i < classRange.endLine; i++) {
      const match = lines[i].match(fieldPattern);
      if (match) {
        fieldLine = i;
        fieldIndent = (lines[i].match(/^(\s*)/) || [''])[1];
        break;
      }
    }

    if (fieldLine === -1) {
      return {
        fixed: false,
        code,
        changes: [],
        confidence: 0,
        strategyName: 'refactoring-engine',
        error: `Field '${field}' not found in class`,
      };
    }

    // Make the field private
    const newLines = [...lines];
    const originalLine = newLines[fieldLine];
    if (originalLine.includes('public ')) {
      newLines[fieldLine] = originalLine.replace('public ', 'private ');
    } else {
      newLines[fieldLine] = originalLine.replace(field, `_${field}`);
    }

    const privateName = originalLine.includes('public ')
      ? field
      : `_${field}`;

    // Add getter and setter before the closing brace
    const closingBraceLine = classRange.endLine - 1;
    const getter =
      `\n${fieldIndent}  get ${field}() {\n` +
      `${fieldIndent}    return this.${privateName};\n` +
      `${fieldIndent}  }\n`;
    const setter =
      `${fieldIndent}  set ${field}(value: any) {\n` +
      `${fieldIndent}    this.${privateName} = value;\n` +
      `${fieldIndent}  }\n`;

    newLines.splice(closingBraceLine, 0, getter + setter);

    changes.push({
      description: `Encapsulated field '${field}'`,
      original: originalLine,
      replacement: newLines[fieldLine],
      line: fieldLine + 1,
      column: 1,
    });

    return {
      fixed: true,
      code: newLines.join('\n'),
      changes,
      confidence: 0.75,
      strategyName: 'refactoring-engine',
    };
  }
}
