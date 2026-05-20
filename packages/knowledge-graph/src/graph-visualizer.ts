/**
 * GraphVisualizer - Generate graph visualization data.
 *
 * Provides layout algorithms (force-directed, circular, hierarchical),
 * and export formats (DOT, Mermaid, JSON) for graph visualization.
 */

import { GraphStore, GraphNode, GraphEdge } from './graph-store.js';

/** Layout algorithm type */
export type LayoutAlgorithm = 'force-directed' | 'circular' | 'hierarchical' | 'random';

/** Layout options */
export interface LayoutOptions {
  width?: number;
  height?: number;
  iterations?: number;
  repulsion?: number;
  attraction?: number;
  damping?: number;
}

/** Color scheme for visualization */
export interface ColorScheme {
  nodeFill?: string;
  nodeStroke?: string;
  edgeStroke?: string;
  labelColor?: string;
  background?: string;
  highlight?: string;
}

/** Node position */
export interface NodePosition {
  id: string;
  x: number;
  y: number;
}

/** Layout result */
export interface LayoutResult {
  nodes: NodePosition[];
  width: number;
  height: number;
}

/** DOT format node/edge attributes */
export interface DOTAttributes {
  [key: string]: string;
}

/** Mermaid node definition */
export interface MermaidNode {
  id: string;
  label: string;
  shape: string;
}

/** Mermaid edge definition */
export interface MermaidEdge {
  from: string;
  to: string;
  label: string;
  style: string;
}

/** Subgraph result */
export interface SubgraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * GraphVisualizer generates visualization data for graphs.
 *
 * @example
 * ```typescript
 * const viz = new GraphVisualizer(store);
 * const dot = viz.generateDOT();
 * const mermaid = viz.generateMermaid();
 * const layout = viz.layoutGraph('force-directed', { width: 800, height: 600 });
 * ```
 */
export class GraphVisualizer {
  private store: GraphStore;
  private colorScheme: ColorScheme;

  private static readonly defaultColorScheme: ColorScheme = {
    nodeFill: '#lightblue',
    nodeStroke: '#333333',
    edgeStroke: '#666666',
    labelColor: '#000000',
    background: '#ffffff',
    highlight: '#ff6600',
  };

  constructor(store: GraphStore, colorScheme?: ColorScheme) {
    this.store = store;
    this.colorScheme = { ...GraphVisualizer.defaultColorScheme, ...colorScheme };
  }

  /**
   * Get the current color scheme.
   */
  getColorScheme(): ColorScheme {
    return { ...this.colorScheme };
  }

  /**
   * Set the color scheme.
   */
  setColorScheme(scheme: ColorScheme): void {
    this.colorScheme = { ...this.colorScheme, ...scheme };
  }

  /**
   * Layout the graph using a specified algorithm.
   * @param algorithm - Layout algorithm to use
   * @param options - Layout options
   * @returns Layout result with node positions
   */
  layoutGraph(algorithm: LayoutAlgorithm = 'force-directed', options: LayoutOptions = {}): LayoutResult {
    const width = options.width || 800;
    const height = options.height || 600;

    switch (algorithm) {
      case 'force-directed':
        return this.forceDirectedLayout(options, width, height);
      case 'circular':
        return this.circularLayout(width, height);
      case 'hierarchical':
        return this.hierarchicalLayout(width, height);
      case 'random':
        return this.randomLayout(width, height);
      default:
        return this.forceDirectedLayout(options, width, height);
    }
  }

  /**
   * Generate a DOT (Graphviz) representation of the graph.
   * @returns DOT format string
   */
  generateDOT(): string {
    const lines: string[] = ['digraph G {'];
    lines.push('  rankdir=LR;');
    lines.push('  node [shape=box];');
    lines.push('');

    // Add nodes
    const nodes = this.store.getAllNodes();
    for (const node of nodes) {
      const label = (node.properties.name as string) || node.id;
      const labels = node.labels.length > 0 ? ` [${node.labels.join(', ')}]` : '';
      lines.push(`  "${node.id}" [label="${label}${labels}"];`);
    }

    lines.push('');

    // Add edges
    const edges = this.store.getAllEdges();
    for (const edge of edges) {
      const label = edge.type;
      lines.push(`  "${edge.from}" -> "${edge.to}" [label="${label}"];`);
    }

    lines.push('}');
    return lines.join('\n');
  }

  /**
   * Generate a Mermaid diagram representation of the graph.
   * @returns Mermaid format string
   */
  generateMermaid(): string {
    const lines: string[] = ['graph LR'];

    // Add nodes
    const nodes = this.store.getAllNodes();
    for (const node of nodes) {
      const label = (node.properties.name as string) || node.id;
      // Sanitize ID for Mermaid (replace special chars)
      const safeId = node.id.replace(/[^a-zA-Z0-9]/g, '_');
      lines.push(`    ${safeId}["${label}"]`);
    }

    lines.push('');

    // Add edges
    const edges = this.store.getAllEdges();
    for (const edge of edges) {
      const safeFrom = edge.from.replace(/[^a-zA-Z0-9]/g, '_');
      const safeTo = edge.to.replace(/[^a-zA-Z0-9]/g, '_');
      lines.push(`    ${safeFrom} -->|"${edge.type}"| ${safeTo}`);
    }

    return lines.join('\n');
  }

  /**
   * Generate a JSON representation of the graph.
   * @returns JSON string
   */
  generateJSON(): string {
    const nodes = this.store.getAllNodes();
    const edges = this.store.getAllEdges();

    return JSON.stringify({ nodes, edges }, null, 2);
  }

  /**
   * Get a subgraph centered on a node within a given radius.
   * @param center - Center node ID
   * @param radius - Radius in number of hops
   * @returns Subgraph containing nodes and edges within the radius
   */
  getSubgraph(center: string, radius: number): SubgraphResult {
    if (!this.store.hasNode(center)) {
      return { nodes: [], edges: [] };
    }

    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: center, depth: 0 }];
    nodeIds.add(center);

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.depth >= radius) continue;

      const neighbors = this.store.getNeighbors(current.nodeId, 'both');
      for (const neighbor of neighbors) {
        nodeIds.add(neighbor.id);

        // Find edges between current and neighbor
        const edgesBetween = this.store.getEdgesBetween(current.nodeId, neighbor.id);
        const reverseEdges = this.store.getEdgesBetween(neighbor.id, current.nodeId);
        for (const e of [...edgesBetween, ...reverseEdges]) {
          edgeIds.add(e.id);
        }

        if (!nodeIds.has(neighbor.id) || current.depth + 1 < radius) {
          queue.push({ nodeId: neighbor.id, depth: current.depth + 1 });
        }
      }
    }

    const nodes = Array.from(nodeIds).map(id => this.store.getNode(id)!).filter(Boolean);
    const edges = Array.from(edgeIds).map(id => this.store.getEdge(id)!).filter(Boolean);

    return { nodes, edges };
  }

  /**
   * Get a layout that visually separates communities.
   * @param communities - Array of community member ID arrays
   * @returns Layout result with communities spatially separated
   */
  getCommunityLayout(communities: string[][]): LayoutResult {
    const width = 800;
    const height = 600;
    const positions: NodePosition[] = [];

    const numCommunities = communities.length;
    if (numCommunities === 0) return { nodes: positions, width, height };

    // Arrange communities in a grid
    const cols = Math.ceil(Math.sqrt(numCommunities));
    const rows = Math.ceil(numCommunities / cols);
    const cellWidth = width / cols;
    const cellHeight = height / rows;

    for (let c = 0; c < numCommunities; c++) {
      const community = communities[c];
      const col = c % cols;
      const row = Math.floor(c / cols);
      const centerX = col * cellWidth + cellWidth / 2;
      const centerY = row * cellHeight + cellHeight / 2;

      // Arrange members in a circle within the cell
      const radius = Math.min(cellWidth, cellHeight) * 0.35;
      for (let i = 0; i < community.length; i++) {
        const angle = (2 * Math.PI * i) / community.length;
        positions.push({
          id: community[i],
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
        });
      }
    }

    return { nodes: positions, width, height };
  }

  /**
   * Force-directed layout using Fruchterman-Reingold algorithm.
   */
  private forceDirectedLayout(options: LayoutOptions, width: number, height: number): LayoutResult {
    const nodes = this.store.getAllNodes();
    if (nodes.length === 0) return { nodes: [], width, height };

    const iterations = options.iterations || 50;
    const repulsion = options.repulsion || 5000;
    const attraction = options.attraction || 0.01;
    const damping = options.damping || 0.9;

    // Initialize positions randomly
    const positions: Map<string, { x: number; y: number; vx: number; vy: number }> = new Map();
    for (const node of nodes) {
      positions.set(node.id, {
        x: Math.random() * width,
        y: Math.random() * height,
        vx: 0,
        vy: 0,
      });
    }

    const area = width * height;
    const k = Math.sqrt(area / nodes.length);
    const minNodeDist = Math.min(width, height) / (nodes.length * 0.5 + 1); // Minimum distance between nodes

    for (let iter = 0; iter < iterations; iter++) {
      const temp = (1 - iter / iterations) * width / 4;

      // Repulsive forces between all pairs (with collision detection)
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = positions.get(nodes[i].id)!;
          const b = positions.get(nodes[j].id)!;

          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 0.01) { dist = 0.01; dx = 0.01; dy = 0; }

          // Strong repulsion when nodes are too close (collision avoidance)
          let force: number;
          if (dist < minNodeDist) {
            force = (repulsion * k * k) / (dist * dist) * (minNodeDist / dist);
          } else {
            force = (repulsion * k * k) / (dist * dist);
          }
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
      }

      // Attractive forces along edges
      const edges = this.store.getAllEdges();
      for (const edge of edges) {
        const a = positions.get(edge.from);
        const b = positions.get(edge.to);
        if (!a || !b) continue;

        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.01) { dist = 0.01; dx = 0.01; dy = 0; }

        const force = attraction * dist * dist / k;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }

      // Apply velocities with damping and temperature
      for (const node of nodes) {
        const pos = positions.get(node.id)!;
        const speed = Math.sqrt(pos.vx * pos.vx + pos.vy * pos.vy);
        if (speed > 0) {
          const limitedSpeed = Math.min(speed, temp);
          pos.vx = (pos.vx / speed) * limitedSpeed;
          pos.vy = (pos.vy / speed) * limitedSpeed;
        }

        pos.x += pos.vx * damping;
        pos.y += pos.vy * damping;

        // Keep within bounds
        pos.x = Math.max(0, Math.min(width, pos.x));
        pos.y = Math.max(0, Math.min(height, pos.y));

        pos.vx *= 0.5;
        pos.vy *= 0.5;
      }
    }

    return {
      nodes: nodes.map(node => {
        const pos = positions.get(node.id)!;
        return { id: node.id, x: pos.x, y: pos.y };
      }),
      width,
      height,
    };
  }

  /**
   * Circular layout: arrange nodes in a circle.
   */
  private circularLayout(width: number, height: number): LayoutResult {
    const nodes = this.store.getAllNodes();
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.4;

    return {
      nodes: nodes.map((node, i) => {
        const angle = (2 * Math.PI * i) / nodes.length;
        return {
          id: node.id,
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
        };
      }),
      width,
      height,
    };
  }

  /**
   * Hierarchical layout using topological sort.
   */
  private hierarchicalLayout(width: number, height: number): LayoutResult {
    const nodes = this.store.getAllNodes();
    if (nodes.length === 0) return { nodes: [], width, height };

    // Compute levels using BFS from root nodes (nodes with no incoming edges)
    const inDegree = new Map<string, number>();
    for (const node of nodes) {
      inDegree.set(node.id, this.store.getNeighbors(node.id, 'in').length);
    }

    const levels = new Map<string, number>();
    const queue: string[] = [];

    for (const node of nodes) {
      if (inDegree.get(node.id) === 0) {
        queue.push(node.id);
        levels.set(node.id, 0);
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentLevel = levels.get(current) || 0;

      const neighbors = this.store.getNeighbors(current, 'out');
      for (const neighbor of neighbors) {
        const newLevel = currentLevel + 1;
        if (!levels.has(neighbor.id) || levels.get(neighbor.id)! < newLevel) {
          levels.set(neighbor.id, newLevel);
        }
        inDegree.set(neighbor.id, inDegree.get(neighbor.id)! - 1);
        if (inDegree.get(neighbor.id) === 0) {
          queue.push(neighbor.id);
        }
      }
    }

    // Assign unvisited nodes to level 0
    for (const node of nodes) {
      if (!levels.has(node.id)) {
        levels.set(node.id, 0);
      }
    }

    // Group by level
    const levelGroups = new Map<number, string[]>();
    let maxLevel = 0;
    for (const [nodeId, level] of levels) {
      if (!levelGroups.has(level)) levelGroups.set(level, []);
      levelGroups.get(level)!.push(nodeId);
      if (level > maxLevel) maxLevel = level;
    }

    const levelHeight = maxLevel > 0 ? height / (maxLevel + 1) : height / 2;

    return {
      nodes: nodes.map(node => {
        const level = levels.get(node.id) || 0;
        const group = levelGroups.get(level) || [];
        const indexInGroup = group.indexOf(node.id);
        const groupWidth = width / (group.length + 1);

        return {
          id: node.id,
          x: groupWidth * (indexInGroup + 1),
          y: levelHeight * (level + 1),
        };
      }),
      width,
      height,
    };
  }

  /**
   * Random layout.
   */
  private randomLayout(width: number, height: number): LayoutResult {
    const nodes = this.store.getAllNodes();
    return {
      nodes: nodes.map(node => ({
        id: node.id,
        x: Math.random() * width,
        y: Math.random() * height,
      })),
      width,
      height,
    };
  }
}
