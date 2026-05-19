// ============================================================================
// Cost Tracker - 成本追踪器
// ============================================================================

/** Token 使用量 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** 模型定价 */
export interface ModelPricing {
  inputCostPer1k: number;   // 每 1000 input tokens 的成本 (USD)
  outputCostPer1k: number;  // 每 1000 output tokens 的成本 (USD)
}

/** 成本信息 */
export interface CostInfo {
  totalCost: number;
  inputCost: number;
  outputCost: number;
  totalTokens: number;
  requestCount: number;
}

/** 每日成本 */
export interface DailyCost {
  date: string;
  cost: number;
  inputCost: number;
  outputCost: number;
  totalTokens: number;
  requestCount: number;
}

/** 每月成本 */
export interface MonthlyCost {
  month: string;
  cost: number;
  inputCost: number;
  outputCost: number;
  totalTokens: number;
  requestCount: number;
  dailyBreakdown: DailyCost[];
}

/** 成本预测 */
export interface CostProjection {
  projectedDailyCost: number;
  projectedMonthlyCost: number;
  projectedDailyTokens: number;
  projectedMonthlyTokens: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  confidence: number;
}

/** 成本记录 */
interface CostRecord {
  model: string;
  promptTokens: number;
  completionTokens: number;
  inputCost: number;
  outputCost: number;
  timestamp: number;
  conversationId?: string;
}

export class CostTracker {
  private records: CostRecord[] = [];
  private pricing = new Map<string, ModelPricing>();
  private dailyBudget: number | null = null;
  private monthlyBudget: number | null = null;

  constructor() {
    // 设置默认定价
    this.setPricing('gpt-4o', { inputCostPer1k: 0.0025, outputCostPer1k: 0.01 });
    this.setPricing('gpt-4o-mini', { inputCostPer1k: 0.00015, outputCostPer1k: 0.0006 });
    this.setPricing('gpt-4-turbo', { inputCostPer1k: 0.01, outputCostPer1k: 0.03 });
    this.setPricing('gpt-4', { inputCostPer1k: 0.03, outputCostPer1k: 0.06 });
    this.setPricing('gpt-3.5-turbo', { inputCostPer1k: 0.0005, outputCostPer1k: 0.0015 });
    this.setPricing('claude-sonnet-4-20250514', { inputCostPer1k: 0.003, outputCostPer1k: 0.015 });
    this.setPricing('claude-3-5-sonnet-20241022', { inputCostPer1k: 0.003, outputCostPer1k: 0.015 });
    this.setPricing('claude-3-5-haiku-20241022', { inputCostPer1k: 0.001, outputCostPer1k: 0.005 });
    this.setPricing('claude-3-opus-20240229', { inputCostPer1k: 0.015, outputCostPer1k: 0.075 });
    this.setPricing('claude-3-haiku-20240307', { inputCostPer1k: 0.00025, outputCostPer1k: 0.00125 });
  }

  /** 设置模型定价 */
  setPricing(model: string, pricing: ModelPricing): void {
    this.pricing.set(model, pricing);
  }

  /** 记录使用量 */
  recordUsage(model: string, usage: TokenUsage, conversationId?: string): void {
    const pricing = this.pricing.get(model);
    if (!pricing) {
      // 没有定价信息，使用默认值
      this.records.push({
        model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        inputCost: 0,
        outputCost: 0,
        timestamp: Date.now(),
        conversationId,
      });
      return;
    }

    const inputCost = (usage.promptTokens / 1000) * pricing.inputCostPer1k;
    const outputCost = (usage.completionTokens / 1000) * pricing.outputCostPer1k;

    this.records.push({
      model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      inputCost,
      outputCost,
      timestamp: Date.now(),
      conversationId,
    });
  }

  /** 获取总成本或指定对话的成本 */
  getCost(conversationId?: string): CostInfo {
    const filtered = conversationId
      ? this.records.filter((r) => r.conversationId === conversationId)
      : this.records;

    return {
      totalCost: filtered.reduce((sum, r) => sum + r.inputCost + r.outputCost, 0),
      inputCost: filtered.reduce((sum, r) => sum + r.inputCost, 0),
      outputCost: filtered.reduce((sum, r) => sum + r.outputCost, 0),
      totalTokens: filtered.reduce((sum, r) => sum + r.promptTokens + r.completionTokens, 0),
      requestCount: filtered.length,
    };
  }

  /** 获取每日成本 */
  getDailyCost(date?: string): DailyCost {
    const targetDate = date ?? this.getTodayString();
    const filtered = this.records.filter((r) => this.getDateString(r.timestamp) === targetDate);

    return {
      date: targetDate,
      cost: filtered.reduce((sum, r) => sum + r.inputCost + r.outputCost, 0),
      inputCost: filtered.reduce((sum, r) => sum + r.inputCost, 0),
      outputCost: filtered.reduce((sum, r) => sum + r.outputCost, 0),
      totalTokens: filtered.reduce((sum, r) => sum + r.promptTokens + r.completionTokens, 0),
      requestCount: filtered.length,
    };
  }

  /** 获取每月成本 */
  getMonthlyCost(month?: string): MonthlyCost {
    const targetMonth = month ?? this.getCurrentMonthString();
    const filtered = this.records.filter((r) => this.getMonthString(r.timestamp) === targetMonth);

    // 按日分组
    const dailyMap = new Map<string, CostRecord[]>();
    for (const record of filtered) {
      const day = this.getDateString(record.timestamp);
      const dayRecords = dailyMap.get(day) ?? [];
      dayRecords.push(record);
      dailyMap.set(day, dayRecords);
    }

    const dailyBreakdown: DailyCost[] = [];
    for (const [day, dayRecords] of dailyMap) {
      dailyBreakdown.push({
        date: day,
        cost: dayRecords.reduce((sum, r) => sum + r.inputCost + r.outputCost, 0),
        inputCost: dayRecords.reduce((sum, r) => sum + r.inputCost, 0),
        outputCost: dayRecords.reduce((sum, r) => sum + r.outputCost, 0),
        totalTokens: dayRecords.reduce((sum, r) => sum + r.promptTokens + r.completionTokens, 0),
        requestCount: dayRecords.length,
      });
    }

    dailyBreakdown.sort((a, b) => a.date.localeCompare(b.date));

    return {
      month: targetMonth,
      cost: filtered.reduce((sum, r) => sum + r.inputCost + r.outputCost, 0),
      inputCost: filtered.reduce((sum, r) => sum + r.inputCost, 0),
      outputCost: filtered.reduce((sum, r) => sum + r.outputCost, 0),
      totalTokens: filtered.reduce((sum, r) => sum + r.promptTokens + r.completionTokens, 0),
      requestCount: filtered.length,
      dailyBreakdown,
    };
  }

  /** 成本预测 */
  projectCost(days: number): CostProjection {
    // 获取最近 7 天的数据
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const recentRecords = this.records.filter((r) => r.timestamp >= sevenDaysAgo);

    const recentDailyCosts: number[] = [];
    for (let i = 0; i < 7; i++) {
      const dayStart = now - (i + 1) * 24 * 60 * 60 * 1000;
      const dayEnd = now - i * 24 * 60 * 60 * 1000;
      const dayRecords = recentRecords.filter((r) => r.timestamp >= dayStart && r.timestamp < dayEnd);
      const dayCost = dayRecords.reduce((sum, r) => sum + r.inputCost + r.outputCost, 0);
      recentDailyCosts.unshift(dayCost);
    }

    const avgDailyCost = recentDailyCosts.reduce((a, b) => a + b, 0) / recentDailyCosts.length;
    const avgDailyTokens = recentRecords.reduce((sum, r) => sum + r.promptTokens + r.completionTokens, 0) / 7;

    // 计算趋势
    let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    if (recentDailyCosts.length >= 3) {
      const firstHalf = recentDailyCosts.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
      const secondHalf = recentDailyCosts.slice(-3).reduce((a, b) => a + b, 0) / 3;
      if (secondHalf > firstHalf * 1.1) trend = 'increasing';
      else if (secondHalf < firstHalf * 0.9) trend = 'decreasing';
    }

    const confidence = Math.min(1, recentRecords.length / 100);

    return {
      projectedDailyCost: avgDailyCost,
      projectedMonthlyCost: avgDailyCost * 30,
      projectedDailyTokens: avgDailyTokens,
      projectedMonthlyTokens: avgDailyTokens * 30,
      trend,
      confidence,
    };
  }

  /** 设置预算限制 */
  setBudgetLimit(type: 'daily' | 'monthly', limit: number): void {
    if (type === 'daily') {
      this.dailyBudget = limit;
    } else {
      this.monthlyBudget = limit;
    }
  }

  /** 检查是否超出预算 */
  isOverBudget(type: 'daily' | 'monthly'): boolean {
    if (type === 'daily') {
      if (this.dailyBudget === null) return false;
      return this.getDailyCost().cost > this.dailyBudget;
    } else {
      if (this.monthlyBudget === null) return false;
      return this.getMonthlyCost().cost > this.monthlyBudget;
    }
  }

  /** 获取预算剩余 */
  getBudgetRemaining(type: 'daily' | 'monthly'): number {
    if (type === 'daily') {
      if (this.dailyBudget === null) return Infinity;
      return Math.max(0, this.dailyBudget - this.getDailyCost().cost);
    } else {
      if (this.monthlyBudget === null) return Infinity;
      return Math.max(0, this.monthlyBudget - this.getMonthlyCost().cost);
    }
  }

  /** 获取模型定价 */
  getPricing(model: string): ModelPricing | undefined {
    return this.pricing.get(model);
  }

  /** 按模型获取成本 */
  getCostByModel(): Record<string, CostInfo> {
    const byModel = new Map<string, CostRecord[]>();
    for (const record of this.records) {
      const modelRecords = byModel.get(record.model) ?? [];
      modelRecords.push(record);
      byModel.set(record.model, modelRecords);
    }

    const result: Record<string, CostInfo> = {};
    for (const [model, modelRecords] of byModel) {
      result[model] = {
        totalCost: modelRecords.reduce((sum, r) => sum + r.inputCost + r.outputCost, 0),
        inputCost: modelRecords.reduce((sum, r) => sum + r.inputCost, 0),
        outputCost: modelRecords.reduce((sum, r) => sum + r.outputCost, 0),
        totalTokens: modelRecords.reduce((sum, r) => sum + r.promptTokens + r.completionTokens, 0),
        requestCount: modelRecords.length,
      };
    }

    return result;
  }

  /** 清除记录 */
  clearRecords(): void {
    this.records = [];
  }

  private getTodayString(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private getCurrentMonthString(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  private getDateString(timestamp: number): string {
    const d = new Date(timestamp);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private getMonthString(timestamp: number): string {
    const d = new Date(timestamp);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
}
