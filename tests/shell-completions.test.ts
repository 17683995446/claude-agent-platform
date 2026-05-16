// ============================================================================
// Tests for @claude-agent/shell-completions
// ============================================================================
import { describe, test, expect } from 'bun:test';
import { ShellCompletionGenerator } from '../packages/shell-completions/src/index.js';

describe('@claude-agent/shell-completions', () => {
  let generator: ShellCompletionGenerator;

  test('creates default generator', () => {
    generator = ShellCompletionGenerator.createDefault();
    expect(generator).toBeDefined();
  });

  describe('generateBash', () => {
    test('generates bash completion script', () => {
      generator = ShellCompletionGenerator.createDefault();
      const script = generator.generateBash();
      expect(script).toContain('claude-agent');
      expect(script).toContain('complete -F');
      expect(script).toContain('run');
      expect(script).toContain('analyze');
    });
  });

  describe('generateZsh', () => {
    test('generates zsh completion script', () => {
      generator = ShellCompletionGenerator.createDefault();
      const script = generator.generateZsh();
      expect(script).toContain('#compdef claude-agent');
      expect(script).toContain('run');
    });
  });

  describe('generateFish', () => {
    test('generates fish completion script', () => {
      generator = ShellCompletionGenerator.createDefault();
      const script = generator.generateFish();
      expect(script).toContain('complete -c claude-agent');
      expect(script).toContain('run');
    });
  });

  describe('generatePowerShell', () => {
    test('generates PowerShell completion script', () => {
      generator = ShellCompletionGenerator.createDefault();
      const script = generator.generatePowerShell();
      expect(script).toContain('Register-ArgumentCompleter');
      expect(script).toContain('claude-agent');
    });
  });
});
