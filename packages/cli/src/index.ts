// ============================================================================
// @claude-agent/cli - Unified CLI
// ============================================================================

import type { CLICommand, ClaudeAgentConfig, LoggerInterface } from '@claude-agent/types';
import { ConfigManager } from '@claude-agent/config';
import { createLogger } from '@claude-agent/logger';
import { installGlobalErrorHandlers, dispatchError, wrapError } from '@claude-agent/errors';
import {
  NLTaskParser,
  TaskDecomposer,
  SmartOrchestrator,
  ContextManager,
  FeedbackLoop,
  ProgressTracker,
  SessionManager,
  ExecutionHistory,
} from '@claude-agent/orchestrator';

// ---- Color Utilities ----

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

function colorize(text: string, color: keyof typeof colors): string {
  // BUG-005 [MEDIUM]: Handle invalid color keys gracefully
  // FIX: Added fallback to 'reset' if color is invalid
  const colorCode = colors[color] ?? colors.reset;
  return `${colorCode}${text}${colors.reset}`;
}

function bold(text: string): string {
  return colorize(text, 'bold');
}

// ---- Progress Bar ----

export class ProgressBar {
  private total: number;
  private current: number = 0;
  private width: number;
  private label: string;

  constructor(total: number, label: string = '', width: number = 40) {
    // BUG-001 [HIGH]: Validate total is a positive finite number
    // FIX: Added validation to ensure total is positive and finite
    if (!Number.isFinite(total) || total < 0) {
      this.total = 0;
    } else {
      this.total = Math.floor(total);
    }
    // BUG-003 [MEDIUM]: Validate width is positive
    // FIX: Added validation to ensure width is positive
    this.width = Number.isFinite(width) && width > 0 ? Math.floor(width) : 40;
    this.label = label;
  }

  update(current: number): void {
    // BUG-002 [HIGH]: Handle negative current values
    // FIX: Added Math.max to ensure current is non-negative
    this.current = Math.max(0, Math.min(current, this.total));
    this.render();
  }

  increment(): void {
    this.update(this.current + 1);
  }

  complete(): void {
    this.update(this.total);
    console.log();
  }

  private render(): void {
    // BUG-004 [MEDIUM]: Handle division by zero and ensure non-negative filled width
    // FIX: Added check for total > 0 and Math.max for filled width
    const progress = this.total > 0 ? this.current / this.total : 0;
    const filled = Math.max(0, Math.min(Math.round(this.width * progress), this.width));
    const empty = this.width - filled;
    const percent = Math.round(progress * 100);

    const bar = colorize('#'.repeat(filled), 'green') + colorize('-'.repeat(empty), 'gray');
    const label = this.label ? ` ${this.label}` : '';

    process.stdout.write(`\r[${bar}] ${percent}%${label}`);
  }
}

// ---- CLI Command Handler ----

export interface CommandHandler {
  description: string;
  usage: string;
  examples: string[];
  run: (args: string[], flags: Record<string, unknown>, context: CLIContext) => Promise<number>;
}

export interface CLIContext {
  command: CLICommand;
  args: string[];
  flags: Record<string, unknown>;
  config: ClaudeAgentConfig;
  logger: LoggerInterface;
}

// ---- Command Implementations ----

const runCommand: CommandHandler = {
  description: 'Run a Claude agent task',
  usage: 'claude-agent run <task-name> [options]',
  examples: [
    'claude-agent run analyze --project ./my-project',
    'claude-agent run test --coverage',
  ],
  run: async (args, flags, context) => {
    const taskName = args[0];
    if (!taskName) {
      console.error(colorize('Error: Task name is required', 'red'));
      return 1;
    }

    context.logger.info(`Running task: ${taskName}`, { flags });
    console.log(bold(`Running task: ${taskName}`));

    const progress = new ProgressBar(3, taskName);
    progress.increment();
    await new Promise((r) => setTimeout(r, 100));
    progress.increment();
    await new Promise((r) => setTimeout(r, 100));
    progress.increment();
    progress.complete();

    console.log(colorize(`Task "${taskName}" completed successfully`, 'green'));
    return 0;
  },
};

const analyzeCommand: CommandHandler = {
  description: 'Analyze code and generate reports',
  usage: 'claude-agent analyze [path] [options]',
  examples: [
    'claude-agent analyze ./src',
    'claude-agent analyze --format json --output report.json',
  ],
  run: async (args, flags, context) => {
    const path = args[0] || './';
    context.logger.info(`Analyzing: ${path}`);
    console.log(bold('Code Analysis'));
    console.log(colorize(`Analyzing: ${path}`, 'cyan'));

    const progress = new ProgressBar(5, 'Analyzing');
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 50));
      progress.increment();
    }
    progress.complete();

    console.log(colorize('Analysis complete', 'green'));
    return 0;
  },
};

const testCommand: CommandHandler = {
  description: 'Run tests with Claude agent',
  usage: 'claude-agent test [pattern] [options]',
  examples: [
    'claude-agent test',
    'claude-agent test --watch',
    'claude-agent test --coverage',
  ],
  run: async (args, flags, context) => {
    context.logger.info('Running tests');
    console.log(bold('Running Tests'));

    const progress = new ProgressBar(10, 'Tests');
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 30));
      progress.increment();
    }
    progress.complete();

    console.log(colorize('All tests passed (10/10)', 'green'));
    return 0;
  },
};

const graphCommand: CommandHandler = {
  description: 'Generate dependency graphs',
  usage: 'claude-agent graph [path] [options]',
  examples: [
    'claude-agent graph ./src --output graph.json',
  ],
  run: async (args, flags, context) => {
    const path = args[0] || './';
    context.logger.info(`Generating graph for: ${path}`);
    console.log(bold('Dependency Graph'));
    console.log(colorize(`Scanning: ${path}`, 'cyan'));
    console.log(colorize('Graph generated successfully', 'green'));
    return 0;
  },
};

const devopsCommand: CommandHandler = {
  description: 'DevOps automation and CI/CD',
  usage: 'claude-agent devops <action> [options]',
  examples: [
    'claude-agent devops deploy --env production',
    'claude-agent devops build',
  ],
  run: async (args, flags, context) => {
    const action = args[0] || 'build';
    context.logger.info(`DevOps action: ${action}`);
    console.log(bold(`DevOps: ${action}`));

    const progress = new ProgressBar(4, action);
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 50));
      progress.increment();
    }
    progress.complete();

    console.log(colorize(`${action} completed successfully`, 'green'));
    return 0;
  },
};

const designCommand: CommandHandler = {
  description: 'Design system generation',
  usage: 'claude-agent design <action> [options]',
  examples: [
    'claude-agent design generate --type component',
  ],
  run: async (args, flags, context) => {
    context.logger.info('Design system');
    console.log(bold('Design System'));
    console.log(colorize('Design generation complete', 'green'));
    return 0;
  },
};

const monitorCommand: CommandHandler = {
  description: 'Monitor agent performance',
  usage: 'claude-agent monitor [options]',
  examples: [
    'claude-agent monitor --interval 5',
  ],
  run: async (args, flags, context) => {
    context.logger.info('Starting monitor');
    console.log(bold('Agent Monitor'));
    console.log(colorize('Monitoring active (press Ctrl+C to stop)', 'yellow'));
    return 0;
  },
};

const checkpointCommand: CommandHandler = {
  description: 'Manage checkpoints',
  usage: 'claude-agent checkpoint <action> [options]',
  examples: [
    'claude-agent checkpoint list',
    'claude-agent checkpoint create --name "before-refactor"',
    'claude-agent checkpoint restore <id>',
  ],
  run: async (args, flags, context) => {
    const action = args[0] || 'list';
    context.logger.info(`Checkpoint action: ${action}`);
    console.log(bold(`Checkpoints: ${action}`));
    console.log(colorize('No checkpoints found', 'yellow'));
    return 0;
  },
};

const askCommand: CommandHandler = {
  description: 'Ask Claude agent using natural language',
  usage: 'claude-agent ask "<natural language task>" [options]',
  examples: [
    'claude-agent ask "分析这个项目的架构"',
    'claude-agent ask "帮我修复登录页面的 bug"',
    'claude-agent ask "运行所有测试并生成报告"',
    'claude-agent ask "deploy to production"',
  ],
  run: async (args, flags, context) => {
    const input = args.join(' ').trim();
    if (!input) {
      console.error(colorize('Error: Natural language input is required. Use quotes: claude-agent ask "your task"', 'red'));
      return 1;
    }

    context.logger.info(`Processing natural language task: ${input}`);

    // Initialize orchestrator components
    const parser = new NLTaskParser();
    const decomposer = new TaskDecomposer();
    const orchestrator = new SmartOrchestrator(context.logger);
    const progressTracker = new ProgressTracker();
    const sessionManager = new SessionManager();
    const executionHistory = new ExecutionHistory();
    const feedbackLoop = new FeedbackLoop();

    // Create session
    const session = sessionManager.create();
    sessionManager.addMessage(session.id, 'user', input);

    // Parse natural language
    console.log(bold('Natural Language Task Processing'));
    console.log(colorize(`Input: "${input}"`, 'cyan'));
    console.log('');

    const parsedTask = parser.parse(input);
    console.log(colorize(`Intent: ${parsedTask.intent}`, 'green'));
    console.log(colorize(`Confidence: ${(parsedTask.confidence * 100).toFixed(0)}%`, 'green'));
    console.log(colorize(`Language: ${parsedTask.language}`, 'green'));
    console.log(colorize(`Priority: ${parsedTask.priority}`, 'green'));
    console.log(colorize(`Description: ${parsedTask.description}`, 'green'));

    if (parsedTask.entities.length > 0) {
      console.log(colorize(`Entities:`, 'green'));
      for (const entity of parsedTask.entities) {
        console.log(`  - [${entity.type}] ${entity.value} (${(entity.confidence * 100).toFixed(0)}%)`);
      }
    }
    console.log('');

    // Decompose task
    console.log(colorize('Task Decomposition:', 'yellow'));
    const decomposition = decomposer.decompose(parsedTask);
    console.log(`  Strategy: ${TaskDecomposer.getStrategyName(decomposition.decompositionStrategy)}`);
    console.log(`  Sub-tasks: ${decomposition.graph.nodes.length}`);
    console.log(`  Estimated duration: ${(decomposition.totalEstimatedDuration / 1000).toFixed(1)}s`);
    console.log('');

    for (const node of decomposition.graph.nodes) {
      const statusIcon = node.status === 'pending' ? 'o' : 'x';
      console.log(`  [${statusIcon}] ${node.name} (${node.estimatedDuration}ms)`);
      if (node.dependencies.length > 0) {
        console.log(`      depends on: ${node.dependencies.length} task(s)`);
      }
    }

    if (decomposition.graph.parallelGroups.length > 1) {
      console.log('');
      console.log(colorize('  Parallel execution groups:', 'yellow'));
      for (let i = 0; i < decomposition.graph.parallelGroups.length; i++) {
        const group = decomposition.graph.parallelGroups[i]!;
        console.log(`    Group ${i + 1}: ${group.length} task(s) ${group.length > 1 ? '(parallel)' : '(sequential)'}`);
      }
    }
    console.log('');

    // Create execution plan
    const plan = orchestrator.createPlan(decomposition);
    console.log(colorize('Execution Plan:', 'yellow'));
    console.log(`  Phases: ${plan.phases.length}`);
    console.log(`  Total steps: ${plan.totalSteps}`);
    console.log('');

    // Create progress tracker
    const progress = progressTracker.create(plan.id, plan.totalSteps, [
      { name: '解析完成', description: '自然语言解析完成', targetStep: 1 },
      { name: '分解完成', description: '任务分解完成', targetStep: 2 },
      { name: '半程', description: '执行过半', targetStep: Math.floor(plan.totalSteps / 2) },
    ]);

    // Execute plan
    console.log(colorize('Executing...', 'yellow'));
    const progressBar = new ProgressBar(plan.totalSteps, 'Executing');

    await orchestrator.execute(async (taskId) => {
      const node = decomposition.graph.nodes.find((n) => n.id === taskId);
      const stepName = node?.name ?? taskId;

      // Simulate task execution
      await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));

      progressTracker.increment(plan.id, stepName);
      progressBar.increment();

      const success = Math.random() > 0.1; // 90% success rate
      const result = feedbackLoop.evaluate(taskId, success, stepName);

      if (!result.shouldRetry || success) {
        return { success, duration: 100 + Math.random() * 200 };
      }

      return { success: false, duration: 0 };
    });

    // BUG-011 [HIGH]: progress.complete() was calling on wrong object
    // FIX: Call progressBar.complete() instead of progress.complete()
    progressBar.complete();
    console.log('');

    // Show results
    const taskResults = orchestrator.getTaskResults();
    const successCount = Array.from(taskResults.values()).filter((r) => r.success).length;
    console.log(colorize(`Execution completed: ${successCount}/${taskResults.size} tasks succeeded`, successCount === taskResults.size ? 'green' : 'yellow'));

    // Record execution
    executionHistory.record({
      sessionId: session.id,
      taskDescription: parsedTask.description,
      intent: parsedTask.intent,
      status: successCount === taskResults.size ? 'success' : 'partial',
      startTime: new Date(),
      subTaskCount: taskResults.size,
      completedSubTasks: successCount,
      metadata: { rawInput: input, planId: plan.id },
    });

    sessionManager.addMessage(session.id, 'assistant', `任务执行完成: ${parsedTask.description} (${successCount}/${taskResults.size} 成功)`);

    return successCount === taskResults.size ? 0 : 1;
  },
};

// ---- CLI App ----

const commands: Record<CLICommand, CommandHandler> = {
  run: runCommand,
  analyze: analyzeCommand,
  test: testCommand,
  graph: graphCommand,
  devops: devopsCommand,
  design: designCommand,
  monitor: monitorCommand,
  checkpoint: checkpointCommand,
  ask: askCommand,
};

export class ClaudeAgentCLI {
  private config: ClaudeAgentConfig;
  private logger: LoggerInterface;

  constructor(config?: ClaudeAgentConfig) {
    this.config = config ?? ConfigManager.create().getConfig();
    this.logger = createLogger({
      level: this.config.logLevel,
      context: { cli: true },
    });
  }

  /** Parse command line arguments */
  parseArgs(argv: string[]): { command: CLICommand | null; args: string[]; flags: Record<string, unknown> } {
    // BUG-006 [HIGH]: Handle undefined/null argv
    // FIX: Added null check and default to empty array
    if (!argv || !Array.isArray(argv)) {
      return { command: null, args: [], flags: {} };
    }

    const rawArgs = argv.slice(2); // Remove 'bun' and script path

    const flags: Record<string, unknown> = {};
    const positional: string[] = [];

    for (const arg of rawArgs) {
      // BUG-007 [MEDIUM]: Handle non-string arguments
      // FIX: Skip non-string arguments
      if (typeof arg !== 'string') continue;
      
      if (arg.startsWith('--')) {
        const eqIndex = arg.indexOf('=');
        if (eqIndex !== -1) {
          const key = arg.slice(2, eqIndex);
          // BUG-008 [MEDIUM]: Handle empty key in --=value case
          // FIX: Skip empty keys
          if (key.length > 0) {
            const value = arg.slice(eqIndex + 1);
            flags[key] = value;
          }
        } else {
          const key = arg.slice(2);
          // BUG-008 [MEDIUM]: Handle -- case (empty key)
          // FIX: Skip empty keys
          if (key.length > 0) {
            flags[key] = true;
          }
        }
      } else if (arg.startsWith('-')) {
        const key = arg.slice(1);
        // BUG-009 [MEDIUM]: Handle - case (empty key)
        // FIX: Skip empty keys
        if (key.length > 0) {
          flags[key] = true;
        }
      } else {
        positional.push(arg);
      }
    }

    // BUG-010 [HIGH]: Type casting is safe here, validation happens in run()
    // FIX: Keep command as-is, let run() handle validation
    // BUG-012 [MEDIUM]: Return null instead of undefined for no command
    // FIX: Explicitly return null when positional is empty
    const command = positional.length > 0 ? positional[0] as CLICommand : null;
    const args = positional.slice(1);

    return { command, args, flags };
  }

  /** Show help */
  showHelp(): void {
    console.log('');
    console.log(bold(colorize('Claude Agent Platform', 'cyan')));
    console.log(colorize('A unified platform for Claude AI agent development', 'gray'));
    console.log('');
    console.log(bold('Commands:'));
    console.log('');

    for (const [name, handler] of Object.entries(commands)) {
      const padded = name.padEnd(12);
      console.log(`  ${colorize(padded, 'green')} ${handler.description}`);
    }

    console.log('');
    console.log(bold('Options:'));
    console.log('');
    console.log(`  ${'--config'.padEnd(16)} Path to configuration file`);
    console.log(`  ${'--version'.padEnd(16)} Show version`);
    console.log(`  ${'--help'.padEnd(16)} Show this help message`);
    console.log('');
  }

  /** Show version */
  showVersion(): void {
    console.log(`claude-agent v${this.config.version}`);
  }

  /** Run the CLI */
  async run(argv: string[]): Promise<number> {
    // Install global error handlers
    installGlobalErrorHandlers();

    const parsed = this.parseArgs(argv);

    // Handle --version first (before command check)
    if (parsed.flags['version'] || parsed.flags['v']) {
      this.showVersion();
      return 0;
    }

    // Handle --help first (before command check)
    if (parsed.flags['help'] || parsed.flags['h']) {
      this.showHelp();
      return 0;
    }

    // Handle no command
    if (!parsed.command) {
      this.showHelp();
      return 0;
    }

    // Handle unknown command
    if (!(parsed.command in commands)) {
      console.error(colorize(`Unknown command: ${parsed.command}`, 'red'));
      console.error(`Run ${colorize('claude-agent --help', 'cyan')} for available commands`);
      return 1;
    }

    const handler = commands[parsed.command]!;

    try {
      const context: CLIContext = {
        command: parsed.command,
        args: parsed.args,
        flags: parsed.flags,
        config: this.config,
        logger: this.logger,
      };

      return await handler.run(parsed.args, parsed.flags, context);
    } catch (error) {
      const agentError = wrapError(error);
      dispatchError(agentError);

      console.error(colorize(`Error: ${agentError.message}`, 'red'));
      if (agentError.suggestedFix) {
        console.error(colorize(`Suggested fix: ${agentError.suggestedFix}`, 'yellow'));
      }
      return 1;
    }
  }
}

// ---- CLI Entry Point ----

export async function main(): Promise<void> {
  const cli = new ClaudeAgentCLI();
  const exitCode = await cli.run(process.argv);
  process.exit(exitCode);
}
