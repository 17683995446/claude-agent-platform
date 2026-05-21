/**
 * Markdown Generator Module
 * Generates Markdown documentation from the documentation model.
 */

import type { ModuleDoc, ClassDoc, MethodDoc, InterfaceDoc, FunctionDoc } from './doc-model.js';
import type { DocModel } from './doc-model.js';

export class MarkdownGenerator {
  /**
   * Generate documentation for a module.
   */
  generateModule(modDoc: ModuleDoc): string {
    const lines: string[] = [];

    lines.push(`# ${modDoc.name}`);
    lines.push('');
    lines.push(modDoc.description || `Module: ${modDoc.name}`);
    lines.push('');

    if (modDoc.exports.length > 0) {
      lines.push('## Exports');
      lines.push('');
      lines.push(`| Name | Kind |`);
      lines.push(`|------|------|`);
      for (const exp of modDoc.exports) {
        lines.push(`| \`${exp}\` | Export |`);
      }
      lines.push('');
    }

    if (modDoc.classes.length > 0) {
      lines.push('## Classes');
      lines.push('');
      for (const cls of modDoc.classes) {
        lines.push(this.generateClass(cls));
        lines.push('');
      }
    }

    if (modDoc.interfaces.length > 0) {
      lines.push('## Interfaces');
      lines.push('');
      for (const iface of modDoc.interfaces) {
        lines.push(this.generateInterface(iface));
        lines.push('');
      }
    }

    if (modDoc.functions.length > 0) {
      lines.push('## Functions');
      lines.push('');
      for (const fn of modDoc.functions) {
        lines.push(this.generateFunction(fn));
        lines.push('');
      }
    }

    if (modDoc.typeAliases.length > 0) {
      lines.push('## Type Aliases');
      lines.push('');
      for (const ta of modDoc.typeAliases) {
        lines.push(`### ${ta.name}`);
        lines.push('');
        lines.push(`\`\`\`typescript`);
        lines.push(`type ${ta.name}${ta.typeParameters.length > 0 ? `<${ta.typeParameters.join(', ')}>` : ''} = ${ta.type}`);
        lines.push(`\`\`\``);
        lines.push('');
        if (ta.description) {
          lines.push(ta.description);
          lines.push('');
        }
      }
    }

    if (modDoc.enums.length > 0) {
      lines.push('## Enums');
      lines.push('');
      for (const en of modDoc.enums) {
        lines.push(`### ${en.name}`);
        lines.push('');
        if (en.description) {
          lines.push(en.description);
          lines.push('');
        }
        lines.push(`\`\`\`typescript`);
        for (const member of en.members) {
          const val = member.value !== undefined ? ` = ${member.value}` : '';
          lines.push(`${member.name}${val},`);
        }
        lines.push(`\`\`\``);
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate documentation for a class.
   */
  generateClass(classDoc: ClassDoc): string {
    const lines: string[] = [];

    lines.push(`### ${classDoc.name}`);
    lines.push('');

    if (classDoc.description) {
      lines.push(classDoc.description);
      lines.push('');
    }

    // Class signature
    const extendsPart = classDoc.extends ? ` extends ${classDoc.extends}` : '';
    const implementsPart = classDoc.implements.length > 0 ? ` implements ${classDoc.implements.join(', ')}` : '';
    const typeParamsPart = classDoc.typeParameters.length > 0 ? `<${classDoc.typeParameters.join(', ')}>` : '';
    const abstractPart = classDoc.isAbstract ? 'abstract ' : '';

    lines.push(`\`\`\`typescript`);
    lines.push(`${abstractPart}class ${classDoc.name}${typeParamsPart}${extendsPart}${implementsPart}`);
    lines.push(`\`\`\``);
    lines.push('');

    // Properties
    if (classDoc.properties.length > 0) {
      lines.push('#### Properties');
      lines.push('');
      lines.push('| Name | Type | Description |');
      lines.push('|------|------|-------------|');
      for (const prop of classDoc.properties) {
        const optional = prop.isOptional ? '?' : '';
        const readonly = prop.isReadonly ? 'readonly ' : '';
        const static_ = prop.isStatic ? 'static ' : '';
        lines.push(`| \`${static_}${readonly}${prop.name}${optional}\` | \`${prop.type}\` | ${prop.description || '-'} |`);
      }
      lines.push('');
    }

    // Methods
    if (classDoc.methods.length > 0) {
      lines.push('#### Methods');
      lines.push('');
      for (const method of classDoc.methods) {
        lines.push(this.generateMethod(method));
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate documentation for a method.
   */
  generateMethod(methodDoc: MethodDoc): string {
    const lines: string[] = [];

    const asyncPart = methodDoc.isAsync ? 'async ' : '';
    const staticPart = methodDoc.isStatic ? 'static ' : '';
    const abstractPart = methodDoc.isAbstract ? 'abstract ' : '';
    const params = methodDoc.parameters.map((p) => {
      const rest = p.isRest ? '...' : '';
      const optional = p.isOptional ? '?' : '';
      const def = p.defaultValue !== undefined ? ` = ${p.defaultValue}` : '';
      return `${rest}${p.name}${optional}: ${p.type}${def}`;
    }).join(', ');

    lines.push(`##### ${methodDoc.name}`);
    lines.push('');

    if (methodDoc.description) {
      lines.push(methodDoc.description);
      lines.push('');
    }

    lines.push(`\`\`\`typescript`);
    lines.push(`${abstractPart}${staticPart}${asyncPart}${methodDoc.name}(${params}): ${methodDoc.returnType}`);
    lines.push(`\`\`\``);
    lines.push('');

    if (methodDoc.parameters.length > 0) {
      lines.push('**Parameters:**');
      lines.push('');
      lines.push('| Name | Type | Optional | Description |');
      lines.push('|------|------|----------|-------------|');
      for (const param of methodDoc.parameters) {
        lines.push(`| \`${param.name}\` | \`${param.type}\` | ${param.isOptional ? 'Yes' : 'No'} | - |`);
      }
      lines.push('');
    }

    lines.push(`**Returns:** \`${methodDoc.returnType}\``);
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Generate documentation for an interface.
   */
  generateInterface(ifaceDoc: InterfaceDoc): string {
    const lines: string[] = [];

    lines.push(`### ${ifaceDoc.name}`);
    lines.push('');

    if (ifaceDoc.description) {
      lines.push(ifaceDoc.description);
      lines.push('');
    }

    const extendsPart = ifaceDoc.extends.length > 0 ? ` extends ${ifaceDoc.extends.join(', ')}` : '';
    const typeParamsPart = ifaceDoc.typeParameters.length > 0 ? `<${ifaceDoc.typeParameters.join(', ')}>` : '';

    lines.push(`\`\`\`typescript`);
    lines.push(`interface ${ifaceDoc.name}${typeParamsPart}${extendsPart} {`);
    for (const prop of ifaceDoc.properties) {
      const optional = prop.isOptional ? '?' : '';
      const readonly = prop.isReadonly ? 'readonly ' : '';
      lines.push(`  ${readonly}${prop.name}${optional}: ${prop.type};`);
    }
    for (const method of ifaceDoc.methods) {
      const params = method.parameters.map((p) => `${p.name}: ${p.type}`).join(', ');
      lines.push(`  ${method.name}(${params}): ${method.returnType};`);
    }
    lines.push(`}`);
    lines.push(`\`\`\``);
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Generate documentation for a function.
   */
  generateFunction(fnDoc: FunctionDoc): string {
    const lines: string[] = [];

    lines.push(`### ${fnDoc.name}`);
    lines.push('');

    if (fnDoc.description) {
      lines.push(fnDoc.description);
      lines.push('');
    }

    const asyncPart = fnDoc.isAsync ? 'async ' : '';
    const generatorPart = fnDoc.isGenerator ? '*' : '';
    const typeParamsPart = fnDoc.typeParameters.length > 0 ? `<${fnDoc.typeParameters.join(', ')}>` : '';
    const params = fnDoc.parameters.map((p) => {
      const rest = p.isRest ? '...' : '';
      const optional = p.isOptional ? '?' : '';
      const def = p.defaultValue !== undefined ? ` = ${p.defaultValue}` : '';
      return `${rest}${p.name}${optional}: ${p.type}${def}`;
    }).join(', ');

    lines.push(`\`\`\`typescript`);
    lines.push(`${asyncPart}function${generatorPart ? generatorPart + ' ' : ' '}${fnDoc.name}${typeParamsPart}(${params}): ${fnDoc.returnType}`);
    lines.push(`\`\`\``);
    lines.push('');

    if (fnDoc.parameters.length > 0) {
      lines.push('**Parameters:**');
      lines.push('');
      lines.push('| Name | Type | Optional | Default |');
      lines.push('|------|------|----------|---------|');
      for (const param of fnDoc.parameters) {
        lines.push(`| \`${param.name}\` | \`${param.type}\` | ${param.isOptional ? 'Yes' : 'No'} | ${param.defaultValue ?? '-'} |`);
      }
      lines.push('');
    }

    lines.push(`**Returns:** \`${fnDoc.returnType}\``);
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Generate index/table of contents.
   */
  generateIndex(modules: ModuleDoc[]): string {
    const lines: string[] = [];

    lines.push('# API Documentation');
    lines.push('');
    lines.push('## Table of Contents');
    lines.push('');

    for (const mod of modules) {
      lines.push(`- [${mod.name}](./${mod.name}.md)`);
      if (mod.classes.length > 0) {
        for (const cls of mod.classes) {
          lines.push(`  - [\`${cls.name}\`](./${mod.name}.md#${cls.name.toLowerCase()})`);
        }
      }
      if (mod.interfaces.length > 0) {
        for (const iface of mod.interfaces) {
          lines.push(`  - [\`${iface.name}\`](./${mod.name}.md#${iface.name.toLowerCase()})`);
        }
      }
      if (mod.functions.length > 0) {
        for (const fn of mod.functions) {
          lines.push(`  - [\`${fn.name}()\`](./${mod.name}.md#${fn.name.toLowerCase()})`);
        }
      }
    }

    lines.push('');
    return lines.join('\n');
  }

  /**
   * Generate sidebar navigation.
   */
  generateSidebar(modules: ModuleDoc[]): string {
    const lines: string[] = [];

    lines.push('- API Reference');
    for (const mod of modules) {
      lines.push(`  - ${mod.name}`);
      for (const cls of mod.classes) {
        lines.push(`    - ${cls.name}`);
      }
      for (const iface of mod.interfaces) {
        lines.push(`    - ${iface.name}`);
      }
      for (const fn of mod.functions) {
        lines.push(`    - ${fn.name}()`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate complete documentation for all modules.
   */
  generateAll(docModel: DocModel): Map<string, string> {
    const output = new Map<string, string>();
    const modules = docModel.getAllModules();

    output.set('README.md', this.generateIndex(modules));
    output.set('_sidebar.md', this.generateSidebar(modules));

    for (const mod of modules) {
      output.set(`${mod.name}.md`, this.generateModule(mod));
    }

    return output;
  }
}
