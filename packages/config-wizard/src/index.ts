// ============================================================================
// @claude-agent/config-wizard - Configuration Wizard
// ============================================================================

export interface WizardStep {
  id: string;
  question: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'multiselect';
  defaultValue?: unknown;
  options?: string[];
  validate?: (value: unknown) => string | null;
  description?: string;
}

export interface WizardResult {
  [key: string]: unknown;
}

export class ConfigWizard {
  private steps: WizardStep[] = [];
  private currentStep: number = 0;
  private results: WizardResult = {};
  private history: { step: number; answer: unknown }[] = [];

  addStep(step: WizardStep): this {
    this.steps.push(step);
    return this;
  }

  removeStep(id: string): this {
    this.steps = this.steps.filter(s => s.id !== id);
    return this;
  }

  getSteps(): WizardStep[] {
    return [...this.steps];
  }

  getCurrentStep(): WizardStep | null {
    return this.steps[this.currentStep] ?? null;
  }

  getProgress(): { current: number; total: number; percent: number } {
    return {
      current: this.currentStep,
      total: this.steps.length,
      percent: this.steps.length > 0 ? Math.round((this.currentStep / this.steps.length) * 100) : 0,
    };
  }

  answer(value: unknown): { success: boolean; error?: string; next?: WizardStep; complete?: boolean } {
    const step = this.steps[this.currentStep];
    if (!step) return { success: false, error: 'No current step' };

    // Coerce type
    let coerced = value;
    if (step.type === 'number') coerced = Number(value);
    if (step.type === 'boolean') {
      if (typeof value === 'string') coerced = value.toLowerCase() === 'true' || value === 'y' || value === 'yes';
    }

    // Validate
    if (step.validate) {
      const error = step.validate(coerced);
      if (error) return { success: false, error };
    }

    this.results[step.id] = coerced;
    this.history.push({ step: this.currentStep, answer: coerced });
    this.currentStep++;

    if (this.currentStep >= this.steps.length) {
      return { success: true, complete: true };
    }

    return { success: true, next: this.steps[this.currentStep] };
  }

  back(): WizardStep | null {
    if (this.history.length === 0) return null;
    const last = this.history.pop()!;
    this.currentStep = last.step;
    delete this.results[this.steps[this.currentStep]?.id ?? ''];
    return this.steps[this.currentStep] ?? null;
  }

  getResults(): WizardResult {
    return { ...this.results };
  }

  reset(): void {
    this.currentStep = 0;
    this.results = {};
    this.history = [];
  }

  isComplete(): boolean {
    return this.currentStep >= this.steps.length;
  }

  exportConfig(format: 'json' = 'json'): string {
    if (format === 'json') return JSON.stringify(this.results, null, 2);
    throw new Error(`Unsupported format: ${format}`);
  }

  importConfig(config: WizardResult): void {
    for (const step of this.steps) {
      if (config[step.id] !== undefined) {
        this.results[step.id] = config[step.id];
        this.history.push({ step: this.currentStep, answer: config[step.id] });
        this.currentStep++;
      }
    }
  }

  static createDefault(): ConfigWizard {
    const wizard = new ConfigWizard();
    wizard.addStep({
      id: 'name',
      question: 'What is your agent name?',
      type: 'string',
      defaultValue: 'claude-agent',
      validate: (v) => typeof v === 'string' && v.length > 0 ? null : 'Name must be non-empty',
    });
    wizard.addStep({
      id: 'logLevel',
      question: 'Select log level:',
      type: 'select',
      options: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'],
      defaultValue: 'info',
    });
    wizard.addStep({
      id: 'httpEnabled',
      question: 'Enable HTTP server?',
      type: 'boolean',
      defaultValue: false,
    });
    wizard.addStep({
      id: 'port',
      question: 'HTTP port:',
      type: 'number',
      defaultValue: 3000,
      validate: (v) => typeof v === 'number' && v >= 1 && v <= 65535 ? null : 'Port must be 1-65535',
    });
    wizard.addStep({
      id: 'features',
      question: 'Select features:',
      type: 'multiselect',
      options: ['eventSourcing', 'commandBus', 'snapshotOptimization', 'autoUpdate'],
      defaultValue: ['commandBus'],
    });
    return wizard;
  }
}
