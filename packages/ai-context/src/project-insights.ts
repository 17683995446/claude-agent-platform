// ============================================================
// Module 9: Project Insights Engine
// Architecture detection, quality metrics, dependency analysis
// ============================================================

export interface ProjectData {
  files: { path: string; content: string; language: string }[];
  rootPath?: string;
  packageJson?: Record<string, unknown>;
}

export interface ProjectInsight {
  architecture: ArchitecturePattern;
  quality: QualityMetrics;
  dependencies: DependencyAnalysis;
  patterns: TeamPatterns;
  trends: TrendAnalysis;
  summary: string;
  analyzedAt: number;
}

export type ArchitecturePattern =
  | 'mvc'
  | 'mvvm'
  | 'clean'
  | 'microservices'
  | 'monolith'
  | 'component-based'
  | 'serverless'
  | 'unknown';

export interface QualityMetrics {
  maintainabilityIndex: number; // 0-100
  technicalDebtScore: number; // 0-100 (higher = more debt)
  duplicationRatio: number; // 0-1
  averageComplexity: number;
  testCoverage: number; // 0-1
  documentationCoverage: number; // 0-1
}

export interface DependencyAnalysis {
  circularDependencies: [string, string][];
  unusedExports: string[];
  missingDependencies: string[];
  dependencyCount: number;
  externalDependencyCount: number;
  internalDependencyCount: number;
}

export interface TeamPatterns {
  codingStyleConsistency: number; // 0-1
  namingConvention: string;
  documentationStyle: string;
  testStyle: string;
}

export interface TrendAnalysis {
  codeGrowthRate: number; // lines per day (estimated)
  complexityGrowthRate: number;
  testCoverageTrend: 'improving' | 'stable' | 'declining';
  lastUpdated: number;
}

export interface Recommendation {
  category: 'architecture' | 'quality' | 'dependencies' | 'testing' | 'documentation';
  priority: 'high' | 'medium' | 'low';
  description: string;
  impact: string;
}

export interface InsightDiff {
  qualityChanges: { metric: string; before: number; after: number; direction: 'improved' | 'declined' | 'unchanged' }[];
  newIssues: string[];
  resolvedIssues: string[];
  summary: string;
}

export class ProjectInsightsEngine {
  analyze(project: ProjectData): ProjectInsight {
    const architecture = this.detectArchitecture(project);
    const quality = this.computeQualityMetrics(project);
    const dependencies = this.analyzeDependencies(project);
    const patterns = this.detectTeamPatterns(project);
    const trends = this.analyzeTrends(project);

    const summary = this.generateInsightSummary(architecture, quality, dependencies, patterns);

    return {
      architecture,
      quality,
      dependencies,
      patterns,
      trends,
      summary,
      analyzedAt: Date.now(),
    };
  }

  getRecommendations(insight: ProjectInsight): Recommendation[] {
    const recommendations: Recommendation[] = [];

    // Architecture recommendations
    if (insight.architecture === 'unknown') {
      recommendations.push({
        category: 'architecture',
        priority: 'medium',
        description: 'Consider establishing a clear architecture pattern',
        impact: 'Improved maintainability and team onboarding',
      });
    }

    // Quality recommendations
    if (insight.quality.maintainabilityIndex < 60) {
      recommendations.push({
        category: 'quality',
        priority: 'high',
        description: 'Maintainability index is low. Consider refactoring complex modules',
        impact: 'Easier maintenance and fewer bugs',
      });
    }

    if (insight.quality.technicalDebtScore > 50) {
      recommendations.push({
        category: 'quality',
        priority: 'high',
        description: 'High technical debt detected. Plan a refactoring sprint',
        impact: 'Reduced bug rate and faster development',
      });
    }

    if (insight.quality.duplicationRatio > 0.1) {
      recommendations.push({
        category: 'quality',
        priority: 'medium',
        description: 'Significant code duplication found. Extract shared utilities',
        impact: 'Reduced code size and easier maintenance',
      });
    }

    // Dependency recommendations
    if (insight.dependencies.circularDependencies.length > 0) {
      recommendations.push({
        category: 'dependencies',
        priority: 'high',
        description: `Found ${insight.dependencies.circularDependencies.length} circular dependencies`,
        impact: 'Better module isolation and testability',
      });
    }

    // Testing recommendations
    if (insight.quality.testCoverage < 0.5) {
      recommendations.push({
        category: 'testing',
        priority: 'high',
        description: 'Test coverage is below 50%. Add more tests',
        impact: 'Increased confidence in code changes',
      });
    }

    // Documentation recommendations
    if (insight.quality.documentationCoverage < 0.3) {
      recommendations.push({
        category: 'documentation',
        priority: 'medium',
        description: 'Documentation coverage is low. Add JSDoc comments',
        impact: 'Better developer experience and onboarding',
      });
    }

    return recommendations;
  }

  compareInsights(before: ProjectInsight, after: ProjectInsight): InsightDiff {
    const qualityChanges: InsightDiff['qualityChanges'] = [];

    const metrics: { key: keyof QualityMetrics; label: string }[] = [
      { key: 'maintainabilityIndex', label: 'Maintainability Index' },
      { key: 'technicalDebtScore', label: 'Technical Debt Score' },
      { key: 'duplicationRatio', label: 'Duplication Ratio' },
      { key: 'averageComplexity', label: 'Average Complexity' },
      { key: 'testCoverage', label: 'Test Coverage' },
      { key: 'documentationCoverage', label: 'Documentation Coverage' },
    ];

    for (const { key, label } of metrics) {
      const beforeVal = before.quality[key] as number;
      const afterVal = after.quality[key] as number;

      // For metrics where lower is better, invert direction
      let direction: 'improved' | 'declined' | 'unchanged';
      const isLowerBetter = key === 'technicalDebtScore' || key === 'duplicationRatio' || key === 'averageComplexity';

      if (Math.abs(afterVal - beforeVal) < 0.01) {
        direction = 'unchanged';
      } else if (isLowerBetter ? afterVal < beforeVal : afterVal > beforeVal) {
        direction = 'improved';
      } else {
        direction = 'declined';
      }

      qualityChanges.push({ metric: label, before: beforeVal, after: afterVal, direction });
    }

    const newCircles = after.dependencies.circularDependencies.length - before.dependencies.circularDependencies.length;
    const newIssues: string[] = [];
    const resolvedIssues: string[] = [];

    if (newCircles > 0) newIssues.push(`${newCircles} new circular dependencies`);
    if (newCircles < 0) resolvedIssues.push(`${Math.abs(newCircles)} circular dependencies resolved`);

    if (after.quality.testCoverage < before.quality.testCoverage) {
      newIssues.push('Test coverage decreased');
    } else if (after.quality.testCoverage > before.quality.testCoverage) {
      resolvedIssues.push('Test coverage improved');
    }

    const improvedCount = qualityChanges.filter(c => c.direction === 'improved').length;
    const declinedCount = qualityChanges.filter(c => c.direction === 'declined').length;

    return {
      qualityChanges,
      newIssues,
      resolvedIssues,
      summary: `${improvedCount} metrics improved, ${declinedCount} declined. ${newIssues.length} new issues, ${resolvedIssues.length} resolved.`,
    };
  }

  private detectArchitecture(project: ProjectData): ArchitecturePattern {
    const paths = project.files.map(f => f.path.toLowerCase());
    const allContent = project.files.map(f => f.content).join('\n');
    const allLower = allContent.toLowerCase();

    // MVC detection
    if (paths.some(p => p.includes('controller') || p.includes('view') || p.includes('model'))) {
      return 'mvc';
    }

    // MVVM detection
    if (paths.some(p => p.includes('viewmodel') || p.includes('view-model'))) {
      return 'mvvm';
    }

    // Clean Architecture detection
    if (paths.some(p => p.includes('domain') || p.includes('usecase') || p.includes('use-case'))) {
      return 'clean';
    }

    // Microservices detection
    if (paths.some(p => p.includes('service') && paths.some(p => p.includes('gateway') || p.includes('api')))) {
      return 'microservices';
    }

    // Component-based detection
    if (
      paths.some(p => p.includes('component')) ||
      (allLower.includes('component') && (allLower.includes('react') || allLower.includes('vue') || allLower.includes('angular') || allLower.includes('svelte'))) ||
      paths.some(p => p.endsWith('.tsx') || p.endsWith('.jsx'))
    ) {
      return 'component-based';
    }

    // Serverless detection
    if (paths.some(p => p.includes('handler') || p.includes('lambda'))) {
      return 'serverless';
    }

    if (project.files.length > 10) return 'monolith';

    return 'unknown';
  }

  private computeQualityMetrics(project: ProjectData): QualityMetrics {
    let totalLines = 0;
    let totalComplexity = 0;
    let fileCount = 0;
    let documentedFunctions = 0;
    let totalFunctions = 0;
    let testFiles = 0;

    for (const file of project.files) {
      const lines = file.content.split('\n');
      totalLines += lines.length;
      fileCount++;

      // Count functions
      const funcMatches = file.content.match(/function\s+\w+|=>\s*{|def\s+\w+/g);
      const funcCount = funcMatches ? funcMatches.length : 0;
      totalFunctions += funcCount;

      // Count documented functions (JSDoc, docstring)
      const docMatches = file.content.match(/\/\*\*[\s\S]*?\*\/|^\s*"""[\s\S]*?"""/gm);
      documentedFunctions += docMatches ? Math.min(docMatches.length, funcCount) : 0;

      // Estimate complexity
      const branches = file.content.match(/\b(if|else|for|while|case|catch)\b/g);
      totalComplexity += branches ? branches.length : 0;

      // Count test files
      if (file.path.includes('.test.') || file.path.includes('.spec.') || file.path.includes('__tests__') || file.path.includes('test/')) {
        testFiles++;
      }
    }

    const averageComplexity = fileCount > 0 ? totalComplexity / fileCount : 0;
    const duplicationRatio = this.estimateDuplication(project);
    const testCoverage = fileCount > 0 ? Math.min(1, testFiles / (fileCount * 0.5)) : 0;
    const documentationCoverage = totalFunctions > 0 ? documentedFunctions / totalFunctions : 0;

    // Maintainability index (simplified Halstead-based formula)
    const maintainabilityIndex = Math.max(0, Math.min(100,
      100 - averageComplexity * 2 - duplicationRatio * 30 - (1 - documentationCoverage) * 20
    ));

    const technicalDebtScore = Math.max(0, Math.min(100,
      averageComplexity * 3 + duplicationRatio * 40 + (1 - testCoverage) * 30 + (1 - documentationCoverage) * 10
    ));

    return {
      maintainabilityIndex,
      technicalDebtScore,
      duplicationRatio,
      averageComplexity,
      testCoverage,
      documentationCoverage,
    };
  }

  private analyzeDependencies(project: ProjectData): DependencyAnalysis {
    const importMap = new Map<string, Set<string>>();
    const circularDependencies: [string, string][] = [];
    const allImports = new Set<string>();

    for (const file of project.files) {
      const imports = new Set<string>();
      const importRegex = /import\s+(?:.*?)\s+from\s+['"]([^'"]+)['"]/g;
      let match: RegExpExecArray | null;
      while ((match = importRegex.exec(file.content)) !== null) {
        imports.add(match[1]);
        allImports.add(match[1]);
      }
      importMap.set(file.path, imports);
    }

    // Detect circular dependencies (simplified)
    const paths = Array.from(importMap.keys());
    for (let i = 0; i < paths.length; i++) {
      for (let j = i + 1; j < paths.length; j++) {
        const importsI = importMap.get(paths[i]) || new Set();
        const importsJ = importMap.get(paths[j]) || new Set();
        // Check if they import each other (simplified check)
        if (
          this.pathReferenced(paths[j], importsI) &&
          this.pathReferenced(paths[i], importsJ)
        ) {
          circularDependencies.push([paths[i], paths[j]]);
        }
      }
    }

    const externalDeps = Array.from(allImports).filter(imp => !imp.startsWith('.') && !imp.startsWith('/'));
    const internalDeps = Array.from(allImports).filter(imp => imp.startsWith('.') || imp.startsWith('/'));

    return {
      circularDependencies,
      unusedExports: [], // Would need cross-reference analysis
      missingDependencies: [], // Would need package.json comparison
      dependencyCount: allImports.size,
      externalDependencyCount: externalDeps.length,
      internalDependencyCount: internalDeps.length,
    };
  }

  private detectTeamPatterns(project: ProjectData): TeamPatterns {
    let singleQuotes = 0;
    let doubleQuotes = 0;
    let semicolons = 0;
    let totalStatements = 0;
    let jsdocCount = 0;
    let tddCount = 0;

    for (const file of project.files) {
      singleQuotes += (file.content.match(/'/g) || []).length;
      doubleQuotes += (file.content.match(/"/g) || []).length;
      semicolons += (file.content.match(/;/g) || []).length;
      totalStatements += (file.content.match(/\n/g) || []).length;
      jsdocCount += (file.content.match(/\/\*\*/g) || []).length;
      tddCount += (file.content.match(/\b(describe|it|test)\b/g) || []).length;
    }

    const quoteConsistency = singleQuotes + doubleQuotes > 0
      ? Math.max(singleQuotes, doubleQuotes) / (singleQuotes + doubleQuotes)
      : 1;

    const namingConvention = singleQuotes > doubleQuotes ? 'single-quotes' : 'double-quotes';
    const documentationStyle = jsdocCount > project.files.length * 0.5 ? 'JSDoc' : 'minimal';
    const testStyle = tddCount > 10 ? 'TDD' : 'ad-hoc';

    return {
      codingStyleConsistency: quoteConsistency,
      namingConvention,
      documentationStyle,
      testStyle,
    };
  }

  private analyzeTrends(project: ProjectData): TrendAnalysis {
    // Simplified trend analysis based on current state
    const totalLines = project.files.reduce((sum, f) => sum + f.content.split('\n').length, 0);
    const testFiles = project.files.filter(f =>
      f.path.includes('.test.') || f.path.includes('.spec.')
    ).length;

    return {
      codeGrowthRate: totalLines / 30, // Assume 30 days
      complexityGrowthRate: 0,
      testCoverageTrend: testFiles > 0 ? 'improving' : 'stable',
      lastUpdated: Date.now(),
    };
  }

  private estimateDuplication(project: ProjectData): number {
    // Simplified duplication estimation using line frequency
    const lineFrequency = new Map<string, number>();
    let totalLines = 0;

    for (const file of project.files) {
      const lines = file.content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 20 && !trimmed.startsWith('//') && !trimmed.startsWith('import')) {
          lineFrequency.set(trimmed, (lineFrequency.get(trimmed) || 0) + 1);
          totalLines++;
        }
      }
    }

    let duplicatedLines = 0;
    for (const [, count] of lineFrequency) {
      if (count > 1) duplicatedLines += count;
    }

    return totalLines > 0 ? duplicatedLines / totalLines : 0;
  }

  private pathReferenced(path: string, imports: Set<string>): boolean {
    const normalized = path.replace(/\.\w+$/, '').replace(/^\.\//, '');
    for (const imp of imports) {
      const normalizedImp = imp.replace(/\.\w+$/, '').replace(/^\.\//, '');
      if (normalized.includes(normalizedImp) || normalizedImp.includes(normalized)) return true;
    }
    return false;
  }

  private generateInsightSummary(
    architecture: ArchitecturePattern,
    quality: QualityMetrics,
    dependencies: DependencyAnalysis,
    patterns: TeamPatterns,
  ): string {
    return [
      `Architecture: ${architecture}`,
      `Maintainability: ${quality.maintainabilityIndex.toFixed(1)}/100`,
      `Tech Debt: ${quality.technicalDebtScore.toFixed(1)}/100`,
      `Dependencies: ${dependencies.dependencyCount} (${dependencies.externalDependencyCount} external)`,
      `Circular Deps: ${dependencies.circularDependencies.length}`,
      `Style: ${patterns.namingConvention}, ${patterns.documentationStyle} docs`,
    ].join('; ');
  }
}
