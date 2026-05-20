/**
 * GraphQuery - Query language for graph traversal and pattern matching.
 *
 * Provides a fluent API for constructing graph queries with pattern matching,
 * filtering, sorting, pagination, path finding, and traversal.
 */

import { GraphStore, GraphNode, GraphEdge } from './graph-store.js';

/** Sort direction */
export type SortDirection = 'asc' | 'desc';

/** A single match pattern element */
export interface MatchPattern {
  nodeVar: string;
  labels?: string[];
  edgeVar?: string;
  edgeType?: string;
  direction?: 'out' | 'in';
  targetVar?: string;
}

/** A condition for filtering */
export type WhereCondition = (row: Record<string, unknown>) => boolean;

/** Projection specification */
export type Projection = string | { expr: string; alias: string };

/** Query result row */
export type QueryResult = Record<string, unknown>;

/** Path result */
export interface PathResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  length: number;
}

/**
 * GraphQuery provides a fluent query language for graph traversal.
 *
 * @example
 * ```typescript
 * const query = new GraphQuery(store);
 * const results = query
 *   .match([{ nodeVar: 'p', labels: ['Person'] }])
 *   .where(row => (row.p as GraphNode).properties.age > 25)
 *   .return(['p'])
 *   .orderBy('p.name', 'asc')
 *   .limit(10)
 *   .execute();
 * ```
 */
export class GraphQuery {
  private store: GraphStore;
  private patterns: MatchPattern[] = [];
  private conditions: WhereCondition[] = [];
  private projections: Projection[] = [];
  private sortField: string | null = null;
  private sortDirection: SortDirection = 'asc';
  private limitCount: number | null = null;
  private skipCount: number = 0;

  constructor(store: GraphStore) {
    this.store = store;
  }

  /**
   * Define a match pattern for the query.
   * @param pattern - Match pattern specification
   * @returns This query for chaining
   */
  match(pattern: MatchPattern[]): this {
    this.patterns = pattern;
    return this;
  }

  /**
   * Add a WHERE condition to filter results.
   * @param condition - Filter function
   * @returns This query for chaining
   */
  where(condition: WhereCondition): this {
    this.conditions.push(condition);
    return this;
  }

  /**
   * Specify which fields to return.
   * @param projections - Array of projection specifications
   * @returns This query for chaining
   */
  return(projections: Projection[]): this {
    this.projections = projections;
    return this;
  }

  /**
   * Order results by a field.
   * @param field - Field name to sort by
   * @param direction - Sort direction ('asc' or 'desc')
   * @returns This query for chaining
   */
  orderBy(field: string, direction: SortDirection = 'asc'): this {
    this.sortField = field;
    this.sortDirection = direction;
    return this;
  }

  /**
   * Limit the number of results.
   * @param count - Maximum number of results
   * @returns This query for chaining
   */
  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  /**
   * Skip a number of results (pagination offset).
   * @param count - Number of results to skip
   * @returns This query for chaining
   */
  skip(count: number): this {
    this.skipCount = count;
    return this;
  }

  /**
   * Find the shortest path between two nodes using BFS.
   * @param from - Start node ID
   * @param to - End node ID
   * @param weightFn - Optional weight function for weighted shortest path (uses BFS if not provided)
   * @returns Path result or null if no path exists
   */
  shortestPath(from: string, to: string, weightFn?: (from: string, to: string) => number): PathResult | null {
    if (!this.store.hasNode(from) || !this.store.hasNode(to)) {
      return null;
    }
    if (from === to) {
      const node = this.store.getNode(from)!;
      return { nodes: [node], edges: [], length: 0 };
    }

    // Use Dijkstra for weighted graphs
    if (weightFn) {
      return this.weightedShortestPath(from, to, weightFn);
    }

    // Unweighted BFS
    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; path: string[]; edgeIds: string[] }> = [
      { nodeId: from, path: [from], edgeIds: [] }
    ];
    visited.add(from);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = this.store.getNeighbors(current.nodeId, 'out');

      for (const neighbor of neighbors) {
        if (visited.has(neighbor.id)) continue;

        const edges = this.store.getEdgesBetween(current.nodeId, neighbor.id);
        const edgeId = edges.length > 0 ? edges[0].id : '';

        const newPath = [...current.path, neighbor.id];
        const newEdgeIds = [...current.edgeIds, edgeId];

        if (neighbor.id === to) {
          return {
            nodes: newPath.map(id => this.store.getNode(id)!),
            edges: newEdgeIds.map(id => this.store.getEdge(id)!).filter(Boolean),
            length: newPath.length - 1,
          };
        }

        visited.add(neighbor.id);
        queue.push({ nodeId: neighbor.id, path: newPath, edgeIds: newEdgeIds });
      }
    }

    return null;
  }

  /**
   * Find the shortest path using Dijkstra's algorithm for weighted graphs.
   */
  private weightedShortestPath(from: string, to: string, weightFn: (from: string, to: string) => number): PathResult | null {
    const distances = new Map<string, number>();
    const previous = new Map<string, string>();
    const previousEdge = new Map<string, string>();
    const visited = new Set<string>();

    const allNodes = this.store.getAllNodes();
    for (const node of allNodes) {
      distances.set(node.id, Infinity);
    }
    distances.set(from, 0);

    while (true) {
      // Find unvisited node with minimum distance
      let current: string | null = null;
      let minDist = Infinity;
      for (const nodeId of allNodes) {
        if (visited.has(nodeId)) continue;
        const d = distances.get(nodeId)!;
        if (d < minDist) {
          minDist = d;
          current = nodeId;
        }
      }

      if (current === null || minDist === Infinity) break;
      if (current === to) break;

      visited.add(current);

      const neighbors = this.store.getNeighbors(current, 'out');
      for (const neighbor of neighbors) {
        if (visited.has(neighbor.id)) continue;
        const weight = weightFn(current, neighbor.id);
        const alt = distances.get(current)! + weight;
        if (alt < distances.get(neighbor.id)!) {
          distances.set(neighbor.id, alt);
          previous.set(neighbor.id, current);
          // Find the edge between current and neighbor
          const edges = this.store.getEdgesBetween(current, neighbor.id);
          if (edges.length > 0) {
            previousEdge.set(neighbor.id, edges[0].id);
          }
        }
      }
    }

    const finalDist = distances.get(to);
    if (finalDist === undefined || finalDist === Infinity) return null;

    // Reconstruct path
    const pathIds: string[] = [];
    const edgeIds: string[] = [];
    let current: string | undefined = to;
    while (current !== undefined) {
      pathIds.unshift(current);
      const edgeId = previousEdge.get(current);
      if (edgeId) edgeIds.unshift(edgeId);
      current = previous.get(current);
    }

    return {
      nodes: pathIds.map(id => this.store.getNode(id)!).filter(Boolean),
      edges: edgeIds.map(id => this.store.getEdge(id)!).filter(Boolean),
      length: pathIds.length - 1,
    };
  }

  /**
   * Traverse the graph from a starting node.
   * @param start - Start node ID
   * @param direction - Traversal direction ('out', 'in', or 'both')
   * @param maxDepth - Maximum traversal depth
   * @returns Array of nodes reachable within maxDepth
   */
  traverse(start: string, direction: 'out' | 'in' | 'both' = 'out', maxDepth: number = 10): GraphNode[] {
    if (!this.store.hasNode(start)) return [];

    const visited = new Set<string>();
    const result: GraphNode[] = [];
    const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: start, depth: 0 }];
    visited.add(start);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const node = this.store.getNode(current.nodeId);
      if (node && current.depth > 0) {
        result.push(node);
      }

      if (current.depth >= maxDepth) continue;

      const neighbors = this.store.getNeighbors(current.nodeId, direction);
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor.id)) {
          visited.add(neighbor.id);
          queue.push({ nodeId: neighbor.id, depth: current.depth + 1 });
        }
      }
    }

    return result;
  }

  /**
   * Execute the query and return results.
   * @returns Array of result rows
   */
  execute(): QueryResult[] {
    let results: QueryResult[] = [];

    if (this.patterns.length === 0) {
      // No patterns: return all nodes
      const allNodes = this.store.getAllNodes();
      results = allNodes.map(node => ({ node }));
    } else {
      // Process match patterns
      results = this.processPatterns();
    }

    // Apply WHERE conditions
    for (const condition of this.conditions) {
      results = results.filter(condition);
    }

    // Apply projections
    if (this.projections.length > 0) {
      results = results.map(row => {
        const projected: QueryResult = {};
        for (const p of this.projections) {
          if (typeof p === 'string') {
            projected[p] = row[p];
          } else {
            projected[p.alias] = row[p.expr];
          }
        }
        return projected;
      });
    }

    // Apply sorting
    if (this.sortField) {
      results.sort((a, b) => {
        const aVal = a[this.sortField!];
        const bVal = b[this.sortField!];
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return this.sortDirection === 'asc' ? cmp : -cmp;
      });
    }

    // Apply skip
    if (this.skipCount > 0) {
      results = results.slice(this.skipCount);
    }

    // Apply limit
    if (this.limitCount !== null) {
      results = results.slice(0, this.limitCount);
    }

    return results;
  }

  /**
   * Process match patterns to generate initial result rows.
   */
  private processPatterns(): QueryResult[] {
    const rows: QueryResult[] = [{}];

    for (const pattern of this.patterns) {
      const newRows: QueryResult[] = [];

      // Find candidate nodes
      let candidates: GraphNode[];
      if (pattern.labels && pattern.labels.length > 0) {
        candidates = pattern.labels.flatMap(label => this.store.getNodesByLabel(label));
        // Deduplicate
        const seen = new Set<string>();
        candidates = candidates.filter(n => {
          if (seen.has(n.id)) return false;
          seen.add(n.id);
          return true;
        });
      } else {
        candidates = this.store.getAllNodes();
      }

      for (const row of rows) {
        for (const candidate of candidates) {
          // If variable already bound, skip non-matching
          if (row[pattern.nodeVar] !== undefined) {
            const existing = row[pattern.nodeVar] as GraphNode;
            if (existing.id !== candidate.id) continue;
          }

          const baseRow = { ...row, [pattern.nodeVar]: candidate };

          // Handle edge pattern
          if (pattern.targetVar) {
            const dir = pattern.direction || 'out';
            const neighbors = this.store.getNeighbors(candidate.id, dir);
            for (const neighbor of neighbors) {
              if (row[pattern.targetVar] !== undefined) {
                const existing = row[pattern.targetVar] as GraphNode;
                if (existing.id !== neighbor.id) continue;
              }

              // Apply edge type filtering
              if (pattern.edgeType) {
                const edgesBetween = this.store.getEdgesBetween(candidate.id, neighbor.id);
                const hasMatchingEdge = edgesBetween.some(e => e.type === pattern.edgeType);
                if (!hasMatchingEdge) continue;

                // Bind edge variable if specified
                const resultRow = { ...baseRow, [pattern.targetVar]: neighbor };
                if (pattern.edgeVar) {
                  const matchingEdge = edgesBetween.find(e => e.type === pattern.edgeType);
                  if (matchingEdge) {
                    resultRow[pattern.edgeVar] = matchingEdge;
                  }
                }
                newRows.push(resultRow);
              } else {
                // Bind edge variable if specified (any edge)
                const resultRow = { ...baseRow, [pattern.targetVar]: neighbor };
                if (pattern.edgeVar) {
                  const edgesBetween = this.store.getEdgesBetween(candidate.id, neighbor.id);
                  if (edgesBetween.length > 0) {
                    resultRow[pattern.edgeVar] = edgesBetween[0];
                  }
                }
                newRows.push(resultRow);
              }
            }
          } else {
            newRows.push(baseRow);
          }
        }
      }

      rows.length = 0;
      rows.push(...newRows);
    }

    return rows;
  }
}
