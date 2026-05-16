// src/group-manager.ts - Agent 群组管理

import type { Message } from './message-bus.ts';

export type GroupRole = 'leader' | 'worker' | 'observer';
export type GroupPhase = 'forming' | 'storming' | 'norming' | 'performing' | 'adjourning';

export interface GroupConfig {
  name: string;
  description?: string;
  leaderId: string;
  maxMembers?: number;
  tags?: string[];
}

export interface GroupMember {
  agentId: string;
  role: GroupRole;
  joinedAt: number;
}

export interface AgentGroup {
  id: string;
  name: string;
  description: string;
  phase: GroupPhase;
  members: Map<string, GroupMember>;
  leaderId: string;
  createdAt: number;
  tags: string[];
  maxMembers: number;
}

export interface GroupInfo {
  id: string;
  name: string;
  description: string;
  phase: GroupPhase;
  memberCount: number;
  leaderId: string;
  members: GroupMember[];
  createdAt: number;
  tags: string[];
}

function generateGroupId(): string {
  return `group_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export class AgentGroupManager {
  private groups: Map<string, AgentGroup> = new Map();
  private messageHandlers: Map<string, (message: Message) => void> = new Map();
  private groupCounter = 0;

  createGroup(config: GroupConfig): AgentGroup {
    const id = generateGroupId();
    const group: AgentGroup = {
      id,
      name: config.name,
      description: config.description ?? '',
      phase: 'forming',
      members: new Map(),
      leaderId: config.leaderId,
      createdAt: Date.now(),
      tags: config.tags ?? [],
      maxMembers: config.maxMembers ?? 50,
    };

    // Add leader as first member
    group.members.set(config.leaderId, {
      agentId: config.leaderId,
      role: 'leader',
      joinedAt: Date.now(),
    });

    this.groups.set(id, group);
    return group;
  }

  joinGroup(groupId: string, agentId: string, role: GroupRole = 'worker'): void {
    const group = this.groups.get(groupId);
    if (!group) throw new Error(`Group ${groupId} not found`);
    if (group.phase === 'adjourning') throw new Error(`Group ${groupId} is adjourning`);
    if (group.members.has(agentId)) return;
    if (group.members.size >= group.maxMembers) throw new Error(`Group ${groupId} is full`);

    group.members.set(agentId, {
      agentId,
      role,
      joinedAt: Date.now(),
    });

    // Transition phase based on member count
    if (group.members.size >= 3 && group.phase === 'forming') {
      group.phase = 'storming';
    }
  }

  leaveGroup(groupId: string, agentId: string): void {
    const group = this.groups.get(groupId);
    if (!group) throw new Error(`Group ${groupId} not found`);

    if (agentId === group.leaderId) {
      // Leader leaving - adjourn the group but keep it around
      group.phase = 'adjourning';
    }

    group.members.delete(agentId);

    if (group.members.size === 0 && group.phase !== 'adjourning') {
      this.groups.delete(groupId);
    }
  }

  broadcast(groupId: string, message: Message): void {
    const group = this.groups.get(groupId);
    if (!group) return;

    for (const member of group.members.values()) {
      const handler = this.messageHandlers.get(member.agentId);
      if (handler) {
        handler({ ...message, receiver: member.agentId });
      }
    }
  }

  multicast(groupId: string, message: Message, agentIds: string[]): void {
    const group = this.groups.get(groupId);
    if (!group) return;

    for (const agentId of agentIds) {
      if (group.members.has(agentId)) {
        const handler = this.messageHandlers.get(agentId);
        if (handler) {
          handler({ ...message, receiver: agentId });
        }
      }
    }
  }

  unicast(groupId: string, message: Message, targetAgentId: string): void {
    const group = this.groups.get(groupId);
    if (!group) return;
    if (!group.members.has(targetAgentId)) return;

    const handler = this.messageHandlers.get(targetAgentId);
    if (handler) {
      handler({ ...message, receiver: targetAgentId });
    }
  }

  registerMessageHandler(agentId: string, handler: (message: Message) => void): void {
    this.messageHandlers.set(agentId, handler);
  }

  getGroupInfo(groupId: string): GroupInfo | undefined {
    const group = this.groups.get(groupId);
    if (!group) return undefined;

    return {
      id: group.id,
      name: group.name,
      description: group.description,
      phase: group.phase,
      memberCount: group.members.size,
      leaderId: group.leaderId,
      members: [...group.members.values()],
      createdAt: group.createdAt,
      tags: group.tags,
    };
  }

  getGroup(groupId: string): AgentGroup | undefined {
    return this.groups.get(groupId);
  }

  setGroupPhase(groupId: string, phase: GroupPhase): void {
    const group = this.groups.get(groupId);
    if (group) group.phase = phase;
  }

  getGroupCount(): number {
    return this.groups.size;
  }

  getGroupsByTag(tag: string): AgentGroup[] {
    return [...this.groups.values()].filter((g) => g.tags.includes(tag));
  }

  reset(): void {
    this.groups.clear();
    this.messageHandlers.clear();
    this.groupCounter = 0;
  }
}
