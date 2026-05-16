// src/diagnosis-engine.ts - Diagnosis Engine Module

export interface Symptom {
  source: string;
  type: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: number;
  data?: Record<string, unknown>;
}

export interface DiagnosisRule {
  id: string;
  name: string;
  conditions: (symptoms: Symptom[]) => boolean;
  cause: string;
  confidence: number;
  recommendedActions: string[];
}

export interface PossibleCause {
  cause: string;
  confidence: number;
  supportingSymptoms: string[];
  ruleId: string;
}

export interface Action {
  name: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  estimatedImpact: string;
}

export interface DiagnosisResult {
  id: string;
  primaryCause: PossibleCause;
  possibleCauses: PossibleCause[];
  recommendedActions: Action[];
  symptoms: Symptom[];
  timestamp: number;
  confidence: number;
}

interface DiagnosisRecord {
  id: string;
  result: DiagnosisResult;
  timestamp: number;
}

export class DiagnosisEngine {
  private rules: DiagnosisRule[] = [];
  private history: DiagnosisRecord[] = [];
  private ruleIdCounter = 0;
  private diagnosisIdCounter = 0;

  constructor() {
    this.addDefaultRules();
  }

  diagnose(symptoms: Symptom[]): DiagnosisResult {
    const possibleCauses = this.getPossibleCauses(symptoms);
    const primaryCause = possibleCauses.sort((a, b) => b.confidence - a.confidence)[0] ?? {
      cause: 'unknown',
      confidence: 0,
      supportingSymptoms: symptoms.map((s) => s.description),
      ruleId: 'default',
    };

    const recommendedActions = this.getRecommendedActions({
      id: `diag-${++this.diagnosisIdCounter}`,
      primaryCause,
      possibleCauses,
      recommendedActions: [],
      symptoms,
      timestamp: Date.now(),
      confidence: primaryCause.confidence,
    });

    const result: DiagnosisResult = {
      id: `diag-${this.diagnosisIdCounter}`,
      primaryCause,
      possibleCauses,
      recommendedActions,
      symptoms,
      timestamp: Date.now(),
      confidence: primaryCause.confidence,
    };

    this.history.push({ id: result.id, result, timestamp: Date.now() });
    return result;
  }

  addRule(rule: DiagnosisRule): void {
    this.rules.push(rule);
  }

  getPossibleCauses(symptoms: Symptom[]): PossibleCause[] {
    const causes: PossibleCause[] = [];
    for (const rule of this.rules) {
      if (rule.conditions(symptoms)) {
        causes.push({
          cause: rule.cause,
          confidence: rule.confidence,
          supportingSymptoms: symptoms
            .filter((s) => rule.conditions([s]))
            .map((s) => s.description),
          ruleId: rule.id,
        });
      }
    }
    return causes;
  }

  getRecommendedActions(diagnosis: DiagnosisResult): Action[] {
    const actions: Action[] = [];
    const matchingRule = this.rules.find((r) => r.id === diagnosis.primaryCause.ruleId);
    if (matchingRule) {
      for (const actionName of matchingRule.recommendedActions) {
        actions.push({
          name: actionName,
          description: `Execute ${actionName} to address ${diagnosis.primaryCause.cause}`,
          priority: diagnosis.primaryCause.confidence > 0.8 ? 'high' : 'medium',
          estimatedImpact: `Expected to resolve ${diagnosis.primaryCause.cause}`,
        });
      }
    }

    if (diagnosis.primaryCause.confidence < 0.5) {
      actions.push({
        name: 'investigate_further',
        description: 'Low confidence diagnosis, requires further investigation',
        priority: 'high',
        estimatedImpact: 'Will improve diagnosis accuracy',
      });
    }

    return actions;
  }

  getDiagnosisHistory(): DiagnosisRecord[] {
    return [...this.history];
  }

  clearHistory(): void {
    this.history = [];
  }

  getRules(): DiagnosisRule[] {
    return [...this.rules];
  }

  removeRule(ruleId: string): void {
    this.rules = this.rules.filter((r) => r.id !== ruleId);
  }

  private addDefaultRules(): void {
    this.rules.push({
      id: `rule-${++this.ruleIdCounter}`,
      name: 'Memory Leak',
      conditions: (symptoms) =>
        symptoms.some((s) => s.type === 'memory_usage' && s.severity === 'high') &&
        symptoms.some((s) => s.type === 'response_time' && s.severity !== 'low'),
      cause: 'memory_leak',
      confidence: 0.85,
      recommendedActions: ['restart_component', 'clear_cache', 'increase_resources'],
    });

    this.rules.push({
      id: `rule-${++this.ruleIdCounter}`,
      name: 'Network Failure',
      conditions: (symptoms) =>
        symptoms.some((s) => s.type === 'error_rate' && s.severity === 'critical') &&
        symptoms.some((s) => s.type === 'response_time' && s.severity === 'critical'),
      cause: 'network_failure',
      confidence: 0.9,
      recommendedActions: ['failover', 'retry_operation'],
    });

    this.rules.push({
      id: `rule-${++this.ruleIdCounter}`,
      name: 'Resource Exhaustion',
      conditions: (symptoms) =>
        symptoms.some((s) => s.type === 'memory_usage' && s.severity === 'critical') ||
        symptoms.some((s) => s.type === 'event_loop_lag' && s.severity === 'high'),
      cause: 'resource_exhaustion',
      confidence: 0.8,
      recommendedActions: ['reduce_load', 'increase_resources', 'restart_component'],
    });

    this.rules.push({
      id: `rule-${++this.ruleIdCounter}`,
      name: 'High Error Rate',
      conditions: (symptoms) =>
        symptoms.some((s) => s.type === 'error_rate' && s.severity === 'high'),
      cause: 'application_error',
      confidence: 0.7,
      recommendedActions: ['rollback_state', 'restart_component'],
    });
  }
}
