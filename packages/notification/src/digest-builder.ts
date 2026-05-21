// src/digest-builder.ts - Digest Builder Module

import type { Notification, NotificationType } from './notification-center.ts';

export type DigestPeriod = 'hourly' | 'daily' | 'weekly';

export interface DigestNotification extends Notification {
  category?: string;
}

export interface Digest {
  period: DigestPeriod;
  startTime: number;
  endTime: number;
  notifications: DigestNotification[];
  summary: DigestSummary;
  generatedAt: number;
}

export interface DigestSummary {
  total: number;
  byType: Record<NotificationType, number>;
  byCategory: Record<string, number>;
  byPriority: Record<string, number>;
}

export interface DigestRule {
  includeTypes?: NotificationType[];
  excludeTypes?: NotificationType[];
  includeCategories?: string[];
  excludeCategories?: string[];
  minPriority?: string;
}

export interface DigestTemplate {
  header: string;
  itemFormat: string;
  footer: string;
  separator?: string;
}

export class DigestBuilder {
  private notifications: DigestNotification[] = [];
  private rules: DigestRule[] = [];
  private templates: Map<DigestPeriod, DigestTemplate> = new Map();

  constructor() {
    this.setDefaultTemplates();
  }

  addNotification(notification: Notification): void {
    const digestNotif: DigestNotification = {
      ...notification,
      category: (notification.data?.category as string) || 'general',
    };
    this.notifications.push(digestNotif);
  }

  buildDigest(period: DigestPeriod): Digest {
    const now = Date.now();
    const periodMs = this.getPeriodMs(period);
    const startTime = now - periodMs;

    const filtered = this.notifications.filter(n => n.timestamp >= startTime);

    // Apply rules
    const finalNotifications = this.applyRules(filtered);

    const summary = this.buildSummary(finalNotifications);

    return {
      period,
      startTime,
      endTime: now,
      notifications: finalNotifications,
      summary,
      generatedAt: now,
    };
  }

  renderMarkdown(digest: Digest): string {
    const template = this.templates.get(digest.period) || this.templates.get('daily')!;
    const lines: string[] = [];

    lines.push(template.header.replace('{{period}}', digest.period).replace('{{date}}', new Date(digest.generatedAt).toLocaleDateString()));
    lines.push('');

    lines.push(`**Summary:** ${digest.summary.total} notifications`);
    lines.push('');
    lines.push('| Type | Priority | Title | Time |');
    lines.push('|------|----------|-------|------|');

    for (const n of digest.notifications) {
      const time = new Date(n.timestamp).toLocaleTimeString();
      lines.push(`| ${n.type} | ${n.priority} | ${n.title} | ${time} |`);
    }

    lines.push('');
    lines.push(template.footer.replace('{{generated_at}}', new Date(digest.generatedAt).toISOString()));

    return lines.join('\n');
  }

  renderHTML(digest: Digest): string {
    const lines: string[] = [];

    lines.push('<!DOCTYPE html>');
    lines.push('<html><head><style>');
    lines.push('body { font-family: Arial, sans-serif; margin: 20px; }');
    lines.push('.header { background: #f0f0f0; padding: 10px; border-radius: 5px; }');
    lines.push('.notification { padding: 8px; margin: 5px 0; border-left: 3px solid #ccc; }');
    lines.push('.info { border-color: #2196F3; }');
    lines.push('.success { border-color: #4CAF50; }');
    lines.push('.warning { border-color: #FF9800; }');
    lines.push('.error { border-color: #F44336; }');
    lines.push('.progress { border-color: #9C27B0; }');
    lines.push('.summary { margin: 10px 0; font-weight: bold; }');
    lines.push('</style></head><body>');

    lines.push(`<div class="header"><h2>Notification Digest - ${digest.period}</h2>`);
    lines.push(`<p>Generated: ${new Date(digest.generatedAt).toLocaleString()}</p></div>`);

    lines.push(`<div class="summary">Total: ${digest.summary.total} notifications</div>`);

    for (const n of digest.notifications) {
      const time = new Date(n.timestamp).toLocaleString();
      lines.push(`<div class="notification ${n.type}">`);
      lines.push(`<strong>[${n.type.toUpperCase()}] ${n.title}</strong>`);
      lines.push(`<p>${n.message}</p>`);
      lines.push(`<small>Priority: ${n.priority} | ${time}</small>`);
      lines.push('</div>');
    }

    lines.push('</body></html>');

    return lines.join('\n');
  }

  addRule(rule: DigestRule): void {
    this.rules.push(rule);
  }

  setTemplate(period: DigestPeriod, template: DigestTemplate): void {
    this.templates.set(period, template);
  }

  clear(): void {
    this.notifications = [];
  }

  private getPeriodMs(period: DigestPeriod): number {
    switch (period) {
      case 'hourly': return 3600000;
      case 'daily': return 86400000;
      case 'weekly': return 604800000;
    }
  }

  private applyRules(notifications: DigestNotification[]): DigestNotification[] {
    if (this.rules.length === 0) return [...notifications];

    // Each rule independently filters; results are unioned (OR logic)
    const resultSets: Set<DigestNotification>[] = [];

    for (const rule of this.rules) {
      let filtered = [...notifications];

      if (rule.includeTypes) {
        filtered = filtered.filter(n => rule.includeTypes!.includes(n.type));
      }
      if (rule.excludeTypes) {
        filtered = filtered.filter(n => !rule.excludeTypes!.includes(n.type));
      }
      if (rule.includeCategories) {
        filtered = filtered.filter(n => rule.includeCategories!.includes(n.category || 'general'));
      }
      if (rule.excludeCategories) {
        filtered = filtered.filter(n => !rule.excludeCategories!.includes(n.category || 'general'));
      }

      resultSets.push(new Set(filtered));
    }

    // Union of all rule results
    const unionSet = new Set<DigestNotification>();
    for (const set of resultSets) {
      for (const item of set) {
        unionSet.add(item);
      }
    }

    return Array.from(unionSet);
  }

  private buildSummary(notifications: DigestNotification[]): DigestSummary {
    const summary: DigestSummary = {
      total: notifications.length,
      byType: { info: 0, success: 0, warning: 0, error: 0, progress: 0 },
      byCategory: {},
      byPriority: {},
    };

    for (const n of notifications) {
      summary.byType[n.type]++;
      const cat = n.category || 'general';
      summary.byCategory[cat] = (summary.byCategory[cat] || 0) + 1;
      summary.byPriority[n.priority] = (summary.byPriority[n.priority] || 0) + 1;
    }

    return summary;
  }

  private setDefaultTemplates(): void {
    this.templates.set('hourly', {
      header: '# Hourly Digest - {{date}}',
      itemFormat: '- [{{type}}] {{title}}: {{message}}',
      footer: '---\nGenerated at {{generated_at}}',
    });
    this.templates.set('daily', {
      header: '# Daily Digest - {{date}}',
      itemFormat: '- [{{type}}] {{title}}: {{message}}',
      footer: '---\nGenerated at {{generated_at}}',
    });
    this.templates.set('weekly', {
      header: '# Weekly Digest - {{date}}',
      itemFormat: '## {{type}}\n- {{title}}: {{message}}',
      footer: '---\nGenerated at {{generated_at}}',
    });
  }
}
