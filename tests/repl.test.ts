// ============================================================================
// Tests for @claude-agent/repl
// ============================================================================
import { describe, test, expect, beforeEach } from 'bun:test';
import { ClaudeREPL } from '../packages/repl/src/index.js';

describe('@claude-agent/repl', () => {
  let repl: ClaudeREPL;

  beforeEach(() => { repl = new ClaudeREPL(); });

  test('registers built-in commands', () => {
    expect(repl.listCommands()).toContain('help');
    expect(repl.listCommands()).toContain('history');
    expect(repl.listCommands()).toContain('exit');
  });

  test('executes help command', async () => {
    const result = await repl.executeLine('help');
    expect(result).toContain('Available commands');
  });

  test('executes history command', async () => {
    await repl.executeLine('help');
    const result = await repl.executeLine('history');
    expect(result).toContain('help');
  });

  test('executes clear command', async () => {
    await repl.executeLine('help');
    await repl.executeLine('clear');
    expect(repl.getHistory()).toHaveLength(0);
  });

  test('executes set command', async () => {
    const result = await repl.executeLine('set name Alice');
    expect(result).toContain('Set name');
    const ctx = repl.getContext();
    expect(ctx.variables.get('name')).toBe('Alice');
  });

  test('executes vars command', async () => {
    await repl.executeLine('set x 42');
    const result = await repl.executeLine('vars');
    expect(result).toContain('x');
  });

  test('returns unknown command message', async () => {
    const result = await repl.executeLine('unknown-command');
    expect(result).toContain('Unknown command');
  });

  test('handles empty input', async () => {
    const result = await repl.executeLine('');
    expect(result).toBe('');
  });

  test('autocompletes commands', () => {
    const completions = repl.autocomplete('he');
    expect(completions).toContain('help');
  });

  test('returns all commands for empty autocomplete', () => {
    const completions = repl.autocomplete('');
    expect(completions.length).toBeGreaterThan(0);
  });

  test('manages running state', () => {
    expect(repl.isRunning()).toBe(false);
    repl.start();
    expect(repl.isRunning()).toBe(true);
    repl.stop();
    expect(repl.isRunning()).toBe(false);
  });

  test('custom prompt', () => {
    repl.setPrompt('$ ');
    expect(repl.getPrompt()).toBe('$ ');
  });

  test('registers custom command', async () => {
    repl.registerCommand({
      name: 'greet',
      description: 'Say hello',
      execute: async () => 'Hello!',
    });
    expect(repl.listCommands()).toContain('greet');
    const result = await repl.executeLine('greet');
    expect(result).toBe('Hello!');
  });

  test('unregisters custom command', () => {
    repl.registerCommand({ name: 'temp', description: 'temp', execute: async () => '' });
    repl.unregisterCommand('temp');
    expect(repl.listCommands()).not.toContain('temp');
  });

  test('variable reference', async () => {
    await repl.executeLine('set msg hello');
    const result = await repl.executeLine('msg');
    expect(result).toBe('hello');
  });
});
