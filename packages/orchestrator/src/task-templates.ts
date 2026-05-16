// ============================================================================
// TaskTemplates - Task Template System
// ============================================================================

import type { TaskTemplate, TemplateParameter, TemplateStep, TaskIntent } from './types.js';

// ---- Built-in templates ----

const BUILT_IN_TEMPLATES: TaskTemplate[] = [
  {
    id: 'builtin:analyze-project',
    name: '项目架构分析',
    description: '全面分析项目架构，包括依赖关系、代码结构和质量',
    category: 'analysis',
    parameters: [
      { name: 'projectPath', type: 'path', required: true, description: '项目路径' },
      { name: 'depth', type: 'number', required: false, defaultValue: 3, description: '分析深度' },
    ],
    steps: [
      { name: '扫描项目结构', description: '扫描项目目录结构', intent: 'analyze', parameterMapping: {} },
      { name: '分析依赖关系', description: '分析模块依赖图', intent: 'analyze', parameterMapping: {} },
      { name: '代码质量评估', description: '评估代码质量指标', intent: 'analyze', parameterMapping: {} },
      { name: '生成报告', description: '生成分析报告', intent: 'generate', parameterMapping: {} },
    ],
    tags: ['analysis', 'architecture', 'quality'],
    isBuiltIn: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: 'builtin:run-tests',
    name: '运行测试套件',
    description: '运行项目测试并生成报告',
    category: 'testing',
    parameters: [
      { name: 'pattern', type: 'string', required: false, defaultValue: '**/*.test.ts', description: '测试文件匹配模式' },
      { name: 'coverage', type: 'boolean', required: false, defaultValue: false, description: '是否生成覆盖率报告' },
    ],
    steps: [
      { name: '发现测试文件', description: '扫描测试文件', intent: 'analyze', parameterMapping: { pattern: 'pattern' } },
      { name: '运行测试', description: '执行测试', intent: 'test', parameterMapping: {} },
      { name: '生成报告', description: '生成测试报告', intent: 'generate', parameterMapping: { coverage: 'coverage' } },
    ],
    tags: ['testing', 'quality'],
    isBuiltIn: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: 'builtin:deploy-production',
    name: '生产环境部署',
    description: '构建并部署到生产环境',
    category: 'deployment',
    parameters: [
      { name: 'env', type: 'enum', required: false, defaultValue: 'production', description: '目标环境', enumValues: ['staging', 'production'] },
      { name: 'version', type: 'string', required: false, description: '版本号' },
    ],
    steps: [
      { name: '环境检查', description: '检查部署环境', intent: 'analyze', parameterMapping: { env: 'env' } },
      { name: '构建', description: '构建项目', intent: 'generate', parameterMapping: {} },
      { name: '部署前测试', description: '运行部署前测试', intent: 'test', parameterMapping: {} },
      { name: '部署', description: '执行部署', intent: 'deploy', parameterMapping: { env: 'env', version: 'version' } },
      { name: '验证', description: '验证部署结果', intent: 'test', parameterMapping: {} },
    ],
    tags: ['deployment', 'production'],
    isBuiltIn: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: 'builtin:fix-bug',
    name: 'Bug 修复流程',
    description: '定位并修复 Bug 的标准流程',
    category: 'fixing',
    parameters: [
      { name: 'description', type: 'string', required: true, description: 'Bug 描述' },
      { name: 'filePath', type: 'path', required: false, description: '相关文件路径' },
    ],
    steps: [
      { name: '问题定位', description: '分析错误信息', intent: 'analyze', parameterMapping: { description: 'description', filePath: 'filePath' } },
      { name: '制定方案', description: '制定修复方案', intent: 'analyze', parameterMapping: {} },
      { name: '实施修复', description: '应用修复', intent: 'fix', parameterMapping: { filePath: 'filePath' } },
      { name: '验证修复', description: '验证修复效果', intent: 'test', parameterMapping: {} },
    ],
    tags: ['fixing', 'bug'],
    isBuiltIn: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: 'builtin:generate-component',
    name: '生成组件',
    description: '生成前端/后端组件',
    category: 'generation',
    parameters: [
      { name: 'name', type: 'string', required: true, description: '组件名称' },
      { name: 'type', type: 'enum', required: false, defaultValue: 'react', description: '组件类型', enumValues: ['react', 'vue', 'angular', 'api'] },
      { name: 'path', type: 'path', required: false, description: '输出路径' },
    ],
    steps: [
      { name: '需求分析', description: '分析组件需求', intent: 'analyze', parameterMapping: { name: 'name', type: 'type' } },
      { name: '生成代码', description: '生成组件代码', intent: 'generate', parameterMapping: { name: 'name', type: 'type', path: 'path' } },
      { name: '生成测试', description: '生成组件测试', intent: 'generate', parameterMapping: { name: 'name' } },
      { name: '验证', description: '验证生成结果', intent: 'test', parameterMapping: {} },
    ],
    tags: ['generation', 'component'],
    isBuiltIn: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
];

// ---- TaskTemplates Class ----

export class TaskTemplates {
  private templates: Map<string, TaskTemplate> = new Map();

  constructor() {
    for (const template of BUILT_IN_TEMPLATES) {
      this.templates.set(template.id, template);
    }
  }

  /** Get a template by ID */
  get(id: string): TaskTemplate | undefined {
    return this.templates.get(id);
  }

  /** Get all templates */
  getAll(): TaskTemplate[] {
    return Array.from(this.templates.values());
  }

  /** Get built-in templates */
  getBuiltIn(): TaskTemplate[] {
    return this.getAll().filter((t) => t.isBuiltIn);
  }

  /** Get custom templates */
  getCustom(): TaskTemplate[] {
    return this.getAll().filter((t) => !t.isBuiltIn);
  }

  /** Search templates by keyword */
  search(keyword: string): TaskTemplate[] {
    const lower = keyword.toLowerCase();
    return this.getAll().filter(
      (t) =>
        t.name.toLowerCase().includes(lower) ||
        t.description.toLowerCase().includes(lower) ||
        t.category.toLowerCase().includes(lower) ||
        t.tags.some((tag) => tag.includes(lower)),
    );
  }

  /** Get templates by category */
  getByCategory(category: string): TaskTemplate[] {
    return this.getAll().filter((t) => t.category === category);
  }

  /** Get templates by intent */
  getByIntent(intent: TaskIntent): TaskTemplate[] {
    return this.getAll().filter((t) => t.steps.some((s) => s.intent === intent));
  }

  /** Register a custom template */
  register(template: Omit<TaskTemplate, 'id' | 'isBuiltIn' | 'createdAt' | 'updatedAt'>): TaskTemplate {
    const id = `custom:${template.name}-${Date.now().toString(36)}`;
    const now = new Date();

    const fullTemplate: TaskTemplate = {
      ...template,
      id,
      isBuiltIn: false,
      createdAt: now,
      updatedAt: now,
    };

    this.templates.set(id, fullTemplate);
    return fullTemplate;
  }

  /** Update a template */
  update(id: string, updates: Partial<Pick<TaskTemplate, 'name' | 'description' | 'parameters' | 'steps' | 'tags'>>): TaskTemplate | undefined {
    const template = this.templates.get(id);
    if (!template || template.isBuiltIn) return undefined;

    Object.assign(template, updates, { updatedAt: new Date() });
    return template;
  }

  /** Delete a custom template */
  delete(id: string): boolean {
    const template = this.templates.get(id);
    if (!template || template.isBuiltIn) return false;
    return this.templates.delete(id);
  }

  /** Validate template parameters */
  validateParameters(templateId: string, params: Record<string, unknown>): { valid: boolean; errors: string[] } {
    const template = this.templates.get(templateId);
    if (!template) {
      return { valid: false, errors: [`Template not found: ${templateId}`] };
    }

    const errors: string[] = [];

    for (const param of template.parameters) {
      if (param.required && !(param.name in params)) {
        errors.push(`Missing required parameter: ${param.name}`);
      }

      if (param.name in params) {
        const value = params[param.name];
        const typeValid = this.validateParamType(value, param.type);
        if (!typeValid) {
          errors.push(`Invalid type for parameter ${param.name}: expected ${param.type}`);
        }

        if (param.enumValues && !param.enumValues.includes(String(value))) {
          errors.push(`Invalid value for parameter ${param.name}: must be one of ${param.enumValues.join(', ')}`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /** Validate parameter type */
  private validateParamType(value: unknown, type: TemplateParameter['type']): boolean {
    switch (type) {
      case 'string':
      case 'path':
      case 'enum':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number';
      case 'boolean':
        return typeof value === 'boolean';
      default:
        return true;
    }
  }

  /** Get template count */
  getCount(): { total: number; builtIn: number; custom: number } {
    const all = this.getAll();
    return {
      total: all.length,
      builtIn: all.filter((t) => t.isBuiltIn).length,
      custom: all.filter((t) => !t.isBuiltIn).length,
    };
  }
}
