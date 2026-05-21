// src/template-engine.ts - Notification Template Engine Module

export interface CompiledTemplate {
  render: (context: Record<string, unknown>) => string;
  template: string;
}

export interface TemplateFunction {
  (args: unknown[]): string;
}

export class NotificationTemplateEngine {
  private templates: Map<string, string> = new Map();
  private functions: Map<string, TemplateFunction> = new Map();
  private locales: Map<string, Map<string, string>> = new Map();
  private currentLocale = 'en';

  constructor() {
    this.registerBuiltinFunctions();
  }

  render(template: string, context: Record<string, unknown>): string {
    let result = template;

    // Process {{#each items}}...{{/each}} blocks first (they internally handle {{#if}} blocks)
    result = this.processEachBlocks(result, context);

    // Process {{#if condition}}...{{/if}} blocks at top level
    result = this.processIfBlocks(result, context);

    // Process {{function arg1 arg2}} calls
    result = this.processFunctionCalls(result, context);

    // Process {{variable}} substitutions
    result = this.processVariables(result, context);

    return result;
  }

  registerTemplate(name: string, template: string): void {
    this.templates.set(name, template);
  }

  getTemplate(name: string): string | undefined {
    // Check locale-specific template first
    const localeKey = `${this.currentLocale}:${name}`;
    const localeTemplate = this.templates.get(localeKey);
    if (localeTemplate) return localeTemplate;

    return this.templates.get(name);
  }

  compile(template: string): CompiledTemplate {
    const engine = this;
    return {
      template,
      render(context: Record<string, unknown>): string {
        return engine.render(template, context);
      },
    };
  }

  registerFunction(name: string, fn: TemplateFunction): void {
    this.functions.set(name, fn);
  }

  setLocale(locale: string): void {
    this.currentLocale = locale;
  }

  registerLocale(locale: string, translations: Map<string, string>): void {
    this.locales.set(locale, translations);
  }

  getLocales(): string[] {
    return Array.from(this.locales.keys());
  }

  private processVariables(template: string, context: Record<string, unknown>): string {
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, key: string) => {
      const value = this.resolveValue(key, context);
      if (value === undefined) {
        const defaultValue = this.getDefaultValue(key, context);
        return defaultValue !== undefined ? String(defaultValue) : '';
      }
      return String(value);
    });
  }

  private resolveValue(key: string, context: Record<string, unknown>): unknown {
    const parts = key.split('.');
    let value: unknown = context;

    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  private getDefaultValue(key: string, context: Record<string, unknown>): unknown {
    const defaults = context._defaults as Record<string, unknown> | undefined;
    if (defaults) {
      return defaults[key];
    }
    return undefined;
  }

  private processIfBlocks(template: string, context: Record<string, unknown>): string {
    const ifRegex = /\{\{#if\s+(\w+(?:\.\w+)*)\}\}([\s\S]*?)\{\{\/if\}\}/g;

    return template.replace(ifRegex, (_match, condition: string, body: string) => {
      const value = this.resolveValue(condition, context);
      return value ? body : '';
    });
  }

  private processEachBlocks(template: string, context: Record<string, unknown>): string {
    const eachRegex = /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g;

    return template.replace(eachRegex, (_match, arrayKey: string, body: string) => {
      const array = context[arrayKey];
      if (!Array.isArray(array)) return '';

      return array.map((item, index) => {
        let itemBody = body;
        const itemContext = typeof item === 'object' ? item as Record<string, unknown> : { value: item };
        const mergedContext = { ...context, ...itemContext, index, '@index': index };

        // Process if blocks within each block
        itemBody = this.processIfBlocks(itemBody, mergedContext);

        // Process variables within each block
        itemBody = itemBody.replace(/\{\{(@?\w+(?:\.\w+)*)\}\}/g, (_m: string, key: string) => {
          const value = this.resolveValue(key, mergedContext);
          return value !== undefined ? String(value) : '';
        });

        return itemBody;
      }).join('');
    });
  }

  private processFunctionCalls(template: string, context: Record<string, unknown>): string {
    // Match function calls: {{funcName arg1 arg2}} or {{funcName}} (no args)
    const funcRegex = /\{\{(\w+)(?:\s+([^}]*))?\}\}/g;

    return template.replace(funcRegex, (_match, funcName: string, argsStr: string | undefined) => {
      const fn = this.functions.get(funcName);
      if (!fn) return _match;

      const args = argsStr ? this.parseFunctionArgs(argsStr, context) : [];
      return fn(args);
    });
  }

  private parseFunctionArgs(argsStr: string, context: Record<string, unknown>): unknown[] {
    const args: string[] = [];
    // Parse respecting quoted strings
    const regex = /"([^"]*)"|\S+/g;
    let match;
    while ((match = regex.exec(argsStr)) !== null) {
      args.push(match[1] !== undefined ? match[1] : match[0]);
    }
    return args.map(arg => {
      if (!isNaN(Number(arg))) {
        return Number(arg);
      }
      // Try to resolve as variable
      const value = this.resolveValue(arg, context);
      return value !== undefined ? value : arg;
    });
  }

  private registerBuiltinFunctions(): void {
    this.functions.set('date', (args) => {
      const date = args[0] instanceof Date ? args[0] as Date : new Date();
      const format = args[1] as string || 'YYYY-MM-DD';
      return this.formatDate(date, format);
    });

    this.functions.set('time', (args) => {
      const date = args[0] instanceof Date ? args[0] as Date : new Date();
      return date.toLocaleTimeString();
    });

    this.functions.set('duration', (args) => {
      const ms = Number(args[0]) || 0;
      const seconds = Math.floor(ms / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      if (hours > 0) return `${hours}h ${minutes % 60}m`;
      if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
      return `${seconds}s`;
    });

    this.functions.set('number', (args) => {
      const num = Number(args[0]) || 0;
      const decimals = Number(args[1]) || 0;
      return num.toFixed(decimals);
    });

    this.functions.set('percent', (args) => {
      const num = Number(args[0]) || 0;
      return `${(num * 100).toFixed(1)}%`;
    });

    this.functions.set('truncate', (args) => {
      const str = String(args[0] || '');
      const len = Number(args[1]) || 50;
      return str.length > len ? str.slice(0, len) + '...' : str;
    });

    this.functions.set('uppercase', (args) => {
      return String(args[0] || '').toUpperCase();
    });

    this.functions.set('lowercase', (args) => {
      return String(args[0] || '').toLowerCase();
    });
  }

  private formatDate(date: Date, format: string): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return format
      .replace('YYYY', String(year))
      .replace('MM', month)
      .replace('DD', day)
      .replace('HH', hours)
      .replace('mm', minutes)
      .replace('ss', seconds);
  }
}
