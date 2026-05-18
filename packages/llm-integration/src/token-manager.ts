// ============================================================================
// Token Manager - Token 管理器
// ============================================================================

/** Token 预算 */
export interface TokenBudget {
  total: number;
  system: number;
  conversation: number;
  response: number;
}

/** Token 使用记录 */
export interface TokenUsageRecord {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  timestamp: number;
  conversationId?: string;
}

/** Token 使用报告 */
export interface TokenUsageReport {
  totalUsed: number;
  totalBudget: number;
  byModel: Record<string, { used: number; budget: number; remaining: number }>;
  recentUsage: TokenUsageRecord[];
  alerts: string[];
}

/** 模型 Token 限制 */
export interface ModelTokenLimits {
  contextWindow: number;
  maxOutputTokens: number;
  recommendedSystemTokens: number;
}

export class TokenManager {
  private budgets = new Map<string, TokenBudget>();
  private usage: TokenUsageRecord[] = [];
  private modelLimits = new Map<string, ModelTokenLimits>();
  private alerts: string[] = [];
  private alertThreshold = 0.8; // 80% 使用时发出警告

  constructor() {
    // 设置默认模型限制
    this.setModelLimits('gpt-4o', { contextWindow: 128000, maxOutputTokens: 16384, recommendedSystemTokens: 4096 });
    this.setModelLimits('gpt-4o-mini', { contextWindow: 128000, maxOutputTokens: 16384, recommendedSystemTokens: 4096 });
    this.setModelLimits('gpt-4-turbo', { contextWindow: 128000, maxOutputTokens: 4096, recommendedSystemTokens: 4096 });
    this.setModelLimits('gpt-4', { contextWindow: 8192, maxOutputTokens: 4096, recommendedSystemTokens: 2048 });
    this.setModelLimits('gpt-3.5-turbo', { contextWindow: 16385, maxOutputTokens: 4096, recommendedSystemTokens: 2048 });
    this.setModelLimits('claude-sonnet-4-20250514', { contextWindow: 200000, maxOutputTokens: 8192, recommendedSystemTokens: 4096 });
    this.setModelLimits('claude-3-5-sonnet-20241022', { contextWindow: 200000, maxOutputTokens: 8192, recommendedSystemTokens: 4096 });
    this.setModelLimits('claude-3-opus-20240229', { contextWindow: 200000, maxOutputTokens: 4096, recommendedSystemTokens: 4096 });
    this.setModelLimits('claude-3-haiku-20240307', { contextWindow: 200000, maxOutputTokens: 4096, recommendedSystemTokens: 2048 });
  }

  /** 设置模型 Token 限制 */
  setModelLimits(model: string, limits: ModelTokenLimits): void {
    this.modelLimits.set(model, limits);
  }

  /** 设置 Token 预算 */
  setBudget(model: string, budget: TokenBudget): void {
    this.budgets.set(model, budget);
  }

  /** 自动计算预算 */
  autoBudget(model: string): TokenBudget {
    const limits = this.modelLimits.get(model);
    if (!limits) {
      throw new Error(`No token limits configured for model "${model}"`);
    }

    const budget: TokenBudget = {
      total: limits.contextWindow,
      system: limits.recommendedSystemTokens,
      conversation: Math.floor(limits.contextWindow * 0.6),
      response: limits.maxOutputTokens,
    };

    this.budgets.set(model, budget);
    return budget;
  }

  /** 计算 Token 数量 */
  countTokens(model: string, text: string): number {
    // 不同模型有不同的 tokenizer，这里使用估算
    const isClaude = model.includes('claude');
    const charsPerToken = isClaude ? 3.5 : 4;
    return Math.ceil(text.length / charsPerToken);
  }

  /** 获取剩余预算 */
  getRemainingBudget(model: string): number {
    const budget = this.budgets.get(model);
    if (!budget) return Infinity;

    const used = this.getUsedTokens(model);
    return Math.max(0, budget.total - used);
  }

  /** 分配 Token */
  allocateTokens(model: string, tokens: number): boolean {
    const remaining = this.getRemainingBudget(model);
    if (tokens > remaining) {
      this.addAlert(`Token allocation failed for ${model}: requested ${tokens}, remaining ${remaining}`);
      return false;
    }
    return true;
  }

  /** 记录 Token 使用 */
  recordUsage(usage: TokenUsageRecord): void {
    this.usage.push(usage);

    // 检查预算警告
    const budget = this.budgets.get(usage.model);
    if (budget) {
      const used = this.getUsedTokens(usage.model);
      const ratio = used / budget.total;
      if (ratio >= this.alertThreshold) {
        this.addAlert(
          `Token usage for ${usage.model} at ${Math.round(ratio * 100)}% of budget (${used}/${budget.total})`,
        );
      }
    }
  }

  /** 获取模型已使用 Token */
  private getUsedTokens(model: string): number {
    return this.usage
      .filter((u) => u.model === model)
      .reduce((sum, u) => sum + u.totalTokens, 0);
  }

  /** 获取使用报告 */
  getUsageReport(): TokenUsageReport {
    const byModel: Record<string, { used: number; budget: number; remaining: number }> = {};

    for (const [model, budget] of this.budgets) {
      const used = this.getUsedTokens(model);
      byModel[model] = {
        used,
        budget: budget.total,
        remaining: Math.max(0, budget.total - used),
      };
    }

    // 也包含有使用记录但没有预算的模型
    for (const record of this.usage) {
      if (!byModel[record.model]) {
        byModel[record.model] = {
          used: this.getUsedTokens(record.model),
          budget: 0,
          remaining: Infinity,
        };
      }
    }

    const totalUsed = this.usage.reduce((sum, u) => sum + u.totalTokens, 0);
    const totalBudget = Array.from(this.budgets.values()).reduce((sum, b) => sum + b.total, 0);

    return {
      totalUsed,
      totalBudget,
      byModel,
      recentUsage: this.usage.slice(-50),
      alerts: [...this.alerts],
    };
  }

  /** 添加警告 */
  private addAlert(message: string): void {
    this.alerts.push(`[${new Date().toISOString()}] ${message}`);
  }

  /** 清除使用记录 */
  clearUsage(): void {
    this.usage = [];
    this.alerts = [];
  }

  /** 获取模型限制 */
  getModelLimits(model: string): ModelTokenLimits | undefined {
    return this.modelLimits.get(model);
  }

  /** 设置警告阈值 */
  setAlertThreshold(threshold: number): void {
    this.alertThreshold = Math.max(0, Math.min(1, threshold));
  }
}
