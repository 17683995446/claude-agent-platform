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

/** Snapshot of graph state for transaction rollback */
interface GraphSnapshot {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  outAdjacency: Map<string, AdjacencyEntry[]>;
  inAdjacency: Map<string, AdjacencyEntry[]>;
  labelIndex: Map<string, Set<string>>;
  edgeIdCounter: number;
}

/** Graph change event types */
export type GraphChangeEventType = 'node_added' | 'node_removed' | 'edge_added' | 'edge_removed';

/** Graph change event */
export interface GraphChangeEvent {
  type: GraphChangeEventType;
  targetId: string;
  data?: Record<string, unknown>;
}

/** Listener for graph change events */
export type GraphChangeListener = (event: GraphChangeEvent) => void;

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
  private transactionSnapshot: GraphSnapshot | null = null;
  private inTransaction: boolean = false;
  private listeners: Set<GraphChangeListener> = new Set();

  /**
   * Add a listener for graph change events.
   * @param listener - Callback function for change events
   * @returns Function to remove the listener
   */
  onChange(listener: GraphChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Remove a listener for graph change events.
   * @param listener - Callback function to remove
   */
  offChange(listener: GraphChangeListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Emit a graph change event to all listeners.
   */
  private emitChange(event: GraphChangeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Listener errors should not affect graph operations
      }
    }
  }

  /**
   * Add a node to the graph.
   * @param id - Unique node identifier
   * @param labels - Array of label strings for categorization
   * @param properties - Key-value properties attached to the node
   * @throws {Error} If a node with the same ID already exists
   */
  addNode(id: string, labels: string[] = [], properties: Record<string, unknown> = {}): void {
    if (this.nodes.has(id)) {
      const existing = this.nodes.get(id)!;
      existing.labels = labels;
      existing.properties = { ...existing.properties, ...properties };
      return;
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

    this.emitChange({ type: 'node_added', targetId: id, data: { labels, properties } });
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

    this.emitChange({ type: 'node_removed', targetId: id });

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

    this.emitChange({ type: 'edge_removed', targetId: id });

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
   * Get the count of edges in a given direction (allowing duplicates).
   * @param id - Node ID
   * @param direction - Direction of edges to consider
   * @returns Number of edges
   */
  getNeighborCount(id: string, direction: Direction = 'both'): number {
    let count = 0;
    if (direction === 'out' || direction === 'both') {
      count += (this.outAdjacency.get(id) || []).length;
    }
    if (direction === 'in' || direction === 'both') {
      count += (this.inAdjacency.get(id) || []).length;
    }
    return count;
  }

  /**
   * Get neighboring nodes with multiplicity (count of edges from/to each neighbor).
   * @param id - Node ID
   * @param direction - Direction of edges to consider
   * @returns Array of { nodeId, count } objects
   */
  getNeighborsWithMultiplicity(id: string, direction: Direction = 'both'): Array<{ nodeId: string; count: number }> {
    const counts = new Map<string, number>();

    if (direction === 'out' || direction === 'both') {
      const outEdges = this.outAdjacency.get(id) || [];
      for (const entry of outEdges) {
        counts.set(entry.nodeId, (counts.get(entry.nodeId) || 0) + 1);
      }
    }

    if (direction === 'in' || direction === 'both') {
      const inEdges = this.inAdjacency.get(id) || [];
      for (const entry of inEdges) {
        counts.set(entry.nodeId, (counts.get(entry.nodeId) || 0) + 1);
      }
    }

    return Array.from(counts.entries()).map(([nodeId, count]) => ({ nodeId, count }));
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
   * Begin a transaction. Takes a snapshot of the current state.
   */
  beginTransaction(): void {
    if (this.inTransaction) {
      throw new Error('Transaction already in progress');
    }
    this.transactionSnapshot = {
      nodes: new Map(this.nodes),
      edges: new Map(this.edges),
      outAdjacency: new Map(Array.from(this.outAdjacency.entries()).map(([k, v]) => [k, [...v]])),
      inAdjacency: new Map(Array.from(this.inAdjacency.entries()).map(([k, v]) => [k, [...v]])),
      labelIndex: new Map(Array.from(this.labelIndex.entries()).map(([k, v]) => [k, new Set(v)])),
      edgeIdCounter,
    };
    this.inTransaction = true;
  }

  /**
   * Commit a transaction. Clears the snapshot.
   */
  commitTransaction(): void {
    if (!this.inTransaction) {
      throw new Error('No transaction in progress');
    }
    this.transactionSnapshot = null;
    this.inTransaction = false;
  }

  /**
   * Rollback a transaction. Restores the graph to the state at beginTransaction.
   */
  rollbackTransaction(): void {
    if (!this.inTransaction || !this.transactionSnapshot) {
      throw new Error('No transaction in progress');
    }
    const snap = this.transactionSnapshot;
    this.nodes = snap.nodes;
    this.edges = snap.edges;
    this.outAdjacency = snap.outAdjacency;
    this.inAdjacency = snap.inAdjacency;
    this.labelIndex = snap.labelIndex;
    edgeIdCounter = snap.edgeIdCounter;
    this.transactionSnapshot = null;
    this.inTransaction = false;
  }

  /**
   * Check if a transaction is in progress.
   */
  isInTransaction(): boolean {
    return this.inTransaction;
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
   * Add multiple nodes at once.
   * @param nodeData - Array of { id, labels, properties } objects
   * @returns Array of booleans indicating success for each node
   */
  addNodes(nodeData: Array<{ id: string; labels?: string[]; properties?: Record<string, unknown> }>): boolean[] {
    return nodeData.map(n => {
      try {
        this.addNode(n.id, n.labels || [], n.properties || {});
        return true;
      } catch {
        return false;
      }
    });
  }

  /**
   * Add multiple edges at once.
   * @param edgeData - Array of { from, to, type, properties } objects
   * @returns Array of edge IDs (empty string for failed edges)
   */
  addEdges(edgeData: Array<{ from: string; to: string; type: string; properties?: Record<string, unknown> }>): string[] {
    return edgeData.map(e => {
      try {
        return this.addEdge(e.from, e.to, e.type, e.properties || {});
      } catch {
        return '';
      }
    });
  }

  /**
   * Remove multiple nodes at once.
   * @param ids - Array of node IDs to remove
   * @returns Number of nodes successfully removed
   */
  removeNodes(ids: string[]): number {
    let count = 0;
    for (const id of ids) {
      if (this.removeNode(id)) count++;
    }
    return count;
  }

  /**
   * Remove multiple edges at once.
   * @param ids - Array of edge IDs to remove
   * @returns Number of edges successfully removed
   */
  removeEdges(ids: string[]): number {
    let count = 0;
    for (const id of ids) {
      if (this.removeEdge(id)) count++;
    }
    return count;
  }

  /**
   * Reset the internal edge ID counter (useful for testing).
   */
  static resetEdgeIdCounter(): void {
    edgeIdCounter = 0;
  }
}
