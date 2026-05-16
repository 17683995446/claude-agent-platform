// src/quick-docs.ts - 快速文档生成

export interface ProjectInfo {
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  repository?: string;
  main?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  keywords?: string[];
}

export interface FileEntry {
  path: string;
  content: string;
  language?: string;
}

export interface CommitEntry {
  hash: string;
  message: string;
  type?: string;
  scope?: string;
  date: string;
  author: string;
}

export interface TypeInfo {
  name: string;
  kind: 'interface' | 'type' | 'enum' | 'class' | 'function';
  description?: string;
  properties?: { name: string; type: string; description?: string; optional?: boolean }[];
  typeParams?: string[];
  extends?: string[];
  source?: string;
}

export interface APIDocumentation {
  title: string;
  modules: APIModule[];
}

export interface APIModule {
  name: string;
  description?: string;
  exports: APIExport[];
}

export interface APIExport {
  name: string;
  kind: string;
  description?: string;
  signature?: string;
  type?: string;
  deprecated?: boolean;
}

export class QuickDocsGenerator {
  generateREADME(project: ProjectInfo): string {
    const sections: string[] = [];

    // Title
    sections.push(`# ${project.name}`);
    sections.push('');

    // Description
    if (project.description) {
      sections.push(project.description);
      sections.push('');
    }

    // Badges
    sections.push(`## Installation`);
    sections.push('');
    sections.push('```bash');
    sections.push('npm install ' + project.name);
    sections.push('```');
    sections.push('');

    // Usage
    sections.push('## Usage');
    sections.push('');
    sections.push('```typescript');
    sections.push(`import { ... } from '${project.name}';`);
    sections.push('```');
    sections.push('');

    // API
    sections.push('## API');
    sections.push('');
    sections.push('See [API Documentation](./docs/api.md) for detailed API reference.');
    sections.push('');

    // Scripts
    if (project.scripts && Object.keys(project.scripts).length > 0) {
      sections.push('## Scripts');
      sections.push('');
      sections.push('| Command | Description |');
      sections.push('| --- | --- |');
      for (const [cmd, desc] of Object.entries(project.scripts)) {
        sections.push(`| \`npm run ${cmd}\` | ${desc} |`);
      }
      sections.push('');
    }

    // License
    if (project.license) {
      sections.push('## License');
      sections.push('');
      sections.push(project.license);
      sections.push('');
    }

    return sections.join('\n');
  }

  generateAPIDoc(sourceFiles: FileEntry[]): APIDocumentation {
    const modules: APIModule[] = [];

    for (const file of sourceFiles) {
      const mod: APIModule = {
        name: file.path,
        exports: this.extractExports(file.content, file.language),
      };

      // Extract module description from first comment block
      const commentMatch = file.content.match(/\/\*\*([\s\S]*?)\*\//);
      if (commentMatch) {
        mod.description = commentMatch[1]
          .replace(/^\s*\*\s?/gm, '')
          .trim();
      }

      modules.push(mod);
    }

    return {
      title: 'API Documentation',
      modules,
    };
  }

  private extractExports(content: string, language?: string): APIExport[] {
    const exports: APIExport[] = [];

    // Extract export declarations
    const exportRegex = /export\s+(?:default\s+)?(class|interface|type|enum|function|const|let|var)\s+(\w+)(?:<[^>]*>)?\s*(?:\([^)]*\))?(?:\s*:\s*([^={;]+))?(?:\s*=\s*([^;{]+))?/g;
    let match: RegExpExecArray | null;

    while ((match = exportRegex.exec(content)) !== null) {
      const [, kind, name, type, defaultValue] = match;
      const description = this.extractPrecedingComment(content, match.index);

      exports.push({
        name,
        kind: kind.toLowerCase(),
        description,
        type: type?.trim() || defaultValue?.trim(),
        signature: match[0].trim(),
      });
    }

    return exports;
  }

  private extractPrecedingComment(content: string, position: number): string | undefined {
    const before = content.substring(0, position).trimEnd();
    const commentMatch = before.match(/\/\*\*([\s\S]*?)\*\//);
    if (commentMatch) {
      return commentMatch[1]
        .replace(/^\s*\*\s?/gm, '')
        .replace(/@[\w]+.*$/gm, '')
        .trim();
    }
    return undefined;
  }

  generateChangelog(history: CommitEntry[]): string {
    const sections: string[] = [];

    sections.push('# Changelog');
    sections.push('');
    sections.push('All notable changes to this project will be documented in this file.');
    sections.push('');

    // Group commits by type
    const grouped: Record<string, CommitEntry[]> = {};
    for (const commit of history) {
      const type = commit.type || 'other';
      if (!grouped[type]) grouped[type] = [];
      grouped[type].push(commit);
    }

    // Generate sections for each type
    const typeLabels: Record<string, string> = {
      feat: 'Features',
      fix: 'Bug Fixes',
      docs: 'Documentation',
      style: 'Styles',
      refactor: 'Code Refactoring',
      test: 'Tests',
      chore: 'Chores',
      perf: 'Performance',
      other: 'Other',
    };

    for (const [type, commits] of Object.entries(grouped)) {
      sections.push(`### ${typeLabels[type] || type}`);
      sections.push('');

      for (const commit of commits) {
        const scope = commit.scope ? `**${commit.scope}:** ` : '';
        sections.push(`- ${scope}${commit.message} (${commit.hash.slice(0, 7)})`);
      }

      sections.push('');
    }

    return sections.join('\n');
  }

  generateTypeDoc(types: TypeInfo[]): string {
    const sections: string[] = [];

    sections.push('# Type Documentation');
    sections.push('');

    for (const typeInfo of types) {
      sections.push(`## ${typeInfo.kind.charAt(0).toUpperCase() + typeInfo.kind.slice(1)}: \`${typeInfo.name}\``);
      sections.push('');

      if (typeInfo.description) {
        sections.push(typeInfo.description);
        sections.push('');
      }

      if (typeInfo.typeParams && typeInfo.typeParams.length > 0) {
        sections.push(`**Type Parameters:** ${typeInfo.typeParams.map(p => `\`${p}\``).join(', ')}`);
        sections.push('');
      }

      if (typeInfo.extends && typeInfo.extends.length > 0) {
        sections.push(`**Extends:** ${typeInfo.extends.map(e => `\`${e}\``).join(', ')}`);
        sections.push('');
      }

      if (typeInfo.properties && typeInfo.properties.length > 0) {
        sections.push('**Properties:**');
        sections.push('');
        sections.push('| Name | Type | Description |');
        sections.push('| --- | --- | --- |');
        for (const prop of typeInfo.properties) {
          const opt = prop.optional ? ' *(optional)*' : '';
          sections.push(`| \`${prop.name}\`${opt} | \`${prop.type}\` | ${prop.description || ''} |`);
        }
        sections.push('');
      }

      if (typeInfo.source) {
        sections.push('```typescript');
        sections.push(typeInfo.source);
        sections.push('```');
        sections.push('');
      }
    }

    return sections.join('\n');
  }
}
