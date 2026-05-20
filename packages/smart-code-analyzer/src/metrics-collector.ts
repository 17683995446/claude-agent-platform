/**
 * Metrics Collector Module
 *
 * Collect comprehensive code metrics including LOC, complexity,
 * coupling, cohesion, and maintainability indices.
 */

/** File-level metrics */
export interface FileMetrics {
  filePath: string;
  linesOfCode: number;
  linesOfComments: number;
  blankLines: number;
  totalLines: number;
  functions: number;
  classes: number;
  imports: number;
  exports: number;
  averageFunctionLength: number;
  maxFunctionLength: number;
  averageComplexity: number;
  maxComplexity: number;
  maintainabilityIndex: number;
}

/** Project-level metrics */
export interface ProjectMetrics {
  totalFiles: number;
  totalLinesOfCode: number;
  totalLinesOfComments: number;
  totalBlankLines: number;
  totalFunctions: number;
  totalClasses: number;
  averageFileLOC: number;
  averageComplexity: number;
  maxComplexity: number;
  commentRatio: number;
  maintainabilityIndex: number;
  fileMetrics: FileMetrics[];
}

/** Metrics history entry for trend analysis */
export interface MetricsHistoryEntry {
  timestamp: string;
  metrics: ProjectMetrics;
}

/** Metrics comparison result */
export interface MetricsComparison {
  metric: string;
  before: number;
  after: number;
  change: number;
  changePercent: number;
  trend: "improved" | "worsened" | "unchanged";
}

/** Metrics report */
export interface MetricsReport {
  projectMetrics: ProjectMetrics;
  comparisons: MetricsComparison[];
  recommendations: string[];
  generatedAt: string;
}

/** A file for metrics collection */
export interface MetricsFile {
  filePath: string;
  content: string;
}

/**
 * MetricsCollector - Collect and analyze comprehensive code metrics.
 */
export class MetricsCollector {
  /**
   * Collect metrics for a single file.
   * @param file - The file to analyze
   * @returns File metrics
   */
  collectFileMetrics(file: MetricsFile): FileMetrics {
    const lines = file.content.split("\n");
    const totalLines = lines.length;

    let linesOfCode = 0;
    let linesOfComments = 0;
    let blankLines = 0;
    let functions = 0;
    let classes = 0;
    let imports = 0;
    let exports = 0;
    let totalFunctionLines = 0;
    let maxFunctionLength = 0;
    let currentFunctionLines = 0;
    let inFunction = false;
    let braceDepth = 0;
    const complexities: number[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // Blank lines
      if (trimmed.length === 0) {
        blankLines++;
        continue;
      }

      // Comment lines
      if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
        linesOfComments++;
        continue;
      }

      linesOfCode++;

      // Count imports
      if (trimmed.startsWith("import ")) {
        imports++;
      }

      // Count exports
      if (trimmed.startsWith("export ")) {
        exports++;
      }

      // Count classes
      if (/\bclass\s+\w+/.test(trimmed)) {
        classes++;
      }

      // Count functions
      if (/\b(function\s+\w+|const\s+\w+\s*=\s*(?:async\s+)?\([^)]*\)\s*=>)/.test(trimmed)) {
        if (inFunction && currentFunctionLines > 0) {
          totalFunctionLines += currentFunctionLines;
          maxFunctionLength = Math.max(maxFunctionLength, currentFunctionLines);
          complexities.push(this.estimateComplexity(currentFunctionLines));
        }
        functions++;
        inFunction = true;
        currentFunctionLines = 1;
        braceDepth = (trimmed.match(/{/g) ?? []).length - (trimmed.match(/}/g) ?? []).length;
        continue;
      }

      // Track function body
      if (inFunction) {
        currentFunctionLines++;
        braceDepth += (trimmed.match(/{/g) ?? []).length - (trimmed.match(/}/g) ?? []).length;
        if (braceDepth <= 0) {
          totalFunctionLines += currentFunctionLines;
          maxFunctionLength = Math.max(maxFunctionLength, currentFunctionLines);
          complexities.push(this.estimateComplexity(currentFunctionLines));
          inFunction = false;
          currentFunctionLines = 0;
          braceDepth = 0;
        }
      }

      // Count complexity indicators
      if (/\b(if|else|for|while|case|catch)\b/.test(trimmed)) {
        complexities.push(1);
      }
    }

    // Handle function that ends at EOF
    if (inFunction && currentFunctionLines > 0) {
      totalFunctionLines += currentFunctionLines;
      maxFunctionLength = Math.max(maxFunctionLength, currentFunctionLines);
      complexities.push(this.estimateComplexity(currentFunctionLines));
    }

    const averageFunctionLength = functions > 0 ? totalFunctionLines / functions : 0;
    const safeComplexities = complexities.map((c) => c ?? 0);
    const averageComplexity = safeComplexities.length > 0 ? safeComplexities.reduce((a, b) => a + b, 0) / safeComplexities.length : 0;
    const maxComplexity = safeComplexities.length > 0 ? Math.max(...safeComplexities) : 0;

    const maintainabilityIndex = this.calculateMaintainabilityIndex(
      totalLines,
      linesOfCode,
      linesOfComments,
      averageComplexity
    );

    return {
      filePath: file.filePath,
      linesOfCode,
      linesOfComments,
      blankLines,
      totalLines,
      functions,
      classes,
      imports,
      exports,
      averageFunctionLength,
      maxFunctionLength,
      averageComplexity,
      maxComplexity,
      maintainabilityIndex,
    };
  }

  /**
   * Collect metrics for an entire project.
   * @param files - Array of files to analyze
   * @returns Project-level metrics
   */
  collectProjectMetrics(files: MetricsFile[]): ProjectMetrics {
    const fileMetrics = files.map((f) => this.collectFileMetrics(f));

    const totalLinesOfCode = fileMetrics.reduce((sum, m) => sum + m.linesOfCode, 0);
    const totalLinesOfComments = fileMetrics.reduce((sum, m) => sum + m.linesOfComments, 0);
    const totalBlankLines = fileMetrics.reduce((sum, m) => sum + m.blankLines, 0);
    const totalFunctions = fileMetrics.reduce((sum, m) => sum + m.functions, 0);
    const totalClasses = fileMetrics.reduce((sum, m) => sum + m.classes, 0);
    const totalLines = fileMetrics.reduce((sum, m) => sum + m.totalLines, 0);

    const averageFileLOC = fileMetrics.length > 0 ? totalLinesOfCode / fileMetrics.length : 0;
    const averageComplexity = fileMetrics.length > 0
      ? fileMetrics.reduce((sum, m) => sum + m.averageComplexity, 0) / fileMetrics.length
      : 0;
    const maxComplexity = fileMetrics.length > 0
      ? Math.max(...fileMetrics.map((m) => m.maxComplexity))
      : 0;
    const commentRatio = totalLinesOfCode > 0 ? totalLinesOfComments / totalLinesOfCode : 0;

    const maintainabilityIndex = this.calculateMaintainabilityIndex(
      totalLines,
      totalLinesOfCode,
      totalLinesOfComments,
      averageComplexity
    );

    return {
      totalFiles: fileMetrics.length,
      totalLinesOfCode,
      totalLinesOfComments,
      totalBlankLines,
      totalFunctions,
      totalClasses,
      averageFileLOC,
      averageComplexity,
      maxComplexity,
      commentRatio,
      maintainabilityIndex,
      fileMetrics,
    };
  }

  /**
   * Analyze metrics trends over time.
   * @param history - Array of historical metrics entries
   * @returns Trend analysis with comparisons
   */
  getTrend(history: MetricsHistoryEntry[]): MetricsComparison[] {
    if (history.length < 2) return [];

    const comparisons: MetricsComparison[] = [];
    const latest = history[history.length - 1].metrics;
    const previous = history[history.length - 2].metrics;

    const metrics: Array<{ name: string; key: keyof ProjectMetrics; lowerIsBetter: boolean }> = [
      { name: "Lines of Code", key: "totalLinesOfCode", lowerIsBetter: false },
      { name: "Comment Ratio", key: "commentRatio", lowerIsBetter: false },
      { name: "Average Complexity", key: "averageComplexity", lowerIsBetter: true },
      { name: "Max Complexity", key: "maxComplexity", lowerIsBetter: true },
      { name: "Maintainability Index", key: "maintainabilityIndex", lowerIsBetter: false },
      { name: "Total Functions", key: "totalFunctions", lowerIsBetter: false },
      { name: "Total Classes", key: "totalClasses", lowerIsBetter: false },
      { name: "Average File LOC", key: "averageFileLOC", lowerIsBetter: true },
    ];

    for (const { name, key, lowerIsBetter } of metrics) {
      const before = previous[key] as number;
      const after = latest[key] as number;
      const change = after - before;
      const changePercent = before !== 0 ? (change / before) * 100 : 0;

      let trend: MetricsComparison["trend"];
      if (Math.abs(changePercent) < 0.1) {
        trend = "unchanged";
      } else if (lowerIsBetter) {
        trend = change < 0 ? "improved" : "worsened";
      } else {
        trend = change > 0 ? "improved" : "worsened";
      }

      comparisons.push({ metric: name, before, after, change, changePercent, trend });
    }

    return comparisons;
  }

  /**
   * Compare metrics between two snapshots.
   * @param before - Earlier metrics snapshot
   * @param after - Later metrics snapshot
   * @returns Array of metric comparisons
   */
  compareMetrics(before: ProjectMetrics, after: ProjectMetrics): MetricsComparison[] {
    const comparisons: MetricsComparison[] = [];

    const metrics: Array<{ name: string; getBefore: () => number; getAfter: () => number; lowerIsBetter: boolean }> = [
      { name: "Lines of Code", getBefore: () => before.totalLinesOfCode, getAfter: () => after.totalLinesOfCode, lowerIsBetter: false },
      { name: "Comment Ratio", getBefore: () => before.commentRatio, getAfter: () => after.commentRatio, lowerIsBetter: false },
      { name: "Average Complexity", getBefore: () => before.averageComplexity, getAfter: () => after.averageComplexity, lowerIsBetter: true },
      { name: "Max Complexity", getBefore: () => before.maxComplexity, getAfter: () => after.maxComplexity, lowerIsBetter: true },
      { name: "Maintainability Index", getBefore: () => before.maintainabilityIndex, getAfter: () => after.maintainabilityIndex, lowerIsBetter: false },
      { name: "Total Functions", getBefore: () => before.totalFunctions, getAfter: () => after.totalFunctions, lowerIsBetter: false },
      { name: "Total Classes", getBefore: () => before.totalClasses, getAfter: () => after.totalClasses, lowerIsBetter: false },
      { name: "Average File LOC", getBefore: () => before.averageFileLOC, getAfter: () => after.averageFileLOC, lowerIsBetter: true },
    ];

    for (const { name, getBefore, getAfter, lowerIsBetter } of metrics) {
      const b = getBefore();
      const a = getAfter();
      const change = a - b;
      const changePercent = b !== 0 ? (change / b) * 100 : 0;

      let trend: MetricsComparison["trend"];
      if (Math.abs(changePercent) < 0.1) {
        trend = "unchanged";
      } else if (lowerIsBetter) {
        trend = change < 0 ? "improved" : "worsened";
      } else {
        trend = change > 0 ? "improved" : "worsened";
      }

      comparisons.push({ metric: name, before: b, after: a, change, changePercent, trend });
    }

    return comparisons;
  }

  /**
   * Generate a comprehensive metrics report.
   * @param metrics - Project metrics
   * @returns Metrics report with recommendations
   */
  generateReport(metrics: ProjectMetrics): MetricsReport {
    const recommendations: string[] = [];

    // Maintainability index recommendations
    if (metrics.maintainabilityIndex < 50) {
      recommendations.push("Code maintainability is critically low. Consider significant refactoring.");
    } else if (metrics.maintainabilityIndex < 65) {
      recommendations.push("Code maintainability is below average. Focus on reducing complexity and improving documentation.");
    } else if (metrics.maintainabilityIndex < 80) {
      recommendations.push("Code maintainability is acceptable but could be improved.");
    }

    // Complexity recommendations
    if (metrics.maxComplexity > 20) {
      recommendations.push("Found functions with very high complexity (>20). Break them into smaller functions.");
    } else if (metrics.maxComplexity > 10) {
      recommendations.push("Some functions have high complexity (>10). Consider simplifying them.");
    }

    // Comment ratio recommendations
    if (metrics.commentRatio < 0.05) {
      recommendations.push("Code has very few comments. Add documentation for complex logic.");
    } else if (metrics.commentRatio < 0.1) {
      recommendations.push("Consider adding more comments for better code understanding.");
    }

    // File size recommendations
    if (metrics.averageFileLOC > 500) {
      recommendations.push("Average file size is large (>500 LOC). Consider splitting files.");
    }

    return {
      projectMetrics: metrics,
      comparisons: [],
      recommendations,
      generatedAt: new Date().toISOString(),
    };
  }

  // --- Private helpers ---

  private estimateComplexity(lines: number): number {
    // Simple heuristic: complexity grows with lines
    return Math.max(1, Math.ceil(lines / 5));
  }

  private calculateMaintainabilityIndex(
    totalLines: number,
    loc: number,
    comments: number,
    avgComplexity: number
  ): number {
    // Simplified maintainability index formula
    // Original: MI = 171 - 5.2 * ln(V) - 0.23 * G - 16.2 * ln(LOC)
    // Where V = Halstead Volume, G = Cyclomatic Complexity, LOC = Lines of Code
    // Simplified: use loc as proxy for volume but don't double-count
    if (loc === 0) return 100;

    // Use Halstead-like volume estimation: operators + operands proxy
    const volume = Math.max(1, loc * 0.8); // Approximate volume (slightly less than LOC)
    const lnVolume = Math.log(volume);
    const lnLOC = Math.log(Math.max(1, loc));

    const mi = 171 - 5.2 * lnVolume - 0.23 * avgComplexity - 16.2 * lnLOC;

    // Normalize to 0-100
    const normalized = Math.max(0, Math.min(100, mi));

    // Boost for comments
    const commentBoost = Math.min(comments / loc * 10, 10);

    return Math.min(100, normalized + commentBoost);
  }
}
