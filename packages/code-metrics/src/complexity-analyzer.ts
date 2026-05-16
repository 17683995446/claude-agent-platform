// src/complexity-analyzer.ts

export interface ComplexityResult {
  cyclomatic: number;
  cognitive: number;
  loc: number;
  sloc: number;
  cloc: number;
  nestingDepth: number;
  warnings: ComplexityWarning[];
}

export interface ComplexityWarning {
  metric: string;
  value: number;
  threshold: number;
  message: string;
}

export interface DirectoryComplexityResult {
  files: Record<string, ComplexityResult>;
  totalLoc: number;
  totalSloc: number;
  averageCyclomatic: number;
  averageCognitive: number;
  maxNestingDepth: number;
}

export interface ComplexityThreshold {
  cyclomatic?: number;
  cognitive?: number;
  nestingDepth?: number;
  loc?: number;
}

const DEFAULT_THRESHOLDS: ComplexityThreshold = {
  cyclomatic: 10,
  cognitive: 15,
  nestingDepth: 4,
  loc: 300,
};

export class ComplexityAnalyzer {
  private thresholds: ComplexityThreshold;

  constructor(thresholds?: ComplexityThreshold) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  analyze(code: string, language: string): ComplexityResult {
    const lines = code.split('\n');
    const loc = lines.length;
    const sloc = this.countSLOC(lines);
    const cloc = this.countCLOC(lines);
    const cyclomatic = this.calculateCyclomatic(code, language);
    const cognitive = this.calculateCognitive(code, language);
    const nestingDepth = this.calculateNestingDepth(code, language);
    const warnings = this.checkThresholds({ cyclomatic, cognitive, loc, sloc, cloc, nestingDepth, warnings: [] });

    return { cyclomatic, cognitive, loc, sloc, cloc, nestingDepth, warnings };
  }

  async analyzeFile(filePath: string): Promise<ComplexityResult> {
    const { readFile } = await import('node:fs/promises');
    const code = await readFile(filePath, 'utf-8');
    const ext = filePath.split('.').pop() || '';
    const language = this.extToLanguage(ext);
    return this.analyze(code, language);
  }

  async analyzeDirectory(dirPath: string): Promise<DirectoryComplexityResult> {
    const { readdir, stat, readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');

    const files: Record<string, ComplexityResult> = {};
    let totalLoc = 0;
    let totalSloc = 0;
    let totalCyclomatic = 0;
    let totalCognitive = 0;
    let maxNesting = 0;

    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js') || entry.name.endsWith('.tsx') || entry.name.endsWith('.jsx'))) {
        const fullPath = join(dirPath, entry.name);
        const code = await readFile(fullPath, 'utf-8');
        const ext = entry.name.split('.').pop() || '';
        const result = this.analyze(code, this.extToLanguage(ext));
        files[fullPath] = result;
        totalLoc += result.loc;
        totalSloc += result.sloc;
        totalCyclomatic += result.cyclomatic;
        totalCognitive += result.cognitive;
        maxNesting = Math.max(maxNesting, result.nestingDepth);
      }
    }

    const fileCount = Object.keys(files).length || 1;

    return {
      files,
      totalLoc,
      totalSloc,
      averageCyclomatic: totalCyclomatic / fileCount,
      averageCognitive: totalCognitive / fileCount,
      maxNestingDepth: maxNesting,
    };
  }

  private extToLanguage(ext: string): string {
    const map: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
      py: 'python', java: 'java', go: 'go', rs: 'rust',
    };
    return map[ext] || 'javascript';
  }

  private countSLOC(lines: string[]): number {
    let count = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*') && !trimmed.startsWith('#')) {
        count++;
      }
    }
    return count;
  }

  private countCLOC(lines: string[]): number {
    let count = 0;
    let inBlockComment = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (inBlockComment) {
        count++;
        if (trimmed.includes('*/')) inBlockComment = false;
      } else if (trimmed.startsWith('/*')) {
        count++;
        if (!trimmed.includes('*/')) inBlockComment = true;
      } else if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
        count++;
      }
    }
    return count;
  }

  calculateCyclomatic(code: string, _language: string): number {
    let complexity = 1;
    const patterns = [
      /\bif\b/g, /\belse\s+if\b/g, /\bcase\b/g, /\bfor\b/g,
      /\bwhile\b/g, /&&/g, /\|\|/g, /\bcatch\b/g, /\?\?/g,
    ];
    for (const pattern of patterns) {
      const matches = code.match(pattern);
      if (matches) complexity += matches.length;
    }
    return complexity;
  }

  calculateCognitive(code: string, _language: string): number {
    let cognitive = 0;
    let nesting = 0;
    const lines = code.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Count opening and closing braces on this line
      let openBraces = 0;
      let closeBraces = 0;
      for (const ch of trimmed) {
        if (ch === '{') openBraces++;
        if (ch === '}') closeBraces++;
      }

      // Nesting increases for control structures (count all occurrences)
      const controlMatches = trimmed.match(/\b(if|else|for|while|catch|switch)\b/g) || [];
      for (const _ of controlMatches) {
        nesting++;
        cognitive += nesting; // nesting penalty
      }

      // Sequential penalty for &&, ||
      const logicalOps = (trimmed.match(/&&|\|\|/g) || []).length;
      cognitive += logicalOps;

      // Ternary
      if (trimmed.includes('?') && trimmed.includes(':') && !trimmed.includes('case')) {
        cognitive += 1;
      }

      // Nesting decreases for closing braces
      nesting = Math.max(0, nesting - closeBraces);
    }

    return cognitive;
  }

  calculateNestingDepth(code: string, _language: string): number {
    let maxDepth = 0;
    let currentDepth = 0;
    const lines = code.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Count closing braces first (they close from previous lines)
      const closeBraces = (trimmed.match(/}/g) || []).length;
      currentDepth = Math.max(0, currentDepth - closeBraces);

      // Check for control structure openings (count all occurrences)
      const controlMatches = trimmed.match(/\b(if|else|for|while|catch|switch)\b/g) || [];
      for (const _ of controlMatches) {
        currentDepth++;
        maxDepth = Math.max(maxDepth, currentDepth);
      }
    }

    return maxDepth;
  }

  checkThresholds(result: ComplexityResult): ComplexityWarning[] {
    const warnings: ComplexityWarning[] = [];

    if (this.thresholds.cyclomatic && result.cyclomatic > this.thresholds.cyclomatic) {
      warnings.push({
        metric: 'cyclomatic',
        value: result.cyclomatic,
        threshold: this.thresholds.cyclomatic,
        message: `Cyclomatic complexity ${result.cyclomatic} exceeds threshold ${this.thresholds.cyclomatic}`,
      });
    }

    if (this.thresholds.cognitive && result.cognitive > this.thresholds.cognitive) {
      warnings.push({
        metric: 'cognitive',
        value: result.cognitive,
        threshold: this.thresholds.cognitive,
        message: `Cognitive complexity ${result.cognitive} exceeds threshold ${this.thresholds.cognitive}`,
      });
    }

    if (this.thresholds.nestingDepth && result.nestingDepth > this.thresholds.nestingDepth) {
      warnings.push({
        metric: 'nestingDepth',
        value: result.nestingDepth,
        threshold: this.thresholds.nestingDepth,
        message: `Nesting depth ${result.nestingDepth} exceeds threshold ${this.thresholds.nestingDepth}`,
      });
    }

    if (this.thresholds.loc && result.loc > this.thresholds.loc) {
      warnings.push({
        metric: 'loc',
        value: result.loc,
        threshold: this.thresholds.loc,
        message: `Lines of code ${result.loc} exceeds threshold ${this.thresholds.loc}`,
      });
    }

    return warnings;
  }
}
