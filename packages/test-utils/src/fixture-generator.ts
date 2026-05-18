// FixtureGenerator: Generate test data fixtures

export interface CodeSnippet {
  language: string;
  code: string;
  complexity: number;
}

export function generateCodeSnippet(language: string, complexity: number = 1): CodeSnippet {
  const templates: Record<string, Record<number, string>> = {
    typescript: {
      1: `const x = 1;\nconsole.log(x);`,
      2: `function greet(name: string): string {\n  return \`Hello, \${name}!\`;\n}\nconsole.log(greet("World"));`,
      3: `interface Node<T> {\n  value: T;\n  next?: Node<T>;\n}\n\nclass LinkedList<T> {\n  private head?: Node<T>;\n\n  append(value: T): void {\n    const node: Node<T> = { value };\n    if (!this.head) {\n      this.head = node;\n      return;\n    }\n    let current = this.head;\n    while (current.next) {\n      current = current.next;\n    }\n    current.next = node;\n  }\n}`,
    },
    python: {
      1: `x = 1\nprint(x)`,
      2: `def greet(name):\n    return f"Hello, {name}!"\n\nprint(greet("World"))`,
      3: `class LinkedList:\n    def __init__(self):\n        self.head = None\n\n    def append(self, value):\n        node = {"value": value, "next": None}\n        if not self.head:\n            self.head = node\n            return\n        current = self.head\n        while current["next"]:\n            current = current["next"]\n        current["next"] = node`,
    },
    rust: {
      1: `fn main() {\n    let x = 1;\n    println!("{}", x);\n}`,
      2: `fn greet(name: &str) -> String {\n    format!("Hello, {}!", name)\n}\n\nfn main() {\n    println!("{}", greet("World"));\n}`,
      3: `struct Node<T> {\n    value: T,\n    next: Option<Box<Node<T>>>,\n}\n\nimpl<T> Node<T> {\n    fn new(value: T) -> Self {\n        Node { value, next: None }\n    }\n}`,
    },
    go: {
      1: `package main\n\nimport "fmt"\n\nfunc main() {\n    x := 1\n    fmt.Println(x)\n}`,
      2: `package main\n\nimport "fmt"\n\nfunc greet(name string) string {\n    return fmt.Sprintf("Hello, %s!", name)\n}\n\nfunc main() {\n    fmt.Println(greet("World"))\n}`,
      3: `package main\n\ntype Node struct {\n    value int\n    next  *Node\n}\n\ntype LinkedList struct {\n    head *Node\n}\n\nfunc (ll *LinkedList) Append(value int) {\n    node := &Node{value: value}\n    if ll.head == nil {\n        ll.head = node\n        return\n    }\n    current := ll.head\n    for current.next != nil {\n        current = current.next\n    }\n    current.next = node\n}`,
    },
  };

  const langTemplates = templates[language] ?? templates['typescript']!;
  const level = Math.min(Math.max(1, Math.round(complexity)), 3);
  const code = langTemplates[level] ?? langTemplates[1]!;

  return { language, code, complexity: level };
}

export interface GraphData {
  nodes: Array<{ id: string; label: string; properties: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string; label: string; weight: number }>;
}

export function generateGraphData(nodeCount: number = 5, edgeCount: number = 7): GraphData {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `node-${i}`,
    label: `Node ${i}`,
    properties: { index: i, created: Date.now() },
  }));

  const edges: GraphData['edges'] = [];
  for (let i = 0; i < edgeCount; i++) {
    const source = `node-${i % nodeCount}`;
    const target = `node-${(i + 1) % nodeCount}`;
    edges.push({
      id: `edge-${i}`,
      source,
      target,
      label: `connects-${i}`,
      weight: Math.random(),
    });
  }

  return { nodes, edges };
}

export interface TimelineEvent {
  id: string;
  timestamp: number;
  type: string;
  data: Record<string, unknown>;
}

export function generateTimelineEvents(count: number = 10, startDate?: Date): TimelineEvent[] {
  const start = startDate ?? new Date('2025-01-01T00:00:00Z');
  const eventTypes = ['created', 'updated', 'deleted', 'archived', 'restored'];

  return Array.from({ length: count }, (_, i) => ({
    id: `event-${i}`,
    timestamp: start.getTime() + i * 3600_000,
    type: eventTypes[i % eventTypes.length]!,
    data: { index: i, source: 'fixture-generator' },
  }));
}

export interface CRDTOperation {
  id: string;
  type: 'insert' | 'delete' | 'update';
  key: string;
  value: unknown;
  timestamp: number;
  nodeId: string;
  vectorClock: Record<string, number>;
}

export function generateCRDTOperations(count: number = 5, type?: string): CRDTOperation[] {
  const opTypes: Array<'insert' | 'delete' | 'update'> = ['insert', 'delete', 'update'];
  return Array.from({ length: count }, (_, i) => ({
    id: `op-${i}`,
    type: (type as CRDTOperation['type']) ?? opTypes[i % opTypes.length]!,
    key: `key-${i}`,
    value: `value-${i}`,
    timestamp: Date.now() + i,
    nodeId: `node-${i % 3}`,
    vectorClock: { [`node-${i % 3}`]: i + 1 },
  }));
}

export interface WorkflowStep {
  id: string;
  name: string;
  action: string;
  timeout: number;
  retryCount: number;
}

export interface WorkflowBranch {
  id: string;
  condition: string;
  targetStep: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  steps: WorkflowStep[];
  branches: WorkflowBranch[];
}

export function generateWorkflowDefinition(
  steps: number = 3,
  branches: number = 1,
): WorkflowDefinition {
  const stepList: WorkflowStep[] = Array.from({ length: steps }, (_, i) => ({
    id: `step-${i}`,
    name: `Step ${i}`,
    action: `action-${i}`,
    timeout: 5000,
    retryCount: 3,
  }));

  const branchList: WorkflowBranch[] = Array.from({ length: branches }, (_, i) => ({
    id: `branch-${i}`,
    condition: `condition-${i}`,
    targetStep: `step-${(i + 1) % steps}`,
  }));

  return {
    id: `workflow-${Date.now()}`,
    name: 'Test Workflow',
    steps: stepList,
    branches: branchList,
  };
}

export interface PipelineStageDef {
  name: string;
  type: string;
  config: Record<string, unknown>;
}

export function generatePipelineStages(count: number = 3): PipelineStageDef[] {
  const types = ['transform', 'filter', 'map', 'reduce', 'aggregate'];
  return Array.from({ length: count }, (_, i) => ({
    name: `stage-${i}`,
    type: types[i % types.length]!,
    config: { parallelism: 4, batchSize: 100 },
  }));
}

export interface UserSession {
  id: string;
  userId: string;
  startedAt: number;
  endedAt: number | null;
  metadata: Record<string, unknown>;
}

export function generateUserSessions(count: number = 5): UserSession[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `session-${i}`,
    userId: `user-${i % 3}`,
    startedAt: Date.now() - i * 86400_000,
    endedAt: i % 2 === 0 ? Date.now() - i * 43200_000 : null,
    metadata: { browser: 'test', os: 'test-os' },
  }));
}

export interface APIMockResponse {
  endpoint: string;
  method: string;
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
}

export function generateAPIMockResponses(endpoint: string): APIMockResponse[] {
  return [
    {
      endpoint,
      method: 'GET',
      statusCode: 200,
      body: { id: '1', name: 'Test Resource' },
      headers: { 'content-type': 'application/json' },
    },
    {
      endpoint,
      method: 'POST',
      statusCode: 201,
      body: { id: '2', name: 'Created Resource' },
      headers: { 'content-type': 'application/json' },
    },
    {
      endpoint,
      method: 'PUT',
      statusCode: 200,
      body: { id: '1', name: 'Updated Resource' },
      headers: { 'content-type': 'application/json' },
    },
    {
      endpoint,
      method: 'DELETE',
      statusCode: 204,
      body: null,
      headers: {},
    },
  ];
}
