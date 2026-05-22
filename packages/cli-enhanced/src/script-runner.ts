// src/script-runner.ts - 脚本运行器模块

export interface ScriptStep {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeout?: number;
  retryCount?: number;
  retryDelay?: number;
  continueOnError?: boolean;
  condition?: string;
  expectExitCode?: number;
  captureOutput?: boolean;
}

export interface ScriptDefinition {
  name: string;
  description?: string;
  steps: ScriptStep[];
  variables?: Record<string, string>;
  env?: Record<string, string>;
  timeout?: number;
  dryRun?: boolean;
  stepByStep?: boolean;
}

export interface ScriptResult {
  success: boolean;
  name: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  steps: StepResult[];
  output: string;
  errors: string[];
}

export interface StepResult {
  name: string;
  success: boolean;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  duration: number;
  skipped: boolean;
  retries: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ScriptInfo {
  name: string;
  description?: string;
  stepCount: number;
  source: string;
}

export interface VariableContext {
  variables: Record<string, string>;
  env: Record<string, string>;
}

export class ScriptRunner {
  private scripts: Map<string, ScriptDefinition> = new Map();
  private results: Map<string, ScriptResult> = new Map();
  private dryRun: boolean = false;
  private stepByStep: boolean = false;

  /**
   * 运行脚本
   */
  async run(script: ScriptDefinition): Promise<ScriptResult> {
    const startTime = new Date();
    const stepResults: StepResult[] = [];
    const allOutput: string[] = [];
    const allErrors: string[] = [];
    let success = true;

    // Merge script-level env
    const scriptEnv = { ...process.env, ...script.env } as Record<string, string>;

    // Resolve variables
    const variables = { ...script.variables };

    for (let i = 0; i < script.steps.length; i++) {
      const step = script.steps[i];

      // Check condition
      if (step.condition && !this.evaluateCondition(step.condition, variables)) {
        stepResults.push({
          name: step.name,
          success: true,
          command: step.command,
          exitCode: null,
          stdout: '',
          stderr: '',
          duration: 0,
          skipped: true,
          retries: 0,
        });
        continue;
      }

      // Resolve variables in command and args
      const resolvedCommand = this.resolveVariables(step.command, variables);
      const resolvedArgs = step.args?.map(a => this.resolveVariables(a, variables)) ?? [];

      // Dry run mode
      if (this.dryRun || script.dryRun) {
        stepResults.push({
          name: step.name,
          success: true,
          command: resolvedCommand,
          exitCode: null,
          stdout: `[DRY RUN] Would execute: ${resolvedCommand} ${resolvedArgs.join(' ')}`,
          stderr: '',
          duration: 0,
          skipped: false,
          retries: 0,
        });
        allOutput.push(`[DRY RUN] ${step.name}: ${resolvedCommand} ${resolvedArgs.join(' ')}`);
        continue;
      }

      // Step-by-step mode
      if (this.stepByStep || script.stepByStep) {
        // In interactive mode, would wait for confirmation
        // For non-interactive, just proceed
      }

      // Execute step with retries
      let stepSuccess = false;
      let lastResult: StepResult | null = null;
      const maxRetries = step.retryCount ?? 0;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const stepStart = Date.now();

        try {
          // Simulate command execution
          // In a real implementation, this would use Bun.spawn or child_process
          const result = await this.executeCommand(resolvedCommand, resolvedArgs, {
            env: { ...scriptEnv, ...step.env },
            cwd: step.cwd,
            timeout: step.timeout,
          });

          const duration = Date.now() - stepStart;

          lastResult = {
            name: step.name,
            success: result.exitCode === (step.expectExitCode ?? 0),
            command: resolvedCommand,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            duration,
            skipped: false,
            retries: attempt,
          };

          if (lastResult.success) {
            stepSuccess = true;
            allOutput.push(result.stdout);
            break;
          }

          if (attempt < maxRetries) {
            const delay = step.retryDelay ?? 1000;
            await this.sleep(delay);
          }
        } catch (err) {
          const duration = Date.now() - stepStart;
          lastResult = {
            name: step.name,
            success: false,
            command: resolvedCommand,
            exitCode: null,
            stdout: '',
            stderr: err instanceof Error ? err.message : String(err),
            duration,
            skipped: false,
            retries: attempt,
          };
        }
      }

      if (lastResult) {
        stepResults.push(lastResult);
        if (!stepSuccess) {
          allErrors.push(`Step "${step.name}" failed: ${lastResult.stderr}`);
          success = false;
          if (!step.continueOnError) {
            break;
          }
        }
      }
    }

    const endTime = new Date();
    const result: ScriptResult = {
      success,
      name: script.name,
      startTime,
      endTime,
      duration: endTime.getTime() - startTime.getTime(),
      steps: stepResults,
      output: allOutput.join('\n'),
      errors: allErrors,
    };

    this.results.set(script.name, result);
    return result;
  }

  /**
   * 从文件运行脚本
   */
  async runFile(filePath: string): Promise<ScriptResult> {
    const script = this.scripts.get(filePath);
    if (!script) {
      throw new Error(`Script not found: ${filePath}`);
    }
    return this.run(script);
  }

  /**
   * 验证脚本定义
   */
  validate(script: ScriptDefinition): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!script.name) {
      errors.push('Script name is required');
    }

    if (!script.steps || script.steps.length === 0) {
      errors.push('Script must have at least one step');
    }

    for (let i = 0; i < (script.steps ?? []).length; i++) {
      const step = script.steps[i];

      if (!step.name) {
        errors.push(`Step ${i + 1}: name is required`);
      }

      if (!step.command) {
        errors.push(`Step ${i + 1}: command is required`);
      }

      if (step.retryCount !== undefined && step.retryCount < 0) {
        warnings.push(`Step "${step.name}": retryCount should be >= 0`);
      }

      if (step.timeout !== undefined && step.timeout <= 0) {
        warnings.push(`Step "${step.name}": timeout should be > 0`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 注册脚本
   */
  registerScript(script: ScriptDefinition, source: string = 'manual'): void {
    this.scripts.set(source, script);
  }

  /**
   * 列出可用脚本
   */
  listAvailableScripts(): ScriptInfo[] {
    const infos: ScriptInfo[] = [];
    for (const [source, script] of this.scripts) {
      infos.push({
        name: script.name,
        description: script.description,
        stepCount: script.steps.length,
        source,
      });
    }
    return infos;
  }

  /**
   * 获取脚本运行结果
   */
  getResult(name: string): ScriptResult | undefined {
    return this.results.get(name);
  }

  /**
   * 设置 dry-run 模式
   */
  setDryRun(enabled: boolean): void {
    this.dryRun = enabled;
  }

  /**
   * 设置 step-by-step 模式
   */
  setStepByStep(enabled: boolean): void {
    this.stepByStep = enabled;
  }

  /**
   * 清除所有结果
   */
  clearResults(): void {
    this.results.clear();
  }

  private async executeCommand(
    command: string,
    args: string[],
    options: { env?: Record<string, string>; cwd?: string; timeout?: number }
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    // Stub implementation - simulates command execution
    // In a real implementation, this would use Bun.spawn
    return {
      exitCode: 0,
      stdout: `[executed] ${command} ${args.join(' ')}`,
      stderr: '',
    };
  }

  private escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private resolveVariables(text: string, variables: Record<string, string>): string {
    let result = text;
    for (const [key, value] of Object.entries(variables)) {
      const escaped = this.escapeRegExp(key);
      result = result.replace(new RegExp(`\\{\\{${escaped}\\}\\}`, 'g'), value);
      result = result.replace(new RegExp(`\\$\\{${escaped}\\}`, 'g'), value);
    }
    return result;
  }

  private evaluateCondition(condition: string, variables: Record<string, string>): boolean {
    // Simple variable truthiness check
    const resolved = this.resolveVariables(condition, variables);
    // Only 'true' (case-insensitive) is truthy; 'false', empty string, '0', 'no', 'off' are falsy
    const lower = resolved.toLowerCase().trim();
    return lower === 'true' || lower === '1' || lower === 'yes';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
