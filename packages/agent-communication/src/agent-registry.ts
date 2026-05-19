// src/agent-registry.ts - Agent 注册中心

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface AgentInfo {
  id: string;
  name: string;
  type: string;
  capabilities: string[];
  tags: string[];
  metadata: Record<string, unknown>;
  registeredAt: number;
  lastHeartbeat: number;
  healthStatus: HealthStatus;
  endpoint?: string;
}

export interface DiscoveryQuery {
  capability?: string;
  name?: string;
  type?: string;
  tags?: string[];
  healthStatus?: HealthStatus;
}

interface HeartbeatConfig {
  interval: number;
  unhealthyAfter: number;
}

export class AgentRegistry {
  private agents: Map<string, AgentInfo> = new Map();
  private heartbeatTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private heartbeatConfig: HeartbeatConfig = {
    interval: 10000,
    unhealthyAfter: 30000,
  };

  register(agent: AgentInfo): void {
    const existing = this.agents.get(agent.id);
    if (existing) {
      this.stopHeartbeatCheck(agent.id);
    }

    const fullAgent: AgentInfo = {
      ...agent,
      registeredAt: agent.registeredAt ?? Date.now(),
      lastHeartbeat: agent.lastHeartbeat ?? Date.now(),
      healthStatus: agent.healthStatus ?? 'healthy',
    };
    this.agents.set(agent.id, fullAgent);
    this.startHeartbeatCheck(agent.id);
  }

  unregister(agentId: string): void {
    this.stopHeartbeatCheck(agentId);
    this.agents.delete(agentId);
  }

  discover(query: DiscoveryQuery): AgentInfo[] {
    let results = [...this.agents.values()];

    if (query.capability) {
      results = results.filter((a) => a.capabilities.includes(query.capability!));
    }
    if (query.name) {
      results = results.filter((a) => a.name === query.name);
    }
    if (query.type) {
      results = results.filter((a) => a.type === query.type);
    }
    if (query.tags && query.tags.length > 0) {
      results = results.filter((a) => query.tags!.some((t) => a.tags.includes(t)));
    }
    if (query.healthStatus) {
      results = results.filter((a) => a.healthStatus === query.healthStatus);
    }

    return results;
  }

  heartbeat(agentId: string, status: HealthStatus): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.lastHeartbeat = Date.now();
    agent.healthStatus = status;
  }

  getHealthyAgents(): AgentInfo[] {
    return [...this.agents.values()].filter((a) => a.healthStatus === 'healthy');
  }

  getAgent(agentId: string): AgentInfo | undefined {
    return this.agents.get(agentId);
  }

  getAllAgents(): AgentInfo[] {
    return [...this.agents.values()];
  }

  getAgentCount(): number {
    return this.agents.size;
  }

  setHeartbeatConfig(interval: number, unhealthyAfter: number): void {
    this.heartbeatConfig = { interval, unhealthyAfter };
    // COMM-12: Restart all heartbeat timers with the new interval
    for (const agentId of this.agents.keys()) {
      this.stopHeartbeatCheck(agentId);
      this.startHeartbeatCheck(agentId);
    }
  }

  private startHeartbeatCheck(agentId: string): void {
    const timer = setInterval(() => {
      const agent = this.agents.get(agentId);
      if (!agent) {
        this.stopHeartbeatCheck(agentId);
        return;
      }

      const elapsed = Date.now() - agent.lastHeartbeat;
      if (elapsed > this.heartbeatConfig.unhealthyAfter) {
        agent.healthStatus = 'unhealthy';
      }
    }, this.heartbeatConfig.interval);

    this.heartbeatTimers.set(agentId, timer);
  }

  private stopHeartbeatCheck(agentId: string): void {
    const timer = this.heartbeatTimers.get(agentId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(agentId);
    }
  }

  reset(): void {
    for (const timer of this.heartbeatTimers.values()) {
      clearInterval(timer);
    }
    this.agents.clear();
    this.heartbeatTimers.clear();
  }
}
