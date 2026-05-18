/**
 * GraphStore - Core graph storage with nodes and edges.
 *
 * Provides fundamental graph data structure operations including node/edge
 * CRUD, label-based indexing, and neighbor traversal.
 */

/** Represents a node in the graph */
export interface GraphNode {
  id: string;
  labels: string[];
  properties: Record<string, unknown>;
}

/** Represents an edge in the graph */
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type: string;
  properties: Record<string, unknown>;
}

/** Direction for neighbor traversal */
export type Direction = 'in' | 'out' | 'both';

/** Internal adjacency entry */
interface AdjacencyEntry {
  edgeId: string;
  nodeId: string;
  edgeType: string;
}

let edgeIdCounter = 0;

/**
 * Generate a unique edge ID.
 */
function generateEdgeId(): string {
  return `edge_${++edgeIdCounter}`;
}

/**
 * GraphStore provides core graph storage with nodes and edges.
 *
 * @example
 * ```typescript
 * const store = new GraphStore();
 * store.addNode('alice', ['Person'], { name: 'Alice', age: 30 });
 * store.addNode('bob', ['Person'], { name: 'Bob', age: 25 });
 * store.addEdge('alice', 'bob', 'KNOWS', { since: 2020 });
 * ```
 */
export class GraphStore {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: Map<string, GraphEdge> = new Map();
  private outAdjacency: Map<string, AdjacencyEntry[]> = new Map();
  private inAdjacency: Map<string, AdjacencyEntry[]> = new Map();
  private labelIndex: Map<string, Set<string>> = new Map();

  /**
   * Add a node to the graph.
   * @param id - Unique node identifier
   * @param labels - Array of label strings for categorization
   * @param properties - Key-value properties attached to the node
   * @throws {Error} If a node with the same ID already exists
   */
  addNode(id: string, labels: string[] = [], properties: Record<string, unknown> = {}): void {
    if (this.nodes.has(id)) {
      throw new Error(`Node with id '${id}' already exists`);
    }
    const node: GraphNode = { id, labels, properties };
    this.nodes.set(id, node);
    this.outAdjacency.set(id, []);
    this.inAdjacency.set(id, []);

    for (const label of labels) {
      if (!this.labelIndex.has(label)) {
        this.labelIndex.set(label, new Set());
      }
      this.labelIndex.get(label)!.add(id);
    }
  }

  /**
   * Add a directed edge between two nodes.
   * @param from - Source node ID
   * @param to - Target node ID
   * @param type - Edge type/label
   * @param properties - Key-value properties attached to the edge
   * @returns The ID of the created edge
   * @throws {Error} If source or target node does not exist
   */
  addEdge(from: string, to: string, type: string, properties: Record<string, unknown> = {}): string {
    if (!this.nodes.has(from)) {
      throw new Error(`Source node '${from}' does not exist`);
    }
    if (!this.nodes.has(to)) {
      throw new Error(`Target node '${to}' does not exist`);
    }

    const id = generateEdgeId();
    const edge: GraphEdge = { id, from, to, type, properties };
    this.edges.set(id, edge);

    const outEntry: AdjacencyEntry = { edgeId: id, nodeId: to, edgeType: type };
    const inEntry: AdjacencyEntry = { edgeId: id, nodeId: from, edgeType: type };

    this.outAdjacency.get(from)!.push(outEntry);
    this.inAdjacency.get(to)!.push(inEntry);

    return id;
  }

  /**
   * Remove a node and all its connected edges from the graph.
   * @param id - Node ID to remove
   * @returns true if the node was found and removed, false otherwise
   */
  removeNode(id: string): boolean {
    const node = this.nodes.get(id);
    if (!node) return false;

    // Remove all outgoing edges
    const outEdges = this.outAdjacency.get(id) || [];
    for (const entry of outEdges) {
      this.edges.delete(entry.edgeId);
      const inList = this.inAdjacency.get(entry.nodeId);
      if (inList) {
        const idx = inList.findIndex(e => e.edgeId === entry.edgeId);
        if (idx !== -1) inList.splice(idx, 1);
      }
    }

    // Remove all incoming edges
    const inEdges = this.inAdjacency.get(id) || [];
    for (const entry of inEdges) {
      this.edges.delete(entry.edgeId);
      const outList = this.outAdjacency.get(entry.nodeId);
      if (outList) {
        const idx = outList.findIndex(e => e.edgeId === entry.edgeId);
        if (idx !== -1) outList.splice(idx, 1);
      }
    }

    // Remove from label index
    for (const label of node.labels) {
      const set = this.labelIndex.get(label);
      if (set) {
        set.delete(id);
        if (set.size === 0) this.labelIndex.delete(label);
      }
    }

    this.nodes.delete(id);
    this.outAdjacency.delete(id);
    this.inAdjacency.delete(id);
    return true;
  }

  /**
   * Remove an edge from the graph.
   * @param id - Edge ID to remove
   * @returns true if the edge was found and removed, false otherwise
   */
  removeEdge(id: string): boolean {
    const edge = this.edges.get(id);
    if (!edge) return false;

    // Remove from out-adjacency
    const outList = this.outAdjacency.get(edge.from);
    if (outList) {
      const idx = outList.findIndex(e => e.edgeId === id);
      if (idx !== -1) outList.splice(idx, 1);
    }

    // Remove from in-adjacency
    const inList = this.inAdjacency.get(edge.to);
    if (inList) {
      const idx = inList.findIndex(e => e.edgeId === id);
      if (idx !== -1) inList.splice(idx, 1);
    }

    this.edges.delete(id);
    return true;
  }

  /**
   * Get a node by its ID.
   * @param id - Node ID
   * @returns The node, or undefined if not found
   */
  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Get an edge by its ID.
   * @param id - Edge ID
   * @returns The edge, or undefined if not found
   */
  getEdge(id: string): GraphEdge | undefined {
    return this.edges.get(id);
  }

  /**
   * Get all nodes that have a specific label.
   * @param label - Label to filter by
   * @returns Array of nodes with the given label
   */
  getNodesByLabel(label: string): GraphNode[] {
    const ids = this.labelIndex.get(label);
    if (!ids) return [];
    return Array.from(ids).map(id => this.nodes.get(id)!).filter(Boolean);
  }

  /**
   * Get neighboring nodes of a given node.
   * @param id - Node ID
   * @param direction - Direction of edges to consider ('in', 'out', or 'both')
   * @returns Array of neighboring nodes
   */
  getNeighbors(id: string, direction: Direction = 'both'): GraphNode[] {
    const neighborIds = new Set<string>();

    if (direction === 'out' || direction === 'both') {
      const outEdges = this.outAdjacency.get(id) || [];
      for (const entry of outEdges) {
        neighborIds.add(entry.nodeId);
      }
    }

    if (direction === 'in' || direction === 'both') {
      const inEdges = this.inAdjacency.get(id) || [];
      for (const entry of inEdges) {
        neighborIds.add(entry.nodeId);
      }
    }

    return Array.from(neighborIds).map(nid => this.nodes.get(nid)!).filter(Boolean);
  }

  /**
   * Get the total number of nodes in the graph.
   */
  getNodeCount(): number {
    return this.nodes.size;
  }

  /**
   * Get the total number of edges in the graph.
   */
  getEdgeCount(): number {
    return this.edges.size;
  }

  /**
   * Get all nodes in the graph.
   */
  getAllNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get all edges in the graph.
   */
  getAllEdges(): GraphEdge[] {
    return Array.from(this.edges.values());
  }

  /**
   * Check if a node exists.
   */
  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  /**
   * Check if an edge exists between two nodes.
   */
  hasEdge(from: string, to: string): boolean {
    const outEdges = this.outAdjacency.get(from) || [];
    return outEdges.some(e => e.nodeId === to);
  }

  /**
   * Get edges between two specific nodes.
   */
  getEdgesBetween(from: string, to: string): GraphEdge[] {
    const outEdges = this.outAdjacency.get(from) || [];
    return outEdges
      .filter(e => e.nodeId === to)
      .map(e => this.edges.get(e.edgeId)!)
      .filter(Boolean);
  }

  /**
   * Clear all nodes and edges from the graph.
   */
  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.outAdjacency.clear();
    this.inAdjacency.clear();
    this.labelIndex.clear();
  }

  /**
   * Reset the internal edge ID counter (useful for testing).
   */
  static resetEdgeIdCounter(): void {
    edgeIdCounter = 0;
  }
}
