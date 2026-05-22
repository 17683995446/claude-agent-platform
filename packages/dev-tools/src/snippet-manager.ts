// src/snippet-manager.ts - 代码片段管理

export interface SnippetDefinition {
  name: string;
  description?: string;
  language: string;
  code: string;
  tags?: string[];
  variables?: Record<string, string>;
}

export interface Snippet extends SnippetDefinition {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export interface SnippetFilter {
  language?: string;
  tags?: string[];
  namePattern?: string;
}

export class SnippetManager {
  private snippets: Map<string, Snippet> = new Map();
  private nextId: number = 1;

  constructor() {
    this.registerBuiltInSnippets();
  }

  private registerBuiltInSnippets(): void {
    const builtIns: SnippetDefinition[] = [
      {
        name: 'function',
        description: 'Basic function template',
        language: 'typescript',
        code: 'function ${name}(${params}): ${returnType} {\n  ${body}\n}',
        tags: ['basic', 'function'],
        variables: { name: 'myFunction', params: '', returnType: 'void', body: '// TODO' },
      },
      {
        name: 'async-function',
        description: 'Async function template',
        language: 'typescript',
        code: 'async function ${name}(${params}): Promise<${returnType}> {\n  ${body}\n}',
        tags: ['async', 'function'],
        variables: { name: 'myAsyncFunction', params: '', returnType: 'void', body: '// TODO' },
      },
      {
        name: 'class',
        description: 'Basic class template',
        language: 'typescript',
        code: 'class ${name} {\n  constructor(${params}) {\n    ${body}\n  }\n}',
        tags: ['basic', 'class', 'oop'],
        variables: { name: 'MyClass', params: '', body: '// TODO' },
      },
      {
        name: 'try-catch',
        description: 'Try-catch error handling',
        language: 'typescript',
        code: 'try {\n  ${body}\n} catch (error) {\n  console.error(error);\n  ${errorHandling}\n}',
        tags: ['error-handling'],
        variables: { body: '// TODO', errorHandling: '' },
      },
      {
        name: 'fetch-request',
        description: 'HTTP fetch request',
        language: 'typescript',
        code: 'const response = await fetch(${url});\nconst data = await response.json();',
        tags: ['http', 'api', 'async'],
        variables: { url: "'https://api.example.com/data'" },
      },
      {
        name: 'react-component',
        description: 'React functional component',
        language: 'typescript',
        code: 'interface ${name}Props {\n  ${props}\n}\n\nfunction ${name}({ ${propsList} }: ${name}Props) {\n  return (\n    ${jsx}\n  );\n}\n\nexport default ${name};',
        tags: ['react', 'component', 'frontend'],
        variables: { name: 'MyComponent', props: '', propsList: '', jsx: '<div></div>' },
      },
      {
        name: 'express-route',
        description: 'Express.js route handler',
        language: 'typescript',
        code: '${method}.router.${methodLower}(${path}, async (req, res) => {\n  ${body}\n});',
        tags: ['express', 'api', 'backend'],
        variables: { method: 'app', methodLower: 'get', path: "'/'", body: 'res.json({ success: true });' },
      },
      {
        name: 'for-loop',
        description: 'Standard for loop',
        language: 'typescript',
        code: 'for (let ${index} = 0; ${index} < ${array}.length; ${index}++) {\n  ${body}\n}',
        tags: ['basic', 'loop'],
        variables: { index: 'i', array: 'items', body: '// TODO' },
      },
    ];

    for (const def of builtIns) {
      this.create(def);
    }
  }

  create(snippet: SnippetDefinition): Snippet {
    const now = Date.now();
    const newSnippet: Snippet = {
      ...snippet,
      id: String(this.nextId++),
      createdAt: now,
      updatedAt: now,
    };
    this.snippets.set(newSnippet.name, newSnippet);
    return newSnippet;
  }

  get(name: string): Snippet | undefined {
    return this.snippets.get(name);
  }

  update(name: string, updates: Partial<SnippetDefinition>): Snippet | undefined {
    const existing = this.snippets.get(name);
    if (!existing) return undefined;

    const updated: Snippet = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };

    this.snippets.set(name, updated);
    return updated;
  }

  delete(name: string): boolean {
    return this.snippets.delete(name);
  }

  search(query: string): Snippet[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.snippets.values()).filter(s =>
      s.name.toLowerCase().includes(lowerQuery) ||
      s.description?.toLowerCase().includes(lowerQuery) ||
      s.language.toLowerCase().includes(lowerQuery) ||
      s.code.toLowerCase().includes(lowerQuery) ||
      s.tags?.some(t => t.toLowerCase().includes(lowerQuery))
    );
  }

  expand(name: string, variables?: Record<string, string>): string {
    const snippet = this.snippets.get(name);
    if (!snippet) return '';

    let code = snippet.code;
    const allVars = { ...snippet.variables, ...variables };

    for (const [key, value] of Object.entries(allVars)) {
      code = code.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
    }

    return code;
  }

  importSnippets(data: string): number {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return 0;
    }
    const snippets = Array.isArray(parsed) ? parsed : [parsed];
    let count = 0;

    for (const snippet of snippets) {
      if (snippet.name && snippet.code && snippet.language) {
        this.create(snippet);
        count++;
      }
    }

    return count;
  }

  exportSnippets(filter?: SnippetFilter): string {
    let snippets = Array.from(this.snippets.values());

    if (filter?.language) {
      snippets = snippets.filter(s => s.language === filter.language);
    }
    if (filter?.tags) {
      snippets = snippets.filter(s =>
        filter.tags!.some(t => s.tags?.includes(t))
      );
    }
    if (filter?.namePattern) {
      const regex = new RegExp(filter.namePattern);
      snippets = snippets.filter(s => regex.test(s.name));
    }

    // Remove internal fields
    const exportData = snippets.map(({ id, createdAt, updatedAt, ...rest }) => rest);
    return JSON.stringify(exportData, null, 2);
  }

  list(): Snippet[] {
    return Array.from(this.snippets.values());
  }

  getByLanguage(language: string): Snippet[] {
    return Array.from(this.snippets.values()).filter(s => s.language === language);
  }

  getByTag(tag: string): Snippet[] {
    return Array.from(this.snippets.values()).filter(s => s.tags?.includes(tag));
  }

  count(): number {
    return this.snippets.size;
  }

  clear(): void {
    this.snippets.clear();
    this.nextId = 1;
  }
}
