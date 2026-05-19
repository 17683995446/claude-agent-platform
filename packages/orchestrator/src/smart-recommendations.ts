// ============================================================================
// SmartRecommendations - Intelligent Task Recommendations
// ============================================================================

import type { Recommendation, ExecutionRecord, TaskIntent } from './types.js';

// ---- Recommendation ID generator ----

let recCounter = 0;

function generateRecId(): string {
  recCounter++;
  return `rec-${Date.now().toString(36)}-${recCounter.toString(36)}`;
}

// ---- Project feature keywords ----

const PROJECT_FEATURE_KEYWORDS: Record<string, { keywords: string[]; recommendation: Recommendation }> = {
  'has-tests': {
    keywords: ['test', 'spec', '__tests__', '*.test.*', '*.spec.*'],
    recommendation: {
      id: '',
      type: 'optimization',
      title: '运行测试',
      description: '检测到项目包含测试文件，建议定期运行测试确保代码质量',
      confidence: 0.9,
      source: 'project_analysis',
      suggestedAction: 'claude-agent ask "运行项目测试"',
      priority: 'medium',
      createdAt: new Date(),
    },
  },
  'has-docker': {
    keywords: ['Dockerfile', 'docker-compose', '.docker'],
    recommendation: {
      id: '',
      type: 'task',
      title: 'Docker 优化',
      description: '检测到项目使用 Docker，建议检查镜像大小和构建优化',
      confidence: 0.8,
      source: 'project_analysis',
      suggestedAction: 'claude-agent ask "优化 Docker 镜像"',
      priority: 'low',
      createdAt: new Date(),
    },
  },
  'has-ci': {
    keywords: ['.github/workflows', '.gitlab-ci.yml', 'Jenkinsfile', '.circleci'],
    recommendation: {
      id: '',
      type: 'optimization',
      title: 'CI/CD 检查',
      description: '检测到 CI/CD 配置，建议检查流水线效率',
      confidence: 0.85,
      source: 'project_analysis',
      suggestedAction: 'claude-agent ask "分析 CI/CD 流水线"',
      priority: 'medium',
      createdAt: new Date(),
    },
  },
  'has-api': {
    keywords: ['api', 'routes', 'controller', 'endpoint', 'handler'],
    recommendation: {
      id: '',
      type: 'task',
      title: 'API 文档生成',
      description: '检测到 API 相关代码，建议生成 API 文档',
      confidence: 0.75,
      source: 'project_analysis',
      suggestedAction: 'claude-agent ask "生成 API 文档"',
      priority: 'medium',
      createdAt: new Date(),
    },
  },
  'no-readme': {
    keywords: [],
    recommendation: {
      id: '',
      type: 'proactive',
      title: '缺少 README',
      description: '项目缺少 README 文件，建议创建项目文档',
      confidence: 0.95,
      source: 'best_practice',
      suggestedAction: 'claude-agent ask "生成项目 README"',
      priority: 'high',
      createdAt: new Date(),
    },
  },
};

// ---- SmartRecommendations Class ----

export class SmartRecommendations {
  private recommendations: Recommendation[] = [];
  private dismissedIds: Set<string> = new Set();
  private maxRecommendations: number;
  private maxDismissedIds: number = 200;

  constructor(maxRecommendations: number = 50) {
    this.maxRecommendations = maxRecommendations;
  }

  /** Analyze project features and generate recommendations */
  analyzeProject(fileList: string[]): Recommendation[] {
    const newRecs: Recommendation[] = [];

    // Check for README
    const hasReadme = fileList.some((f) => f.toLowerCase().includes('readme'));
    if (!hasReadme) {
      const rec = { ...PROJECT_FEATURE_KEYWORDS['no-readme'].recommendation, id: generateRecId() };
      newRecs.push(rec);
    }

    // Check other features
    for (const [feature, config] of Object.entries(PROJECT_FEATURE_KEYWORDS)) {
      if (feature === 'no-readme') continue;

      const hasFeature = config.keywords.some((keyword) =>
        fileList.some((f) => f.toLowerCase().includes(keyword.toLowerCase())),
      );

      if (hasFeature) {
        const rec = { ...config.recommendation, id: generateRecId() };
        newRecs.push(rec);
      }
    }

    this.addRecommendations(newRecs);
    return newRecs;
  }

  /** Generate recommendations based on execution history */
  analyzeHistory(records: ExecutionRecord[]): Recommendation[] {
    const newRecs: Recommendation[] = [];

    if (records.length === 0) return newRecs;

    // Check for recurring failures
    const failureCounts = new Map<string, number>();
    for (const record of records) {
      if (record.status === 'failed') {
        failureCounts.set(record.taskDescription, (failureCounts.get(record.taskDescription) ?? 0) + 1);
      }
    }

    for (const [task, count] of failureCounts) {
      if (count >= 3) {
        newRecs.push({
          id: generateRecId(),
          type: 'optimization',
          title: `重复失败: ${task}`,
          description: `"${task}" 已失败 ${count} 次，建议检查根本原因`,
          confidence: Math.min(count / 10, 1),
          source: 'history',
          suggestedAction: `claude-agent ask "分析为什么 ${task} 总是失败"`,
          priority: 'high',
          createdAt: new Date(),
        });
      }
    }

    // Check for tasks that take too long
    const avgDurations = new Map<string, { total: number; count: number }>();
    for (const record of records) {
      if (record.duration !== undefined && record.status === 'success') {
        const existing = avgDurations.get(record.taskDescription) ?? { total: 0, count: 0 };
        existing.total += record.duration;
        existing.count += 1;
        avgDurations.set(record.taskDescription, existing);
      }
    }

    for (const [task, { total, count }] of avgDurations) {
      const avg = total / count;
      if (avg > 30000) {
        newRecs.push({
          id: generateRecId(),
          type: 'optimization',
          title: `性能优化: ${task}`,
          description: `"${task}" 平均耗时 ${(avg / 1000).toFixed(1)}s，建议优化`,
          confidence: 0.7,
          source: 'history',
          suggestedAction: `claude-agent ask "优化 ${task} 的执行速度"`,
          priority: 'medium',
          createdAt: new Date(),
        });
      }
    }

    this.addRecommendations(newRecs);
    return newRecs;
  }

  /** Generate time-based recommendations */
  analyzePatterns(records: ExecutionRecord[]): Recommendation[] {
    const newRecs: Recommendation[] = [];
    if (records.length < 5) return newRecs;

    // Check for weekly patterns
    const dayCounts = new Map<string, number>();
    for (const record of records) {
      const day = record.startTime.toLocaleDateString('zh-CN', { weekday: 'long' });
      dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
    }

    // Find most active day
    let maxDay = '';
    let maxCount = 0;
    for (const [day, count] of dayCounts) {
      if (count > maxCount) {
        maxDay = day;
        maxCount = count;
      }
    }

    if (maxCount > records.length * 0.3) {
      newRecs.push({
        id: generateRecId(),
        type: 'schedule',
        title: '定时任务建议',
        description: `您在${maxDay}最活跃（${maxCount}次执行），建议设置定时任务`,
        confidence: 0.6,
        source: 'pattern',
        suggestedAction: '设置每周定时任务',
        priority: 'low',
        createdAt: new Date(),
      });
    }

    this.addRecommendations(newRecs);
    return newRecs;
  }

  /** Add recommendations */
  private addRecommendations(recs: Recommendation[]): void {
    for (const rec of recs) {
      if (!this.dismissedIds.has(rec.id)) {
        this.recommendations.push(rec);
      }
    }

    // Trim to max
    if (this.recommendations.length > this.maxRecommendations) {
      this.recommendations = this.recommendations.slice(-this.maxRecommendations);
    }
  }

  /** Get all active recommendations */
  getAll(): Recommendation[] {
    return this.recommendations.filter((r) => !this.dismissedIds.has(r.id));
  }

  /** Get recommendations by type */
  getByType(type: Recommendation['type']): Recommendation[] {
    return this.getAll().filter((r) => r.type === type);
  }

  /** Get recommendations by priority */
  getByPriority(priority: Recommendation['priority']): Recommendation[] {
    return this.getAll().filter((r) => r.priority === priority);
  }

  /** Dismiss a recommendation */
  dismiss(id: string): void {
    this.dismissedIds.add(id);
    // Trim dismissed IDs if exceeding max size
    if (this.dismissedIds.size > this.maxDismissedIds) {
      const toRemove = Array.from(this.dismissedIds).slice(0, this.dismissedIds.size - this.maxDismissedIds);
      for (const rid of toRemove) {
        this.dismissedIds.delete(rid);
      }
    }
  }

  /** Clear all recommendations */
  clear(): void {
    this.recommendations = [];
    this.dismissedIds.clear();
  }

  /** Get recommendation count */
  getCount(): number {
    return this.getAll().length;
  }
}
