/**
 * Dependency Graph Module
 *
 * Build and analyze dependency graphs between code modules.
 * Supports cycle detection, topological sorting, and critical path analysis.
 */

/** Metadata associated with a graph node */
export interface NodeMeta {
  name: string;
  type: "file" | "module" | "class" | "function" | "package";
  path?: string;
  size?: number;
  language?: string;
  [key: string]: unknown;
}

/** Type of dependency edge */
export type EdgeType = "imports" | "exports" | "calls" | "extends" | "implements" | "uses" | "dynamic";

/** An edge in the dependency graph */
export interface DependencyEdge {
  from: string;
  to: string;
  type: EdgeType;
  weight: number;
}

/** A node in the dependency graph */
export interface DependencyNode {
  id: string;
  meta: NodeMeta;
  dependencies: string[];
  dependents: string[];
}

/** A cycle detected in the graph */
export interface DependencyCycle {
  nodes: string[];
  edges: DependencyEdge[];
}

/** Result of topological sort */
export interface TopologicalOrder {
  layers: string[][];
  flat: string[];
}

/** Critical path information */
export interface CriticalPathInfo {
  path: string[];
  totalWeight: number;
  bottleneckNodes: string[];
}

/**
 * DependencyGraph - Build and analyze dependency relationships between code modules.
 */
export class DependencyGraph {
  private nodes: Map<string, DependencyNode> = new Map();
  private edges: Map<string, DependencyEdge> = new Map();
  private adjacencyList: Map<string, Map<string, DependencyEdge>> = new Map();
  private reverseAdjacencyList: Map<string, Map<string, DependencyEdge>> = new Map();

  /**
   * Add a node to the dependency graph.
   * @param id - Unique identifier for the node
   * @param meta - Metadata about the node
   */
  addNode(id: string, meta: NodeMeta): void {
    if (this.nodes.has(id)) {
      throw new Error(`Node with id "${id}" already exists`);
    }

    this.nodes.set(id, {
      id,
      meta,
      dependencies: [],
      dependents: [],
    });

    if (!this.adjacencyList.has(id)) {
      this.adjacencyList.set(id, new Map());
    }
    if (!this.reverseAdjacencyList.has(id)) {
      this.reverseAdjacencyList.set(id, new Map());
    }
  }

  /**
   * Add a directed edge between two nodes.
   * @param from - Source node id
   * @param to - Target node id
   * @param type - Type of dependency
   * @param weight - Edge weight (default 1)
   */
  addEdge(from: string, to: string, type: EdgeType, weight: number = 1): void {
    if (!this.nodes.has(from)) {
      throw new Error(`Source node "${from}" does not exist`);
    }
    if (!this.nodes.has(to)) {
      throw new Error(`Target node "${to}" does not exist`);
    }

    const edgeKey = `${from}->${to}`;
    const edge: DependencyEdge = { from, to, type, weight };

    this.edges.set(edgeKey, edge);
    this.adjacencyList.get(from)!.set(to, edge);
    this.reverseAdjacencyList.get(to)!.set(from, edge);

    const fromNode = this.nodes.get(from)!;
    const toNode = this.nodes.get(to)!;

    if (!fromNode.dependencies.includes(to)) {
      fromNode.dependencies.push(to);
    }
    if (!toNode.dependents.includes(from)) {
      toNode.dependents.push(from);
    }
  }

  /**
   * Get all nodes that depend on the given node (reverse dependencies).
   * @param id - Node id
   * @returns Array of dependent node ids
   */
  getDependents(id: string): string[] {
    const node = this.nodes.get(id);
    if (!node) return [];
    return [...node.dependents];
  }

  /**
   * Get ALL transitive dependents of the given node (BFS with memoization).
   * @param id - Node id
   * @returns Array of all transitively dependent node ids
   */
  getAllDependents(id: string): string[] {
    const visited = new Set<string>();
    const queue: string[] = [id];
    visited.add(id);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const node = this.nodes.get(current);
      if (!node) continue;

      for (const dep of node.dependents) {
        if (!visited.has(dep)) {
          visited.add(dep);
          queue.push(dep);
        }
      }
    }

    visited.delete(id);
    return [...visited];
  }

  /**
   * Get all dependencies of the given node.
   * @param id - Node id
   * @returns Array of dependency node ids
   */
  getDependencies(id: string): string[] {
    const node = this.nodes.get(id);
    if (!node) return [];
    return [...node.dependencies];
  }

  /**
   * Detect all circular dependencies in the graph.
   * @returns Array of detected cycles
   */
  detectCircularDeps(): DependencyCycle[] {
    const cycles: DependencyCycle[] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];
    const seenCycleKeys = new Set<string>();

    const dfs = (nodeId: string): void => {
      visited.add(nodeId);
      recursionStack.add(nodeId);
      path.push(nodeId);

      const neighbors = this.adjacencyList.get(nodeId) ?? new Map();
      for (const [neighborId, edge] of neighbors) {
        if (!visited.has(neighborId)) {
          dfs(neighborId);
        } else if (recursionStack.has(neighborId)) {
          // Found a cycle
          const cycleStart = path.indexOf(neighborId);
          const cycleNodes = path.slice(cycleStart);
          cycleNodes.push(neighborId);

          // Deduplicate cycles using a canonical key
          const cycleKey = cycleNodes.slice(0, -1).sort().join("->");
          if (seenCycleKeys.has(cycleKey)) continue;
          seenCycleKeys.add(cycleKey);

          const cycleEdges: DependencyEdge[] = [];
          for (let i = 0; i < cycleNodes.length - 1; i++) {
            const edgeKey = `${cycleNodes[i]}->${cycleNodes[i + 1]}`;
            const cycleEdge = this.edges.get(edgeKey);
            if (cycleEdge) cycleEdges.push(cycleEdge);
          }

          cycles.push({ nodes: cycleNodes, edges: cycleEdges });
        }
      }

      path.pop();
      recursionStack.delete(nodeId);
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        dfs(nodeId);
      }
    }

    return cycles;
  }

  /**
   * Perform topological sort of the graph nodes.
   * @returns Topological ordering with layers
   * @throws Error if graph contains cycles
   */
  topologicalSort(): TopologicalOrder {
    const cycles = this.detectCircularDeps();
    if (cycles.length > 0) {
      throw new Error("Cannot perform topological sort: graph contains circular dependencies");
    }

    // Use out-degree (reverse direction) so dependencies come before dependents.
    // In this graph, edges go from dependent to dependency (a->b means a depends on b).
    // We want b before a, so we process nodes with no outgoing edges first.
    const outDegree = new Map<string, number>();
    for (const nodeId of this.nodes.keys()) {
      outDegree.set(nodeId, 0);
    }

    for (const [, edge] of this.edges) {
      outDegree.set(edge.from, (outDegree.get(edge.from) ?? 0) + 1);
    }

    const queue: string[] = [];
    for (const [nodeId, degree] of outDegree) {
      if (degree === 0) queue.push(nodeId);
    }

    const layers: string[][] = [];
    const flat: string[] = [];

    while (queue.length > 0) {
      const layer: string[] = [];
      const nextQueue: string[] = [];

      for (const nodeId of queue) {
        layer.push(nodeId);
        flat.push(nodeId);

        // Use reverse adjacency: find who points TO this node (its dependents)
        const reverseNeighbors = this.reverseAdjacencyList.get(nodeId) ?? new Map();
        for (const [neighborId] of reverseNeighbors) {
          const newDegree = (outDegree.get(neighborId) ?? 1) - 1;
          outDegree.set(neighborId, newDegree);
          if (newDegree === 0) {
            nextQueue.push(neighborId);
          }
        }
      }

      layers.push(layer);
      queue.length = 0;
      queue.push(...nextQueue);
    }

    return { layers, flat };
  }

  /**
   * Find the critical path through the dependency graph (longest weighted path).
   * @returns Critical path information
   */
  getCriticalPath(): CriticalPathInfo {
    // Find nodes with no dependents (sinks) - these are the "root" nodes
    const sinks: string[] = [];
    for (const [id, node] of this.nodes) {
      if (node.dependents.length === 0) {
        sinks.push(id);
      }
    }

    // Find nodes with no dependencies (sources) - these are the "leaf" nodes
    const sources: string[] = [];
    for (const [id, node] of this.nodes) {
      if (node.dependencies.length === 0) {
        sources.push(id);
      }
    }

    if (sources.length === 0 || sinks.length === 0) {
      return { path: [], totalWeight: 0, bottleneckNodes: [] };
    }

    let bestPath: string[] = [];
    let bestWeight = 0;

    // DFS from each sink (node with no dependents) following outgoing edges
    // to find the longest path to any source (node with no dependencies)
    const findLongestPath = (
      current: string,
      path: string[],
      weight: number,
      visited: Set<string>
    ): void => {
      const neighbors = this.adjacencyList.get(current) ?? new Map();
      const hasOutgoing = neighbors.size > 0;

      if (!hasOutgoing || sources.includes(current)) {
        if (weight > bestWeight || (weight === bestWeight && path.length > bestPath.length)) {
          bestWeight = weight;
          bestPath = [...path];
        }
      }

      for (const [neighborId, edge] of neighbors) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          path.push(neighborId);
          findLongestPath(neighborId, path, weight + edge.weight, visited);
          path.pop();
          visited.delete(neighborId);
        }
      }
    };

    for (const sink of sinks) {
      const visited = new Set<string>([sink]);
      findLongestPath(sink, [sink], 0, visited);
    }

    // Find bottleneck nodes (nodes with highest fan-out)
    const bottleneckNodes: string[] = [];
    let maxFanOut = 0;
    for (const [id, node] of this.nodes) {
      if (node.dependencies.length > maxFanOut) {
        maxFanOut = node.dependencies.length;
        bottleneckNodes.length = 0;
        bottleneckNodes.push(id);
      } else if (node.dependencies.length === maxFanOut && maxFanOut > 0) {
        bottleneckNodes.push(id);
      }
    }

    return { path: bestPath, totalWeight: bestWeight, bottleneckNodes };
  }

  /**
   * Get all node ids in the graph.
   */
  getNodeIds(): string[] {
    return [...this.nodes.keys()];
  }

  /**
   * Get a specific node by id.
   */
  getNode(id: string): DependencyNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Get total number of nodes.
   */
  get size(): number {
    return this.nodes.size;
  }

  /**
   * Get total number of edges.
   */
  get edgeCount(): number {
    return this.edges.size;
  }

  /**
   * Check if a node exists.
   */
  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  /**
   * Remove a node and all its edges.
   */
  removeNode(id: string): boolean {
    if (!this.nodes.has(id)) return false;

    const node = this.nodes.get(id)!;

    // Remove edges where this node is the source
    const outEdges = this.adjacencyList.get(id) ?? new Map();
    for (const [to] of outEdges) {
      const edgeKey = `${id}->${to}`;
      this.edges.delete(edgeKey);
      const toNode = this.nodes.get(to);
      if (toNode) {
        toNode.dependents = toNode.dependents.filter((d) => d !== id);
      }
    }

    // Remove edges where this node is the target
    const inEdges = this.reverseAdjacencyList.get(id) ?? new Map();
    for (const [from] of inEdges) {
      const edgeKey = `${from}->${id}`;
      this.edges.delete(edgeKey);
      const fromNode = this.nodes.get(from);
      if (fromNode) {
        fromNode.dependencies = fromNode.dependencies.filter((d) => d !== id);
      }
    }

    this.adjacencyList.delete(id);
    this.reverseAdjacencyList.delete(id);
    this.nodes.delete(id);

    return true;
  }

  /**
   * Clear the entire graph.
   */
  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.adjacencyList.clear();
    this.reverseAdjacencyList.clear();
  }
}
