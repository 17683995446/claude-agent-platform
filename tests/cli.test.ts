// ============================================================================
// Tests for @claude-agent/cli
// ============================================================================

import { describe, test, expect } from 'bun:test';
import { ClaudeAgentCLI, ProgressBar } from '../packages/cli/src/index.js';

describe('@claude-agent/cli', () => {
  describe('ProgressBar', () => {
    test('creates with default options', () => {
      const bar = new ProgressBar(10);
      expect(bar).toBeDefined();
    });

    test('update changes progress', () => {
      const bar = new ProgressBar(10, 'test');
      bar.update(5);
      bar.complete();
      // Should not throw
    });

    test('increment increases progress', () => {
      const bar = new ProgressBar(3, 'increment');
      bar.increment();
      bar.increment();
      bar.increment();
      bar.complete();
    });

    test('complete finishes at 100%', () => {
      const bar = new ProgressBar(5, 'complete');
      bar.update(5);
      bar.complete();
    });
  });

  describe('ClaudeAgentCLI', () => {
    let cli: ClaudeAgentCLI;

    test('creates CLI instance', () => {
      cli = new ClaudeAgentCLI();
      expect(cli).toBeDefined();
    });

    test('parseArgs handles no args', () => {
      cli = new ClaudeAgentCLI();
      const parsed = cli.parseArgs(['bun', 'cli']);
      expect(parsed.command).toBeFalsy();
      expect(parsed.args).toHaveLength(0);
      expect(parsed.flags).toEqual({});
    });

    test('parseArgs handles command', () => {
      cli = new ClaudeAgentCLI();
      const parsed = cli.parseArgs(['bun', 'cli', 'run', 'task-name']);
      expect(parsed.command).toBe('run');
      expect(parsed.args).toEqual(['task-name']);
    });

    test('parseArgs handles flags', () => {
      cli = new ClaudeAgentCLI();
      const parsed = cli.parseArgs(['bun', 'cli', 'test', '--coverage', '--format=json']);
      expect(parsed.command).toBe('test');
      expect(parsed.flags['coverage']).toBe(true);
      expect(parsed.flags['format']).toBe('json');
    });

    test('parseArgs handles short flags', () => {
      cli = new ClaudeAgentCLI();
      const parsed = cli.parseArgs(['bun', 'cli', 'test', '-w']);
      expect(parsed.flags['w']).toBe(true);
    });

    test('parseArgs handles key=value flags', () => {
      cli = new ClaudeAgentCLI();
      const parsed = cli.parseArgs(['bun', 'cli', 'run', '--timeout=5000']);
      expect(parsed.flags['timeout']).toBe('5000');
    });

    test('run with --help returns 0', async () => {
      cli = new ClaudeAgentCLI();
      const exitCode = await cli.run(['bun', 'cli', '--help']);
      expect(exitCode).toBe(0);
    });

    test('run with --version returns 0', async () => {
      cli = new ClaudeAgentCLI();
      const exitCode = await cli.run(['bun', 'cli', '--version']);
      expect(exitCode).toBe(0);
    });

    test('run with no command returns 0', async () => {
      cli = new ClaudeAgentCLI();
      const exitCode = await cli.run(['bun', 'cli']);
      expect(exitCode).toBe(0);
    });

    test('run with unknown command returns 1', async () => {
      cli = new ClaudeAgentCLI();
      const exitCode = await cli.run(['bun', 'cli', 'nonexistent']);
      expect(exitCode).toBe(1);
    });

    test('run analyze command', async () => {
      cli = new ClaudeAgentCLI();
      const exitCode = await cli.run(['bun', 'cli', 'analyze', './src']);
      expect(exitCode).toBe(0);
    });

    test('run test command', async () => {
      cli = new ClaudeAgentCLI();
      const exitCode = await cli.run(['bun', 'cli', 'test']);
      expect(exitCode).toBe(0);
    });

    test('run graph command', async () => {
      cli = new ClaudeAgentCLI();
      const exitCode = await cli.run(['bun', 'cli', 'graph']);
      expect(exitCode).toBe(0);
    });

    test('run devops command', async () => {
      cli = new ClaudeAgentCLI();
      const exitCode = await cli.run(['bun', 'cli', 'devops', 'build']);
      expect(exitCode).toBe(0);
    });

    test('run design command', async () => {
      cli = new ClaudeAgentCLI();
      const exitCode = await cli.run(['bun', 'cli', 'design']);
      expect(exitCode).toBe(0);
    });

    test('run monitor command', async () => {
      cli = new ClaudeAgentCLI();
      const exitCode = await cli.run(['bun', 'cli', 'monitor']);
      expect(exitCode).toBe(0);
    });

    test('run checkpoint command', async () => {
      cli = new ClaudeAgentCLI();
      const exitCode = await cli.run(['bun', 'cli', 'checkpoint', 'list']);
      expect(exitCode).toBe(0);
    });

    test('run command without task name returns 1', async () => {
      cli = new ClaudeAgentCLI();
      const exitCode = await cli.run(['bun', 'cli', 'run']);
      expect(exitCode).toBe(1);
    });

    test('run command with task name returns 0', async () => {
      cli = new ClaudeAgentCLI();
      const exitCode = await cli.run(['bun', 'cli', 'run', 'analyze']);
      expect(exitCode).toBe(0);
    });
  });
});
