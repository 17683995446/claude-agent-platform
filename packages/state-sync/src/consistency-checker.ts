// src/consistency-checker.ts - 一致性检查器

export type RepairStrategy = 'auto-repair' | 'manual-repair' | 'notify';

export interface InvariantCheck {
  name: string;
  description?: string;
  check: (state: Record<string, unknown>) => boolean | Promise<boolean>;
  repair?: (state: Record<string, unknown>) => Record<string, unknown>;
  repairStrategy: RepairStrategy;
}

export interface InvariantInfo {
  name: string;
  description?: string;
  repairStrategy: RepairStrategy;
  hasRepair: boolean;
}

export interface ConsistencyIssue {
  invariantName: string;
  nodeId?: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  detectedAt: number;
  repairable: boolean;
  repairStrategy: RepairStrategy;
}

export interface ConsistencyReport {
  consistent: boolean;
  issues: ConsistencyIssue[];
  checkedAt: number;
  invariantCount: number;
  passedCount: number;
  failedCount: number;
}

export interface NodeConsistencyReport {
  nodeId: string;
  consistent: boolean;
  issues: ConsistencyIssue[];
  checkedAt: number;
}

export interface RepairResult {
  success: boolean;
  issue: ConsistencyIssue;
  repairedAt: number;
  changes?: Record<string, unknown>;
  error?: string;
}

export class ConsistencyChecker {
  private invariants: Map<string, InvariantCheck> = new Map();
  private nodeStates: Map<string, Record<string, unknown>> = new Map();
  private repairHistory: RepairResult[] = [];

  addInvariant(name: string, check: InvariantCheck): void {
    this.invariants.set(name, check);
  }

  removeInvariant(name: string): boolean {
    return this.invariants.delete(name);
  }

  async verify(): Promise<ConsistencyReport> {
    const issues: ConsistencyIssue[] = [];
    let passedCount = 0;
    let failedCount = 0;

    for (const [name, invariant] of this.invariants) {
      // Check against all node states
      for (const [nodeId, state] of this.nodeStates) {
        try {
          const result = await invariant.check(state);
          if (result) {
            passedCount++;
          } else {
            failedCount++;
            issues.push({
              invariantName: name,
              nodeId,
              description: `Invariant "${name}" failed on node "${nodeId}"`,
              severity: 'high',
              detectedAt: Date.now(),
              repairable: !!invariant.repair,
              repairStrategy: invariant.repairStrategy,
            });
          }
        } catch (error) {
          failedCount++;
          issues.push({
            invariantName: name,
            nodeId,
            description: `Invariant "${name}" check error on node "${nodeId}": ${error}`,
            severity: 'critical',
            detectedAt: Date.now(),
            repairable: false,
            repairStrategy: 'manual-repair',
          });
        }
      }
    }

    return {
      consistent: issues.length === 0,
      issues,
      checkedAt: Date.now(),
      invariantCount: this.invariants.size,
      passedCount,
      failedCount,
    };
  }

  async verifyNode(nodeId: string): Promise<NodeConsistencyReport> {
    const state = this.nodeStates.get(nodeId);
    if (!state) {
      return {
        nodeId,
        consistent: false,
        issues: [{
          invariantName: 'node-exists',
          description: `Node "${nodeId}" state not found`,
          severity: 'critical',
          detectedAt: Date.now(),
          repairable: false,
          repairStrategy: 'manual-repair',
        }],
        checkedAt: Date.now(),
      };
    }

    const issues: ConsistencyIssue[] = [];
    for (const [name, invariant] of this.invariants) {
      try {
        const result = await invariant.check(state);
        if (!result) {
          issues.push({
            invariantName: name,
            nodeId,
            description: `Invariant "${name}" failed on node "${nodeId}"`,
            severity: 'high',
            detectedAt: Date.now(),
            repairable: !!invariant.repair,
            repairStrategy: invariant.repairStrategy,
          });
        }
      } catch (error) {
        issues.push({
          invariantName: name,
          nodeId,
          description: `Invariant "${name}" check error: ${error}`,
          severity: 'critical',
          detectedAt: Date.now(),
          repairable: false,
          repairStrategy: 'manual-repair',
        });
      }
    }

    return {
      nodeId,
      consistent: issues.length === 0,
      issues,
      checkedAt: Date.now(),
    };
  }

  async repair(issue: ConsistencyIssue): Promise<RepairResult> {
    const invariant = this.invariants.get(issue.invariantName);
    if (!invariant || !invariant.repair) {
      const result: RepairResult = {
        success: false,
        issue,
        repairedAt: Date.now(),
        error: `No repair function available for invariant "${issue.invariantName}"`,
      };
      this.repairHistory.push(result);
      return result;
    }

    try {
      const nodeId = issue.nodeId ?? '';
      const state = this.nodeStates.get(nodeId) ?? {};
      const changes = invariant.repair(state);
      if (nodeId) {
        this.nodeStates.set(nodeId, { ...state, ...changes });
      }

      const result: RepairResult = {
        success: true,
        issue,
        repairedAt: Date.now(),
        changes,
      };
      this.repairHistory.push(result);
      return result;
    } catch (error) {
      const result: RepairResult = {
        success: false,
        issue,
        repairedAt: Date.now(),
        error: `Repair failed: ${error}`,
      };
      this.repairHistory.push(result);
      return result;
    }
  }

  getInvariants(): InvariantInfo[] {
    return Array.from(this.invariants.entries()).map(([name, check]) => ({
      name,
      description: check.description,
      repairStrategy: check.repairStrategy,
      hasRepair: !!check.repair,
    }));
  }

  setNodeState(nodeId: string, state: Record<string, unknown>): void {
    this.nodeStates.set(nodeId, state);
  }

  removeNodeState(nodeId: string): boolean {
    return this.nodeStates.delete(nodeId);
  }

  getRepairHistory(): RepairResult[] {
    return [...this.repairHistory];
  }

  clearRepairHistory(): void {
    this.repairHistory = [];
  }

  destroy(): void {
    this.invariants.clear();
    this.nodeStates.clear();
    this.repairHistory = [];
  }
}
