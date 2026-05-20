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

    const isUpdate = this.store.hasNode(id);
    const changeType = isUpdate ? 'property_changed' : 'node_added';

    if (isUpdate) {
      // Update existing node
      const existing = this.store.getNode(id)!;
      this.store.removeNode(id);
      this.store.addNode(id, labels, { ...existing.properties, ...props });
      this.recordChange('property_changed', time, id, { labels, properties: props });
    } else {
      this.store.addNode(id, labels, props);
      this.recordChange('node_added', time, id, { labels, properties: props });
    }

    this.addTimelineEntry(id, time, changeType, { labels, properties: props });
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
        case 'property_changed': {
          const details = change.details as { labels?: string[]; properties: Record<string, unknown> };
          if (activeNodeIds.has(change.targetId)) {
            const existingNode = tempStore.getNode(change.targetId);
            if (existingNode) {
              // Remove and re-add with updated properties
              const currentLabels = details.labels || existingNode.labels;
              const mergedProps = { ...existingNode.properties, ...details.properties };
              tempStore.removeNode(change.targetId);
              try {
                tempStore.addNode(change.targetId, currentLabels, mergedProps);
                activeNodeIds.add(change.targetId);
              } catch {
                // Node already exists in temp store
              }
            }
          }
          break;
        }
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
   * Get the graph state for a time range, returning snapshots at each distinct time.
   * @param since - Start time (inclusive)
   * @param until - End time (inclusive)
   * @returns Array of graph states at each distinct time in the range
   */
  getStatesInRange(since: number, until: number): GraphState[] {
    const times = new Set<number>();
    for (const change of this.changes) {
      if (change.time >= since && change.time <= until) {
        times.add(change.time);
      }
    }

    const sortedTimes = Array.from(times).sort((a, b) => a - b);
    return sortedTimes.map(time => this.getStateAt(time));
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
        case 'property_changed': {
          const details = change.details as { labels?: string[]; properties: Record<string, unknown> };
          const existingNode = this.store.getNode(change.targetId);
          if (existingNode) {
            const currentLabels = details.labels || existingNode.labels;
            const mergedProps = { ...existingNode.properties, ...details.properties };
            this.store.removeNode(change.targetId);
            try {
              this.store.addNode(change.targetId, currentLabels, mergedProps);
            } catch {
              // Already exists
            }
          }
          this.addTimelineEntry(change.targetId, change.time, change.type, change.details);
          break;
        }
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
   * Compress temporal data by merging consecutive identical property changes.
   * Only keeps the latest property change for each target within consecutive same-type changes.
   * @returns Number of changes removed
   */
  compressChanges(): number {
    if (this.changes.length <= 1) return 0;

    const compressed: TemporalChange[] = [];
    let removed = 0;

    for (let i = 0; i < this.changes.length; i++) {
      const current = this.changes[i];
      const prev = compressed.length > 0 ? compressed[compressed.length - 1] : null;

      // Merge consecutive property_changed events for the same target
      if (
        prev &&
        current.type === 'property_changed' &&
        prev.type === 'property_changed' &&
        current.targetId === prev.targetId
      ) {
        // Merge: keep the later change (which has more up-to-date properties)
        compressed[compressed.length - 1] = current;
        removed++;
      } else if (
        prev &&
        current.type === 'property_changed' &&
        prev.type === 'node_added' &&
        current.targetId === prev.targetId
      ) {
        // node_added followed by property_changed for same target:
        // Update the node_added with the new properties and count as merged,
        // but still keep the property_changed as a separate event
        prev.details = {
          ...prev.details,
          properties: { ...(prev.details.properties as Record<string, unknown>), ...(current.details.properties as Record<string, unknown>) },
        };
        prev.time = current.time;
        removed++;
        compressed.push(current);
      } else {
        compressed.push(current);
      }
    }

    this.changes = compressed;

    // Rebuild node timelines
    this.nodeTimelines.clear();
    for (const change of this.changes) {
      if (change.type === 'node_added' || change.type === 'property_changed') {
        this.addTimelineEntry(change.targetId, change.time, change.type, change.details);
      }
    }

    return removed;
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
