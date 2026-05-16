// ============================================================================
// Tests for @claude-agent/config-wizard
// ============================================================================
import { describe, test, expect, beforeEach } from 'bun:test';
import { ConfigWizard } from '../packages/config-wizard/src/index.js';

describe('@claude-agent/config-wizard', () => {
  let wizard: ConfigWizard;

  beforeEach(() => { wizard = ConfigWizard.createDefault(); });

  test('creates with default steps', () => {
    expect(wizard.getSteps().length).toBeGreaterThan(0);
  });

  test('gets current step', () => {
    const step = wizard.getCurrentStep();
    expect(step).toBeDefined();
    expect(step!.id).toBe('name');
  });

  test('gets progress', () => {
    const progress = wizard.getProgress();
    expect(progress.current).toBe(0);
    expect(progress.total).toBeGreaterThan(0);
    expect(progress.percent).toBe(0);
  });

  test('answers valid input', () => {
    const result = wizard.answer('MyAgent');
    expect(result.success).toBe(true);
    expect(result.next).toBeDefined();
  });

  test('rejects invalid input', () => {
    // First step requires non-empty name
    const result = wizard.answer('');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('completes all steps', () => {
    while (!wizard.isComplete()) {
      const step = wizard.getCurrentStep()!;
      let value: unknown;
      if (step.type === 'boolean') value = true;
      else if (step.type === 'number') value = 8080;
      else if (step.type === 'select') value = step.options?.[0];
      else if (step.type === 'multiselect') value = step.options?.slice(0, 1);
      else value = 'test';
      const result = wizard.answer(value);
      expect(result.success).toBe(true);
    }
    const results = wizard.getResults();
    expect(Object.keys(results).length).toBeGreaterThan(0);
  });

  test('goes back', () => {
    wizard.answer('test');
    const prev = wizard.back();
    expect(prev).toBeDefined();
    expect(wizard.getProgress().current).toBe(0);
  });

  test('resets wizard', () => {
    wizard.answer('test');
    wizard.reset();
    expect(wizard.getProgress().current).toBe(0);
    expect(wizard.isComplete()).toBe(false);
  });

  test('exports config as JSON', () => {
    wizard.answer('test');
    const json = wizard.exportConfig('json');
    const parsed = JSON.parse(json);
    expect(parsed.name).toBe('test');
  });

  test('imports config', () => {
    wizard.importConfig({ name: 'imported', logLevel: 'debug' });
    expect(wizard.getResults().name).toBe('imported');
  });

  test('adds custom step', () => {
    wizard.addStep({ id: 'custom', question: 'Custom?', type: 'string' });
    expect(wizard.getSteps().map(s => s.id)).toContain('custom');
  });

  test('removes step', () => {
    wizard.removeStep('name');
    expect(wizard.getSteps().map(s => s.id)).not.toContain('name');
  });
});
