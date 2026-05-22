// src/architecture-analyzer.ts

export type ArchitecturePattern = 'Layered' | 'MVC' | 'MVVM' | 'Clean' | 'Hexagonal' | 'Microservices';

export interface ProjectStructure {
  rootPath: string;
  files: Array<{ path: string; content: string }>;
  directories: string[];
}

export interface ArchitectureResult {
  detectedPattern: ArchitecturePattern | undefined;
  confidence: number;
  components: ComponentInfo[];
  layerViolations: LayerViolation[];
  componentGraph: ComponentGraph;
  fitnessScore: number;
}

export interface ComponentInfo {
  name: string;
  path: string;
  type: string;
  responsibilities: string[];
  dependencies: string[];
}

export interface LayerRule {
  layer: string;
  allowedDependencies: string[];
  directoryPattern: string;
}

export interface LayerViolation {
  source: string;
  target: string;
  rule: string;
  message: string;
}

export interface ComponentGraph {
  nodes: Array<{ id: string; label: string; type: string }>;
  edges: Array<{ from: string; to: string; label: string }>;
}

const PATTERN_INDICATORS: Record<ArchitecturePattern, string[]> = {
  Layered: ['controllers', 'services', 'repositories', 'models', 'layers'],
  MVC: ['controllers', 'views', 'models', 'templates'],
  MVVM: ['viewmodels', 'views', 'models', 'bindings'],
  Clean: ['usecases', 'entities', 'controllers', 'repositories', 'interfaces'],
  Hexagonal: ['ports', 'adapters', 'core', 'domain', 'infrastructure'],
  Microservices: ['services', 'api-gateway', 'shared', 'events', 'messaging'],
};

export class ArchitectureAnalyzer {
  private project: ProjectStructure | null = null;

  analyze(project: ProjectStructure): ArchitectureResult {
    this.project = project;
    const pattern = this.detectPattern();
    const components = this.detectComponents();
    const violations = this.checkLayerViolations([]);
    const graph = this.getComponentGraph();
    const fitnessScore = this.calculateFitnessScore(components, violations);

    return {
      detectedPattern: pattern?.pattern,
      confidence: pattern?.confidence || 0,
      components,
      layerViolations: violations,
      componentGraph: graph,
      fitnessScore,
    };
  }

  detectPattern(): { pattern: ArchitecturePattern; confidence: number } | undefined {
    if (!this.project) return undefined;

    const dirs = this.project.directories.map(d => d.toLowerCase());
    const scores: Record<ArchitecturePattern, number> = {
      Layered: 0, MVC: 0, MVVM: 0, Clean: 0, Hexagonal: 0, Microservices: 0,
    };

    for (const [pattern, indicators] of Object.entries(PATTERN_INDICATORS)) {
      for (const indicator of indicators) {
        if (dirs.some(d => d.includes(indicator.toLowerCase()))) {
          scores[pattern as ArchitecturePattern]++;
        }
      }
    }

    let bestPattern: ArchitecturePattern | undefined;
    let bestScore = 0;
    for (const [pattern, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        bestPattern = pattern as ArchitecturePattern;
      }
    }

    if (!bestPattern || bestScore === 0) return undefined;
    const maxIndicators = Math.max(...Object.values(PATTERN_INDICATORS).map(i => i.length));
    const confidence = Math.min(1, bestScore / (maxIndicators * 0.5));

    return { pattern: bestPattern, confidence };
  }

  checkLayerViolations(rules: LayerRule[]): LayerViolation[] {
    const violations: LayerViolation[] = [];
    if (!this.project) return violations;

    for (const file of this.project.files) {
      const sourceDir = this.findMatchingLayer(file.path, rules);
      if (!sourceDir) continue;

      const imports = this.extractImports(file.content);
      for (const imp of imports) {
        const targetDir = this.findMatchingLayer(imp, rules);
        if (targetDir && sourceDir !== targetDir) {
          const rule = rules.find(r => r.layer === sourceDir);
          if (rule && !rule.allowedDependencies.includes(targetDir)) {
            violations.push({
              source: file.path,
              target: imp,
              rule: `${sourceDir} -> ${targetDir}`,
              message: `${sourceDir} should not depend on ${targetDir}`,
            });
          }
        }
      }
    }

    return violations;
  }

  getComponentGraph(): ComponentGraph {
    const nodes: ComponentGraph['nodes'] = [];
    const edges: ComponentGraph['edges'] = [];

    if (!this.project) return { nodes, edges };

    const components = this.detectComponents();
    for (const comp of components) {
      nodes.push({ id: comp.name, label: comp.name, type: comp.type });
      for (const dep of comp.dependencies) {
        edges.push({ from: comp.name, to: dep, label: 'depends on' });
      }
    }

    return { nodes, edges };
  }

  private detectComponents(): ComponentInfo[] {
    const components: ComponentInfo[] = [];
    if (!this.project) return components;

    const dirMap = new Map<string, string[]>();

    for (const file of this.project.files) {
      const parts = file.path.split('/');
      if (parts.length >= 2) {
        const dir = parts.slice(0, -1).join('/');
        if (!dirMap.has(dir)) dirMap.set(dir, []);
        dirMap.get(dir)!.push(file.path);
      }
    }

    for (const [dir, files] of dirMap) {
      const name = dir.split('/').pop() || dir;
      const imports = new Set<string>();
      for (const file of this.project.files) {
        if (files.includes(file.path)) {
          const fileImports = this.extractImports(file.content);
          for (const imp of fileImports) {
            imports.add(imp);
          }
        }
      }

      components.push({
        name,
        path: dir,
        type: this.inferComponentType(name, files),
        responsibilities: this.inferResponsibilities(files),
        dependencies: Array.from(imports),
      });
    }

    return components;
  }

  private extractImports(content: string): string[] {
    const imports: string[] = [];
    const patterns = [
      /import\s+.*?from\s+['"]([^'"]+)['"]/g,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        imports.push(match[1]);
      }
    }
    return imports;
  }

  private findMatchingLayer(path: string, rules: LayerRule[]): string | undefined {
    for (const rule of rules) {
      if (path.includes(rule.directoryPattern)) {
        return rule.layer;
      }
    }
    return undefined;
  }

  private inferComponentType(name: string, _files: string[]): string {
    const lower = name.toLowerCase();
    if (lower.includes('controller') || lower.includes('route')) return 'controller';
    if (lower.includes('service')) return 'service';
    if (lower.includes('model') || lower.includes('entity') || lower.includes('domain')) return 'model';
    if (lower.includes('repository') || lower.includes('dao')) return 'repository';
    if (lower.includes('util') || lower.includes('helper')) return 'utility';
    if (lower.includes('config')) return 'config';
    if (lower.includes('test') || lower.includes('spec')) return 'test';
    return 'module';
  }

  private inferResponsibilities(files: string[]): string[] {
    const responsibilities: string[] = [];
    if (files.some(f => f.endsWith('.test.ts') || f.endsWith('.spec.ts'))) {
      responsibilities.push('testing');
    }
    if (files.some(f => f.includes('route') || f.includes('handler'))) {
      responsibilities.push('routing');
    }
    if (files.some(f => f.includes('service'))) {
      responsibilities.push('business logic');
    }
    if (files.some(f => f.includes('model') || f.includes('entity'))) {
      responsibilities.push('data modeling');
    }
    if (responsibilities.length === 0) {
      responsibilities.push('general');
    }
    return responsibilities;
  }

  private calculateFitnessScore(_components: ComponentInfo[], violations: LayerViolation[]): number {
    // Simple fitness function based on violations
    const baseScore = 100;
    const penalty = violations.length * 10;
    return Math.max(0, baseScore - penalty);
  }
}
