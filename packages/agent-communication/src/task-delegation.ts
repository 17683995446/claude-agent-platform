// src/task-delegation.ts - 任务委托系统

export type TaskState = 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
export type LoadBalanceStrategy = 'round-robin' | 'least-loaded' | 'capability-based' | 'random';

export interface AgentTask {
  id: string;
  type: string;
  payload: unknown;
  priority: number;
  requiredCapabilities: string[];
  timeout: number;
  createdAt: number;
}

export interface AssignmentCriteria {
  strategy?: LoadBalanceStrategy;
  preferredAgentId?: string;
  excludeAgents?: string[];
  requiredCapabilities?: string[];
}

export interface TaskAssignment {
  taskId: string;
  agentId: string;
  assignedAt: number;
  state: TaskState;
}

export interface TaskResult {
  taskId: string;
  agentId: string;
  success: boolean;
  result: unknown;
  completedAt: number;
  error?: string;
}

export interface TaskStatus {
  taskId: string;
  state: TaskState;
  assignment?: TaskAssignment;
  result?: TaskResult;
}

interface AgentWorkload {
  agentId: string;
  activeTasks: number;
  capabilities: string[];
  available: boolean;
}

function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export class TaskDelegationManager {
  private tasks: Map<string, TaskStatus> = new Map();
  private agents: Map<string, AgentWorkload> = new Map();
  private roundRobinIndex = 0;
  private escalationHandlers: Map<string, (task: AgentTask) => void> = new Map();
  private taskTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private taskResolvers: Map<string, (result: TaskResult) => void> = new Map();

  registerAgent(agentId: string, capabilities: string[]): void {
    this.agents.set(agentId, {
      agentId,
      activeTasks: 0,
      capabilities,
      available: true,
    });
  }

  unregisterAgent(agentId: string): void {
    // COMM-11: Handle active tasks - cancel timers and mark tasks failed
    for (const [taskId, status] of this.tasks.entries()) {
      if (status.assignment?.agentId === agentId &&
          (status.state === 'assigned' || status.state === 'in_progress' || status.state === 'pending')) {
        status.state = 'failed';
        const timer = this.taskTimers.get(taskId);
        if (timer) {
          clearTimeout(timer);
          this.taskTimers.delete(taskId);
        }
        const resolver = this.taskResolvers.get(taskId);
        if (resolver) {
          this.taskResolvers.delete(taskId);
          resolver({
            taskId,
            agentId,
            success: false,
            result: null,
            completedAt: Date.now(),
            error: `Agent ${agentId} unregistered`,
          });
        }
      }
    }
    this.agents.delete(agentId);
  }

  setAgentAvailable(agentId: string, available: boolean): void {
    const agent = this.agents.get(agentId);
    if (agent) agent.available = available;
  }

  setEscalationHandler(taskType: string, handler: (task: AgentTask) => void): void {
    this.escalationHandlers.set(taskType, handler);
  }

  async delegate(task: AgentTask, criteria?: AssignmentCriteria): Promise<TaskResult> {
    const status: TaskStatus = {
      taskId: task.id,
      state: 'pending',
    };
    this.tasks.set(task.id, status);

    const agentId = this.selectAgent(task, criteria);
    if (!agentId) {
      status.state = 'failed';
      return {
        taskId: task.id,
        agentId: 'none',
        success: false,
        result: null,
        completedAt: Date.now(),
        error: 'No suitable agent found',
      };
    }

    return this.assignTo(agentId, task);
  }

  async assignTo(agentId: string, task: AgentTask): Promise<TaskResult> {
    const agent = this.agents.get(agentId);
    if (!agent || !agent.available) {
      return {
        taskId: task.id,
        agentId,
        success: false,
        result: null,
        completedAt: Date.now(),
        error: `Agent ${agentId} not available`,
      };
    }

    const assignment: TaskAssignment = {
      taskId: task.id,
      agentId,
      assignedAt: Date.now(),
      state: 'assigned',
    };

    const status = this.tasks.get(task.id) ?? { taskId: task.id, state: 'pending' };
    status.state = 'assigned';
    status.assignment = assignment;
    this.tasks.set(task.id, status);

    agent.activeTasks++;

    // Simulate task execution with timeout
    return new Promise<TaskResult>((resolve) => {
      this.taskResolvers.set(task.id, resolve);
      const timer = setTimeout(() => {
        this.taskTimers.delete(task.id);
        this.taskResolvers.delete(task.id);
        agent.activeTasks = Math.max(0, agent.activeTasks - 1);
        const result: TaskResult = {
          taskId: task.id,
          agentId,
          success: true,
          result: { executed: true },
          completedAt: Date.now(),
        };
        status.state = 'completed';
        status.result = result;
        this.tasks.set(task.id, status);
        resolve(result);
      }, task.timeout);
      this.taskTimers.set(task.id, timer);
    });
  }

  checkStatus(taskId: string): TaskStatus | undefined {
    return this.tasks.get(taskId);
  }

  cancelTask(taskId: string): boolean {
    const status = this.tasks.get(taskId);
    if (!status) return false;
    if (status.state === 'completed' || status.state === 'cancelled') return false;

    status.state = 'cancelled';
    // Clear the timeout so it doesn't override the cancelled status
    const timer = this.taskTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.taskTimers.delete(taskId);
    }
    // Resolve the pending promise so awaiters don't hang
    const resolver = this.taskResolvers.get(taskId);
    if (resolver) {
      this.taskResolvers.delete(taskId);
      resolver({
        taskId,
        agentId: status.assignment?.agentId ?? 'none',
        success: false,
        result: null,
        completedAt: Date.now(),
        error: 'Task cancelled',
      });
    }
    if (status.assignment) {
      const agent = this.agents.get(status.assignment.agentId);
      if (agent) agent.activeTasks = Math.max(0, agent.activeTasks - 1);
    }
    return true;
  }

  getAgentWorkload(agentId: string): number {
    return this.agents.get(agentId)?.activeTasks ?? 0;
  }

  private selectAgent(task: AgentTask, criteria?: AssignmentCriteria): string | null {
    const strategy = criteria?.strategy ?? 'round-robin';
    const exclude = new Set(criteria?.excludeAgents ?? []);

    const availableAgents = [...this.agents.values()].filter(
      (a) => a.available && !exclude.has(a.agentId),
    );

    if (availableAgents.length === 0) return null;

    // Filter by required capabilities
    const requiredCaps = criteria?.requiredCapabilities ?? task.requiredCapabilities;
    let candidates = availableAgents;
    if (requiredCaps.length > 0) {
      candidates = availableAgents.filter((a) =>
        requiredCaps.every((cap) => a.capabilities.includes(cap)),
      );
    }

    if (candidates.length === 0) return null;

    // Check preferred agent
    if (criteria?.preferredAgentId) {
      const preferred = candidates.find((a) => a.agentId === criteria.preferredAgentId);
      if (preferred) return preferred.agentId;
    }

    switch (strategy) {
      case 'round-robin':
        // COMM-28: Use modulo assignment to prevent unbounded growth
        const idx = this.roundRobinIndex % candidates.length;
        this.roundRobinIndex = idx + 1;
        return candidates[idx].agentId;
      case 'least-loaded':
        // COMM-35: Use linear scan instead of sort in place to avoid mutating candidates
        {
          let minTasks = Infinity;
          let selected = candidates[0];
          for (const c of candidates) {
            if (c.activeTasks < minTasks) {
              minTasks = c.activeTasks;
              selected = c;
            }
          }
          return selected.agentId;
        }
      case 'capability-based':
        // COMM-35: Use linear scan instead of sort in place
        {
          let maxCaps = -1;
          let selected = candidates[0];
          for (const c of candidates) {
            if (c.capabilities.length > maxCaps) {
              maxCaps = c.capabilities.length;
              selected = c;
            }
          }
          return selected.agentId;
        }
      case 'random':
        return candidates[Math.floor(Math.random() * candidates.length)].agentId;
      default:
        return candidates[0].agentId;
    }
  }

  reset(): void {
    // BUG-FIX-003 [CRITICAL]: Resolve all pending task promises before clearing,
    // preventing callers from hanging forever when reset() is called.
    for (const [taskId, resolver] of this.taskResolvers.entries()) {
      const status = this.tasks.get(taskId);
      resolver({
        taskId,
        agentId: status?.assignment?.agentId ?? 'none',
        success: false,
        result: null,
        completedAt: Date.now(),
        error: 'Task manager reset',
      });
    }
    // Clear all pending timers
    for (const timer of this.taskTimers.values()) {
      clearTimeout(timer);
    }
    this.taskTimers.clear();
    this.taskResolvers.clear();
    this.tasks.clear();
    this.agents.clear();
    this.roundRobinIndex = 0;
    this.escalationHandlers.clear();
  }
}
