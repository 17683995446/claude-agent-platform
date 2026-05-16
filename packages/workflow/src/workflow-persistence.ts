// workflow-persistence.ts - 工作流持久化

import type { WorkflowInstance, WorkflowDefinition } from './workflow-engine.js';

export interface InstanceFilter {
  definitionId?: string;
  status?: string;
  startedAfter?: Date;
  startedBefore?: Date;
}

export interface Checkpoint {
  instanceId: string;
  stepId: string;
  variables: Record<string, unknown>;
  timestamp: Date;
}

export interface WorkflowStore {
  saveDefinition(definition: WorkflowDefinition): Promise<void>;
  loadDefinition(id: string): Promise<WorkflowDefinition | undefined>;
  listDefinitions(): Promise<WorkflowDefinition[]>;
  deleteDefinition(id: string): Promise<void>;
  saveInstance(instance: WorkflowInstance): Promise<void>;
  loadInstance(id: string): Promise<WorkflowInstance | undefined>;
  listInstances(filter?: InstanceFilter): Promise<WorkflowInstance[]>;
  deleteInstance(id: string): Promise<void>;
  saveCheckpoint(checkpoint: Checkpoint): Promise<void>;
  loadCheckpoint(instanceId: string): Promise<Checkpoint | undefined>;
}

export class InMemoryWorkflowStore implements WorkflowStore {
  private definitions = new Map<string, WorkflowDefinition>();
  private instances = new Map<string, WorkflowInstance>();
  private checkpoints = new Map<string, Checkpoint>();

  async saveDefinition(definition: WorkflowDefinition): Promise<void> {
    this.definitions.set(definition.id, JSON.parse(JSON.stringify(definition)));
  }

  async loadDefinition(id: string): Promise<WorkflowDefinition | undefined> {
    const def = this.definitions.get(id);
    return def ? JSON.parse(JSON.stringify(def)) : undefined;
  }

  async listDefinitions(): Promise<WorkflowDefinition[]> {
    return Array.from(this.definitions.values()).map(d => JSON.parse(JSON.stringify(d)));
  }

  async deleteDefinition(id: string): Promise<void> {
    this.definitions.delete(id);
  }

  async saveInstance(instance: WorkflowInstance): Promise<void> {
    this.instances.set(instance.id, JSON.parse(JSON.stringify(instance)));
  }

  async loadInstance(id: string): Promise<WorkflowInstance | undefined> {
    const inst = this.instances.get(id);
    return inst ? JSON.parse(JSON.stringify(inst)) : undefined;
  }

  async listInstances(filter?: InstanceFilter): Promise<WorkflowInstance[]> {
    let results = Array.from(this.instances.values()).map(i => JSON.parse(JSON.stringify(i)));

    if (filter) {
      if (filter.definitionId) {
        results = results.filter(i => i.definitionId === filter.definitionId);
      }
      if (filter.status) {
        results = results.filter(i => i.status === filter.status);
      }
      if (filter.startedAfter) {
        results = results.filter(i => new Date(i.startedAt) >= filter.startedAfter!);
      }
      if (filter.startedBefore) {
        results = results.filter(i => new Date(i.startedAt) <= filter.startedBefore!);
      }
    }

    return results;
  }

  async deleteInstance(id: string): Promise<void> {
    this.instances.delete(id);
  }

  async saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
    this.checkpoints.set(checkpoint.instanceId, JSON.parse(JSON.stringify(checkpoint)));
  }

  async loadCheckpoint(instanceId: string): Promise<Checkpoint | undefined> {
    const cp = this.checkpoints.get(instanceId);
    return cp ? JSON.parse(JSON.stringify(cp)) : undefined;
  }

  clear(): void {
    this.definitions.clear();
    this.instances.clear();
    this.checkpoints.clear();
  }
}

export class FileWorkflowStore implements WorkflowStore {
  private definitionsPath: string;
  private instancesPath: string;
  private checkpointsPath: string;

  constructor(baseDir: string) {
    this.definitionsPath = `${baseDir}/definitions.json`;
    this.instancesPath = `${baseDir}/instances.json`;
    this.checkpointsPath = `${baseDir}/checkpoints.json`;
  }

  private async readJson<T>(path: string): Promise<T> {
    try {
      const { readFile } = await import('node:fs/promises');
      const content = await readFile(path, 'utf-8');
      return JSON.parse(content) as T;
    } catch {
      return {} as T;
    }
  }

  private async writeJson<T>(path: string, data: T): Promise<void> {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
  }

  async saveDefinition(definition: WorkflowDefinition): Promise<void> {
    const all = await this.readJson<Record<string, WorkflowDefinition>>(this.definitionsPath);
    all[definition.id] = definition;
    await this.writeJson(this.definitionsPath, all);
  }

  async loadDefinition(id: string): Promise<WorkflowDefinition | undefined> {
    const all = await this.readJson<Record<string, WorkflowDefinition>>(this.definitionsPath);
    return all[id];
  }

  async listDefinitions(): Promise<WorkflowDefinition[]> {
    const all = await this.readJson<Record<string, WorkflowDefinition>>(this.definitionsPath);
    return Object.values(all);
  }

  async deleteDefinition(id: string): Promise<void> {
    const all = await this.readJson<Record<string, WorkflowDefinition>>(this.definitionsPath);
    delete all[id];
    await this.writeJson(this.definitionsPath, all);
  }

  async saveInstance(instance: WorkflowInstance): Promise<void> {
    const all = await this.readJson<Record<string, WorkflowInstance>>(this.instancesPath);
    all[instance.id] = instance;
    await this.writeJson(this.instancesPath, all);
  }

  async loadInstance(id: string): Promise<WorkflowInstance | undefined> {
    const all = await this.readJson<Record<string, WorkflowInstance>>(this.instancesPath);
    return all[id];
  }

  async listInstances(filter?: InstanceFilter): Promise<WorkflowInstance[]> {
    let results = Object.values(await this.readJson<Record<string, WorkflowInstance>>(this.instancesPath));

    if (filter) {
      if (filter.definitionId) {
        results = results.filter(i => i.definitionId === filter.definitionId);
      }
      if (filter.status) {
        results = results.filter(i => i.status === filter.status);
      }
      if (filter.startedAfter) {
        results = results.filter(i => new Date(i.startedAt) >= filter.startedAfter!);
      }
      if (filter.startedBefore) {
        results = results.filter(i => new Date(i.startedAt) <= filter.startedBefore!);
      }
    }

    return results;
  }

  async deleteInstance(id: string): Promise<void> {
    const all = await this.readJson<Record<string, WorkflowInstance>>(this.instancesPath);
    delete all[id];
    await this.writeJson(this.instancesPath, all);
  }

  async saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
    const all = await this.readJson<Record<string, Checkpoint>>(this.checkpointsPath);
    all[checkpoint.instanceId] = checkpoint;
    await this.writeJson(this.checkpointsPath, all);
  }

  async loadCheckpoint(instanceId: string): Promise<Checkpoint | undefined> {
    const all = await this.readJson<Record<string, Checkpoint>>(this.checkpointsPath);
    return all[instanceId];
  }
}
