/**
 * TemporalGraph - Time-aware graph with versioning.
 *
 * Provides temporal node/edge management, state snapshots at specific times,
 * change tracking, timelines, and rollback capabilities.
 */

import { GraphStore, GraphNode, GraphEdge } from './graph-store.js';

/** Temporal change type */
export type ChangeType = 'node_added' | 'node_removed' | 'edge_added' | 'edge_removed' | 'property_changed';

/** A temporal change record */
export interface TemporalChange {
  type: ChangeType;
  time: number;
  targetId: string;
  details: Record<string, unknown>;
}

/** Timeline entry for a node */
export interface TimelineEntry {
  time: number;
  type: ChangeType;
  details: Record<string, unknown>;
}

/** Graph state at a specific time */
export interface GraphState {
  time: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * TemporalGraph provides time-aware graph operations with versioning.
 *
 * @example
 * ```typescript
 * const tg = new TemporalGraph();
 * tg.addNodeAt('alice', 1, ['Person'], { name: 'Alice' });
 * tg.addEdgeAt('alice', 'bob', 2, 'KNOWS', {});
 * const state = tg.getStateAt(2);
 * const changes = tg.getChanges(1, 3);
 * ```
 */
export class TemporalGraph {
  private store: GraphStore;
  private changes: TemporalChange[] = [];
  private currentTime: number = 0;
  private nodeTimelines: Map<string, TimelineEntry[]> = new Map();

  constructor() {
    this.store = new GraphStore();
  }

  /**
   * Add a node at a specific time.
   * @param id - Node ID
   * @param time - Timestamp
   * @param labels - Node labels
   * @param props - Node properties
   */
  addNodeAt(id: string, time: number, labels: string[] = [], props: Record<string, unknown> = {}): void {
    if (time < this.currentTime) {
      throw new Error(`Cannot add node at time ${time} which is before current time ${this.currentTime}`);
    }

    this.currentTime = Math.max(this.currentTime, time);

    if (this.store.hasNode(id)) {
      // Update existing node
      const existing = this.store.getNode(id)!;
      this.store.removeNode(id);
      this.store.addNode(id, labels, { ...existing.properties, ...props });
      this.recordChange('property_changed', time, id, { labels, properties: props });
    } else {
      this.store.addNode(id, labels, props);
      this.recordChange('node_added', time, id, { labels, properties: props });
    }

    this.addTimelineEntry(id, time, 'node_added', { labels, properties: props });
  }

  /**
   * Add an edge at a specific time.
   * @param from - Source node ID
   * @param to - Target node ID
   * @param time - Timestamp
   * @param type - Edge type
   * @param props - Edge properties
   * @returns Edge ID
   */
  addEdgeAt(from: string, to: string, time: number, type: string, props: Record<string, unknown> = {}): string {
    if (time < this.currentTime) {
      throw new Error(`Cannot add edge at time ${time} which is before current time ${this.currentTime}`);
    }

    this.currentTime = Math.max(this.currentTime, time);
    const edgeId = this.store.addEdge(from, to, type, props);
    this.recordChange('edge_added', time, edgeId, { from, to, type, properties: props });

    return edgeId;
  }

  /**
   * Get the graph state at a specific point in time.
   * @param time - Timestamp to query
   * @returns Graph state snapshot
   */
  getStateAt(time: number): GraphState {
    // Reconstruct state by replaying changes up to the given time
    const relevantChanges = this.changes.filter(c => c.time <= time);

    const tempStore = new GraphStore();
    const activeNodeIds = new Set<string>();
    const activeEdgeIds = new Set<string>();

    for (const change of relevantChanges) {
      switch (change.type) {
        case 'node_added':
          if (!activeNodeIds.has(change.targetId)) {
            const details = change.details as { labels: string[]; properties: Record<string, unknown> };
            try {
              tempStore.addNode(change.targetId, details.labels, details.properties);
              activeNodeIds.add(change.targetId);
            } catch {
              // Node already exists in temp store
            }
          }
          break;
        case 'node_removed':
          tempStore.removeNode(change.targetId);
          activeNodeIds.delete(change.targetId);
          break;
        case 'edge_added': {
          const details = change.details as { from: string; to: string; type: string; properties: Record<string, unknown> };
          if (activeNodeIds.has(details.from) && activeNodeIds.has(details.to)) {
            try {
              tempStore.addEdge(details.from, details.to, details.type, details.properties);
            } catch {
              // Edge already exists or nodes don't exist
            }
          }
          break;
        }
        case 'edge_removed':
          tempStore.removeEdge(change.targetId);
          activeEdgeIds.delete(change.targetId);
          break;
        case 'property_changed':
          // Properties are already captured in node_added
          break;
      }
    }

    return {
      time,
      nodes: tempStore.getAllNodes(),
      edges: tempStore.getAllEdges(),
    };
  }

  /**
   * Get changes within a time range.
   * @param since - Start time (inclusive)
   * @param until - End time (inclusive)
   * @returns Array of temporal changes
   */
  getChanges(since: number, until: number): TemporalChange[] {
    return this.changes.filter(c => c.time >= since && c.time <= until);
  }

  /**
   * Get the timeline of changes for a specific node.
   * @param nodeId - Node ID
   * @returns Array of timeline entries
   */
  getTimeline(nodeId: string): TimelineEntry[] {
    return this.nodeTimelines.get(nodeId) || [];
  }

  /**
   * Get the temporal range of all changes.
   * @returns Object with min and max times, or null if empty
   */
  getTemporalRange(): { min: number; max: number } | null {
    if (this.changes.length === 0) return null;

    let min = Infinity;
    let max = -Infinity;

    for (const change of this.changes) {
      if (change.time < min) min = change.time;
      if (change.time > max) max = change.time;
    }

    return { min, max };
  }

  /**
   * Rollback the graph to a specific time.
   * Removes all changes after the specified time.
   * @param time - Timestamp to rollback to
   * @returns Number of changes removed
   */
  rollback(time: number): number {
    const removedChanges = this.changes.filter(c => c.time > time);
    const keptChanges = this.changes.filter(c => c.time <= time);

    // Rebuild store from kept changes
    this.store.clear();
    this.changes = keptChanges;

    // Rebuild node timelines
    this.nodeTimelines.clear();

    for (const change of keptChanges) {
      switch (change.type) {
        case 'node_added': {
          const details = change.details as { labels: string[]; properties: Record<string, unknown> };
          try {
            this.store.addNode(change.targetId, details.labels, details.properties);
          } catch {
            // Already exists
          }
          this.addTimelineEntry(change.targetId, change.time, change.type, change.details);
          break;
        }
        case 'edge_added': {
          const details = change.details as { from: string; to: string; type: string; properties: Record<string, unknown> };
          try {
            this.store.addEdge(details.from, details.to, details.type, details.properties);
          } catch {
            // Nodes don't exist
          }
          break;
        }
        case 'node_removed':
          this.store.removeNode(change.targetId);
          break;
        case 'edge_removed':
          this.store.removeEdge(change.targetId);
          break;
      }
    }

    // Update current time
    this.currentTime = time;

    return removedChanges.length;
  }

  /**
   * Get the underlying GraphStore.
   */
  getStore(): GraphStore {
    return this.store;
  }

  /**
   * Get the current time.
   */
  getCurrentTime(): number {
    return this.currentTime;
  }

  /**
   * Get all changes.
   */
  getAllChanges(): TemporalChange[] {
    return [...this.changes];
  }

  /**
   * Record a temporal change.
   */
  private recordChange(type: ChangeType, time: number, targetId: string, details: Record<string, unknown>): void {
    this.changes.push({ type, time, targetId, details });
  }

  /**
   * Add a timeline entry for a node.
   */
  private addTimelineEntry(nodeId: string, time: number, type: ChangeType, details: Record<string, unknown>): void {
    if (!this.nodeTimelines.has(nodeId)) {
      this.nodeTimelines.set(nodeId, []);
    }
    this.nodeTimelines.get(nodeId)!.push({ time, type, details });
  }
}
