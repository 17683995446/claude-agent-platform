// src/remote-control.ts - 远程控制接口

export type ControlCommandName = 'start' | 'stop' | 'pause' | 'resume' | 'restart' | 'status' | 'config';

export interface ControlCommand {
  id: string;
  name: ControlCommandName | string;
  args?: Record<string, unknown>;
  priority?: number; // 0 = highest
  timestamp: number;
  apiKey?: string;
}

export interface CommandResult {
  success: boolean;
  data?: unknown;
  error?: string;
  commandId: string;
  timestamp: number;
}

export type CommandHandler = (command: ControlCommand) => Promise<CommandResult>;

export interface AuditLogEntry {
  commandId: string;
  commandName: string;
  timestamp: number;
  success: boolean;
  error?: string;
  apiKey?: string;
}

export class RemoteControlServer {
  private commandHandlers: Map<string, CommandHandler> = new Map();
  private commandQueue: ControlCommand[] = [];
  private auditLog: AuditLogEntry[] = [];
  private apiKeys: Set<string> = new Set();
  private processing: boolean = false;

  constructor(apiKeys: string[] = []) {
    for (const key of apiKeys) {
      this.apiKeys.add(key);
    }
    this.registerBuiltInCommands();
  }

  private registerBuiltInCommands(): void {
    this.registerCommand('start', async (cmd) => ({
      success: true,
      data: { status: 'started' },
      commandId: cmd.id,
      timestamp: Date.now(),
    }));
    this.registerCommand('stop', async (cmd) => ({
      success: true,
      data: { status: 'stopped' },
      commandId: cmd.id,
      timestamp: Date.now(),
    }));
    this.registerCommand('pause', async (cmd) => ({
      success: true,
      data: { status: 'paused' },
      commandId: cmd.id,
      timestamp: Date.now(),
    }));
    this.registerCommand('resume', async (cmd) => ({
      success: true,
      data: { status: 'resumed' },
      commandId: cmd.id,
      timestamp: Date.now(),
    }));
    this.registerCommand('restart', async (cmd) => ({
      success: true,
      data: { status: 'restarted' },
      commandId: cmd.id,
      timestamp: Date.now(),
    }));
    this.registerCommand('status', async (cmd) => ({
      success: true,
      data: { status: 'running', uptime: Date.now() },
      commandId: cmd.id,
      timestamp: Date.now(),
    }));
    this.registerCommand('config', async (cmd) => ({
      success: true,
      data: { config: cmd.args || {} },
      commandId: cmd.id,
      timestamp: Date.now(),
    }));
  }

  registerCommand(name: string, handler: CommandHandler): void {
    this.commandHandlers.set(name, handler);
  }

  async handleCommand(command: ControlCommand): Promise<CommandResult> {
    const handler = this.commandHandlers.get(command.name);
    if (!handler) {
      const result: CommandResult = {
        success: false,
        error: `Unknown command: ${command.name}`,
        commandId: command.id,
        timestamp: Date.now(),
      };
      this.auditLog.push({
        commandId: command.id,
        commandName: command.name,
        timestamp: command.timestamp,
        success: false,
        error: result.error,
        apiKey: command.apiKey,
      });
      return result;
    }

    try {
      const result = await handler(command);
      this.auditLog.push({
        commandId: command.id,
        commandName: command.name,
        timestamp: command.timestamp,
        success: result.success,
        error: result.error,
        apiKey: command.apiKey,
      });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const result: CommandResult = {
        success: false,
        error,
        commandId: command.id,
        timestamp: Date.now(),
      };
      this.auditLog.push({
        commandId: command.id,
        commandName: command.name,
        timestamp: command.timestamp,
        success: false,
        error,
        apiKey: command.apiKey,
      });
      return result;
    }
  }

  enqueueCommand(command: ControlCommand): void {
    const priority = command.priority ?? 5;
    this.commandQueue.push(command);
    this.commandQueue.sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5));
  }

  getPendingCommands(): ControlCommand[] {
    return [...this.commandQueue];
  }

  dequeueNext(): ControlCommand | undefined {
    return this.commandQueue.shift();
  }

  authenticate(apiKey: string): boolean {
    return this.apiKeys.has(apiKey);
  }

  addApiKey(key: string): void {
    this.apiKeys.add(key);
  }

  removeApiKey(key: string): boolean {
    return this.apiKeys.delete(key);
  }

  getAuditLog(limit?: number): AuditLogEntry[] {
    if (limit !== undefined) {
      if (limit <= 0) return [];
      return this.auditLog.slice(-limit);
    }
    return [...this.auditLog];
  }

  clearAuditLog(): void {
    this.auditLog = [];
  }

  getRegisteredCommands(): string[] {
    return [...this.commandHandlers.keys()];
  }

  isProcessing(): boolean {
    return this.processing;
  }

  setProcessing(value: boolean): void {
    this.processing = value;
  }
}
