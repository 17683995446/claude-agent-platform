// dag-executor.ts - DAG 有向无环图执行器

export interface DAGNode {
  id: string;
  dependencies: string[];
  execute: (inputs: Record<string, unknown>) => Promise<unknown>;
  outputs?: unknown;
}

export interface DAGNodeTiming {
  nodeId: string;
  startTime: number;
  endTime: number;
  duration: number;
}

export interface DAGResult {
  outputs: Record<string, unknown>;
  executionOrder: string[];
  timing: DAGNodeTiming[];
  success: boolean;
  error?: string;
}

export class CycleDetectedError extends Error {
  public readonly cycle: string[];
  constructor(cycle: string[]) {
    super(`Cycle detected: ${cycle.join(' -> ')}`);
    this.name = 'CycleDetectedError';
    this.cycle = cycle;
  }
}

export class DAGExecutor {
  /**
   * Execute a DAG of nodes respecting dependency ordering.
   * Independent nodes are executed in parallel.
   */
  async execute(nodes: DAGNode[], signal?: AbortSignal): Promise<DAGResult> {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const outputs: Record<string, unknown> = {};
    const executionOrder: string[] = [];
    const timing: DAGNodeTiming[] = [];

    // Detect cycles
    this.detectCycle(nodes);

    // Compute in-degrees
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();

    for (const node of nodes) {
      inDegree.set(node.id, node.dependencies.length);
      if (!dependents.has(node.id)) dependents.set(node.id, []);
    }

    for (const node of nodes) {
      for (const dep of node.dependencies) {
        const deps = dependents.get(dep) ?? [];
        deps.push(node.id);
        dependents.set(dep, deps);
      }
    }

    // Find initial nodes (no dependencies)
    const ready: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) ready.push(id);
    }

    const completed = new Set<string>();

    while (ready.length > 0) {
      if (signal?.aborted) {
        return { outputs, executionOrder, timing, success: false, error: 'Aborted' };
      }

      // Execute all ready nodes in parallel
      const batch = [...ready];
      ready.length = 0;

      const results = await Promise.allSettled(
        batch.map(async (nodeId) => {
          if (signal?.aborted) return;
          const node = nodeMap.get(nodeId)!;
          const startTime = Date.now();

          // Gather inputs from dependencies
          const inputs: Record<string, unknown> = {};
          for (const dep of node.dependencies) {
            inputs[dep] = outputs[dep];
          }

          const result = await node.execute(inputs);
          if (signal?.aborted) return;

          const endTime = Date.now();

          outputs[nodeId] = result;
          executionOrder.push(nodeId);
          timing.push({
            nodeId,
            startTime,
            endTime,
            duration: endTime - startTime,
          });

          completed.add(nodeId);
        })
      );

      // Check for failures
      for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'rejected') {
          const err = results[i].reason;
          return {
            outputs,
            executionOrder,
            timing,
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }

      // Update in-degrees and find newly ready nodes
      for (const nodeId of batch) {
        const deps = dependents.get(nodeId) ?? [];
        for (const depId of deps) {
          const degree = (inDegree.get(depId) ?? 1) - 1;
          inDegree.set(depId, degree);
          if (degree === 0) {
            ready.push(depId);
          }
        }
      }
    }

    // Check if all nodes were executed
    if (completed.size < nodes.length) {
      const missing = nodes.filter(n => !completed.has(n.id)).map(n => n.id);
      return {
        outputs,
        executionOrder,
        timing,
        success: false,
        error: `Not all nodes executed. Missing: ${missing.join(', ')}`,
      };
    }

    return { outputs, executionOrder, timing, success: true };
  }

  /**
   * Detect cycles using DFS with coloring.
   */
  detectCycle(nodes: DAGNode[]): void {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    const parent = new Map<string, string | null>();

    for (const node of nodes) {
      color.set(node.id, WHITE);
      parent.set(node.id, null);
    }

    for (const node of nodes) {
      if (color.get(node.id) === WHITE) {
        const cycle = this.dfs(node.id, nodeMap, color, parent);
        if (cycle) {
          throw new CycleDetectedError(cycle);
        }
      }
    }
  }

  private dfs(
    nodeId: string,
    nodeMap: Map<string, DAGNode>,
    color: Map<string, number>,
    parent: Map<string, string | null>,
  ): string[] | null {
    color.set(nodeId, 1); // GRAY

    const node = nodeMap.get(nodeId);
    if (!node) return null;

    for (const dep of node.dependencies) {
      const depColor = color.get(dep) ?? 0;
      if (depColor === 1) {
        // Back edge found - reconstruct cycle
        const cycle: string[] = [dep, nodeId];
        let current = nodeId;
        while (parent.get(current) !== dep && parent.get(current) !== null) {
          current = parent.get(current)!;
          cycle.push(current);
        }
        cycle.push(dep);
        return cycle.reverse();
      }
      if (depColor === 0) {
        parent.set(dep, nodeId);
        const result = this.dfs(dep, nodeMap, color, parent);
        if (result) return result;
      }
    }

    color.set(nodeId, 2); // BLACK
    return null;
  }

  /**
   * Get topological sort order of nodes.
   */
  topologicalSort(nodes: DAGNode[]): string[] {
    this.detectCycle(nodes);

    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const visited = new Set<string>();
    const order: string[] = [];

    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      const node = nodeMap.get(id);
      if (node) {
        for (const dep of node.dependencies) {
          visit(dep);
        }
      }
      order.push(id);
    };

    for (const node of nodes) {
      visit(node.id);
    }

    return order;
  }
}
