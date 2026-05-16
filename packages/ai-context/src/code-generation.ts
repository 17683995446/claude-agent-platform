// ============================================================
// Module 7: Code Generation Assistant
// Templates, completion, transformation, test generation
// ============================================================

export interface GenerationParams {
  name?: string;
  parameters?: string[];
  returnType?: string;
  body?: string;
  language?: string;
  description?: string;
  [key: string]: unknown;
}

export interface GeneratedCode {
  code: string;
  language: string;
  description: string;
  template: string;
}

export interface CodeContext {
  prefix: string;
  suffix: string;
  language: string;
  cursorPosition?: number;
}

export interface CompletionSuggestion {
  text: string;
  confidence: number;
  type: 'statement' | 'expression' | 'block' | 'import';
}

export interface TransformResult {
  original: string;
  transformed: string;
  changes: string[];
  pattern: string;
}

export class CodeGenerationAssistant {
  private templates: Map<string, (params: GenerationParams) => string> = new Map();

  constructor() {
    this.registerDefaultTemplates();
  }

  generate(template: string, params: GenerationParams): GeneratedCode {
    const generator = this.templates.get(template);
    const language = params.language || 'typescript';

    if (generator) {
      const code = generator(params);
      return {
        code,
        language,
        description: params.description || `Generated ${template}`,
        template,
      };
    }

    // Fallback: generic template
    const code = this.genericTemplate(template, params);
    return {
      code,
      language,
      description: params.description || `Generated ${template}`,
      template,
    };
  }

  complete(context: CodeContext): CompletionSuggestion[] {
    const suggestions: CompletionSuggestion[] = [];
    const { prefix, suffix, language } = context;

    // Analyze the prefix to determine what kind of completion is needed
    const trimmedPrefix = prefix.trimEnd();

    // Import completion
    if (trimmedPrefix.match(/^import\s/)) {
      suggestions.push({
        text: `import { ${this.guessImportName(suffix, language)} } from './module';`,
        confidence: 0.7,
        type: 'import',
      });
    }

    // Function completion
    if (trimmedPrefix.endsWith('(') || trimmedPrefix.match(/\w+\s*\(\s*$/)) {
      suggestions.push({
        text: this.completeFunction(prefix, suffix, language),
        confidence: 0.8,
        type: 'statement',
      });
    }

    // Block completion
    if (trimmedPrefix.endsWith('{') || trimmedPrefix.match(/(if|for|while|class)\s*[\s({]*$/)) {
      suggestions.push({
        text: this.completeBlock(prefix, language),
        confidence: 0.75,
        type: 'block',
      });
    }

    // Expression completion
    if (trimmedPrefix.match(/=\s*$/) || trimmedPrefix.endsWith('return ')) {
      suggestions.push({
        text: this.completeExpression(suffix, language),
        confidence: 0.6,
        type: 'expression',
      });
    }

    // If no specific pattern matched, provide general suggestions
    if (suggestions.length === 0) {
      suggestions.push({
        text: '// TODO: implement',
        confidence: 0.3,
        type: 'statement',
      });
    }

    return suggestions;
  }

  transform(code: string, pattern: string): TransformResult {
    const changes: string[] = [];
    let transformed = code;

    switch (pattern) {
      case 'arrow-function':
        transformed = this.convertToArrowFunction(code);
        changes.push('Converted to arrow function');
        break;
      case 'const':
        transformed = code.replace(/\bvar\b/g, 'const').replace(/\blet\b/g, 'const');
        changes.push('Replaced var/let with const');
        break;
      case 'async-await':
        transformed = this.convertToAsyncAwait(code);
        changes.push('Converted callbacks to async/await');
        break;
      case 'template-literal':
        transformed = this.convertToTemplateLiteral(code);
        changes.push('Converted string concatenation to template literals');
        break;
      case 'destructuring':
        transformed = this.convertToDestructuring(code);
        changes.push('Applied destructuring pattern');
        break;
      default:
        changes.push(`Unknown pattern: ${pattern}`);
    }

    return { original: code, transformed, changes, pattern };
  }

  generateTests(code: string, language: string): GeneratedCode {
    const functionName = this.extractFunctionName(code);
    const params = this.extractParameterNames(code);
    const testFramework = language === 'python' ? 'pytest' : 'bun:test';

    let testCode: string;

    if (language === 'python') {
      testCode = this.generatePythonTests(code, functionName, params);
    } else {
      testCode = this.generateJSTests(code, functionName, params, testFramework);
    }

    return {
      code: testCode,
      language,
      description: `Unit tests for ${functionName || 'code'}`,
      template: 'unit_test',
    };
  }

  registerTemplate(name: string, generator: (params: GenerationParams) => string): void {
    this.templates.set(name, generator);
  }

  private registerDefaultTemplates(): void {
    // Function template
    this.templates.set('function', (params) => {
      const name = params.name || 'myFunction';
      const returnType = params.returnType || 'void';
      const parameters = (params.parameters || []).map(p => `${p}: unknown`).join(', ');
      const body = params.body || '// TODO: implement';
      return `function ${name}(${parameters}): ${returnType} {\n  ${body}\n}\n`;
    });

    // Class template
    this.templates.set('class', (params) => {
      const name = params.name || 'MyClass';
      const body = params.body || '';
      return `class ${name} {\n  constructor() {\n    ${body || '// initialize'}\n  }\n\n  ${body ? '' : '// Add methods here'}\n}\n`;
    });

    // Interface template
    this.templates.set('interface', (params) => {
      const name = params.name || 'MyInterface';
      const props = params.parameters || [];
      const properties = props.map(p => `  ${p}: unknown;`).join('\n');
      return `interface ${name} {\n${properties}\n}\n`;
    });

    // Test template
    this.templates.set('test', (params) => {
      const name = params.name || 'myFunction';
      return `import { describe, test, expect } from 'bun:test';\n\ndescribe('${name}', () => {\n  test('should work correctly', () => {\n    // Arrange\n    const input = {};\n\n    // Act\n    const result = ${name}(input);\n\n    // Assert\n    expect(result).toBeDefined();\n  });\n});\n`;
    });

    // API endpoint template
    this.templates.set('api-endpoint', (params) => {
      const name = params.name || 'myEndpoint';
      const method = (params.parameters?.[0] || 'GET').toUpperCase();
      return `app.${method.toLowerCase()}('/api/${name}', async (req, res) => {\n  try {\n    const { params } = req;\n    // TODO: implement handler\n    res.json({ success: true });\n  } catch (error) {\n    res.status(500).json({ error: 'Internal server error' });\n  }\n});\n`;
    });

    // Component template
    this.templates.set('component', (params) => {
      const name = params.name || 'MyComponent';
      return `export function ${name}({ children }: { children?: React.ReactNode }) {\n  return (\n    <div className="${name.toLowerCase()}">\n      {children}\n    </div>\n  );\n}\n`;
    });
  }

  private genericTemplate(template: string, params: GenerationParams): string {
    const name = params.name || template;
    const body = params.body || `// ${template} implementation`;
    return `// Template: ${template}\n// ${params.description || ''}\n\n${body}\n`;
  }

  private guessImportName(suffix: string, language: string): string {
    if (suffix.length > 0) {
      const match = suffix.match(/(\w+)/);
      if (match) return match[1];
    }
    return 'default';
  }

  private completeFunction(prefix: string, suffix: string, language: string): string {
    return `${suffix.split('\n')[0] || 'arg'}: unknown) {\n  // TODO: implement\n}`;
  }

  private completeBlock(prefix: string, language: string): string {
    return '\n  // TODO: implement\n}';
  }

  private completeExpression(suffix: string, language: string): string {
    return 'null;';
  }

  private convertToArrowFunction(code: string): string {
    const funcMatch = code.match(/function\s+(\w+)\s*\(([^)]*)\)\s*\{/);
    if (!funcMatch) return code;
    const [, name, params] = funcMatch;
    const body = code.slice(code.indexOf('{') + 1, code.lastIndexOf('}')).trim();
    return `const ${name} = (${params}) => {\n  ${body}\n};`;
  }

  private convertToAsyncAwait(code: string): string {
    return code
      .replace(/\.then\(\s*(?:function\s*)?\((\w*)\)\s*=>\s*\{/g, 'const $1 = await ')
      .replace(/\.then\(\s*(\w+)\s*\)/g, 'await $1')
      .replace(/(\bfunction\s+\w+\s*\([^)]*\))\s*\{/g, 'async $1 {');
  }

  private convertToTemplateLiteral(code: string): string {
    return code.replace(/"([^"]*"\s*\+\s*\w+[^"]*)"/g, (match) => {
      return '`' + match.slice(1, -1).replace(/"\s*\+\s*/g, '${') + '}`';
    });
  }

  private convertToDestructuring(code: string): string {
    const objMatch = code.match(/(?:const|let|var)\s+(\w+)\s*=\s*(\w+)\.(\w+);/);
    if (objMatch) {
      const [, varName, objName, prop] = objMatch;
      return code.replace(objMatch[0], `const { ${prop}: ${varName} } = ${objName};`);
    }
    return code;
  }

  private extractFunctionName(code: string): string {
    const match = code.match(/(?:function\s+|const\s+|let\s+|var\s+)(\w+)/);
    return match ? match[1] : 'unknown';
  }

  private extractParameterNames(code: string): string[] {
    const match = code.match(/(?:function\s+\w+|=>)\s*\(([^)]*)\)/);
    if (!match) return [];
    return match[1].split(',').map(p => p.trim().split(':')[0].split('=')[0].trim()).filter(Boolean);
  }

  private generateJSTests(code: string, functionName: string, params: string[], framework: string): string {
    const testCases = [
      { name: 'should handle valid input', input: '{}' },
      { name: 'should handle empty input', input: 'null' },
      { name: 'should handle edge cases', input: 'undefined' },
    ];

    const tests = testCases.map(tc =>
      `  test('${tc.name}', () => {\n    const result = ${functionName}(${tc.input});\n    expect(result).toBeDefined();\n  });`
    ).join('\n\n');

    return `import { describe, test, expect } from '${framework}';\n\ndescribe('${functionName}', () => {\n${tests}\n});\n`;
  }

  private generatePythonTests(code: string, functionName: string, params: string[]): string {
    return `import pytest\n\nclass Test${functionName.charAt(0).toUpperCase() + functionName.slice(1)}:\n    def test_valid_input(self):\n        result = ${functionName}()\n        assert result is not None\n\n    def test_edge_cases(self):\n        result = ${functionName}()\n        assert result is not None\n`;
  }
}
