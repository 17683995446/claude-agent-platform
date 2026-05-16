// ============================================================================
// @claude-agent/api-docs - API Documentation Generator
// ============================================================================

export interface APIDocEntry {
  packageName: string;
  entityName: string;
  entityType: 'class' | 'interface' | 'function' | 'type' | 'constant';
  description: string;
  members?: APIDocMember[];
  examples?: string[];
  tags?: string[];
}

export interface APIDocMember {
  name: string;
  type: string;
  description: string;
  optional?: boolean;
  defaultValue?: string;
}

export class APIDocumentation {
  private entries: APIDocEntry[] = [];

  addEntry(entry: APIDocEntry): void {
    this.entries.push(entry);
  }

  getEntry(packageName: string, entityName: string): APIDocEntry | undefined {
    return this.entries.find(e => e.packageName === packageName && e.entityName === entityName);
  }

  getByPackage(packageName: string): APIDocEntry[] {
    return this.entries.filter(e => e.packageName === packageName);
  }

  search(query: string): APIDocEntry[] {
    const lower = query.toLowerCase();
    return this.entries.filter(e =>
      e.entityName.toLowerCase().includes(lower) ||
      e.description.toLowerCase().includes(lower) ||
      e.tags?.some(t => t.toLowerCase().includes(lower))
    );
  }

  listPackages(): string[] {
    return [...new Set(this.entries.map(e => e.packageName))];
  }

  listEntities(packageName?: string): { name: string; type: string }[] {
    const filtered = packageName ? this.getByPackage(packageName) : this.entries;
    return filtered.map(e => ({ name: e.entityName, type: e.entityType }));
  }

  generateMarkdown(): string {
    const lines: string[] = ['# Claude Agent Platform API Documentation', ''];
    const packages = this.listPackages();
    for (const pkg of packages) {
      lines.push(`## @claude-agent/${pkg}\n`);
      const entities = this.getByPackage(pkg);
      for (const entity of entities) {
        const badge = entity.entityType === 'class' ? 'class' : entity.entityType;
        lines.push(`### ${entity.entityName} \`\`\`${badge}\`\`\`\n`);
        lines.push(entity.description);
        if (entity.members && entity.members.length > 0) {
          lines.push('');
          lines.push('| Member | Type | Description |');
          lines.push('|--------|------|-------------|');
          for (const member of entity.members) {
            const opt = member.optional ? ' *' : '';
            const def = member.defaultValue ? ` (default: ${member.defaultValue})` : '';
            lines.push(`| \`${member.name}\`${opt} | \`${member.type}\` | ${member.description}${def} |`);
          }
        }
        if (entity.examples && entity.examples.length > 0) {
          lines.push('');
          for (const example of entity.examples) {
            lines.push(`\`\`\`typescript\n${example}\n\`\`\``);
          }
        }
        lines.push('');
      }
    }
    return lines.join('\n');
  }

  static createDefault(): APIDocumentation {
    const docs = new APIDocumentation();
    docs.addEntry({
      packageName: 'core', entityName: 'AgentCore', entityType: 'class',
      description: 'The main agent class that manages lifecycle, events, and configuration.',
      members: [
        { name: 'id', type: 'AgentId', description: 'Unique agent identifier' },
        { name: 'name', type: 'string', description: 'Agent name' },
        { name: 'start()', type: 'Promise<void>', description: 'Start the agent' },
        { name: 'stop()', type: 'Promise<void>', description: 'Stop the agent' },
        { name: 'emit()', type: 'void', description: 'Emit an event' },
      ],
      examples: ['const agent = new AgentCore({ name: "my-agent" });\nawait agent.start();'],
      tags: ['core', 'agent', 'lifecycle'],
    });
    docs.addEntry({
      packageName: 'core', entityName: 'EventBus', entityType: 'class',
      description: 'Event bus for publish-subscribe communication.',
      members: [
        { name: 'emit()', type: 'void', description: 'Emit an event' },
        { name: 'on()', type: '() => void', description: 'Subscribe to an event' },
        { name: 'off()', type: 'void', description: 'Unsubscribe from an event' },
        { name: 'once()', type: '() => void', description: 'Subscribe once' },
      ],
      tags: ['core', 'events', 'pubsub'],
    });
    docs.addEntry({
      packageName: 'pipeline', entityName: 'PipelineEngine', entityType: 'class',
      description: 'Pipeline execution engine with step management and middleware.',
      tags: ['pipeline', 'execution'],
    });
    docs.addEntry({
      packageName: 'plugins', entityName: 'PluginSystem', entityType: 'class',
      description: 'Plugin lifecycle management system.',
      tags: ['plugins', 'lifecycle'],
    });
    docs.addEntry({
      packageName: 'config', entityName: 'ConfigManager', entityType: 'class',
      description: 'Configuration management with validation and hot reload.',
      tags: ['config', 'validation'],
    });
    return docs;
  }
}
