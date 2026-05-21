// src/auto-repair.ts - Auto Repair Engine Module

import type { AnomalyDetector, AnomalyReport } from './anomaly-detector.js';
import type { DiagnosisEngine, DiagnosisResult, Symptom } from './diagnosis-engine.js';
import type { RecoveryStrategyRegistry, RecoveryContext } from './recovery-strategies.js';

export type AutonomyLevel = 'manual_confirm' | 'auto_with_approval' | 'fully_auto';

export interface Issue {
  id: string;
  componentId: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  detectedAt: number;
  anomalies?: AnomalyReport[];
  symptoms?: Symptom[];
}

export interface RepairResult {
  success: boolean;
  issueId: string;
  strategiesAttempted: string[];
  duration: number;
  message: string;
  requiresApproval: boolean;
  approved?: boolean;
}

export interface RepairRecord {
  id: string;
  issue: Issue;
  diagnosis: DiagnosisResult | null;
  strategiesAttempted: string[];
  result: RepairResult;
  timestamp: number;
}

export interface RepairStats {
  totalRepairs: number;
  successfulRepairs: number;
  failedRepairs: number;
  pendingApprovals: number;
  averageRepairTime: number;
  repairsByHour: number;
}

export interface RepairConfig {
  autonomyLevel: AutonomyLevel;
  maxRepairsPerHour: number;
  blacklist: string[];
  notificationCallback?: (result: RepairResult) => void;
}

export class AutoRepairEngine {
  private anomalyDetector: AnomalyDetector;
  private diagnosisEngine: DiagnosisEngine;
  private strategyRegistry: RecoveryStrategyRegistry;
  private config: RepairConfig;
  private repairHistory: RepairRecord[] = [];
  private running = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private repairsThisHour: number[] = [];
  private issueIdCounter = 0;
  private pendingApprovals = new Map<string, { issue: Issue; diagnosis: DiagnosisResult }>();
  private bypassApproval = false;

  constructor(
    anomalyDetector: AnomalyDetector,
    diagnosisEngine: DiagnosisEngine,
    strategyRegistry: RecoveryStrategyRegistry,
    config?: Partial<RepairConfig>,
  ) {
    this.anomalyDetector = anomalyDetector;
    this.diagnosisEngine = diagnosisEngine;
    this.strategyRegistry = strategyRegistry;
    this.config = {
      autonomyLevel: 'auto_with_approval',
      maxRepairsPerHour: 10,
      blacklist: [],
      ...config,
    };
  }

  startAutoRepair(intervalMs = 10000): void {
    if (this.running) return;
    this.running = true;
    this.intervalId = setInterval(() => {
      this.runRepairCycle().catch(() => {});
    }, intervalMs);
  }

  stopAutoRepair(): void {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  async triggerRepair(issue: Issue): Promise<RepairResult> {
    // Check blacklist
    if (this.config.blacklist.includes(issue.description)) {
      return {
        success: false,
        issueId: issue.id,
        strategiesAttempted: [],
        duration: 0,
        message: 'Issue is blacklisted from auto-repair',
        requiresApproval: false,
      };
    }

    // Check rate limit
    if (!this.canRepair()) {
      return {
        success: false,
        issueId: issue.id,
        strategiesAttempted: [],
        duration: 0,
        message: 'Rate limit exceeded: max repairs per hour reached',
        requiresApproval: false,
      };
    }

    const startTime = Date.now();

    // Convert anomalies to symptoms
    const symptoms: Symptom[] = (issue.anomalies ?? []).map((a) => ({
      source: 'anomaly_detector',
      type: a.metric,
      description: a.message,
      severity: a.severity,
      timestamp: a.timestamp,
    }));
    symptoms.push(...(issue.symptoms ?? []));

    // Diagnose
    const diagnosis = this.diagnosisEngine.diagnose(symptoms);

    // Check if approval needed
    if (!this.bypassApproval && (this.config.autonomyLevel === 'manual_confirm' || 
        (this.config.autonomyLevel === 'auto_with_approval' && issue.severity === 'critical'))) {
      this.pendingApprovals.set(issue.id, { issue, diagnosis });
      const result: RepairResult = {
        success: false,
        issueId: issue.id,
        strategiesAttempted: [],
        duration: Date.now() - startTime,
        message: 'Awaiting manual approval',
        requiresApproval: true,
      };
      // Don't count pending approvals against rate limit
      this.repairHistory.push({
        id: `repair-${Date.now()}`,
        issue,
        diagnosis,
        strategiesAttempted: [],
        result,
        timestamp: Date.now(),
      });
      return result;
    }

    // Select and execute strategies
    const strategies = this.strategyRegistry.select({
      primaryCause: diagnosis.primaryCause.cause,
      severity: issue.severity,
      recommendedActions: diagnosis.recommendedActions.map((a) => a.name),
    });

    const attempted: string[] = [];
    let lastResult: RecoveryResult | null = null;

    for (const strategy of strategies) {
      const context: RecoveryContext = {
        componentId: issue.componentId,
        diagnosis: diagnosis.primaryCause.cause,
        severity: issue.severity,
        previousAttempts: attempted,
      };

      lastResult = await this.strategyRegistry.execute(strategy, context);
      attempted.push(strategy.name);

      if (lastResult.success) break;
    }

    const duration = Date.now() - startTime;
    const result: RepairResult = {
      success: lastResult?.success ?? false,
      issueId: issue.id,
      strategiesAttempted: attempted,
      duration,
      message: lastResult?.message ?? 'No strategies available',
      requiresApproval: false,
    };

    this.recordRepair(issue, diagnosis, attempted, result);

    // Notify
    if (this.config.notificationCallback) {
      this.config.notificationCallback(result);
    }

    return result;
  }

  approveRepair(issueId: string): Promise<RepairResult> {
    const pending = this.pendingApprovals.get(issueId);
    if (!pending) {
      return Promise.resolve({
        success: false,
        issueId,
        strategiesAttempted: [],
        duration: 0,
        message: 'No pending approval found for this issue',
        requiresApproval: false,
      });
    }
    this.pendingApprovals.delete(issueId);
    // Preserve original severity instead of downgrading to 'medium'
    this.bypassApproval = true;
    try {
      return this.triggerRepair({ ...pending.issue });
    } finally {
      this.bypassApproval = false;
    }
  }

  getRepairHistory(): RepairRecord[] {
    return [...this.repairHistory];
  }

  getRepairStats(): RepairStats {
    const total = this.repairHistory.length;
    const successful = this.repairHistory.filter((r) => r.result.success).length;
    const failed = total - successful;
    const pending = this.pendingApprovals.size;
    const avgTime =
      total > 0
        ? this.repairHistory.reduce((sum, r) => sum + r.result.duration, 0) / total
        : 0;
    const now = Date.now();
    const recentRepairs = this.repairsThisHour.filter((t) => now - t < 3600000);
    this.repairsThisHour = recentRepairs;

    return {
      totalRepairs: total,
      successfulRepairs: successful,
      failedRepairs: failed,
      pendingApprovals: pending,
      averageRepairTime: avgTime,
      repairsByHour: recentRepairs.length,
    };
  }

  getPendingApprovals(): string[] {
    return [...this.pendingApprovals.keys()];
  }

  setAutonomyLevel(level: AutonomyLevel): void {
    this.config.autonomyLevel = level;
  }

  getAutonomyLevel(): AutonomyLevel {
    return this.config.autonomyLevel;
  }

  addToBlacklist(issue: string): void {
    this.config.blacklist.push(issue);
  }

  removeFromBlacklist(issue: string): void {
    this.config.blacklist = this.config.blacklist.filter((b) => b !== issue);
  }

  private async runRepairCycle(): Promise<void> {
    const anomalies = this.anomalyDetector.detect();
    if (anomalies.length === 0) return;

    const criticalAnomalies = anomalies.filter((a) => a.severity === 'critical' || a.severity === 'high');
    if (criticalAnomalies.length === 0) return;

    const issue: Issue = {
      id: `issue-${++this.issueIdCounter}`,
      componentId: 'auto-detected',
      description: `Auto-detected: ${criticalAnomalies.map((a) => a.metric).join(', ')}`,
      severity: criticalAnomalies[0]!.severity,
      detectedAt: Date.now(),
      anomalies: criticalAnomalies,
    };

    await this.triggerRepair(issue);
  }

  private canRepair(): boolean {
    const now = Date.now();
    const recentRepairs = this.repairsThisHour.filter((t) => now - t < 3600000);
    this.repairsThisHour = recentRepairs;
    return recentRepairs.length < this.config.maxRepairsPerHour;
  }

  private recordRepair(issue: Issue, diagnosis: DiagnosisResult, attempted: string[], result: RepairResult): void {
    this.repairHistory.push({
      id: `repair-${Date.now()}`,
      issue,
      diagnosis,
      strategiesAttempted: attempted,
      result,
      timestamp: Date.now(),
    });
    this.repairsThisHour.push(Date.now());
  }
}
