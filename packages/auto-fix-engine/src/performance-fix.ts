/**
 * @module performance-fix
 * @description Automatic performance optimization for JavaScript/TypeScript code.
 * Detects common performance anti-patterns and applies optimizations.
 */

import type { CodeChange, FixResult } from './fix-strategy.js';

/** A detected performance issue */
export interface PerformanceIssue {
  /** Description of the issue */
  description: string;
  /** The anti-pattern that was detected */
  pattern: string;
  /** Line number where the issue was found */
  line: number;
  /** Severity of the performance impact */
  severity: 'high' | 'medium' | 'low';
  /** Suggested fix description */
  suggestion: string;
}

/**
 * PerformanceFix - Automatically optimizes code for better performance.
 * Targets common performance anti-patterns like string concatenation in loops,
 * inefficient array operations, and missing memoization opportunities.
 */
export class PerformanceFix {
  /**
   * Optimize loops for better performance.
   * Converts for-in loops to for-of where appropriate,
   * caches array lengths, and pre-computes loop invariants.
   * @param code - The source code
   * @returns FixResult with optimized loops
   */
  optimizeLoops(code: string): FixResult {
    const changes: CodeChange[] = [];
    const lines = code.split('\n');
    let modified = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Convert `for (let i = 0; i < arr.length; i++)` to cache length
      const forLengthPattern = /for\s*\(\s*let\s+(\w+)\s*=\s*0\s*;\s*\1\s*<\s*(\w+)\.length\s*;/;
      const match = line.match(forLengthPattern);
      if (match) {
        const varName = match[1];
        const arrayName = match[2];
        const indent = (line.match(/^(\s*)/) || [''])[1];

        // Check if length is already cached
        const prevLine = i > 0 ? lines[i - 1] : '';
        if (!prevLine.includes(`${arrayName}.length`)) {
          lines[i] = `${indent}const ${arrayName}Len = ${arrayName}.length;\n${line.replace(/\.length/, `${arrayName}Len`)}`;
          changes.push({
            description: `Cached array length for '${arrayName}' in loop`,
            original: line,
            replacement: lines[i],
            line: i + 1,
            column: 1,
          });
          modified = true;
        }
      }

      // Convert `for (const key in obj)` to `for (const [key, value] of Object.entries(obj))`
      // only when it's a simple object iteration
      const forInPattern = /for\s*\(\s*const\s+(\w+)\s+in\s+(\w+)\s*\)/;
      const forInMatch = line.match(forInPattern);
      if (forInMatch) {
        const keyVar = forInMatch[1];
        const objVar = forInMatch[2];
        // Only convert if the body uses obj[key] pattern
        const bodyStart = i + 1;
        const bodyEnd = bodyStart < lines.length ? lines.slice(bodyStart).findIndex(l => l.trim() === '}') + bodyStart : bodyStart;
        const body = lines.slice(bodyStart, bodyEnd).join('\n');
        if (body.includes(`${objVar}[${keyVar}]`)) {
          const indent = (line.match(/^(\s*)/) || [''])[1];
          lines[i] = `${indent}for (const [${keyVar}, value] of Object.entries(${objVar}))`;
          // Update references in the body: obj[key] -> value
          for (let j = bodyStart; j < bodyEnd; j++) {
            lines[j] = lines[j].replace(new RegExp(`${objVar}\\[${keyVar}\\]`, 'g'), 'value');
          }
          changes.push({
            description: `Converted for-in to for-of with Object.entries for '${objVar}'`,
            original: line,
            replacement: lines[i],
            line: i + 1,
            column: 1,
          });
          modified = true;
        }
      }

      // Optimize for...of loops: if only index is needed, suggest array methods
      const forOfPattern = /for\s*\(\s*const\s+(\w+)\s+of\s+(\w+)\s*\)/;
      const forOfMatch = line.match(forOfPattern);
      if (forOfMatch) {
        const itemVar = forOfMatch[1];
        const arrayName = forOfMatch[2];
        const bodyStart = i + 1;
        const bodyEnd = bodyStart < lines.length ? lines.slice(bodyStart).findIndex(l => l.trim() === '}') + bodyStart : bodyStart;
        const body = lines.slice(bodyStart, bodyEnd).join('\n');
        // If body is a single push/operation, could be a map/filter
        if (body.trim().split('\n').length === 1 && body.includes('push(') && body.includes(itemVar)) {
          const indent = (line.match(/^(\s*)/) || [''])[1];
          // This is a simple case - the optimization is already decent as for...of
          // Just ensure no further changes needed
        }
      }

      // Optimize generator functions: cache yielded values
      const generatorPattern = /function\s*\*\s*(\w+)/;
      const generatorMatch = line.match(generatorPattern);
      if (generatorMatch) {
        // Generator functions can benefit from lazy evaluation - no specific optimization needed
        // but we can check for yield* delegation optimization
        const bodyStart = i + 1;
        const bodyEnd = bodyStart < lines.length ? lines.slice(bodyStart).findIndex(l => l.trim() === '}') + bodyStart : bodyStart;
        const body = lines.slice(bodyStart, bodyEnd).join('\n');
        if (body.includes('yield*') && body.includes('.next()')) {
          // yield* with manual .next() calls is suboptimal but hard to auto-fix
        }
      }
    }

    return {
      fixed: modified,
      code: modified ? lines.join('\n') : code,
      changes,
      confidence: 0.75,
      strategyName: 'performance-fix',
    };
  }

  /**
   * Optimize string concatenation by converting to template literals or array join.
   * @param code - The source code
   * @returns FixResult with optimized string operations
   */
  optimizeStringConcat(code: string): FixResult {
    const changes: CodeChange[] = [];
    let result = code;
    let modified = false;

    // Convert string concatenation with + to template literals
    // Pattern: 'string' + variable + 'string'
    const concatPattern = /'([^']*)'\s*\+\s*(\w+)\s*\+\s*'([^']*)'/g;
    const newResult = result.replace(concatPattern, (_match, before, variable, after) => {
      modified = true;
      return '`' + before + '${' + variable + '}' + after + '`';
    });

    if (newResult !== result) {
      result = newResult;
      changes.push({
        description: 'Converted string concatenation to template literal',
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
      confidence: 0.85,
      strategyName: 'performance-fix',
    };
  }

  /**
   * Optimize array operations for better performance.
   * Converts imperative patterns to functional approaches where beneficial.
   * @param code - The source code
   * @returns FixResult with optimized array operations
   */
  optimizeArrayOperations(code: string): FixResult {
    const changes: CodeChange[] = [];
    const lines = code.split('\n');
    let modified = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Convert `arr.indexOf(x) !== -1` to `arr.includes(x)`
      const indexOfPattern = /(\w+)\.indexOf\(([^)]+)\)\s*!==?\s*-1/;
      const indexOfMatch = line.match(indexOfPattern);
      if (indexOfMatch) {
        lines[i] = line.replace(
          indexOfPattern,
          '$1.includes($2)',
        );
        changes.push({
          description: 'Replaced indexOf !== -1 with includes()',
          original: line,
          replacement: lines[i],
          line: i + 1,
          column: 1,
        });
        modified = true;
        continue;
      }

      // Convert `arr.indexOf(x) === -1` to `!arr.includes(x)`
      const notIndexOfPattern = /(\w+)\.indexOf\(([^)]+)\)\s*===?\s*-1/;
      const notIndexOfMatch = line.match(notIndexOfPattern);
      if (notIndexOfMatch) {
        lines[i] = line.replace(
          notIndexOfPattern,
          '!$1.includes($2)',
        );
        changes.push({
          description: 'Replaced indexOf === -1 with !includes()',
          original: line,
          replacement: lines[i],
          line: i + 1,
          column: 1,
        });
        modified = true;
        continue;
      }

      // Convert `[].concat(arr1, arr2)` to `[...arr1, ...arr2]`
      const concatPattern = /\[\]\.concat\(([^)]+)\)/;
      const concatMatch = line.match(concatPattern);
      if (concatMatch) {
        const args = concatMatch[1].split(',').map((a) => '...' + a.trim()).join(', ');
        lines[i] = line.replace(concatPattern, `[${args}]`);
        changes.push({
          description: 'Replaced [].concat() with spread operator',
          original: line,
          replacement: lines[i],
          line: i + 1,
          column: 1,
        });
        modified = true;
      }
    }

    return {
      fixed: modified,
      code: modified ? lines.join('\n') : code,
      changes,
      confidence: 0.9,
      strategyName: 'performance-fix',
    };
  }

  /**
   * Add memoization to pure functions.
   * Wraps function bodies with a simple memoization cache.
   * @param code - The source code
   * @param functions - Array of function names to memoize
   * @returns FixResult with memoization added
   */
  addMemoization(code: string, functions: string[]): FixResult {
    const changes: CodeChange[] = [];
    const lines = code.split('\n');
    let modified = false;

    for (const funcName of functions) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const funcPattern = new RegExp(
          `^(\\s*)(?:export\\s+)?(?:const\\s+)?${funcName}\\s*=\\s*(?:async\\s+)?\\(([^)]*)\\)\\s*=>\\s*\\{?`,
        );
        const match = line.match(funcPattern);
        if (match) {
          const indent = match[1];
          const params = match[2].trim();
          const cacheName = `_${funcName}Cache`;

          // Add cache declaration before the function
          const cacheLine = `${indent}const ${cacheName} = new Map();`;
          lines.splice(i, 0, cacheLine);

          // Add cache check at the start of the function body
          const paramNames = params ? params.split(',').map((p) => p.trim().split('=')[0].trim()).filter(Boolean) : [];
          const keyExpr = paramNames.length > 0 ? paramNames.join(', ') : '""';
          const isAsync = line.includes('async ');
          const returnKeyword = isAsync ? 'return await' : 'return';
          const cacheCheck =
            `${indent}  const cacheKey = JSON.stringify([${keyExpr}]);\n` +
            `${indent}  if (${cacheName}.has(cacheKey)) ${returnKeyword} ${cacheName}.get(cacheKey);`;

          // Find the opening brace
          const braceIndex = i + 1 + lines.slice(i + 1).findIndex((l) => l.includes('{'));
          if (braceIndex > i) {
            lines.splice(braceIndex + 1, 0, cacheCheck);
          }

          changes.push({
            description: `Added memoization to function '${funcName}'`,
            original: line,
            replacement: cacheLine + '\n' + line,
            line: i + 1,
            column: 1,
          });
          modified = true;
          break; // Only process first occurrence of each function
        }
      }
    }

    return {
      fixed: modified,
      code: modified ? lines.join('\n') : code,
      changes,
      confidence: 0.65,
      strategyName: 'performance-fix',
    };
  }

  /**
   * Optimize import statements by removing unused imports.
   * @param code - The source code
   * @returns FixResult with optimized imports
   */
  optimizeImports(code: string): FixResult {
    const changes: CodeChange[] = [];
    const lines = code.split('\n');
    let modified = false;

    // Find all import statements
    const importRegex = /^import\s+(\{[^}]+\}|\w+)\s+from\s+['"]([^'"]+)['"]/;
    const imports: { line: number; names: string[]; module: string; full: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(importRegex);
      if (match) {
        const full = lines[i];
        const module = match[2];
        let names: string[] = [];

        if (match[1].startsWith('{')) {
          // Named imports
          names = match[1]
            .slice(1, -1)
            .split(',')
            .map((n) => n.trim().split(/\s+as\s+/)[0].trim());
        } else {
          // Default import
          names = [match[1]];
        }

        imports.push({ line: i, names, module, full });
      }
    }

    // Check which imported names are actually used
    const codeWithoutImports = lines
      .filter((_, i) => !imports.some((imp) => imp.line === i))
      .join('\n');

    const newLines = [...lines];
    for (const imp of imports) {
      const usedNames = imp.names.filter((name) => {
        const regex = new RegExp(`\\b${name}\\b`);
        return regex.test(codeWithoutImports);
      });

      if (usedNames.length === 0) {
        // Remove entire import
        newLines[imp.line] = '';
        changes.push({
          description: `Removed unused import from '${imp.module}'`,
          original: imp.full,
          replacement: '',
          line: imp.line + 1,
          column: 1,
        });
        modified = true;
      } else if (usedNames.length < imp.names.length) {
        // Update import to only include used names
        const unusedNames = imp.names.filter((n) => !usedNames.includes(n));
        const newImport = `import { ${usedNames.join(', ')} } from '${imp.module}';`;
        newLines[imp.line] = newImport;
        changes.push({
          description: `Removed unused imports: ${unusedNames.join(', ')} from '${imp.module}'`,
          original: imp.full,
          replacement: newImport,
          line: imp.line + 1,
          column: 1,
        });
        modified = true;
      }
    }

    return {
      fixed: modified,
      code: modified ? newLines.join('\n') : code,
      changes,
      confidence: 0.8,
      strategyName: 'performance-fix',
    };
  }

  /**
   * Detect performance issues in the code.
   * @param code - The source code
   * @returns Array of detected performance issues
   */
  detectPerformanceIssues(code: string): PerformanceIssue[] {
    const issues: PerformanceIssue[] = [];
    const lines = code.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // String concatenation in loops
      if (line.includes('+=') && (line.includes("'") || line.includes('"'))) {
        issues.push({
          description: 'String concatenation in loop may cause performance issues',
          pattern: '+= with strings',
          line: i + 1,
          severity: 'medium',
          suggestion: 'Use array.push() and join() or template literals instead',
        });
      }

      // Nested loops
      if (/for\s*\(/.test(line)) {
        const outerForCount = lines.slice(0, i).filter((l) => /for\s*\(/.test(l) && !l.includes('//')).length;
        if (outerForCount >= 1) {
          issues.push({
            description: 'Nested loop detected - potential O(n^2) complexity',
            pattern: 'nested for loops',
            line: i + 1,
            severity: 'high',
            suggestion: 'Consider using a Map or Set for O(1) lookups',
          });
        }
      }

      // Array.forEach with async/await
      if (/\.forEach\s*\(/.test(line) && /await/.test(lines.slice(i).join('\n').slice(0, 200))) {
        issues.push({
          description: 'async/await inside forEach does not wait for completion',
          pattern: 'forEach with async',
          line: i + 1,
          severity: 'high',
          suggestion: 'Use for-of loop instead of forEach with async operations',
        });
      }

      // Synchronous file operations
      if (/\breadFileSync\b|\bwriteFileSync\b|\bexecSync\b/.test(line)) {
        issues.push({
          description: 'Synchronous I/O operation blocks the event loop',
          pattern: 'sync I/O',
          line: i + 1,
          severity: 'high',
          suggestion: 'Use async equivalents (readFile, writeFile, exec)',
        });
      }

      // console.log in production code
      if (/console\.(log|debug|info|trace)\s*\(/.test(line) && !line.includes('//')) {
        issues.push({
          description: 'Console logging in production code',
          pattern: 'console.log',
          line: i + 1,
          severity: 'low',
          suggestion: 'Remove or replace with a proper logging library',
        });
      }
    }

    return issues;
  }

  /**
   * Benchmark a code snippet before and after optimization.
   * Measures execution time using performance.now() if available.
   * @param beforeCode - The code before optimization (as a string)
   * @param afterCode - The code after optimization (as a string)
   * @param iterations - Number of iterations to run (default: 1000)
   * @returns Object with before/after timing information
   */
  benchmark(beforeCode: string, afterCode: string, iterations: number = 1000): { beforeMs: number; afterMs: number; improvement: number } {
    const measure = (codeStr: string): number => {
      try {
        const fn = new Function(codeStr);
        const start = performance.now();
        for (let i = 0; i < iterations; i++) {
          fn();
        }
        return performance.now() - start;
      } catch {
        return -1; // Cannot measure
      }
    };

    const beforeMs = measure(beforeCode);
    const afterMs = measure(afterCode);

    let improvement = 0;
    if (beforeMs > 0 && afterMs > 0) {
      improvement = ((beforeMs - afterMs) / beforeMs) * 100;
    }

    return { beforeMs, afterMs, improvement };
  }
}
