// src/technical-debt.ts

export type DebtType = 'code_smell' | 'missing_tests' | 'outdated_dependency' | 'known_bug' | 'performance_issue' | 'security_issue' | 'documentation_gap';

export type DebtPriority = 'low' | 'medium' | 'high' | 'critical';

export interface DebtItem {
  id: string;
  title: string;
  description: string;
  type: DebtType;
  priority: DebtPriority;
  effort: number; // hours
  impact: number; // 1-10
  tags: string[];
  file?: string;
  line?: number;
  createdAt: string;
  resolvedAt?: string;
  status: 'open' | 'in_progress' | 'resolved';
}

export interface DebtReport {
  totalItems: number;
  openItems: number;
  resolvedItems: number;
  totalDebtHours: number;
  byType: Record<DebtType, number>;
  byPriority: Record<DebtPriority, number>;
  topItems: DebtItem[];
  trend: DebtTrend;
}

export interface DebtTrend {
  direction: 'improving' | 'stable' | 'worsening';
  changeRate: number;
}

export interface DebtSchedule {
  items: DebtItem[];
  totalEffort: number;
  timeline: string;
}

let debtIdCounter = 0;

function generateId(): string {
  debtIdCounter++;
  return `debt-${Date.now()}-${debtIdCounter}`;
}

export class TechnicalDebtTracker {
  private debts: Map<string, DebtItem> = new Map();
  private history: Array<{ timestamp: string; openCount: number; totalHours: number }> = [];

  addDebt(item: Omit<DebtItem, 'id' | 'createdAt' | 'status'>): DebtItem {
    const debtItem: DebtItem = {
      ...item,
      id: generateId(),
      createdAt: new Date().toISOString(),
      status: 'open',
    };
    this.debts.set(debtItem.id, debtItem);
    return debtItem;
  }

  resolveDebt(debtId: string): void {
    const debt = this.debts.get(debtId);
    if (debt) {
      debt.status = 'resolved';
      debt.resolvedAt = new Date().toISOString();
    }
  }

  updateDebt(debtId: string, updates: Partial<DebtItem>): void {
    const debt = this.debts.get(debtId);
    if (debt) {
      Object.assign(debt, updates);
    }
  }

  getDebt(debtId: string): DebtItem | undefined {
    return this.debts.get(debtId);
  }

  getDebtReport(): DebtReport {
    const allDebts = Array.from(this.debts.values());
    const openItems = allDebts.filter(d => d.status === 'open');
    const resolvedItems = allDebts.filter(d => d.status === 'resolved');

    const byType: Record<DebtType, number> = {
      code_smell: 0, missing_tests: 0, outdated_dependency: 0,
      known_bug: 0, performance_issue: 0, security_issue: 0, documentation_gap: 0,
    };
    const byPriority: Record<DebtPriority, number> = { low: 0, medium: 0, high: 0, critical: 0 };

    let totalHours = 0;
    for (const debt of openItems) {
      byType[debt.type]++;
      byPriority[debt.priority]++;
      totalHours += debt.effort;
    }

    // Top items by priority and impact
    const topItems = [...openItems]
      .sort((a, b) => {
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        }
        return b.impact - a.impact;
      })
      .slice(0, 10);

    // Trend
    const trend = this.calculateTrend();

    return {
      totalItems: allDebts.length,
      openItems: openItems.length,
      resolvedItems: resolvedItems.length,
      totalDebtHours: Math.round(totalHours * 100) / 100,
      byType,
      byPriority,
      topItems,
      trend,
    };
  }

  getTotalDebtHours(): number {
    let total = 0;
    for (const debt of this.debts.values()) {
      if (debt.status === 'open') {
        total += debt.effort;
      }
    }
    return Math.round(total * 100) / 100;
  }

  getPriorityDebt(priority: DebtPriority): DebtItem[] {
    return Array.from(this.debts.values()).filter(d => d.priority === priority && d.status === 'open');
  }

  getDebtByType(type: DebtType): DebtItem[] {
    return Array.from(this.debts.values()).filter(d => d.type === type && d.status === 'open');
  }

  scheduleRepayment(maxHoursPerSprint: number): DebtSchedule {
    const openItems = Array.from(this.debts.values())
      .filter(d => d.status === 'open')
      .sort((a, b) => {
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        }
        return b.impact - a.impact;
      });

    const scheduled: DebtItem[] = [];
    let totalEffort = 0;

    for (const item of openItems) {
      if (totalEffort + item.effort <= maxHoursPerSprint) {
        scheduled.push(item);
        totalEffort += item.effort;
      }
    }

    const remainingHours = openItems.reduce((sum, d) => sum + d.effort, 0) - totalEffort;
    const sprintsNeeded = Math.ceil(remainingHours / maxHoursPerSprint);
    const timeline = sprintsNeeded > 0 ? `${sprintsNeeded + 1} sprints` : '1 sprint';

    return { items: scheduled, totalEffort: Math.round(totalEffort * 100) / 100, timeline };
  }

  recordSnapshot(): void {
    const openCount = Array.from(this.debts.values()).filter(d => d.status === 'open').length;
    const totalHours = this.getTotalDebtHours();
    this.history.push({ timestamp: new Date().toISOString(), openCount, totalHours });
  }

  private calculateTrend(): DebtTrend {
    if (this.history.length < 2) {
      return { direction: 'stable', changeRate: 0 };
    }

    const recent = this.history[this.history.length - 1];
    const previous = this.history[this.history.length - 2];

    const change = recent.openCount - previous.openCount;

    if (change < 0) return { direction: 'improving', changeRate: Math.abs(change) };
    if (change > 0) return { direction: 'worsening', changeRate: change };
    return { direction: 'stable', changeRate: 0 };
  }
}
