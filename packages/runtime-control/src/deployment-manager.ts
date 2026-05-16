// src/deployment-manager.ts - 部署管理器

export type DeploymentPhase = 'staging' | 'deploying' | 'deployed' | 'rolling-back' | 'rolled-back' | 'failed';

export interface DeploymentConfig {
  version: string;
  environment: string;
  strategy: 'standard' | 'blue-green' | 'canary';
  canaryPercent?: number; // 0-100 for canary strategy
  rollbackOnFailure?: boolean;
  healthCheckPath?: string;
  healthCheckTimeout?: number;
}

export interface DeploymentResult {
  success: boolean;
  deploymentId: string;
  version: string;
  phase: DeploymentPhase;
  timestamp: number;
  error?: string;
}

export interface RollbackResult {
  success: boolean;
  deploymentId: string;
  previousVersion: string;
  timestamp: number;
  error?: string;
}

export interface DeploymentStatus {
  id: string;
  version: string;
  phase: DeploymentPhase;
  environment: string;
  strategy: string;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

export interface DeploymentInfo {
  id: string;
  version: string;
  phase: DeploymentPhase;
  environment: string;
  strategy: string;
  startedAt: number;
  completedAt?: number;
}

export interface DeploymentRecord {
  id: string;
  version: string;
  phase: DeploymentPhase;
  environment: string;
  strategy: string;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

export class DeploymentManager {
  private deployments: Map<string, DeploymentRecord> = new Map();
  private activeDeploymentId: string | undefined;
  private idCounter: number = 0;

  async deploy(config: DeploymentConfig): Promise<DeploymentResult> {
    const id = `deploy-${++this.idCounter}`;
    const now = Date.now();

    const record: DeploymentRecord = {
      id,
      version: config.version,
      phase: 'staging',
      environment: config.environment,
      strategy: config.strategy,
      startedAt: now,
    };
    this.deployments.set(id, record);

    // Simulate staging phase
    record.phase = 'deploying';

    // Simulate deployment
    try {
      if (config.strategy === 'blue-green') {
        record.phase = 'deployed';
      } else if (config.strategy === 'canary') {
        const canaryPercent = config.canaryPercent ?? 10;
        if (canaryPercent > 50) {
          record.phase = 'deployed';
        } else {
          record.phase = 'deployed';
        }
      } else {
        record.phase = 'deployed';
      }

      record.completedAt = Date.now();
      this.activeDeploymentId = id;

      return {
        success: true,
        deploymentId: id,
        version: config.version,
        phase: record.phase,
        timestamp: Date.now(),
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      record.phase = 'failed';
      record.error = error;
      record.completedAt = Date.now();

      if (config.rollbackOnFailure) {
        await this.rollback(id);
      }

      return {
        success: false,
        deploymentId: id,
        version: config.version,
        phase: 'failed',
        timestamp: Date.now(),
        error,
      };
    }
  }

  async rollback(deploymentId: string): Promise<RollbackResult> {
    const record = this.deployments.get(deploymentId);
    if (!record) {
      return {
        success: false,
        deploymentId,
        previousVersion: 'unknown',
        timestamp: Date.now(),
        error: `Deployment ${deploymentId} not found`,
      };
    }

    const previousVersion = record.version;
    record.phase = 'rolling-back';

    // Simulate rollback
    record.phase = 'rolled-back';
    record.completedAt = Date.now();

    if (this.activeDeploymentId === deploymentId) {
      this.activeDeploymentId = undefined;
    }

    return {
      success: true,
      deploymentId,
      previousVersion,
      timestamp: Date.now(),
    };
  }

  getStatus(deploymentId: string): DeploymentStatus | undefined {
    const record = this.deployments.get(deploymentId);
    if (!record) return undefined;
    return { ...record };
  }

  getActiveDeployment(): DeploymentInfo | undefined {
    if (!this.activeDeploymentId) return undefined;
    const record = this.deployments.get(this.activeDeploymentId);
    if (!record) return undefined;
    return { ...record };
  }

  getDeploymentHistory(): DeploymentRecord[] {
    return [...this.deployments.values()];
  }

  getDeploymentCount(): number {
    return this.deployments.size;
  }

  clearHistory(): void {
    this.deployments.clear();
    this.activeDeploymentId = undefined;
  }
}
