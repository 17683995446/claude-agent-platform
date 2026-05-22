// src/metrics-dashboard.ts

export interface AnalysisResult {
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
  score?: number;
}

export interface DashboardData {
  analyses: AnalysisResult[];
  overallScore: number;
  alerts: MetricAlert[];
  summary: Record<string, unknown>;
  lastUpdated: string;
}

export interface MetricAlert {
  metric: string;
  level: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  value: number;
  threshold: number;
  timestamp: string;
}

export interface TrendData {
  metric: string;
  period: string;
  dataPoints: Array<{ timestamp: string; value: number }>;
  trend: 'improving' | 'stable' | 'worsening';
  changeRate: number;
}

export interface MetricThreshold {
  metric: string;
  warning: number;
  error: number;
  critical: number;
  direction: 'above' | 'below';
}

export class MetricsDashboard {
  private analyses: AnalysisResult[] = [];
  private thresholds: MetricThreshold[] = [];
  private history: Map<string, Array<{ timestamp: string; value: number }>> = new Map();

  constructor(thresholds?: MetricThreshold[]) {
    if (thresholds) {
      this.thresholds = thresholds;
    } else {
      // Default thresholds
      this.thresholds = [
        { metric: 'complexity', warning: 10, error: 20, critical: 30, direction: 'above' },
        { metric: 'duplication', warning: 5, error: 10, critical: 20, direction: 'above' },
        { metric: 'maintainability', warning: 60, error: 40, critical: 20, direction: 'below' },
        { metric: 'coverage', warning: 80, error: 60, critical: 40, direction: 'below' },
        { metric: 'codeSmells', warning: 5, error: 10, critical: 20, direction: 'above' },
      ];
    }
  }

  addAnalysis(type: string, result: AnalysisResult): void {
    const analysis: AnalysisResult = {
      type,
      timestamp: new Date().toISOString(),
      data: result.data,
      score: result.score,
    };
    this.analyses.push(analysis);

    // Record history for trending
    if (result.score !== undefined) {
      if (!this.history.has(type)) {
        this.history.set(type, []);
      }
      this.history.get(type)!.push({ timestamp: analysis.timestamp, value: result.score });
    }
  }

  getDashboard(): DashboardData {
    const overallScore = this.calculateOverallScore();
    const alerts = this.getAlerts();
    const summary = this.generateSummary();

    return {
      analyses: [...this.analyses],
      overallScore,
      alerts,
      summary,
      lastUpdated: new Date().toISOString(),
    };
  }

  getTrend(metric: string, period: string): TrendData {
    const dataPoints = this.history.get(metric) || [];
    const filtered = this.filterByPeriod(dataPoints, period);

    let trend: 'improving' | 'stable' | 'worsening' = 'stable';
    let changeRate = 0;

    if (filtered.length >= 2) {
      const first = filtered[0].value;
      const last = filtered[filtered.length - 1].value;
      changeRate = first !== 0 ? Math.round(((last - first) / first) * 10000) / 100 : 0;

      const threshold = this.thresholds.find(t => t.metric === metric);
      if (threshold) {
        if (threshold.direction === 'above') {
          if (changeRate < -5) trend = 'improving';
          else if (changeRate > 5) trend = 'worsening';
        } else {
          if (changeRate > 5) trend = 'improving';
          else if (changeRate < -5) trend = 'worsening';
        }
      }
    }

    return { metric, period, dataPoints: filtered, trend, changeRate };
  }

  getAlerts(): MetricAlert[] {
    const alerts: MetricAlert[] = [];

    for (const analysis of this.analyses) {
      if (analysis.score === undefined) continue;

      const threshold = this.thresholds.find(t => t.metric === analysis.type);
      if (!threshold) continue;

      let level: MetricAlert['level'] | undefined;
      if (threshold.direction === 'above') {
        if (analysis.score >= threshold.critical) level = 'critical';
        else if (analysis.score >= threshold.error) level = 'error';
        else if (analysis.score >= threshold.warning) level = 'warning';
      } else {
        if (analysis.score <= threshold.critical) level = 'critical';
        else if (analysis.score <= threshold.error) level = 'error';
        else if (analysis.score <= threshold.warning) level = 'warning';
      }

      if (level) {
        alerts.push({
          metric: analysis.type,
          level,
          message: `${analysis.type} score ${analysis.score} is ${level}`,
          value: analysis.score,
          threshold: threshold.direction === 'above' ? threshold.warning : threshold.warning,
          timestamp: analysis.timestamp,
        });
      }
    }

    return alerts.sort((a, b) => {
      const order = { critical: 0, error: 1, warning: 2, info: 3 };
      return order[a.level] - order[b.level];
    });
  }

  generateReport(format: 'json' | 'markdown' | 'html'): string {
    const dashboard = this.getDashboard();

    if (format === 'json') {
      return JSON.stringify(dashboard, null, 2);
    }

    if (format === 'markdown') {
      return this.generateMarkdownReport(dashboard);
    }

    return this.generateHtmlReport(dashboard);
  }

  private calculateOverallScore(): number {
    const scored = this.analyses.filter(a => a.score !== undefined);
    if (scored.length === 0) return 0;

    // Weight recent analyses more
    const total = scored.reduce((sum, a) => sum + (a.score || 0), 0);
    return Math.round((total / scored.length) * 100) / 100;
  }

  private generateSummary(): Record<string, unknown> {
    const summary: Record<string, unknown> = {
      totalAnalyses: this.analyses.length,
      analysisTypes: [...new Set(this.analyses.map(a => a.type))],
    };

    for (const analysis of this.analyses) {
      if (analysis.score !== undefined) {
        summary[`${analysis.type}_score`] = analysis.score;
      }
    }

    return summary;
  }

  private filterByPeriod(data: Array<{ timestamp: string; value: number }>, period: string): Array<{ timestamp: string; value: number }> {
    if (data.length === 0) return [];

    const now = new Date();
    let cutoff: Date;

    switch (period) {
      case 'day': cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000); break;
      case 'week': cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
      case 'month': cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
      case 'year': cutoff = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000); break;
      default: return data;
    }

    return data.filter(d => new Date(d.timestamp) >= cutoff);
  }

  private generateMarkdownReport(dashboard: DashboardData): string {
    let md = '# Code Metrics Dashboard\n\n';
    md += `**Overall Score:** ${dashboard.overallScore}\n\n`;
    md += `**Last Updated:** ${dashboard.lastUpdated}\n\n`;

    if (dashboard.alerts.length > 0) {
      md += '## Alerts\n\n';
      for (const alert of dashboard.alerts) {
        md += `- **[${alert.level.toUpperCase()}]** ${alert.message}\n`;
      }
      md += '\n';
    }

    md += '## Analysis Results\n\n';
    for (const analysis of dashboard.analyses) {
      md += `### ${analysis.type}\n`;
      md += `- Score: ${analysis.score ?? 'N/A'}\n`;
      md += `- Timestamp: ${analysis.timestamp}\n\n`;
    }

    return md;
  }

  private generateHtmlReport(dashboard: DashboardData): string {
    let html = '<!DOCTYPE html><html><head><title>Code Metrics Dashboard</title>';
    html += '<style>body{font-family:sans-serif;max-width:800px;margin:0 auto;padding:20px}';
    html += '.score{font-size:48px;font-weight:bold;text-align:center;margin:20px 0}';
    html += '.alert{padding:10px;margin:5px 0;border-radius:4px}';
    html += '.critical{background:#fee;color:#c00} .error{background:#fde;color:#c60}';
    html += '.warning{background:#ffe;color:#860} .info{background:#eff;color:#06c}';
    html += 'table{width:100%;border-collapse:collapse} th,td{border:1px solid #ddd;padding:8px;text-align:left}';
    html += '</style></head><body>';
    html += `<h1>Code Metrics Dashboard</h1>`;
    html += `<div class="score">${dashboard.overallScore}</div>`;

    if (dashboard.alerts.length > 0) {
      html += '<h2>Alerts</h2>';
      for (const alert of dashboard.alerts) {
        html += `<div class="alert ${alert.level}">${alert.level}: ${alert.message}</div>`;
      }
    }

    html += '<h2>Analyses</h2><table><tr><th>Type</th><th>Score</th><th>Time</th></tr>';
    for (const analysis of dashboard.analyses) {
      html += `<tr><td>${analysis.type}</td><td>${analysis.score ?? 'N/A'}</td><td>${analysis.timestamp}</td></tr>`;
    }
    html += '</table></body></html>';

    return html;
  }
}
