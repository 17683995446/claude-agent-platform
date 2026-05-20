/**
 * @module compatibility-fix
 * @description Cross-version compatibility fixes for JavaScript/TypeScript code.
 * Ensures code works across different ES versions, Node.js versions, and browsers.
 */

import type { CodeChange, FixResult } from './fix-strategy.js';

/** Target environment specification */
export interface CompatTarget {
  /** ECMAScript version (e.g., 'ES2015', 'ES2020', 'ESNext') */
  esVersion?: string;
  /** Minimum Node.js version (e.g., '14.0.0') */
  nodeVersion?: string;
  /** Target browsers (e.g., ['chrome >= 90', 'firefox >= 88']) */
  browsers?: string[];
}

/** A compatibility issue report */
export interface CompatReport {
  /** The target environment */
  targets: CompatTarget;
  /** Array of compatibility issues found */
  issues: CompatIssue[];
  /** Suggested polyfills */
  polyfills: string[];
  /** Overall compatibility score (0-100) */
  score: number;
}

/** A single compatibility issue */
export interface CompatIssue {
  /** Description of the issue */
  description: string;
  /** The incompatible API or syntax */
  api: string;
  /** Line number where found */
  line: number;
  /** Severity of the incompatibility */
  severity: 'error' | 'warning';
  /** Suggested fix */
  suggestion: string;
}

/**
 * CompatibilityFix - Fixes cross-version compatibility issues.
 * Transforms modern JavaScript to work in older environments and suggests polyfills.
 */
export class CompatibilityFix {
  /**
   * Fix ECMAScript version compatibility issues.
   * Downgrades modern syntax to older ES versions.
   * @param code - The source code
   * @param targetVersion - The target ES version (e.g., 'ES2015', 'ES2017')
   * @returns FixResult with compatibility fixes applied
   */
  fixESVersionCompat(code: string, targetVersion: string): FixResult {
    const changes: CodeChange[] = [];
    let result = code;
    let modified = false;

    const targetYear = parseInt(targetVersion.replace('ES', ''), 10) || 2015;

    // Optional chaining (ES2020) -> conditional checks
    if (targetYear < 2020) {
      const optionalChainingPattern = /(\w+)\?\.(\w+)/g;
      const newResult = result.replace(optionalChainingPattern, (_match, obj, prop) => {
        modified = true;
        return `(${obj} !== null && ${obj} !== undefined ? ${obj}.${prop} : undefined)`;
      });
      if (newResult !== result) {
        result = newResult;
        changes.push({
          description: 'Replaced optional chaining with conditional checks for ES compatibility',
          original: code,
          replacement: result,
          line: 1,
          column: 1,
        });
      }
    }

    // Nullish coalescing (ES2020) -> conditional expression
    if (targetYear < 2020) {
      const nullishPattern = /(\w+(?:\.\w+)*)\s*\?\?\s*([^;,\n)}\]]+)/g;
      const newResult = result.replace(nullishPattern, (_match, varExpr, defaultVal) => {
        modified = true;
        return `(${varExpr} != null ? ${varExpr} : ${defaultVal.trim()})`;
      });
      if (newResult !== result) {
        result = newResult;
        changes.push({
          description: 'Replaced nullish coalescing with ternary for ES compatibility',
          original: code,
          replacement: result,
          line: 1,
          column: 1,
        });
      }
    }

    // Object spread (ES2018) -> Object.assign
    if (targetYear < 2018) {
      const spreadPattern = /\{\s*\.\.\.(\w+)/g;
      const newResult = result.replace(spreadPattern, (_match, obj) => {
        modified = true;
        return `Object.assign({}, ${obj})`;
      });
      if (newResult !== result) {
        result = newResult;
        changes.push({
          description: 'Replaced object spread with Object.assign for ES compatibility',
          original: code,
          replacement: result,
          line: 1,
          column: 1,
        });
      }
    }

    // Async/await (ES2017) -> Promise chains
    if (targetYear < 2017) {
      // Simple heuristic: flag async functions but don't auto-convert
      // (full conversion requires AST analysis)
      if (result.includes('async ') || result.includes('await ')) {
        changes.push({
          description: 'Code uses async/await which requires ES2017+',
          original: '',
          replacement: '',
          line: 1,
          column: 1,
        });
      }
    }

    return {
      fixed: modified,
      code: result,
      changes,
      confidence: 0.7,
      strategyName: 'compatibility-fix',
    };
  }

  /**
   * Fix Node.js version compatibility issues.
   * Replaces APIs not available in the target Node.js version.
   * @param code - The source code
   * @param minVersion - Minimum Node.js version (e.g., '14.0.0')
   * @returns FixResult with Node.js compatibility fixes
   */
  fixNodeVersionCompat(code: string, minVersion: string): FixResult {
    const changes: CodeChange[] = [];
    let result = code;
    let modified = false;

    const majorVersion = parseInt(minVersion.split('.')[0], 10) || 14;

    // fs/promises (Node 14+) -> util.promisify
    if (majorVersion < 14) {
      const fsPromisesPattern = /import\s+\{([^}]+)\}\s+from\s+['"]fs\/promises['"]/;
      const match = result.match(fsPromisesPattern);
      if (match) {
        const apis = match[1].trim();
        const apiList = apis.split(',').map(a => a.trim());
        // Generate promisified wrappers for known fs APIs, with fallback for unknown ones
        const knownFsApis = ['readFile', 'writeFile', 'appendFile', 'copyFile', 'unlink', 'readdir', 'stat', 'mkdir', 'rmdir', 'rename', 'access', 'chmod', 'chown'];
        const wrappers = apiList.map(api => {
          if (knownFsApis.includes(api)) {
            return `${api}: promisify(fs.${api})`;
          }
          return `${api}: promisify(fs.${api} || function() {})`;
        }).join(', ');
        result = result.replace(
          fsPromisesPattern,
          `import fs from 'fs';\nimport { promisify } from 'util';\nconst { ${apis} } = { ${wrappers} };`,
        );
        modified = true;
        changes.push({
          description: 'Replaced fs/promises with util.promisify for older Node.js',
          original: match[0],
          replacement: 'util.promisify wrapper',
          line: 1,
          column: 1,
        });
      }
    }

    // globalThis (Node 12+) -> global or self or window
    if (majorVersion < 12 && result.includes('globalThis')) {
      result = result.replace(/globalThis/g, 'global');
      modified = true;
      changes.push({
        description: "Replaced 'globalThis' with 'global' for older Node.js",
        original: 'globalThis',
        replacement: 'global',
        line: 1,
        column: 1,
      });
    }

    // structuredClone (Node 17+) -> JSON.parse(JSON.stringify())
    if (majorVersion < 17 && result.includes('structuredClone')) {
      // Use balanced paren matching to handle nested parentheses
      result = this.replaceBalancedCall(result, 'structuredClone', (args) => {
        return `JSON.parse(JSON.stringify(${args}))`;
      });
      modified = true;
      changes.push({
        description: 'Replaced structuredClone with JSON serialization for older Node.js',
        original: 'structuredClone',
        replacement: 'JSON.parse(JSON.stringify())',
        line: 1,
        column: 1,
      });
    }

    return {
      fixed: modified,
      code: result,
      changes,
      confidence: 0.75,
      strategyName: 'compatibility-fix',
    };
  }

  /**
   * Fix browser compatibility issues.
   * Replaces APIs not available in target browsers.
   * @param code - The source code
   * @param browsers - Target browser specifications (e.g., ['chrome >= 90', 'firefox >= 88'])
   * @returns FixResult with browser compatibility fixes
   */
  fixBrowserCompat(code: string, browsers: string[]): FixResult {
    const changes: CodeChange[] = [];
    let result = code;
    let modified = false;

    // Check if we need to support older browsers
    const needsOldSupport = browsers.some((b) => {
      const match = b.match(/(\w+)\s*>=?\s*(\d+)/);
      if (!match) return false;
      const version = parseInt(match[2], 10);
      if (match[1] === 'ie') return true;
      if (match[1] === 'safari' && version < 14) return true;
      if (match[1] === 'firefox' && version < 78) return true;
      if (match[1] === 'chrome' && version < 80) return true;
      return false;
    });

    if (needsOldSupport) {
      // Replace Array.at() with bracket notation
      if (result.includes('.at(')) {
        result = result.replace(
          /(\w+)\.at\((-?\d+)\)/g,
          (_match, arr, index) => {
            if (index === '0') return `${arr}[0]`;
            return `${arr}[${arr}.length + (${index})]`;
          },
        );
        modified = true;
        changes.push({
          description: 'Replaced Array.at() with bracket notation for browser compatibility',
          original: '.at(',
          replacement: '[length + ...]',
          line: 1,
          column: 1,
        });
      }

      // Replace Object.fromEntries() with reduce (ES2015-compatible, no spread)
      if (result.includes('Object.fromEntries')) {
        result = result.replace(
          /Object\.fromEntries\(([^)]+)\)/g,
          '$1.reduce(function(obj, entry) { obj[entry[0]] = entry[1]; return obj; }, {})',
        );
        modified = true;
        changes.push({
          description: 'Replaced Object.fromEntries with reduce for browser compatibility',
          original: 'Object.fromEntries',
          replacement: 'reduce-based implementation',
          line: 1,
          column: 1,
        });
      }

      // Replace globalThis with window/self
      if (result.includes('globalThis')) {
        result = result.replace(/globalThis/g, 'typeof window !== "undefined" ? window : typeof self !== "undefined" ? self : global');
        modified = true;
        changes.push({
          description: 'Replaced globalThis with environment detection',
          original: 'globalThis',
          replacement: 'window/self/global fallback',
          line: 1,
          column: 1,
        });
      }
    }

    return {
      fixed: modified,
      code: result,
      changes,
      confidence: 0.7,
      strategyName: 'compatibility-fix',
    };
  }

  /**
   * Add polyfill imports for missing APIs in the target environment.
   * @param code - The source code
   * @param targetEnv - The target environment description
   * @param polyfillStrategy - Optional polyfill strategy ('core-js', 'polyfill.io', 'manual'). Default: 'core-js'
   * @returns FixResult with polyfill imports added
   */
  polyfillMissingAPIs(code: string, targetEnv: string, polyfillStrategy: string = 'core-js'): FixResult {
    const changes: CodeChange[] = [];
    const polyfills: string[] = [];

    // Detect APIs that might need polyfilling
    if (code.includes('Promise.allSettled') && targetEnv === 'node12') {
      if (polyfillStrategy === 'core-js') {
        polyfills.push("import 'core-js/stable/promise/all-settled';");
      } else if (polyfillStrategy === 'polyfill.io') {
        polyfills.push("// Polyfill.io: Promise.allSettled - add <script src='https://polyfill.io/v3/polyfill.min.js?features=Promise.allSettled'> to HTML");
      } else {
        polyfills.push("// Manual polyfill needed for Promise.allSettled");
      }
    }
    if (code.includes('Object.fromEntries') && (targetEnv === 'ie11' || targetEnv === 'node10')) {
      if (polyfillStrategy === 'core-js') {
        polyfills.push("import 'core-js/stable/object/from-entries';");
      } else if (polyfillStrategy === 'polyfill.io') {
        polyfills.push("// Polyfill.io: Object.fromEntries - add to polyfill.io features");
      } else {
        polyfills.push("// Manual polyfill needed for Object.fromEntries");
      }
    }
    if (code.includes('Array.prototype.flatMap') && targetEnv === 'ie11') {
      if (polyfillStrategy === 'core-js') {
        polyfills.push("import 'core-js/stable/array/flat-map';");
      } else if (polyfillStrategy === 'polyfill.io') {
        polyfills.push("// Polyfill.io: Array.prototype.flatMap - add to polyfill.io features");
      } else {
        polyfills.push("// Manual polyfill needed for Array.prototype.flatMap");
      }
    }
    if (code.includes('String.prototype.matchAll') && targetEnv === 'ie11') {
      if (polyfillStrategy === 'core-js') {
        polyfills.push("import 'core-js/stable/string/match-all';");
      } else if (polyfillStrategy === 'polyfill.io') {
        polyfills.push("// Polyfill.io: String.prototype.matchAll - add to polyfill.io features");
      } else {
        polyfills.push("// Manual polyfill needed for String.prototype.matchAll");
      }
    }
    if (code.includes('structuredClone') && (targetEnv === 'node14' || targetEnv === 'node16')) {
      if (polyfillStrategy === 'core-js') {
        polyfills.push("import 'core-js/stable/structured-clone';");
      } else if (polyfillStrategy === 'polyfill.io') {
        polyfills.push("// Polyfill.io: structuredClone - add to polyfill.io features");
      } else {
        polyfills.push("// Manual polyfill needed for structuredClone");
      }
    }

    if (polyfills.length === 0) {
      return {
        fixed: false,
        code,
        changes: [],
        confidence: 1,
        strategyName: 'compatibility-fix',
      };
    }

    const polyfillBlock = polyfills.join('\n') + '\n';
    const newCode = polyfillBlock + code;

    changes.push({
      description: `Added ${polyfills.length} polyfill import(s) for target '${targetEnv}'`,
      original: '',
      replacement: polyfillBlock.trim(),
      line: 1,
      column: 1,
    });

    return {
      fixed: true,
      code: newCode,
      changes,
      confidence: 0.8,
      strategyName: 'compatibility-fix',
    };
  }

  /**
   * Generate a compatibility report for the given code and targets.
   * Includes migration suggestions for removed APIs.
   * @param code - The source code
   * @param targets - The target environments
   * @returns A detailed compatibility report
   */
  generateCompatReport(code: string, targets: CompatTarget): CompatReport {
    const issues: CompatIssue[] = [];
    const polyfills: string[] = [];
    const lines = code.split('\n');

    // Known removed/deprecated APIs with migration suggestions
    const removedAPIs: Record<string, string> = {
      'require.resolve': 'Use import.meta.resolve or createRequire',
      'fs.exists': 'Use fs.stat or fs.access',
      'fs.existsSync': 'Use fs.statSync or fs.accessSync',
      'new Buffer': 'Use Buffer.alloc, Buffer.allocUnsafe, or Buffer.from',
      'util.isArray': 'Use Array.isArray',
      'util.isRegExp': 'Use instanceof RegExp',
      'util.isDate': 'Use instanceof Date',
      'util.isError': 'Use instanceof Error',
      'util.isObject': 'Use typeof obj === "object" && obj !== null',
      'path.exists': 'Use fs.stat or fs.access',
      'zlib.inflateRawSync': 'Use zlib.inflateRaw (async) with callback',
      'events.EventEmitter.prototype.listenerCount': 'Use EventEmitter.prototype.listenerCount (getter)',
    };

    // Check ES version compatibility
    if (targets.esVersion) {
      const targetYear = parseInt(targets.esVersion.replace('ES', ''), 10) || 2015;

      if (targetYear < 2020) {
        if (code.includes('?.')) {
          issues.push({
            description: 'Optional chaining requires ES2020+',
            api: '?.',
            line: lines.findIndex((l) => l.includes('?.')) + 1,
            severity: 'error',
            suggestion: 'Use conditional checks instead',
          });
        }
        if (code.includes('??')) {
          issues.push({
            description: 'Nullish coalescing requires ES2020+',
            api: '??',
            line: lines.findIndex((l) => l.includes('??')) + 1,
            severity: 'error',
            suggestion: 'Use logical OR (||) instead',
          });
        }
      }

      if (targetYear < 2017) {
        if (code.includes('async ') || code.includes('await ')) {
          issues.push({
            description: 'Async/await requires ES2017+',
            api: 'async/await',
            line: lines.findIndex((l) => l.includes('async ') || l.includes('await ')) + 1,
            severity: 'error',
            suggestion: 'Use Promise chains instead',
          });
        }
      }

      if (targetYear < 2015) {
        if (code.includes('const ') || code.includes('let ')) {
          issues.push({
            description: 'let/const requires ES2015+',
            api: 'let/const',
            line: lines.findIndex((l) => /\b(const|let)\b/.test(l)) + 1,
            severity: 'error',
            suggestion: 'Use var instead',
          });
        }
        if (code.includes('=>')) {
          issues.push({
            description: 'Arrow functions require ES2015+',
            api: '=>',
            line: lines.findIndex((l) => l.includes('=>')) + 1,
            severity: 'error',
            suggestion: 'Use regular functions instead',
          });
        }
      }
    }

    // Check Node.js version compatibility
    if (targets.nodeVersion) {
      const majorVersion = parseInt(targets.nodeVersion.split('.')[0], 10) || 14;

      if (majorVersion < 14 && code.includes("from 'fs/promises'")) {
        issues.push({
          description: 'fs/promises requires Node.js 14+',
          api: 'fs/promises',
          line: lines.findIndex((l) => l.includes("fs/promises")) + 1,
          severity: 'error',
          suggestion: 'Use util.promisify instead',
        });
        polyfills.push('util.promisify wrapper for fs');
      }

      if (majorVersion < 17 && code.includes('structuredClone')) {
        issues.push({
          description: 'structuredClone requires Node.js 17+',
          api: 'structuredClone',
          line: lines.findIndex((l) => l.includes('structuredClone')) + 1,
          severity: 'warning',
          suggestion: 'Use JSON.parse(JSON.stringify()) instead',
        });
      }

      // Check for removed APIs
      for (const [api, suggestion] of Object.entries(removedAPIs)) {
        if (code.includes(api)) {
          const apiLine = lines.findIndex((l) => l.includes(api));
          issues.push({
            description: `'${api}' has been removed or deprecated`,
            api,
            line: apiLine + 1,
            severity: 'warning',
            suggestion,
          });
        }
      }
    }

    // Check browser compatibility
    if (targets.browsers && targets.browsers.length > 0) {
      const needsOldSupport = targets.browsers.some((b) => {
        const match = b.match(/(\w+)\s*>=?\s*(\d+)/);
        if (!match) return false;
        const version = parseInt(match[2], 10);
        if (match[1] === 'ie') return true;
        if (match[1] === 'safari' && version < 14) return true;
        if (match[1] === 'firefox' && version < 78) return true;
        if (match[1] === 'chrome' && version < 80) return true;
        return false;
      });

      if (needsOldSupport) {
        if (code.includes('.at(')) {
          issues.push({
            description: 'Array.at() not supported in older browsers',
            api: '.at()',
            line: lines.findIndex((l) => l.includes('.at(')) + 1,
            severity: 'error',
            suggestion: 'Use bracket notation with length calculation',
          });
        }
        if (code.includes('Object.fromEntries')) {
          issues.push({
            description: 'Object.fromEntries() not supported in older browsers',
            api: 'Object.fromEntries',
            line: lines.findIndex((l) => l.includes('Object.fromEntries')) + 1,
            severity: 'error',
            suggestion: 'Use Array.reduce() instead',
          });
        }
      }
    }

    // Calculate compatibility score
    const errorCount = issues.filter((i) => i.severity === 'error').length;
    const warningCount = issues.filter((i) => i.severity === 'warning').length;
    const score = Math.max(0, 100 - errorCount * 20 - warningCount * 5);

    return {
      targets,
      issues,
      polyfills,
      score,
    };
  }

  /**
   * Replace a function call using balanced parenthesis matching.
   * Handles nested parentheses in arguments correctly.
   * @param code - The source code
   * @param funcName - The function name to find
   * @param replacer - Function that takes the arguments string and returns the replacement
   * @returns The code with the function call replaced
   */
  private replaceBalancedCall(
    code: string,
    funcName: string,
    replacer: (args: string) => string,
  ): string {
    let result = '';
    let i = 0;
    const searchStr = funcName + '(';

    while (i < code.length) {
      const idx = code.indexOf(searchStr, i);
      if (idx === -1) {
        result += code.slice(i);
        break;
      }

      result += code.slice(i, idx);

      // Find the balanced closing paren
      const startArgs = idx + searchStr.length;
      let depth = 1;
      let endArgs = startArgs;
      while (endArgs < code.length && depth > 0) {
        if (code[endArgs] === '(') depth++;
        else if (code[endArgs] === ')') depth--;
        if (depth > 0) endArgs++;
      }

      const args = code.slice(startArgs, endArgs);
      result += replacer(args);
      i = endArgs + 1; // skip the closing paren
    }

    return result;
  }
}
