// ============================================================
// Module 6: Task Planner
// Task decomposition, estimation, ordering, templates
// ============================================================

export interface Task {
  id: string;
  name: string;
  description: string;
  dependencies: string[];
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  complexity: number; // 1-10
  estimatedDuration: number; // minutes
  subtasks: Task[];
  tags: string[];
}

export interface TaskPlan {
  id: string;
  goal: string;
  tasks: Task[];
  criticalPath: Task[];
  totalEstimatedDuration: number;
  createdAt: number;
  context: PlanningContext;
}

export interface PlanningContext {
  projectType?: string;
  language?: string;
  framework?: string;
  constraints?: string[];
  availableResources?: string[];
}

export interface EffortEstimate {
  taskId: string;
  complexity: number;
  duration: number; // minutes
  riskLevel: 'low' | 'medium' | 'high';
  requiredSkills: string[];
  suggestedApproach: string;
}

export interface Feedback {
  taskId: string;
  type: 'approve' | 'reject' | 'modify' | 'skip';
  reason?: string;
  modifications?: Partial<Task>;
}

interface TaskTemplate {
  name: string;
  pattern: RegExp;
  tasks: Omit<Task, 'id'>[];
}

let taskIdCounter = 0;
function newTaskId(): string {
  return `task_${++taskIdCounter}_${Date.now()}`;
}

const TASK_TEMPLATES: TaskTemplate[] = [
  {
    name: 'refactor',
    pattern: /refactor|重构|restructure/i,
    tasks: [
      { name: 'Analyze current code', description: 'Understand the existing code structure', dependencies: [], status: 'pending', complexity: 3, estimatedDuration: 15, subtasks: [], tags: ['analysis'] },
      { name: 'Identify refactoring targets', description: 'Find code that needs refactoring', dependencies: ['task_0'], status: 'pending', complexity: 4, estimatedDuration: 20, subtasks: [], tags: ['analysis'] },
      { name: 'Plan refactoring approach', description: 'Design the new structure', dependencies: ['task_1'], status: 'pending', complexity: 5, estimatedDuration: 30, subtasks: [], tags: ['planning'] },
      { name: 'Implement refactoring', description: 'Apply the refactoring changes', dependencies: ['task_2'], status: 'pending', complexity: 7, estimatedDuration: 60, subtasks: [], tags: ['implementation'] },
      { name: 'Run tests', description: 'Verify refactoring did not break anything', dependencies: ['task_3'], status: 'pending', complexity: 3, estimatedDuration: 15, subtasks: [], tags: ['testing'] },
    ],
  },
  {
    name: 'test',
    pattern: /test|测试|spec/i,
    tasks: [
      { name: 'Identify test targets', description: 'Find code that needs tests', dependencies: [], status: 'pending', complexity: 2, estimatedDuration: 10, subtasks: [], tags: ['analysis'] },
      { name: 'Write unit tests', description: 'Create unit tests', dependencies: ['task_0'], status: 'pending', complexity: 5, estimatedDuration: 45, subtasks: [], tags: ['implementation'] },
      { name: 'Write integration tests', description: 'Create integration tests', dependencies: ['task_0'], status: 'pending', complexity: 6, estimatedDuration: 45, subtasks: [], tags: ['implementation'] },
      { name: 'Run all tests', description: 'Execute test suite', dependencies: ['task_1', 'task_2'], status: 'pending', complexity: 2, estimatedDuration: 10, subtasks: [], tags: ['testing'] },
    ],
  },
  {
    name: 'deploy',
    pattern: /deploy|部署|release|publish/i,
    tasks: [
      { name: 'Pre-deployment checks', description: 'Run linting, type checking, tests', dependencies: [], status: 'pending', complexity: 3, estimatedDuration: 15, subtasks: [], tags: ['verification'] },
      { name: 'Build production bundle', description: 'Create optimized production build', dependencies: ['task_0'], status: 'pending', complexity: 4, estimatedDuration: 20, subtasks: [], tags: ['build'] },
      { name: 'Deploy to environment', description: 'Deploy the build', dependencies: ['task_1'], status: 'pending', complexity: 5, estimatedDuration: 30, subtasks: [], tags: ['deployment'] },
      { name: 'Post-deployment verification', description: 'Verify deployment is healthy', dependencies: ['task_2'], status: 'pending', complexity: 3, estimatedDuration: 15, subtasks: [], tags: ['verification'] },
    ],
  },
];

export class TaskPlanner {
  plan(request: string, context: PlanningContext = {}): TaskPlan {
    const tasks = this.decomposeTask(request, context);
    const ordered = this.topologicalSort(tasks);
    const criticalPath = this.getCriticalPath(ordered);
    const totalDuration = ordered.reduce((sum, t) => sum + t.estimatedDuration, 0);

    return {
      id: `plan_${Date.now()}`,
      goal: request,
      tasks: ordered,
      criticalPath,
      totalEstimatedDuration: totalDuration,
      createdAt: Date.now(),
      context,
    };
  }

  adjustPlan(plan: TaskPlan, feedback: Feedback): TaskPlan {
    const taskIndex = plan.tasks.findIndex(t => t.id === feedback.taskId);
    if (taskIndex === -1) return plan;

    const task = plan.tasks[taskIndex];

    switch (feedback.type) {
      case 'approve':
        task.status = 'completed';
        break;
      case 'reject':
      case 'skip':
        task.status = 'completed'; // Mark as handled
        break;
      case 'modify':
        if (feedback.modifications) {
          Object.assign(task, feedback.modifications);
        }
        break;
    }

    // Recalculate critical path
    plan.criticalPath = this.getCriticalPath(plan.tasks);

    return { ...plan };
  }

  estimateEffort(task: Task): EffortEstimate {
    const riskLevel: EffortEstimate['riskLevel'] =
      task.complexity >= 8 ? 'high' : task.complexity >= 5 ? 'medium' : 'low';

    const requiredSkills: string[] = [];
    if (task.tags.includes('testing')) requiredSkills.push('testing');
    if (task.tags.includes('implementation')) requiredSkills.push('programming');
    if (task.tags.includes('analysis')) requiredSkills.push('code review');
    if (task.tags.includes('deployment')) requiredSkills.push('devops');
    if (task.tags.includes('planning')) requiredSkills.push('architecture');

    const suggestedApproach = task.complexity >= 7
      ? 'Break this task into smaller subtasks for better manageability'
      : task.complexity >= 4
        ? 'Follow a structured approach with clear milestones'
        : 'This is a straightforward task, proceed directly';

    return {
      taskId: task.id,
      complexity: task.complexity,
      duration: task.estimatedDuration,
      riskLevel,
      requiredSkills,
      suggestedApproach,
    };
  }

  getCriticalPath(plan: TaskPlan): Task[] {
    return this.getCriticalPath(plan.tasks);
  }

  private decomposeTask(request: string, context: PlanningContext): Task[] {
    // Check for template matches
    for (const template of TASK_TEMPLATES) {
      if (template.pattern.test(request)) {
        return template.tasks.map((t, i) => ({
          ...t,
          id: newTaskId(),
          subtasks: [],
        }));
      }
    }

    // Generic decomposition
    return this.genericDecomposition(request, context);
  }

  private genericDecomposition(request: string, context: PlanningContext): Task[] {
    const tasks: Task[] = [];

    tasks.push({
      id: newTaskId(),
      name: 'Understand requirements',
      description: `Analyze the request: "${request.slice(0, 100)}"`,
      dependencies: [],
      status: 'pending',
      complexity: 2,
      estimatedDuration: 10,
      subtasks: [],
      tags: ['analysis'],
    });

    tasks.push({
      id: newTaskId(),
      name: 'Research and plan',
      description: 'Research approach and create detailed plan',
      dependencies: [tasks[0].id],
      status: 'pending',
      complexity: 4,
      estimatedDuration: 20,
      subtasks: [],
      tags: ['planning'],
    });

    tasks.push({
      id: newTaskId(),
      name: 'Implement solution',
      description: 'Implement the main solution',
      dependencies: [tasks[1].id],
      status: 'pending',
      complexity: 6,
      estimatedDuration: 45,
      subtasks: [],
      tags: ['implementation'],
    });

    tasks.push({
      id: newTaskId(),
      name: 'Test and verify',
      description: 'Test the implementation',
      dependencies: [tasks[2].id],
      status: 'pending',
      complexity: 3,
      estimatedDuration: 15,
      subtasks: [],
      tags: ['testing'],
    });

    return tasks;
  }

  private topologicalSort(tasks: Task[]): Task[] {
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const visited = new Set<string>();
    const result: Task[] = [];

    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      const task = taskMap.get(id);
      if (!task) return;
      for (const dep of task.dependencies) {
        visit(dep);
      }
      result.push(task);
    };

    for (const task of tasks) {
      visit(task.id);
    }

    return result;
  }

  private getCriticalPath(tasks: Task[]): Task[] {
    const taskMap = new Map(tasks.map(t => [t.id, t]));

    // Calculate earliest finish time for each task
    const earliestFinish = new Map<string, number>();
    const visit = (id: string): number => {
      if (earliestFinish.has(id)) return earliestFinish.get(id)!;
      const task = taskMap.get(id);
      if (!task) return 0;

      let maxDepFinish = 0;
      for (const dep of task.dependencies) {
        maxDepFinish = Math.max(maxDepFinish, visit(dep));
      }

      const finish = maxDepFinish + task.estimatedDuration;
      earliestFinish.set(id, finish);
      return finish;
    };

    for (const task of tasks) {
      visit(task.id);
    }

    // Find the task with the latest finish time
    let maxFinish = 0;
    let lastTaskId = '';
    for (const [id, finish] of earliestFinish) {
      if (finish > maxFinish) {
        maxFinish = finish;
        lastTaskId = id;
      }
    }

    // Trace back to find critical path
    const path: Task[] = [];
    let currentId = lastTaskId;
    while (currentId) {
      const task = taskMap.get(currentId);
      if (!task) break;
      path.unshift(task);

      // Find the dependency with the latest finish time
      let maxDepFinish = 0;
      let nextId = '';
      for (const dep of task.dependencies) {
        const depFinish = earliestFinish.get(dep) ?? 0;
        if (depFinish > maxDepFinish) {
          maxDepFinish = depFinish;
          nextId = dep;
        }
      }
      currentId = nextId;
    }

    return path;
  }
}
