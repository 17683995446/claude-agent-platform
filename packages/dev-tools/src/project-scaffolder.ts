// src/project-scaffolder.ts - 项目脚手架

export interface TemplateDefinition {
  name: string;
  description: string;
  variables?: TemplateVariable[];
  files: TemplateFile[];
  postHooks?: string[];
}

export interface TemplateVariable {
  name: string;
  description: string;
  default?: string;
  required?: boolean;
  pattern?: string;
}

export interface TemplateFile {
  path: string;
  content: string;
  condition?: string;
}

export interface ScaffoldOptions {
  variables?: Record<string, string>;
  skipInstall?: boolean;
  skipGit?: boolean;
  targetDir?: string;
}

export interface ScaffoldResult {
  success: boolean;
  templateName: string;
  targetDir: string;
  filesCreated: string[];
  errors: string[];
}

export interface TemplateInfo {
  name: string;
  description: string;
  variableCount: number;
  fileCount: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class ProjectScaffolder {
  private templates: Map<string, TemplateDefinition> = new Map();

  constructor() {
    this.registerBuiltInTemplates();
  }

  private registerBuiltInTemplates(): void {
    // Library template
    this.templates.set('library', {
      name: 'library',
      description: 'A TypeScript library package',
      variables: [
        { name: 'name', description: 'Package name', required: true, default: 'my-lib' },
        { name: 'description', description: 'Package description', default: 'A TypeScript library' },
        { name: 'author', description: 'Author name', default: '' },
        { name: 'license', description: 'License type', default: 'MIT' },
      ],
      files: [
        { path: 'package.json', content: '{\n  "name": "{{name}}",\n  "version": "0.1.0",\n  "description": "{{description}}",\n  "main": "dist/index.js",\n  "types": "dist/index.d.ts",\n  "scripts": {\n    "build": "tsc",\n    "test": "vitest"\n  }\n}' },
        { path: 'tsconfig.json', content: '{\n  "compilerOptions": {\n    "target": "ES2020",\n    "module": "ESNext",\n    "lib": ["ES2020"],\n    "declaration": true,\n    "outDir": "dist",\n    "strict": true,\n    "esModuleInterop": true\n  },\n  "include": ["src"]\n}' },
        { path: 'src/index.ts', content: 'export function hello(name: string): string {\n  return `Hello, ${name}!`;\n}' },
        { path: '.gitignore', content: 'node_modules/\ndist/\n*.js.map\n.DS_Store' },
        { path: 'README.md', content: '# {{name}}\n\n{{description}}\n\n## Installation\n\n```bash\nnpm install {{name}}\n```\n\n## Usage\n\n```typescript\nimport { hello } from "{{name}}";\nconsole.log(hello("World"));\n```' },
      ],
      postHooks: ['install'],
    });

    // CLI tool template
    this.templates.set('cli-tool', {
      name: 'cli-tool',
      description: 'A TypeScript CLI tool',
      variables: [
        { name: 'name', description: 'CLI tool name', required: true, default: 'my-cli' },
        { name: 'description', description: 'Tool description', default: 'A CLI tool' },
        { name: 'bin', description: 'Binary name', default: '{{name}}' },
      ],
      files: [
        { path: 'package.json', content: '{\n  "name": "{{name}}",\n  "version": "0.1.0",\n  "description": "{{description}}",\n  "bin": {\n    "{{bin}}": "./dist/cli.js"\n  },\n  "scripts": {\n    "build": "tsc",\n    "start": "node dist/cli.js"\n  }\n}' },
        { path: 'tsconfig.json', content: '{\n  "compilerOptions": {\n    "target": "ES2020",\n    "module": "CommonJS",\n    "outDir": "dist",\n    "strict": true\n  },\n  "include": ["src"]\n}' },
        { path: 'src/cli.ts', content: '#!/usr/bin/env node\n\nconsole.log("Hello from {{name}}!");\n' },
        { path: '.gitignore', content: 'node_modules/\ndist/' },
      ],
      postHooks: ['install'],
    });

    // Web app template
    this.templates.set('web-app', {
      name: 'web-app',
      description: 'A web application',
      variables: [
        { name: 'name', description: 'App name', required: true, default: 'my-app' },
        { name: 'description', description: 'App description', default: 'A web application' },
      ],
      files: [
        { path: 'package.json', content: '{\n  "name": "{{name}}",\n  "version": "0.1.0",\n  "description": "{{description}}",\n  "scripts": {\n    "dev": "vite",\n    "build": "vite build",\n    "preview": "vite preview"\n  }\n}' },
        { path: 'index.html', content: '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>{{name}}</title>\n</head>\n<body>\n  <div id="app"></div>\n  <script type="module" src="/src/main.ts"></script>\n</body>\n</html>' },
        { path: 'src/main.ts', content: 'console.log("Hello from {{name}}!");\n' },
        { path: '.gitignore', content: 'node_modules/\ndist/' },
      ],
      postHooks: ['install'],
    });

    // API server template
    this.templates.set('api-server', {
      name: 'api-server',
      description: 'A REST API server',
      variables: [
        { name: 'name', description: 'API name', required: true, default: 'my-api' },
        { name: 'description', description: 'API description', default: 'A REST API server' },
        { name: 'port', description: 'Server port', default: '3000' },
      ],
      files: [
        { path: 'package.json', content: '{\n  "name": "{{name}}",\n  "version": "0.1.0",\n  "description": "{{description}}",\n  "main": "dist/index.js",\n  "scripts": {\n    "build": "tsc",\n    "start": "node dist/index.js",\n    "dev": "tsx watch src/index.ts"\n  }\n}' },
        { path: 'tsconfig.json', content: '{\n  "compilerOptions": {\n    "target": "ES2020",\n    "module": "ESNext",\n    "outDir": "dist",\n    "strict": true\n  },\n  "include": ["src"]\n}' },
        { path: 'src/index.ts', content: 'const PORT = process.env.PORT || {{port}};\n\nconsole.log(`Server running on port ${PORT}`);\n' },
        { path: '.gitignore', content: 'node_modules/\ndist/\n.env' },
      ],
      postHooks: ['install'],
    });

    // Plugin template
    this.templates.set('plugin', {
      name: 'plugin',
      description: 'A plugin package',
      variables: [
        { name: 'name', description: 'Plugin name', required: true, default: 'my-plugin' },
        { name: 'description', description: 'Plugin description', default: 'A plugin' },
      ],
      files: [
        { path: 'package.json', content: '{\n  "name": "{{name}}",\n  "version": "0.1.0",\n  "description": "{{description}}",\n  "main": "dist/index.js",\n  "scripts": {\n    "build": "tsc"\n  }\n}' },
        { path: 'src/index.ts', content: 'export interface Plugin {\n  name: string;\n  init(): void;\n}\n\nexport const plugin: Plugin = {\n  name: "{{name}}",\n  init() {\n    console.log("Plugin initialized");\n  },\n};\n' },
        { path: '.gitignore', content: 'node_modules/\ndist/' },
      ],
      postHooks: [],
    });
  }

  async scaffold(template: string, targetDir: string, options?: ScaffoldOptions): Promise<ScaffoldResult> {
    const templateDef = this.templates.get(template);
    if (!templateDef) {
      return {
        success: false,
        templateName: template,
        targetDir,
        filesCreated: [],
        errors: [`Template '${template}' not found`],
      };
    }

    const filesCreated: string[] = [];
    const errors: string[] = [];
    const vars = this.resolveVariables(templateDef, options?.variables || {});

    for (const file of templateDef.files) {
      try {
        const content = this.replaceVariables(file.content, vars);
        filesCreated.push(file.path);
      } catch (err) {
        errors.push(`Failed to create ${file.path}: ${err}`);
      }
    }

    return {
      success: errors.length === 0,
      templateName: template,
      targetDir,
      filesCreated,
      errors,
    };
  }

  private resolveVariables(template: TemplateDefinition, provided: Record<string, string>): Record<string, string> {
    const resolved: Record<string, string> = {};

    for (const v of template.variables || []) {
      const value = provided[v.name] || v.default || '';
      resolved[v.name] = this.replaceVariables(value, resolved);
    }

    // Add provided variables that might not be in template
    for (const [key, value] of Object.entries(provided)) {
      if (!(key in resolved)) {
        resolved[key] = value;
      }
    }

    return resolved;
  }

  private replaceVariables(content: string, vars: Record<string, string>): string {
    let result = content;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return result;
  }

  listTemplates(): TemplateInfo[] {
    return Array.from(this.templates.values()).map(t => ({
      name: t.name,
      description: t.description,
      variableCount: t.variables?.length || 0,
      fileCount: t.files.length,
    }));
  }

  createTemplate(template: TemplateDefinition): void {
    this.templates.set(template.name, template);
  }

  validateTemplate(template: TemplateDefinition): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!template.name) {
      errors.push('Template name is required');
    }
    if (!template.description) {
      warnings.push('Template description is recommended');
    }
    if (!template.files || template.files.length === 0) {
      errors.push('Template must have at least one file');
    }
    if (template.files) {
      const paths = new Set<string>();
      for (const file of template.files) {
        if (!file.path) {
          errors.push('File path is required');
        }
        if (paths.has(file.path)) {
          errors.push(`Duplicate file path: ${file.path}`);
        }
        paths.add(file.path);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  getTemplate(name: string): TemplateDefinition | undefined {
    return this.templates.get(name);
  }

  removeTemplate(name: string): boolean {
    return this.templates.delete(name);
  }

  hasTemplate(name: string): boolean {
    return this.templates.has(name);
  }
}
