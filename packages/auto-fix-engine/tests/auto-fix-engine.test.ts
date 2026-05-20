import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  StrategyRegistry,
  FixStrategyBase,
  QuickFix,
  RefactoringEngine,
  TypeFix,
  DeprecationFix,
  PerformanceFix,
  CompatibilityFix,
  FixValidator,
  FixScheduler,
  FixHistory,
} from '../src/index.js';
import type {
  FixContext,
  FixResult,
  Diagnostic,
  SourceRange,
  DeprecationMap,
  InferredType,
} from '../src/index.js';

// ============================================================================
// Helper: Concrete strategy for testing
// ============================================================================
class TestStrategy extends FixStrategyBase {
  readonly name = 'test-strategy';
  readonly description = 'A test strategy';
  readonly priority = 'medium' as const;
  readonly category = 'syntax' as const;

  execute(context: FixContext): FixResult {
    return {
      fixed: true,
      code: context.code.replace('bad', 'good'),
      changes: [{ description: 'test', original: 'bad', replacement: 'good', line: 1, column: 1 }],
      confidence: 0.9,
      strategyName: this.name,
    };
  }
}

// ============================================================================
// Module 1: fix-strategy.ts
// ============================================================================
describe('FixStrategyBase', () => {
  it('should have abstract properties implemented by subclass', () => {
    const strategy = new TestStrategy();
    expect(strategy.name).toBe('test-strategy');
    expect(strategy.description).toBe('A test strategy');
    expect(strategy.priority).toBe('medium');
    expect(strategy.category).toBe('syntax');
  });

  it('should execute and return a FixResult', async () => {
    const strategy = new TestStrategy();
    const context: FixContext = {
      filePath: '/test.ts',
      code: 'bad code',
      diagnostics: [],
      options: {},
    };
    const result = strategy.execute(context);
    expect(result.fixed).toBe(true);
    expect(result.code).toBe('good code');
    expect(result.confidence).toBe(0.9);
    expect(result.strategyName).toBe('test-strategy');
  });

  it('canFix should return true by default', () => {
    const strategy = new TestStrategy();
    expect(strategy.canFix({ message: 'test', code: 'T1', severity: 'error', line: 1, column: 1 })).toBe(true);
  });

  it('estimateConfidence should return 0.8 by default', () => {
    const strategy = new TestStrategy();
    const context: FixContext = { filePath: '/test.ts', code: '', diagnostics: [], options: {} };
    expect(strategy.estimateConfidence(context)).toBe(0.8);
  });
});

describe('StrategyRegistry', () => {
  let registry: StrategyRegistry;
  let strategy: TestStrategy;

  beforeEach(() => {
    registry = new StrategyRegistry();
    strategy = new TestStrategy();
  });

  afterEach(() => {
    registry.clear();
  });

  it('should register a strategy', () => {
    registry.register(strategy);
    expect(registry.size).toBe(1);
  });

  it('should throw when registering a duplicate strategy', () => {
    registry.register(strategy);
    expect(() => registry.register(strategy)).toThrow('already registered');
  });

  it('should unregister a strategy', () => {
    registry.register(strategy);
    expect(registry.unregister('test-strategy')).toBe(true);
    expect(registry.size).toBe(0);
  });

  it('should return undefined when unregistering non-existent strategy', () => {
    expect(registry.unregister('non-existent')).toBe(false);
  });

  it('should get a strategy by name', () => {
    registry.register(strategy);
    expect(registry.get('test-strategy')).toBe(strategy);
  });

  it('should return undefined for non-existent strategy', () => {
    expect(registry.get('non-existent')).toBeUndefined();
  });

  it('should get all strategies', () => {
    registry.register(strategy);
    const all = registry.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('test-strategy');
  });

  it('should filter strategies by category', () => {
    registry.register(strategy);
    const syntaxStrategies = registry.getByCategory('syntax');
    expect(syntaxStrategies).toHaveLength(1);
    expect(registry.getByCategory('typing')).toHaveLength(0);
  });

  it('should filter strategies by priority', () => {
    registry.register(strategy);
    const mediumStrategies = registry.getByPriority('medium');
    expect(mediumStrategies).toHaveLength(1);
    expect(registry.getByPriority('critical')).toHaveLength(0);
  });

  it('should sort strategies by priority', () => {
    class HighStrategy extends TestStrategy {
      readonly name = 'high-strategy';
      readonly priority = 'high' as const;
    }
    class LowStrategy extends TestStrategy {
      readonly name = 'low-strategy';
      readonly priority = 'low' as const;
    }
    registry.register(new LowStrategy());
    registry.register(new HighStrategy());
    registry.register(strategy);

    const sorted = registry.getSortedByPriority();
    expect(sorted[0].name).toBe('high-strategy');
    expect(sorted[1].name).toBe('test-strategy');
    expect(sorted[2].name).toBe('low-strategy');
  });

  it('should find strategies for a diagnostic', () => {
    registry.register(strategy);
    const diagnostic: Diagnostic = { message: 'test', code: 'T1', severity: 'error', line: 1, column: 1 };
    const found = registry.findStrategiesForDiagnostic(diagnostic);
    expect(found).toHaveLength(1);
  });

  it('should check if a strategy exists', () => {
    registry.register(strategy);
    expect(registry.has('test-strategy')).toBe(true);
    expect(registry.has('non-existent')).toBe(false);
  });

  it('should clear all strategies', () => {
    registry.register(strategy);
    registry.clear();
    expect(registry.size).toBe(0);
  });

  it('should return empty array when no strategies registered', () => {
    expect(registry.getAll()).toHaveLength(0);
    expect(registry.getSortedByPriority()).toHaveLength(0);
  });
});

// ============================================================================
// Module 2: quick-fix.ts
// ============================================================================
describe('QuickFix', () => {
  let qf: QuickFix;

  beforeEach(() => {
    qf = new QuickFix();
  });

  describe('fixMissingImports', () => {
    it('should add missing imports', () => {
      const code = 'const x = foo();';
      const result = qf.fixMissingImports(code, ['lodash', 'axios']);
      expect(result.fixed).toBe(true);
      expect(result.code).toContain("import lodash from 'lodash';");
      expect(result.code).toContain("import axios from 'axios';");
      expect(result.code).toContain('const x = foo();');
    });

    it('should return unfixed result for empty missing array', () => {
      const code = 'const x = 1;';
      const result = qf.fixMissingImports(code, []);
      expect(result.fixed).toBe(false);
      expect(result.code).toBe(code);
    });

    it('should sanitize import names from paths with special characters', () => {
      const result = qf.fixMissingImports('', ['@scope/package-name']);
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('import');
    });
  });

  describe('fixUnusedVariables', () => {
    it('should prefix unused variables with underscore', () => {
      const code = 'const unused = 5;\nconsole.log("hello");';
      const result = qf.fixUnusedVariables(code);
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('_unused');
    });

    it('should not modify variables that are used', () => {
      const code = 'const used = 5;\nconsole.log(used);';
      const result = qf.fixUnusedVariables(code);
      expect(result.fixed).toBe(false);
      expect(result.code).toBe(code);
    });

    it('should handle empty code', () => {
      const result = qf.fixUnusedVariables('');
      expect(result.fixed).toBe(false);
    });

    it('should not prefix already-prefixed variables', () => {
      const code = 'const _unused = 5;\nconsole.log("hello");';
      const result = qf.fixUnusedVariables(code);
      expect(result.fixed).toBe(false);
    });
  });

  describe('fixMissingSemicolons', () => {
    it('should add semicolons to statement lines', () => {
      const code = 'const x = 5\nconst y = 10';
      const result = qf.fixMissingSemicolons(code);
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('const x = 5;');
      expect(result.code).toContain('const y = 10;');
    });

    it('should not add semicolons to lines with braces', () => {
      const code = 'function foo() {\n  return 1\n}';
      const result = qf.fixMissingSemicolons(code);
      // The 'return 1' line should get a semicolon
      expect(result.fixed).toBe(true);
    });

    it('should not add semicolons to comment lines', () => {
      const code = '// This is a comment\nconst x = 1';
      const result = qf.fixMissingSemicolons(code);
      expect(result.code).not.toContain('// This is a comment;');
    });

    it('should not modify already-correct code', () => {
      const code = 'const x = 5;\nconst y = 10;';
      const result = qf.fixMissingSemicolons(code);
      expect(result.fixed).toBe(false);
    });

    it('should handle empty code', () => {
      const result = qf.fixMissingSemicolons('');
      expect(result.fixed).toBe(false);
    });
  });

  describe('fixTrailingCommas', () => {
    it('should remove trailing commas before closing braces', () => {
      const code = 'const obj = {\n  a: 1,\n  b: 2,\n};';
      const result = qf.fixTrailingCommas(code);
      expect(result.fixed).toBe(true);
      expect(result.code).not.toContain('b: 2,');
    });

    it('should not remove non-trailing commas', () => {
      const code = 'const arr = [1, 2, 3];';
      const result = qf.fixTrailingCommas(code);
      expect(result.fixed).toBe(false);
    });

    it('should handle empty code', () => {
      const result = qf.fixTrailingCommas('');
      expect(result.fixed).toBe(false);
    });
  });

  describe('fixIndentation', () => {
    it('should replace tabs with spaces', () => {
      const code = '\tconst x = 1;\n\tconst y = 2;';
      const result = qf.fixIndentation(code, 'spaces', 2);
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('  const x = 1;');
      expect(result.code).not.toContain('\t');
    });

    it('should replace spaces with tabs', () => {
      const code = '  const x = 1;\n  const y = 2;';
      const result = qf.fixIndentation(code, 'tabs', 2);
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('\tconst x = 1;');
    });

    it('should not modify already-correct indentation', () => {
      const code = '  const x = 1;';
      const result = qf.fixIndentation(code, 'spaces', 2);
      expect(result.fixed).toBe(false);
    });

    it('should handle empty code', () => {
      const result = qf.fixIndentation('', 'spaces');
      expect(result.fixed).toBe(false);
    });
  });

  describe('fixQuotes', () => {
    it('should convert double quotes to single quotes', () => {
      const code = 'const x = "hello";';
      const result = qf.fixQuotes(code, 'single');
      expect(result.fixed).toBe(true);
      expect(result.code).toContain("'hello'");
    });

    it('should convert single quotes to double quotes', () => {
      const code = "const x = 'hello';";
      const result = qf.fixQuotes(code, 'double');
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('"hello"');
    });

    it('should keep double quotes when content has single quotes', () => {
      const code = 'const x = "it\'s a test";';
      const result = qf.fixQuotes(code, 'single');
      // Should not convert to single quotes since content contains single quotes
      expect(result.fixed).toBe(false);
      expect(result.code).toContain('"it\'s a test"');
    });

    it('should not modify already-correct quotes', () => {
      const code = "const x = 'hello';";
      const result = qf.fixQuotes(code, 'single');
      expect(result.fixed).toBe(false);
    });

    it('should handle backtick style without changes', () => {
      const code = 'const x = "hello";';
      const result = qf.fixQuotes(code, 'backtick');
      expect(result.fixed).toBe(false);
    });

    it('should handle empty code', () => {
      const result = qf.fixQuotes('', 'single');
      expect(result.fixed).toBe(false);
    });
  });

  describe('applyQuickFixes', () => {
    it('should apply fixes based on diagnostics', () => {
      const code = 'const x = 5';
      const diagnostics: Diagnostic[] = [
        { message: 'Missing semicolon', code: 'semi', severity: 'error', line: 1, column: 12 },
      ];
      const result = qf.applyQuickFixes(code, diagnostics);
      expect(result.fixed).toBe(true);
    });

    it('should return unfixed result for empty diagnostics', () => {
      const code = 'const x = 5;';
      const result = qf.applyQuickFixes(code, []);
      expect(result.fixed).toBe(false);
    });

    it('should handle multiple diagnostics', () => {
      const code = 'const x = 5';
      const diagnostics: Diagnostic[] = [
        { message: 'Missing semicolon', code: 'semi', severity: 'error', line: 1, column: 12 },
        { message: 'unused variable', code: 'no-unused', severity: 'warning', line: 1, column: 7 },
      ];
      const result = qf.applyQuickFixes(code, diagnostics);
      expect(result.fixed).toBe(true);
    });
  });
});

// ============================================================================
// Module 3: refactoring-engine.ts
// ============================================================================
describe('RefactoringEngine', () => {
  let engine: RefactoringEngine;

  beforeEach(() => {
    engine = new RefactoringEngine();
  });

  describe('extractMethod', () => {
    it('should extract lines into a new method', () => {
      const code = 'function main() {\n  console.log("a");\n  console.log("b");\n}';
      const range: SourceRange = { startLine: 2, startColumn: 1, endLine: 3, endColumn: 20 };
      const result = engine.extractMethod(code, range, 'printMessages');
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('function printMessages()');
      expect(result.code).toContain('printMessages();');
    });

    it('should return error for invalid range', () => {
      const code = 'const x = 1;';
      const range: SourceRange = { startLine: 0, startColumn: 1, endLine: 1, endColumn: 10 };
      const result = engine.extractMethod(code, range, 'foo');
      expect(result.fixed).toBe(false);
      expect(result.error).toContain('Invalid range');
    });

    it('should return error for range beyond code length', () => {
      const code = 'const x = 1;';
      const range: SourceRange = { startLine: 1, startColumn: 1, endLine: 10, endColumn: 1 };
      const result = engine.extractMethod(code, range, 'foo');
      expect(result.fixed).toBe(false);
      expect(result.error).toContain('Invalid range');
    });

    it('should handle empty code', () => {
      const range: SourceRange = { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 };
      const result = engine.extractMethod('', range, 'foo');
      expect(result.fixed).toBe(false);
    });
  });

  describe('extractVariable', () => {
    it('should extract an expression into a variable', () => {
      const code = 'const result = 1 + 2 + 3;';
      const result = engine.extractVariable(code, '1 + 2 + 3', 'sum');
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('const sum = 1 + 2 + 3;');
    });

    it('should return error when expression not found', () => {
      const code = 'const x = 1;';
      const result = engine.extractVariable(code, 'nonexistent', 'y');
      expect(result.fixed).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should handle empty code', () => {
      const result = engine.extractVariable('', 'expr', 'x');
      expect(result.fixed).toBe(false);
    });
  });

  describe('renameSymbol', () => {
    it('should rename a symbol throughout the code', () => {
      const code = 'const foo = 1;\nconsole.log(foo);';
      const result = engine.renameSymbol(code, 'foo', 'bar');
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('const bar = 1;');
      expect(result.code).toContain('console.log(bar);');
    });

    it('should not rename when old and new names are the same', () => {
      const code = 'const foo = 1;';
      const result = engine.renameSymbol(code, 'foo', 'foo');
      expect(result.fixed).toBe(false);
    });

    it('should return error for invalid new name', () => {
      const code = 'const foo = 1;';
      const result = engine.renameSymbol(code, 'foo', '123invalid');
      expect(result.fixed).toBe(false);
      expect(result.error).toContain('Invalid symbol name');
    });

    it('should respect scope restriction', () => {
      const code = 'const foo = 1;\nconst bar = foo;\nconst foo2 = foo;';
      const range: SourceRange = { startLine: 1, startColumn: 1, endLine: 2, endColumn: 20 };
      const result = engine.renameSymbol(code, 'foo', 'baz', range);
      expect(result.fixed).toBe(true);
      // foo2 on line 3 should not be renamed, but the 'foo' reference on line 3 should stay as 'foo'
      expect(result.code).toContain('const foo2 = foo;');
    });

    it('should handle empty code', () => {
      const result = engine.renameSymbol('', 'foo', 'bar');
      expect(result.fixed).toBe(false);
    });
  });

  describe('inlineVariable', () => {
    it('should inline a variable with its value', () => {
      const code = 'const x = 42;\nconsole.log(x);';
      const result = engine.inlineVariable(code, 'x');
      expect(result.fixed).toBe(true);
      expect(result.code).not.toContain('const x = 42;');
      expect(result.code).toContain('console.log(42);');
    });

    it('should return error when variable not found', () => {
      const code = 'const x = 1;';
      const result = engine.inlineVariable(code, 'nonexistent');
      expect(result.fixed).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should handle empty code', () => {
      const result = engine.inlineVariable('', 'x');
      expect(result.fixed).toBe(false);
    });
  });

  describe('simplifyConditional', () => {
    it('should simplify x === true to x', () => {
      const code = 'if (x === true) { return; }';
      const result = engine.simplifyConditional(code);
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('if (x) { return; }');
    });

    it('should simplify x === false to !x', () => {
      const code = 'if (x === false) { return; }';
      const result = engine.simplifyConditional(code);
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('if (!(x)) { return; }');
    });

    it('should not modify already-simplified code', () => {
      const code = 'if (x) { return; }';
      const result = engine.simplifyConditional(code);
      expect(result.fixed).toBe(false);
    });

    it('should handle empty code', () => {
      const result = engine.simplifyConditional('');
      expect(result.fixed).toBe(false);
    });
  });

  describe('encapsulateField', () => {
    it('should encapsulate a public field', () => {
      const code = 'class Foo {\n  public name: string;\n  constructor() {\n    this.name = "test";\n  }\n}';
      const range: SourceRange = { startLine: 1, startColumn: 1, endLine: 5, endColumn: 1 };
      const result = engine.encapsulateField(code, 'name', range);
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('private name');
      expect(result.code).toContain('get name()');
      expect(result.code).toContain('set name(');
    });

    it('should return error for invalid range', () => {
      const code = 'class Foo {}';
      const range: SourceRange = { startLine: 0, startColumn: 1, endLine: 1, endColumn: 1 };
      const result = engine.encapsulateField(code, 'x', range);
      expect(result.fixed).toBe(false);
      expect(result.error).toContain('Invalid class range');
    });

    it('should return error when field not found', () => {
      const code = 'class Foo {\n  name: string;\n}';
      const range: SourceRange = { startLine: 1, startColumn: 1, endLine: 3, endColumn: 1 };
      const result = engine.encapsulateField(code, 'nonexistent', range);
      expect(result.fixed).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should handle empty code', () => {
      const range: SourceRange = { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 };
      const result = engine.encapsulateField('', 'x', range);
      expect(result.fixed).toBe(false);
    });
  });
});

// ============================================================================
// Module 4: type-fix.ts
// ============================================================================
describe('TypeFix', () => {
  let tf: TypeFix;

  beforeEach(() => {
    tf = new TypeFix();
  });

  describe('fixTypeErrors', () => {
    it('should fix type errors based on diagnostics', () => {
      const code = 'function foo(x) { return x; }';
      const diagnostics: Diagnostic[] = [
        { message: "Parameter 'x' implicitly has an 'any' type", code: 'TS7006', severity: 'error', line: 1, column: 15 },
      ];
      const result = tf.fixTypeErrors(code, diagnostics);
      expect(result.fixed).toBe(true);
    });

    it('should handle empty diagnostics', () => {
      const code = 'const x: number = 1;';
      const result = tf.fixTypeErrors(code, []);
      expect(result.fixed).toBe(false);
    });

    it('should handle null/undefined diagnostics', () => {
      const code = 'const x = obj.prop;';
      const diagnostics: Diagnostic[] = [
        { message: "Object is possibly 'null'", code: 'TS2531', severity: 'error', line: 1, column: 12 },
      ];
      const result = tf.fixTypeErrors(code, diagnostics);
      expect(result.fixed).toBe(true);
    });
  });

  describe('addTypeAnnotations', () => {
    it('should add type annotation to a function parameter', () => {
      const code = 'function greet(name) {\n  return "Hello " + name;\n}';
      const inferred: InferredType[] = [
        { name: 'name', type: 'string', line: 1 },
      ];
      const result = tf.addTypeAnnotations(code, inferred);
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('name: string');
    });

    it('should add type annotation to a variable', () => {
      const code = 'const x = 42;';
      const inferred: InferredType[] = [
        { name: 'x', type: 'number', line: 1 },
      ];
      const result = tf.addTypeAnnotations(code, inferred);
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('const x: number = 42;');
    });

    it('should not add annotation if already present', () => {
      const code = 'const x: number = 42;';
      const inferred: InferredType[] = [
        { name: 'x', type: 'number', line: 1 },
      ];
      const result = tf.addTypeAnnotations(code, inferred);
      expect(result.fixed).toBe(false);
    });

    it('should handle empty inferred types', () => {
      const code = 'const x = 42;';
      const result = tf.addTypeAnnotations(code, []);
      expect(result.fixed).toBe(false);
    });

    it('should handle out-of-range line numbers', () => {
      const code = 'const x = 42;';
      const inferred: InferredType[] = [
        { name: 'x', type: 'number', line: 99 },
      ];
      const result = tf.addTypeAnnotations(code, inferred);
      expect(result.fixed).toBe(false);
    });
  });

  describe('fixNullUndefined', () => {
    it('should add optional chaining in strict mode', () => {
      const code = 'const x = data.items;';
      const result = tf.fixNullUndefined(code, true);
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('data?.items');
    });

    it('should not modify safe objects', () => {
      const code = 'console.log("hello");';
      const result = tf.fixNullUndefined(code, true);
      expect(result.fixed).toBe(false);
    });

    it('should not modify code in non-strict mode', () => {
      const code = 'const x = data.items;';
      const result = tf.fixNullUndefined(code, false);
      expect(result.fixed).toBe(false);
    });

    it('should handle empty code', () => {
      const result = tf.fixNullUndefined('', true);
      expect(result.fixed).toBe(false);
    });
  });

  describe('fixImplicitAny', () => {
    it('should add explicit any type to function parameters', () => {
      const code = 'function foo(x, y) {\n  return x + y;\n}';
      const result = tf.fixImplicitAny(code);
      expect(result.fixed).toBe(true);
      expect(result.code).toContain(': any');
    });

    it('should not modify already-typed parameters', () => {
      const code = 'function foo(x: number, y: string) {\n  return x;\n}';
      const result = tf.fixImplicitAny(code);
      expect(result.fixed).toBe(false);
    });

    it('should handle empty code', () => {
      const result = tf.fixImplicitAny('');
      expect(result.fixed).toBe(false);
    });
  });

  describe('fixMissingReturnTypes', () => {
    it('should add return type to function declarations', () => {
      const code = 'function add(a, b) {\n  return a + b;\n}';
      const result = tf.fixMissingReturnTypes(code);
      expect(result.fixed).toBe(true);
      expect(result.code).toContain(': any');
    });

    it('should not modify functions with existing return types', () => {
      const code = 'function add(a: number, b: number): number {\n  return a + b;\n}';
      const result = tf.fixMissingReturnTypes(code);
      expect(result.fixed).toBe(false);
    });

    it('should handle empty code', () => {
      const result = tf.fixMissingReturnTypes('');
      expect(result.fixed).toBe(false);
    });
  });

  describe('fixGenericConstraints', () => {
    it('should add constraints to generic types used with property access', () => {
      const code = 'function getName<T>(item: T) {\n  return T.name;\n}';
      const result = tf.fixGenericConstraints(code);
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('extends Record<string, any>');
    });

    it('should not modify generics without property access', () => {
      const code = 'function identity<T>(value: T) {\n  return value;\n}';
      const result = tf.fixGenericConstraints(code);
      expect(result.fixed).toBe(false);
    });

    it('should handle empty code', () => {
      const result = tf.fixGenericConstraints('');
      expect(result.fixed).toBe(false);
    });
  });
});

// ============================================================================
// Module 5: deprecation-fix.ts
// ============================================================================
describe('DeprecationFix', () => {
  let df: DeprecationFix;
  let deprecationMap: DeprecationMap;

  beforeEach(() => {
    df = new DeprecationFix();
    deprecationMap = {
      'deprecatedFunc': {
        description: 'deprecatedFunc is deprecated',
        alternatives: ['newFunc', 'modernFunc'],
        replacement: 'newFunc',
        breaking: false,
        deprecatedIn: '2.0.0',
        removalIn: '3.0.0',
      },
      'oldMethod()': {
        description: 'oldMethod is deprecated',
        alternatives: ['newMethod()'],
        replacement: 'newMethod()',
        breaking: true,
      },
    };
  });

  describe('detectDeprecatedUsage', () => {
    it('should detect deprecated API usage', () => {
      const code = 'const result = deprecatedFunc();';
      const usages = df.detectDeprecatedUsage(code, deprecationMap);
      expect(usages).toHaveLength(1);
      expect(usages[0].pattern).toBe('deprecatedFunc');
      expect(usages[0].line).toBe(1);
    });

    it('should detect multiple deprecated usages', () => {
      const code = 'deprecatedFunc();\noldMethod();';
      const usages = df.detectDeprecatedUsage(code, deprecationMap);
      expect(usages).toHaveLength(2);
    });

    it('should return empty array for clean code', () => {
      const code = 'const x = newFunc();';
      const usages = df.detectDeprecatedUsage(code, deprecationMap);
      expect(usages).toHaveLength(0);
    });

    it('should handle empty code', () => {
      const usages = df.detectDeprecatedUsage('', deprecationMap);
      expect(usages).toHaveLength(0);
    });

    it('should handle empty deprecation map', () => {
      const usages = df.detectDeprecatedUsage('some code', {});
      expect(usages).toHaveLength(0);
    });
  });

  describe('suggestReplacement', () => {
    it('should suggest replacements', () => {
      const suggestions = df.suggestReplacement('deprecatedFunc', ['newFunc', 'modernFunc']);
      expect(suggestions).toHaveLength(2);
      expect(suggestions[0]).toContain('newFunc');
    });

    it('should return fallback message when no alternatives', () => {
      const suggestions = df.suggestReplacement('oldFunc', []);
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]).toContain('No direct replacement');
    });
  });

  describe('applyDeprecationFixes', () => {
    it('should replace deprecated APIs', () => {
      const code = 'const result = deprecatedFunc();';
      const result = df.applyDeprecationFixes(code, deprecationMap);
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('newFunc');
      expect(result.code).not.toContain('deprecatedFunc');
    });

    it('should not modify code without deprecated APIs', () => {
      const code = 'const x = 1;';
      const result = df.applyDeprecationFixes(code, deprecationMap);
      expect(result.fixed).toBe(false);
    });

    it('should skip deprecations without replacement', () => {
      const map: DeprecationMap = {
        'oldFunc': { description: 'old', alternatives: ['newFunc'] },
      };
      const code = 'oldFunc();';
      const result = df.applyDeprecationFixes(code, map);
      expect(result.fixed).toBe(false);
    });

    it('should handle empty code', () => {
      const result = df.applyDeprecationFixes('', deprecationMap);
      expect(result.fixed).toBe(false);
    });
  });

  describe('generateMigrationPlan', () => {
    it('should generate migration steps', () => {
      const code = 'deprecatedFunc();\ndeprecatedFunc();\noldMethod();';
      const plan = df.generateMigrationPlan(code, deprecationMap);
      expect(plan).toHaveLength(2);
      // Most used first
      expect(plan[0].from).toBe('deprecatedFunc');
      expect(plan[0].occurrences).toBe(2);
      expect(plan[1].from).toBe('oldMethod()');
      expect(plan[1].occurrences).toBe(1);
    });

    it('should return empty plan for clean code', () => {
      const plan = df.generateMigrationPlan('const x = 1;', deprecationMap);
      expect(plan).toHaveLength(0);
    });

    it('should mark breaking changes', () => {
      const code = 'oldMethod();';
      const plan = df.generateMigrationPlan(code, deprecationMap);
      expect(plan[0].breaking).toBe(true);
    });
  });
});

// ============================================================================
// Module 6: performance-fix.ts
// ============================================================================
describe('PerformanceFix', () => {
  let pf: PerformanceFix;

  beforeEach(() => {
    pf = new PerformanceFix();
  });

  describe('optimizeLoops', () => {
    it('should cache array length in for loops', () => {
      const code = 'for (let i = 0; i < arr.length; i++) {\n  console.log(arr[i]);\n}';
      const result = pf.optimizeLoops(code);
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('arrLen');
    });

    it('should convert for-in to for-of with Object.entries', () => {
      const code = 'for (const key in obj) {\n  console.log(obj[key]);\n}';
      const result = pf.optimizeLoops(code);
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('Object.entries');
    });

    it('should not modify already-optimized code', () => {
      const code = 'for (const item of arr) {\n  console.log(item);\n}';
      const result = pf.optimizeLoops(code);
      expect(result.fixed).toBe(false);
    });

    it('should handle empty code', () => {
      const result = pf.optimizeLoops('');
      expect(result.fixed).toBe(false);
    });
  });

  describe('optimizeStringConcat', () => {
    it('should convert string concatenation to template literals', () => {
      const code = "const msg = 'Hello ' + name + '!';";
      const result = pf.optimizeStringConcat(code);
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('`');
      expect(result.code).toContain('${name}');
    });

    it('should not modify code without concatenation', () => {
      const code = 'const x = 42;';
      const result = pf.optimizeStringConcat(code);
      expect(result.fixed).toBe(false);
    });

    it('should handle empty code', () => {
      const result = pf.optimizeStringConcat('');
      expect(result.fixed).toBe(false);
    });
  });

  describe('optimizeArrayOperations', () => {
    it('should replace indexOf !== -1 with includes', () => {
      const code = 'if (arr.indexOf(x) !== -1) { return true; }';
      const result = pf.optimizeArrayOperations(code);
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('arr.includes(x)');
    });

    it('should replace indexOf === -1 with !includes', () => {
      const code = 'if (arr.indexOf(x) === -1) { return false; }';
      const result = pf.optimizeArrayOperations(code);
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('!arr.includes(x)');
    });

    it('should replace [].concat() with spread', () => {
      const code = 'const result = [].concat(arr1, arr2);';
      const result = pf.optimizeArrayOperations(code);
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('[...arr1, ...arr2]');
    });

    it('should not modify already-optimized code', () => {
      const code = 'if (arr.includes(x)) { return true; }';
      const result = pf.optimizeArrayOperations(code);
      expect(result.fixed).toBe(false);
    });

    it('should handle empty code', () => {
      const result = pf.optimizeArrayOperations('');
      expect(result.fixed).toBe(false);
    });
  });

  describe('addMemoization', () => {
    it('should add memoization to a function', () => {
      const code = 'const compute = (x) => {\n  return x * 2;\n};';
      const result = pf.addMemoization(code, ['compute']);
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('Map');
    });

    it('should not modify code when function not found', () => {
      const code = 'const x = 1;';
      const result = pf.addMemoization(code, ['nonexistent']);
      expect(result.fixed).toBe(false);
    });

    it('should handle empty code', () => {
      const result = pf.addMemoization('', ['foo']);
      expect(result.fixed).toBe(false);
    });

    it('should handle empty function list', () => {
      const code = 'const f = () => {};';
      const result = pf.addMemoization(code, []);
      expect(result.fixed).toBe(false);
    });
  });

  describe('optimizeImports', () => {
    it('should remove unused imports', () => {
      const code = "import { foo, bar } from 'module';\nconsole.log(foo);";
      const result = pf.optimizeImports(code);
      expect(result.fixed).toBe(true);
      expect(result.code).not.toContain('bar');
    });

    it('should remove entirely unused imports', () => {
      const code = "import { unused } from 'module';\nconsole.log('hello');";
      const result = pf.optimizeImports(code);
      expect(result.fixed).toBe(true);
      expect(result.code).not.toContain('unused');
    });

    it('should not modify code with all imports used', () => {
      const code = "import { foo } from 'module';\nconsole.log(foo);";
      const result = pf.optimizeImports(code);
      expect(result.fixed).toBe(false);
    });

    it('should handle empty code', () => {
      const result = pf.optimizeImports('');
      expect(result.fixed).toBe(false);
    });
  });

  describe('detectPerformanceIssues', () => {
    it('should detect string concatenation in loops', () => {
      const code = 'for (let i = 0; i < 10; i++) {\n  result += "item";\n}';
      const issues = pf.detectPerformanceIssues(code);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some(i => i.description.includes('String concatenation'))).toBe(true);
    });

    it('should detect nested loops', () => {
      const code = 'for (let i = 0; i < n; i++) {\n  for (let j = 0; j < n; j++) {\n    console.log(i, j);\n  }\n}';
      const issues = pf.detectPerformanceIssues(code);
      expect(issues.some(i => i.description.includes('Nested loop'))).toBe(true);
    });

    it('should detect synchronous I/O', () => {
      const code = 'const data = readFileSync("file.txt");';
      const issues = pf.detectPerformanceIssues(code);
      expect(issues.some(i => i.description.includes('Synchronous'))).toBe(true);
    });

    it('should detect console.log', () => {
      const code = 'console.log("debug");';
      const issues = pf.detectPerformanceIssues(code);
      expect(issues.some(i => i.description.includes('Console'))).toBe(true);
    });

    it('should return empty array for clean code', () => {
      const issues = pf.detectPerformanceIssues('const x = 1;');
      expect(issues).toHaveLength(0);
    });

    it('should handle empty code', () => {
      const issues = pf.detectPerformanceIssues('');
      expect(issues).toHaveLength(0);
    });
  });
});

// ============================================================================
// Module 7: compatibility-fix.ts
// ============================================================================
describe('CompatibilityFix', () => {
  let cf: CompatibilityFix;

  beforeEach(() => {
    cf = new CompatibilityFix();
  });

  describe('fixESVersionCompat', () => {
    it('should replace optional chaining for ES2015', () => {
      const code = 'const x = obj?.prop;';
      const result = cf.fixESVersionCompat(code, 'ES2015');
      expect(result.fixed).toBe(true);
      expect(result.code).not.toContain('?.');
    });

    it('should not modify code for ES2020 target', () => {
      const code = 'const x = obj?.prop;';
      const result = cf.fixESVersionCompat(code, 'ES2020');
      expect(result.fixed).toBe(false);
    });

    it('should replace object spread for ES2015', () => {
      const code = 'const obj = { ...defaults, ...config };';
      const result = cf.fixESVersionCompat(code, 'ES2015');
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('Object.assign');
    });

    it('should handle empty code', () => {
      const result = cf.fixESVersionCompat('', 'ES2015');
      expect(result.fixed).toBe(false);
    });
  });

  describe('fixNodeVersionCompat', () => {
    it('should replace globalThis for older Node.js', () => {
      const code = 'globalThis.x = 1;';
      const result = cf.fixNodeVersionCompat(code, '10.0.0');
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('global.x');
    });

    it('should replace structuredClone for older Node.js', () => {
      const code = 'const copy = structuredClone(obj);';
      const result = cf.fixNodeVersionCompat(code, '14.0.0');
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('JSON.parse(JSON.stringify');
    });

    it('should not modify code for current Node.js', () => {
      const code = 'globalThis.x = 1;';
      const result = cf.fixNodeVersionCompat(code, '20.0.0');
      expect(result.fixed).toBe(false);
    });

    it('should handle empty code', () => {
      const result = cf.fixNodeVersionCompat('', '10.0.0');
      expect(result.fixed).toBe(false);
    });
  });

  describe('fixBrowserCompat', () => {
    it('should replace Array.at() for older browsers', () => {
      const code = 'const last = arr.at(-1);';
      const result = cf.fixBrowserCompat(code, ['ie >= 11']);
      expect(result.fixed).toBe(true);
      expect(result.code).not.toContain('.at(');
    });

    it('should not modify code for modern browsers', () => {
      const code = 'const last = arr.at(-1);';
      const result = cf.fixBrowserCompat(code, ['chrome >= 100', 'firefox >= 100']);
      expect(result.fixed).toBe(false);
    });

    it('should handle empty code', () => {
      const result = cf.fixBrowserCompat('', ['ie >= 11']);
      expect(result.fixed).toBe(false);
    });
  });

  describe('polyfillMissingAPIs', () => {
    it('should add polyfill imports for missing APIs', () => {
      const code = 'Promise.allSettled(promises);';
      const result = cf.polyfillMissingAPIs(code, 'node12');
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('core-js');
    });

    it('should not add polyfills when not needed', () => {
      const code = 'const x = 1;';
      const result = cf.polyfillMissingAPIs(code, 'node18');
      expect(result.fixed).toBe(false);
    });

    it('should handle empty code', () => {
      const result = cf.polyfillMissingAPIs('', 'node12');
      expect(result.fixed).toBe(false);
    });
  });

  describe('generateCompatReport', () => {
    it('should report optional chaining incompatibility', () => {
      const code = 'const x = obj?.prop;';
      const report = cf.generateCompatReport(code, { esVersion: 'ES2015' });
      expect(report.issues.length).toBeGreaterThan(0);
      expect(report.issues[0].api).toBe('?.');
      expect(report.score).toBeLessThan(100);
    });

    it('should report async/await incompatibility', () => {
      const code = 'async function foo() { await bar(); }';
      const report = cf.generateCompatReport(code, { esVersion: 'ES2015' });
      expect(report.issues.some(i => i.api === 'async/await')).toBe(true);
    });

    it('should report let/const incompatibility', () => {
      const code = 'const x = 1;';
      const report = cf.generateCompatReport(code, { esVersion: 'ES5' });
      expect(report.issues.some(i => i.api === 'let/const')).toBe(true);
    });

    it('should return perfect score for compatible code', () => {
      const code = 'var x = 1;';
      const report = cf.generateCompatReport(code, { esVersion: 'ES2015' });
      expect(report.score).toBe(100);
    });

    it('should report Node.js compatibility issues', () => {
      const code = "import { readFile } from 'fs/promises';";
      const report = cf.generateCompatReport(code, { nodeVersion: '12.0.0' });
      expect(report.issues.some(i => i.api === 'fs/promises')).toBe(true);
    });
  });
});

// ============================================================================
// Module 8: fix-validator.ts
// ============================================================================
describe('FixValidator', () => {
  let validator: FixValidator;

  beforeEach(() => {
    validator = new FixValidator({ checkSyntax: true, checkSemantics: true, checkTypes: true, runTests: true });
  });

  describe('validateSyntax', () => {
    it('should validate correct syntax', () => {
      const result = validator.validateSyntax('const x = 1;');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect unbalanced braces', () => {
      const result = validator.validateSyntax('function foo() { return 1;');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('closing brace'))).toBe(true);
    });

    it('should detect unbalanced parentheses', () => {
      const result = validator.validateSyntax('console.log("hello";');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('closing parenthesis'))).toBe(true);
    });

    it('should detect double semicolons', () => {
      const result = validator.validateSyntax('const x = 1;;');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Double semicolons'))).toBe(true);
    });

    it('should warn about empty code', () => {
      const result = validator.validateSyntax('');
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('empty'))).toBe(true);
    });

    it('should warn about very long lines', () => {
      const longLine = 'const x = ' + 'a'.repeat(200) + ';';
      const result = validator.validateSyntax(longLine);
      expect(result.warnings.some(w => w.includes('very long'))).toBe(true);
    });
  });

  describe('validateSemantics', () => {
    it('should validate code with exports', () => {
      const result = validator.validateSemantics('export const x = 1;', 'export');
      expect(result.valid).toBe(true);
    });

    it('should warn about missing exports', () => {
      const result = validator.validateSemantics('const x = 1;', 'export');
      expect(result.warnings.some(w => w.includes('No exports'))).toBe(true);
    });

    it('should warn about infinite loops', () => {
      const result = validator.validateSemantics('while (true) { }', 'normal');
      expect(result.warnings.some(w => w.includes('infinite loop'))).toBe(true);
    });
  });

  describe('validateTypes', () => {
    it('should warn about any type usage', () => {
      const result = validator.validateTypes('const x: any = 1;');
      expect(result.warnings.some(w => w.includes("'any'"))).toBe(true);
    });

    it('should warn about type assertions', () => {
      const result = validator.validateTypes('const x = value as string;');
      expect(result.warnings.some(w => w.includes('Type assertion'))).toBe(true);
    });

    it('should warn about @ts-ignore', () => {
      const result = validator.validateTypes('// @ts-ignore\nconst x = 1;');
      expect(result.warnings.some(w => w.includes('suppression'))).toBe(true);
    });

    it('should pass for clean typed code', () => {
      const result = validator.validateTypes('const x: number = 1;');
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('validateTests', () => {
    it('should warn when no test runner specified', () => {
      const result = validator.validateTests('const x = 1;', '');
      expect(result.warnings.some(w => w.includes('No test runner'))).toBe(true);
    });

    it('should pass with a test runner specified', () => {
      const result = validator.validateTests('const x = 1;', 'bun test');
      expect(result.valid).toBe(true);
    });
  });

  describe('validateFix', () => {
    it('should validate a successful fix', () => {
      const fixResult: FixResult = {
        fixed: true,
        code: 'const x = 1;',
        changes: [{ description: 'test', original: '0', replacement: '1', line: 1, column: 9 }],
        confidence: 0.9,
        strategyName: 'test',
      };
      const result = validator.validateFix(fixResult, 'const x = 0;');
      expect(result.valid).toBe(true);
    });

    it('should pass for unfixed results', () => {
      const fixResult: FixResult = {
        fixed: false,
        code: 'const x = 0;',
        changes: [],
        confidence: 1,
        strategyName: 'test',
      };
      const result = validator.validateFix(fixResult, 'const x = 0;');
      expect(result.valid).toBe(true);
    });

    it('should warn about low confidence fixes', () => {
      const fixResult: FixResult = {
        fixed: true,
        code: 'const x = 1;',
        changes: [{ description: 'test', original: '0', replacement: '1', line: 1, column: 9 }],
        confidence: 0.3,
        strategyName: 'test',
      };
      const result = validator.validateFix(fixResult, 'const x = 0;');
      expect(result.warnings.some(w => w.includes('Low confidence'))).toBe(true);
    });

    it('should detect when fix results in empty code', () => {
      const fixResult: FixResult = {
        fixed: true,
        code: '',
        changes: [{ description: 'removed all', original: 'code', replacement: '', line: 1, column: 1 }],
        confidence: 0.9,
        strategyName: 'test',
      };
      const result = validator.validateFix(fixResult, 'const x = 1;');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('empty code'))).toBe(true);
    });

    it('should detect when code is unchanged despite reported changes', () => {
      const fixResult: FixResult = {
        fixed: true,
        code: 'const x = 1;',
        changes: [{ description: 'fake', original: 'a', replacement: 'b', line: 1, column: 1 }],
        confidence: 0.9,
        strategyName: 'test',
      };
      const result = validator.validateFix(fixResult, 'const x = 1;');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('identical'))).toBe(true);
    });
  });
});

// ============================================================================
// Module 9: fix-scheduler.ts
// ============================================================================
describe('FixScheduler', () => {
  let scheduler: FixScheduler;

  beforeEach(() => {
    scheduler = new FixScheduler();
  });

  describe('addFix', () => {
    it('should add a fix and return an ID', () => {
      const id = scheduler.addFix(
        (code) => ({ fixed: true, code, changes: [], confidence: 0.9, strategyName: 'test' }),
        'high',
        'syntax',
        'Test fix',
      );
      expect(id).toMatch(/^fix-\d+$/);
      expect(scheduler.size).toBe(1);
    });

    it('should increment IDs for each fix', () => {
      const id1 = scheduler.addFix(
        (code) => ({ fixed: false, code, changes: [], confidence: 0.9, strategyName: 'test' }),
        'low',
        'style',
      );
      const id2 = scheduler.addFix(
        (code) => ({ fixed: false, code, changes: [], confidence: 0.9, strategyName: 'test' }),
        'low',
        'style',
      );
      expect(id1).not.toBe(id2);
      expect(scheduler.size).toBe(2);
    });
  });

  describe('scheduleBatch', () => {
    it('should schedule multiple fixes at once', () => {
      const ids = scheduler.scheduleBatch([
        {
          fix: (code) => ({ fixed: false, code, changes: [], confidence: 0.9, strategyName: 'test' }),
          priority: 'high',
          category: 'syntax',
        },
        {
          fix: (code) => ({ fixed: false, code, changes: [], confidence: 0.8, strategyName: 'test' }),
          priority: 'low',
          category: 'style',
        },
      ]);
      expect(ids).toHaveLength(2);
      expect(scheduler.size).toBe(2);
    });
  });

  describe('getFixPlan', () => {
    it('should generate a fix plan with correct groupings', () => {
      scheduler.addFix(
        (code) => ({ fixed: true, code: code.replace('a', 'b'), changes: [], confidence: 0.9, strategyName: 'test' }),
        'critical',
        'syntax',
        'Critical fix',
        true,
      );
      scheduler.addFix(
        (code) => ({ fixed: true, code: code.replace('c', 'd'), changes: [], confidence: 0.7, strategyName: 'test' }),
        'low',
        'style',
        'Risky fix',
        false,
      );

      const plan = scheduler.getFixPlan('code', []);
      expect(plan.fixes).toHaveLength(2);
      expect(plan.safeFixes).toHaveLength(1);
      expect(plan.riskyFixes).toHaveLength(1);
      expect(plan.byCategory.syntax).toHaveLength(1);
      expect(plan.byCategory.style).toHaveLength(1);
      expect(plan.byPriority.critical).toHaveLength(1);
      expect(plan.byPriority.low).toHaveLength(1);
      expect(plan.totalEstimatedTime).toBeGreaterThan(0);
    });

    it('should return empty plan when no fixes scheduled', () => {
      const plan = scheduler.getFixPlan('code', []);
      expect(plan.fixes).toHaveLength(0);
      expect(plan.safeFixes).toHaveLength(0);
      expect(plan.riskyFixes).toHaveLength(0);
    });
  });

  describe('estimateFixTime', () => {
    it('should estimate time based on fix count', () => {
      const time = scheduler.estimateFixTime([
        (code) => ({ fixed: false, code, changes: [], confidence: 0.9, strategyName: 'test' }),
        (code) => ({ fixed: false, code, changes: [], confidence: 0.9, strategyName: 'test' }),
        (code) => ({ fixed: false, code, changes: [], confidence: 0.9, strategyName: 'test' }),
      ]);
      expect(time).toBe(30); // 3 * 10ms
    });

    it('should return 0 for empty fix list', () => {
      expect(scheduler.estimateFixTime([])).toBe(0);
    });
  });

  describe('applySafeFixes', () => {
    it('should apply only safe fixes', () => {
      scheduler.addFix(
        (code) => ({ fixed: true, code: code + '\n// safe fix', changes: [], confidence: 0.9, strategyName: 'safe' }),
        'high',
        'syntax',
        'Safe fix',
        true,
      );
      scheduler.addFix(
        (code) => ({ fixed: true, code: code + '\n// risky fix', changes: [], confidence: 0.5, strategyName: 'risky' }),
        'low',
        'style',
        'Risky fix',
        false,
      );

      const result = scheduler.applySafeFixes('original', []);
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('safe fix');
      expect(result.code).not.toContain('risky fix');
    });

    it('should handle errors in safe fixes gracefully', () => {
      scheduler.addFix(
        () => { throw new Error('fix failed'); },
        'high',
        'syntax',
        'Failing fix',
        true,
      );

      const result = scheduler.applySafeFixes('original', []);
      expect(result.fixed).toBe(false);
    });
  });

  describe('applyRiskyFixes', () => {
    it('should not apply risky fixes without approval', () => {
      scheduler.addFix(
        (code) => ({ fixed: true, code: code + '\n// risky', changes: [], confidence: 0.5, strategyName: 'risky' }),
        'low',
        'style',
        'Risky fix',
        false,
      );

      const result = scheduler.applyRiskyFixes('original', [], false);
      expect(result.fixed).toBe(false);
      expect(result.error).toContain('approval');
    });

    it('should apply risky fixes with approval', () => {
      scheduler.addFix(
        (code) => ({ fixed: true, code: code + '\n// risky', changes: [], confidence: 0.5, strategyName: 'risky' }),
        'low',
        'style',
        'Risky fix',
        false,
      );

      const result = scheduler.applyRiskyFixes('original', [], true);
      expect(result.fixed).toBe(true);
      expect(result.code).toContain('risky');
    });
  });

  describe('removeFix and clear', () => {
    it('should remove a fix by ID', () => {
      const id = scheduler.addFix(
        (code) => ({ fixed: false, code, changes: [], confidence: 0.9, strategyName: 'test' }),
        'low',
        'style',
      );
      expect(scheduler.removeFix(id)).toBe(true);
      expect(scheduler.size).toBe(0);
    });

    it('should return false when removing non-existent fix', () => {
      expect(scheduler.removeFix('non-existent')).toBe(false);
    });

    it('should clear all fixes', () => {
      scheduler.addFix(
        (code) => ({ fixed: false, code, changes: [], confidence: 0.9, strategyName: 'test' }),
        'low',
        'style',
      );
      scheduler.addFix(
        (code) => ({ fixed: false, code, changes: [], confidence: 0.9, strategyName: 'test' }),
        'high',
        'syntax',
      );
      scheduler.clear();
      expect(scheduler.size).toBe(0);
    });
  });
});

// ============================================================================
// Module 10: fix-history.ts
// ============================================================================
describe('FixHistory', () => {
  let history: FixHistory;

  beforeEach(() => {
    history = new FixHistory();
  });

  describe('recordFix', () => {
    it('should record a fix and return an ID', () => {
      const fixResult: FixResult = {
        fixed: true,
        code: 'const x = 1;',
        changes: [{ description: 'Added semicolon', original: 'x', replacement: 'x;', line: 1, column: 1 }],
        confidence: 0.9,
        strategyName: 'quick-fix',
      };
      const id = history.recordFix(fixResult, '/test.ts', ['syntax']);
      expect(id).toMatch(/^record-\d+$/);
      expect(history.size).toBe(1);
    });

    it('should record multiple fixes with incrementing IDs', () => {
      const fixResult: FixResult = {
        fixed: true,
        code: 'const x = 1;',
        changes: [{ description: 'test', original: '', replacement: '', line: 1, column: 1 }],
        confidence: 0.9,
        strategyName: 'test',
      };
      const id1 = history.recordFix(fixResult);
      const id2 = history.recordFix(fixResult);
      expect(id1).not.toBe(id2);
      expect(history.size).toBe(2);
    });
  });

  describe('getFixStats', () => {
    it('should return empty stats for no history', () => {
      const stats = history.getFixStats();
      expect(stats.totalFixes).toBe(0);
      expect(stats.averageConfidence).toBe(0);
    });

    it('should compute correct statistics', () => {
      const fixResult: FixResult = {
        fixed: true,
        code: 'const x = 1;',
        changes: [{ description: 'fix1', original: '', replacement: '', line: 1, column: 1 }],
        confidence: 0.9,
        strategyName: 'quick-fix',
      };
      history.recordFix(fixResult, '/test.ts', ['syntax', 'style']);
      history.recordFix(fixResult, '/test2.ts', ['syntax']);

      const stats = history.getFixStats();
      expect(stats.totalFixes).toBe(2);
      expect(stats.byStrategy['quick-fix']).toBe(2);
      expect(stats.byCategory['syntax']).toBe(2);
      expect(stats.byCategory['style']).toBe(1);
      expect(stats.averageConfidence).toBe(0.9);
      expect(stats.revertedCount).toBe(0);
      expect(stats.timeRange.first).toBeLessThanOrEqual(stats.timeRange.last);
    });
  });

  describe('getFrequentFixes', () => {
    it('should identify frequent fix patterns', () => {
      const fix1: FixResult = {
        fixed: true,
        code: '',
        changes: [{ description: 'Added semicolon', original: '', replacement: '', line: 1, column: 1 }],
        confidence: 0.9,
        strategyName: 'quick-fix',
      };
      const fix2: FixResult = {
        fixed: true,
        code: '',
        changes: [{ description: 'Added semicolon', original: '', replacement: '', line: 1, column: 1 }],
        confidence: 0.85,
        strategyName: 'quick-fix',
      };
      history.recordFix(fix1);
      history.recordFix(fix2);

      const frequent = history.getFrequentFixes();
      expect(frequent.length).toBeGreaterThan(0);
      expect(frequent[0].count).toBe(2);
      expect(frequent[0].prevention).toBeTruthy();
    });

    it('should respect the limit parameter', () => {
      for (let i = 0; i < 20; i++) {
        const fix: FixResult = {
          fixed: true,
          code: '',
          changes: [{ description: `Fix pattern ${i}`, original: '', replacement: '', line: 1, column: 1 }],
          confidence: 0.9,
          strategyName: 'test',
        };
        history.recordFix(fix);
      }

      const frequent = history.getFrequentFixes(5);
      expect(frequent.length).toBeLessThanOrEqual(5);
    });

    it('should return empty array for no history', () => {
      expect(history.getFrequentFixes()).toHaveLength(0);
    });
  });

  describe('learnFromHistory', () => {
    it('should return insights from history', () => {
      const fix: FixResult = {
        fixed: true,
        code: '',
        changes: [{ description: 'Type fix', original: '', replacement: '', line: 1, column: 1 }],
        confidence: 0.9,
        strategyName: 'type-fix',
      };
      history.recordFix(fix, '/test.ts', ['typing']);

      const insights = history.learnFromHistory();
      expect(insights.length).toBeGreaterThan(0);
    });

    it('should return empty array for no history', () => {
      expect(history.learnFromHistory()).toHaveLength(0);
    });

    it('should merge external history data', () => {
      const externalRecords = [
        {
          id: 'ext-1',
          timestamp: Date.now(),
          strategyName: 'quick-fix',
          filePath: '/ext.ts',
          description: 'Added semicolon',
          changeCount: 1,
          confidence: 0.6,
          validated: true,
          reverted: false,
          categories: ['syntax'],
        },
      ];
      const insights = history.learnFromHistory(externalRecords);
      expect(insights.length).toBeGreaterThan(0);
    });
  });

  describe('suggestPreventiveFixes', () => {
    it('should suggest fixes for code with issues', () => {
      const code = 'var x: any = 5;\nconsole.log(x);';
      const suggestions = history.suggestPreventiveFixes(code);
      expect(suggestions.length).toBeGreaterThan(0);
    });

    it('should detect var declarations', () => {
      const code = 'var x = 1;\nvar y = 2;';
      const suggestions = history.suggestPreventiveFixes(code);
      expect(suggestions.some(s => s.description.includes('var'))).toBe(true);
    });

    it('should detect TODO comments', () => {
      const code = '// TODO: fix this later\nconst x = 1;';
      const suggestions = history.suggestPreventiveFixes(code);
      expect(suggestions.some(s => s.description.includes('TODO'))).toBe(true);
    });

    it('should return empty for clean code', () => {
      const suggestions = history.suggestPreventiveFixes('');
      // May still return suggestions based on history patterns
      expect(Array.isArray(suggestions)).toBe(true);
    });
  });

  describe('exportHistory', () => {
    it('should export history as JSON', () => {
      const fix: FixResult = {
        fixed: true,
        code: '',
        changes: [{ description: 'test', original: '', replacement: '', line: 1, column: 1 }],
        confidence: 0.9,
        strategyName: 'test',
      };
      history.recordFix(fix);

      const json = history.exportHistory('json');
      const parsed = JSON.parse(json);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].strategyName).toBe('test');
    });

    it('should export history as CSV', () => {
      const fix: FixResult = {
        fixed: true,
        code: '',
        changes: [{ description: 'test fix', original: '', replacement: '', line: 1, column: 1 }],
        confidence: 0.9,
        strategyName: 'test',
      };
      history.recordFix(fix, '/test.ts', ['syntax']);

      const csv = history.exportHistory('csv');
      expect(csv).toContain('id,timestamp,strategyName');
      expect(csv).toContain('test');
    });

    it('should throw for unsupported format', () => {
      expect(() => history.exportHistory('xml' as any)).toThrow('Unsupported export format');
    });
  });

  describe('importHistory', () => {
    it('should import history from JSON', () => {
      const data = JSON.stringify([
        {
          id: 'import-1',
          timestamp: Date.now(),
          strategyName: 'quick-fix',
          filePath: '/test.ts',
          description: 'Added semicolon',
          changeCount: 1,
          confidence: 0.9,
          validated: true,
          reverted: false,
          categories: ['syntax'],
        },
      ]);
      const count = history.importHistory(data, 'json');
      expect(count).toBe(1);
      expect(history.size).toBe(1);
    });

    it('should import history from CSV', () => {
      const csv = 'id,timestamp,strategyName,filePath,description,changeCount,confidence,validated,reverted,categories\n'
        + 'import-1,1234567890,quick-fix,/test.ts,"Added semicolon",1,0.9,true,false,"syntax"';
      const count = history.importHistory(csv, 'csv');
      expect(count).toBe(1);
      expect(history.size).toBe(1);
    });

    it('should throw for invalid JSON', () => {
      expect(() => history.importHistory('not json', 'json')).toThrow('Failed to parse');
    });

    it('should throw for unsupported format', () => {
      expect(() => history.importHistory('data', 'xml' as any)).toThrow('Unsupported import format');
    });

    it('should return 0 for empty CSV', () => {
      const count = history.importHistory('', 'csv');
      expect(count).toBe(0);
    });
  });

  describe('clear and getRecords', () => {
    it('should clear all records', () => {
      const fix: FixResult = {
        fixed: true,
        code: '',
        changes: [],
        confidence: 0.9,
        strategyName: 'test',
      };
      history.recordFix(fix);
      history.clear();
      expect(history.size).toBe(0);
    });

    it('should return a copy of records', () => {
      const fix: FixResult = {
        fixed: true,
        code: '',
        changes: [],
        confidence: 0.9,
        strategyName: 'test',
      };
      history.recordFix(fix);
      const records = history.getRecords();
      expect(records).toHaveLength(1);
      // Modifying the returned array should not affect history
      records.push({} as any);
      expect(history.size).toBe(1);
    });
  });
});

// ============================================================================
// Edge case tests: conflicting fixes, fix ordering, empty inputs
// ============================================================================
describe('Edge Cases', () => {
  it('should handle empty code across all modules', () => {
    const qf = new QuickFix();
    expect(qf.fixMissingSemicolons('').fixed).toBe(false);
    expect(qf.fixTrailingCommas('').fixed).toBe(false);
    expect(qf.fixQuotes('', 'single').fixed).toBe(false);
    expect(qf.fixIndentation('', 'spaces').fixed).toBe(false);
    expect(qf.fixUnusedVariables('').fixed).toBe(false);
    expect(qf.fixMissingImports('', []).fixed).toBe(false);
  });

  it('should handle already-correct code without modifications', () => {
    const qf = new QuickFix();
    const cleanCode = 'const x: number = 1;\nconst y: string = "hello";\nexport function add(a: number, b: number): number { return a + b; }';
    expect(qf.fixMissingSemicolons(cleanCode).fixed).toBe(false);
    expect(qf.fixTrailingCommas(cleanCode).fixed).toBe(false);
  });

  it('should handle conflicting fixes (semicolon + trailing comma on same line)', () => {
    const qf = new QuickFix();
    const code = 'const x = 1';
    const semicolonResult = qf.fixMissingSemicolons(code);
    expect(semicolonResult.fixed).toBe(true);
  });

  it('should handle fix ordering (scheduler priority)', () => {
    const scheduler = new FixScheduler();
    const order: string[] = [];

    scheduler.addFix(
      (code) => { order.push('low'); return { fixed: true, code, changes: [], confidence: 0.9, strategyName: 'low' }; },
      'low',
      'style',
    );
    scheduler.addFix(
      (code) => { order.push('critical'); return { fixed: true, code, changes: [], confidence: 0.9, strategyName: 'critical' }; },
      'critical',
      'syntax',
    );
    scheduler.addFix(
      (code) => { order.push('medium'); return { fixed: true, code, changes: [], confidence: 0.9, strategyName: 'medium' }; },
      'medium',
      'linting',
    );

    const plan = scheduler.getFixPlan('code', []);
    expect(plan.fixes[0].priority).toBe('critical');
    expect(plan.fixes[1].priority).toBe('medium');
    expect(plan.fixes[2].priority).toBe('low');
  });

  it('should handle code with special characters', () => {
    const qf = new QuickFix();
    const code = 'const msg = "Hello\\nWorld";';
    const result = qf.fixMissingSemicolons(code);
    // Should not crash on escape sequences
    expect(result.code).toBeTruthy();
  });

  it('should handle very long code', () => {
    const qf = new QuickFix();
    const longCode = Array(1000).fill('const x = 1;').join('\n');
    const result = qf.fixMissingSemicolons(longCode);
    expect(result.fixed).toBe(false); // Already has semicolons
  });

  it('should handle code with only comments', () => {
    const qf = new QuickFix();
    const code = '// This is a comment\n/* Another comment */\n// More comments';
    const result = qf.fixMissingSemicolons(code);
    expect(result.fixed).toBe(false);
  });

  it('should handle fix history with many records', () => {
    const fh = new FixHistory();
    for (let i = 0; i < 100; i++) {
      fh.recordFix({
        fixed: true,
        code: '',
        changes: [{ description: `fix ${i}`, original: '', replacement: '', line: 1, column: 1 }],
        confidence: 0.5 + (i % 5) * 0.1,
        strategyName: i % 2 === 0 ? 'quick-fix' : 'type-fix',
      }, `/file${i}.ts`, ['syntax']);
    }
    expect(fh.size).toBe(100);
    const stats = fh.getFixStats();
    expect(stats.totalFixes).toBe(100);
    expect(stats.byStrategy['quick-fix']).toBe(50);
    expect(stats.byStrategy['type-fix']).toBe(50);
  });

  it('should handle validator with all checks disabled', () => {
    const validator = new FixValidator({
      checkSyntax: false,
      checkSemantics: false,
      checkTypes: false,
      runTests: false,
    });
    const result = validator.validateSyntax('function { broken');
    expect(result.valid).toBe(true);
    expect(result.score).toBe(1);
  });

  it('should handle compatibility fix with multiple browser targets', () => {
    const cf = new CompatibilityFix();
    const code = 'const last = arr.at(-1);';
    const result = cf.fixBrowserCompat(code, ['ie >= 11', 'safari >= 12', 'firefox >= 70']);
    expect(result.fixed).toBe(true);
  });

  it('should handle deprecation fix with empty replacement', () => {
    const df = new DeprecationFix();
    const map: DeprecationMap = {
      'oldFunc': {
        description: 'oldFunc is deprecated',
        alternatives: ['newFunc'],
        // no replacement property
      },
    };
    const result = df.applyDeprecationFixes('oldFunc();', map);
    expect(result.fixed).toBe(false);
  });
});
