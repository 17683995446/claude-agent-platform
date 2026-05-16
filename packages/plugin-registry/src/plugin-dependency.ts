// ============================================================
// Module: plugin-dependency.ts - 依赖管理
// Semantic version constraint parsing, dependency graph, conflict detection
// ============================================================

import { PluginVersionManager, SemVer } from './plugin-versioning.ts';

export interface PluginDefinition {
  name: string;
  version: string;
  description?: string;
  author?: string;
  dependencies?: Record<string, string>;
  permissions?: string[];
  main?: string;
}

export interface DependencyNode {
  name: string;
  version: string;
  resolvedVersion?: string;
  dependencies: string[];
  dependents: string[];
  depth: number;
}

export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  edges: Array<{ from: string; to: string; constraint: string }>;
  loadOrder: string[];
}

export interface Conflict {
  type: 'version_conflict' | 'missing_dependency' | 'circular_dependency';
  plugin: string;
  dependency?: string;
  expected?: string;
  found?: string;
  cycle?: string[];
  message: string;
}

export class PluginDependencyResolver {
  private versionManager = new PluginVersionManager();
  private availableVersions = new Map<string, string[]>();

  registerAvailableVersion(pluginName: string, version: string): void {
    if (!this.availableVersions.has(pluginName)) {
      this.availableVersions.set(pluginName, []);
    }
    const versions = this.availableVersions.get(pluginName)!;
    if (!versions.includes(version)) {
      versions.push(version);
    }
  }

  resolve(plugins: PluginDefinition[]): DependencyGraph {
    const nodes = new Map<string, DependencyNode>();
    const edges: Array<{ from: string; to: string; constraint: string }> = [];
    const allNames = new Set(plugins.map(p => p.name));

    // Create nodes for all plugins
    for (const plugin of plugins) {
      nodes.set(plugin.name, {
        name: plugin.name,
        version: plugin.version,
        dependencies: Object.keys(plugin.dependencies ?? {}),
        dependents: [],
        depth: 0,
      });
    }

    // Create edges
    for (const plugin of plugins) {
      for (const [depName, constraint] of Object.entries(plugin.dependencies ?? {})) {
        edges.push({ from: plugin.name, to: depName, constraint });
        const depNode = nodes.get(depName);
        if (depNode) {
          depNode.dependents.push(plugin.name);
        }
      }
    }

    // Calculate depths
    const depths = this.calculateDepths(nodes, edges, allNames);

    // Topological sort
    const loadOrder = this.topologicalSort(nodes, edges, allNames);

    return { nodes, edges, loadOrder };
  }

  private calculateDepths(
    nodes: Map<string, DependencyNode>,
    edges: Array<{ from: string; to: string; constraint: string }>,
    allNames: Set<string>,
  ): void {
    for (const name of allNames) {
      const depth = this.getDepth(name, nodes, edges, new Set());
      const node = nodes.get(name);
      if (node) node.depth = depth;
    }
  }

  private getDepth(
    name: string,
    nodes: Map<string, DependencyNode>,
    edges: Array<{ from: string; to: string; constraint: string }>,
    visiting: Set<string>,
  ): number {
    if (visiting.has(name)) return 0; // circular, stop
    visiting.add(name);

    const deps = edges.filter(e => e.from === name).map(e => e.to);
    if (deps.length === 0) return 0;

    let maxDepDepth = 0;
    for (const dep of deps) {
      const depDepth = this.getDepth(dep, nodes, edges, visiting);
      if (depDepth > maxDepDepth) maxDepDepth = depDepth;
    }

    visiting.delete(name);
    return maxDepDepth + 1;
  }

  private topologicalSort(
    nodes: Map<string, DependencyNode>,
    edges: Array<{ from: string; to: string; constraint: string }>,
    allNames: Set<string>,
  ): string[] {
    // Edge direction: from=plugin, to=dependency
    // We want dependencies loaded first, so reverse the graph:
    // in-degree counts how many plugins depend on this node
    const inDegree = new Map<string, number>();
    for (const name of allNames) {
      inDegree.set(name, 0);
    }
    for (const edge of edges) {
      // edge.from depends on edge.to
      // So edge.from should come AFTER edge.to
      // in-degree of edge.from should be incremented
      if (allNames.has(edge.from)) {
        inDegree.set(edge.from, (inDegree.get(edge.from) ?? 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const [name, degree] of inDegree) {
      if (degree === 0) queue.push(name);
    }

    const sorted: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      sorted.push(current);

      for (const edge of edges) {
        // If current is a dependency (edge.to), then edge.from can now be processed
        if (edge.to === current && allNames.has(edge.from)) {
          const newDegree = (inDegree.get(edge.from) ?? 1) - 1;
          inDegree.set(edge.from, newDegree);
          if (newDegree === 0) queue.push(edge.from);
        }
      }
    }

    return sorted;
  }

  getLoadOrder(plugins: PluginDefinition[]): string[] {
    const graph = this.resolve(plugins);
    return graph.loadOrder;
  }

  checkConflicts(plugins: PluginDefinition[]): Conflict[] {
    const conflicts: Conflict[] = [];
    const depMap = new Map<string, Map<string, string[]>>();

    // Check missing dependencies
    const allNames = new Set(plugins.map(p => p.name));
    for (const plugin of plugins) {
      for (const [depName] of Object.entries(plugin.dependencies ?? {})) {
        if (!allNames.has(depName)) {
          conflicts.push({
            type: 'missing_dependency',
            plugin: plugin.name,
            dependency: depName,
            message: `Plugin "${plugin.name}" requires "${depName}" which is not available`,
          });
        }
      }
    }

    // Check version conflicts
    for (const plugin of plugins) {
      for (const [depName, constraint] of Object.entries(plugin.dependencies ?? {})) {
        if (!depMap.has(depName)) depMap.set(depName, new Map());
        const constraints = depMap.get(depName)!;
        if (!constraints.has(constraint)) constraints.set(constraint, []);
        constraints.get(constraint)!.push(plugin.name);
      }
    }

    // Check circular dependencies
    const cycles = this.detectCycles(plugins);
    for (const cycle of cycles) {
      conflicts.push({
        type: 'circular_dependency',
        plugin: cycle[0],
        cycle,
        message: `Circular dependency detected: ${cycle.join(' -> ')}`,
      });
    }

    return conflicts;
  }

  private detectCycles(plugins: PluginDefinition[]): string[][] {
    const adj = new Map<string, string[]>();
    for (const plugin of plugins) {
      adj.set(plugin.name, Object.keys(plugin.dependencies ?? {}));
    }

    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const path: string[] = [];

    const dfs = (node: string): void => {
      visited.add(node);
      recStack.add(node);
      path.push(node);

      for (const neighbor of adj.get(node) ?? []) {
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        } else if (recStack.has(neighbor)) {
          const cycleStart = path.indexOf(neighbor);
          cycles.push([...path.slice(cycleStart), neighbor]);
        }
      }

      path.pop();
      recStack.delete(node);
    };

    for (const plugin of plugins) {
      if (!visited.has(plugin.name)) {
        dfs(plugin.name);
      }
    }

    return cycles;
  }

  getDependencyTree(pluginName: string, plugins: PluginDefinition[]): DependencyNode | undefined {
    const graph = this.resolve(plugins);
    return graph.nodes.get(pluginName);
  }
}
