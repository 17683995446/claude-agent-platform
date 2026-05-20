/**
 * GraphAlgorithms - Classic graph algorithms.
 *
 * Provides implementations of fundamental graph algorithms including
 * BFS, DFS, Dijkstra's shortest path, PageRank, community detection,
 * centrality measures, connected components, and minimum spanning tree.
 */

import { GraphStore, GraphNode } from './graph-store.js';

/** Centrality type */
export type CentralityType = 'degree' | 'betweenness' | 'closeness';

/** Community detection algorithm */
export type CommunityAlgorithm = 'label-propagation' | 'connected-components';

/** BFS/DFS visit function - return false to stop traversal */
export type VisitFn = (nodeId: string, depth: number) => boolean | void;

/** Dijkstra weight function */
export type WeightFn = (from: string, to: string) => number;

/** Shortest path result */
export interface ShortestPathResult {
  distance: number;
  path: string[];
}

/** Centrality result */
export interface CentralityResult {
  scores: Map<string, number>;
}

/** Community result */
export interface CommunityResult {
  communities: string[][];
}

/**
 * GraphAlgorithms provides classic graph algorithms.
 *
 * @example
 * ```typescript
 * const algo = new GraphAlgorithms(store);
 * const result = algo.dijkstra('A', 'D', (f, t) => 1);
 * console.log(result.path); // ['A', 'B', 'C', 'D']
 * ```
 */
export class GraphAlgorithms {
  private store: GraphStore;
  private directed: boolean;

  constructor(store: GraphStore, directed: boolean = true) {
    this.store = store;
    this.directed = directed;
  }

  /**
   * Get the effective direction for traversal based on the directed setting.
   */
  private effectiveDirection(requestedDir: 'out' | 'in' | 'both'): 'out' | 'in' | 'both' {
    if (this.directed) return requestedDir;
    return 'both';
  }

  /**
   * Breadth-First Search traversal.
   * @param start - Starting node ID
   * @param visitFn - Function called for each visited node. Return false to stop.
   * @returns Array of visited node IDs in BFS order
   */
  bfs(start: string, visitFn: VisitFn): string[] {
    const visited: string[] = [];
    if (!this.store.hasNode(start)) return visited;

    const seen = new Set<string>();
    const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: start, depth: 0 }];
    seen.add(start);

    while (queue.length > 0) {
      const current = queue.shift()!;
      visited.push(current.nodeId);

      const result = visitFn(current.nodeId, current.depth);
      if (result === false) break;

      const neighbors = this.store.getNeighbors(current.nodeId, this.effectiveDirection('out'));
      for (const neighbor of neighbors) {
        if (!seen.has(neighbor.id)) {
          seen.add(neighbor.id);
          queue.push({ nodeId: neighbor.id, depth: current.depth + 1 });
        }
      }
    }

    return visited;
  }

  /**
   * Depth-First Search traversal.
   * @param start - Starting node ID
   * @param visitFn - Function called for each visited node. Return false to stop.
   * @returns Array of visited node IDs in DFS order
   */
  dfs(start: string, visitFn: VisitFn): string[] {
    const visited: string[] = [];
    if (!this.store.hasNode(start)) return visited;

    const seen = new Set<string>();

    const dfsRecursive = (nodeId: string, depth: number): boolean => {
      seen.add(nodeId);
      visited.push(nodeId);

      const result = visitFn(nodeId, depth);
      if (result === false) return false;

      const neighbors = this.store.getNeighbors(nodeId, this.effectiveDirection('out'));
      for (const neighbor of neighbors) {
        if (!seen.has(neighbor.id)) {
          if (!dfsRecursive(neighbor.id, depth + 1)) return false;
        }
      }
      return true;
    };

    dfsRecursive(start, 0);
    return visited;
  }

  /**
   * Dijkstra's shortest path algorithm with binary heap priority queue.
   * @param start - Starting node ID
   * @param end - Target node ID
   * @param weightFn - Function returning edge weight between two nodes
   * @returns Shortest path result or null if no path exists
   */
  dijkstra(start: string, end: string, weightFn: WeightFn): ShortestPathResult | null {
    if (!this.store.hasNode(start) || !this.store.hasNode(end)) return null;
    if (start === end) return { distance: 0, path: [start] };

    const distances = new Map<string, number>();
    const previous = new Map<string, string>();
    const visited = new Set<string>();

    // Binary min-heap priority queue
    const heap: Array<{ nodeId: string; dist: number }> = [];
    const heapIndex = new Map<string, number>();

    const heapPush = (nodeId: string, dist: number) => {
      heap.push({ nodeId, dist });
      heapIndex.set(nodeId, heap.length - 1);
      heapSiftUp(heap.length - 1);
    };

    const heapSiftUp = (i: number) => {
      while (i > 0) {
        const parent = Math.floor((i - 1) / 2);
        if (heap[parent].dist <= heap[i].dist) break;
        [heap[parent], heap[i]] = [heap[i], heap[parent]];
        heapIndex.set(heap[parent].nodeId, parent);
        heapIndex.set(heap[i].nodeId, i);
        i = parent;
      }
    };

    const heapSiftDown = (i: number) => {
      const n = heap.length;
      while (true) {
        let smallest = i;
        const left = 2 * i + 1;
        const right = 2 * i + 2;
        if (left < n && heap[left].dist < heap[smallest].dist) smallest = left;
        if (right < n && heap[right].dist < heap[smallest].dist) smallest = right;
        if (smallest === i) break;
        [heap[smallest], heap[i]] = [heap[i], heap[smallest]];
        heapIndex.set(heap[smallest].nodeId, smallest);
        heapIndex.set(heap[i].nodeId, i);
        i = smallest;
      }
    };

    const heapPop = (): { nodeId: string; dist: number } | null => {
      if (heap.length === 0) return null;
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        heapIndex.set(last.nodeId, 0);
        heapSiftDown(0);
      }
      heapIndex.delete(top.nodeId);
      return top;
    };

    const heapDecreaseKey = (nodeId: string, newDist: number) => {
      const idx = heapIndex.get(nodeId);
      if (idx === undefined) return;
      heap[idx].dist = newDist;
      heapSiftUp(idx);
    };

    const heapHas = (nodeId: string): boolean => {
      return heapIndex.has(nodeId);
    };

    // Initialize
    const allNodes = this.store.getAllNodes();
    for (const node of allNodes) {
      distances.set(node.id, Infinity);
    }
    distances.set(start, 0);
    heapPush(start, 0);

    while (heap.length > 0) {
      const current = heapPop();
      if (!current) break;
      const { nodeId: currentId, dist: currentDist } = current;

      if (visited.has(currentId)) continue;
      visited.add(currentId);

      if (currentId === end) break;

      const neighbors = this.store.getNeighbors(currentId, this.effectiveDirection('out'));
      for (const neighbor of neighbors) {
        if (visited.has(neighbor.id)) continue;
        const weight = weightFn(currentId, neighbor.id);
        const alt = currentDist + weight;
        if (alt < distances.get(neighbor.id)!) {
          distances.set(neighbor.id, alt);
          previous.set(neighbor.id, currentId);
          if (heapHas(neighbor.id)) {
            heapDecreaseKey(neighbor.id, alt);
          } else {
            heapPush(neighbor.id, alt);
          }
        }
      }
    }

    const finalDist = distances.get(end);
    if (finalDist === undefined || finalDist === Infinity) return null;

    // Reconstruct path
    const path: string[] = [];
    let current: string | undefined = end;
    while (current !== undefined) {
      path.unshift(current);
      current = previous.get(current);
    }

    return { distance: finalDist, path };
  }

  /**
   * PageRank algorithm for ranking nodes by importance.
   * @param iterations - Number of iterations (default 20)
   * @param damping - Damping factor (default 0.85)
   * @returns Map of node ID to PageRank score
   */
  pagerank(iterations: number = 20, damping: number = 0.85): Map<string, number> {
    const nodes = this.store.getAllNodes();
    const n = nodes.length;
    if (n === 0) return new Map();

    const scores = new Map<string, number>();
    for (const node of nodes) {
      scores.set(node.id, 1 / n);
    }

    for (let iter = 0; iter < iterations; iter++) {
      const newScores = new Map<string, number>();

      // Calculate dangling node rank (nodes with zero out-degree)
      let danglingSum = 0;
      for (const node of nodes) {
        const outDegree = this.store.getNeighborCount(node.id, 'out');
        if (outDegree === 0) {
          danglingSum += scores.get(node.id)!;
        }
      }

      for (const node of nodes) {
        // Base rank + dangling node redistribution
        let rank = (1 - damping) / n + damping * (danglingSum / n);
        const inNeighbors = this.store.getNeighborsWithMultiplicity(node.id, 'in');
        for (const { nodeId: neighbor, count } of inNeighbors) {
          const outDegree = this.store.getNeighborCount(neighbor, 'out');
          if (outDegree > 0) {
            rank += damping * (scores.get(neighbor)! / outDegree) * count;
          }
        }
        newScores.set(node.id, rank);
      }

      // Copy new scores
      for (const [id, score] of newScores) {
        scores.set(id, score);
      }
    }

    return scores;
  }

  /**
   * Detect communities in the graph.
   * @param algorithm - Community detection algorithm to use
   * @returns Community detection result
   */
  communityDetection(algorithm: CommunityAlgorithm = 'label-propagation'): CommunityResult {
    switch (algorithm) {
      case 'label-propagation':
        return this.labelPropagation();
      case 'connected-components':
        return this.connectedComponents();
      default:
        return this.connectedComponents();
    }
  }

  /**
   * Calculate centrality scores for all nodes.
   * @param type - Type of centrality measure
   * @returns Centrality result with scores for each node
   */
  centrality(type: CentralityType = 'degree'): CentralityResult {
    const scores = new Map<string, number>();

    switch (type) {
      case 'degree':
        return this.degreeCentrality();
      case 'betweenness':
        return this.betweennessCentrality();
      case 'closeness':
        return this.closenessCentrality();
      default:
        return this.degreeCentrality();
    }
  }

  /**
   * Find all connected components in the graph.
   * @returns Community result where each community is a connected component
   */
  connectedComponents(): CommunityResult {
    const visited = new Set<string>();
    const communities: string[][] = [];

    const allNodes = this.store.getAllNodes();

    for (const node of allNodes) {
      if (visited.has(node.id)) continue;

      const component: string[] = [];
      const queue = [node.id];
      visited.add(node.id);

      while (queue.length > 0) {
        const current = queue.shift()!;
        component.push(current);

        const neighbors = this.store.getNeighbors(current, this.effectiveDirection('both'));
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor.id)) {
            visited.add(neighbor.id);
            queue.push(neighbor.id);
          }
        }
      }

      communities.push(component);
    }

    return { communities };
  }

  /**
   * Compute minimum spanning tree using Prim's algorithm.
   * @returns Array of edges in the MST, or empty array if graph is disconnected
   */
  minimumSpanningTree(weightFn?: (from: string, to: string) => number): Array<{ from: string; to: string; weight: number }> {
    const nodes = this.store.getAllNodes();
    if (nodes.length === 0) return [];

    const inMST = new Set<string>();
    const mstEdges: Array<{ from: string; to: string; weight: number }> = [];

    // Start from first node
    inMST.add(nodes[0].id);

    while (inMST.size < nodes.length) {
      let minEdge: { from: string; to: string; weight: number } | null = null;

      for (const nodeId of inMST) {
        const neighbors = this.store.getNeighbors(nodeId, this.effectiveDirection('both'));
        for (const neighbor of neighbors) {
          if (inMST.has(neighbor.id)) continue;
          const weight = weightFn ? weightFn(nodeId, neighbor.id) : 1;
          if (!minEdge || weight < minEdge.weight) {
            minEdge = { from: nodeId, to: neighbor.id, weight };
          }
        }
      }

      if (!minEdge) break; // Graph is disconnected
      mstEdges.push(minEdge);
      inMST.add(minEdge.to);
    }

    return mstEdges;
  }

  /**
   * Label propagation community detection.
   */
  private labelPropagation(): CommunityResult {
    const nodes = this.store.getAllNodes();
    if (nodes.length === 0) return { communities: [] };

    // Initialize: each node gets its own label
    const labels = new Map<string, string>();
    for (const node of nodes) {
      labels.set(node.id, node.id);
    }

    // Iterate until convergence (max 100 iterations)
    for (let iter = 0; iter < 100; iter++) {
      let changed = false;
      const shuffled = [...nodes].sort(() => Math.random() - 0.5);

      for (const node of shuffled) {
        const neighbors = this.store.getNeighbors(node.id, this.effectiveDirection('both'));
        if (neighbors.length === 0) continue;

        // Count neighbor labels
        const labelCounts = new Map<string, number>();
        for (const neighbor of neighbors) {
          const label = labels.get(neighbor.id)!;
          labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
        }

        // Find most frequent label
        let maxCount = 0;
        let maxLabel = labels.get(node.id)!;
        for (const [label, count] of labelCounts) {
          if (count > maxCount || (count === maxCount && label < maxLabel)) {
            maxCount = count;
            maxLabel = label;
          }
        }

        if (labels.get(node.id) !== maxLabel) {
          labels.set(node.id, maxLabel);
          changed = true;
        }
      }

      if (!changed) break;
    }

    // Group by label
    const groups = new Map<string, string[]>();
    for (const [nodeId, label] of labels) {
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(nodeId);
    }

    return { communities: Array.from(groups.values()) };
  }

  /**
   * Degree centrality for all nodes.
   */
  private degreeCentrality(): CentralityResult {
    const scores = new Map<string, number>();
    const nodes = this.store.getAllNodes();
    const maxPossible = nodes.length - 1;

    for (const node of nodes) {
      const degree = this.store.getNeighbors(node.id, this.effectiveDirection('both')).length;
      scores.set(node.id, maxPossible > 0 ? degree / maxPossible : 0);
    }

    return { scores };
  }

  /**
   * Betweenness centrality for all nodes using Brandes' algorithm.
   */
  private betweennessCentrality(): CentralityResult {
    const scores = new Map<string, number>();
    const nodes = this.store.getAllNodes();

    for (const node of nodes) {
      scores.set(node.id, 0);
    }

    // Brandes' algorithm: for each source, do BFS and accumulate dependencies
    for (const source of nodes) {
      // BFS from source
      const stack: string[] = [];
      const dist = new Map<string, number>();
      const sigma = new Map<string, number>(); // number of shortest paths
      const pred = new Map<string, string[]>(); // predecessors on shortest paths

      for (const node of nodes) {
        dist.set(node.id, -1);
        sigma.set(node.id, 0);
        pred.set(node.id, []);
      }
      dist.set(source.id, 0);
      sigma.set(source.id, 1);

      const queue = [source.id];
      while (queue.length > 0) {
        const v = queue.shift()!;
        stack.push(v);

        const neighbors = this.store.getNeighbors(v, 'out');
        for (const neighbor of neighbors) {
          const w = neighbor.id;
          // First visit to w?
          if (dist.get(w)! === -1) {
            dist.set(w, dist.get(v)! + 1);
            queue.push(w);
          }
          // Shortest path via v?
          if (dist.get(w)! === dist.get(v)! + 1) {
            sigma.set(w, sigma.get(w)! + sigma.get(v)!);
            pred.get(w)!.push(v);
          }
        }
      }

      // Back-propagation of dependencies
      const delta = new Map<string, number>();
      for (const node of nodes) {
        delta.set(node.id, 0);
      }

      while (stack.length > 0) {
        const w = stack.pop()!;
        for (const v of pred.get(w)!) {
          delta.set(v, delta.get(v)! + (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!));
        }
        if (w !== source.id) {
          scores.set(w, scores.get(w)! + delta.get(w)!);
        }
      }
    }

    // Normalize
    const n = nodes.length;
    const norm = n > 2 ? ((n - 1) * (n - 2)) / 2 : 1;
    for (const [id, score] of scores) {
      scores.set(id, score / norm);
    }

    return { scores };
  }

  /**
   * Closeness centrality for all nodes.
   */
  private closenessCentrality(): CentralityResult {
    const scores = new Map<string, number>();
    const nodes = this.store.getAllNodes();
    const n = nodes.length;

    for (const node of nodes) {
      const distances = this.bfsDistances(node.id);
      let totalDist = 0;
      let reachable = 0;

      for (const [targetId, dist] of distances) {
        if (targetId !== node.id && dist < Infinity) {
          totalDist += dist;
          reachable++;
        }
      }

      const closeness = reachable > 0 && totalDist > 0 ? (reachable / (n - 1)) * (1 / (totalDist / reachable)) : 0;
      scores.set(node.id, n > 1 ? closeness : 0);
    }

    return { scores };
  }

  /**
   * Find all shortest paths between two nodes using BFS.
   */
  private findAllShortestPaths(from: string, to: string): string[][] {
    if (from === to) return [[from]];
    if (!this.store.hasNode(from) || !this.store.hasNode(to)) return [];

    const visited = new Map<string, string[][]>();
    const queue = [from];
    visited.set(from, [[from]]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const paths = visited.get(current)!;

      if (current === to) return paths;

      const neighbors = this.store.getNeighbors(current, 'out');
      for (const neighbor of neighbors) {
        const newPaths = paths.map(p => [...p, neighbor.id]);

        if (!visited.has(neighbor.id)) {
          visited.set(neighbor.id, newPaths);
          queue.push(neighbor.id);
        } else {
          // Only extend if same length
          const existing = visited.get(neighbor.id)!;
          if (existing[0].length === newPaths[0].length) {
            existing.push(...newPaths);
          }
        }
      }
    }

    return [];
  }

  /**
   * BFS to compute distances from a source node.
   */
  private bfsDistances(start: string): Map<string, number> {
    const distances = new Map<string, number>();
    if (!this.store.hasNode(start)) return distances;

    distances.set(start, 0);
    const queue = [start];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentDist = distances.get(current)!;

      const neighbors = this.store.getNeighbors(current, this.effectiveDirection('both'));
      for (const neighbor of neighbors) {
        if (!distances.has(neighbor.id)) {
          distances.set(neighbor.id, currentDist + 1);
          queue.push(neighbor.id);
        }
      }
    }

    return distances;
  }
}
