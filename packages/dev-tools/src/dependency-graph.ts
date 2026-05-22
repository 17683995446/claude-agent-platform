// src/dependency-graph.ts - 依赖图可视化

export interface FileEntry {
  path: string;
  content: string;
  language?: string;
}

export interface DependencyNode {
  id: string;
  path: string;
  dependencies: string[];
  dependents: string[];
}

export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  edges: { from: string; to: string }[];
}

export class DependencyGraphVisualizer {
  private graph: DependencyGraph = {
    nodes: new Map(),
    edges: [],
  };

  buildGraph(files: FileEntry[]): DependencyGraph {
    this.graph = {
      nodes: new Map(),
      edges: [],
    };

    // Create nodes
    for (const file of files) {
      const id = this.normalizePath(file.path);
      this.graph.nodes.set(id, {
        id,
        path: file.path,
        dependencies: [],
        dependents: [],
      });
    }

    // Build edges from imports
    for (const file of files) {
      const fromId = this.normalizePath(file.path);
      const imports = this.extractImports(file.content, file.language);

      for (const imp of imports) {
        const toId = this.resolveImport(imp, file.path, files);
        if (toId && this.graph.nodes.has(toId)) {
          const fromNode = this.graph.nodes.get(fromId)!;
          const toNode = this.graph.nodes.get(toId)!;

          if (!fromNode.dependencies.includes(toId)) {
            fromNode.dependencies.push(toId);
          }
          if (!toNode.dependents.includes(fromId)) {
            toNode.dependents.push(fromId);
          }
          this.graph.edges.push({ from: fromId, to: toId });
        }
      }
    }

    return this.graph;
  }

  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\.ts$|\.tsx$|\.js$|\.jsx$/, '');
  }

  private extractImports(content: string, language?: string): string[] {
    const imports: string[] = [];

    // ES module imports
    const esImportRegex = /import\s+(?:\{[^}]*}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = esImportRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    // Dynamic imports
    const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = dynamicImportRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    // CommonJS requires
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = requireRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    return imports;
  }

  private resolveImport(importPath: string, fromFile: string, files: FileEntry[]): string | undefined {
    // Skip node_modules and external imports
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
      return undefined;
    }

    let dir = fromFile.includes('/') ? fromFile.substring(0, fromFile.lastIndexOf('/')) : '';
    // Resolve relative path
    let resolved = importPath;
    if (importPath.startsWith('./')) {
      resolved = dir + '/' + importPath.substring(2);
    } else if (importPath.startsWith('/')) {
      resolved = importPath.substring(1);
    } else {
      // Handle ../ and mixed relative paths
      resolved = dir + '/' + importPath;
    }

    // Normalize ../ segments
    const parts = resolved.split('/');
    const normalized: string[] = [];
    for (const part of parts) {
      if (part === '..') {
        normalized.pop();
      } else if (part !== '.') {
        normalized.push(part);
      }
    }
    resolved = normalized.join('/');

    const normalizedResolved = this.normalizePath(resolved);

    // Check for exact match or with extensions
    for (const file of files) {
      const fileId = this.normalizePath(file.path);
      if (fileId === normalizedResolved || fileId === normalizedResolved + '/index') {
        return fileId;
      }
    }
    return undefined;
  }

  toDOT(graph?: DependencyGraph): string {
    const g = graph || this.graph;
    const lines: string[] = ['digraph dependencies {'];
    lines.push('  rankdir=LR;');
    lines.push('  node [shape=box];');

    for (const [id, node] of g.nodes) {
      const label = node.path.split('/').pop() || id;
      lines.push(`  "${id}" [label="${label}"];`);
    }

    for (const edge of g.edges) {
      lines.push(`  "${edge.from}" -> "${edge.to}";`);
    }

    lines.push('}');
    return lines.join('\n');
  }

  toMermaid(graph?: DependencyGraph): string {
    const g = graph || this.graph;
    const lines: string[] = ['graph LR'];

    for (const edge of g.edges) {
      const fromLabel = edge.from.split('/').pop() || edge.from;
      const toLabel = edge.to.split('/').pop() || edge.to;
      lines.push(`  ${fromLabel.replace(/[^a-zA-Z0-9]/g, '_')} --> ${toLabel.replace(/[^a-zA-Z0-9]/g, '_')}`);
    }

    return lines.join('\n');
  }

  toASCII(graph?: DependencyGraph): string {
    const g = graph || this.graph;
    const lines: string[] = [];

    for (const [id, node] of g.nodes) {
      const label = node.path.split('/').pop() || id;
      if (node.dependencies.length > 0) {
        for (const dep of node.dependencies) {
          const depLabel = dep.split('/').pop() || dep;
          lines.push(`${label} --> ${depLabel}`);
        }
      } else {
        lines.push(`${label} (no dependencies)`);
      }
    }

    return lines.join('\n');
  }

  toJSON(graph?: DependencyGraph): string {
    const g = graph || this.graph;
    const data = {
      nodes: Array.from(g.nodes.values()).map(n => ({
        id: n.id,
        path: n.path,
        dependencies: n.dependencies,
        dependents: n.dependents,
      })),
      edges: g.edges,
    };
    return JSON.stringify(data, null, 2);
  }

  findPath(from: string, to: string, graph?: DependencyGraph): string[] {
    const g = graph || this.graph;
    const fromId = this.normalizePath(from);
    const toId = this.normalizePath(to);

    const visited = new Set<string>();
    const path: string[] = [];

    const dfs = (current: string): boolean => {
      if (current === toId) {
        path.push(current);
        return true;
      }

      visited.add(current);
      path.push(current);

      const node = g.nodes.get(current);
      if (node) {
        for (const dep of node.dependencies) {
          if (!visited.has(dep)) {
            if (dfs(dep)) return true;
          }
        }
      }

      path.pop();
      return false;
    };

    dfs(fromId);
    return path;
  }

  detectCycles(graph?: DependencyGraph): string[][] {
    const g = graph || this.graph;
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const currentPath: string[] = [];

    const dfs = (nodeId: string): void => {
      visited.add(nodeId);
      recursionStack.add(nodeId);
      currentPath.push(nodeId);

      const node = g.nodes.get(nodeId);
      if (node) {
        for (const dep of node.dependencies) {
          if (!visited.has(dep)) {
            dfs(dep);
          } else if (recursionStack.has(dep)) {
            // Found a cycle
            const cycleStart = currentPath.indexOf(dep);
            const cycle = [...currentPath.slice(cycleStart), dep];
            cycles.push(cycle);
          }
        }
      }

      currentPath.pop();
      recursionStack.delete(nodeId);
    };

    for (const nodeId of g.nodes.keys()) {
      if (!visited.has(nodeId)) {
        dfs(nodeId);
      }
    }

    return cycles;
  }

  getMetrics(graph?: DependencyGraph): { totalNodes: number; totalEdges: number; avgDependencies: number; mostDepended: string[] } {
    const g = graph || this.graph;
    const totalNodes = g.nodes.size;
    const totalEdges = g.edges.length;
    const avgDependencies = totalNodes > 0 ? totalEdges / totalNodes : 0;

    // Find most depended upon modules
    const depCount = new Map<string, number>();
    for (const node of g.nodes.values()) {
      depCount.set(node.id, node.dependents.length);
    }

    const sorted = Array.from(depCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => id);

    return { totalNodes, totalEdges, avgDependencies, mostDepended: sorted };
  }

  getSubgraph(focusNode: string, depth: number = 1, graph?: DependencyGraph): DependencyGraph {
    const g = graph || this.graph;
    const focusId = this.normalizePath(focusNode);
    const subNodes = new Map<string, DependencyNode>();
    const subEdges: { from: string; to: string }[] = [];

    const collectNodes = (nodeId: string, currentDepth: number) => {
      if (currentDepth > depth) return;
      const node = g.nodes.get(nodeId);
      if (!node) return;

      if (!subNodes.has(nodeId)) {
        subNodes.set(nodeId, { ...node, dependencies: [], dependents: [] });
      }

      for (const dep of node.dependencies) {
        if (!subNodes.has(dep)) {
          const depNode = g.nodes.get(dep);
          if (depNode) {
            subNodes.set(dep, { ...depNode, dependencies: [], dependents: [] });
          }
        }
        subEdges.push({ from: nodeId, to: dep });

        if (currentDepth < depth) {
          collectNodes(dep, currentDepth + 1);
        }
      }
    };

    collectNodes(focusId, 0);

    return { nodes: subNodes, edges: subEdges };
  }
}
