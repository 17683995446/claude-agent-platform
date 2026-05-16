// ============================================================================
// Tests for @claude-agent/diagnostics
// ============================================================================
import { describe, test, expect } from 'bun:test';
import { DiagnosticsRunner } from '../packages/diagnostics/src/index.js';

describe('@claude-agent/diagnostics', () => {
  describe('DiagnosticsRunner', () => {
    test('creates default runner', () => {
      const runner = DiagnosticsRunner.createDefault();
      expect(runner.listChecks().length).toBeGreaterThan(0);
    });

    test('runs all checks', async () => {
      const runner = DiagnosticsRunner.createDefault();
      const report = await runner.runAll();
      expect(report.results.length).toBeGreaterThan(0);
      expect(report.summary.pass).toBeGreaterThan(0);
      expect(report.environment.platform).toBeDefined();
    });

    test('runs individual check', async () => {
      const runner = DiagnosticsRunner.createDefault();
      const result = await runner.runCheck('runtime');
      expect(result.name).toBe('runtime');
      expect(['pass', 'warn', 'fail']).toContain(result.status);
    });

    test('registers custom check', async () => {
      const runner = DiagnosticsRunner.createDefault();
      runner.registerCheck('custom', () => ({ name: 'custom', status: 'pass', message: 'OK' }));
      expect(runner.listChecks()).toContain('custom');
      const result = await runner.runCheck('custom');
      expect(result.status).toBe('pass');
    });

    test('unregisters check', () => {
      const runner = DiagnosticsRunner.createDefault();
      runner.registerCheck('temp', () => ({ name: 'temp', status: 'pass', message: '' }));
      runner.unregisterCheck('temp');
      expect(runner.listChecks()).not.toContain('temp');
    });

    test('handles failing check', async () => {
      const runner = new DiagnosticsRunner();
      runner.registerCheck('fail', () => { throw new Error('check failed'); });
      const report = await runner.runAll();
      expect(report.results[0]!.status).toBe('fail');
    });

    test('handles async checks', async () => {
      const runner = new DiagnosticsRunner();
      runner.registerCheck('async', async () => ({ name: 'async', status: 'pass', message: 'OK' }));
      const result = await runner.runCheck('async');
      expect(result.status).toBe('pass');
    });
  });
});
