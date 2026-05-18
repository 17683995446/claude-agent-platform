/**
 * GraphImportExport - Import/export graphs in various formats.
 *
 * Supports JSON, CSV, GraphML, and Neo4j Cypher formats,
 * as well as graph diffing and merging.
 */

import { GraphStore, GraphStore as GS, GraphNode, GraphEdge } from './graph-store.js';

/** JSON graph format */
export interface JSONGraphFormat {
  nodes: Array<{ id: string; labels: string[]; properties: Record<string, unknown> }>;
  edges: Array<{ from: string; to: string; type: string; properties: Record<string, unknown> }>;
}

/** CSV row for nodes */
export interface CSVNodeRow {
  id: string;
  labels: string;
  properties: string;
}

/** CSV row for edges */
export interface CSVEdgeRow {
  from: string;
  to: string;
  type: string;
  properties: string;
}

/** GraphML format */
export interface GraphMLFormat {
  graphml: {
    graph: {
      node: Array<{ id: string; data: Array<{ key: string; attr: { name: string; type: string }; value: unknown }> }>;
      edge: Array<{ source: string; target: string; data: Array<{ key: string; attr: { name: string; type: string }; value: unknown }> }>;
    };
  };
}

/** Merge strategy */
export type MergeStrategy = 'union' | 'intersection' | 'left' | 'right';

/** Graph diff result */
export interface GraphDiff {
  addedNodes: string[];
  removedNodes: string[];
  modifiedNodes: string[];
  addedEdges: Array<{ from: string; to: string; type: string }>;
  removedEdges: Array<{ from: string; to: string; type: string }>;
}

/**
 * GraphImportExport provides import/export capabilities for graphs.
 *
 * @example
 * ```typescript
 * const io = new GraphImportExport(store);
 * const json = io.exportJSON();
 * io.importJSON(jsonData);
 * const csv = io.exportCSV();
 * const diff = io.diff(storeA, storeB);
 * ```
 */
export class GraphImportExport {
  private store: GraphStore;

  constructor(store: GraphStore) {
    this.store = store;
  }

  /**
   * Export the graph as a JSON object.
   * @returns JSON-serializable graph data
   */
  exportJSON(): JSONGraphFormat {
    return {
      nodes: this.store.getAllNodes().map(node => ({
        id: node.id,
        labels: node.labels,
        properties: node.properties,
      })),
      edges: this.store.getAllEdges().map(edge => ({
        from: edge.from,
        to: edge.to,
        type: edge.type,
        properties: edge.properties,
      })),
    };
  }

  /**
   * Import a graph from JSON data.
   * @param data - JSON graph data
   * @throws {Error} If data format is invalid
   */
  importJSON(data: JSONGraphFormat): void {
    if (!data.nodes || !Array.isArray(data.nodes)) {
      throw new Error('Invalid JSON format: missing nodes array');
    }
    if (!data.edges || !Array.isArray(data.edges)) {
      throw new Error('Invalid JSON format: missing edges array');
    }

    for (const nodeData of data.nodes) {
      if (!nodeData.id) {
        throw new Error('Invalid node data: missing id');
      }
      try {
        this.store.addNode(nodeData.id, nodeData.labels || [], nodeData.properties || {});
      } catch {
        // Node may already exist
      }
    }

    for (const edgeData of data.edges) {
      if (!edgeData.from || !edgeData.to) {
        throw new Error('Invalid edge data: missing from or to');
      }
      try {
        this.store.addEdge(edgeData.from, edgeData.to, edgeData.type || '', edgeData.properties || {});
      } catch {
        // Edge may already exist or nodes don't exist
      }
    }
  }

  /**
   * Export the graph as CSV strings.
   * @returns Object with nodes and edges CSV strings
   */
  exportCSV(): { nodes: string; edges: string } {
    const nodesHeader = 'id,labels,properties';
    const nodesRows = this.store.getAllNodes().map(node => {
      const labels = node.labels.join(';');
      const props = JSON.stringify(node.properties);
      return `${node.id},${labels},${props}`;
    });

    const edgesHeader = 'from,to,type,properties';
    const edgesRows = this.store.getAllEdges().map(edge => {
      const props = JSON.stringify(edge.properties);
      return `${edge.from},${edge.to},${edge.type},${props}`;
    });

    return {
      nodes: [nodesHeader, ...nodesRows].join('\n'),
      edges: [edgesHeader, ...edgesRows].join('\n'),
    };
  }

  /**
   * Import graph data from CSV strings.
   * @param data - Object with nodes and edges CSV strings
   */
  importCSV(data: { nodes: string; edges: string }): void {
    if (data.nodes) {
      const lines = data.nodes.trim().split('\n');

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Split carefully: first two fields are simple, last field is JSON
        const firstComma = line.indexOf(',');
        const secondComma = line.indexOf(',', firstComma + 1);
        const id = line.substring(0, firstComma).trim();
        const labels = line.substring(firstComma + 1, secondComma > 0 ? secondComma : undefined).trim();
        const propsStr = secondComma > 0 ? line.substring(secondComma + 1).trim() : '{}';

        const labelArr = labels ? labels.split(';') : [];
        let properties: Record<string, unknown> = {};
        try {
          properties = JSON.parse(propsStr);
        } catch {
          properties = {};
        }

        try {
          this.store.addNode(id, labelArr, properties);
        } catch {
          // Node may already exist
        }
      }
    }

    if (data.edges) {
      const lines = data.edges.trim().split('\n');

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Split: from, to, type, properties(JSON)
        const firstComma = line.indexOf(',');
        const secondComma = line.indexOf(',', firstComma + 1);
        const thirdComma = line.indexOf(',', secondComma + 1);

        const from = line.substring(0, firstComma).trim();
        const to = line.substring(firstComma + 1, secondComma).trim();
        const type = thirdComma > 0 ? line.substring(secondComma + 1, thirdComma).trim() : '';
        const propsStr = thirdComma > 0 ? line.substring(thirdComma + 1).trim() : '{}';

        let properties: Record<string, unknown> = {};
        try {
          properties = JSON.parse(propsStr);
        } catch {
          properties = {};
        }

        try {
          this.store.addEdge(from, to, type, properties);
        } catch {
          // Edge may already exist or nodes don't exist
        }
      }
    }
  }

  /**
   * Export the graph in GraphML format.
   * @returns GraphML XML string
   */
  exportGraphML(): string {
    const lines: string[] = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<graphml xmlns="http://graphml.graphstruct.org/xmlns">');

    // Define keys
    lines.push('  <key id="labels" for="node" attr.name="labels" attr.type="string"/>');
    lines.push('  <key id="type" for="edge" attr.name="type" attr.type="string"/>');

    lines.push('  <graph id="G" edgedefault="directed">');

    // Export nodes
    for (const node of this.store.getAllNodes()) {
      lines.push(`    <node id="${this.escapeXml(node.id)}">`);
      lines.push(`      <data key="labels">${this.escapeXml(node.labels.join(','))}</data>`);
      for (const [key, value] of Object.entries(node.properties)) {
        lines.push(`      <data key="${this.escapeXml(key)}">${this.escapeXml(String(value))}</data>`);
      }
      lines.push('    </node>');
    }

    // Export edges
    for (const edge of this.store.getAllEdges()) {
      lines.push(`    <edge source="${this.escapeXml(edge.from)}" target="${this.escapeXml(edge.to)}">`);
      lines.push(`      <data key="type">${this.escapeXml(edge.type)}</data>`);
      for (const [key, value] of Object.entries(edge.properties)) {
        lines.push(`      <data key="${this.escapeXml(key)}">${this.escapeXml(String(value))}</data>`);
      }
      lines.push('    </edge>');
    }

    lines.push('  </graph>');
    lines.push('</graphml>');

    return lines.join('\n');
  }

  /**
   * Import graph from GraphML XML string.
   * @param data - GraphML XML string
   */
  importGraphML(data: string): void {
    // Simple GraphML parser (not a full XML parser)
    const nodeRegex = /<node\s+id="([^"]+)">(.*?)<\/node>/gs;
    const edgeRegex = /<edge\s+source="([^"]+)"\s+target="([^"]+)">(.*?)<\/edge>/gs;
    const dataRegex = /<data\s+key="([^"]+)">([^<]*)<\/data>/g;

    // Parse nodes
    let match;
    while ((match = nodeRegex.exec(data)) !== null) {
      const id = match[1];
      const content = match[2];
      const labels: string[] = [];
      const properties: Record<string, unknown> = {};

      let dataMatch;
      const dataRegexCopy = new RegExp(dataRegex.source, 'g');
      while ((dataMatch = dataRegexCopy.exec(content)) !== null) {
        const key = dataMatch[1];
        const value = dataMatch[2];
        if (key === 'labels') {
          labels.push(...value.split(',').filter(Boolean));
        } else {
          properties[key] = value;
        }
      }

      try {
        this.store.addNode(id, labels, properties);
      } catch {
        // Node may already exist
      }
    }

    // Parse edges
    while ((match = edgeRegex.exec(data)) !== null) {
      const from = match[1];
      const to = match[2];
      const content = match[3];
      let type = '';
      const properties: Record<string, unknown> = {};

      let dataMatch;
      const dataRegexCopy = new RegExp(dataRegex.source, 'g');
      while ((dataMatch = dataRegexCopy.exec(content)) !== null) {
        const key = dataMatch[1];
        const value = dataMatch[2];
        if (key === 'type') {
          type = value;
        } else {
          properties[key] = value;
        }
      }

      try {
        this.store.addEdge(from, to, type, properties);
      } catch {
        // Edge may already exist or nodes don't exist
      }
    }
  }

  /**
   * Export the graph as Neo4j Cypher statements.
   * @returns Array of Cypher query strings
   */
  exportNeo4jCypher(): string[] {
    const statements: string[] = [];

    // Create nodes
    for (const node of this.store.getAllNodes()) {
      const labelStr = node.labels.length > 0 ? `:${node.labels.join(':')}` : '';
      const propsStr = Object.entries(node.properties)
        .map(([k, v]) => `${k}: ${typeof v === 'string' ? `'${v}'` : v}`)
        .join(', ');
      const propsPart = propsStr ? ` {${propsStr}}` : '';
      statements.push(`CREATE (${node.id}${labelStr}${propsPart})`);
    }

    // Create edges
    for (const edge of this.store.getAllEdges()) {
      const propsStr = Object.entries(edge.properties)
        .map(([k, v]) => `${k}: ${typeof v === 'string' ? `'${v}'` : v}`)
        .join(', ');
      const propsPart = propsStr ? ` {${propsStr}}` : '';
      statements.push(`CREATE (${edge.from})-[:${edge.type}${propsPart}]->(${edge.to})`);
    }

    return statements;
  }

  /**
   * Compute the diff between two graphs.
   * @param graphA - First graph store
   * @param graphB - Second graph store
   * @returns Diff result describing differences
   */
  diff(graphA: GraphStore, graphB: GraphStore): GraphDiff {
    const nodesA = new Map(graphA.getAllNodes().map(n => [n.id, n]));
    const nodesB = new Map(graphB.getAllNodes().map(n => [n.id, n]));

    const addedNodes: string[] = [];
    const removedNodes: string[] = [];
    const modifiedNodes: string[] = [];

    // Find added and modified nodes
    for (const [id, nodeB] of nodesB) {
      if (!nodesA.has(id)) {
        addedNodes.push(id);
      } else {
        const nodeA = nodesA.get(id)!;
        if (JSON.stringify(nodeA.properties) !== JSON.stringify(nodeB.properties) ||
            JSON.stringify(nodeA.labels) !== JSON.stringify(nodeB.labels)) {
          modifiedNodes.push(id);
        }
      }
    }

    // Find removed nodes
    for (const [id] of nodesA) {
      if (!nodesB.has(id)) {
        removedNodes.push(id);
      }
    }

    // Compare edges
    const edgesA = graphA.getAllEdges();
    const edgesB = graphB.getAllEdges();

    const edgeSetA = new Set(edgesA.map(e => `${e.from}|${e.to}|${e.type}`));
    const edgeSetB = new Set(edgesB.map(e => `${e.from}|${e.to}|${e.type}`));

    const addedEdges: Array<{ from: string; to: string; type: string }> = [];
    const removedEdges: Array<{ from: string; to: string; type: string }> = [];

    for (const edge of edgesB) {
      const key = `${edge.from}|${edge.to}|${edge.type}`;
      if (!edgeSetA.has(key)) {
        addedEdges.push({ from: edge.from, to: edge.to, type: edge.type });
      }
    }

    for (const edge of edgesA) {
      const key = `${edge.from}|${edge.to}|${edge.type}`;
      if (!edgeSetB.has(key)) {
        removedEdges.push({ from: edge.from, to: edge.to, type: edge.type });
      }
    }

    return { addedNodes, removedNodes, modifiedNodes, addedEdges, removedEdges };
  }

  /**
   * Merge two graphs using a specified strategy.
   * @param graphA - First graph store
   * @param graphB - Second graph store
   * @param strategy - Merge strategy
   * @returns A new GraphStore with the merged result
   */
  merge(graphA: GraphStore, graphB: GraphStore, strategy: MergeStrategy = 'union'): GraphStore {
    const result = new GS();

    const nodesA = new Map(graphA.getAllNodes().map(n => [n.id, n]));
    const nodesB = new Map(graphB.getAllNodes().map(n => [n.id, n]));

    switch (strategy) {
      case 'union': {
        // Add all nodes from A
        for (const [, node] of nodesA) {
          result.addNode(node.id, node.labels, { ...node.properties });
        }
        // Add nodes from B not in A
        for (const [id, node] of nodesB) {
          if (!nodesA.has(id)) {
            result.addNode(id, node.labels, { ...node.properties });
          }
        }
        // Add all edges from A
        for (const edge of graphA.getAllEdges()) {
          if (result.hasNode(edge.from) && result.hasNode(edge.to)) {
            try {
              result.addEdge(edge.from, edge.to, edge.type, { ...edge.properties });
            } catch {
              // Edge may already exist
            }
          }
        }
        // Add edges from B not in A
        const edgeSetA = new Set(graphA.getAllEdges().map(e => `${e.from}|${e.to}|${e.type}`));
        for (const edge of graphB.getAllEdges()) {
          const key = `${edge.from}|${edge.to}|${edge.type}`;
          if (!edgeSetA.has(key) && result.hasNode(edge.from) && result.hasNode(edge.to)) {
            try {
              result.addEdge(edge.from, edge.to, edge.type, { ...edge.properties });
            } catch {
              // Edge may already exist
            }
          }
        }
        break;
      }

      case 'intersection': {
        // Add nodes present in both
        for (const [id, node] of nodesA) {
          if (nodesB.has(id)) {
            result.addNode(id, node.labels, { ...node.properties });
          }
        }
        // Add edges present in both
        const edgeSetB = new Set(graphB.getAllEdges().map(e => `${e.from}|${e.to}|${e.type}`));
        for (const edge of graphA.getAllEdges()) {
          const key = `${edge.from}|${edge.to}|${edge.type}`;
          if (edgeSetB.has(key) && result.hasNode(edge.from) && result.hasNode(edge.to)) {
            try {
              result.addEdge(edge.from, edge.to, edge.type, { ...edge.properties });
            } catch {
              // Edge may already exist
            }
          }
        }
        break;
      }

      case 'left': {
        // Same as union but only A's properties for common nodes
        for (const [, node] of nodesA) {
          result.addNode(node.id, node.labels, { ...node.properties });
        }
        for (const edge of graphA.getAllEdges()) {
          if (result.hasNode(edge.from) && result.hasNode(edge.to)) {
            try {
              result.addEdge(edge.from, edge.to, edge.type, { ...edge.properties });
            } catch {
              // Edge may already exist
            }
          }
        }
        break;
      }

      case 'right': {
        for (const [, node] of nodesB) {
          result.addNode(node.id, node.labels, { ...node.properties });
        }
        for (const edge of graphB.getAllEdges()) {
          if (result.hasNode(edge.from) && result.hasNode(edge.to)) {
            try {
              result.addEdge(edge.from, edge.to, edge.type, { ...edge.properties });
            } catch {
              // Edge may already exist
            }
          }
        }
        break;
      }
    }

    return result;
  }

  /**
   * Parse a CSV line handling quoted fields.
   */
  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());

    return result;
  }

  /**
   * Escape special XML characters.
   */
  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
