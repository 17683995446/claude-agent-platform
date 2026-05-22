// src/maintainability-index.ts

import type { FileEntry } from './dependency-analyzer.js';
import { ComplexityAnalyzer } from './complexity-analyzer.js';

export interface MaintainabilityScore {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  halsteadVolume: number;
  cyclomaticComplexity: number;
  loc: number;
  recommendations: string[];
}

export interface ProjectMaintainability {
  averageScore: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  fileScores: Record<string, MaintainabilityScore>;
  recommendations: string[];
  trend?: TrendData[];
}

export interface TrendData {
  timestamp: string;
  score: number;
}

export class MaintainabilityIndex {
  private complexityAnalyzer: ComplexityAnalyzer;
  private history: TrendData[] = [];

  constructor() {
    this.complexityAnalyzer = new ComplexityAnalyzer();
  }

  calculate(code: string): MaintainabilityScore {
    if (!code.trim()) {
      return {
        score: 100,
        grade: 'A',
        halsteadVolume: 0,
        cyclomaticComplexity: 0,
        loc: 0,
        recommendations: [],
      };
    }

    const complexity = this.complexityAnalyzer.analyze(code, 'typescript');
    const halsteadVolume = this.calculateHalsteadVolume(code);
    const cyclomatic = complexity.cyclomatic;
    const loc = complexity.sloc;

    // Maintainability Index formula (simplified Microsoft variant)
    // MI = 171 - 5.2 * ln(V) - 0.23 * G - 16.2 * ln(LOC)
    // Normalized to 0-100
    const lnV = halsteadVolume > 0 ? Math.log(halsteadVolume) : 0;
    const lnLOC = loc > 0 ? Math.log(loc) : 0;
    let mi = 171 - 5.2 * lnV - 0.23 * cyclomatic - 16.2 * lnLOC;

    // Normalize to 0-100
    mi = Math.max(0, Math.min(100, mi));

    const grade = this.getGrade(mi);
    const recommendations = this.getRecommendations(mi, cyclomatic, halsteadVolume, loc);

    return {
      score: Math.round(mi * 100) / 100,
      grade,
      halsteadVolume: Math.round(halsteadVolume * 100) / 100,
      cyclomaticComplexity: cyclomatic,
      loc,
      recommendations,
    };
  }

  calculateForProject(files: FileEntry[]): ProjectMaintainability {
    const fileScores: Record<string, MaintainabilityScore> = {};
    let totalScore = 0;

    for (const file of files) {
      const score = this.calculate(file.content);
      fileScores[file.path] = score;
      totalScore += score.score;
    }

    const averageScore = files.length > 0 ? totalScore / files.length : 0;
    const grade = this.getGrade(averageScore);

    // Aggregate recommendations
    const allRecs = new Set<string>();
    for (const score of Object.values(fileScores)) {
      for (const rec of score.recommendations) {
        allRecs.add(rec);
      }
    }

    return {
      averageScore: Math.round(averageScore * 100) / 100,
      grade,
      fileScores,
      recommendations: Array.from(allRecs),
      trend: this.history.length > 0 ? [...this.history] : undefined,
    };
  }

  getGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
    if (score >= 80) return 'A';
    if (score >= 60) return 'B';
    if (score >= 40) return 'C';
    if (score >= 20) return 'D';
    return 'F';
  }

  addTrendData(timestamp: string, score: number): void {
    this.history.push({ timestamp, score });
  }

  private calculateHalsteadVolume(code: string): number {
    const operators = this.extractOperators(code);
    const operands = this.extractOperands(code);

    const n1 = operators.unique.size;  // unique operators
    const n2 = operands.unique.size;   // unique operands
    const N1 = operators.total;        // total operators
    const N2 = operands.total;         // total operands

    const n = n1 + n2;
    const N = N1 + N2;

    if (n === 0 || N === 0) return 0;

    const vocabulary = n;
    const length = N;
    const volume = length * Math.log2(vocabulary > 0 ? vocabulary : 1);

    return volume;
  }

  private extractOperators(code: string): { unique: Set<string>; total: number } {
    const operatorPatterns = [
      /\+\+/g, /--/g, /[+\-*/%]=?/g, /[&|~^]=?/g,
      /===?/g, /!==?/g, /<=?/g, />=?/g,
      /&&/g, /\|\|/g, /\?\?/g,
      /\bif\b/g, /\belse\b/g, /\bfor\b/g, /\bwhile\b/g,
      /\breturn\b/g, /\bfunction\b/g, /\bclass\b/g,
      /\bnew\b/g, /\btypeof\b/g, /\binstanceof\b/g,
      /\.\.\./g, /\?\.?/g,
    ];

    const unique = new Set<string>();
    let total = 0;

    for (const pattern of operatorPatterns) {
      const matches = code.match(pattern);
      if (matches) {
        for (const m of matches) {
          unique.add(m);
          total++;
        }
      }
    }

    return { unique, total };
  }

  private extractOperands(code: string): { unique: Set<string>; total: number } {
    const operandPattern = /\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g;
    const matches = code.match(operandPattern) || [];

    const keywords = new Set(['if', 'else', 'for', 'while', 'return', 'function', 'class', 'new', 'typeof', 'instanceof', 'const', 'let', 'var', 'import', 'export', 'from', 'default', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'async', 'await', 'yield']);

    const unique = new Set<string>();
    let total = 0;

    for (const m of matches) {
      if (!keywords.has(m)) {
        unique.add(m);
        total++;
      }
    }

    return { unique, total };
  }

  private getRecommendations(score: number, cyclomatic: number, halsteadVolume: number, loc: number): string[] {
    const recs: string[] = [];

    if (score < 40) {
      recs.push('Consider refactoring this file to improve maintainability');
    }
    if (cyclomatic > 10) {
      recs.push(`Reduce cyclomatic complexity from ${cyclomatic} to below 10`);
    }
    if (halsteadVolume > 1000) {
      recs.push(`Halstead volume is high (${Math.round(halsteadVolume)}), consider breaking into smaller functions`);
    }
    if (loc > 300) {
      recs.push(`File has ${loc} lines of code, consider splitting into smaller modules`);
    }

    return recs;
  }
}
