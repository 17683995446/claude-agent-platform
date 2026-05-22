// ============================================================================
// TaskDecomposer - Task Decomposition Engine
// ============================================================================

import type {
  ParsedTask,
  SubTask,
  TaskGraph,
  TaskEdge,
  DecompositionResult,
  ExtractedEntity,
  TaskIntent,
} from './types.js';

// ---- Sub-task ID generator ----

let subTaskCounter = 0;

function generateSubTaskId(): string {
  subTaskCounter++;
  return `sub-${Date.now().toString(36)}-${subTaskCounter.toString(36)}`;
}

// ---- Intent decomposition rules ----

const DECOMPOSITION_RULES: Record<TaskIntent, (task: ParsedTask) => SubTask[]> = {
  analyze: (task) => {
    const subs: SubTask[] = [];
    const hasPath = task.entities.some((e) => e.type === 'filePath');

    subs.push({
      id: generateSubTaskId(),
      name: '收集项目信息',
      description: '扫描项目结构，收集文件和模块信息',
      intent: 'analyze',
      dependencies: [],
      priority: 10,
      estimatedDuration: 2000,
      entities: task.entities.filter((e) => e.type === 'filePath'),
      status: 'pending',
    });

    subs.push({
      id: generateSubTaskId(),
      name: '依赖关系分析',
      description: '分析模块间的依赖关系',
      intent: 'analyze',
      dependencies: [subs[0]!.id],
      priority: 8,
      estimatedDuration: 3000,
      entities: task.entities.filter((e) => e.type === 'moduleName'),
      status: 'pending',
    });

    if (hasPath) {
      subs.push({
        id: generateSubTaskId(),
        name: '代码质量分析',
        description: '对指定路径进行代码质量分析',
        intent: 'analyze',
        dependencies: [subs[0]!.id],
        priority: 7,
        estimatedDuration: 5000,
        entities: task.entities.filter((e) => e.type === 'filePath'),
        status: 'pending',
      });
    }

    subs.push({
      id: generateSubTaskId(),
      name: '生成分析报告',
      description: '汇总分析结果，生成结构化报告',
      intent: 'generate',
      dependencies: [subs[subs.length - 1]!.id],
      priority: 9,
      estimatedDuration: 1000,
      entities: [],
      status: 'pending',
    });

    return subs;
  },

  test: (task) => {
    const subs: SubTask[] = [];

    subs.push({
      id: generateSubTaskId(),
      name: '发现测试文件',
      description: '扫描项目中的测试文件',
      intent: 'analyze',
      dependencies: [],
      priority: 10,
      estimatedDuration: 1000,
      entities: task.entities.filter((e) => e.type === 'filePath'),
      status: 'pending',
    });

    subs.push({
      id: generateSubTaskId(),
      name: '运行单元测试',
      description: '执行单元测试套件',
      intent: 'test',
      dependencies: [subs[0]!.id],
      priority: 9,
      estimatedDuration: 10000,
      entities: [],
      status: 'pending',
    });

    subs.push({
      id: generateSubTaskId(),
      name: '生成测试报告',
      description: '汇总测试结果',
      intent: 'generate',
      dependencies: [subs[1]!.id],
      priority: 7,
      estimatedDuration: 1000,
      entities: [],
      status: 'pending',
    });

    return subs;
  },

  deploy: (task) => {
    const subs: SubTask[] = [];

    subs.push({
      id: generateSubTaskId(),
      name: '环境检查',
      description: '检查部署环境配置',
      intent: 'analyze',
      dependencies: [],
      priority: 10,
      estimatedDuration: 2000,
      entities: [],
      status: 'pending',
    });

    subs.push({
      id: generateSubTaskId(),
      name: '构建项目',
      description: '编译和构建项目',
      intent: 'generate',
      dependencies: [subs[0]!.id],
      priority: 9,
      estimatedDuration: 15000,
      entities: [],
      status: 'pending',
    });

    subs.push({
      id: generateSubTaskId(),
      name: '运行部署前测试',
      description: '执行部署前的验证测试',
      intent: 'test',
      dependencies: [subs[1]!.id],
      priority: 8,
      estimatedDuration: 5000,
      entities: [],
      status: 'pending',
    });

    subs.push({
      id: generateSubTaskId(),
      name: '执行部署',
      description: '将构建产物部署到目标环境',
      intent: 'deploy',
      dependencies: [subs[2]!.id],
      priority: 10,
      estimatedDuration: 8000,
      entities: task.entities,
      status: 'pending',
    });

    subs.push({
      id: generateSubTaskId(),
      name: '部署验证',
      description: '验证部署是否成功',
      intent: 'test',
      dependencies: [subs[3]!.id],
      priority: 9,
      estimatedDuration: 3000,
      entities: [],
      status: 'pending',
    });

    return subs;
  },

  fix: (task) => {
    const subs: SubTask[] = [];

    subs.push({
      id: generateSubTaskId(),
      name: '定位问题',
      description: '分析错误日志和堆栈信息',
      intent: 'analyze',
      dependencies: [],
      priority: 10,
      estimatedDuration: 3000,
      entities: task.entities,
      status: 'pending',
    });

    subs.push({
      id: generateSubTaskId(),
      name: '制定修复方案',
      description: '分析问题根因，制定修复策略',
      intent: 'analyze',
      dependencies: [subs[0]!.id],
      priority: 9,
      estimatedDuration: 2000,
      entities: [],
      status: 'pending',
    });

    subs.push({
      id: generateSubTaskId(),
      name: '实施修复',
      description: '应用修复方案',
      intent: 'fix',
      dependencies: [subs[1]!.id],
      priority: 10,
      estimatedDuration: 5000,
      entities: task.entities.filter((e) => e.type === 'filePath'),
      status: 'pending',
    });

    subs.push({
      id: generateSubTaskId(),
      name: '验证修复',
      description: '运行测试验证修复效果',
      intent: 'test',
      dependencies: [subs[2]!.id],
      priority: 8,
      estimatedDuration: 5000,
      entities: [],
      status: 'pending',
    });

    return subs;
  },

  generate: (task) => {
    const subs: SubTask[] = [];

    subs.push({
      id: generateSubTaskId(),
      name: '需求分析',
      description: '分析生成需求',
      intent: 'analyze',
      dependencies: [],
      priority: 10,
      estimatedDuration: 2000,
      entities: task.entities,
      status: 'pending',
    });

    subs.push({
      id: generateSubTaskId(),
      name: '生成代码',
      description: '根据需求生成代码',
      intent: 'generate',
      dependencies: [subs[0]!.id],
      priority: 10,
      estimatedDuration: 8000,
      entities: task.entities,
      status: 'pending',
    });

    subs.push({
      id: generateSubTaskId(),
      name: '代码验证',
      description: '验证生成的代码',
      intent: 'test',
      dependencies: [subs[1]!.id],
      priority: 7,
      estimatedDuration: 3000,
      entities: [],
      status: 'pending',
    });

    return subs;
  },

  refactor: (task) => {
    const subs: SubTask[] = [];

    subs.push({
      id: generateSubTaskId(),
      name: '代码分析',
      description: '分析当前代码结构和问题',
      intent: 'analyze',
      dependencies: [],
      priority: 10,
      estimatedDuration: 3000,
      entities: task.entities.filter((e) => e.type === 'filePath'),
      status: 'pending',
    });

    subs.push({
      id: generateSubTaskId(),
      name: '制定重构计划',
      description: '规划重构步骤',
      intent: 'analyze',
      dependencies: [subs[0]!.id],
      priority: 9,
      estimatedDuration: 2000,
      entities: [],
      status: 'pending',
    });

    subs.push({
      id: generateSubTaskId(),
      name: '执行重构',
      description: '按计划执行代码重构',
      intent: 'refactor',
      dependencies: [subs[1]!.id],
      priority: 10,
      estimatedDuration: 10000,
      entities: task.entities.filter((e) => e.type === 'filePath'),
      status: 'pending',
    });

    subs.push({
      id: generateSubTaskId(),
      name: '回归测试',
      description: '运行测试确保重构未引入问题',
      intent: 'test',
      dependencies: [subs[2]!.id],
      priority: 9,
      estimatedDuration: 5000,
      entities: [],
      status: 'pending',
    });

    return subs;
  },

  document: (task) => {
    const subs: SubTask[] = [];

    subs.push({
      id: generateSubTaskId(),
      name: '代码扫描',
      description: '扫描需要文档化的代码',
      intent: 'analyze',
      dependencies: [],
      priority: 10,
      estimatedDuration: 2000,
      entities: task.entities.filter((e) => e.type === 'filePath'),
      status: 'pending',
    });

    subs.push({
      id: generateSubTaskId(),
      name: '生成文档',
      description: '为代码生成文档',
      intent: 'document',
      dependencies: [subs[0]!.id],
      priority: 9,
      estimatedDuration: 5000,
      entities: [],
      status: 'pending',
    });

    return subs;
  },

  optimize: (task) => {
    const subs: SubTask[] = [];

    subs.push({
      id: generateSubTaskId(),
      name: '性能分析',
      description: '分析当前性能瓶颈',
      intent: 'analyze',
      dependencies: [],
      priority: 10,
      estimatedDuration: 5000,
      entities: task.entities,
      status: 'pending',
    });

    subs.push({
      id: generateSubTaskId(),
      name: '应用优化',
      description: '应用性能优化策略',
      intent: 'optimize',
      dependencies: [subs[0]!.id],
      priority: 10,
      estimatedDuration: 8000,
      entities: task.entities.filter((e) => e.type === 'filePath'),
      status: 'pending',
    });

    subs.push({
      id: generateSubTaskId(),
      name: '验证优化效果',
      description: '对比优化前后的性能',
      intent: 'test',
      dependencies: [subs[1]!.id],
      priority: 8,
      estimatedDuration: 3000,
      entities: [],
      status: 'pending',
    });

    return subs;
  },

  migrate: (task) => {
    const subs: SubTask[] = [];

    subs.push({
      id: generateSubTaskId(),
      name: '兼容性分析',
      description: '分析迁移兼容性问题',
      intent: 'analyze',
      dependencies: [],
      priority: 10,
      estimatedDuration: 3000,
      entities: task.entities,
      status: 'pending',
    });

    subs.push({
      id: generateSubTaskId(),
      name: '执行迁移',
      description: '执行代码迁移',
      intent: 'migrate',
      dependencies: [subs[0]!.id],
      priority: 10,
      estimatedDuration: 10000,
      entities: task.entities,
      status: 'pending',
    });

    subs.push({
      id: generateSubTaskId(),
      name: '迁移验证',
      description: '验证迁移结果',
      intent: 'test',
      dependencies: [subs[1]!.id],
      priority: 9,
      estimatedDuration: 5000,
      entities: [],
      status: 'pending',
    });

    return subs;
  },

  review: (task) => {
    const subs: SubTask[] = [];

    subs.push({
      id: generateSubTaskId(),
      name: '代码收集',
      description: '收集需要审查的代码',
      intent: 'analyze',
      dependencies: [],
      priority: 10,
      estimatedDuration: 2000,
      entities: task.entities.filter((e) => e.type === 'filePath'),
      status: 'pending',
    });

    subs.push({
      id: generateSubTaskId(),
      name: '代码审查',
      description: '执行代码审查',
      intent: 'review',
      dependencies: [subs[0]!.id],
      priority: 10,
      estimatedDuration: 8000,
      entities: [],
      status: 'pending',
    });

    subs.push({
      id: generateSubTaskId(),
      name: '生成审查报告',
      description: '汇总审查结果',
      intent: 'document',
      dependencies: [subs[1]!.id],
      priority: 8,
      estimatedDuration: 2000,
      entities: [],
      status: 'pending',
    });

    return subs;
  },

  unknown: (task) => {
    const firstId = generateSubTaskId();
    return [
      {
        id: firstId,
        name: '理解任务',
        description: '分析用户意图',
        intent: 'analyze',
        dependencies: [],
        priority: 10,
        estimatedDuration: 2000,
        entities: task.entities,
        status: 'pending',
      },
      {
        id: generateSubTaskId(),
        name: '执行任务',
        description: '执行用户请求的操作',
        intent: 'unknown',
        dependencies: [firstId],
        priority: 10,
        estimatedDuration: 5000,
        entities: task.entities,
        status: 'pending',
      },
    ];
  },
};

// ---- Graph analysis utilities ----

function buildEdges(nodes: SubTask[]): TaskEdge[] {
  const edges: TaskEdge[] = [];
  for (const node of nodes) {
    for (const depId of node.dependencies) {
      edges.push({
        from: depId,
        to: node.id,
        type: 'hard',
      });
    }
  }
  return edges;
}

function findParallelGroups(nodes: SubTask[]): string[][] {
  const completed = new Set<string>();
  const groups: string[][] = [];
  const remaining = new Set(nodes.map((n) => n.id));
  let maxIterations = nodes.length + 1;

  while (remaining.size > 0 && maxIterations-- > 0) {
    const ready: string[] = [];
    for (const id of remaining) {
      const node = nodes.find((n) => n.id === id);
      if (node && node.dependencies.every((d) => completed.has(d))) {
        ready.push(id);
      }
    }

    if (ready.length === 0) {
      // Break circular dependencies - push all remaining nodes
      for (const id of remaining) {
        ready.push(id);
      }
    }

    if (ready.length > 0) {
      groups.push(ready);
      for (const id of ready) {
        completed.add(id);
        remaining.delete(id);
      }
    }
  }

  return groups;
}

function findCriticalPath(nodes: SubTask[], edges: TaskEdge[]): string[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const inDegree = new Map<string, number>();
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    dist.set(node.id, 0);
    prev.set(node.id, null);
  }

  for (const edge of edges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  // Topological sort with longest path
  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentNode = nodeMap.get(current)!;

    for (const edge of edges) {
      if (edge.from === current) {
        const newDist = (dist.get(current) ?? 0) + currentNode.estimatedDuration;
        if (newDist > (dist.get(edge.to) ?? 0)) {
          dist.set(edge.to, newDist);
          prev.set(edge.to, current);
        }
        const newDegree = (inDegree.get(edge.to) ?? 1) - 1;
        inDegree.set(edge.to, newDegree);
        if (newDegree === 0) queue.push(edge.to);
      }
    }
  }

  // Trace back from the node with max distance
  let maxDist = 0;
  let endNode = '';
  for (const [id, d] of dist) {
    if (d > maxDist) {
      maxDist = d;
      endNode = id;
    }
  }

  // If no edges were traversed, pick the node with longest duration as the path
  if (!endNode) {
    let maxDur = 0;
    for (const node of nodes) {
      if (node.estimatedDuration > maxDur) {
        maxDur = node.estimatedDuration;
        endNode = node.id;
      }
    }
  }

  const path: string[] = [];
  let current: string | null = endNode;
  while (current) {
    path.unshift(current);
    current = prev.get(current) ?? null;
  }

  return path;
}

// ---- TaskDecomposer Class ----

export class TaskDecomposer {
  private customRules: Partial<Record<TaskIntent, (task: ParsedTask) => SubTask[]>> = {};

  /** Register a custom decomposition rule for an intent */
  registerRule(intent: TaskIntent, rule: (task: ParsedTask) => SubTask[]): void {
    this.customRules[intent] = rule;
  }

  /** Decompose a parsed task into sub-tasks with dependency graph */
  decompose(task: ParsedTask): DecompositionResult {
    const rule = this.customRules[task.intent] ?? DECOMPOSITION_RULES[task.intent];
    const nodes = rule(task);

    // Fix unknown intent's broken dependency
    if (task.intent === 'unknown' && nodes.length >= 2) {
      nodes[1]!.dependencies = [nodes[0]!.id];
    }

    const edges = buildEdges(nodes);
    const parallelGroups = findParallelGroups(nodes);
    const criticalPath = findCriticalPath(nodes, edges);
    const criticalPathDuration = criticalPath.reduce((sum, id) => {
      const node = nodes.find((n) => n.id === id);
      return sum + (node?.estimatedDuration ?? 0);
    }, 0);
    const totalEstimatedDuration = criticalPathDuration;

    const strategy: 'sequential' | 'parallel' | 'mixed' =
      parallelGroups.length === 1 ? 'sequential' :
      parallelGroups.every((g) => g.length === 1) ? 'sequential' :
      parallelGroups.every((g) => g.length > 1) ? 'parallel' :
      parallelGroups.some((g) => g.length > 1) ? 'mixed' : 'sequential';

    return {
      rootTask: task,
      graph: {
        nodes,
        edges,
        criticalPath,
        parallelGroups,
      },
      totalEstimatedDuration,
      decompositionStrategy: strategy,
    };
  }

  /** Get the decomposition strategy name for display */
  static getStrategyName(strategy: 'sequential' | 'parallel' | 'mixed'): string {
    const names = {
      sequential: '顺序执行',
      parallel: '并行执行',
      mixed: '混合执行',
    };
    return names[strategy];
  }
}
