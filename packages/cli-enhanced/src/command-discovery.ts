// src/command-discovery.ts - 命令发现系统模块

export interface CommandInfo {
  name: string;
  description: string;
  usage?: string;
  aliases: string[];
  category?: string;
  options?: CommandOption[];
  arguments?: CommandArgument[];
  examples?: string[];
  source: string;
  hidden?: boolean;
  deprecated?: boolean;
  dependencies?: string[];
}

export interface CommandOption {
  name: string;
  description: string;
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
  default?: unknown;
  short?: string;
}

export interface CommandArgument {
  name: string;
  description: string;
  required?: boolean;
  variadic?: boolean;
}

export interface HelpText {
  name: string;
  description: string;
  usage: string;
  options: CommandOption[];
  arguments: CommandArgument[];
  examples: string[];
  aliases: string[];
  category?: string;
}

export interface CommandModule {
  name?: string;
  description?: string;
  aliases?: string[];
  category?: string;
  options?: CommandOption[];
  arguments?: CommandArgument[];
  examples?: string[];
  run?: (...args: unknown[]) => unknown;
  hidden?: boolean;
  deprecated?: boolean;
  dependencies?: string[];
}

export class CommandDiscovery {
  private commands: Map<string, CommandInfo> = new Map();
  private aliasMap: Map<string, string> = new Map();
  private categories: Map<string, string[]> = new Map();

  /**
   * 从目录扫描命令模块
   */
  discover(directory: string): CommandInfo[] {
    // In a real implementation, this would scan the filesystem
    // For now, return empty array - commands are registered manually
    return [];
  }

  /**
   * 注册命令模块
   */
  registerCommand(module: CommandModule, source: string = 'manual'): CommandInfo {
    const name = module.name ?? 'unnamed';
    const command: CommandInfo = {
      name,
      description: module.description ?? '',
      aliases: module.aliases ?? [],
      category: module.category,
      options: module.options ?? [],
      arguments: module.arguments ?? [],
      examples: module.examples ?? [],
      source,
      hidden: module.hidden,
      deprecated: module.deprecated,
      dependencies: module.dependencies,
    };

    this.commands.set(name, command);

    // Register aliases
    for (const alias of command.aliases) {
      this.aliasMap.set(alias, name);
    }

    // Track category
    if (command.category) {
      const existing = this.categories.get(command.category) ?? [];
      existing.push(name);
      this.categories.set(command.category, existing);
    }

    return command;
  }

  /**
   * 获取命令信息
   */
  getCommand(name: string): CommandInfo | undefined {
    // Check direct name
    const command = this.commands.get(name);
    if (command) return command;

    // Check alias
    const resolved = this.aliasMap.get(name);
    if (resolved) {
      return this.commands.get(resolved);
    }

    return undefined;
  }

  /**
   * 获取命令帮助文本
   */
  getHelp(commandName: string): HelpText {
    const command = this.getCommand(commandName);
    if (!command) {
      throw new Error(`Command "${commandName}" not found`);
    }

    const args = command.arguments?.map(a => a.required ? `<${a.name}>` : `[${a.name}]`).join(' ') ?? '';
    const opts = command.options?.map(o => {
      const names = o.short ? `-${o.short}, --${o.name}` : `--${o.name}`;
      return o.required ? `${names} <value>` : `[${names}]`;
    }).join(' ') ?? '';

    return {
      name: command.name,
      description: command.description,
      usage: `${command.name} ${args} ${opts}`.trim(),
      options: command.options ?? [],
      arguments: command.arguments ?? [],
      examples: command.examples ?? [],
      aliases: command.aliases,
      category: command.category,
    };
  }

  /**
   * 搜索命令
   */
  searchCommands(query: string): CommandInfo[] {
    const lower = query.toLowerCase();
    const results: CommandInfo[] = [];

    for (const command of this.commands.values()) {
      if (command.hidden) continue;

      const nameMatch = command.name.toLowerCase().includes(lower);
      const descMatch = command.description.toLowerCase().includes(lower);
      const aliasMatch = command.aliases.some(a => a.toLowerCase().includes(lower));
      const categoryMatch = command.category?.toLowerCase().includes(lower) ?? false;

      if (nameMatch || descMatch || aliasMatch || categoryMatch) {
        results.push(command);
      }
    }

    return results;
  }

  /**
   * 获取所有命令
   */
  getAllCommands(): CommandInfo[] {
    return [...this.commands.values()].filter(c => !c.hidden);
  }

  /**
   * 获取所有命令（包括隐藏的）
   */
  getAllCommandsIncludingHidden(): CommandInfo[] {
    return [...this.commands.values()];
  }

  /**
   * 按类别获取命令
   */
  getCommandsByCategory(category: string): CommandInfo[] {
    const names = this.categories.get(category) ?? [];
    return names.map(name => this.commands.get(name)).filter((c): c is CommandInfo => c !== undefined);
  }

  /**
   * 获取所有类别
   */
  getCategories(): string[] {
    return [...this.categories.keys()];
  }

  /**
   * 检查命令依赖
   */
  checkDependencies(commandName: string): { satisfied: boolean; missing: string[] } {
    const command = this.getCommand(commandName);
    if (!command) {
      return { satisfied: false, missing: [commandName] };
    }

    const missing: string[] = [];
    for (const dep of command.dependencies ?? []) {
      if (!this.commands.has(dep)) {
        missing.push(dep);
      }
    }

    return { satisfied: missing.length === 0, missing };
  }

  /**
   * 获取命令数量
   */
  getCount(): number {
    return this.commands.size;
  }

  /**
   * 清除所有注册的命令
   */
  clear(): void {
    this.commands.clear();
    this.aliasMap.clear();
    this.categories.clear();
  }

  /**
   * 检查命令是否存在
   */
  hasCommand(name: string): boolean {
    return this.commands.has(name) || this.aliasMap.has(name);
  }
}
