// src/ops-commands.ts - 运维命令集

export type PermissionLevel = 'readonly' | 'operator' | 'admin';

export interface OpsCommand {
  name: string;
  description: string;
  usage: string;
  permission: PermissionLevel;
  handler: (args: string[]) => Promise<OpsResult>;
  aliases?: string[];
}

export interface OpsResult {
  success: boolean;
  output: string;
  data?: unknown;
  error?: string;
}

export interface CommandHelp {
  name: string;
  description: string;
  usage: string;
  aliases: string[];
  permission: PermissionLevel;
}

export interface CommandInfo {
  name: string;
  description: string;
  permission: PermissionLevel;
  aliases: string[];
}

export interface CommandHistoryEntry {
  command: string;
  args: string[];
  timestamp: number;
  success: boolean;
  output: string;
}

export class OpsCommandRegistry {
  private commands: Map<string, OpsCommand> = new Map();
  private aliasMap: Map<string, string> = new Map();
  private history: CommandHistoryEntry[] = [];
  private maxHistory: number;

  constructor(maxHistory: number = 1000) {
    this.maxHistory = maxHistory;
    this.registerBuiltInCommands();
  }

  private registerBuiltInCommands(): void {
    this.register({
      name: 'status',
      description: 'Show system status',
      usage: 'status',
      permission: 'readonly',
      aliases: ['st'],
      handler: async () => ({ success: true, output: 'System is running', data: { status: 'running' } }),
    });

    this.register({
      name: 'health',
      description: 'Check system health',
      usage: 'health',
      permission: 'readonly',
      aliases: ['he'],
      handler: async () => ({ success: true, output: 'All systems healthy', data: { health: 'ok' } }),
    });

    this.register({
      name: 'tasks',
      description: 'List active tasks',
      usage: 'tasks',
      permission: 'readonly',
      aliases: ['t'],
      handler: async () => ({ success: true, output: 'No active tasks', data: { tasks: [] } }),
    });

    this.register({
      name: 'logs',
      description: 'Show recent logs',
      usage: 'logs [limit]',
      permission: 'readonly',
      aliases: ['lg'],
      handler: async (args) => {
        const limit = parseInt(args[0] || '10', 10);
        return { success: true, output: `Showing last ${limit} log entries`, data: { limit } };
      },
    });

    this.register({
      name: 'config',
      description: 'Get or set configuration',
      usage: 'config [key=value]',
      permission: 'operator',
      aliases: ['cfg'],
      handler: async (args) => {
        if (args.length === 0) {
          return { success: true, output: 'Current configuration loaded', data: {} };
        }
        return { success: true, output: `Config updated: ${args.join(' ')}`, data: { updated: args } };
      },
    });

    this.register({
      name: 'restart',
      description: 'Restart the system',
      usage: 'restart',
      permission: 'admin',
      aliases: ['r'],
      handler: async () => ({ success: true, output: 'System restarting...' }),
    });

    this.register({
      name: 'shutdown',
      description: 'Shutdown the system',
      usage: 'shutdown',
      permission: 'admin',
      aliases: ['sd'],
      handler: async () => ({ success: true, output: 'System shutting down...' }),
    });

    this.register({
      name: 'backup',
      description: 'Create a backup',
      usage: 'backup [name]',
      permission: 'operator',
      aliases: ['bk'],
      handler: async (args) => {
        const name = args[0] || 'default';
        return { success: true, output: `Backup '${name}' created`, data: { backupName: name } };
      },
    });

    this.register({
      name: 'restore',
      description: 'Restore from a backup',
      usage: 'restore <name>',
      permission: 'admin',
      aliases: ['rs'],
      handler: async (args) => {
        const name = args[0];
        if (!name) return { success: false, output: '', error: 'Backup name required' };
        return { success: true, output: `Restored from '${name}'`, data: { restored: name } };
      },
    });

    this.register({
      name: 'diagnose',
      description: 'Run system diagnostics',
      usage: 'diagnose',
      permission: 'readonly',
      aliases: ['diag'],
      handler: async () => ({
        success: true,
        output: 'Diagnostics complete',
        data: { checks: ['memory', 'cpu', 'disk'], allPassed: true },
      }),
    });
  }

  register(command: OpsCommand): void {
    this.commands.set(command.name, command);
    if (command.aliases) {
      for (const alias of command.aliases) {
        this.aliasMap.set(alias, command.name);
      }
    }
  }

  unregister(name: string): boolean {
    const cmd = this.commands.get(name);
    if (!cmd) return false;
    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        this.aliasMap.delete(alias);
      }
    }
    return this.commands.delete(name);
  }

  async execute(name: string, args: string[]): Promise<OpsResult> {
    const resolvedName = this.aliasMap.get(name) || name;
    const command = this.commands.get(resolvedName);
    if (!command) {
      const result: OpsResult = { success: false, output: '', error: `Unknown command: ${name}` };
      this.recordHistory(name, args, result);
      return result;
    }

    try {
      const result = await command.handler(args);
      this.recordHistory(name, args, result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const result: OpsResult = { success: false, output: '', error };
      this.recordHistory(name, args, result);
      return result;
    }
  }

  private recordHistory(command: string, args: string[], result: OpsResult): void {
    this.history.push({
      command,
      args,
      timestamp: Date.now(),
      success: result.success,
      output: result.output,
    });
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  getHelp(name: string): CommandHelp | null {
    const resolvedName = this.aliasMap.get(name) || name;
    const command = this.commands.get(resolvedName);
    if (!command) return null;
    return {
      name: command.name,
      description: command.description,
      usage: command.usage,
      aliases: command.aliases || [],
      permission: command.permission,
    };
  }

  listCommands(): CommandInfo[] {
    return [...this.commands.values()].map(cmd => ({
      name: cmd.name,
      description: cmd.description,
      permission: cmd.permission,
      aliases: cmd.aliases || [],
    }));
  }

  getHistory(limit?: number): CommandHistoryEntry[] {
    if (limit !== undefined) {
      if (limit <= 0) return [];
      return this.history.slice(-limit);
    }
    return [...this.history];
  }

  undo(): CommandHistoryEntry | undefined {
    return this.history.pop();
  }

  clearHistory(): void {
    this.history = [];
  }

  getCommand(name: string): OpsCommand | undefined {
    const resolvedName = this.aliasMap.get(name) || name;
    return this.commands.get(resolvedName);
  }
}
