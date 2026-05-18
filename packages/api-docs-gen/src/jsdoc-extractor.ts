/**
 * JSDoc Extractor Module
 * Extracts and parses JSDoc comments from TypeScript AST nodes.
 */

// --- Types ---

export interface JSDocData {
  description: string;
  summary: string;
  tags: JSDocTag[];
  examples: ExampleInfo[];
  params: ParamInfo[];
  returns: ReturnInfo[];
  throws: string[];
  deprecated: string | false;
  since: string;
  see: string[];
  category: string;
  internal: boolean;
}

export interface JSDocTag {
  name: string;
  value: string;
  raw: string;
}

export interface ParamInfo {
  name: string;
  type: string;
  description: string;
  optional: boolean;
  defaultValue?: string;
}

export interface ReturnInfo {
  type: string;
  description: string;
}

export interface ExampleInfo {
  caption: string;
  code: string;
  language: string;
}

// --- Extractor ---

export class JSDocExtractor {
  /**
   * Extract JSDoc from an AST node.
   */
  extractJSDoc(node: { jsdoc?: string }): JSDocData | null {
    if (!node.jsdoc) return null;
    return this.parseJSDocComment(node.jsdoc);
  }

  /**
   * Parse JSDoc text into structured data.
   */
  parseJSDocComment(comment: string): JSDocData {
    const lines = comment.split('\n');
    const cleanedLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.replace(/^\s*\*\s?/, '').replace(/^\/\*\*/, '').replace(/\*\/$/, '');
      cleanedLines.push(trimmed);
    }

    const fullText = cleanedLines.join('\n').trim();
    const { description, tags } = this.separateDescriptionAndTags(cleanedLines);

    const jsdoc: JSDocData = {
      description,
      summary: description.split('\n')[0] ?? '',
      tags: [],
      examples: [],
      params: [],
      returns: [],
      throws: [],
      deprecated: false,
      since: '',
      see: [],
      category: '',
      internal: false,
    };

    for (const tag of tags) {
      jsdoc.tags.push(tag);
      this.processTag(tag, jsdoc);
    }

    return jsdoc;
  }

  /**
   * Extract specific tags from parsed JSDoc data.
   */
  extractTags(jsdoc: JSDocData): {
    params: ParamInfo[];
    returns: ReturnInfo[];
    throws: string[];
    examples: ExampleInfo[];
    deprecated: string | false;
    since: string;
    see: string[];
  } {
    return {
      params: jsdoc.params,
      returns: jsdoc.returns,
      throws: jsdoc.throws,
      examples: jsdoc.examples,
      deprecated: jsdoc.deprecated,
      since: jsdoc.since,
      see: jsdoc.see,
    };
  }

  /**
   * Extract type information from JSDoc.
   */
  extractTypeFromJSDoc(jsdoc: JSDocData): Map<string, string> {
    const types = new Map<string, string>();
    for (const param of jsdoc.params) {
      if (param.type) {
        types.set(param.name, param.type);
      }
    }
    for (const ret of jsdoc.returns) {
      if (ret.type) {
        types.set('@return', ret.type);
      }
    }
    return types;
  }

  /**
   * Resolve type references using imports.
   */
  resolveTypeReferences(types: Map<string, string>, imports: Array<{ source: string; specifiers: string[] }>): Map<string, string> {
    const resolved = new Map<string, string>();
    for (const [name, type] of types) {
      let resolvedType = type;
      for (const imp of imports) {
        for (const spec of imp.specifiers) {
          if (type === spec || type.startsWith(spec + '<') || type.startsWith(spec + '.')) {
            resolvedType = resolvedType.replace(spec, `${imp.source}.${spec}`);
          }
        }
      }
      resolved.set(name, resolvedType);
    }
    return resolved;
  }

  // --- Internal helpers ---

  private separateDescriptionAndTags(lines: string[]): { description: string; tags: JSDocTag[] } {
    const descLines: string[] = [];
    const tags: JSDocTag[] = [];
    let inExample = false;
    let exampleLines: string[] = [];
    let exampleCaption = '';

    for (const line of lines) {
      const tagMatch = line.match(/^@(\w+)\s*(.*)/);
      if (tagMatch && !inExample) {
        const tagName = tagMatch[1]!;
        const tagValue = tagMatch[2] ?? '';

        if (tagName === 'example') {
          inExample = true;
          exampleCaption = tagValue;
          exampleLines = [];
        } else {
          tags.push({
            name: tagName,
            value: tagValue,
            raw: line,
          });
        }
      } else if (inExample) {
        if (line.trim() === '*/' || line.trim() === '/' || line.match(/^@\w/)) {
          inExample = false;
          tags.push({
            name: 'example',
            value: `${exampleCaption}\n${exampleLines.join('\n')}`.trim(),
            raw: `@example ${exampleCaption}\n${exampleLines.join('\n')}`.trim(),
          });
          exampleLines = [];

          // Re-process this line as it might be a new tag
          const newTagMatch = line.match(/^@(\w+)\s*(.*)/);
          if (newTagMatch) {
            tags.push({
              name: newTagMatch[1]!,
              value: newTagMatch[2] ?? '',
              raw: line,
            });
          }
        } else {
          exampleLines.push(line);
        }
      } else {
        descLines.push(line);
      }
    }

    // Handle example at end of comment
    if (inExample && exampleLines.length > 0) {
      tags.push({
        name: 'example',
        value: `${exampleCaption}\n${exampleLines.join('\n')}`.trim(),
        raw: `@example ${exampleCaption}\n${exampleLines.join('\n')}`.trim(),
      });
    }

    return {
      description: descLines.join('\n').trim(),
      tags,
    };
  }

  private processTag(tag: JSDocTag, jsdoc: JSDocData): void {
    switch (tag.name) {
      case 'param':
      case 'arg':
      case 'argument': {
        const param = this.parseParamTag(tag.value);
        if (param) jsdoc.params.push(param);
        break;
      }
      case 'returns':
      case 'return': {
        const ret = this.parseReturnTag(tag.value);
        if (ret) jsdoc.returns.push(ret);
        break;
      }
      case 'throws':
      case 'throw':
      case 'exception':
        jsdoc.throws.push(tag.value.trim());
        break;
      case 'example': {
        const example = this.parseExampleTag(tag.value);
        if (example) jsdoc.examples.push(example);
        break;
      }
      case 'deprecated':
        jsdoc.deprecated = tag.value.trim() || true;
        break;
      case 'since':
        jsdoc.since = tag.value.trim();
        break;
      case 'see':
        jsdoc.see.push(tag.value.trim());
        break;
      case 'category':
        jsdoc.category = tag.value.trim();
        break;
      case 'internal':
        jsdoc.internal = true;
        break;
    }
  }

  private parseParamTag(value: string): ParamInfo | null {
    // Formats: {type} name - desc, {type} name desc, {type} [name] - desc, name - desc, name desc
    const typedMatch = value.match(/^\{([^}]+)\}\s+(\[?\w+\]?)\s*(?:-\s*(.*))?\s*$/);
    if (typedMatch) {
      return {
        name: typedMatch[2]!.replace(/[\[\]]/g, ''),
        type: typedMatch[1]!,
        description: typedMatch[3]?.trim() ?? '',
        optional: typedMatch[2]!.startsWith('['),
      };
    }

    // Try typed with space-separated description (no dash)
    const typedNoDash = value.match(/^\{([^}]+)\}\s+(\[?\w+\]?)\s+(.+)$/);
    if (typedNoDash) {
      return {
        name: typedNoDash[2]!.replace(/[\[\]]/g, ''),
        type: typedNoDash[1]!,
        description: typedNoDash[3]?.trim() ?? '',
        optional: typedNoDash[2]!.startsWith('['),
      };
    }

    const withDash = value.match(/^(\[?\w+\]?)\s*-\s*(.*)$/);
    if (withDash) {
      return {
        name: withDash[1]!.replace(/[\[\]]/g, ''),
        type: '',
        description: withDash[2]?.trim() ?? '',
        optional: withDash[1]!.startsWith('['),
      };
    }

    const simpleMatch = value.match(/^(\[?\w+\]?)\s+(.*)$/);
    if (simpleMatch) {
      return {
        name: simpleMatch[1]!.replace(/[\[\]]/g, ''),
        type: '',
        description: simpleMatch[2]?.trim() ?? '',
        optional: simpleMatch[1]!.startsWith('['),
      };
    }

    const nameOnly = value.match(/^(\[?\w+\]?)$/);
    if (nameOnly) {
      return {
        name: nameOnly[1]!.replace(/[\[\]]/g, ''),
        type: '',
        description: '',
        optional: nameOnly[1]!.startsWith('['),
      };
    }

    return null;
  }

  private parseReturnTag(value: string): ReturnInfo | null {
    const typedMatch = value.match(/^\{([^}]+)\}\s*(.*)$/);
    if (typedMatch) {
      return {
        type: typedMatch[1]!,
        description: typedMatch[2]?.trim() ?? '',
      };
    }
    if (value.trim()) {
      return {
        type: '',
        description: value.trim(),
      };
    }
    return null;
  }

  private parseExampleTag(value: string): ExampleInfo | null {
    const lines = value.split('\n');
    const firstLine = lines[0]?.trim() ?? '';
    const rest = lines.slice(1).join('\n').trim();

    if (!value.trim()) return null;

    // If the first line looks like a description (short, no special chars), treat as caption
    const isCaption = firstLine.length < 60 && !firstLine.includes('(') && !firstLine.includes('{') &&
      !firstLine.includes(';') && !firstLine.includes('=') && !firstLine.includes('=>') &&
      !firstLine.startsWith('const ') && !firstLine.startsWith('let ') && !firstLine.startsWith('var ') &&
      !firstLine.startsWith('function ') && !firstLine.startsWith('class ') && !firstLine.startsWith('import ') &&
      !firstLine.startsWith('if ') && !firstLine.startsWith('for ') && !firstLine.startsWith('while ');

    const caption = isCaption ? firstLine : '';
    const code = isCaption ? rest : value.trim();

    if (!code && !caption) return null;

    let language = 'typescript';
    if (caption.toLowerCase().includes('javascript')) language = 'javascript';
    else if (caption.toLowerCase().includes('json')) language = 'json';
    else if (caption.toLowerCase().includes('html')) language = 'html';
    else if (caption.toLowerCase().includes('css')) language = 'css';
    else if (caption.toLowerCase().includes('bash') || caption.toLowerCase().includes('shell')) language = 'bash';

    return {
      caption,
      code,
      language,
    };
  }
}
