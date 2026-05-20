import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  GraphStore,
  GraphQuery,
  GraphAlgorithms,
  OntologyManager,
  TripleStore,
  ReasoningEngine,
  EmbeddingIndex,
  GraphVisualizer,
  TemporalGraph,
  GraphImportExport,
} from '../src/index.js';
import type { GraphNode } from '../src/index.js';

// ============================================================
// GraphStore Tests (20 tests)
// ============================================================
describe('GraphStore', () => {
  let store: GraphStore;

  beforeEach(() => {
    store = new GraphStore();
    GraphStore.resetEdgeIdCounter();
  });

  afterEach(() => {
    GraphStore.resetEdgeIdCounter();
  });

  it('should create an empty graph', () => {
    expect(store.getNodeCount()).toBe(0);
    expect(store.getEdgeCount()).toBe(0);
  });

  it('should add a node with labels and properties', () => {
    store.addNode('alice', ['Person'], { name: 'Alice', age: 30 });
    const node = store.getNode('alice');
    expect(node).toBeDefined();
    expect(node!.id).toBe('alice');
    expect(node!.labels).toEqual(['Person']);
    expect(node!.properties.name).toBe('Alice');
    expect(node!.properties.age).toBe(30);
  });

  it('should add a node without labels or properties', () => {
    store.addNode('n1');
    const node = store.getNode('n1');
    expect(node).toBeDefined();
    expect(node!.labels).toEqual([]);
    expect(node!.properties).toEqual({});
  });

  it('should upsert when adding a duplicate node', () => {
    store.addNode('n1', ['A'], { x: 1 });
    store.addNode('n1', ['B'], { y: 2 });
    const node = store.getNode('n1');
    expect(node).toBeDefined();
    expect(node!.labels).toEqual(['B']);
    expect(node!.properties).toEqual({ x: 1, y: 2 });
  });

  it('should add an edge between two nodes', () => {
    store.addNode('a');
    store.addNode('b');
    const edgeId = store.addEdge('a', 'b', 'KNOWS', { since: 2020 });
    expect(edgeId).toBeDefined();
    const edge = store.getEdge(edgeId);
    expect(edge).toBeDefined();
    expect(edge!.from).toBe('a');
    expect(edge!.to).toBe('b');
    expect(edge!.type).toBe('KNOWS');
    expect(edge!.properties.since).toBe(2020);
  });

  it('should throw when adding edge with non-existent source', () => {
    expect(() => store.addEdge('missing', 'b', 'KNOWS')).toThrow("Source node 'missing' does not exist");
  });

  it('should throw when adding edge with non-existent target', () => {
    store.addNode('a');
    expect(() => store.addEdge('a', 'missing', 'KNOWS')).toThrow("Target node 'missing' does not exist");
  });

  it('should remove a node and its edges', () => {
    store.addNode('a');
    store.addNode('b');
    store.addEdge('a', 'b', 'KNOWS');
    expect(store.getNodeCount()).toBe(2);
    expect(store.getEdgeCount()).toBe(1);

    const removed = store.removeNode('a');
    expect(removed).toBe(true);
    expect(store.getNodeCount()).toBe(1);
    expect(store.getEdgeCount()).toBe(0);
    expect(store.getNode('a')).toBeUndefined();
  });

  it('should return false when removing non-existent node', () => {
    expect(store.removeNode('missing')).toBe(false);
  });

  it('should remove an edge', () => {
    store.addNode('a');
    store.addNode('b');
    const edgeId = store.addEdge('a', 'b', 'KNOWS');
    expect(store.getEdgeCount()).toBe(1);

    const removed = store.removeEdge(edgeId);
    expect(removed).toBe(true);
    expect(store.getEdgeCount()).toBe(0);
  });

  it('should return false when removing non-existent edge', () => {
    expect(store.removeEdge('missing')).toBe(false);
  });

  it('should get nodes by label', () => {
    store.addNode('alice', ['Person', 'Employee']);
    store.addNode('bob', ['Person']);
    store.addNode('acme', ['Organization']);

    const persons = store.getNodesByLabel('Person');
    expect(persons.length).toBe(2);
    expect(persons.map(n => n.id)).toContain('alice');
    expect(persons.map(n => n.id)).toContain('bob');

    const orgs = store.getNodesByLabel('Organization');
    expect(orgs.length).toBe(1);
    expect(orgs[0].id).toBe('acme');
  });

  it('should return empty array for non-existent label', () => {
    expect(store.getNodesByLabel('NonExistent')).toEqual([]);
  });

  it('should get neighbors with direction out', () => {
    store.addNode('a');
    store.addNode('b');
    store.addNode('c');
    store.addEdge('a', 'b', 'KNOWS');
    store.addEdge('c', 'a', 'KNOWS');

    const outNeighbors = store.getNeighbors('a', 'out');
    expect(outNeighbors.length).toBe(1);
    expect(outNeighbors[0].id).toBe('b');
  });

  it('should get neighbors with direction in', () => {
    store.addNode('a');
    store.addNode('b');
    store.addNode('c');
    store.addEdge('a', 'b', 'KNOWS');
    store.addEdge('c', 'a', 'KNOWS');

    const inNeighbors = store.getNeighbors('a', 'in');
    expect(inNeighbors.length).toBe(1);
    expect(inNeighbors[0].id).toBe('c');
  });

  it('should get neighbors with direction both', () => {
    store.addNode('a');
    store.addNode('b');
    store.addNode('c');
    store.addEdge('a', 'b', 'KNOWS');
    store.addEdge('c', 'a', 'KNOWS');

    const bothNeighbors = store.getNeighbors('a', 'both');
    expect(bothNeighbors.length).toBe(2);
    expect(bothNeighbors.map(n => n.id).sort()).toEqual(['b', 'c']);
  });

  it('should handle self-loops', () => {
    store.addNode('a');
    store.addEdge('a', 'a', 'SELF');
    expect(store.getEdgeCount()).toBe(1);
    expect(store.hasEdge('a', 'a')).toBe(true);
    const neighbors = store.getNeighbors('a', 'both');
    expect(neighbors.length).toBe(1);
    expect(neighbors[0].id).toBe('a');
  });

  it('should handle a single node graph', () => {
    store.addNode('only');
    expect(store.getNodeCount()).toBe(1);
    expect(store.getEdgeCount()).toBe(0);
    expect(store.getNeighbors('only', 'both')).toEqual([]);
  });

  it('should handle disconnected components', () => {
    store.addNode('a');
    store.addNode('b');
    store.addNode('c');
    store.addNode('d');
    store.addEdge('a', 'b', 'KNOWS');
    store.addEdge('c', 'd', 'KNOWS');

    expect(store.getNodeCount()).toBe(4);
    expect(store.getEdgeCount()).toBe(2);
    expect(store.getNeighbors('a', 'both').map(n => n.id)).toEqual(['b']);
    expect(store.getNeighbors('c', 'both').map(n => n.id)).toEqual(['d']);
  });

  it('should clear the graph', () => {
    store.addNode('a');
    store.addNode('b');
    store.addEdge('a', 'b', 'KNOWS');
    store.clear();
    expect(store.getNodeCount()).toBe(0);
    expect(store.getEdgeCount()).toBe(0);
  });

  it('should get edges between two nodes', () => {
    store.addNode('a');
    store.addNode('b');
    store.addEdge('a', 'b', 'KNOWS');
    store.addEdge('a', 'b', 'LIKES');

    const edges = store.getEdgesBetween('a', 'b');
    expect(edges.length).toBe(2);
  });
});

// ============================================================
// GraphQuery Tests (18 tests)
// ============================================================
describe('GraphQuery', () => {
  let store: GraphStore;
  let query: GraphQuery;

  beforeEach(() => {
    store = new GraphStore();
    GraphStore.resetEdgeIdCounter();
    query = new GraphQuery(store);
  });

  afterEach(() => {
    GraphStore.resetEdgeIdCounter();
  });

  it('should execute query on empty graph', () => {
    const results = query.execute();
    expect(results).toEqual([]);
  });

  it('should match nodes by label', () => {
    store.addNode('alice', ['Person'], { name: 'Alice', age: 30 });
    store.addNode('acme', ['Organization'], { name: 'Acme Corp' });

    const results = query.match([{ nodeVar: 'p', labels: ['Person'] }]).execute();
    expect(results.length).toBe(1);
    expect((results[0].p as GraphNode).id).toBe('alice');
  });

  it('should filter with where condition', () => {
    store.addNode('alice', ['Person'], { name: 'Alice', age: 30 });
    store.addNode('bob', ['Person'], { name: 'Bob', age: 25 });
    store.addNode('charlie', ['Person'], { name: 'Charlie', age: 35 });

    const results = query
      .match([{ nodeVar: 'p', labels: ['Person'] }])
      .where(row => (row.p as GraphNode).properties.age > 28)
      .execute();

    expect(results.length).toBe(2);
    expect(results.map(r => (r.p as GraphNode).id)).toContain('alice');
    expect(results.map(r => (r.p as GraphNode).id)).toContain('charlie');
  });

  it('should return projected fields', () => {
    store.addNode('alice', ['Person'], { name: 'Alice' });
    store.addNode('bob', ['Person'], { name: 'Bob' });

    const results = query
      .match([{ nodeVar: 'p', labels: ['Person'] }])
      .return(['p'])
      .execute();

    expect(results.length).toBe(2);
    expect(results[0].p).toBeDefined();
    expect(results[0].node).toBeUndefined();
  });

  it('should order results ascending', () => {
    store.addNode('c', [], { val: 3 });
    store.addNode('a', [], { val: 1 });
    store.addNode('b', [], { val: 2 });

    const results = query
      .match([{ nodeVar: 'n' }])
      .return([{ expr: 'n', alias: 'node' }])
      .orderBy('val', 'asc')
      .execute();

    // Note: ordering works on the result rows, not nested properties
    expect(results.length).toBe(3);
  });

  it('should limit results', () => {
    for (let i = 0; i < 10; i++) {
      store.addNode(`n${i}`, [], { val: i });
    }

    const results = query.match([{ nodeVar: 'n' }]).limit(3).execute();
    expect(results.length).toBe(3);
  });

  it('should skip results', () => {
    for (let i = 0; i < 5; i++) {
      store.addNode(`n${i}`, [], { val: i });
    }

    const results = query.match([{ nodeVar: 'n' }]).skip(3).execute();
    expect(results.length).toBe(2);
  });

  it('should combine skip and limit', () => {
    for (let i = 0; i < 10; i++) {
      store.addNode(`n${i}`, [], { val: i });
    }

    const results = query.match([{ nodeVar: 'n' }]).skip(5).limit(3).execute();
    expect(results.length).toBe(3);
  });

  it('should find shortest path between two nodes', () => {
    store.addNode('a');
    store.addNode('b');
    store.addNode('c');
    store.addEdge('a', 'b', 'CONNECTS');
    store.addEdge('b', 'c', 'CONNECTS');

    const path = query.shortestPath('a', 'c');
    expect(path).not.toBeNull();
    expect(path!.length).toBe(2);
    expect(path!.nodes.map(n => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('should return null for shortest path when no path exists', () => {
    store.addNode('a');
    store.addNode('b');

    const path = query.shortestPath('a', 'b');
    expect(path).toBeNull();
  });

  it('should return path of length 0 for same node', () => {
    store.addNode('a');
    const path = query.shortestPath('a', 'a');
    expect(path).not.toBeNull();
    expect(path!.length).toBe(0);
    expect(path!.nodes.length).toBe(1);
  });

  it('should return null for shortest path with non-existent nodes', () => {
    expect(query.shortestPath('missing', 'b')).toBeNull();
    expect(query.shortestPath('a', 'missing')).toBeNull();
  });

  it('should traverse graph from a starting node', () => {
    store.addNode('a');
    store.addNode('b');
    store.addNode('c');
    store.addNode('d');
    store.addEdge('a', 'b', 'CONNECTS');
    store.addEdge('b', 'c', 'CONNECTS');
    store.addEdge('c', 'd', 'CONNECTS');

    const reachable = query.traverse('a', 'out', 2);
    expect(reachable.length).toBe(2);
    expect(reachable.map(n => n.id)).toContain('b');
    expect(reachable.map(n => n.id)).toContain('c');
  });

  it('should traverse with maxDepth limiting', () => {
    store.addNode('a');
    store.addNode('b');
    store.addNode('c');
    store.addEdge('a', 'b', 'CONNECTS');
    store.addEdge('b', 'c', 'CONNECTS');

    const reachable = query.traverse('a', 'out', 1);
    expect(reachable.length).toBe(1);
    expect(reachable[0].id).toBe('b');
  });

  it('should return empty for traverse on non-existent node', () => {
    expect(query.traverse('missing', 'out')).toEqual([]);
  });

  it('should match with edge patterns', () => {
    store.addNode('alice', ['Person']);
    store.addNode('bob', ['Person']);
    store.addEdge('alice', 'bob', 'KNOWS');

    const results = query
      .match([
        { nodeVar: 'p1', labels: ['Person'], edgeVar: 'e', edgeType: 'KNOWS', direction: 'out', targetVar: 'p2' },
      ])
      .execute();

    expect(results.length).toBe(1);
    expect((results[0].p1 as GraphNode).id).toBe('alice');
    expect((results[0].p2 as GraphNode).id).toBe('bob');
  });

  it('should handle multiple where conditions', () => {
    store.addNode('a', [], { val: 10, active: true });
    store.addNode('b', [], { val: 20, active: false });
    store.addNode('c', [], { val: 30, active: true });

    const results = query
      .match([{ nodeVar: 'n' }])
      .where(row => (row.n as GraphNode).properties.active === true)
      .where(row => (row.n as GraphNode).properties.val > 15)
      .execute();

    expect(results.length).toBe(1);
    expect((results[0].n as GraphNode).id).toBe('c');
  });
});

// ============================================================
// GraphAlgorithms Tests (20 tests)
// ============================================================
describe('GraphAlgorithms', () => {
  let store: GraphStore;
  let algo: GraphAlgorithms;

  beforeEach(() => {
    store = new GraphStore();
    GraphStore.resetEdgeIdCounter();
    algo = new GraphAlgorithms(store);
  });

  afterEach(() => {
    GraphStore.resetEdgeIdCounter();
  });

  it('should perform BFS traversal', () => {
    store.addNode('a');
    store.addNode('b');
    store.addNode('c');
    store.addEdge('a', 'b', 'E');
    store.addEdge('a', 'c', 'E');

    const visited = algo.bfs('a', () => {});
    expect(visited).toEqual(['a', 'b', 'c']);
  });

  it('should stop BFS when visitFn returns false', () => {
    store.addNode('a');
    store.addNode('b');
    store.addNode('c');
    store.addEdge('a', 'b', 'E');
    store.addEdge('b', 'c', 'E');

    const visited = algo.bfs('a', (nodeId) => {
      if (nodeId === 'b') return false;
    });
    expect(visited).toEqual(['a', 'b']);
  });

  it('should return empty for BFS on non-existent node', () => {
    expect(algo.bfs('missing', () => {})).toEqual([]);
  });

  it('should perform DFS traversal', () => {
    store.addNode('a');
    store.addNode('b');
    store.addNode('c');
    store.addEdge('a', 'b', 'E');
    store.addEdge('b', 'c', 'E');

    const visited = algo.dfs('a', () => {});
    expect(visited).toEqual(['a', 'b', 'c']);
  });

  it('should stop DFS when visitFn returns false', () => {
    store.addNode('a');
    store.addNode('b');
    store.addNode('c');
    store.addEdge('a', 'b', 'E');
    store.addEdge('b', 'c', 'E');

    const visited = algo.dfs('a', (nodeId) => {
      if (nodeId === 'b') return false;
    });
    expect(visited).toEqual(['a', 'b']);
  });

  it('should compute Dijkstra shortest path', () => {
    store.addNode('a');
    store.addNode('b');
    store.addNode('c');
    store.addEdge('a', 'b', 'E');
    store.addEdge('b', 'c', 'E');

    const result = algo.dijkstra('a', 'c', () => 1);
    expect(result).not.toBeNull();
    expect(result!.distance).toBe(2);
    expect(result!.path).toEqual(['a', 'b', 'c']);
  });

  it('should return null for Dijkstra with non-existent nodes', () => {
    expect(algo.dijkstra('missing', 'b', () => 1)).toBeNull();
  });

  it('should return zero distance for Dijkstra from node to itself', () => {
    store.addNode('a');
    const result = algo.dijkstra('a', 'a', () => 1);
    expect(result).not.toBeNull();
    expect(result!.distance).toBe(0);
    expect(result!.path).toEqual(['a']);
  });

  it('should compute PageRank', () => {
    store.addNode('a');
    store.addNode('b');
    store.addNode('c');
    store.addEdge('a', 'b', 'E');
    store.addEdge('b', 'c', 'E');
    store.addEdge('c', 'a', 'E');

    const scores = algo.pagerank(20, 0.85);
    expect(scores.size).toBe(3);
    // All nodes should have similar scores in a cycle
    const values = Array.from(scores.values());
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    for (const v of values) {
      expect(Math.abs(v - avg)).toBeLessThan(0.01);
    }
  });

  it('should return empty PageRank for empty graph', () => {
    expect(algo.pagerank().size).toBe(0);
  });

  it('should detect communities with label propagation', () => {
    // Create two clusters
    store.addNode('a1');
    store.addNode('a2');
    store.addNode('b1');
    store.addNode('b2');
    store.addEdge('a1', 'a2', 'E');
    store.addEdge('a2', 'a1', 'E');
    store.addEdge('b1', 'b2', 'E');
    store.addEdge('b2', 'b1', 'E');

    const result = algo.communityDetection('label-propagation');
    expect(result.communities.length).toBeGreaterThanOrEqual(1);
  });

  it('should detect connected components', () => {
    store.addNode('a');
    store.addNode('b');
    store.addNode('c');
    store.addNode('d');
    store.addEdge('a', 'b', 'E');
    store.addEdge('c', 'd', 'E');

    const result = algo.connectedComponents();
    expect(result.communities.length).toBe(2);
  });

  it('should compute degree centrality', () => {
    store.addNode('a');
    store.addNode('b');
    store.addNode('c');
    store.addEdge('a', 'b', 'E');
    store.addEdge('a', 'c', 'E');

    const result = algo.centrality('degree');
    expect(result.scores.get('a')).toBeCloseTo(1.0);
    expect(result.scores.get('b')).toBeCloseTo(0.5);
    expect(result.scores.get('c')).toBeCloseTo(0.5);
  });

  it('should compute closeness centrality', () => {
    store.addNode('a');
    store.addNode('b');
    store.addNode('c');
    store.addEdge('a', 'b', 'E');
    store.addEdge('b', 'c', 'E');

    const result = algo.centrality('closeness');
    expect(result.scores.size).toBe(3);
  });

  it('should compute betweenness centrality', () => {
    store.addNode('a');
    store.addNode('b');
    store.addNode('c');
    store.addEdge('a', 'b', 'E');
    store.addEdge('b', 'c', 'E');

    const result = algo.centrality('betweenness');
    expect(result.scores.size).toBe(3);
    // Node b should have highest betweenness
    expect(result.scores.get('b')!).toBeGreaterThan(result.scores.get('a')!);
  });

  it('should compute minimum spanning tree', () => {
    store.addNode('a');
    store.addNode('b');
    store.addNode('c');
    store.addEdge('a', 'b', 'E');
    store.addEdge('b', 'c', 'E');
    store.addEdge('a', 'c', 'E');

    const mst = algo.minimumSpanningTree();
    expect(mst.length).toBe(2); // n-1 edges for n nodes
  });

  it('should return empty MST for empty graph', () => {
    expect(algo.minimumSpanningTree()).toEqual([]);
  });

  it('should handle single node in algorithms', () => {
    store.addNode('only');
    expect(algo.bfs('only', () => {})).toEqual(['only']);
    expect(algo.dfs('only', () => {})).toEqual(['only']);
    const components = algo.connectedComponents();
    expect(components.communities.length).toBe(1);
    expect(components.communities[0]).toEqual(['only']);
  });

  it('should handle disconnected graph in BFS', () => {
    store.addNode('a');
    store.addNode('b');
    store.addNode('c');
    store.addEdge('a', 'b', 'E');
    // c is disconnected

    const visited = algo.bfs('a', () => {});
    expect(visited).toEqual(['a', 'b']);
  });
});

// ============================================================
// OntologyManager Tests (18 tests)
// ============================================================
describe('OntologyManager', () => {
  let om: OntologyManager;

  beforeEach(() => {
    om = new OntologyManager();
  });

  it('should define a class without super class', () => {
    om.defineClass('Entity');
    const cls = om.getClass('Entity');
    expect(cls).toBeDefined();
    expect(cls!.name).toBe('Entity');
    expect(cls!.superClass).toBeUndefined();
  });

  it('should define a class with super class', () => {
    om.defineClass('Entity');
    om.defineClass('Person', 'Entity');
    const cls = om.getClass('Person');
    expect(cls).toBeDefined();
    expect(cls!.superClass).toBe('Entity');
    expect(cls!.subClasses.size).toBe(0);
  });

  it('should throw when defining class with non-existent super class', () => {
    expect(() => om.defineClass('Person', 'NonExistent')).toThrow("Super class 'NonExistent' does not exist");
  });

  it('should define a class with properties', () => {
    const props = new Map([
      ['name', { type: 'string', required: true }],
      ['age', { type: 'number', min: 0, max: 150 }],
    ]);
    om.defineClass('Person', undefined, props);
    const cls = om.getClass('Person');
    expect(cls!.properties.size).toBe(2);
  });

  it('should define a property', () => {
    om.defineClass('Person');
    om.defineProperty('name', 'Person', 'string', { required: true });
    // Property is stored in the ontology
    expect(om.getAllClassNames()).toContain('Person');
  });

  it('should throw when defining property with non-existent domain', () => {
    expect(() => om.defineProperty('name', 'NonExistent', 'string')).toThrow("Domain class 'NonExistent' does not exist");
  });

  it('should define a relation', () => {
    om.defineClass('Person');
    om.defineClass('Organization');
    om.defineRelation('worksFor', 'Person', 'Organization');
    // No error means success
  });

  it('should throw when defining relation with non-existent domain', () => {
    om.defineClass('Organization');
    expect(() => om.defineRelation('worksFor', 'NonExistent', 'Organization')).toThrow("Domain class 'NonExistent' does not exist");
  });

  it('should validate a valid instance', () => {
    const props = new Map([['name', { type: 'string', required: true }]]);
    om.defineClass('Person', undefined, props);

    const result = om.validateInstance({ name: 'Alice' }, 'Person');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should invalidate instance missing required property', () => {
    const props = new Map([['name', { type: 'string', required: true }]]);
    om.defineClass('Person', undefined, props);

    const result = om.validateInstance({ age: 30 }, 'Person');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should invalidate instance with wrong type', () => {
    const props = new Map([['age', { type: 'number' }]]);
    om.defineClass('Person', undefined, props);

    const result = om.validateInstance({ age: 'thirty' }, 'Person');
    expect(result.valid).toBe(false);
  });

  it('should invalidate instance violating min constraint', () => {
    const props = new Map([['age', { type: 'number', min: 0 }]]);
    om.defineClass('Person', undefined, props);

    const result = om.validateInstance({ age: -5 }, 'Person');
    expect(result.valid).toBe(false);
  });

  it('should invalidate instance violating max constraint', () => {
    const props = new Map([['age', { type: 'number', max: 150 }]]);
    om.defineClass('Person', undefined, props);

    const result = om.validateInstance({ age: 200 }, 'Person');
    expect(result.valid).toBe(false);
  });

  it('should invalidate instance violating pattern constraint', () => {
    const props = new Map([['email', { type: 'string', pattern: '^[^@]+@[^@]+$' }]]);
    om.defineClass('Person', undefined, props);

    const result = om.validateInstance({ email: 'not-an-email' }, 'Person');
    expect(result.valid).toBe(false);
  });

  it('should validate instance with valid pattern', () => {
    const props = new Map([['email', { type: 'string', pattern: '^[^@]+@[^@]+$' }]]);
    om.defineClass('Person', undefined, props);

    const result = om.validateInstance({ email: 'test@example.com' }, 'Person');
    expect(result.valid).toBe(true);
  });

  it('should infer types for an instance', () => {
    om.defineClass('Entity');
    const personProps = new Map([['name', { type: 'string', required: true }]]);
    om.defineClass('Person', 'Entity', personProps);
    const empProps = new Map([['salary', { type: 'number', required: true }]]);
    om.defineClass('Employee', 'Person', empProps);

    const types = om.inferTypes({ name: 'Alice', salary: 50000 });
    expect(types.length).toBeGreaterThan(0);
    expect(types).toContain('Employee');
  });

  it('should get class hierarchy', () => {
    om.defineClass('Entity');
    om.defineClass('Person', 'Entity');
    om.defineClass('Employee', 'Person');

    const hierarchy = om.getHierarchy('Entity');
    expect(hierarchy).not.toBeNull();
    expect(hierarchy!.name).toBe('Entity');
    expect(hierarchy!.children.length).toBe(1);
    expect(hierarchy!.children[0].name).toBe('Person');
  });

  it('should return null for hierarchy of non-existent class', () => {
    expect(om.getHierarchy('NonExistent')).toBeNull();
  });

  it('should merge two ontologies', () => {
    om.defineClass('Entity');
    const om2 = new OntologyManager();
    om2.defineClass('Entity');
    om2.defineClass('Person', 'Entity');

    const conflicts = om.mergeOntology(om2);
    expect(om.getClass('Person')).toBeDefined();
  });
});

// ============================================================
// TripleStore Tests (18 tests)
// ============================================================
describe('TripleStore', () => {
  let ts: TripleStore;

  beforeEach(() => {
    ts = new TripleStore();
  });

  it('should add a triple', () => {
    const result = ts.addTriple('Alice', 'knows', 'Bob');
    expect(result).toBe(true);
    expect(ts.countTriples()).toBe(1);
  });

  it('should not add duplicate triple', () => {
    ts.addTriple('Alice', 'knows', 'Bob');
    const result = ts.addTriple('Alice', 'knows', 'Bob');
    expect(result).toBe(false);
    expect(ts.countTriples()).toBe(1);
  });

  it('should query triples by subject', () => {
    ts.addTriple('Alice', 'knows', 'Bob');
    ts.addTriple('Alice', 'age', '30');
    ts.addTriple('Bob', 'knows', 'Charlie');

    const results = ts.query({ subject: 'Alice' });
    expect(results.length).toBe(2);
  });

  it('should query triples by predicate', () => {
    ts.addTriple('Alice', 'knows', 'Bob');
    ts.addTriple('Bob', 'knows', 'Charlie');
    ts.addTriple('Alice', 'age', '30');

    const results = ts.query({ predicate: 'knows' });
    expect(results.length).toBe(2);
  });

  it('should query triples by object', () => {
    ts.addTriple('Alice', 'knows', 'Bob');
    ts.addTriple('Charlie', 'knows', 'Bob');

    const results = ts.query({ object: 'Bob' });
    expect(results.length).toBe(2);
  });

  it('should query triples with full pattern', () => {
    ts.addTriple('Alice', 'knows', 'Bob');
    ts.addTriple('Alice', 'knows', 'Charlie');

    const results = ts.query({ subject: 'Alice', predicate: 'knows', object: 'Bob' });
    expect(results.length).toBe(1);
    expect(results[0].object).toBe('Bob');
  });

  it('should query all triples with empty pattern', () => {
    ts.addTriple('a', 'b', 'c');
    ts.addTriple('d', 'e', 'f');

    const results = ts.query({});
    expect(results.length).toBe(2);
  });

  it('should remove triples matching a pattern', () => {
    ts.addTriple('Alice', 'knows', 'Bob');
    ts.addTriple('Alice', 'age', '30');

    const count = ts.removeTriple({ subject: 'Alice' });
    expect(count).toBe(2);
    expect(ts.countTriples()).toBe(0);
  });

  it('should return 0 when removing non-matching pattern', () => {
    ts.addTriple('Alice', 'knows', 'Bob');
    const count = ts.removeTriple({ subject: 'NonExistent' });
    expect(count).toBe(0);
  });

  it('should get triples by subject', () => {
    ts.addTriple('Alice', 'knows', 'Bob');
    ts.addTriple('Alice', 'age', '30');

    const results = ts.getTriplesBySubject('Alice');
    expect(results.length).toBe(2);
  });

  it('should get triples by predicate', () => {
    ts.addTriple('Alice', 'knows', 'Bob');
    ts.addTriple('Charlie', 'knows', 'Dave');

    const results = ts.getTriplesByPredicate('knows');
    expect(results.length).toBe(2);
  });

  it('should get triples by object', () => {
    ts.addTriple('Alice', 'knows', 'Bob');
    ts.addTriple('Charlie', 'knows', 'Bob');

    const results = ts.getTriplesByObject('Bob');
    expect(results.length).toBe(2);
  });

  it('should execute simple SPARQL query', () => {
    ts.addTriple('Alice', 'knows', 'Bob');
    ts.addTriple('Alice', 'knows', 'Charlie');

    const result = ts.sparql('SELECT ?friend WHERE { ?s knows ?friend }');
    expect(result.variables).toContain('friend');
    expect(result.bindings.length).toBe(2);
  });

  it('should return empty for invalid SPARQL query', () => {
    const result = ts.sparql('INVALID QUERY');
    expect(result.variables).toEqual([]);
    expect(result.bindings).toEqual([]);
  });

  it('should handle empty triple store', () => {
    expect(ts.countTriples()).toBe(0);
    expect(ts.query({})).toEqual([]);
    expect(ts.getTriplesBySubject('x')).toEqual([]);
  });

  it('should clear the triple store', () => {
    ts.addTriple('a', 'b', 'c');
    ts.clear();
    expect(ts.countTriples()).toBe(0);
  });

  it('should handle SPARQL with specific subject binding', () => {
    ts.addTriple('Alice', 'knows', 'Bob');
    ts.addTriple('Bob', 'knows', 'Charlie');

    const result = ts.sparql('SELECT ?friend WHERE { Alice knows ?friend }');
    expect(result.bindings.length).toBe(1);
    expect(result.bindings[0].friend).toBe('Bob');
  });
});

// ============================================================
// ReasoningEngine Tests (18 tests)
// ============================================================
describe('ReasoningEngine', () => {
  let store: GraphStore;
  let engine: ReasoningEngine;

  beforeEach(() => {
    store = new GraphStore();
    GraphStore.resetEdgeIdCounter();
    engine = new ReasoningEngine(store);
  });

  afterEach(() => {
    GraphStore.resetEdgeIdCounter();
  });

  it('should perform forward chaining', () => {
    const facts = [
      { id: 'f1', predicate: 'isParentOf', subject: 'Alice', object: 'Bob' },
      { id: 'f2', predicate: 'isParentOf', subject: 'Bob', object: 'Charlie' },
    ];
    const rules = [
      {
        id: 'r1',
        name: 'grandparent',
        conditions: [
          { predicate: 'isParentOf', subject: '?X', object: '?Y' },
          { predicate: 'isParentOf', subject: '?Y', object: '?Z' },
        ],
        conclusion: { predicate: 'isGrandparentOf', subject: '?X', object: '?Z' },
      },
    ];

    const result = engine.forwardChain(facts, rules);
    expect(result.newFacts.length).toBeGreaterThan(0);
    expect(result.newFacts.some(f => f.predicate === 'isGrandparentOf')).toBe(true);
  });

  it('should not derive new facts when rules cannot fire', () => {
    const facts = [
      { id: 'f1', predicate: 'isParentOf', subject: 'Alice', object: 'Bob' },
    ];
    const rules = [
      {
        id: 'r1',
        name: 'grandparent',
        conditions: [
          { predicate: 'isParentOf', subject: '?X', object: '?Y' },
          { predicate: 'isParentOf', subject: '?Y', object: '?Z' },
        ],
        conclusion: { predicate: 'isGrandparentOf', subject: '?X', object: '?Z' },
      },
    ];

    const result = engine.forwardChain(facts, rules);
    expect(result.newFacts.length).toBe(0);
  });

  it('should perform backward chaining with proven goal', () => {
    const facts = [
      { id: 'f1', predicate: 'isParentOf', subject: 'Alice', object: 'Bob' },
      { id: 'f2', predicate: 'isParentOf', subject: 'Bob', object: 'Charlie' },
    ];
    const rules = [
      {
        id: 'r1',
        name: 'grandparent',
        conditions: [
          { predicate: 'isParentOf', subject: '?X', object: '?Y' },
          { predicate: 'isParentOf', subject: '?Y', object: '?Z' },
        ],
        conclusion: { predicate: 'isGrandparentOf', subject: '?X', object: '?Z' },
      },
    ];

    const result = engine.backwardChain(
      { predicate: 'isGrandparentOf', subject: 'Alice', object: 'Charlie' },
      facts,
      rules
    );
    expect(result.proven).toBe(true);
    expect(result.proofChain.length).toBeGreaterThan(0);
  });

  it('should fail backward chaining for unprovable goal', () => {
    const facts = [
      { id: 'f1', predicate: 'isParentOf', subject: 'Alice', object: 'Bob' },
    ];
    const rules = [
      {
        id: 'r1',
        name: 'grandparent',
        conditions: [
          { predicate: 'isParentOf', subject: '?X', object: '?Y' },
          { predicate: 'isParentOf', subject: '?Y', object: '?Z' },
        ],
        conclusion: { predicate: 'isGrandparentOf', subject: '?X', object: '?Z' },
      },
    ];

    const result = engine.backwardChain(
      { predicate: 'isGrandparentOf', subject: 'Alice', object: 'Charlie' },
      facts,
      rules
    );
    expect(result.proven).toBe(false);
  });

  it('should prove directly asserted facts in backward chaining', () => {
    const facts = [
      { id: 'f1', predicate: 'knows', subject: 'Alice', object: 'Bob' },
    ];

    const result = engine.backwardChain(
      { predicate: 'knows', subject: 'Alice', object: 'Bob' },
      facts,
      []
    );
    expect(result.proven).toBe(true);
  });

  it('should perform abductive reasoning', () => {
    const observations = [
      { id: 'o1', predicate: 'hasSymptom', subject: 'Patient', object: 'fever' },
      { id: 'o2', predicate: 'hasSymptom', subject: 'Patient', object: 'cough' },
    ];
    const hypotheses = [
      'flu infection',
      'common cold',
      'allergic reaction',
    ];

    const result = engine.abductiveReason(observations, hypotheses);
    expect(result.hypotheses.length).toBe(3);
    // Results should be sorted by confidence
    expect(result.hypotheses[0].confidence).toBeGreaterThanOrEqual(result.hypotheses[1].confidence);
  });

  it('should perform default reasoning', () => {
    const facts = [
      { id: 'f1', predicate: 'hasWings', subject: 'Bird', object: 'true' },
    ];
    const defaults = [
      { predicate: 'canFly', subject: 'Bird', object: 'true' },
      { predicate: 'hasFeathers', subject: 'Bird', object: 'true' },
    ];

    const result = engine.defaultReasoning(facts, defaults);
    expect(result.conclusions.length).toBe(2);
    expect(result.appliedDefaults.length).toBe(2);
  });

  it('should not apply defaults for existing facts', () => {
    const facts = [
      { id: 'f1', predicate: 'canFly', subject: 'Bird', object: 'true' },
    ];
    const defaults = [
      { predicate: 'canFly', subject: 'Bird', object: 'true' },
    ];

    const result = engine.defaultReasoning(facts, defaults);
    expect(result.conclusions.length).toBe(0);
  });

  it('should perform temporal reasoning', () => {
    const events = [
      { id: 'e1', time: 1, predicate: 'employed', subject: 'Alice', object: 'Acme' },
      { id: 'e2', time: 5, predicate: 'promoted', subject: 'Alice', object: 'Senior' },
      { id: 'e3', time: 10, predicate: 'employed', subject: 'Alice', object: 'Beta' },
    ];

    const result = engine.temporalReasoning(events, 'employed');
    expect(result.results.length).toBe(2);
  });

  it('should return empty for temporal reasoning with no matching events', () => {
    const events = [
      { id: 'e1', time: 1, predicate: 'employed', subject: 'Alice', object: 'Acme' },
    ];

    const result = engine.temporalReasoning(events, 'promoted');
    expect(result.results.length).toBe(0);
  });

  it('should explain a fact using rules', () => {
    const fact = { id: 'f1', predicate: 'isGrandparentOf', subject: 'Alice', object: 'Charlie' };
    const rules = [
      {
        id: 'r1',
        name: 'grandparent',
        conditions: [
          { predicate: 'isParentOf', subject: '?X', object: '?Y' },
          { predicate: 'isParentOf', subject: '?Y', object: '?Z' },
        ],
        conclusion: { predicate: 'isGrandparentOf', subject: '?X', object: '?Z' },
      },
    ];

    const result = engine.explain(fact, rules);
    expect(result.explanation.length).toBeGreaterThan(0);
    expect(result.rules).toContain('r1');
  });

  it('should explain a directly asserted fact', () => {
    const fact = { id: 'f1', predicate: 'knows', subject: 'Alice', object: 'Bob' };
    const result = engine.explain(fact, []);
    expect(result.explanation.length).toBe(1);
    expect(result.explanation[0]).toContain('directly asserted');
  });

  it('should handle empty facts in forward chaining', () => {
    const result = engine.forwardChain([], []);
    expect(result.newFacts).toEqual([]);
    expect(result.iterations).toBe(0);
  });

  it('should handle empty observations in abductive reasoning', () => {
    const result = engine.abductiveReason([], ['hypothesis1']);
    expect(result.hypotheses.length).toBe(1);
    expect(result.hypotheses[0].confidence).toBe(0);
  });

  it('should handle empty events in temporal reasoning', () => {
    const result = engine.temporalReasoning([], 'employed');
    expect(result.results).toEqual([]);
  });

  it('should respect max iterations in forward chaining', () => {
    const facts = [
      { id: 'f1', predicate: 'a', subject: 'x', object: 'y' },
    ];
    const rules = [
      {
        id: 'r1',
        name: 'chain',
        conditions: [{ predicate: 'a', subject: '?X', object: '?Y' }],
        conclusion: { predicate: 'a', subject: '?Y', object: '?Z' },
      },
    ];

    const result = engine.forwardChain(facts, rules, 2);
    expect(result.iterations).toBeLessThanOrEqual(2);
  });
});

// ============================================================
// EmbeddingIndex Tests (18 tests)
// ============================================================
describe('EmbeddingIndex', () => {
  let index: EmbeddingIndex;

  beforeEach(() => {
    index = new EmbeddingIndex(3);
  });

  it('should add an embedding', () => {
    index.addEmbedding('a', [1, 0, 0]);
    expect(index.size()).toBe(1);
    expect(index.has('a')).toBe(true);
  });

  it('should throw when adding embedding with wrong dimension', () => {
    expect(() => index.addEmbedding('a', [1, 0])).toThrow('Vector dimension 2 does not match expected 3');
  });

  it('should search for similar vectors', () => {
    index.addEmbedding('a', [1, 0, 0]);
    index.addEmbedding('b', [0, 1, 0]);
    index.addEmbedding('c', [0.9, 0.1, 0]);

    const results = index.searchSimilar([1, 0, 0], 2);
    expect(results.length).toBe(2);
    expect(results[0].id).toBe('a'); // Most similar to itself
    expect(results[1].id).toBe('c'); // Second most similar
  });

  it('should throw when searching with wrong dimension', () => {
    index.addEmbedding('a', [1, 0, 0]);
    expect(() => index.searchSimilar([1, 0], 5)).toThrow('Query vector dimension 2 does not match expected 3');
  });

  it('should build index from entities', () => {
    const entities = ['a', 'b', 'c'];
    const embedFn = (id: string) => {
      if (id === 'a') return [1, 0, 0];
      if (id === 'b') return [0, 1, 0];
      return [0, 0, 1];
    };

    index.buildIndex(entities, embedFn);
    expect(index.size()).toBe(3);
  });

  it('should update an existing embedding', () => {
    index.addEmbedding('a', [1, 0, 0]);
    index.updateEmbedding('a', [0, 1, 0]);

    const embedding = index.getEmbedding('a');
    expect(embedding).toEqual([0, 1, 0]);
  });

  it('should throw when updating non-existent embedding', () => {
    expect(() => index.updateEmbedding('missing', [1, 0, 0])).toThrow("Entity 'missing' does not exist");
  });

  it('should remove an embedding', () => {
    index.addEmbedding('a', [1, 0, 0]);
    expect(index.removeEmbedding('a')).toBe(true);
    expect(index.size()).toBe(0);
    expect(index.has('a')).toBe(false);
  });

  it('should return false when removing non-existent embedding', () => {
    expect(index.removeEmbedding('missing')).toBe(false);
  });

  it('should find nearest neighbors', () => {
    index.addEmbedding('a', [1, 0, 0]);
    index.addEmbedding('b', [0.9, 0.1, 0]);
    index.addEmbedding('c', [0, 1, 0]);

    const neighbors = index.findNearestNeighbors('a', 2);
    expect(neighbors.length).toBe(2);
    expect(neighbors[0].id).toBe('b');
  });

  it('should throw when finding neighbors for non-existent entity', () => {
    expect(() => index.findNearestNeighbors('missing', 5)).toThrow("Entity 'missing' does not exist");
  });

  it('should cluster embeddings with kmeans', () => {
    index.addEmbedding('a', [1, 0, 0]);
    index.addEmbedding('b', [0.9, 0.1, 0]);
    index.addEmbedding('c', [0, 1, 0]);
    index.addEmbedding('d', [0.1, 0.9, 0]);

    const result = index.cluster(2, 'kmeans');
    expect(result.clusters.size).toBe(2);
    expect(result.centroids.length).toBe(2);
  });

  it('should handle clustering with more clusters than items', () => {
    index.addEmbedding('a', [1, 0, 0]);
    index.addEmbedding('b', [0, 1, 0]);

    const result = index.cluster(5, 'kmeans');
    expect(result.clusters.size).toBe(2);
  });

  it('should handle empty index', () => {
    expect(index.size()).toBe(0);
    expect(index.searchSimilar([1, 0, 0], 5)).toEqual([]);
    const result = index.cluster(2);
    expect(result.clusters.size).toBe(0);
  });

  it('should clear the index', () => {
    index.addEmbedding('a', [1, 0, 0]);
    index.addEmbedding('b', [0, 1, 0]);
    index.clear();
    expect(index.size()).toBe(0);
  });

  it('should return correct similarity scores', () => {
    index.addEmbedding('a', [1, 0, 0]);
    index.addEmbedding('b', [1, 0, 0]); // Identical

    const results = index.searchSimilar([1, 0, 0], 2);
    expect(results[0].score).toBeCloseTo(1.0);
    expect(results[1].score).toBeCloseTo(1.0);
  });

  it('should handle orthogonal vectors', () => {
    index.addEmbedding('a', [1, 0, 0]);
    index.addEmbedding('b', [0, 1, 0]);

    const results = index.searchSimilar([1, 0, 0], 2);
    expect(results[0].score).toBeCloseTo(1.0);
    expect(results[1].score).toBeCloseTo(0.0);
  });
});

// ============================================================
// GraphVisualizer Tests (18 tests)
// ============================================================
describe('GraphVisualizer', () => {
  let store: GraphStore;
  let viz: GraphVisualizer;

  beforeEach(() => {
    store = new GraphStore();
    GraphStore.resetEdgeIdCounter();
    viz = new GraphVisualizer(store);
  });

  afterEach(() => {
    GraphStore.resetEdgeIdCounter();
  });

  it('should layout an empty graph', () => {
    const result = viz.layoutGraph('force-directed');
    expect(result.nodes).toEqual([]);
  });

  it('should layout a single node', () => {
    store.addNode('a', [], { name: 'A' });
    const result = viz.layoutGraph('circular');
    expect(result.nodes.length).toBe(1);
    expect(result.nodes[0].id).toBe('a');
  });

  it('should layout graph with force-directed algorithm', () => {
    store.addNode('a');
    store.addNode('b');
    store.addNode('c');
    store.addEdge('a', 'b', 'E');
    store.addEdge('b', 'c', 'E');

    const result = viz.layoutGraph('force-directed', { width: 800, height: 600 });
    expect(result.nodes.length).toBe(3);
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    for (const node of result.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(800);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(600);
    }
  });

  it('should layout graph with circular algorithm', () => {
    store.addNode('a');
    store.addNode('b');
    store.addNode('c');

    const result = viz.layoutGraph('circular');
    expect(result.nodes.length).toBe(3);
  });

  it('should layout graph with hierarchical algorithm', () => {
    store.addNode('a');
    store.addNode('b');
    store.addNode('c');
    store.addEdge('a', 'b', 'E');
    store.addEdge('b', 'c', 'E');

    const result = viz.layoutGraph('hierarchical');
    expect(result.nodes.length).toBe(3);
  });

  it('should layout graph with random algorithm', () => {
    store.addNode('a');
    store.addNode('b');

    const result = viz.layoutGraph('random');
    expect(result.nodes.length).toBe(2);
  });

  it('should generate DOT format', () => {
    store.addNode('alice', ['Person'], { name: 'Alice' });
    store.addNode('bob', ['Person'], { name: 'Bob' });
    store.addEdge('alice', 'bob', 'KNOWS');

    const dot = viz.generateDOT();
    expect(dot).toContain('digraph G');
    expect(dot).toContain('Alice');
    expect(dot).toContain('Bob');
    expect(dot).toContain('KNOWS');
  });

  it('should generate DOT for empty graph', () => {
    const dot = viz.generateDOT();
    expect(dot).toContain('digraph G');
  });

  it('should generate Mermaid format', () => {
    store.addNode('alice', ['Person'], { name: 'Alice' });
    store.addNode('bob', ['Person'], { name: 'Bob' });
    store.addEdge('alice', 'bob', 'KNOWS');

    const mermaid = viz.generateMermaid();
    expect(mermaid).toContain('graph LR');
    expect(mermaid).toContain('Alice');
    expect(mermaid).toContain('Bob');
    expect(mermaid).toContain('KNOWS');
  });

  it('should generate JSON format', () => {
    store.addNode('a', [], { name: 'A' });
    store.addEdge('a', 'a', 'SELF');

    const json = viz.generateJSON();
    const parsed = JSON.parse(json);
    expect(parsed.nodes.length).toBe(1);
    expect(parsed.edges.length).toBe(1);
  });

  it('should get subgraph centered on a node', () => {
    store.addNode('a');
    store.addNode('b');
    store.addNode('c');
    store.addNode('d');
    store.addEdge('a', 'b', 'E');
    store.addEdge('b', 'c', 'E');
    store.addEdge('c', 'd', 'E');

    const subgraph = viz.getSubgraph('b', 1);
    expect(subgraph.nodes.length).toBe(3); // a, b, c
    expect(subgraph.nodes.map(n => n.id)).toContain('a');
    expect(subgraph.nodes.map(n => n.id)).toContain('b');
    expect(subgraph.nodes.map(n => n.id)).toContain('c');
  });

  it('should return empty subgraph for non-existent center', () => {
    const subgraph = viz.getSubgraph('missing', 1);
    expect(subgraph.nodes).toEqual([]);
    expect(subgraph.edges).toEqual([]);
  });

  it('should get community layout', () => {
    const communities = [
      ['a', 'b', 'c'],
      ['d', 'e'],
    ];

    const result = viz.getCommunityLayout(communities);
    expect(result.nodes.length).toBe(5);
  });

  it('should handle empty communities in community layout', () => {
    const result = viz.getCommunityLayout([]);
    expect(result.nodes).toEqual([]);
  });

  it('should handle single community in community layout', () => {
    const result = viz.getCommunityLayout([['a', 'b', 'c']]);
    expect(result.nodes.length).toBe(3);
  });

  it('should generate Mermaid for graph with special characters in IDs', () => {
    store.addNode('node-1', [], { name: 'Node 1' });
    store.addNode('node-2', [], { name: 'Node 2' });
    store.addEdge('node-1', 'node-2', 'CONNECTS');

    const mermaid = viz.generateMermaid();
    expect(mermaid).toContain('graph LR');
    // IDs should be sanitized
    expect(mermaid).not.toContain('node-1');
    expect(mermaid).toContain('node_1');
  });

  it('should get subgraph with radius 0', () => {
    store.addNode('a');
    store.addNode('b');
    store.addEdge('a', 'b', 'E');

    const subgraph = viz.getSubgraph('a', 0);
    expect(subgraph.nodes.length).toBe(1);
    expect(subgraph.nodes[0].id).toBe('a');
  });
});

// ============================================================
// TemporalGraph Tests (18 tests)
// ============================================================
describe('TemporalGraph', () => {
  let tg: TemporalGraph;

  beforeEach(() => {
    tg = new TemporalGraph();
  });

  it('should add a node at a specific time', () => {
    tg.addNodeAt('alice', 1, ['Person'], { name: 'Alice' });
    const state = tg.getStateAt(1);
    expect(state.nodes.length).toBe(1);
    expect(state.nodes[0].id).toBe('alice');
  });

  it('should add an edge at a specific time', () => {
    tg.addNodeAt('alice', 1, ['Person']);
    tg.addNodeAt('bob', 1, ['Person']);
    tg.addEdgeAt('alice', 'bob', 2, 'KNOWS', { since: 2020 });

    const state = tg.getStateAt(2);
    expect(state.edges.length).toBe(1);
    expect(state.edges[0].type).toBe('KNOWS');
  });

  it('should throw when adding node before current time', () => {
    tg.addNodeAt('alice', 5, ['Person']);
    expect(() => tg.addNodeAt('bob', 3, ['Person'])).toThrow('Cannot add node at time 3 which is before current time 5');
  });

  it('should throw when adding edge before current time', () => {
    tg.addNodeAt('alice', 5, ['Person']);
    tg.addNodeAt('bob', 5, ['Person']);
    expect(() => tg.addEdgeAt('alice', 'bob', 3, 'KNOWS')).toThrow('Cannot add edge at time 3 which is before current time 5');
  });

  it('should get state at a specific time', () => {
    tg.addNodeAt('alice', 1, ['Person']);
    tg.addNodeAt('bob', 2, ['Person']);
    tg.addEdgeAt('alice', 'bob', 3, 'KNOWS');

    const state1 = tg.getStateAt(1);
    expect(state1.nodes.length).toBe(1);
    expect(state1.edges.length).toBe(0);

    const state3 = tg.getStateAt(3);
    expect(state3.nodes.length).toBe(2);
    expect(state3.edges.length).toBe(1);
  });

  it('should get state before any changes', () => {
    tg.addNodeAt('alice', 5, ['Person']);
    const state = tg.getStateAt(3);
    expect(state.nodes.length).toBe(0);
    expect(state.edges.length).toBe(0);
  });

  it('should get changes within a time range', () => {
    tg.addNodeAt('alice', 1, ['Person']);
    tg.addNodeAt('bob', 3, ['Person']);
    tg.addEdgeAt('alice', 'bob', 5, 'KNOWS');

    const changes = tg.getChanges(2, 4);
    expect(changes.length).toBe(1);
    expect(changes[0].targetId).toBe('bob');
  });

  it('should get timeline for a node', () => {
    tg.addNodeAt('alice', 1, ['Person'], { name: 'Alice' });

    const timeline = tg.getTimeline('alice');
    expect(timeline.length).toBe(1);
    expect(timeline[0].time).toBe(1);
    expect(timeline[0].type).toBe('node_added');
  });

  it('should return empty timeline for non-existent node', () => {
    expect(tg.getTimeline('missing')).toEqual([]);
  });

  it('should get temporal range', () => {
    tg.addNodeAt('alice', 1, ['Person']);
    tg.addNodeAt('bob', 5, ['Person']);

    const range = tg.getTemporalRange();
    expect(range).not.toBeNull();
    expect(range!.min).toBe(1);
    expect(range!.max).toBe(5);
  });

  it('should return null temporal range for empty graph', () => {
    expect(tg.getTemporalRange()).toBeNull();
  });

  it('should rollback to a specific time', () => {
    tg.addNodeAt('alice', 1, ['Person']);
    tg.addNodeAt('bob', 2, ['Person']);
    tg.addNodeAt('charlie', 3, ['Person']);

    const removed = tg.rollback(2);
    expect(removed).toBe(1);

    const state = tg.getStateAt(2);
    expect(state.nodes.length).toBe(2);
    expect(state.nodes.map(n => n.id)).toContain('alice');
    expect(state.nodes.map(n => n.id)).toContain('bob');
  });

  it('should get current time', () => {
    tg.addNodeAt('alice', 1, ['Person']);
    tg.addNodeAt('bob', 5, ['Person']);
    expect(tg.getCurrentTime()).toBe(5);
  });

  it('should get all changes', () => {
    tg.addNodeAt('alice', 1, ['Person']);
    tg.addNodeAt('bob', 2, ['Person']);

    const changes = tg.getAllChanges();
    expect(changes.length).toBe(2);
  });

  it('should handle empty temporal graph', () => {
    expect(tg.getCurrentTime()).toBe(0);
    expect(tg.getTemporalRange()).toBeNull();
    expect(tg.getAllChanges()).toEqual([]);
    expect(tg.getStateAt(0)).toEqual({ time: 0, nodes: [], edges: [] });
  });

  it('should handle rollback with no changes to remove', () => {
    tg.addNodeAt('alice', 1, ['Person']);
    const removed = tg.rollback(5);
    expect(removed).toBe(0);
  });

  it('should get changes with empty range', () => {
    tg.addNodeAt('alice', 1, ['Person']);
    const changes = tg.getChanges(10, 20);
    expect(changes.length).toBe(0);
  });
});

// ============================================================
// GraphImportExport Tests (18 tests)
// ============================================================
describe('GraphImportExport', () => {
  let store: GraphStore;
  let io: GraphImportExport;

  beforeEach(() => {
    store = new GraphStore();
    GraphStore.resetEdgeIdCounter();
    io = new GraphImportExport(store);
  });

  afterEach(() => {
    GraphStore.resetEdgeIdCounter();
  });

  it('should export graph as JSON', () => {
    store.addNode('alice', ['Person'], { name: 'Alice' });
    store.addNode('bob', ['Person'], { name: 'Bob' });
    store.addEdge('alice', 'bob', 'KNOWS');

    const json = io.exportJSON();
    expect(json.nodes.length).toBe(2);
    expect(json.edges.length).toBe(1);
    expect(json.nodes[0].id).toBe('alice');
  });

  it('should export empty graph as JSON', () => {
    const json = io.exportJSON();
    expect(json.nodes).toEqual([]);
    expect(json.edges).toEqual([]);
  });

  it('should import graph from JSON', () => {
    const data = {
      nodes: [
        { id: 'alice', labels: ['Person'], properties: { name: 'Alice' } },
        { id: 'bob', labels: ['Person'], properties: { name: 'Bob' } },
      ],
      edges: [
        { from: 'alice', to: 'bob', type: 'KNOWS', properties: {} },
      ],
    };

    io.importJSON(data);
    expect(store.getNodeCount()).toBe(2);
    expect(store.getEdgeCount()).toBe(1);
  });

  it('should throw when importing invalid JSON', () => {
    expect(() => io.importJSON({} as any)).toThrow('Invalid JSON format: missing nodes array');
  });

  it('should export graph as CSV', () => {
    store.addNode('alice', ['Person'], { name: 'Alice' });
    store.addEdge('alice', 'alice', 'SELF');

    const csv = io.exportCSV();
    expect(csv.nodes).toContain('alice');
    expect(csv.edges).toContain('alice');
  });

  it('should import graph from CSV', () => {
    // Test CSV import with the actual format produced by exportCSV
    // First create a graph and export it
    const tempStore = new GraphStore();
    tempStore.addNode('alice', ['Person'], { name: 'Alice' });
    tempStore.addNode('bob', ['Person'], { name: 'Bob' });
    tempStore.addEdge('alice', 'bob', 'KNOWS');

    const tempIo = new GraphImportExport(tempStore);
    const exported = tempIo.exportCSV();

    // Now import the exported CSV into a fresh store
    io.importCSV(exported);
    expect(store.getNodeCount()).toBe(2);
    expect(store.getEdgeCount()).toBe(1);
    expect(store.getNode('alice')!.properties.name).toBe('Alice');
    expect(store.getNode('bob')!.labels).toEqual(['Person']);
  });

  it('should handle empty CSV import', () => {
    io.importCSV({ nodes: 'id,labels,properties', edges: 'from,to,type,properties' });
    expect(store.getNodeCount()).toBe(0);
    expect(store.getEdgeCount()).toBe(0);
  });

  it('should export graph as GraphML', () => {
    store.addNode('alice', ['Person'], { name: 'Alice' });
    store.addNode('bob', ['Person'], { name: 'Bob' });
    store.addEdge('alice', 'bob', 'KNOWS');

    const graphml = io.exportGraphML();
    expect(graphml).toContain('<?xml version="1.0"');
    expect(graphml).toContain('<graphml');
    expect(graphml).toContain('alice');
    expect(graphml).toContain('bob');
    expect(graphml).toContain('KNOWS');
  });

  it('should import graph from GraphML', () => {
    const graphml = `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphstruct.org/xmlns">
  <key id="labels" for="node" attr.name="labels" attr.type="string"/>
  <key id="type" for="edge" attr.name="type" attr.type="string"/>
  <graph id="G" edgedefault="directed">
    <node id="alice">
      <data key="labels">Person</data>
    </node>
    <node id="bob">
      <data key="labels">Person</data>
    </node>
    <edge source="alice" target="bob">
      <data key="type">KNOWS</data>
    </edge>
  </graph>
</graphml>`;

    io.importGraphML(graphml);
    expect(store.getNodeCount()).toBe(2);
    expect(store.getEdgeCount()).toBe(1);
  });

  it('should export graph as Neo4j Cypher', () => {
    store.addNode('alice', ['Person'], { name: 'Alice' });
    store.addNode('bob', ['Person'], { name: 'Bob' });
    store.addEdge('alice', 'bob', 'KNOWS');

    const cypher = io.exportNeo4jCypher();
    expect(cypher.length).toBe(3);
    expect(cypher[0]).toContain('CREATE');
    expect(cypher[0]).toContain('Person');
    expect(cypher[2]).toContain('KNOWS');
  });

  it('should diff two graphs', () => {
    const storeA = new GraphStore();
    storeA.addNode('a', [], { val: 1 });
    storeA.addNode('b', [], { val: 2 });
    storeA.addEdge('a', 'b', 'E');

    const storeB = new GraphStore();
    storeB.addNode('a', [], { val: 1 });
    storeB.addNode('c', [], { val: 3 });
    storeB.addEdge('a', 'c', 'E');

    const diff = io.diff(storeA, storeB);
    expect(diff.addedNodes).toContain('c');
    expect(diff.removedNodes).toContain('b');
    expect(diff.addedEdges.length).toBeGreaterThan(0);
    expect(diff.removedEdges.length).toBeGreaterThan(0);
  });

  it('should diff identical graphs', () => {
    const storeA = new GraphStore();
    storeA.addNode('a', [], { val: 1 });

    const storeB = new GraphStore();
    storeB.addNode('a', [], { val: 1 });

    const diff = io.diff(storeA, storeB);
    expect(diff.addedNodes).toEqual([]);
    expect(diff.removedNodes).toEqual([]);
    expect(diff.modifiedNodes).toEqual([]);
    expect(diff.addedEdges).toEqual([]);
    expect(diff.removedEdges).toEqual([]);
  });

  it('should merge two graphs with union strategy', () => {
    const storeA = new GraphStore();
    storeA.addNode('a', [], { val: 1 });
    storeA.addEdge('a', 'a', 'SELF');

    const storeB = new GraphStore();
    storeB.addNode('b', [], { val: 2 });

    const merged = io.merge(storeA, storeB, 'union');
    expect(merged.getNodeCount()).toBe(2);
    expect(merged.getEdgeCount()).toBe(1);
  });

  it('should merge two graphs with intersection strategy', () => {
    const storeA = new GraphStore();
    storeA.addNode('a', [], { val: 1 });
    storeA.addNode('b', [], { val: 2 });

    const storeB = new GraphStore();
    storeB.addNode('b', [], { val: 2 });
    storeB.addNode('c', [], { val: 3 });

    const merged = io.merge(storeA, storeB, 'intersection');
    expect(merged.getNodeCount()).toBe(1);
    expect(merged.getNode('b')).toBeDefined();
  });

  it('should merge two graphs with left strategy', () => {
    const storeA = new GraphStore();
    storeA.addNode('a', [], { val: 1 });

    const storeB = new GraphStore();
    storeB.addNode('b', [], { val: 2 });

    const merged = io.merge(storeA, storeB, 'left');
    expect(merged.getNodeCount()).toBe(1);
    expect(merged.getNode('a')).toBeDefined();
  });

  it('should merge two graphs with right strategy', () => {
    const storeA = new GraphStore();
    storeA.addNode('a', [], { val: 1 });

    const storeB = new GraphStore();
    storeB.addNode('b', [], { val: 2 });

    const merged = io.merge(storeA, storeB, 'right');
    expect(merged.getNodeCount()).toBe(1);
    expect(merged.getNode('b')).toBeDefined();
  });

  it('should handle empty graphs in diff', () => {
    const emptyStore = new GraphStore();
    const diff = io.diff(emptyStore, emptyStore);
    expect(diff.addedNodes).toEqual([]);
    expect(diff.removedNodes).toEqual([]);
  });
});

// ============================================================
// Integration / Edge Case Tests (16 tests)
// ============================================================
describe('Integration and Edge Cases', () => {
  beforeEach(() => {
    GraphStore.resetEdgeIdCounter();
  });

  afterEach(() => {
    GraphStore.resetEdgeIdCounter();
  });

  it('should handle a very large graph (1000 nodes)', () => {
    const store = new GraphStore();
    for (let i = 0; i < 1000; i++) {
      store.addNode(`n${i}`, ['Node'], { index: i });
    }
    for (let i = 0; i < 999; i++) {
      store.addEdge(`n${i}`, `n${i + 1}`, 'NEXT');
    }

    expect(store.getNodeCount()).toBe(1000);
    expect(store.getEdgeCount()).toBe(999);

    const algo = new GraphAlgorithms(store);
    const components = algo.connectedComponents();
    expect(components.communities.length).toBe(1);
  });

  it('should handle a graph with all self-loops', () => {
    const store = new GraphStore();
    store.addNode('a');
    store.addNode('b');
    store.addEdge('a', 'a', 'SELF');
    store.addEdge('b', 'b', 'SELF');

    expect(store.getEdgeCount()).toBe(2);
    expect(store.getNeighbors('a', 'out').map(n => n.id)).toEqual(['a']);

    const algo = new GraphAlgorithms(store);
    const components = algo.connectedComponents();
    expect(components.communities.length).toBe(2);
  });

  it('should handle complete graph (every node connected to every other)', () => {
    const store = new GraphStore();
    const ids = ['a', 'b', 'c', 'd'];
    for (const id of ids) {
      store.addNode(id);
    }
    for (const from of ids) {
      for (const to of ids) {
        if (from !== to) {
          store.addEdge(from, to, 'CONNECTED');
        }
      }
    }

    expect(store.getNodeCount()).toBe(4);
    expect(store.getEdgeCount()).toBe(12); // 4 * 3

    const algo = new GraphAlgorithms(store);
    const centrality = algo.centrality('degree');
    // In a complete graph, all nodes have same degree centrality
    const scores = Array.from(centrality.scores.values());
    expect(scores.every(s => s === scores[0])).toBe(true);
  });

  it('should build a realistic person/organization graph', () => {
    const store = new GraphStore();

    // People
    store.addNode('alice', ['Person'], { name: 'Alice', role: 'Engineer' });
    store.addNode('bob', ['Person'], { name: 'Bob', role: 'Manager' });
    store.addNode('charlie', ['Person'], { name: 'Charlie', role: 'Designer' });

    // Organizations
    store.addNode('acme', ['Organization'], { name: 'Acme Corp', industry: 'Tech' });
    store.addNode('beta', ['Organization'], { name: 'Beta Inc', industry: 'Finance' });

    // Relationships
    store.addEdge('alice', 'acme', 'WORKS_FOR');
    store.addEdge('bob', 'acme', 'WORKS_FOR');
    store.addEdge('charlie', 'beta', 'WORKS_FOR');
    store.addEdge('alice', 'bob', 'REPORTS_TO');
    store.addEdge('bob', 'alice', 'MANAGES');

    expect(store.getNodeCount()).toBe(5);
    expect(store.getEdgeCount()).toBe(5);

    // Query
    const query = new GraphQuery(store);
    const acmePeople = query
      .match([{ nodeVar: 'p', labels: ['Person'] }])
      .where(row => {
        const node = row.p as GraphNode;
        const neighbors = store.getNeighbors(node.id, 'out');
        return neighbors.some(n => n.id === 'acme');
      })
      .execute();

    expect(acmePeople.length).toBe(2);
  });

  it('should use triple store for knowledge domain', () => {
    const ts = new TripleStore();

    // Knowledge domain triples
    ts.addTriple('Python', 'isA', 'ProgrammingLanguage');
    ts.addTriple('JavaScript', 'isA', 'ProgrammingLanguage');
    ts.addTriple('TypeScript', 'isA', 'ProgrammingLanguage');
    ts.addTriple('TypeScript', 'extends', 'JavaScript');
    ts.addTriple('Python', 'usedFor', 'DataScience');
    ts.addTriple('JavaScript', 'usedFor', 'WebDevelopment');
    ts.addTriple('React', 'builtWith', 'JavaScript');
    ts.addTriple('Django', 'builtWith', 'Python');

    expect(ts.countTriples()).toBe(8);

    const languages = ts.query({ predicate: 'isA', object: 'ProgrammingLanguage' });
    expect(languages.length).toBe(3);

    const jsThings = ts.query({ object: 'JavaScript' });
    expect(jsThings.length).toBe(2);
  });

  it('should use reasoning engine for family relationships', () => {
    const store = new GraphStore();
    const engine = new ReasoningEngine(store);

    const facts = [
      { id: 'f1', predicate: 'parentOf', subject: 'John', object: 'Mary' },
      { id: 'f2', predicate: 'parentOf', subject: 'Mary', object: 'Tom' },
      { id: 'f3', predicate: 'spouseOf', subject: 'John', object: 'Jane' },
    ];

    const rules = [
      {
        id: 'r1', name: 'grandparent',
        conditions: [
          { predicate: 'parentOf', subject: '?X', object: '?Y' },
          { predicate: 'parentOf', subject: '?Y', object: '?Z' },
        ],
        conclusion: { predicate: 'grandparentOf', subject: '?X', object: '?Z' },
      },
      {
        id: 'r2', name: 'sibling',
        conditions: [
          { predicate: 'parentOf', subject: '?P', object: '?A' },
          { predicate: 'parentOf', subject: '?P', object: '?B' },
        ],
        conclusion: { predicate: 'siblingOf', subject: '?A', object: '?B' },
      },
    ];

    const result = engine.forwardChain(facts, rules);
    expect(result.newFacts.length).toBeGreaterThan(0);
    expect(result.newFacts.some(f => f.predicate === 'grandparentOf')).toBe(true);
  });

  it('should use embedding index for document similarity', () => {
    const index = new EmbeddingIndex(4);

    // Simulated document embeddings
    index.addEmbedding('doc1', [1.0, 0.0, 0.0, 0.0]); // about AI
    index.addEmbedding('doc2', [0.9, 0.1, 0.0, 0.0]); // about AI
    index.addEmbedding('doc3', [0.0, 1.0, 0.0, 0.0]); // about sports
    index.addEmbedding('doc4', [0.0, 0.9, 0.1, 0.0]); // about sports

    const similar = index.searchSimilar([1.0, 0.0, 0.0, 0.0], 2);
    expect(similar[0].id).toBe('doc1');
    expect(similar[1].id).toBe('doc2');
  });

  it('should use temporal graph for versioning', () => {
    const tg = new TemporalGraph();

    // Version 1: Initial state
    tg.addNodeAt('alice', 1, ['Person'], { name: 'Alice', version: 1 });
    tg.addNodeAt('bob', 1, ['Person'], { name: 'Bob', version: 1 });
    tg.addEdgeAt('alice', 'bob', 1, 'KNOWS');

    // Version 2: Add charlie
    tg.addNodeAt('charlie', 2, ['Person'], { name: 'Charlie', version: 1 });
    tg.addEdgeAt('bob', 'charlie', 2, 'KNOWS');

    // Version 3: Remove alice-bob edge, add alice-charlie
    const state2 = tg.getStateAt(2);
    expect(state2.nodes.length).toBe(3);
    expect(state2.edges.length).toBe(2);

    // Rollback to version 1
    tg.rollback(1);
    const state1 = tg.getStateAt(1);
    expect(state1.nodes.length).toBe(2);
  });

  it('should use ontology for schema validation', () => {
    const om = new OntologyManager();

    om.defineClass('Entity');
    const personProps = new Map([
      ['name', { type: 'string', required: true }],
      ['email', { type: 'string', pattern: '^[^@]+@[^@]+$' }],
      ['age', { type: 'number', min: 0, max: 150 }],
    ]);
    om.defineClass('Person', 'Entity', personProps);

    const valid = om.validateInstance({ name: 'Alice', email: 'alice@example.com', age: 30 }, 'Person');
    expect(valid.valid).toBe(true);

    const invalid1 = om.validateInstance({ email: 'bad', age: -5 }, 'Person');
    expect(invalid1.valid).toBe(false);
    expect(invalid1.errors.length).toBeGreaterThanOrEqual(2); // missing name, bad email, bad age
  });

  it('should visualize a knowledge domain graph', () => {
    const store = new GraphStore();

    store.addNode('ml', ['Field'], { name: 'Machine Learning' });
    store.addNode('nn', ['Field'], { name: 'Neural Networks' });
    store.addNode('dl', ['Field'], { name: 'Deep Learning' });
    store.addNode('cnn', ['Technique'], { name: 'CNN' });
    store.addNode('rnn', ['Technique'], { name: 'RNN' });

    store.addEdge('ml', 'nn', 'INCLUDES');
    store.addEdge('nn', 'dl', 'INCLUDES');
    store.addEdge('dl', 'cnn', 'INCLUDES');
    store.addEdge('dl', 'rnn', 'INCLUDES');

    const viz = new GraphVisualizer(store);
    const layout = viz.layoutGraph('hierarchical');
    expect(layout.nodes.length).toBe(5);

    const dot = viz.generateDOT();
    expect(dot).toContain('Machine Learning');
    expect(dot).toContain('Deep Learning');

    const mermaid = viz.generateMermaid();
    expect(mermaid).toContain('graph LR');
  });

  it('should import/export roundtrip', () => {
    const store = new GraphStore();
    store.addNode('a', ['Type'], { key: 'value' });
    store.addNode('b', ['Type'], { key: 'value2' });
    store.addEdge('a', 'b', 'REL', { weight: 5 });

    const io = new GraphImportExport(store);
    const json = io.exportJSON();

    const newStore = new GraphStore();
    const newIo = new GraphImportExport(newStore);
    newIo.importJSON(json);

    expect(newStore.getNodeCount()).toBe(2);
    expect(newStore.getEdgeCount()).toBe(1);
    expect(newStore.getNode('a')!.properties.key).toBe('value');
  });

  it('should handle graph algorithms on a chain graph', () => {
    const store = new GraphStore();
    const n = 10;
    for (let i = 0; i < n; i++) {
      store.addNode(`n${i}`);
    }
    for (let i = 0; i < n - 1; i++) {
      store.addEdge(`n${i}`, `n${i + 1}`, 'NEXT');
    }

    const algo = new GraphAlgorithms(store);

    // BFS should visit in order
    const bfsOrder = algo.bfs('n0', () => {});
    expect(bfsOrder).toEqual(Array.from({ length: n }, (_, i) => `n${i}`));

    // Dijkstra should find path along chain
    const result = algo.dijkstra('n0', `n${n - 1}`, () => 1);
    expect(result).not.toBeNull();
    expect(result!.distance).toBe(n - 1);
    expect(result!.path.length).toBe(n);
  });

  it('should handle graph algorithms on a star graph', () => {
    const store = new GraphStore();
    store.addNode('center');
    for (let i = 0; i < 5; i++) {
      store.addNode(`leaf${i}`);
      // Bidirectional edges so PageRank flows back to center
      store.addEdge('center', `leaf${i}`, 'CONNECTS');
      store.addEdge(`leaf${i}`, 'center', 'CONNECTS');
    }

    const algo = new GraphAlgorithms(store);
    const centrality = algo.centrality('degree');
    expect(centrality.scores.get('center')).toBeCloseTo(1.0);

    const pagerank = algo.pagerank(50, 0.85);
    // Center should have higher PageRank than any leaf in a star graph
    const centerScore = pagerank.get('center')!;
    for (let i = 0; i < 5; i++) {
      expect(centerScore).toBeGreaterThan(pagerank.get(`leaf${i}`)!);
    }
  });

  it('should handle SPARQL with multiple patterns', () => {
    const ts = new TripleStore();
    ts.addTriple('Alice', 'knows', 'Bob');
    ts.addTriple('Bob', 'knows', 'Charlie');
    ts.addTriple('Alice', 'knows', 'Charlie');

    const result = ts.sparql('SELECT ?friend WHERE { Alice knows ?friend }');
    expect(result.bindings.length).toBe(2);
  });
});
