// src/interactive-prompt.ts - 交互式提示模块

export interface TextOptions {
  defaultValue?: string;
  validation?: (input: string) => string | true;
  transform?: (input: string) => string;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
}

export interface Choice {
  name: string;
  value: string;
  description?: string;
  disabled?: boolean;
}

export interface SelectOptions {
  pageSize?: number;
  loop?: boolean;
}

export type ConfirmOptions = {
  default?: boolean;
  yesValues?: string[];
  noValues?: string[];
};

export class InteractivePrompt {
  private history: string[] = [];
  private maxHistory: number = 100;

  /**
   * 文本输入，支持验证和转换
   */
  async askText(question: string, options?: TextOptions): Promise<string> {
    const prompt = this.buildPrompt(question, options?.defaultValue, options?.placeholder);

    // In test/non-interactive mode, use default value
    let input: string;
    if (!this.isInteractive()) {
      input = options?.defaultValue !== undefined ? options.defaultValue : '';
    } else {
      input = await this.readLine(prompt);

      // Apply default
      if (input === '' && options?.defaultValue !== undefined) {
        input = options.defaultValue;
      }
    }

    // Apply transform
    if (options?.transform) {
      input = options.transform(input);
    }

    // Apply validation
    if (options?.validation) {
      const result = options.validation(input);
      if (result !== true) {
        throw new Error(result);
      }
    }

    // Required check
    if (options?.required && input.trim() === '') {
      throw new Error(`${question} is required`);
    }

    // Min/max length
    if (options?.minLength !== undefined && input.length < options.minLength) {
      throw new Error(`Input must be at least ${options.minLength} characters`);
    }
    if (options?.maxLength !== undefined && input.length > options.maxLength) {
      throw new Error(`Input must be at most ${options.maxLength} characters`);
    }

    // Pattern
    if (options?.pattern && !options.pattern.test(input)) {
      throw new Error(`Input does not match required pattern`);
    }

    this.addToHistory(input);
    return input;
  }

  /**
   * 密码输入（隐藏/掩码）
   */
  async askPassword(question: string): Promise<string> {
    const prompt = `${question}: `;

    if (!this.isInteractive()) {
      return '';
    }

    // In a real terminal, this would use stdin with no-echo
    // For testing purposes, we simulate it
    const input = await this.readLine(prompt);
    this.addToHistory(input);
    return input;
  }

  /**
   * 确认提示（yes/no/cancel）
   */
  async askConfirm(question: string, defaultVal?: boolean): Promise<boolean> {
    const yesValues = ['yes', 'y', 'true', '1'];
    const noValues = ['no', 'n', 'false', '0'];
    const defaultStr = defaultVal === true ? 'Y/n' : defaultVal === false ? 'y/N' : 'y/n';
    const prompt = `${question} (${defaultStr}): `;

    if (!this.isInteractive()) {
      return defaultVal ?? false;
    }

    const input = (await this.readLine(prompt)).toLowerCase().trim();

    if (input === '') {
      return defaultVal ?? false;
    }

    if (yesValues.includes(input)) return true;
    if (noValues.includes(input)) return false;

    throw new Error(`Invalid response. Please answer yes or no.`);
  }

  /**
   * 列表选择（单选）
   */
  async askSelect(question: string, choices: Choice[]): Promise<string> {
    if (choices.length === 0) {
      throw new Error('No choices available');
    }

    const enabledChoices = choices.filter(c => !c.disabled);
    if (enabledChoices.length === 0) {
      throw new Error('No enabled choices available');
    }

    if (!this.isInteractive()) {
      return enabledChoices[0].value;
    }

    // Display choices
    const display = choices.map((c, i) => {
      const prefix = c.disabled ? '  -' : `  ${i + 1}.`;
      const desc = c.description ? ` - ${c.description}` : '';
      return `${prefix} ${c.name}${desc}`;
    }).join('\n');

    console.log(`${question}:`);
    console.log(display);

    const input = await this.readLine('  Select: ');
    const index = parseInt(input, 10) - 1;

    if (isNaN(index) || index < 0 || index >= choices.length) {
      throw new Error('Invalid selection');
    }

    if (choices[index].disabled) {
      throw new Error('This choice is disabled');
    }

    return choices[index].value;
  }

  /**
   * 列表选择（多选）
   */
  async askMultiSelect(question: string, choices: Choice[]): Promise<string[]> {
    if (choices.length === 0) {
      throw new Error('No choices available');
    }

    const enabledChoices = choices.filter(c => !c.disabled);
    if (enabledChoices.length === 0) {
      throw new Error('No enabled choices available');
    }

    if (!this.isInteractive()) {
      return enabledChoices.map(c => c.value);
    }

    // Display choices
    const display = choices.map((c, i) => {
      const prefix = c.disabled ? '  [-]' : `  [ ]`;
      const desc = c.description ? ` - ${c.description}` : '';
      return `${prefix} ${i + 1}. ${c.name}${desc}`;
    }).join('\n');

    console.log(`${question} (comma-separated numbers):`);
    console.log(display);

    const input = await this.readLine('  Select: ');
    const indices = input.split(',').map(s => parseInt(s.trim(), 10) - 1);

    const selected: string[] = [];
    for (const idx of indices) {
      if (isNaN(idx) || idx < 0 || idx >= choices.length) {
        throw new Error(`Invalid selection: ${idx + 1}`);
      }
      if (choices[idx].disabled) {
        throw new Error(`Choice "${choices[idx].name}" is disabled`);
      }
      selected.push(choices[idx].value);
    }

    return selected;
  }

  /**
   * 自动补全支持
   */
  getCompletions(input: string, candidates: string[]): string[] {
    if (!input) return candidates;
    const lower = input.toLowerCase();
    return candidates.filter(c => c.toLowerCase().startsWith(lower));
  }

  /**
   * 获取历史记录
   */
  getHistory(): string[] {
    return [...this.history];
  }

  /**
   * 清空历史记录
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * 搜索历史记录
   */
  searchHistory(query: string): string[] {
    const lower = query.toLowerCase();
    return this.history.filter(h => h.toLowerCase().includes(lower));
  }

  private buildPrompt(question: string, defaultValue?: string, placeholder?: string): string {
    let prompt = `${question}: `;
    if (defaultValue !== undefined) {
      prompt += `(${defaultValue}) `;
    } else if (placeholder) {
      prompt += `[${placeholder}] `;
    }
    return prompt;
  }

  private addToHistory(input: string): void {
    if (input.trim()) {
      this.history.push(input);
      if (this.history.length > this.maxHistory) {
        this.history.shift();
      }
    }
  }

  private async readLine(_prompt: string): Promise<string> {
    // Stub for non-terminal environments; tests will mock this
    return '';
  }

  private isInteractive(): boolean {
    // Check if stdin is a TTY
    return process.stdin.isTTY ?? false;
  }
}
