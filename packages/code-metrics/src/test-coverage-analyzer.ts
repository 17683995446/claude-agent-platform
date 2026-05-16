// src/test-coverage-analyzer.ts

import type { FileEntry } from './dependency-analyzer.js';

export interface CoverageResult {
  lineCoverage: number;
  branchCoverage: number;
  functionCoverage: number;
  totalLines: number;
  coveredLines: number;
  uncoveredLines: number[];
  totalBranches: number;
  coveredBranches: number;
  totalFunctions: number;
  coveredFunctions: number;
  fileCoverage: Record<string, FileCoverage>;
}

export interface FileCoverage {
  path: string;
  lineCoverage: number;
  branchCoverage: number;
  functionCoverage: number;
  uncoveredLines: number[];
}

export interface CoverageReport {
  overall: CoverageResult;
  summary: string;
  thresholdBreaches: ThresholdBreach[];
}

export interface CoverageDiff {
  lineCoverageChange: number;
  branchCoverageChange: number;
  functionCoverageChange: number;
  improved: boolean;
  summary: string;
}

export interface ThresholdBreach {
  type: 'line' | 'branch' | 'function';
  actual: number;
  required: number;
  file?: string;
}

export interface CoverageThreshold {
  line?: number;
  branch?: number;
  function?: number;
}

export class TestCoverageAnalyzer {
  private thresholds: CoverageThreshold;

  constructor(thresholds?: CoverageThreshold) {
    this.thresholds = thresholds || { line: 80, branch: 75, function: 80 };
  }

  analyze(sourceFiles: FileEntry[], testFiles: FileEntry[]): CoverageResult {
    const fileCoverage: Record<string, FileCoverage> = {};

    // Build a map of source file paths to their test coverage
    const testCoverageMap = this.buildTestCoverageMap(testFiles, sourceFiles);

    let totalLines = 0;
    let coveredLines = 0;
    let totalBranches = 0;
    let coveredBranches = 0;
    let totalFunctions = 0;
    let coveredFunctions = 0;
    const allUncoveredLines: number[] = [];

    for (const source of sourceFiles) {
      const lines = source.content.split('\n');
      const sloc = lines.filter(l => l.trim().length > 0 && !l.trim().startsWith('//')).length;
      const testInfo = testCoverageMap.get(source.path);

      // Estimate coverage based on test references
      const lineCov = testInfo ? Math.min(1, testInfo.coverageRatio) : 0;
      const branchCov = testInfo ? Math.min(1, testInfo.coverageRatio * 0.9) : 0;
      const funcCov = testInfo ? Math.min(1, testInfo.functionCoverageRatio) : 0;

      const fileBranches = this.countBranches(source.content);
      const fileFunctions = this.countFunctions(source.content);

      const fileCoveredLines = Math.round(sloc * lineCov);
      const fileCoveredBranches = Math.round(fileBranches * branchCov);
      const fileCoveredFunctions = Math.round(fileFunctions * funcCov);

      totalLines += sloc;
      coveredLines += fileCoveredLines;
      totalBranches += fileBranches;
      coveredBranches += fileCoveredBranches;
      totalFunctions += fileFunctions;
      coveredFunctions += fileCoveredFunctions;

      // Generate uncovered line numbers
      const uncovered: number[] = [];
      if (lineCov < 1) {
        const slocLines = lines.map((l, i) => ({ line: l, num: i + 1 }))
          .filter(x => x.line.trim().length > 0 && !x.line.trim().startsWith('//'));
        const uncoveredCount = Math.round(slocLines.length * (1 - lineCov));
        for (let i = 0; i < uncoveredCount && i < slocLines.length; i++) {
          uncovered.push(slocLines[i].num);
          allUncoveredLines.push(slocLines[i].num);
        }
      }

      fileCoverage[source.path] = {
        path: source.path,
        lineCoverage: Math.round(lineCov * 10000) / 100,
        branchCoverage: Math.round(branchCov * 10000) / 100,
        functionCoverage: Math.round(funcCov * 10000) / 100,
        uncoveredLines: uncovered,
      };
    }

    return {
      lineCoverage: totalLines > 0 ? Math.round((coveredLines / totalLines) * 10000) / 100 : 100,
      branchCoverage: totalBranches > 0 ? Math.round((coveredBranches / totalBranches) * 10000) / 100 : 100,
      functionCoverage: totalFunctions > 0 ? Math.round((coveredFunctions / totalFunctions) * 10000) / 100 : 100,
      totalLines,
      coveredLines,
      uncoveredLines: allUncoveredLines,
      totalBranches,
      coveredBranches,
      totalFunctions,
      coveredFunctions,
      fileCoverage,
    };
  }

  getUncoveredLines(coverage: CoverageResult): number[] {
    return coverage.uncoveredLines;
  }

  getCoverageReport(coverage: CoverageResult): CoverageReport {
    const breaches: ThresholdBreach[] = [];

    if (this.thresholds.line && coverage.lineCoverage < this.thresholds.line) {
      breaches.push({ type: 'line', actual: coverage.lineCoverage, required: this.thresholds.line });
    }
    if (this.thresholds.branch && coverage.branchCoverage < this.thresholds.branch) {
      breaches.push({ type: 'branch', actual: coverage.branchCoverage, required: this.thresholds.branch });
    }
    if (this.thresholds.function && coverage.functionCoverage < this.thresholds.function) {
      breaches.push({ type: 'function', actual: coverage.functionCoverage, required: this.thresholds.function });
    }

    const summary = `Line: ${coverage.lineCoverage}%, Branch: ${coverage.branchCoverage}%, Function: ${coverage.functionCoverage}%`;

    return { overall: coverage, summary, thresholdBreaches: breaches };
  }

  compareCoverage(before: CoverageResult, after: CoverageResult): CoverageDiff {
    const lineChange = after.lineCoverage - before.lineCoverage;
    const branchChange = after.branchCoverage - before.branchCoverage;
    const funcChange = after.functionCoverage - before.functionCoverage;
    const improved = lineChange >= 0 && branchChange >= 0 && funcChange >= 0;

    const summary = improved
      ? `Coverage improved: line +${lineChange}%, branch +${branchChange}%, function +${funcChange}%`
      : `Coverage regressed: line ${lineChange}%, branch ${branchChange}%, function ${funcChange}%`;

    return {
      lineCoverageChange: Math.round(lineChange * 100) / 100,
      branchCoverageChange: Math.round(branchChange * 100) / 100,
      functionCoverageChange: Math.round(funcChange * 100) / 100,
      improved,
      summary,
    };
  }

  private buildTestCoverageMap(
    testFiles: FileEntry[],
    sourceFiles: FileEntry[]
  ): Map<string, { coverageRatio: number; functionCoverageRatio: number }> {
    const map = new Map<string, { coverageRatio: number; functionCoverageRatio: number }>();

    for (const source of sourceFiles) {
      const sourceBaseName = source.path.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
      let referenceCount = 0;

      for (const test of testFiles) {
        if (test.content.includes(sourceBaseName) || test.content.includes(source.path)) {
          referenceCount++;
        }
      }

      // Estimate coverage based on test references
      const coverageRatio = referenceCount > 0 ? Math.min(1, 0.5 + referenceCount * 0.15) : 0;
      const functionCoverageRatio = referenceCount > 0 ? Math.min(1, 0.4 + referenceCount * 0.2) : 0;

      map.set(source.path, { coverageRatio, functionCoverageRatio });
    }

    return map;
  }

  private countBranches(code: string): number {
    let count = 0;
    const patterns = [/\bif\b/g, /\belse\s+if\b/g, /\bcase\b/g, /\?\?/g, /&&/g, /\|\|/g];
    for (const p of patterns) {
      const m = code.match(p);
      if (m) count += m.length;
    }
    return count;
  }

  private countFunctions(code: string): number {
    const funcMatches = code.match(/\bfunction\b/g) || [];
    const arrowMatches = code.match(/=>\s*[{(]/g) || [];
    const methodMatches = code.match(/\b\w+\s*\([^)]*\)\s*[{]/g) || [];
    return funcMatches.length + arrowMatches.length + Math.max(0, methodMatches.length - funcMatches.length);
  }
}
