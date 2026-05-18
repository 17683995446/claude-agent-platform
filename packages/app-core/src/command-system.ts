// ============================================================================
// Module 6: Command System
// ============================================================================

export interface CommandArgument {
  name: string;
  description: string;
  required: boolean;
  defaultValue?: string;
  type?: 'string' | 'number' | 'boolean';
}

export interface CommandOption {
  name: string;
  shortName?: string;
  description: string;
  required: boolean;
  defaultValue?: string | boolean;
  type?: 'string' | 'number' | 'boolean';
}

export interface CommandDefinition {
  name: string;
  description: string;
  arguments: CommandArgument[];
  options: CommandOption[];
  handler: (args: Record<string, string>, options: Record<string, string | boolean>) => Promise<CommandResult>;
  group?: string;
  aliases?: string[];
  examples?: string[];
}

export interface CommandResult {
  success: boolean;
  output: string;
  data?: unknown;
  error?: string;
  duration: number;
}

export interface CommandInfo {
  name: string;
  description: string;
  group?: string;
  aliases: string[];
  argumentCount: number;
  optionCount: number;
}

export interface HelpText {
  command: string;
  description: string;
  usage: string;
  arguments: CommandArgument[];
  options: CommandOption[];
  examples: string[];
}

export interface CommandHistoryEntry {
  command: string;
  timestamp: number;
  result: CommandResult;
}

export class CommandSystem {
  private commands: Map<string, CommandDefinition> = new Map();
  private aliasMap: Map<string, string> = new Map();
  private history: CommandHistoryEntry[] = [];
  private maxHistory: number = 100;

  register(command: CommandDefinition): void {
    if (this.commands.has(command.name)) {
      throw new Error(`Command "${command.name}" is already registered`);
    }
    this.commands.set(command.name, command);

    if (command.aliases) {
      for (const alias of command.aliases) {
        this.aliasMap.set(alias, command.name);
      }
    }
  }

  async execute(commandLine: string): Promise<CommandResult> {
    const startTime = Date.now();
    const tokens = this.tokenize(commandLine);
    if (tokens.length === 0) {
      return {
        success: false,
        output: '',
        error: 'Empty command',
        duration: Date.now() - startTime,
      };
    }

    const commandName = tokens[0]!;
    const resolvedName = this.aliasMap.get(commandName) ?? commandName;
    const command = this.commands.get(resolvedName);

    if (!command) {
      const result: CommandResult = {
        success: false,
        output: '',
        error: `Unknown command: ${commandName}`,
        duration: Date.now() - startTime,
      };
      this.addHistory(commandLine, result);
      return result;
    }

    const { args, options } = this.parseTokens(tokens.slice(1), command);

    // Validate required arguments
    for (const arg of command.arguments) {
      if (arg.required && !args[arg.name]) {
        const result: CommandResult = {
          success: false,
          output: '',
          error: `Missing required argument: ${arg.name}`,
          duration: Date.now() - startTime,
        };
        this.addHistory(commandLine, result);
        return result;
      }
    }

    // Validate required options
    for (const opt of command.options) {
      if (opt.required && options[opt.name] === undefined) {
        const result: CommandResult = {
          success: false,
          output: '',
          error: `Missing required option: --${opt.name}`,
          duration: Date.now() - startTime,
        };
        this.addHistory(commandLine, result);
        return result;
      }
    }

    try {
      const result = await command.handler(args, options);
      result.duration = Date.now() - startTime;
      this.addHistory(commandLine, result);
      return result;
    } catch (error) {
      const result: CommandResult = {
        success: false,
        output: '',
        error: (error as Error).message,
        duration: Date.now() - startTime,
      };
      this.addHistory(commandLine, result);
      return result;
    }
  }

  private tokenize(commandLine: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';

    for (const char of commandLine) {
      if (inQuote) {
        if (char === quoteChar) {
          inQuote = false;
        } else {
          current += char;
        }
      } else if (char === '"' || char === "'") {
        inQuote = true;
        quoteChar = char;
      } else if (char === ' ' || char === '\t') {
        if (current) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }
    if (current) tokens.push(current);
    return tokens;
  }

  private parseTokens(
    tokens: string[],
    command: CommandDefinition,
  ): { args: Record<string, string>; options: Record<string, string | boolean> } {
    const args: Record<string, string> = {};
    const options: Record<string, string | boolean> = {};
    let argIndex = 0;

    for (const token of tokens) {
      if (token.startsWith('--')) {
        const optName = token.slice(2);
        const optDef = command.options.find(
          (o) => o.name === optName || o.shortName === optName,
        );
        if (optDef?.type === 'boolean') {
          options[optDef.name] = true;
        }
        // Value will be next token for non-boolean options
      } else if (token.startsWith('-')) {
        const shortName = token.slice(1);
        const optDef = command.options.find((o) => o.shortName === shortName);
        if (optDef) {
          if (optDef.type === 'boolean') {
            options[optDef.name] = true;
          }
        }
      } else {
        // Check if previous token was an option expecting a value
        const prevToken = tokens[tokens.indexOf(token) - 1];
        if (prevToken?.startsWith('--')) {
          const optName = prevToken.slice(2);
          const optDef = command.options.find((o) => o.name === optName || o.shortName === optName);
          if (optDef && optDef.type !== 'boolean') {
            options[optDef.name] = token;
            continue;
          }
        }
        if (prevToken?.startsWith('-') && !prevToken.startsWith('--')) {
          const shortName = prevToken.slice(1);
          const optDef = command.options.find((o) => o.shortName === shortName);
          if (optDef && optDef.type !== 'boolean') {
            options[optDef.name] = token;
            continue;
          }
        }

        // Positional argument
        if (argIndex < command.arguments.length) {
          args[command.arguments[argIndex]!.name] = token;
          argIndex++;
        }
      }
    }

    // Apply defaults
    for (const arg of command.arguments) {
      if (args[arg.name] === undefined && arg.defaultValue !== undefined) {
        args[arg.name] = arg.defaultValue;
      }
    }
    for (const opt of command.options) {
      if (options[opt.name] === undefined && opt.defaultValue !== undefined) {
        options[opt.name] = opt.defaultValue;
      }
    }

    return { args, options };
  }

  getHelp(commandName?: string): HelpText {
    if (!commandName) {
      return {
        command: '',
        description: 'Available commands',
        usage: '<command> [arguments] [options]',
        arguments: [],
        options: [],
        examples: [],
      };
    }

    const resolvedName = this.aliasMap.get(commandName) ?? commandName;
    const command = this.commands.get(resolvedName);
    if (!command) {
      throw new Error(`Command "${commandName}" not found`);
    }

    const argsStr = command.arguments
      .map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`))
      .join(' ');
    const optsStr = command.options
      .map((o) => (o.required ? `--${o.name}` : `[--${o.name}]`))
      .join(' ');

    return {
      command: command.name,
      description: command.description,
      usage: `${command.name} ${argsStr} ${optsStr}`.trim(),
      arguments: command.arguments,
      options: command.options,
      examples: command.examples ?? [],
    };
  }

  listCommands(): CommandInfo[] {
    const infos: CommandInfo[] = [];
    for (const [, cmd] of this.commands) {
      infos.push({
        name: cmd.name,
        description: cmd.description,
        group: cmd.group,
        aliases: cmd.aliases ?? [],
        argumentCount: cmd.arguments.length,
        optionCount: cmd.options.length,
      });
    }
    return infos;
  }

  getHistory(): CommandHistoryEntry[] {
    return [...this.history];
  }

  clearHistory(): void {
    this.history = [];
  }

  private addHistory(command: string, result: CommandResult): void {
    this.history.push({ command, timestamp: Date.now(), result });
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  hasCommand(name: string): boolean {
    return this.commands.has(name) || this.aliasMap.has(name);
  }

  getCommandCount(): number {
    return this.commands.size;
  }
}
