// workflow-templates.ts - 工作流模板库

import type { WorkflowDefinition, WorkflowStep } from './workflow-engine.js';

export interface TemplateParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array';
  required: boolean;
  defaultValue?: unknown;
  description?: string;
  validation?: (value: unknown) => boolean;
}

export interface WorkflowTemplate {
  name: string;
  version: string;
  description: string;
  parameters: TemplateParameter[];
  definition: (params: Record<string, unknown>) => WorkflowDefinition;
}

export class WorkflowTemplateLibrary {
  private templates = new Map<string, WorkflowTemplate>();

  constructor() {
    this.registerBuiltInTemplates();
  }

  private registerBuiltInTemplates(): void {
    // CI/CD Pipeline Template
    this.register({
      name: 'ci-cd-pipeline',
      version: '1.0.0',
      description: 'A standard CI/CD pipeline with build, test, and deploy stages',
      parameters: [
        { name: 'projectName', type: 'string', required: true, description: 'Name of the project' },
        { name: 'buildCommand', type: 'string', required: false, defaultValue: 'npm run build', description: 'Build command' },
        { name: 'testCommand', type: 'string', required: false, defaultValue: 'npm test', description: 'Test command' },
        { name: 'deployTarget', type: 'string', required: false, defaultValue: 'production', description: 'Deployment target' },
      ],
      definition: (params) => ({
        id: `ci-cd-${params.projectName}`,
        name: `CI/CD Pipeline - ${params.projectName}`,
        version: '1.0.0',
        steps: [
          { id: 'checkout', name: 'Checkout Code', type: 'task', config: { action: 'checkout' }, next: ['install'] },
          { id: 'install', name: 'Install Dependencies', type: 'task', config: { action: 'install' }, next: ['build'] },
          { id: 'build', name: 'Build', type: 'task', config: { command: params.buildCommand }, next: ['test'], retryPolicy: { count: 2, delay: 1000, backoff: 'exponential' } },
          { id: 'test', name: 'Run Tests', type: 'task', config: { command: params.testCommand }, next: ['deploy'], onError: 'notify-failure' },
          { id: 'deploy', name: `Deploy to ${params.deployTarget}`, type: 'task', config: { target: params.deployTarget }, next: [] },
          { id: 'notify-failure', name: 'Notify Failure', type: 'task', config: { action: 'notify', type: 'failure' }, next: [] },
        ],
      }),
    });

    // Code Review Template
    this.register({
      name: 'code-review',
      version: '1.0.0',
      description: 'Code review workflow with automated checks',
      parameters: [
        { name: 'repository', type: 'string', required: true, description: 'Repository URL' },
        { name: 'branch', type: 'string', required: false, defaultValue: 'main', description: 'Target branch' },
        { name: 'minReviewers', type: 'number', required: false, defaultValue: 2, description: 'Minimum number of reviewers' },
        { name: 'autoMerge', type: 'boolean', required: false, defaultValue: false, description: 'Auto-merge after approval' },
      ],
      definition: (params) => ({
        id: `code-review-${params.repository}`,
        name: `Code Review - ${params.repository}`,
        version: '1.0.0',
        steps: [
          { id: 'lint', name: 'Run Linter', type: 'task', config: { action: 'lint' }, next: ['typecheck'] },
          { id: 'typecheck', name: 'Type Check', type: 'task', config: { action: 'typecheck' }, next: ['format-check'] },
          { id: 'format-check', name: 'Format Check', type: 'task', config: { action: 'format-check' }, next: ['request-review'] },
          { id: 'request-review', name: 'Request Review', type: 'approval', config: { minReviewers: params.minReviewers, autoApprove: false }, next: ['merge'] },
          { id: 'merge', name: 'Merge', type: 'task', config: { branch: params.branch, autoMerge: params.autoMerge }, next: [] },
        ],
      }),
    });

    // Deployment Template
    this.register({
      name: 'deployment',
      version: '1.0.0',
      description: 'Deployment workflow with health checks and rollback',
      parameters: [
        { name: 'serviceName', type: 'string', required: true, description: 'Name of the service' },
        { name: 'environment', type: 'string', required: true, description: 'Target environment' },
        { name: 'replicas', type: 'number', required: false, defaultValue: 3, description: 'Number of replicas' },
      ],
      definition: (params) => ({
        id: `deploy-${params.serviceName}-${params.environment}`,
        name: `Deploy ${params.serviceName} to ${params.environment}`,
        version: '1.0.0',
        steps: [
          { id: 'pre-check', name: 'Pre-deployment Check', type: 'task', config: { action: 'pre-check' }, next: ['deploy'] },
          { id: 'deploy', name: 'Deploy', type: 'task', config: { service: params.serviceName, environment: params.environment, replicas: params.replicas }, next: ['health-check'], retryPolicy: { count: 3, delay: 5000, backoff: 'exponential' } },
          { id: 'health-check', name: 'Health Check', type: 'task', config: { action: 'health-check' }, next: ['post-check'], onError: 'rollback' },
          { id: 'post-check', name: 'Post-deployment Check', type: 'task', config: { action: 'post-check' }, next: [] },
          { id: 'rollback', name: 'Rollback', type: 'task', config: { action: 'rollback' }, next: [] },
        ],
      }),
    });

    // Data Processing Template
    this.register({
      name: 'data-processing',
      version: '1.0.0',
      description: 'Data processing pipeline with extraction, transformation, and loading',
      parameters: [
        { name: 'source', type: 'string', required: true, description: 'Data source' },
        { name: 'destination', type: 'string', required: true, description: 'Data destination' },
        { name: 'batchSize', type: 'number', required: false, defaultValue: 1000, description: 'Batch size for processing' },
      ],
      definition: (params) => ({
        id: `data-processing-${params.source}`,
        name: `Data Processing: ${params.source} -> ${params.destination}`,
        version: '1.0.0',
        steps: [
          { id: 'extract', name: 'Extract Data', type: 'task', config: { source: params.source }, next: ['validate'] },
          { id: 'validate', name: 'Validate Data', type: 'task', config: { action: 'validate' }, next: ['transform'], onError: 'log-errors' },
          { id: 'transform', name: 'Transform Data', type: 'transform', config: { batchSize: params.batchSize }, next: ['load'] },
          { id: 'load', name: 'Load Data', type: 'task', config: { destination: params.destination }, next: ['verify'], retryPolicy: { count: 3, delay: 2000, backoff: 'fixed' } },
          { id: 'verify', name: 'Verify Load', type: 'task', config: { action: 'verify' }, next: [] },
          { id: 'log-errors', name: 'Log Validation Errors', type: 'task', config: { action: 'log' }, next: [] },
        ],
      }),
    });

    // Approval Flow Template
    this.register({
      name: 'approval-flow',
      version: '1.0.0',
      description: 'Multi-level approval workflow',
      parameters: [
        { name: 'requestType', type: 'string', required: true, description: 'Type of request' },
        { name: 'approvers', type: 'array', required: false, defaultValue: ['manager', 'director'], description: 'List of approvers' },
        { name: 'timeout', type: 'number', required: false, defaultValue: 86400000, description: 'Approval timeout in ms' },
      ],
      definition: (params) => ({
        id: `approval-${params.requestType}`,
        name: `Approval Flow: ${params.requestType}`,
        version: '1.0.0',
        steps: [
          { id: 'submit', name: 'Submit Request', type: 'task', config: { type: params.requestType }, next: ['manager-approval'] },
          { id: 'manager-approval', name: 'Manager Approval', type: 'approval', config: { role: 'manager', autoApprove: false }, next: ['director-approval'], timeout: params.timeout as number },
          { id: 'director-approval', name: 'Director Approval', type: 'approval', config: { role: 'director', autoApprove: false }, next: ['execute'], timeout: params.timeout as number },
          { id: 'execute', name: 'Execute Request', type: 'task', config: { action: 'execute' }, next: [] },
        ],
      }),
    });

    // Incident Response Template
    this.register({
      name: 'incident-response',
      version: '1.0.0',
      description: 'Automated incident response workflow',
      parameters: [
        { name: 'incidentId', type: 'string', required: true, description: 'Incident identifier' },
        { name: 'severity', type: 'string', required: false, defaultValue: 'medium', description: 'Incident severity' },
        { name: 'autoRemediate', type: 'boolean', required: false, defaultValue: false, description: 'Enable auto-remediation' },
      ],
      definition: (params) => ({
        id: `incident-${params.incidentId}`,
        name: `Incident Response: ${params.incidentId}`,
        version: '1.0.0',
        steps: [
          { id: 'detect', name: 'Detect Incident', type: 'task', config: { incidentId: params.incidentId }, next: ['assess'] },
          { id: 'assess', name: 'Assess Severity', type: 'task', config: { severity: params.severity }, next: ['notify'] },
          { id: 'notify', name: 'Notify Team', type: 'task', config: { action: 'notify', severity: params.severity }, next: ['remediate'] },
          { id: 'remediate', name: 'Auto-Remediate', type: 'task', config: { autoRemediate: params.autoRemediate }, next: ['verify-fix'], onError: 'escalate' },
          { id: 'verify-fix', name: 'Verify Fix', type: 'task', config: { action: 'verify' }, next: ['post-mortem'] },
          { id: 'post-mortem', name: 'Post-Mortem', type: 'task', config: { action: 'post-mortem' }, next: [] },
          { id: 'escalate', name: 'Escalate', type: 'task', config: { action: 'escalate' }, next: [] },
        ],
      }),
    });
  }

  /**
   * Register a custom template.
   */
  register(template: WorkflowTemplate): void {
    this.templates.set(template.name, template);
  }

  /**
   * Get a template by name.
   */
  getTemplate(name: string): WorkflowTemplate | undefined {
    return this.templates.get(name);
  }

  /**
   * List all available templates.
   */
  listTemplates(): WorkflowTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * Instantiate a template with parameters.
   */
  instantiate(name: string, params: Record<string, unknown>): WorkflowDefinition {
    const template = this.templates.get(name);
    if (!template) {
      throw new Error(`Template "${name}" not found`);
    }

    // Validate parameters
    for (const param of template.parameters) {
      if (param.required && !(param.name in params) && param.defaultValue === undefined) {
        throw new Error(`Required parameter "${param.name}" is missing for template "${name}"`);
      }
      const value = params[param.name] ?? param.defaultValue;
      if (param.validation && value !== undefined && !param.validation(value)) {
        throw new Error(`Validation failed for parameter "${param.name}" in template "${name}"`);
      }
    }

    // Apply defaults
    const resolvedParams: Record<string, unknown> = { ...params };
    for (const param of template.parameters) {
      if (!(param.name in resolvedParams) && param.defaultValue !== undefined) {
        resolvedParams[param.name] = param.defaultValue;
      }
    }

    return template.definition(resolvedParams);
  }

  /**
   * Export a template to JSON format.
   */
  exportTemplate(name: string): string | undefined {
    const template = this.templates.get(name);
    if (!template) return undefined;
    return JSON.stringify({
      name: template.name,
      version: template.version,
      description: template.description,
      parameters: template.parameters,
    }, null, 2);
  }

  /**
   * Import a template from JSON format.
   * Note: The definition function cannot be serialized, so imported templates
   * need to have their definition function registered separately.
   */
  importTemplate(json: string, definitionFn: (params: Record<string, unknown>) => WorkflowDefinition): void {
    const data = JSON.parse(json);
    this.register({
      name: data.name,
      version: data.version,
      description: data.description,
      parameters: data.parameters ?? [],
      definition: definitionFn,
    });
  }

  /**
   * Remove a template.
   */
  removeTemplate(name: string): boolean {
    return this.templates.delete(name);
  }
}
