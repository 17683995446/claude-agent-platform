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

    // Detect closure variables (variables used in extracted code but declared outside)
    const outerCode = [...lines.slice(0, range.startLine - 1), ...lines.slice(range.endLine)].join('\n');
    const closureVars: string[] = [];
    // Find identifiers in extracted code that look like variable references
    const identifierPattern = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;
    const extractedIdents = new Set<string>();
    let idMatch: RegExpExecArray | null;
    while ((idMatch = identifierPattern.exec(extractedCode)) !== null) {
      extractedIdents.add(idMatch[1]);
    }
    // Check which are declared in outer scope
    for (const ident of extractedIdents) {
      const declPattern = new RegExp(`(?:const|let|var|function)\\s+${ident}\\b`);
      if (declPattern.test(outerCode) && !declPattern.test(extractedCode)) {
        closureVars.push(ident);
      }
    }

    // Build the new method
    const indent = (lines[range.startLine - 1].match(/^(\s*)/) || [''])[1];
    const params = closureVars.length > 0 ? closureVars.join(', ') : '';
    const newMethod =
      `\n${indent}function ${name}(${params}) {\n` +
      selectedLines.map((l) => indent + '  ' + l).join('\n') +
      `\n${indent}}\n`;

    // Replace the selected lines with a call to the new method
    const callArgs = closureVars.length > 0 ? closureVars.join(', ') : '';
    const callStatement = `${indent}${name}(${callArgs});`;
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
    // Insert the declaration before the line that now contains the variable name
    const newLines = newCode.split('\n');
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

      // Use word boundary matching, but skip strings and comments
      const regex = new RegExp(`\\b${oldName}\\b`, 'g');
      if (regex.test(line) && this.replaceOutsideStringsAndComments(line, new RegExp(`\\b${oldName}\\b`, 'g'), newName) !== line) {
        modified = true;
        return this.replaceOutsideStringsAndComments(line, new RegExp(`\\b${oldName}\\b`, 'g'), newName);
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

    // Remove the declaration line and replace usages (skip strings and comments)
    const newLines = lines.filter((_, i) => i !== declLine);
    const usageRegex = new RegExp(`\\b${varName}\\b`, 'g');
    const inlinedCode = newLines
      .map((line) => this.replaceOutsideStringsAndComments(line, usageRegex, varValue))
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
   * Generate a diff preview of the changes that would be made.
   * @param originalCode - The original code
   * @param newCode - The modified code
   * @returns A unified diff string showing the changes
   */
  generateDiff(originalCode: string, newCode: string): string {
    const originalLines = originalCode.split('\n');
    const newLines = newCode.split('\n');
    const diff: string[] = [];

    // Simple line-based diff
    const maxLen = Math.max(originalLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      const origLine = i < originalLines.length ? originalLines[i] : undefined;
      const newLine = i < newLines.length ? newLines[i] : undefined;

      if (origLine === undefined) {
        diff.push(`+ ${newLine}`);
      } else if (newLine === undefined) {
        diff.push(`- ${origLine}`);
      } else if (origLine !== newLine) {
        diff.push(`- ${origLine}`);
        diff.push(`+ ${newLine}`);
      }
    }

    return diff.join('\n');
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

  /**
   * Replace regex matches in a line, skipping matches inside strings and comments.
   * @param line - The source line
   * @param regex - The regex to match (with global flag)
   * @param replacement - The replacement string
   * @returns The line with replacements applied only outside strings/comments
   */
  private replaceOutsideStringsAndComments(line: string, regex: RegExp, replacement: string): string {
    const segments: { text: string; replaceable: boolean }[] = [];
    let current = '';
    let inString: string | null = null;
    let inTemplate = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const prev = i > 0 ? line[i - 1] : '';

      if (inLineComment) {
        current += char;
        continue;
      }

      if (inBlockComment) {
        current += char;
        if (prev === '*' && char === '/') {
          inBlockComment = false;
          segments.push({ text: current, replaceable: false });
          current = '';
        }
        continue;
      }

      if (inString) {
        current += char;
        if (char === '\\') {
          // Next char is escaped, add it too
          if (i + 1 < line.length) {
            i++;
            current += line[i];
          }
          continue;
        }
        if (char === inString) {
          inString = null;
          segments.push({ text: current, replaceable: false });
          current = '';
        }
        continue;
      }

      if (inTemplate) {
        current += char;
        if (char === '`') {
          inTemplate = false;
          segments.push({ text: current, replaceable: false });
          current = '';
        }
        continue;
      }

      // Check for comment start
      if (prev === '/' && char === '/') {
        // The '/' was already added to current, remove it
        current = current.slice(0, -1);
        if (current) segments.push({ text: current, replaceable: true });
        current = '//' + char;
        inLineComment = true;
        continue;
      }
      if (prev === '/' && char === '*') {
        current = current.slice(0, -1);
        if (current) segments.push({ text: current, replaceable: true });
        current = '/*' + char;
        inBlockComment = true;
        continue;
      }

      // Check for string start
      if (char === "'" || char === '"') {
        if (current) segments.push({ text: current, replaceable: true });
        current = char;
        inString = char;
        continue;
      }
      if (char === '`') {
        if (current) segments.push({ text: current, replaceable: true });
        current = char;
        inTemplate = true;
        continue;
      }

      current += char;
    }

    if (current) {
      segments.push({
        text: current,
        replaceable: !inLineComment && !inBlockComment && !inString && !inTemplate,
      });
    }

    return segments
      .map((seg) => (seg.replaceable ? seg.text.replace(regex, replacement) : seg.text))
      .join('');
  }
}
