// ============================================================================
// @claude-agent/examples - Example Projects
// ============================================================================

export interface ExampleProject {
  id: string;
  name: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  readme: string;
  code: string;
  tags: string[];
}

export const EXAMPLES: ExampleProject[] = [
  {
    id: 'hello-agent',
    name: 'Hello Agent',
    description: 'A minimal agent that starts, logs a message, and stops gracefully.',
    difficulty: 'beginner',
    tags: ['core', 'lifecycle', 'basics'],
    readme: `# Hello Agent
A minimal Claude Agent Platform example.

## What it demonstrates
- Creating an AgentCore instance
- Starting and stopping the agent
- Using the EventBus to listen for lifecycle events

## How to run
\`\`\`bash
bun run examples/hello-agent.ts
\`\`\``,
    code: `import { AgentCore, EventBus } from '@claude-agent/core';

const agent = new AgentCore({ name: 'hello-agent' });
agent.getEventBus().on('agent.started', (e) => {
  console.log('Agent started:', e.data);
});
agent.getEventBus().on('agent.stopped', (e) => {
  console.log('Agent stopped:', e.data);
});

await agent.start();
console.log('Hello from Claude Agent Platform!');
await agent.stop();
`,
  },
  {
    id: 'pipeline-demo',
    name: 'Pipeline Demo',
    description: 'Build and execute a multi-step data processing pipeline.',
    difficulty: 'beginner',
    tags: ['pipeline', 'processing'],
    readme: `# Pipeline Demo
Demonstrates the PipelineBuilder fluent API.

## What it demonstrates
- Building pipelines with PipelineBuilder
- Adding steps with handlers
- Running pipelines and inspecting results`,
    code: `import { PipelineEngine, PipelineBuilder } from '@claude-agent/pipeline';

const engine = new PipelineEngine();
const definition = PipelineBuilder.define('data-process')
  .step('fetch', async (input) => ({ ...input, fetched: true }))
  .step('transform', async (input) => ({ ...input, transformed: true }))
  .step('validate', async (input) => ({ ...input, valid: true }))
  .build();

engine.register(definition);
const result = await engine.execute('data-process', { data: 'test' });
console.log('Pipeline result:', result.status);
`,
  },
  {
    id: 'plugin-system',
    name: 'Plugin System',
    description: 'Create and register custom plugins with event handlers.',
    difficulty: 'intermediate',
    tags: ['plugins', 'events', 'lifecycle'],
    readme: `# Plugin System
Shows how to create and use the plugin system.`,
    code: `import { PluginSystem } from '@claude-agent/plugins';

const system = new PluginSystem();
system.register({
  name: 'my-plugin',
  version: '1.0.0',
  init: async (ctx) => {
    ctx.logger.info('My plugin initialized!');
  },
  handlers: {
    'task.created': async (event) => {
      console.log('Task created:', event.data);
    },
  },
});

await system.initializeAll();
console.log('Active plugins:', system.activeCount());
await system.destroyAll();
`,
  },
  {
    id: 'event-sourcing-demo',
    name: 'Event Sourcing',
    description: 'Implement event sourcing with aggregates, snapshots, and projections.',
    difficulty: 'advanced',
    tags: ['event-sourcing', 'cqrs', 'architecture'],
    readme: `# Event Sourcing Demo
Demonstrates the event sourcing pattern.`,
    code: `import { InMemoryEventStore, AggregateRoot, DomainEvent, ProjectionManager, Projection } from '@claude-agent/event-sourcing';

interface TodoState { text: string; completed: boolean; }

class TodoAggregate extends AggregateRoot<TodoState> {
  constructor(id: string) { super(id, { text: '', completed: false }); }

  addTodo(text: string) { this.applyEvent('todo.added', { text }); }
  completeTodo() { this.applyEvent('todo.completed', {}); }

  protected handleEvent(event: DomainEvent) {
    switch (event.eventType) {
      case 'todo.added': this.state = { text: event.data.text, completed: false }; break;
      case 'todo.completed': this.state = { ...this.state, completed: true }; break;
    }
  }
}

const store = new InMemoryEventStore();
const todo = new TodoAggregate('todo-1');
todo.addTodo('Learn Claude Agent Platform');
todo.completeTodo();
for (const event of todo.getPendingEvents()) await store.append(event);
console.log('Events stored:', (await store.getEvents('todo-1')).length);
`,
  },
  {
    id: 'command-bus-demo',
    name: 'Command Bus',
    description: 'Use the command bus with validation, middleware, and history tracking.',
    difficulty: 'advanced',
    tags: ['commands', 'cqrs', 'validation'],
    readme: `# Command Bus Demo
Shows the CQRS command pattern.`,
    code: `import { CommandBus, loggingCommandMiddleware } from '@claude-agent/commands';

const bus = new CommandBus();
bus.use(loggingCommandMiddleware());

bus.register('create-task', async (cmd) => {
  return { success: true, data: { taskId: 'task-1', name: cmd.payload.name } };
}, (payload) => {
  if (!payload.name || typeof payload.name !== 'string') return { valid: false, errors: ['name is required'] };
  return { valid: true };
});

const result = await bus.dispatch('create-task', { name: 'Test Task' });
console.log('Command result:', result);
console.log('History:', bus.getHistory());
`,
  },
];

export function getExample(id: string): ExampleProject | undefined {
  return EXAMPLES.find(e => e.id === id);
}

export function listExamples(): ExampleProject[] {
  return [...EXAMPLES];
}

export function listExamplesByDifficulty(difficulty: ExampleProject['difficulty']): ExampleProject[] {
  return EXAMPLES.filter(e => e.difficulty === difficulty);
}

export function listExamplesByTag(tag: string): ExampleProject[] {
  return EXAMPLES.filter(e => e.tags.includes(tag));
}
