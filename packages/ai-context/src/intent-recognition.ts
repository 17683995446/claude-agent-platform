// ============================================================
// Module 3: Intent Recognition System
// Categorizes user requests, extracts entities, detects language
// ============================================================

export type IntentCategory =
  | 'code_generate'
  | 'code_fix'
  | 'code_review'
  | 'code_refactor'
  | 'code_explain'
  | 'code_test'
  | 'code_search'
  | 'project_setup'
  | 'deployment'
  | 'debugging'
  | 'documentation'
  | 'general_question';

export type Priority = 'urgent' | 'high' | 'normal' | 'low';
export type DetectedLanguage = 'chinese' | 'english' | 'japanese' | 'mixed';

export interface Entity {
  type: 'file_path' | 'function_name' | 'class_name' | 'variable_name' | 'error_message' | 'code_snippet' | 'url';
  value: string;
  confidence: number;
}

export interface IntentResult {
  primaryIntent: IntentCategory;
  secondaryIntents: { intent: IntentCategory; confidence: number }[];
  entities: Entity[];
  priority: Priority;
  language: DetectedLanguage;
  confidence: number;
  rawInput: string;
}

interface IntentPattern {
  keywords: string[];
  category: IntentCategory;
  weight: number;
}

const INTENT_PATTERNS: IntentPattern[] = [
  { keywords: ['create', 'generate', 'write', 'build', 'make', 'add', 'implement', '新建', '创建', '生成', '写', '添加', '实现'], category: 'code_generate', weight: 1.0 },
  { keywords: ['fix', 'repair', 'solve', 'resolve', 'bug', 'error', 'issue', '修复', '解决', '修'], category: 'code_fix', weight: 1.0 },
  { keywords: ['review', 'check', 'inspect', 'audit', '审查', '检查'], category: 'code_review', weight: 1.2 },
  { keywords: ['refactor', 'restructure', 'reorganize', 'improve', 'clean', '重构', '整理', '优化'], category: 'code_refactor', weight: 1.0 },
  { keywords: ['explain', 'describe', '解释', '说明'], category: 'code_explain', weight: 1.0 },
  { keywords: ['test', 'spec', 'unit test', 'integration test', 'testing', 'write test', 'write tests', '测试', '用例'], category: 'code_test', weight: 1.3 },
  { keywords: ['find', 'search', 'locate', 'where', 'look for', '查找', '搜索', '找'], category: 'code_search', weight: 1.0 },
  { keywords: ['setup', 'set up', 'init', 'initialize', 'configure', 'install', '设置', '初始化', '配置', '安装'], category: 'project_setup', weight: 1.0 },
  { keywords: ['deploy', 'release', 'publish', 'ship', '部署', '发布', '上线'], category: 'deployment', weight: 1.0 },
  { keywords: ['debug', 'trace', 'investigate', 'diagnose', '调试', '排查', '诊断'], category: 'debugging', weight: 1.2 },
  { keywords: ['document', 'readme', 'comment', 'doc', 'documentation', '文档', '注释', '说明文档'], category: 'documentation', weight: 1.0 },
];

const PRIORITY_KEYWORDS: Record<Priority, string[]> = {
  urgent: ['urgent', 'asap', 'critical', 'emergency', '紧急', '立即', '马上', '严重'],
  high: ['important', 'priority', 'high', '重要', '优先', '高优先'],
  low: ['when possible', 'low priority', 'later', 'optional', '有空', '不急', '低优先'],
  normal: [],
};

export class IntentRecognizer {
  private conversationHistory: { role: string; content: string }[] = [];
  private confidenceThreshold: number;

  constructor(confidenceThreshold: number = 0.3) {
    this.confidenceThreshold = confidenceThreshold;
  }

  recognize(input: string): IntentResult {
    const normalizedInput = input.toLowerCase().trim();
    const language = this.detectLanguage(input);
    const priority = this.detectPriority(normalizedInput);
    const entities = this.extractEntities(input);

    // Score each intent
    const scores = new Map<IntentCategory, number>();
    for (const pattern of INTENT_PATTERNS) {
      let score = 0;
      for (const keyword of pattern.keywords) {
        if (normalizedInput.includes(keyword)) {
          score += pattern.weight;
        }
      }
      scores.set(pattern.category, score);
    }

    // Sort by score
    const sorted = Array.from(scores.entries())
      .filter(([, score]) => score > 0)
      .sort((a, b) => b[1] - a[1]);

    // If no intent matched, default to general_question
    if (sorted.length === 0) {
      return {
        primaryIntent: 'general_question',
        secondaryIntents: [],
        entities,
        priority,
        language,
        confidence: 0.5,
        rawInput: input,
      };
    }

    const maxScore = sorted[0][1];
    const totalScore = sorted.reduce((s, [, v]) => s + v, 0);
    const primaryConfidence = maxScore / (totalScore || 1);

    const secondaryIntents = sorted.slice(1, 4).map(([intent, score]) => ({
      intent,
      confidence: score / (totalScore || 1),
    }));

    // Context-aware resolution
    const resolvedIntent = this.resolveWithContext(sorted[0][0], this.conversationHistory);

    return {
      primaryIntent: resolvedIntent,
      secondaryIntents,
      entities,
      priority,
      language,
      confidence: primaryConfidence,
      rawInput: input,
    };
  }

  addToHistory(role: string, content: string): void {
    this.conversationHistory.push({ role, content });
    if (this.conversationHistory.length > 50) {
      this.conversationHistory.shift();
    }
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }

  private detectLanguage(text: string): DetectedLanguage {
    let cjkCount = 0;
    let chineseCount = 0;
    let japaneseCount = 0;
    let latinCount = 0;

    for (const char of text) {
      const code = char.codePointAt(0) ?? 0;
      if (code >= 0x4E00 && code <= 0x9FFF) { cjkCount++; chineseCount++; }
      else if (code >= 0x3040 && code <= 0x309F) { cjkCount++; japaneseCount++; }
      else if (code >= 0x30A0 && code <= 0x30FF) { cjkCount++; japaneseCount++; }
      else if ((code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A)) { latinCount++; }
    }

    const total = cjkCount + latinCount || 1;
    if (cjkCount / total > 0.7) {
      return japaneseCount > chineseCount ? 'japanese' : 'chinese';
    }
    if (cjkCount > 0 && latinCount > 0) return 'mixed';
    return 'english';
  }

  private detectPriority(text: string): Priority {
    for (const [level, keywords] of Object.entries(PRIORITY_KEYWORDS)) {
      for (const kw of keywords) {
        if (text.includes(kw)) return level as Priority;
      }
    }
    return 'normal';
  }

  private extractEntities(input: string): Entity[] {
    const entities: Entity[] = [];

    // File paths
    const filePathRegex = /(?:^|[\s(])([\w./\\-]+\.\w{1,5})(?:[\s),]|$)/g;
    let match: RegExpExecArray | null;
    while ((match = filePathRegex.exec(input)) !== null) {
      entities.push({ type: 'file_path', value: match[1], confidence: 0.8 });
    }

    // Error messages (quoted strings that look like errors)
    const errorRegex = /(?:error|Error|ERROR)[:\s]+["']?([^"'\n]{10,})/g;
    while ((match = errorRegex.exec(input)) !== null) {
      entities.push({ type: 'error_message', value: match[1].trim(), confidence: 0.7 });
    }

    // Code snippets (backtick-enclosed)
    const codeRegex = /`([^`]+)`/g;
    while ((match = codeRegex.exec(input)) !== null) {
      entities.push({ type: 'code_snippet', value: match[1], confidence: 0.9 });
    }

    // URLs
    const urlRegex = /https?:\/\/[^\s]+/g;
    while ((match = urlRegex.exec(input)) !== null) {
      entities.push({ type: 'url', value: match[0], confidence: 0.95 });
    }

    // Function names (camelCase or snake_case followed by parentheses)
    const funcRegex = /\b([a-z][a-zA-Z0-9_]*(?:_[a-z][a-zA-Z0-9_]*)?)\s*\(/g;
    while ((match = funcRegex.exec(input)) !== null) {
      if (match[1].length > 2) {
        entities.push({ type: 'function_name', value: match[1], confidence: 0.6 });
      }
    }

    // Class names (PascalCase)
    const classRegex = /\b([A-Z][a-zA-Z0-9]+)\b/g;
    while ((match = classRegex.exec(input)) !== null) {
      if (match[1].length > 2 && !['Error', 'Type', 'String', 'Number', 'Boolean', 'Array', 'Object'].includes(match[1])) {
        entities.push({ type: 'class_name', value: match[1], confidence: 0.5 });
      }
    }

    return entities;
  }

  private resolveWithContext(intent: IntentCategory, history: { role: string; content: string }[]): IntentCategory {
    if (history.length === 0) return intent;

    const lastUserMsg = [...history].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) return intent;

    // If current intent is general_question but we have history, check if it might be a follow-up
    if (intent === 'general_question') {
      const lastResult = this.recognizeInternal(lastUserMsg.content);
      // Only use previous intent if it was a specific code-related intent
      if (lastResult !== 'general_question') {
        return lastResult;
      }
    }
    
    return intent;
  }

  private recognizeInternal(input: string): IntentCategory {
    const normalizedInput = input.toLowerCase();
    const scores = new Map<IntentCategory, number>();

    for (const pattern of INTENT_PATTERNS) {
      let score = 0;
      for (const keyword of pattern.keywords) {
        if (normalizedInput.includes(keyword)) score += pattern.weight;
      }
      scores.set(pattern.category, score);
    }

    const sorted = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[1] > 0 ? sorted[0][0] : 'general_question';
  }
}
