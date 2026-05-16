// ============================================================================
// @claude-agent/repl - Interactive REPL
// ============================================================================

export interface REPLCommand {
  name: string;
  description: string;
  execute: (args: string[], context: REPLContext) => Promise<string | void>;
  autocomplete?: (partial: string) => string[];
}

export interface REPLContext {
  history: string[];
  variables: Map<string, unknown>;
  lastResult: unknown;
}

export class ClaudeREPL {
  private commands: Map<string, REPLCommand> = new Map();
  private history: string[] = [];
  private variables: Map<string, unknown> = new Map();
  private lastResult: unknown = undefined;
  private maxHistory: number;
  private prompt: string;
  private running: boolean = false;

  constructor(options?: { maxHistory?: number; prompt?: string }) {
    this.maxHistory = options?.maxHistory ?? 1000;
    this.prompt = options?.prompt ?? '> ';
    this.registerBuiltins();
  }

  private registerBuiltins(): void {
    this.registerCommand({
      name: 'help',
      description: 'Show available commands',
      execute: () => {
        const lines = ['Available commands:'];
        for (const [name, cmd] of this.commands) {
          lines.push(`  ${name.padEnd(16)} ${cmd.description}`);
        }
        return lines.join('\n');
      },
    });
    this.registerCommand({
      name: 'history',
      description: 'Show command history',
      execute: () => this.history.map((h, i) => `  ${i + 1}. ${h}`).join('\n'),
    });
    this.registerCommand({
      name: 'clear',
      description: 'Clear screen and history',
      execute: () => { this.history = []; return 'History cleared.'; },
    });
    this.registerCommand({
      name: 'vars',
      description: 'Show all variables',
      execute: () => {
        const lines: string[] = [];
        for (const [key, value] of this.variables) {
          lines.push(`  ${key} = ${JSON.stringify(value)}`);
        }
        return lines.length > 0 ? lines.join('\n') : 'No variables defined.';
      },
    });
    this.registerCommand({
      name: 'set',
      description: 'Set a variable (set <name> <value>)',
      execute: (args) => {
        if (args.length < 2) return 'Usage: set <name> <value>';
        const [name, ...rest] = args;
        const value = rest.join(' ');
        try {
          this.variables.set(name, JSON.parse(value));
        } catch {
          this.variables.set(name, value);
        }
        return `Set ${name} = ${value}`;
      },
    });
    this.registerCommand({
      name: 'exit',
      description: 'Exit the REPL',
      execute: () => { this.running = false; return 'Goodbye!'; },
    });
  }

  registerCommand(command: REPLCommand): void {
    this.commands.set(command.name, command);
  }

  unregisterCommand(name: string): void {
    this.commands.delete(name);
  }

  getCommand(name: string): REPLCommand | undefined {
    return this.commands.get(name);
  }

  listCommands(): string[] {
    return Array.from(this.commands.keys());
  }

  addToHistory(input: string): void {
    if (input.trim()) {
      this.history.push(input);
      if (this.history.length > this.maxHistory) {
        this.history = this.history.slice(-this.maxHistory);
      }
    }
  }

  getHistory(): string[] {
    return [...this.history];
  }

  autocomplete(partial: string): string[] {
    if (!partial) return this.listCommands();
    const matches: string[] = [];
    for (const name of this.commands.keys()) {
      if (name.startsWith(partial)) matches.push(name);
    }
    return matches;
  }

  getContext(): REPLContext {
    return {
      history: this.history,
      variables: this.variables,
      lastResult: this.lastResult,
    };
  }

  async executeLine(input: string): Promise<string> {
    this.addToHistory(input);
    const trimmed = input.trim();
    if (!trimmed) return '';

    const parts = trimmed.split(/\s+/);
    const commandName = parts[0]!;
    const args = parts.slice(1);

    const command = this.commands.get(commandName);
    if (!command) {
      // Try as variable assignment
      if (trimmed.includes('=') && !trimmed.includes(' ')) {
        const [key, value] = trimmed.split('=');
        try {
          this.variables.set(key!.trim(), JSON.parse(value!.trim()));
          return `Set ${key!.trim()}`;
        } catch {
          this.variables.set(key!.trim(), value!.trim());
          return `Set ${key!.trim()}`;
        }
      }
      // Try as variable reference
      if (this.variables.has(trimmed)) {
        this.lastResult = this.variables.get(trimmed);
        return String(this.lastResult);
      }
      return `Unknown command: ${commandName}. Type 'help' for available commands.`;
    }

    const result = await command.execute(args, this.getContext());
    if (result !== undefined) this.lastResult = result;
    return result ?? '';
  }

  isRunning(): boolean {
    return this.running;
  }

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  getPrompt(): string {
    return this.prompt;
  }

  setPrompt(prompt: string): void {
    this.prompt = prompt;
  }
}
