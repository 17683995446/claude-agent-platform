// ScenarioBuilder: Build complex test scenarios

import type { GraphData } from './fixture-generator.js';
import { generateGraphData, generateWorkflowDefinition, generatePipelineStages } from './fixture-generator.js';

export interface ScenarioConfig {
  graph?: GraphData;
  crdt?: { nodes: number };
  workflow?: ReturnType<typeof generateWorkflowDefinition>;
  pipeline?: ReturnType<typeof generatePipelineStages>;
  replication?: { nodeCount: number; factor: number };
  events?: Array<{ type: string; data: unknown }>;
  faults?: Array<{ type: string; target: string }>;
}

export class ScenarioBuilder {
  private config: ScenarioConfig = {};

  withGraph(graphConfig: { nodeCount?: number; edgeCount?: number }): ScenarioBuilder {
    const nodeCount = graphConfig.nodeCount ?? 5;
    const edgeCount = graphConfig.edgeCount ?? 7;
    this.config.graph = generateGraphData(nodeCount, edgeCount);
    return this;
  }

  withCRDT(nodes: number): ScenarioBuilder {
    this.config.crdt = { nodes };
    return this;
  }

  withWorkflow(definition?: { steps?: number; branches?: number }): ScenarioBuilder {
    const steps = definition?.steps ?? 3;
    const branches = definition?.branches ?? 1;
    this.config.workflow = generateWorkflowDefinition(steps, branches);
    return this;
  }

  withPipeline(stages?: number): ScenarioBuilder {
    this.config.pipeline = generatePipelineStages(stages ?? 3);
    return this;
  }

  withReplication(config: { nodeCount: number; factor: number }): ScenarioBuilder {
    this.config.replication = config;
    return this;
  }

  withEvents(events: Array<{ type: string; data: unknown }>): ScenarioBuilder {
    this.config.events = events;
    return this;
  }

  injectFault(type: string, target: string): ScenarioBuilder {
    if (!this.config.faults) {
      this.config.faults = [];
    }
    this.config.faults.push({ type, target });
    return this;
  }

  build(): ScenarioConfig {
    return { ...this.config };
  }
}

export function createScenarioBuilder(): ScenarioBuilder {
  return new ScenarioBuilder();
}
