import { describe, test, expect, beforeEach } from 'bun:test';
import { ComplexityAnalyzer } from '../src/complexity-analyzer.ts';
import { DependencyAnalyzer } from '../src/dependency-analyzer.ts';
import type { FileEntry } from '../src/dependency-analyzer.ts';
import { DuplicationDetector } from '../src/duplication-detector.ts';
import { MaintainabilityIndex } from '../src/maintainability-index.ts';
import { TestCoverageAnalyzer } from '../src/test-coverage-analyzer.ts';
import { CodeSmellDetector } from '../src/code-smell-detector.ts';
import { NamingAnalyzer } from '../src/naming-analyzer.ts';
import { ArchitectureAnalyzer } from '../src/architecture-analyzer.ts';
import { TechnicalDebtTracker } from '../src/technical-debt.ts';
import { MetricsDashboard } from '../src/metrics-dashboard.ts';

// ============================================================
// Module 1: ComplexityAnalyzer Tests
// ============================================================
describe('ComplexityAnalyzer', () => {
  let analyzer: ComplexityAnalyzer;

  beforeEach(() => {
    analyzer = new ComplexityAnalyzer();
  });

  test('should calculate cyclomatic complexity for simple code', () => {
    const code = 'function hello() { return 1; }';
    const result = analyzer.analyze(code, 'typescript');
    expect(result.cyclomatic).toBe(1);
  });

  test('should increase cyclomatic complexity for if statements', () => {
    const code = 'function test() { if (x) {} if (y) {} }';
    const result = analyzer.analyze(code, 'typescript');
    expect(result.cyclomatic).toBeGreaterThanOrEqual(3);
  });

  test('should count for loops in cyclomatic complexity', () => {
    const code = 'function test() { for (let i = 0; i < 10; i++) {} }';
    const result = analyzer.analyze(code, 'typescript');
    expect(result.cyclomatic).toBeGreaterThanOrEqual(2);
  });

  test('should count while loops in cyclomatic complexity', () => {
    const code = 'function test() { while (true) {} }';
    const result = analyzer.analyze(code, 'typescript');
    expect(result.cyclomatic).toBeGreaterThanOrEqual(2);
  });

  test('should count logical operators in cyclomatic complexity', () => {
    const code = 'function test() { if (a && b || c) {} }';
    const result = analyzer.analyze(code, 'typescript');
    expect(result.cyclomatic).toBeGreaterThanOrEqual(4);
  });

  test('should count case statements in cyclomatic complexity', () => {
    const code = 'switch(x) { case 1: break; case 2: break; }';
    const result = analyzer.analyze(code, 'typescript');
    expect(result.cyclomatic).toBeGreaterThanOrEqual(3);
  });

  test('should count catch blocks in cyclomatic complexity', () => {
    const code = 'try {} catch(e) {}';
    const result = analyzer.analyze(code, 'typescript');
    expect(result.cyclomatic).toBeGreaterThanOrEqual(2);
  });

  test('should calculate cognitive complexity', () => {
    const code = 'function test() { if (x) { if (y) { doSomething(); } } }';
    const result = analyzer.analyze(code, 'typescript');
    expect(result.cognitive).toBeGreaterThan(0);
  });

  test('should apply nesting penalty for cognitive complexity', () => {
    const simple = 'function test() { if (x) {} }';
    const nested = 'function test() { if (x) { if (y) { if (z) {} } } }';
    const simpleResult = analyzer.analyze(simple, 'typescript');
    const nestedResult = analyzer.analyze(nested, 'typescript');
    expect(nestedResult.cognitive).toBeGreaterThan(simpleResult.cognitive);
  });

  test('should count LOC correctly', () => {
    const code = 'line1\nline2\nline3\nline4';
    const result = analyzer.analyze(code, 'typescript');
    expect(result.loc).toBe(4);
  });

  test('should count SLOC correctly', () => {
    const code = 'line1\n\n  // comment\nline2\n';
    const result = analyzer.analyze(code, 'typescript');
    expect(result.sloc).toBe(2);
  });

  test('should count CLOC correctly', () => {
    const code = '// comment1\nline1\n// comment2\nline2';
    const result = analyzer.analyze(code, 'typescript');
    expect(result.cloc).toBe(2);
  });

  test('should count block comments in CLOC', () => {
    const code = '/* block\n   comment */\nline1';
    const result = analyzer.analyze(code, 'typescript');
    expect(result.cloc).toBeGreaterThanOrEqual(1);
  });

  test('should calculate nesting depth', () => {
    const code = 'function test() { if (x) { if (y) { if (z) { deep(); } } } }';
    const result = analyzer.analyze(code, 'typescript');
    expect(result.nestingDepth).toBeGreaterThanOrEqual(3);
  });

  test('should generate warnings for high complexity', () => {
    const highThreshold = new ComplexityAnalyzer({ cyclomatic: 2 });
    const code = 'function test() { if (a) {} if (b) {} if (c) {} }';
    const result = highThreshold.analyze(code, 'typescript');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test('should not generate warnings for low complexity', () => {
    const code = 'function hello() { return 1; }';
    const result = analyzer.analyze(code, 'typescript');
    expect(result.warnings.length).toBe(0);
  });

  test('should return empty result for empty code', () => {
    const result = analyzer.analyze('', 'typescript');
    expect(result.cyclomatic).toBe(1);
    expect(result.loc).toBe(0); // empty string should have 0 LOC
  });

  test('should support custom thresholds', () => {
    const custom = new ComplexityAnalyzer({ cyclomatic: 5, cognitive: 10 });
    expect(custom).toBeDefined();
    const code = 'function test() { if (a) {} }';
    const result = custom.analyze(code, 'typescript');
    expect(result.warnings.length).toBe(0);
  });
});

// ============================================================
// Module 2: DependencyAnalyzer Tests
// ============================================================
describe('DependencyAnalyzer', () => {
  let analyzer: DependencyAnalyzer;

  beforeEach(() => {
    analyzer = new DependencyAnalyzer();
  });

  test('should parse ES module imports', () => {
    const files: FileEntry[] = [{
      path: '/src/index.ts',
      content: "import { foo } from './bar';\nimport baz from 'npm-package';",
    }];
    const result = analyzer.analyze(files);
    expect(result.nodes['/src/index.ts']).toBeDefined();
    expect(result.nodes['/src/index.ts'].dependencies.length).toBeGreaterThanOrEqual(2);
  });

  test('should classify internal dependencies', () => {
    const files: FileEntry[] = [{
      path: '/src/a.ts',
      content: "import { b } from './b';",
    }];
    const result = analyzer.analyze(files);
    const edge = result.edges.find(e => e.to === './b');
    expect(edge?.type).toBe('internal');
  });

  test('should classify external dependencies', () => {
    const files: FileEntry[] = [{
      path: '/src/a.ts',
      content: "import express from 'express';",
    }];
    const result = analyzer.analyze(files);
    const edge = result.edges.find(e => e.to === 'express');
    expect(edge?.type).toBe('external');
  });

  test('should classify built-in dependencies', () => {
    const files: FileEntry[] = [{
      path: '/src/a.ts',
      content: "import fs from 'fs';",
    }];
    const result = analyzer.analyze(files);
    const edge = result.edges.find(e => e.to === 'fs');
    expect(edge?.type).toBe('built-in');
  });

  test('should parse require statements', () => {
    const files: FileEntry[] = [{
      path: '/src/a.ts',
      content: "const path = require('path');",
      language: 'javascript',
    }];
    const result = analyzer.analyze(files);
    expect(result.edges.length).toBeGreaterThanOrEqual(1);
  });

  test('should build dependency graph with nodes', () => {
    const files: FileEntry[] = [
      { path: '/src/a.ts', content: "import { b } from './b';" },
      { path: '/src/b.ts', content: "export const b = 1;" },
    ];
    const result = analyzer.analyze(files);
    expect(Object.keys(result.nodes).length).toBe(2);
  });

  test('should build dependents list', () => {
    const files: FileEntry[] = [
      { path: '/src/a.ts', content: "import { b } from './b';" },
      { path: '/src/b.ts', content: "export const b = 1;" },
    ];
    const result = analyzer.analyze(files);
    expect(result.nodes['/src/b.ts'].dependents).toContain('/src/a.ts');
  });

  test('should detect circular dependencies', () => {
    const files: FileEntry[] = [
      { path: '/src/a.ts', content: "import { b } from './b';" },
      { path: '/src/b.ts', content: "import { a } from './a';" },
    ];
    const result = analyzer.analyze(files);
    expect(result.circularDependencies.length).toBeGreaterThanOrEqual(1);
  });

  test('should not detect false circular dependencies', () => {
    const files: FileEntry[] = [
      { path: '/src/a.ts', content: "import { b } from './b';" },
      { path: '/src/b.ts', content: "export const b = 1;" },
    ];
    const result = analyzer.analyze(files);
    expect(result.circularDependencies.length).toBe(0);
  });

  test('should calculate dependency metrics', () => {
    const files: FileEntry[] = [
      { path: '/src/a.ts', content: "import { b } from './b';\nimport { c } from './c';" },
      { path: '/src/b.ts', content: "export const b = 1;" },
      { path: '/src/c.ts', content: "export const c = 2;" },
    ];
    const result = analyzer.analyze(files);
    expect(result.metrics.totalDependencies).toBeGreaterThan(0);
    expect(result.metrics.averageFanOut).toBeGreaterThan(0);
  });

  test('should get dependency tree for a file', () => {
    const files: FileEntry[] = [
      { path: '/src/a.ts', content: "import { b } from './b';" },
      { path: '/src/b.ts', content: "export const b = 1;" },
    ];
    analyzer.analyze(files);
    const tree = analyzer.getDependencyTree('/src/a.ts');
    expect(tree).toBeDefined();
    expect(tree!.dependencies.length).toBeGreaterThanOrEqual(1);
  });

  test('should return undefined for non-existent file dependency tree', () => {
    const files: FileEntry[] = [{ path: '/src/a.ts', content: '' }];
    analyzer.analyze(files);
    expect(analyzer.getDependencyTree('/nonexistent')).toBeUndefined();
  });

  test('should handle empty file list', () => {
    const result = analyzer.analyze([]);
    expect(Object.keys(result.nodes).length).toBe(0);
  });
});

// ============================================================
// Module 3: DuplicationDetector Tests
// ============================================================
describe('DuplicationDetector', () => {
  let detector: DuplicationDetector;

  beforeEach(() => {
    detector = new DuplicationDetector({ minLines: 2, similarityThreshold: 0.8 });
  });

  test('should detect exact duplicates (Type 1)', () => {
    const files: FileEntry[] = [
      { path: '/a.ts', content: 'const x = 1;\nconst y = 2;\nconst z = 3;' },
      { path: '/b.ts', content: 'const x = 1;\nconst y = 2;\nconst z = 3;' },
    ];
    const result = detector.detect(files);
    expect(result.clonePairs.length).toBeGreaterThanOrEqual(1);
    expect(result.clonePairs[0].cloneType).toBe('type1');
  });

  test('should not detect non-duplicates', () => {
    const files: FileEntry[] = [
      { path: '/a.ts', content: 'const x = 1;\nconst y = 2;\nconst z = 3;' },
      { path: '/b.ts', content: 'function foo() {}\nfunction bar() {}\nfunction baz() {}' },
    ];
    const result = detector.detect(files);
    expect(result.clonePairs.length).toBe(0);
  });

  test('should calculate duplication rate', () => {
    const files: FileEntry[] = [
      { path: '/a.ts', content: 'const x = 1;\nconst y = 2;\nconst z = 3;' },
      { path: '/b.ts', content: 'const x = 1;\nconst y = 2;\nconst z = 3;' },
    ];
    const result = detector.detect(files);
    expect(result.duplicationRate).toBeGreaterThanOrEqual(0);
    expect(result.duplicationRate).toBeLessThanOrEqual(1);
  });

  test('should return summary with correct file counts', () => {
    const files: FileEntry[] = [
      { path: '/a.ts', content: 'const x = 1;\nconst y = 2;\nconst z = 3;' },
      { path: '/b.ts', content: 'const x = 1;\nconst y = 2;\nconst z = 3;' },
    ];
    const result = detector.detect(files);
    expect(result.summary.totalFiles).toBe(2);
  });

  test('should handle empty file list', () => {
    const result = detector.detect([]);
    expect(result.clonePairs.length).toBe(0);
    expect(result.duplicationRate).toBe(0);
  });

  test('should respect custom options', () => {
    const customDetector = new DuplicationDetector({ minLines: 5, similarityThreshold: 1.0 });
    const files: FileEntry[] = [
      { path: '/a.ts', content: 'const x = 1;\nconst y = 2;\nconst z = 3;' },
      { path: '/b.ts', content: 'const x = 1;\nconst y = 2;\nconst z = 3;' },
    ];
    const result = customDetector.detect(files);
    expect(result.clonePairs.length).toBe(0); // minLines=5 but only 3 lines
  });

  test('should find clones with findClones method', () => {
    const files: FileEntry[] = [
      { path: '/a.ts', content: 'const x = 1;\nconst y = 2;\nconst z = 3;' },
      { path: '/b.ts', content: 'const x = 1;\nconst y = 2;\nconst z = 3;' },
    ];
    // detect() sets internal files, then findClones can use them
    detector.detect(files);
    const clones = detector.findClones(0.8);
    expect(clones.length).toBeGreaterThanOrEqual(1);
  });

  test('should get duplication rate', () => {
    const files: FileEntry[] = [
      { path: '/a.ts', content: 'const x = 1;\nconst y = 2;\nconst z = 3;' },
      { path: '/b.ts', content: 'const x = 1;\nconst y = 2;\nconst z = 3;' },
    ];
    const rate = detector.getDuplicationRate();
    expect(typeof rate).toBe('number');
  });

  test('should classify clone types correctly', () => {
    const files: FileEntry[] = [
      { path: '/a.ts', content: 'const x = 1;\nconst y = 2;\nconst z = 3;' },
      { path: '/b.ts', content: 'const x = 1;\nconst y = 2;\nconst z = 3;' },
    ];
    const result = detector.detect(files);
    for (const pair of result.clonePairs) {
      expect(['type1', 'type2', 'type3']).toContain(pair.cloneType);
    }
  });
});

// ============================================================
// Module 4: MaintainabilityIndex Tests
// ============================================================
describe('MaintainabilityIndex', () => {
  let mi: MaintainabilityIndex;

  beforeEach(() => {
    mi = new MaintainabilityIndex();
  });

  test('should calculate maintainability score for simple code', () => {
    const code = 'function hello() { return 1; }';
    const result = mi.calculate(code);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  test('should assign grade A for high scores', () => {
    expect(mi.getGrade(85)).toBe('A');
    expect(mi.getGrade(100)).toBe('A');
  });

  test('should assign grade B for good scores', () => {
    expect(mi.getGrade(65)).toBe('B');
    expect(mi.getGrade(79)).toBe('B');
  });

  test('should assign grade C for moderate scores', () => {
    expect(mi.getGrade(45)).toBe('C');
    expect(mi.getGrade(59)).toBe('C');
  });

  test('should assign grade D for low scores', () => {
    expect(mi.getGrade(25)).toBe('D');
    expect(mi.getGrade(39)).toBe('D');
  });

  test('should assign grade F for very low scores', () => {
    expect(mi.getGrade(10)).toBe('F');
    expect(mi.getGrade(0)).toBe('F');
  });

  test('should calculate Halstead volume', () => {
    const code = 'function hello() { return 1; }';
    const result = mi.calculate(code);
    expect(result.halsteadVolume).toBeGreaterThan(0);
  });

  test('should include cyclomatic complexity in result', () => {
    const code = 'function test() { if (x) {} }';
    const result = mi.calculate(code);
    expect(result.cyclomaticComplexity).toBeGreaterThanOrEqual(2);
  });

  test('should provide recommendations for low scores', () => {
    const code = `
      function veryLongFunction() {
        if (a) { if (b) { if (c) { if (d) { if (e) { return 1; } } } } }
        if (f) { if (g) { if (h) { return 2; } } }
        for (let i = 0; i < 100; i++) { for (let j = 0; j < 100; j++) { console.log(i, j); } }
      }
    `;
    const result = mi.calculate(code);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  test('should calculate project maintainability', () => {
    const files: FileEntry[] = [
      { path: '/a.ts', content: 'function hello() { return 1; }' },
      { path: '/b.ts', content: 'function world() { return 2; }' },
    ];
    const result = mi.calculateForProject(files);
    expect(result.averageScore).toBeGreaterThanOrEqual(0);
    expect(result.fileScores).toBeDefined();
  });

  test('should handle empty project', () => {
    const result = mi.calculateForProject([]);
    expect(result.averageScore).toBe(0);
    expect(result.grade).toBe('F');
  });

  test('should handle empty code', () => {
    const result = mi.calculate('');
    expect(result.score).toBe(100);
    expect(result.grade).toBe('A');
    expect(result.loc).toBe(0);
    expect(result.halsteadVolume).toBe(0);
    expect(result.cyclomaticComplexity).toBe(0);
    expect(result.recommendations.length).toBe(0);
  });

  test('should track trend data', () => {
    mi.addTrendData('2024-01-01', 75);
    mi.addTrendData('2024-01-02', 80);
    const files: FileEntry[] = [{ path: '/a.ts', content: 'function hello() { return 1; }' }];
    const result = mi.calculateForProject(files);
    expect(result.trend).toBeDefined();
    expect(result.trend!.length).toBe(2);
  });
});

// ============================================================
// Module 5: TestCoverageAnalyzer Tests
// ============================================================
describe('TestCoverageAnalyzer', () => {
  let analyzer: TestCoverageAnalyzer;

  beforeEach(() => {
    analyzer = new TestCoverageAnalyzer({ line: 80, branch: 75, function: 80 });
  });

  test('should analyze coverage with matching tests', () => {
    const sourceFiles: FileEntry[] = [
      { path: '/src/utils.ts', content: 'export function add(a: number, b: number) { return a + b; }' },
    ];
    const testFiles: FileEntry[] = [
      { path: '/tests/utils.test.ts', content: "import { add } from '../src/utils'; test('add', () => { expect(add(1, 2)).toBe(3); });" },
    ];
    const result = analyzer.analyze(sourceFiles, testFiles);
    expect(result.lineCoverage).toBeGreaterThanOrEqual(0);
    expect(result.lineCoverage).toBeLessThanOrEqual(100);
  });

  test('should return zero coverage for files without tests', () => {
    const sourceFiles: FileEntry[] = [
      { path: '/src/utils.ts', content: 'export function add(a: number, b: number) { return a + b; }' },
    ];
    const testFiles: FileEntry[] = [];
    const result = analyzer.analyze(sourceFiles, testFiles);
    expect(result.lineCoverage).toBe(0);
  });

  test('should calculate branch coverage', () => {
    const sourceFiles: FileEntry[] = [
      { path: '/src/utils.ts', content: 'export function test(x: number) { if (x > 0) { return 1; } return 0; }' },
    ];
    const testFiles: FileEntry[] = [
      { path: '/tests/utils.test.ts', content: "import { test } from '../src/utils'; test('test', () => { test(1); });" },
    ];
    const result = analyzer.analyze(sourceFiles, testFiles);
    expect(result.branchCoverage).toBeGreaterThanOrEqual(0);
  });

  test('should calculate function coverage', () => {
    const sourceFiles: FileEntry[] = [
      { path: '/src/utils.ts', content: 'export function a() {} export function b() {}' },
    ];
    const testFiles: FileEntry[] = [
      { path: '/tests/utils.test.ts', content: "import { a } from '../src/utils'; test('a', () => { a(); });" },
    ];
    const result = analyzer.analyze(sourceFiles, testFiles);
    expect(result.functionCoverage).toBeGreaterThanOrEqual(0);
  });

  test('should generate coverage report', () => {
    const sourceFiles: FileEntry[] = [
      { path: '/src/utils.ts', content: 'export function add(a: number, b: number) { return a + b; }' },
    ];
    const testFiles: FileEntry[] = [];
    const result = analyzer.analyze(sourceFiles, testFiles);
    const report = analyzer.getCoverageReport(result);
    expect(report.summary).toBeDefined();
    expect(report.thresholdBreaches).toBeInstanceOf(Array);
  });

  test('should detect threshold breaches', () => {
    const sourceFiles: FileEntry[] = [
      { path: '/src/utils.ts', content: 'export function add(a: number, b: number) { return a + b; }' },
    ];
    const testFiles: FileEntry[] = [];
    const result = analyzer.analyze(sourceFiles, testFiles);
    const report = analyzer.getCoverageReport(result);
    expect(report.thresholdBreaches.length).toBeGreaterThan(0);
  });

  test('should compare coverage between runs', () => {
    const before: CoverageResult = {
      lineCoverage: 50, branchCoverage: 40, functionCoverage: 60,
      totalLines: 100, coveredLines: 50, uncoveredLines: [],
      totalBranches: 10, coveredBranches: 4, totalFunctions: 5, coveredFunctions: 3,
      fileCoverage: {},
    };
    const after: CoverageResult = {
      lineCoverage: 70, branchCoverage: 60, functionCoverage: 80,
      totalLines: 100, coveredLines: 70, uncoveredLines: [],
      totalBranches: 10, coveredBranches: 6, totalFunctions: 5, coveredFunctions: 4,
      fileCoverage: {},
    };
    const diff = analyzer.compareCoverage(before, after);
    expect(diff.improved).toBe(true);
    expect(diff.lineCoverageChange).toBe(20);
  });

  test('should detect coverage regression', () => {
    const before: CoverageResult = {
      lineCoverage: 80, branchCoverage: 70, functionCoverage: 90,
      totalLines: 100, coveredLines: 80, uncoveredLines: [],
      totalBranches: 10, coveredBranches: 7, totalFunctions: 5, coveredFunctions: 4,
      fileCoverage: {},
    };
    const after: CoverageResult = {
      lineCoverage: 60, branchCoverage: 50, functionCoverage: 70,
      totalLines: 100, coveredLines: 60, uncoveredLines: [],
      totalBranches: 10, coveredBranches: 5, totalFunctions: 5, coveredFunctions: 3,
      fileCoverage: {},
    };
    const diff = analyzer.compareCoverage(before, after);
    expect(diff.improved).toBe(false);
  });

  test('should get uncovered lines', () => {
    const sourceFiles: FileEntry[] = [
      { path: '/src/utils.ts', content: 'export function add(a: number, b: number) { return a + b; }' },
    ];
    const testFiles: FileEntry[] = [];
    const result = analyzer.analyze(sourceFiles, testFiles);
    const uncovered = analyzer.getUncoveredLines(result);
    expect(uncovered).toBeInstanceOf(Array);
  });

  test('should handle empty source files', () => {
    const result = analyzer.analyze([], []);
    expect(result.lineCoverage).toBe(100);
    expect(result.totalLines).toBe(0);
  });
});

// ============================================================
// Module 6: CodeSmellDetector Tests
// ============================================================
describe('CodeSmellDetector', () => {
  let detector: CodeSmellDetector;

  beforeEach(() => {
    detector = new CodeSmellDetector();
  });

  test('should detect long methods', () => {
    const lines = Array(25).fill('  console.log("line");');
    const code = `function longMethod() {\n${lines.join('\n')}\n}`;
    const results = detector.detect(code, 'typescript');
    const longMethod = results.find(r => r.type === 'Long Method');
    expect(longMethod).toBeDefined();
  });

  test('should detect large classes', () => {
    const lines = Array(210).fill('  method() {}');
    const code = `class LargeClass {\n${lines.join('\n')}\n}`;
    const results = detector.detect(code, 'typescript');
    const largeClass = results.find(r => r.type === 'Large Class');
    expect(largeClass).toBeDefined();
  });

  test('should detect long parameter lists', () => {
    const code = 'function test(a: string, b: number, c: boolean, d: string, e: number) {}';
    const results = detector.detect(code, 'typescript');
    const longParams = results.find(r => r.type === 'Long Parameter List');
    expect(longParams).toBeDefined();
  });

  test('should detect switch statements', () => {
    const code = "switch(x) { case 1: break; case 2: break; default: break; }";
    const results = detector.detect(code, 'typescript');
    const switchSmell = results.find(r => r.type === 'Switch Statements');
    expect(switchSmell).toBeDefined();
  });

  test('should detect dead code', () => {
    const code = 'function test() {\n  return 1;\n  return 2;\n}';
    const results = detector.detect(code, 'typescript');
    const deadCode = results.find(r => r.type === 'Dead Code');
    expect(deadCode).toBeDefined();
  });

  test('should detect excessive comments', () => {
    const comments = Array(7).fill('// This is a comment');
    const code = comments.join('\n');
    const results = detector.detect(code, 'typescript');
    const excessive = results.find(r => r.type === 'Excessive Comments');
    expect(excessive).toBeDefined();
  });

  test('should detect feature envy', () => {
    const code = `function process(obj) {
  const a = obj.data.items[0].user.profile.name;
  const b = obj.data.items[0].user.profile.email;
  const c = obj.data.items[1].user.profile.name;
  const d = obj.data.items[1].user.profile.email;
  const e = obj.config.settings.theme.color;
  const f = obj.config.settings.lang.code;
}`;
    const results = detector.detect(code, 'typescript');
    const envy = results.find(r => r.type === 'Feature Envy');
    expect(envy).toBeDefined();
  });

  test('should detect duplicate code within a file', () => {
    const code = 'const x = someVeryLongUniqueLineThatShouldBeDetected;\nconst y = 1;\nconst x = someVeryLongUniqueLineThatShouldBeDetected;';
    const results = detector.detect(code, 'typescript');
    const duplicate = results.find(r => r.type === 'Duplicate Code');
    expect(duplicate).toBeDefined();
  });

  test('should return empty results for clean code', () => {
    const code = 'function add(a: number, b: number): number { return a + b; }';
    const results = detector.detect(code, 'typescript');
    expect(results.length).toBe(0);
  });

  test('should generate smell summary', () => {
    const code = 'switch(x) { case 1: break; }';
    const results = detector.detect(code, 'typescript');
    const summary = detector.getSmellSummary(results);
    expect(summary.total).toBe(results.length);
    expect(summary.mostCommon).toBeDefined();
  });

  test('should categorize smells correctly', () => {
    const code = 'switch(x) { case 1: break; }';
    const results = detector.detect(code, 'typescript');
    const summary = detector.getSmellSummary(results);
    expect(summary.byCategory).toBeDefined();
    expect(summary.bySeverity).toBeDefined();
  });

  test('should include severity levels', () => {
    const code = 'switch(x) { case 1: break; }';
    const results = detector.detect(code, 'typescript');
    for (const smell of results) {
      expect(['info', 'warning', 'error', 'critical']).toContain(smell.severity);
    }
  });

  test('should provide fix suggestions', () => {
    const code = 'switch(x) { case 1: break; }';
    const results = detector.detect(code, 'typescript');
    for (const smell of results) {
      if (smell.suggestion) {
        expect(typeof smell.suggestion).toBe('string');
        expect(smell.suggestion.length).toBeGreaterThan(0);
      }
    }
  });
});

// ============================================================
// Module 7: NamingAnalyzer Tests
// ============================================================
describe('NamingAnalyzer', () => {
  let analyzer: NamingAnalyzer;

  beforeEach(() => {
    analyzer = new NamingAnalyzer();
  });

  test('should detect camelCase convention', () => {
    expect(analyzer.checkConvention('myVariable', 'variable', 'camelCase')).toBe(true);
  });

  test('should detect PascalCase convention', () => {
    expect(analyzer.checkConvention('MyClass', 'class', 'PascalCase')).toBe(true);
  });

  test('should detect snake_case convention', () => {
    expect(analyzer.checkConvention('my_variable', 'variable', 'snake_case')).toBe(true);
  });

  test('should detect SCREAMING_SNAKE_CASE convention', () => {
    expect(analyzer.checkConvention('MY_CONSTANT', 'constant', 'SCREAMING_SNAKE_CASE')).toBe(true);
  });

  test('should detect kebab-case convention', () => {
    expect(analyzer.checkConvention('my-file', 'file', 'kebab-case')).toBe(true);
  });

  test('should reject wrong convention', () => {
    expect(analyzer.checkConvention('My_Variable', 'variable', 'camelCase')).toBe(false);
  });

  test('should analyze code for naming issues', () => {
    const code = 'class my_class { const MY_VAR = 1; function MyFunc() {} }';
    const result = analyzer.analyze(code);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  test('should return no issues for well-named code', () => {
    const code = 'class MyClass { const MY_VAR = 1; function myFunc() {} }';
    const result = analyzer.analyze(code);
    expect(result.issues.length).toBe(0);
  });

  test('should calculate naming score', () => {
    const code = 'class MyClass { const MY_VAR = 1; function myFunc() {} }';
    const result = analyzer.analyze(code);
    expect(result.score).toBe(100);
  });

  test('should calculate consistency score', () => {
    const code = 'class MyClass { const MY_VAR = 1; function myFunc() {} }';
    const result = analyzer.analyze(code);
    expect(result.consistencyScore).toBe(100);
  });

  test('should suggest names based on purpose', () => {
    const suggestions = analyzer.suggestName('function', 'calculate total price');
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0]).toBe('calculateTotalPrice');
  });

  test('should suggest PascalCase for class names', () => {
    const suggestions = analyzer.suggestName('class', 'user service');
    expect(suggestions[0]).toBe('UserService');
  });

  test('should suggest SCREAMING_SNAKE_CASE for constants', () => {
    const suggestions = analyzer.suggestName('constant', 'max retry count');
    expect(suggestions[0]).toBe('MAX_RETRY_COUNT');
  });

  test('should detect too short names', () => {
    const code = 'const x = 1;';
    const result = analyzer.analyze(code);
    const shortName = result.issues.find(i => i.message.includes('too short'));
    expect(shortName).toBeDefined();
  });

  test('should detect forbidden names', () => {
    const code = 'const data = 1;';
    const result = analyzer.analyze(code);
    const forbidden = result.issues.find(i => i.message.includes('forbidden'));
    expect(forbidden).toBeDefined();
  });

  test('should respect custom config', () => {
    const custom = new NamingAnalyzer({
      conventions: { variable: 'snake_case', function: 'snake_case' },
    });
    expect(custom.checkConvention('my_var', 'variable', 'snake_case')).toBe(true);
  });

  test('should count total names analyzed', () => {
    const code = 'class MyClass { const MY_VAR = 1; function myFunc() {} const x = 2; }';
    const result = analyzer.analyze(code);
    expect(result.totalNames).toBeGreaterThan(0);
  });
});

// ============================================================
// Module 8: ArchitectureAnalyzer Tests
// ============================================================
describe('ArchitectureAnalyzer', () => {
  let analyzer: ArchitectureAnalyzer;

  beforeEach(() => {
    analyzer = new ArchitectureAnalyzer();
  });

  test('should detect layered architecture', () => {
    const project = {
      rootPath: '/project',
      files: [
        { path: '/project/controllers/userController.ts', content: "import { UserService } from '../services';" },
        { path: '/project/services/userService.ts', content: "import { UserRepository } from '../repositories';" },
        { path: '/project/repositories/userRepository.ts', content: '' },
      ],
      directories: ['controllers', 'services', 'repositories', 'models'],
    };
    const result = analyzer.analyze(project);
    expect(result.detectedPattern).toBeDefined();
  });

  test('should detect MVC architecture', () => {
    const project = {
      rootPath: '/project',
      files: [
        { path: '/project/controllers/userController.ts', content: '' },
        { path: '/project/views/userView.ts', content: '' },
        { path: '/project/models/userModel.ts', content: '' },
      ],
      directories: ['controllers', 'views', 'models'],
    };
    const result = analyzer.analyze(project);
    expect(result.detectedPattern).toBeDefined();
  });

  test('should return undefined pattern for unrecognized structure', () => {
    const project = {
      rootPath: '/project',
      files: [{ path: '/project/random.ts', content: '' }],
      directories: ['random'],
    };
    const result = analyzer.analyze(project);
    expect(result.detectedPattern).toBeUndefined();
  });

  test('should detect components', () => {
    const project = {
      rootPath: '/project',
      files: [
        { path: '/project/src/utils/helper.ts', content: '' },
        { path: '/project/src/models/user.ts', content: '' },
      ],
      directories: ['src/utils', 'src/models'],
    };
    const result = analyzer.analyze(project);
    expect(result.components.length).toBeGreaterThan(0);
  });

  test('should generate component graph', () => {
    const project = {
      rootPath: '/project',
      files: [
        { path: '/project/src/a.ts', content: "import { b } from './b';" },
        { path: '/project/src/b.ts', content: '' },
      ],
      directories: ['src'],
    };
    const result = analyzer.analyze(project);
    expect(result.componentGraph.nodes.length).toBeGreaterThan(0);
  });

  test('should check layer violations', () => {
    const rules = [
      { layer: 'controllers', allowedDependencies: ['services'], directoryPattern: 'controllers' },
      { layer: 'services', allowedDependencies: ['repositories'], directoryPattern: 'services' },
      { layer: 'repositories', allowedDependencies: [], directoryPattern: 'repositories' },
    ];
    const violations = analyzer.checkLayerViolations(rules);
    expect(violations).toBeInstanceOf(Array);
  });

  test('should calculate fitness score', () => {
    const project = {
      rootPath: '/project',
      files: [{ path: '/project/a.ts', content: '' }],
      directories: [],
    };
    const result = analyzer.analyze(project);
    expect(result.fitnessScore).toBeGreaterThanOrEqual(0);
    expect(result.fitnessScore).toBeLessThanOrEqual(100);
  });

  test('should infer component types', () => {
    const project = {
      rootPath: '/project',
      files: [
        { path: '/project/controllers/a.ts', content: '' },
        { path: '/project/services/b.ts', content: '' },
      ],
      directories: ['controllers', 'services'],
    };
    const result = analyzer.analyze(project);
    const types = result.components.map(c => c.type);
    expect(types).toContain('controller');
    expect(types).toContain('service');
  });
});

// ============================================================
// Module 9: TechnicalDebtTracker Tests
// ============================================================
describe('TechnicalDebtTracker', () => {
  let tracker: TechnicalDebtTracker;

  beforeEach(() => {
    tracker = new TechnicalDebtTracker();
  });

  test('should add debt item', () => {
    const item = tracker.addDebt({
      title: 'Refactor UserService',
      description: 'Too many responsibilities',
      type: 'code_smell',
      priority: 'medium',
      effort: 4,
      impact: 5,
      tags: ['refactoring'],
    });
    expect(item.id).toBeDefined();
    expect(item.status).toBe('open');
  });

  test('should resolve debt item', () => {
    const item = tracker.addDebt({
      title: 'Test',
      description: 'Test debt',
      type: 'missing_tests',
      priority: 'high',
      effort: 2,
      impact: 7,
      tags: [],
    });
    tracker.resolveDebt(item.id);
    const resolved = tracker.getDebt(item.id);
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.resolvedAt).toBeDefined();
  });

  test('should generate debt report', () => {
    tracker.addDebt({
      title: 'Debt 1',
      description: 'First debt',
      type: 'code_smell',
      priority: 'high',
      effort: 3,
      impact: 8,
      tags: [],
    });
    tracker.addDebt({
      title: 'Debt 2',
      description: 'Second debt',
      type: 'missing_tests',
      priority: 'low',
      effort: 1,
      impact: 3,
      tags: [],
    });
    const report = tracker.getDebtReport();
    expect(report.totalItems).toBe(2);
    expect(report.openItems).toBe(2);
    expect(report.totalDebtHours).toBe(4);
  });

  test('should calculate total debt hours', () => {
    tracker.addDebt({
      title: 'D1', description: '', type: 'code_smell', priority: 'high', effort: 5, impact: 5, tags: [],
    });
    tracker.addDebt({
      title: 'D2', description: '', type: 'code_smell', priority: 'medium', effort: 3, impact: 5, tags: [],
    });
    expect(tracker.getTotalDebtHours()).toBe(8);
  });

  test('should get debt by priority', () => {
    tracker.addDebt({
      title: 'High', description: '', type: 'code_smell', priority: 'high', effort: 2, impact: 5, tags: [],
    });
    tracker.addDebt({
      title: 'Low', description: '', type: 'code_smell', priority: 'low', effort: 1, impact: 5, tags: [],
    });
    const highDebt = tracker.getPriorityDebt('high');
    expect(highDebt.length).toBe(1);
    expect(highDebt[0].title).toBe('High');
  });

  test('should get debt by type', () => {
    tracker.addDebt({
      title: 'Smell', description: '', type: 'code_smell', priority: 'medium', effort: 2, impact: 5, tags: [],
    });
    tracker.addDebt({
      title: 'Tests', description: '', type: 'missing_tests', priority: 'medium', effort: 1, impact: 5, tags: [],
    });
    const smells = tracker.getDebtByType('code_smell');
    expect(smells.length).toBe(1);
  });

  test('should schedule debt repayment', () => {
    tracker.addDebt({
      title: 'Critical', description: '', type: 'security_issue', priority: 'critical', effort: 8, impact: 10, tags: [],
    });
    tracker.addDebt({
      title: 'Low', description: '', type: 'code_smell', priority: 'low', effort: 2, impact: 3, tags: [],
    });
    const schedule = tracker.scheduleRepayment(10);
    expect(schedule.items.length).toBeGreaterThan(0);
    expect(schedule.totalEffort).toBeLessThanOrEqual(10);
  });

  test('should track trend over time', () => {
    tracker.addDebt({
      title: 'D1', description: '', type: 'code_smell', priority: 'medium', effort: 2, impact: 5, tags: [],
    });
    tracker.recordSnapshot();
    tracker.resolveDebt(tracker.getDebtReport().topItems[0].id);
    tracker.recordSnapshot();
    const report = tracker.getDebtReport();
    expect(report.trend.direction).toBe('improving');
  });

  test('should categorize debt by type in report', () => {
    tracker.addDebt({
      title: 'Smell', description: '', type: 'code_smell', priority: 'medium', effort: 2, impact: 5, tags: [],
    });
    tracker.addDebt({
      title: 'Bug', description: '', type: 'known_bug', priority: 'high', effort: 3, impact: 8, tags: [],
    });
    const report = tracker.getDebtReport();
    expect(report.byType.code_smell).toBe(1);
    expect(report.byType.known_bug).toBe(1);
  });

  test('should categorize debt by priority in report', () => {
    tracker.addDebt({
      title: 'High', description: '', type: 'code_smell', priority: 'high', effort: 2, impact: 5, tags: [],
    });
    tracker.addDebt({
      title: 'Critical', description: '', type: 'security_issue', priority: 'critical', effort: 4, impact: 10, tags: [],
    });
    const report = tracker.getDebtReport();
    expect(report.byPriority.high).toBe(1);
    expect(report.byPriority.critical).toBe(1);
  });

  test('should return top items sorted by priority', () => {
    tracker.addDebt({
      title: 'Low', description: '', type: 'code_smell', priority: 'low', effort: 1, impact: 2, tags: [],
    });
    tracker.addDebt({
      title: 'Critical', description: '', type: 'security_issue', priority: 'critical', effort: 4, impact: 10, tags: [],
    });
    const report = tracker.getDebtReport();
    expect(report.topItems[0].title).toBe('Critical');
  });
});

// ============================================================
// Module 10: MetricsDashboard Tests
// ============================================================
describe('MetricsDashboard', () => {
  let dashboard: MetricsDashboard;

  beforeEach(() => {
    dashboard = new MetricsDashboard();
  });

  test('should add analysis results', () => {
    dashboard.addAnalysis('complexity', { type: 'complexity', timestamp: '', data: { cyclomatic: 5 }, score: 85 });
    dashboard.addAnalysis('coverage', { type: 'coverage', timestamp: '', data: { line: 90 }, score: 90 });
    const data = dashboard.getDashboard();
    expect(data.analyses.length).toBe(2);
  });

  test('should calculate overall score', () => {
    dashboard.addAnalysis('complexity', { type: 'complexity', timestamp: '', data: {}, score: 80 });
    dashboard.addAnalysis('coverage', { type: 'coverage', timestamp: '', data: {}, score: 90 });
    const data = dashboard.getDashboard();
    expect(data.overallScore).toBe(85);
  });

  test('should generate alerts for low scores', () => {
    dashboard.addAnalysis('coverage', { type: 'coverage', timestamp: '', data: {}, score: 50 });
    const alerts = dashboard.getAlerts();
    expect(alerts.length).toBeGreaterThan(0);
  });

  test('should not generate alerts for good scores', () => {
    dashboard.addAnalysis('coverage', { type: 'coverage', timestamp: '', data: {}, score: 95 });
    const alerts = dashboard.getAlerts();
    expect(alerts.length).toBe(0);
  });

  test('should generate JSON report', () => {
    dashboard.addAnalysis('complexity', { type: 'complexity', timestamp: '', data: {}, score: 85 });
    const report = dashboard.generateReport('json');
    const parsed = JSON.parse(report);
    expect(parsed.overallScore).toBe(85);
  });

  test('should generate markdown report', () => {
    dashboard.addAnalysis('complexity', { type: 'complexity', timestamp: '', data: {}, score: 85 });
    const report = dashboard.generateReport('markdown');
    expect(report).toContain('# Code Metrics Dashboard');
    expect(report).toContain('85');
  });

  test('should generate HTML report', () => {
    dashboard.addAnalysis('complexity', { type: 'complexity', timestamp: '', data: {}, score: 85 });
    const report = dashboard.generateReport('html');
    expect(report).toContain('<!DOCTYPE html>');
    expect(report).toContain('Code Metrics Dashboard');
  });

  test('should track trends', () => {
    dashboard.addAnalysis('coverage', { type: 'coverage', timestamp: '', data: {}, score: 70 });
    dashboard.addAnalysis('coverage', { type: 'coverage', timestamp: '', data: {}, score: 80 });
    const trend = dashboard.getTrend('coverage', 'week');
    expect(trend.metric).toBe('coverage');
    expect(trend.dataPoints.length).toBe(2);
  });

  test('should detect improving trend', () => {
    dashboard.addAnalysis('coverage', { type: 'coverage', timestamp: '', data: {}, score: 50 });
    dashboard.addAnalysis('coverage', { type: 'coverage', timestamp: '', data: {}, score: 80 });
    const trend = dashboard.getTrend('coverage', 'week');
    expect(trend.trend).toBe('improving');
  });

  test('should detect worsening trend', () => {
    dashboard.addAnalysis('complexity', { type: 'complexity', timestamp: '', data: {}, score: 5 });
    dashboard.addAnalysis('complexity', { type: 'complexity', timestamp: '', data: {}, score: 20 });
    const trend = dashboard.getTrend('complexity', 'week');
    expect(trend.trend).toBe('worsening');
  });

  test('should handle empty dashboard', () => {
    const data = dashboard.getDashboard();
    expect(data.overallScore).toBe(0);
    expect(data.analyses.length).toBe(0);
    expect(data.alerts.length).toBe(0);
  });

  test('should include summary in dashboard', () => {
    dashboard.addAnalysis('complexity', { type: 'complexity', timestamp: '', data: {}, score: 85 });
    const data = dashboard.getDashboard();
    expect(data.summary).toBeDefined();
    expect(data.summary.totalAnalyses).toBe(1);
  });

  test('should sort alerts by severity', () => {
    dashboard.addAnalysis('coverage', { type: 'coverage', timestamp: '', data: {}, score: 30 });
    dashboard.addAnalysis('complexity', { type: 'complexity', timestamp: '', data: {}, score: 25 });
    const alerts = dashboard.getAlerts();
    for (let i = 1; i < alerts.length; i++) {
      const order: Record<string, number> = { critical: 0, error: 1, warning: 2, info: 3 };
      expect(order[alerts[i].level]).toBeGreaterThanOrEqual(order[alerts[i - 1].level]);
    }
  });

  test('should filter trend by period', () => {
    dashboard.addAnalysis('coverage', { type: 'coverage', timestamp: '', data: {}, score: 70 });
    dashboard.addAnalysis('coverage', { type: 'coverage', timestamp: '', data: {}, score: 80 });
    const trend = dashboard.getTrend('coverage', 'day');
    expect(trend.period).toBe('day');
  });

  test('should return stable trend for insufficient data', () => {
    dashboard.addAnalysis('coverage', { type: 'coverage', timestamp: '', data: {}, score: 80 });
    const trend = dashboard.getTrend('coverage', 'week');
    expect(trend.trend).toBe('stable');
  });

  test('should include lastUpdated timestamp', () => {
    const data = dashboard.getDashboard();
    expect(data.lastUpdated).toBeDefined();
    expect(typeof data.lastUpdated).toBe('string');
  });
});
