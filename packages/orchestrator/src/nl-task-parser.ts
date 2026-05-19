// ============================================================================
// NLTaskParser - Natural Language Task Parser
// ============================================================================

import type { ParsedTask, TaskIntent, ExtractedEntity, EntityType } from './types.js';

// ---- Intent keyword mappings ----

const INTENT_PATTERNS: { intent: TaskIntent; zhKeywords: string[]; enKeywords: string[] }[] = [
  {
    intent: 'analyze',
    zhKeywords: ['分析', '解析', '检查', '审查', '诊断', '评估', '调研', '了解', '查看'],
    enKeywords: ['analyze', 'analyse', 'inspect', 'examine', 'review', 'audit', 'assess', 'investigate', 'diagnose'],
  },
  {
    intent: 'test',
    zhKeywords: ['测试', '跑测试', '运行测试', '单元测试', '集成测试', 'e2e'],
    enKeywords: ['test', 'testing', 'run tests', 'spec', 'unit test', 'integration test', 'e2e'],
  },
  {
    intent: 'deploy',
    zhKeywords: ['部署', '发布', '上线', '发布到', '部署到', '推送', '交付'],
    enKeywords: ['deploy', 'release', 'publish', 'ship', 'push', 'deliver', 'rollout'],
  },
  {
    intent: 'fix',
    zhKeywords: ['修复', '修补', '解决', '处理', '改正', '消除', '排错', 'debug', '调试'],
    enKeywords: ['fix', 'repair', 'resolve', 'patch', 'debug', 'troubleshoot', 'solve', 'correct'],
  },
  {
    intent: 'generate',
    zhKeywords: ['生成', '创建', '新建', '构建', '搭建', '编写', '自动生成', '初始化'],
    enKeywords: ['generate', 'create', 'build', 'scaffold', 'initialize', 'init', 'make', 'new'],
  },
  {
    intent: 'refactor',
    zhKeywords: ['重构', '优化', '整理', '改进', '改善', '重写', '清理'],
    enKeywords: ['refactor', 'restructure', 'reorganize', 'rewrite', 'clean up', 'improve', 'modernize'],
  },
  {
    intent: 'document',
    zhKeywords: ['文档', '注释', '说明', '写文档', '生成文档', 'API文档'],
    enKeywords: ['document', 'documenting', 'docs', 'readme', 'comment', 'annotate', 'javadoc', 'jsdoc'],
  },
  {
    intent: 'optimize',
    zhKeywords: ['优化', '提速', '加速', '压缩', '精简', '性能', '瘦身'],
    enKeywords: ['optimize', 'speed up', 'accelerate', 'compress', 'minify', 'performance', 'profile'],
  },
  {
    intent: 'migrate',
    zhKeywords: ['迁移', '升级', '转换', '移植', '迁移到', '升级到'],
    enKeywords: ['migrate', 'upgrade', 'convert', 'port', 'transition', 'move to'],
  },
  {
    intent: 'review',
    zhKeywords: ['审查', '代码审查', 'CR', '检查代码', '审阅', '复核'],
    enKeywords: ['review', 'code review', 'cr', 'pr review', 'peer review', 'check code'],
  },
];

// ---- Priority keywords ----

const PRIORITY_KEYWORDS = {
  critical: { zh: ['紧急', '立即', '马上', '严重', '关键'], en: ['critical', 'urgent', 'asap', 'immediately', 'severe'] },
  high: { zh: ['重要', '优先', '尽快'], en: ['important', 'high priority', 'high', 'priority'] },
  low: { zh: ['不急', '有空', '闲时', '低优先'], en: ['low priority', 'low', 'when possible', 'no rush'] },
};

// ---- File path patterns (factories to avoid shared state) ----

function createFilePathPatterns(): RegExp[] {
  return [
    /(?:^|\s)([~./][\w./\-]+)/g,
    /(?:^|\s)([\w./\-]+\.\w{1,5})(?:\s|$)/g,
    /(?:路径|path|文件|file|目录|dir)[:\s]+([~./][\w./\-]+)/gi,
  ];
}

// ---- Module name patterns (factory) ----

function createModulePatterns(): RegExp[] {
  return [
    /(?:模块|module|包|package)[:\s]+([\w@./\-]+)/gi,
    /@[\w.-]+\/[\w.-]+/g,
  ];
}

// ---- Parameter patterns (factory) ----

function createParameterPatterns(): RegExp[] {
  return [
    /--([\w-]+)(?:=|\s+)([^\s]+)/g,
    /(?:参数|param|配置|config|选项|option)[:\s]+([\w-]+)(?:[:\s]+([^\s]+))?/gi,
  ];
}

// ---- Language detection ----

function detectLanguage(text: string): 'zh' | 'en' | 'mixed' {
  const zhChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const enChars = (text.match(/[a-zA-Z]/g) || []).length;
  const total = zhChars + enChars;

  if (total === 0) return 'en';
  const zhRatio = zhChars / total;

  if (zhRatio > 0.7) return 'zh';
  if (zhRatio < 0.3) return 'en';
  return 'mixed';
}

// ---- Intent recognition ----

function recognizeIntent(text: string): { intent: TaskIntent; confidence: number } {
  const lower = text.toLowerCase();
  let bestIntent: TaskIntent = 'unknown';
  let bestScore = 0;

  for (const pattern of INTENT_PATTERNS) {
    let score = 0;
    const allKeywords = [...pattern.zhKeywords, ...pattern.enKeywords];

    for (const keyword of allKeywords) {
      if (lower.includes(keyword.toLowerCase())) {
        score += 1;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestIntent = pattern.intent;
    }
  }

  return {
    intent: bestIntent,
    confidence: Math.min(bestScore * 10, 1),
  };
}

// ---- Entity extraction ----

function extractEntities(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  let entityId = 0;

  // Extract file paths
  for (const regex of createFilePathPatterns()) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const value = match[1] || match[0];
      entities.push({
        type: 'filePath' as EntityType,
        value: value.trim(),
        confidence: 0.9,
        startIndex: match.index,
        endIndex: match.index + match[0]!.length,
      });
      entityId++;
    }
  }

  // Extract module names
  for (const regex of createModulePatterns()) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const value = match[1] || match[0];
      entities.push({
        type: 'moduleName' as EntityType,
        value: value.trim(),
        confidence: 0.85,
        startIndex: match.index,
        endIndex: match.index + match[0]!.length,
      });
      entityId++;
    }
  }

  // Extract parameters
  for (const regex of createParameterPatterns()) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const name = match[1];
      const value = match[2];
      entities.push({
        type: 'parameter' as EntityType,
        value: value ? `${name}=${value}` : name!,
        confidence: 0.8,
        startIndex: match.index,
        endIndex: match.index + match[0]!.length,
      });
      entityId++;
    }
  }

  return entities;
}

// ---- Priority detection ----

function detectPriority(text: string): 'low' | 'medium' | 'high' | 'critical' {
  const lower = text.toLowerCase();

  for (const keyword of PRIORITY_KEYWORDS.critical.zh) {
    if (lower.includes(keyword)) return 'critical';
  }
  for (const keyword of PRIORITY_KEYWORDS.critical.en) {
    const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (regex.test(lower)) return 'critical';
  }

  for (const keyword of PRIORITY_KEYWORDS.high.zh) {
    if (lower.includes(keyword)) return 'high';
  }
  for (const keyword of PRIORITY_KEYWORDS.high.en) {
    const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (regex.test(lower)) return 'high';
  }

  for (const keyword of PRIORITY_KEYWORDS.low.zh) {
    if (lower.includes(keyword)) return 'low';
  }
  for (const keyword of PRIORITY_KEYWORDS.low.en) {
    const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (regex.test(lower)) return 'low';
  }

  return 'medium';
}

// ---- Tag extraction ----

function extractTags(text: string, intent: TaskIntent): string[] {
  const tags: string[] = [intent];
  const lower = text.toLowerCase();

  if (lower.includes('性能') || lower.includes('performance')) tags.push('performance');
  if (lower.includes('安全') || lower.includes('security')) tags.push('security');
  if (lower.includes('兼容') || lower.includes('compat')) tags.push('compatibility');
  if (lower.includes('api') || lower.includes('接口')) tags.push('api');
  if (lower.includes('数据库') || lower.includes('database') || lower.includes('db')) tags.push('database');
  if (lower.includes('前端') || lower.includes('frontend') || lower.includes('ui')) tags.push('frontend');
  if (lower.includes('后端') || lower.includes('backend') || lower.includes('server')) tags.push('backend');
  if (lower.includes('docker') || lower.includes('容器')) tags.push('docker');
  if (lower.includes('ci') || lower.includes('cd')) tags.push('ci-cd');

  return [...new Set(tags)];
}

// ---- Description generation ----

function generateDescription(text: string, intent: TaskIntent, entities: ExtractedEntity[]): string {
  const entityStr = entities
    .filter((e) => e.type === 'filePath' || e.type === 'moduleName')
    .map((e) => e.value)
    .join(', ');

  const intentNames: Record<TaskIntent, string> = {
    analyze: '分析',
    test: '测试',
    deploy: '部署',
    fix: '修复',
    generate: '生成',
    refactor: '重构',
    document: '文档',
    optimize: '优化',
    migrate: '迁移',
    review: '审查',
    unknown: '执行',
  };

  const base = `${intentNames[intent]}任务`;
  return entityStr ? `${base}: ${entityStr}` : base;
}

// ---- NLTaskParser Class ----

export class NLTaskParser {
  private customIntents: Map<TaskIntent, { zhKeywords: string[]; enKeywords: string[] }> = new Map();

  /** Register a custom intent */
  registerIntent(
    intent: TaskIntent,
    keywords: { zh?: string[]; en?: string[] },
  ): void {
    this.customIntents.set(intent, {
      zhKeywords: keywords.zh ?? [],
      enKeywords: keywords.en ?? [],
    });
  }

  /** Parse natural language input into a structured task */
  parse(input: string): ParsedTask {
    const trimmed = input.trim();
    if (!trimmed) {
      return {
        raw: input,
        intent: 'unknown',
        confidence: 0,
        entities: [],
        language: 'en',
        description: '空输入',
        priority: 'medium',
        tags: [],
      };
    }

    const language = detectLanguage(trimmed);
    const { intent, confidence } = this.recognizeIntentWithCustom(trimmed);
    const entities = extractEntities(trimmed);
    const priority = detectPriority(trimmed);
    const tags = extractTags(trimmed, intent);
    const description = generateDescription(trimmed, intent, entities);

    return {
      raw: trimmed,
      intent,
      confidence,
      entities,
      language,
      description,
      priority,
      tags,
    };
  }

  /** Parse with custom intents included */
  private recognizeIntentWithCustom(text: string): { intent: TaskIntent; confidence: number } {
    const lower = text.toLowerCase();
    let bestIntent: TaskIntent = 'unknown';
    let bestScore = 0;

    // Check built-in patterns
    for (const pattern of INTENT_PATTERNS) {
      let score = 0;
      const allKeywords = [...pattern.zhKeywords, ...pattern.enKeywords];

      for (const keyword of allKeywords) {
        if (lower.includes(keyword.toLowerCase())) {
          score += 1;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestIntent = pattern.intent;
      }
    }

    // Check custom intents
    for (const [intent, keywords] of this.customIntents) {
      let score = 0;
      const allKeywords = [...keywords.zhKeywords, ...keywords.enKeywords];

      for (const keyword of allKeywords) {
        if (lower.includes(keyword.toLowerCase())) {
          score += 1;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestIntent = intent;
      }
    }

    return {
      intent: bestIntent,
      confidence: Math.min(bestScore * 10, 1),
    };
  }

  /** Batch parse multiple inputs */
  parseBatch(inputs: string[]): ParsedTask[] {
    return inputs.map((input) => this.parse(input));
  }
}
