// src/dependency-analyzer.ts

export interface FileEntry {
  path: string;
  content: string;
  language?: string;
}

export interface DependencyNode {
  file: string;
  dependencies: string[];
  dependents: string[];
  type: DependencyType;
}

export interface DependencyGraph {
  nodes: Record<string, DependencyNode>;
  edges: DependencyEdge[];
  circularDependencies: string[][];
  unusedDependencies: string[];
  metrics: DependencyMetrics;
}

export interface DependencyEdge {
  from: string;
  to: string;
  type: DependencyType;
}

export type DependencyType = 'internal' | 'external' | 'built-in';

export interface DependencyMetrics {
  totalDependencies: number;
  averageFanOut: number;
  averageFanIn: number;
  instability: number;
  abstractness: number;
}

const BUILTIN_MODULES = new Set([
  'fs', 'path', 'http', 'https', 'os', 'crypto', 'util', 'stream',
  'events', 'buffer', 'url', 'querystring', 'child_process', 'net',
  'tls', 'dns', 'readline', 'repl', 'vm', 'zlib', 'assert',
]);

export class DependencyAnalyzer {
  private graph: DependencyGraph;
  private files: FileEntry[] = [];

  constructor() {
    this.graph = {
      nodes: {},
      edges: [],
      circularDependencies: [],
      unusedDependencies: [],
      metrics: { totalDependencies: 0, averageFanOut: 0, averageFanIn: 0, instability: 0, abstractness: 0 },
    };
  }

  analyze(files: FileEntry[]): DependencyGraph {
    this.files = files;
    this.graph.nodes = {};
    this.graph.edges = [];

    // Build a map from base name and import path to full file path
    const pathMap = new Map<string, string>();
    for (const file of files) {
      pathMap.set(file.path, file.path);
      const baseName = file.path.split('/').pop() || '';
      const dir = file.path.substring(0, file.path.lastIndexOf('/'));
      pathMap.set(baseName, file.path);
      // Map relative imports too
      pathMap.set('./' + baseName, file.path);
      pathMap.set(baseName.replace(/\.[^.]+$/, ''), file.path);
      pathMap.set('./' + baseName.replace(/\.[^.]+$/, ''), file.path);
    }

    // Parse imports from each file
    for (const file of files) {
      const deps = this.parseImports(file.content, file.language || 'typescript');
      const resolvedDeps = deps.map(d => {
        // Try to resolve the import to a known file path
        const resolved = pathMap.get(d.module);
        return { ...d, resolvedPath: resolved || d.module };
      });

      this.graph.nodes[file.path] = {
        file: file.path,
        dependencies: resolvedDeps.map(d => d.resolvedPath),
        dependents: [],
        type: 'internal',
      };

      for (const dep of resolvedDeps) {
        this.graph.edges.push({
          from: file.path,
          to: dep.resolvedPath,
          type: dep.type,
        });
      }
    }

    // Build dependents
    for (const edge of this.graph.edges) {
      if (this.graph.nodes[edge.to]) {
        this.graph.nodes[edge.to].dependents.push(edge.from);
      }
    }

    // Detect circular dependencies
    this.graph.circularDependencies = this.findCircularDependencies();

    // Detect unused dependencies
    this.graph.unusedDependencies = this.findUnusedDependencies();

    // Calculate metrics
    this.graph.metrics = this.calculateMetrics();

    return this.graph;
  }

  private parseImports(content: string, language: string): Array<{ module: string; type: DependencyType }> {
    const imports: Array<{ module: string; type: DependencyType }> = [];

    // ES module imports
    const esImportRegex = /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
    let match;
    while ((match = esImportRegex.exec(content)) !== null) {
      imports.push({ module: match[1], type: this.classifyDependency(match[1]) });
    }

    // Dynamic imports
    const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = dynamicImportRegex.exec(content)) !== null) {
      imports.push({ module: match[1], type: this.classifyDependency(match[1]) });
    }

    // CommonJS requires
    if (language === 'javascript' || language === 'typescript') {
      const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      while ((match = requireRegex.exec(content)) !== null) {
        imports.push({ module: match[1], type: this.classifyDependency(match[1]) });
      }
    }

    return imports;
  }

  private classifyDependency(module: string): DependencyType {
    if (module.startsWith('.') || module.startsWith('/')) return 'internal';
    if (BUILTIN_MODULES.has(module)) return 'built-in';
    return 'external';
  }

  findCircularDependencies(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    const dfs = (node: string) => {
      visited.add(node);
      recursionStack.add(node);
      path.push(node);

      const deps = this.graph.nodes[node]?.dependencies || [];
      for (const dep of deps) {
        if (!visited.has(dep) && this.graph.nodes[dep]) {
          dfs(dep);
        } else if (recursionStack.has(dep)) {
          const cycleStart = path.indexOf(dep);
          if (cycleStart !== -1) {
            cycles.push([...path.slice(cycleStart), dep]);
          }
        }
      }

      path.pop();
      recursionStack.delete(node);
    };

    for (const node of Object.keys(this.graph.nodes)) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }

    return cycles;
  }

  getDependencyTree(file: string): DependencyNode | undefined {
    return this.graph.nodes[file];
  }

  findUnusedDependencies(): string[] {
    const unused: string[] = [];
    const allDeps = new Set<string>();

    for (const node of Object.values(this.graph.nodes)) {
      for (const dep of node.dependencies) {
        allDeps.add(dep);
      }
    }

    for (const dep of allDeps) {
      const existsAsFile = Object.keys(this.graph.nodes).includes(dep);
      const isBuiltIn = BUILTIN_MODULES.has(dep);
      const isInternal = dep.startsWith('.') || dep.startsWith('/');

      // Skip internal deps (resolved to files) and built-in modules
      if (isInternal || isBuiltIn) continue;

      // External dependency: check if it's actually referenced in code
      if (!existsAsFile) {
        const isReferenced = this.files.some(f => f.content.includes(dep));
        if (!isReferenced) {
          unused.push(dep);
        }
      }
    }

    return unused;
  }

  private calculateMetrics(): DependencyMetrics {
    const nodes = Object.values(this.graph.nodes);
    if (nodes.length === 0) {
      return { totalDependencies: 0, averageFanOut: 0, averageFanIn: 0, instability: 0, abstractness: 0 };
    }

    let totalFanOut = 0;
    let totalFanIn = 0;
    let totalDeps = 0;

    for (const node of nodes) {
      totalFanOut += node.dependencies.length;
      totalFanIn += node.dependents.length;
      totalDeps += node.dependencies.length;
    }

    const ce = totalFanOut; // efferent couplings (outgoing)
    const ca = totalFanIn;  // afferent couplings (incoming)
    const instability = ce + ca === 0 ? 0 : ce / (ce + ca);

    return {
      totalDependencies: totalDeps,
      averageFanOut: totalFanOut / nodes.length,
      averageFanIn: totalFanIn / nodes.length,
      instability,
      abstractness: 0, // Would need type info to calculate properly
    };
  }
}
