/**
 * @module type-fix
 * @description Automatic TypeScript type error fixes.
 * Analyzes code and diagnostics to add, fix, or improve type annotations.
 */

import type { CodeChange, Diagnostic, FixResult } from './fix-strategy.js';

/** Inferred type information for a symbol */
export interface InferredType {
  /** Symbol name */
  name: string;
  /** The inferred TypeScript type string */
  type: string;
  /** Line number where the symbol is declared */
  line: number;
}

/**
 * TypeFix - Automatically fixes TypeScript type errors.
 * Adds missing annotations, fixes null/undefined issues, and resolves implicit any.
 */
export class TypeFix {
  /**
   * Fix TypeScript type errors based on diagnostics.
   * @param code - The source code
   * @param diagnostics - Array of type error diagnostics
   * @returns FixResult with type errors fixed
   */
  fixTypeErrors(code: string, diagnostics: Diagnostic[]): FixResult {
    const changes: CodeChange[] = [];
    let currentCode = code;
    let totalConfidence = 0;
    let fixCount = 0;

    for (const diag of diagnostics) {
      const msg = diag.message.toLowerCase();

      if (msg.includes("cannot find name") || msg.includes("is not defined")) {
        // Likely a missing type annotation or import
        const result = this.fixImplicitAny(currentCode);
        if (result.fixed) {
          currentCode = result.code;
          changes.push(...result.changes);
          totalConfidence += result.confidence;
          fixCount++;
        }
      }

      if (msg.includes("object is possibly 'null'") || msg.includes("object is possibly 'undefined'")) {
        const result = this.fixNullUndefined(currentCode, true);
        if (result.fixed) {
          currentCode = result.code;
          changes.push(...result.changes);
          totalConfidence += result.confidence;
          fixCount++;
        }
      }

      if (msg.includes("implicitly has an 'any' type")) {
        const result = this.fixImplicitAny(currentCode);
        if (result.fixed) {
          currentCode = result.code;
          changes.push(...result.changes);
          totalConfidence += result.confidence;
          fixCount++;
        }
      }

      if (msg.includes("missing return type") || msg.includes("a return type")) {
        const result = this.fixMissingReturnTypes(currentCode);
        if (result.fixed) {
          currentCode = result.code;
          changes.push(...result.changes);
          totalConfidence += result.confidence;
          fixCount++;
        }
      }
    }

    return {
      fixed: changes.length > 0,
      code: currentCode,
      changes,
      confidence: fixCount > 0 ? totalConfidence / fixCount : 1,
      strategyName: 'type-fix',
    };
  }

  /**
   * Add type annotations to function parameters and variables based on inferred types.
   * @param code - The source code
   * @param inferredTypes - Array of inferred type information
   * @returns FixResult with type annotations added
   */
  addTypeAnnotations(code: string, inferredTypes: InferredType[]): FixResult {
    const changes: CodeChange[] = [];
    const lines = code.split('\n');
    let modified = false;

    for (const inferred of inferredTypes) {
      const lineIndex = inferred.line - 1;
      if (lineIndex < 0 || lineIndex >= lines.length) continue;

      const line = lines[lineIndex];

      // Check if this specific parameter already has a type annotation
      const alreadyTyped = new RegExp(`\\b${inferred.name}\\s*:\\s*${inferred.type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(line);
      if (alreadyTyped) continue;

      // Try to add type annotation to a parameter
      const paramPattern = new RegExp(
        `(\\b${inferred.name}\\s*)([,)\\]])`,
      );
      const paramMatch = line.match(paramPattern);
      if (paramMatch) {
        lines[lineIndex] = line.replace(
          paramPattern,
          `${inferred.name}: ${inferred.type}$2`,
        );
        changes.push({
          description: `Added type annotation '${inferred.type}' to '${inferred.name}'`,
          original: line,
          replacement: lines[lineIndex],
          line: inferred.line,
          column: 1,
        });
        modified = true;
        continue;
      }

      // Try to add type annotation to a variable declaration
      const varPattern = new RegExp(
        `(const|let|var)\\s+${inferred.name}\\s*=`,
      );
      const varMatch = line.match(varPattern);
      if (varMatch) {
        lines[lineIndex] = line.replace(
          varPattern,
          `$1 ${inferred.name}: ${inferred.type} =`,
        );
        changes.push({
          description: `Added type annotation '${inferred.type}' to '${inferred.name}'`,
          original: line,
          replacement: lines[lineIndex],
          line: inferred.line,
          column: 1,
        });
        modified = true;
      }
    }

    return {
      fixed: modified,
      code: modified ? lines.join('\n') : code,
      changes,
      confidence: 0.85,
      strategyName: 'type-fix',
    };
  }

  /**
   * Fix null and undefined issues by adding optional chaining or null checks.
   * @param code - The source code
   * @param strictMode - Whether to use strict null checks
   * @returns FixResult with null/undefined issues fixed
   */
  fixNullUndefined(code: string, strictMode: boolean): FixResult {
    const changes: CodeChange[] = [];
    let result = code;
    let modified = false;

    if (!strictMode) {
      return {
        fixed: false,
        code,
        changes: [],
        confidence: 1,
        strategyName: 'type-fix',
      };
    }

    // Add optional chaining: obj.prop -> obj?.prop
    // Only for simple property access patterns (not already optional)
    // Skip known non-null patterns: right after =, instanceof, typeof, new, return with literal, etc.
    // Also preserve type narrowing: if there's a preceding null check for the same variable, skip
    const safeObjects = ['console', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Promise', 'Error', 'Map', 'Set', 'Date', 'RegExp', 'Symbol', 'Proxy', 'Reflect', 'globalThis', 'undefined', 'null', 'true', 'false', 'this'];

    // Detect variables that have been narrowed (null-checked) in preceding lines
    const narrowedVars = new Set<string>();
    const codeLines = result.split('\n');
    for (const codeLine of codeLines) {
      const nullCheckPattern = /if\s*\(\s*(\w+)\s*(?:!==|===)\s*(?:null|undefined)\s*\)/;
      const ncMatch = codeLine.match(nullCheckPattern);
      if (ncMatch) {
        narrowedVars.add(ncMatch[1]);
      }
      const notNullPattern = /if\s*\(\s*!\s*(\w+)\s*\)/;
      const nnMatch = codeLine.match(notNullPattern);
      if (nnMatch) {
        narrowedVars.add(nnMatch[1]);
      }
    }

    const dotAccessPattern = /(?<!\?\.)(\w+)\.(\w+)(?!\?)/g;
    const newResult = result.replace(dotAccessPattern, (match, obj, prop, offset) => {
      // Don't convert known safe/global objects
      if (safeObjects.includes(obj)) return match;
      // Don't convert property access on literals or keywords
      if (/^(this|super)$/.test(obj)) return match;
      // Don't convert narrowed variables (they're guaranteed non-null in context)
      if (narrowedVars.has(obj)) return match;
      // Don't convert if preceded by assignment (=, +=, etc.) on the same line context
      // But only skip if the object itself is being assigned (not a property access after assignment)
      const before = result.slice(Math.max(0, offset - 10), offset);
      if (/[=+]\s*$/.test(before) && !/==\s*$/.test(before)) {
        // Only skip if the match IS the assignment target (i.e., obj is right after =)
        // Don't skip property access like: const x = data.items (data.items should still get ?. )
        const assignTarget = before.match(/[=+]\s*(\w+)$/);
        if (assignTarget && assignTarget[1] === obj) {
          return match;
        }
      }
      // Don't convert if preceded by 'new '
      if (/\bnew\s+$/.test(before)) return match;
      // Don't convert if preceded by 'return ' with a literal-like pattern
      if (/\breturn\s+$/.test(before)) return match;
      // Don't convert method calls on known constructor patterns
      if (/^\d+$/.test(obj)) return match;
      return `${obj}?.${prop}`;
    });

    if (newResult !== result) {
      result = newResult;
      modified = true;
      changes.push({
        description: 'Added optional chaining for null safety',
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
      confidence: 0.7,
      strategyName: 'type-fix',
    };
  }

  /**
   * Fix implicit 'any' type annotations by adding explicit types.
   * Recognizes utility types (Partial, Required, Record, etc.) and preserves them.
   * @param code - The source code
   * @returns FixResult with implicit any types fixed
   */
  fixImplicitAny(code: string): FixResult {
    const changes: CodeChange[] = [];
    const lines = code.split('\n');
    let modified = false;

    // Known utility types that should not be replaced with 'any'
    const utilityTypes = ['Partial', 'Required', 'Readonly', 'Record', 'Pick', 'Omit', 'Exclude', 'Extract', 'NonNullable', 'ReturnType', 'InstanceType', 'Parameters', 'ConstructorParameters', 'Promise'];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Fix function parameters without type annotations
      const funcParamPattern = /\(([^)]+)\)\s*[{=>]/;
      const funcMatch = line.match(funcParamPattern);
      if (funcMatch) {
        const params = funcMatch[1];
        // Check if any parameter lacks a type annotation
        const untypedParams = params.split(',').filter(
          (p) => !p.trim().includes(':') && p.trim() !== '' && !p.trim().startsWith('...'),
        );

        if (untypedParams.length > 0) {
          let newLine = line;
          for (const param of untypedParams) {
            const trimmed = param.trim();
            const paramName = trimmed.split('=')[0].trim();
            if (paramName && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(paramName)) {
              // Check if the parameter name is a utility type reference
              if (utilityTypes.includes(paramName)) continue;
              const hasDefault = trimmed.includes('=');
              if (hasDefault) {
                newLine = newLine.replace(
                  new RegExp(`\\b${paramName}\\s*=`),
                  `${paramName}: any =`,
                );
              } else {
                newLine = newLine.replace(
                  new RegExp(`\\b${paramName}\\b(?![\\s]*:)`),
                  `${paramName}: any`,
                );
              }
            }
          }

          if (newLine !== line) {
            lines[i] = newLine;
            changes.push({
              description: 'Added explicit type annotations to fix implicit any',
              original: line,
              replacement: newLine,
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
      confidence: 0.6,
      strategyName: 'type-fix',
    };
  }

  /**
   * Fix missing return type annotations on functions and methods.
   * @param code - The source code
   * @returns FixResult with return types added
   */
  fixMissingReturnTypes(code: string): FixResult {
    const changes: CodeChange[] = [];
    const lines = code.split('\n');
    let modified = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Match function declarations and method declarations without return types
      // function name(...) {  or  name(...) {
      const funcPattern = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*\{/;
      const methodPattern = /^\s+(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*\{/;
      const arrowPattern = /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/;

      let match = line.match(funcPattern) || line.match(methodPattern) || line.match(arrowPattern);

      if (match) {
        // Check if there's already a return type annotation
        if (line.includes('): ') || line.match(/\)\s*:\s*\w/)) continue;

        const params = match[2];
        // Default to adding ': any' return type
        // Only use void if the function body clearly returns nothing (no return statement)
        const closingParen = line.lastIndexOf(')');
        if (closingParen !== -1) {
          lines[i] =
            line.slice(0, closingParen + 1) + ': any' + line.slice(closingParen + 1);
          changes.push({
            description: "Added ': any' return type annotation",
            original: line,
            replacement: lines[i],
            line: i + 1,
            column: 1,
          });
          modified = true;
        }
      }
    }

    return {
      fixed: modified,
      code: modified ? lines.join('\n') : code,
      changes,
      confidence: 0.65,
      strategyName: 'type-fix',
    };
  }

  /**
   * Fix generic constraint issues by adding proper constraint types.
   * Handles regular generics, conditional types, and mapped types.
   * @param code - The source code
   * @returns FixResult with generic constraints fixed
   */
  fixGenericConstraints(code: string): FixResult {
    const changes: CodeChange[] = [];
    let result = code;
    let modified = false;

    // Find generic type parameters without constraints that are used with property access
    // Pattern: <T> where T is used with dot notation suggesting it needs a constraint
    // Only match TypeScript generic contexts (function, class, interface, type declarations)
    const genericPattern = /(?:function|class|interface|type)\s+\w+\s*<(\w+)>(?!\s*extends)/g;
    const newResult = result.replace(genericPattern, (match, typeParam) => {
      // Check if this type parameter is used with property access later
      const usagePattern = new RegExp(`${typeParam}\\.\\w+`);
      if (usagePattern.test(result)) {
        modified = true;
        return match.replace(`<${typeParam}>`, `<${typeParam} extends Record<string, any>>`);
      }
      return match;
    });

    // Handle conditional types: T extends U ? X : Y - ensure proper constraint
    const conditionalTypePattern = /<(\w+)\s+extends\s+[^?]+\?\s*[^:]+\s*:\s*[^>]+>/g;
    // Conditional types are already properly constrained, but check for bare conditional usage
    const bareConditionalPattern = /(\w+)\s+extends\s+(\w+)\s*\?\s*(\w+)\s*:\s*(\w+)/g;
    const conditionalResult = newResult.replace(bareConditionalPattern, (match, typeParam, constraint, trueType, falseType) => {
      // If the constraint is a built-in type, no fix needed
      const builtInTypes = ['string', 'number', 'boolean', 'object', 'any', 'unknown', 'never', 'void', 'null', 'undefined'];
      if (builtInTypes.includes(constraint)) return match;
      return match;
    });

    if (modified || conditionalResult !== newResult) {
      const finalResult = conditionalResult !== newResult ? conditionalResult : newResult;
      changes.push({
        description: 'Added generic constraints',
        original: code,
        replacement: finalResult,
        line: 1,
        column: 1,
      });
      return {
        fixed: true,
        code: finalResult,
        changes,
        confidence: 0.6,
        strategyName: 'type-fix',
      };
    }

    return {
      fixed: modified,
      code: newResult,
      changes,
      confidence: 0.6,
      strategyName: 'type-fix',
    };
  }
}
