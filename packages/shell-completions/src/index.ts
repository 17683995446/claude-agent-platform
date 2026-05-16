// ============================================================================
// @claude-agent/shell-completions - Shell Completion Scripts
// ============================================================================

export interface CompletionSpec {
  name: string;
  description: string;
  subcommands: CompletionSpec[];
  options: { flag: string; description: string; takesValue?: boolean }[];
}

export class ShellCompletionGenerator {
  private spec: CompletionSpec;

  constructor(spec: CompletionSpec) {
    this.spec = spec;
  }

  generateBash(): string {
    const cmds = this.spec.subcommands.map(s => s.name).join(' ');
    const opts = this.spec.options.map(o => o.flag).join(' ');
    return [
      '# claude-agent bash completion',
      '_claude_agent_completions() {',
      '  local cur prev words cword',
      '  _init_completion || return',
      '  COMPREPLY=()',
      '',
      '  case "${prev}" in',
      '    claude-agent)',
      '      COMPREPLY=($(compgen -W "' + cmds + '" -- "${cur}"))',
      '      ;;',
      '    *)',
      '      COMPREPLY=($(compgen -W "' + opts + '" -- "${cur}"))',
      '      ;;',
      '  esac',
      '}',
      'complete -F _claude_agent_completions claude-agent',
      '',
    ].join('\n');
  }

  generateZsh(): string {
    const subcmds = this.spec.subcommands.map(s =>
      "  '" + s.name + ":" + s.description + "'"
    ).join('\n');
    return [
      '#compdef claude-agent',
      '_claude-agent() {',
      '  local -a commands',
      '  commands=(',
      subcmds,
      '  )',
      "  _describe 'command' commands",
      '}',
      '_claude-agent "$@"',
      '',
    ].join('\n');
  }

  generateFish(): string {
    const subcmds = this.spec.subcommands.map(s =>
      "complete -c claude-agent -f -n '__fish_use_subcommand' -a " + s.name + " -d '" + s.description + "'"
    ).join('\n');
    return '# claude-agent fish completion\n' + subcmds + '\n';
  }

  generatePowerShell(): string {
    const subcmds = this.spec.subcommands.map(s =>
      "    '" + s.name + "'"
    ).join(',\n');
    return [
      '# claude-agent PowerShell completion',
      "Register-ArgumentCompleter -Native -CommandName 'claude-agent' -ScriptBlock {",
      '  param($wordToComplete, $commandAst, $cursorPosition)',
      '  $commands = @(',
      subcmds,
      '  )',
      '  $commands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {',
      "    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)",
      '  }',
      '}',
      '',
    ].join('\n');
  }

  static createDefault(): ShellCompletionGenerator {
    return new ShellCompletionGenerator({
      name: 'claude-agent',
      description: 'Claude Agent Platform CLI',
      subcommands: [
        { name: 'run', description: 'Run an agent task', subcommands: [], options: [] },
        { name: 'analyze', description: 'Analyze code', subcommands: [], options: [] },
        { name: 'test', description: 'Run tests', subcommands: [], options: [] },
        { name: 'graph', description: 'Generate dependency graph', subcommands: [], options: [] },
        { name: 'devops', description: 'DevOps automation', subcommands: [], options: [] },
        { name: 'design', description: 'Design system generation', subcommands: [], options: [] },
        { name: 'monitor', description: 'Performance monitoring', subcommands: [], options: [] },
        { name: 'checkpoint', description: 'Checkpoint management', subcommands: [], options: [] },
      ],
      options: [
        { flag: '--config', description: 'Path to config file', takesValue: true },
        { flag: '--version', description: 'Show version' },
        { flag: '--help', description: 'Show help' },
        { flag: '--verbose', description: 'Verbose output' },
      ],
    });
  }
}
