// ============================================================================
// Prompt Manager - 提示词管理器
// ============================================================================

/** 提示词模板 */
export interface PromptTemplate {
  name: string;
  template: string;
  variables: string[];
  version: number;
  createdAt: number;
  updatedAt: number;
}

/** 提示词版本信息 */
export interface PromptVersion {
  version: number;
  template: string;
  createdAt: number;
}

export class PromptManager {
  private templates = new Map<string, PromptTemplate>();
  private versions = new Map<string, PromptVersion[]>();
  private charPerToken = 4; // 平均每 token 字符数

  /** 注册提示词模板 */
  registerTemplate(name: string, template: string, variables?: string[]): void {
    const existing = this.templates.get(name);
    const version = existing ? existing.version + 1 : 1;

    // 自动检测变量 {{variable}}
    const detectedVars = this.detectVariables(template);
    const allVars = [...new Set([...(variables ?? []), ...detectedVars])];

    const promptTemplate: PromptTemplate = {
      name,
      template,
      variables: allVars,
      version,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };

    this.templates.set(name, promptTemplate);

    // 保存版本历史
    const versionHistory = this.versions.get(name) ?? [];
    versionHistory.push({
      version,
      template,
      createdAt: Date.now(),
    });
    this.versions.set(name, versionHistory);
  }

  /** 检测模板中的变量 */
  private detectVariables(template: string): string[] {
    const regex = /\{\{(\w+)\}\}/g;
    const vars: string[] = [];
    let match;
    while ((match = regex.exec(template)) !== null) {
      if (!vars.includes(match[1])) {
        vars.push(match[1]);
      }
    }
    return vars;
  }

  /**
   * Render a template by substituting all detected variables.
   *
   * @designNote All variables detected in the template (via `{{variable}}` syntax)
   * are treated as required. If you need optional variables, use a conditional
   * pattern in the template itself (e.g., `{{variable}}` with a default value
   * baked into the template string).
   */
  render(name: string, variables: Record<string, string>): string {
    const template = this.templates.get(name);
    if (!template) {
      throw new Error(`Template "${name}" not found`);
    }

    // 验证必需变量
    const missingVars = template.variables.filter((v) => !(v in variables));
    if (missingVars.length > 0) {
      throw new Error(`Missing required variables: ${missingVars.join(', ')}`);
    }

    let result = template.template;
    for (const [key, value] of Object.entries(variables)) {
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(`\\{\\{${escapedKey}\\}\\}`, 'g'), value);
    }

    return result;
  }

  /** 组合多个模板 */
  compose(names: string[], separator: string = '\n\n'): string {
    const parts: string[] = [];

    for (const name of names) {
      const template = this.templates.get(name);
      if (!template) {
        throw new Error(`Template "${name}" not found`);
      }
      // 如果模板没有变量，直接使用
      if (template.variables.length === 0) {
        parts.push(template.template);
      } else {
        // 有变量的模板不能直接组合
        throw new Error(`Template "${name}" has variables and cannot be composed directly. Render it first.`);
      }
    }

    return parts.join(separator);
  }

  /** 估算 token 数量 */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / this.charPerToken);
  }

  /** 压缩文本到目标 token 数 */
  compress(text: string, targetTokens: number): string {
    const currentTokens = this.estimateTokens(text);
    if (currentTokens <= targetTokens) {
      return text;
    }

    const targetLength = targetTokens * this.charPerToken;
    const ratio = targetLength / text.length;

    // 策略 1: 移除多余空白
    let compressed = text
      .replace(/\s+/g, ' ')
      .trim();

    if (this.estimateTokens(compressed) <= targetTokens) {
      return compressed;
    }

    // 策略 2: 按句子截断
    const sentences = compressed.match(/[^.!?]+[.!?]+/g) ?? [compressed];
    let result = '';
    for (const sentence of sentences) {
      const candidate = result + sentence;
      if (this.estimateTokens(candidate) > targetTokens) {
        break;
      }
      result = candidate;
    }

    if (result.length === 0) {
      // 如果连一个句子都放不下，直接截断
      result = compressed.slice(0, targetLength);
    }

    return result.trim();
  }

  /** 获取模板信息 */
  getTemplate(name: string): PromptTemplate | undefined {
    return this.templates.get(name);
  }

  /** 获取模板版本历史 */
  getVersionHistory(name: string): PromptVersion[] {
    return this.versions.get(name) ?? [];
  }

  /** 列出所有模板名称 */
  listTemplates(): string[] {
    return Array.from(this.templates.keys());
  }

  /** 删除模板 */
  deleteTemplate(name: string): boolean {
    this.versions.delete(name);
    return this.templates.delete(name);
  }

  /** 检查模板是否存在 */
  hasTemplate(name: string): boolean {
    return this.templates.has(name);
  }
}
