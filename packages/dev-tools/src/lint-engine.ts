// src/lint-engine.ts - 代码检查引擎

export type RuleSeverity = 'error' | 'warning' | 'suggestion' | 'style';

export interface RuleConfig {
  ruleId: string;
  severity?: RuleSeverity;
  options?: Record<string, unknown>;
  enabled?: boolean;
}

export interface LintMessage {
  ruleId: string;
  severity: RuleSeverity;
  message: string;
  line: number;
  column?: number;
  fixable: boolean;
  source?: string;
}

export interface LintResult {
  filePath?: string;
  messages: LintMessage[];
  errorCount: number;
  warningCount: number;
  suggestionCount: number;
  styleCount: number;
}

export interface FixResult {
  code: string;
  fixed: boolean;
  messages: LintMessage[];
  fixesApplied: number;
}

export interface RuleInfo {
  ruleId: string;
  description: string;
  category: RuleSeverity;
  defaultSeverity: RuleSeverity;
  fixable: boolean;
  options?: Record<string, unknown>;
}

export class LintEngine {
  private rules: Map<string, RuleInfo> = new Map();
  private defaultSeverity: RuleSeverity = 'warning';

  constructor() {
    this.registerBuiltInRules();
  }

  private registerBuiltInRules(): void {
    const builtInRules: RuleInfo[] = [
      { ruleId: 'no-unused-vars', description: 'Disallow unused variables', category: 'error', defaultSeverity: 'error', fixable: false },
      { ruleId: 'no-console', description: 'Disallow console statements', category: 'warning', defaultSeverity: 'warning', fixable: false },
      { ruleId: 'prefer-const', description: 'Prefer const over let', category: 'suggestion', defaultSeverity: 'suggestion', fixable: true },
      { ruleId: 'max-line-length', description: 'Enforce maximum line length', category: 'style', defaultSeverity: 'style', fixable: false, options: { max: 80 } },
      { ruleId: 'no-duplicate-keys', description: 'Disallow duplicate keys in objects', category: 'error', defaultSeverity: 'error', fixable: false },
      { ruleId: 'consistent-return', description: 'Require consistent return statements', category: 'warning', defaultSeverity: 'warning', fixable: false },
      { ruleId: 'no-shadow', description: 'Disallow variable shadowing', category: 'warning', defaultSeverity: 'warning', fixable: false },
      { ruleId: 'no-trailing-whitespace', description: 'Disallow trailing whitespace', category: 'style', defaultSeverity: 'style', fixable: true },
      { ruleId: 'no-multiple-empty-lines', description: 'Disallow multiple empty lines', category: 'style', defaultSeverity: 'style', fixable: true, options: { max: 1 } },
      { ruleId: 'indent', description: 'Enforce consistent indentation', category: 'style', defaultSeverity: 'style', fixable: true, options: { style: 'spaces', width: 2 } },
      { ruleId: 'no-var', description: 'Disallow var declarations', category: 'suggestion', defaultSeverity: 'suggestion', fixable: true },
      { ruleId: 'eqeqeq', description: 'Require === instead of ==', category: 'error', defaultSeverity: 'error', fixable: true },
      { ruleId: 'no-undef', description: 'Disallow undefined variables', category: 'error', defaultSeverity: 'error', fixable: false },
      { ruleId: 'no-extra-semi', description: 'Disallow extra semicolons', category: 'style', defaultSeverity: 'style', fixable: true },
      { ruleId: 'curly', description: 'Require curly braces for blocks', category: 'style', defaultSeverity: 'style', fixable: true },
    ];

    for (const rule of builtInRules) {
      this.rules.set(rule.ruleId, rule);
    }
  }

  lint(code: string, language: string, rules?: RuleConfig[]): LintResult {
    const messages: LintMessage[] = [];
    const lines = code.split('\n');
    const effectiveRules = this.resolveRules(rules);

    for (const ruleConfig of effectiveRules) {
      const ruleInfo = this.rules.get(ruleConfig.ruleId);
      if (!ruleInfo || ruleConfig.enabled === false) continue;

      const ruleMessages = this.applyRule(ruleConfig, code, lines, language);
      messages.push(...ruleMessages);
    }

    return {
      messages,
      errorCount: messages.filter(m => m.severity === 'error').length,
      warningCount: messages.filter(m => m.severity === 'warning').length,
      suggestionCount: messages.filter(m => m.severity === 'suggestion').length,
      styleCount: messages.filter(m => m.severity === 'style').length,
    };
  }

  private resolveRules(rules?: RuleConfig[]): RuleConfig[] {
    if (rules && rules.length === 0) {
      return [];
    }

    const ruleMap = new Map<string, RuleConfig>();
    if (rules) {
      for (const r of rules) {
        ruleMap.set(r.ruleId, r);
      }
    }

    // Add defaults for unconfigured rules
    for (const [id, info] of this.rules) {
      if (!ruleMap.has(id)) {
        ruleMap.set(id, { ruleId: id, severity: info.defaultSeverity, enabled: true });
      }
    }

    return Array.from(ruleMap.values()).filter(r => r.enabled !== false);
  }

  private applyRule(ruleConfig: RuleConfig, code: string, lines: string[], language: string): LintMessage[] {
    const messages: LintMessage[] = [];
    const { ruleId, severity = this.defaultSeverity, options = {} } = ruleConfig;

    switch (ruleId) {
      case 'no-console':
        for (let i = 0; i < lines.length; i++) {
          if (/console\.(log|warn|error|info|debug|trace)\s*\(/.test(lines[i])) {
            messages.push({ ruleId, severity, message: `Unexpected console statement on line ${i + 1}`, line: i + 1, fixable: false, source: lines[i] });
          }
        }
        break;

      case 'prefer-const':
        for (let i = 0; i < lines.length; i++) {
          const match = lines[i].match(/\blet\s+(\w+)\s*=/);
          if (match && !lines.slice(i + 1).some(l => l.includes(`${match[1]} =`) || l.includes(`${match[1]}++`) || l.includes(`${match[1]}--`) || l.includes(`++${match[1]}`) || l.includes(`--${match[1]}`))) {
            messages.push({ ruleId, severity, message: `'${match[1]}' is never reassigned, use 'const' instead`, line: i + 1, fixable: true, source: lines[i] });
          }
        }
        break;

      case 'max-line-length': {
        const max = (options.max as number) || 80;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].length > max) {
            messages.push({ ruleId, severity, message: `Line ${i + 1} exceeds maximum length of ${max} (${lines[i].length} chars)`, line: i + 1, fixable: false, source: lines[i] });
          }
        }
        break;
      }

      case 'no-trailing-whitespace':
        for (let i = 0; i < lines.length; i++) {
          if (/[ \t]+$/.test(lines[i])) {
            messages.push({ ruleId, severity, message: `Trailing whitespace on line ${i + 1}`, line: i + 1, fixable: true, source: lines[i] });
          }
        }
        break;

      case 'no-multiple-empty-lines': {
        const maxEmpty = (options.max as number) || 1;
        let emptyCount = 0;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].trim() === '') {
            emptyCount++;
            if (emptyCount > maxEmpty) {
              messages.push({ ruleId, severity, message: `More than ${maxEmpty} empty line(s) at line ${i + 1}`, line: i + 1, fixable: true, source: lines[i] });
            }
          } else {
            emptyCount = 0;
          }
        }
        break;
      }

      case 'no-var':
        for (let i = 0; i < lines.length; i++) {
          if (/\bvar\s+\w/.test(lines[i])) {
            messages.push({ ruleId, severity, message: `Unexpected var, use let or const instead on line ${i + 1}`, line: i + 1, fixable: true, source: lines[i] });
          }
        }
        break;

      case 'eqeqeq':
        for (let i = 0; i < lines.length; i++) {
          if (/[^!=]==[^=]/.test(lines[i]) && !/===/.test(lines[i]) && !/\/\//.test(lines[i].split('==')[0])) {
            messages.push({ ruleId, severity, message: `Expected '===' instead of '==' on line ${i + 1}`, line: i + 1, fixable: true, source: lines[i] });
          }
        }
        break;

      case 'no-extra-semi':
        for (let i = 0; i < lines.length; i++) {
          if (/;;/.test(lines[i])) {
            messages.push({ ruleId, severity, message: `Unnecessary semicolon on line ${i + 1}`, line: i + 1, fixable: true, source: lines[i] });
          }
        }
        break;

      case 'curly':
        for (let i = 0; i < lines.length; i++) {
          if (/\b(if|else|for|while|do)\s*\([^)]*\)\s*(?!{)/.test(lines[i]) && !lines[i].includes('//')) {
            messages.push({ ruleId, severity, message: `Expected curly braces after '${lines[i].match(/\b(if|else|for|while|do)\b/)?.[0]}' on line ${i + 1}`, line: i + 1, fixable: true, source: lines[i] });
          }
        }
        break;

      case 'no-duplicate-keys':
        if (language === 'json' || language === 'javascript' || language === 'typescript') {
          const keyPattern = /["']?(\w+)["']?\s*:/g;
          const keys: string[] = [];
          let m: RegExpExecArray | null;
          for (let i = 0; i < lines.length; i++) {
            keyPattern.lastIndex = 0;
            while ((m = keyPattern.exec(lines[i])) !== null) {
              if (keys.includes(m[1])) {
                messages.push({ ruleId, severity, message: `Duplicate key '${m[1]}' on line ${i + 1}`, line: i + 1, fixable: false, source: lines[i] });
              }
              keys.push(m[1]);
            }
          }
        }
        break;

      case 'no-unused-vars': {
        const declared: string[] = [];
        const used: string[] = [];
        for (const line of lines) {
          const declMatch = line.match(/(?:const|let|var|function)\s+(\w+)/g);
          if (declMatch) {
            for (const d of declMatch) {
              const name = d.replace(/(?:const|let|var|function)\s+/, '');
              declared.push(name);
            }
          }
          // Check usage (simple heuristic)
          for (const name of declared) {
            if (line.includes(name) && !line.match(new RegExp(`(?:const|let|var|function)\\s+.*\\b${name}\\b`))) {
              used.push(name);
            }
          }
        }
        for (const name of declared) {
          const usageCount = lines.filter(l => {
            const regex = new RegExp(`\\b${name}\\b`);
            return regex.test(l);
          }).length;
          if (usageCount <= 1) {
            const lineNum = lines.findIndex(l => l.includes(name)) + 1;
            messages.push({ ruleId, severity, message: `'${name}' is declared but never used`, line: lineNum, fixable: false, source: lines[lineNum - 1] });
          }
        }
        break;
      }

      case 'consistent-return': {
        const fnBlocks = code.split(/\bfunction\b|\b=>\b/);
        for (const block of fnBlocks) {
          const returns = block.match(/\breturn\b/g);
          if (returns && returns.length > 0) {
            const linesInBlock = block.split('\n');
            const lastLine = linesInBlock[linesInBlock.length - 1];
            if (lastLine.trim() !== '' && !lastLine.includes('return') && !lastLine.trim().startsWith('}')) {
              const lineNum = lines.findIndex(l => l.includes(lastLine.trim())) + 1;
              if (lineNum > 0) {
                messages.push({ ruleId, severity, message: 'Function should have consistent return statements', line: lineNum, fixable: false, source: lines[lineNum - 1] });
              }
            }
          }
        }
        break;
      }

      case 'no-shadow': {
        const varNames: Map<string, number> = new Map();
        for (let i = 0; i < lines.length; i++) {
          const match = lines[i].match(/(?:const|let|var|function)\s+(\w+)/);
          if (match) {
            if (varNames.has(match[1])) {
              messages.push({ ruleId, severity, message: `'${match[1]}' shadows a variable declared on line ${varNames.get(match[1])}`, line: i + 1, fixable: false, source: lines[i] });
            }
            varNames.set(match[1], i + 1);
          }
        }
        break;
      }

      case 'no-undef': {
        const defined = new Set<string>();
        for (const line of lines) {
          const declMatch = line.match(/(?:const|let|var|function|class)\s+(\w+)/g);
          if (declMatch) {
            for (const d of declMatch) {
              const name = d.replace(/(?:const|let|var|function|class)\s+/, '');
              defined.add(name);
            }
          }
          // import
          const importMatch = line.match(/import\s+(?:\{[^}]*}|\*\s+as\s+(\w+)|(\w+))\s+from/);
          if (importMatch) {
            if (importMatch[1]) defined.add(importMatch[1]);
            if (importMatch[2]) defined.add(importMatch[2]);
            const namedImports = line.match(/import\s+\{([^}]+)\}/);
            if (namedImports) {
              for (const name of namedImports[1].split(',')) {
                defined.add(name.trim().split(/\s+as\s+/).pop()!.trim());
              }
            }
          }
        }
        // Check for undefined references (simplified)
        const builtins = new Set(['console', 'process', 'Math', 'Date', 'JSON', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Promise', 'Map', 'Set', 'Error', 'RegExp', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'require', 'module', 'exports', 'global', 'Buffer', 'URL', 'fetch', 'Response', 'Request', 'Headers', 'window', 'document']);
        for (let i = 0; i < lines.length; i++) {
          const refs = lines[i].match(/\b([a-zA-Z_$][\w$]*)\b/g);
          if (!refs) continue;
          for (const ref of refs) {
            if (!defined.has(ref) && !builtins.has(ref) && !lines[i].includes(`'${ref}'`) && !lines[i].includes(`"${ref}"`) && !ref.match(/^[A-Z]/) && ref.length > 1) {
              // Only flag if it looks like a variable reference (not a property access target)
              const fullMatch = lines[i].match(new RegExp(`[^.]\\b${ref}\\b`));
              if (fullMatch) {
                messages.push({ ruleId, severity, message: `'${ref}' is not defined`, line: i + 1, fixable: false, source: lines[i] });
                break; // Only one undef per line to avoid noise
              }
            }
          }
        }
        break;
      }

      case 'indent': {
        const style = (options.style as string) || 'spaces';
        const width = (options.width as number) || 2;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.trim() === '') continue;
          const indent = line.match(/^(\s*)/)?.[1] || '';
          if (style === 'spaces' && indent.includes('\t')) {
            messages.push({ ruleId, severity, message: `Expected spaces, found tabs on line ${i + 1}`, line: i + 1, fixable: true, source: lines[i] });
          } else if (style === 'tabs' && indent.includes(' ') && !indent.includes('\t')) {
            messages.push({ ruleId, severity, message: `Expected tabs, found spaces on line ${i + 1}`, line: i + 1, fixable: true, source: lines[i] });
          } else if (style === 'spaces' && indent.length % width !== 0) {
            messages.push({ ruleId, severity, message: `Invalid indentation on line ${i + 1}`, line: i + 1, fixable: true, source: lines[i] });
          }
        }
        break;
      }
    }

    return messages;
  }

  async lintFile(filePath: string): Promise<LintResult> {
    const { readFile } = await import('node:fs/promises');
    const { extname } = await import('node:path');
    const ext = extname(filePath).slice(1);
    const languageMap: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript',
      js: 'javascript', jsx: 'javascript',
      json: 'json', css: 'css', html: 'html', md: 'markdown',
    };
    const language = languageMap[ext] || 'typescript';
    const code = await readFile(filePath, 'utf-8');
    const result = this.lint(code, language);
    result.filePath = filePath;
    return result;
  }

  fix(code: string, rules?: RuleConfig[], language: string = 'typescript'): FixResult {
    let fixedCode = code;
    let fixesApplied = 0;
    const effectiveRules = this.resolveRules(rules);
    const fixableRules = effectiveRules.filter(r => {
      const info = this.rules.get(r.ruleId);
      return info?.fixable;
    });

    // Apply fixes iteratively
    for (const ruleConfig of fixableRules) {
      const before = fixedCode;
      fixedCode = this.applyFix(ruleConfig, fixedCode);
      if (fixedCode !== before) {
        fixesApplied++;
      }
    }

    // Re-lint to get remaining messages
    const result = this.lint(fixedCode, language, effectiveRules);

    return {
      code: fixedCode,
      fixed: fixesApplied > 0,
      messages: result.messages,
      fixesApplied,
    };
  }

  private applyFix(ruleConfig: RuleConfig, code: string): string {
    const { ruleId, options = {} } = ruleConfig;
    let result = code;

    switch (ruleId) {
      case 'no-trailing-whitespace':
        result = result.replace(/[ \t]+$/gm, '');
        break;

      case 'no-multiple-empty-lines': {
        const maxEmpty = (options.max as number) || 1;
        // Replace 3+ consecutive newlines (2+ empty lines) with maxEmpty+1 newlines
        result = result.replace(/\n{3,}/g, '\n'.repeat(maxEmpty + 1));
        break;
      }

      case 'no-var':
        result = result.replace(/\bvar\s+/g, 'const ');
        break;

      case 'eqeqeq':
        result = result.replace(/([^!=])==([^=])/g, '$1===$2');
        break;

      case 'no-extra-semi':
        result = result.replace(/;;/g, ';');
        break;

      case 'prefer-const':
        // Simple heuristic: replace let with const for variables not reassigned
        result = result.replace(/\blet\s+(\w+)\s*=/g, 'const $1 =');
        break;

      case 'indent': {
        const style = (options.style as string) || 'spaces';
        const width = (options.width as number) || 2;
        if (style === 'spaces') {
          result = result.replace(/\t/g, ' '.repeat(width));
        } else {
          result = result.replace(/ {2}/g, '\t');
        }
        break;
      }
    }

    return result;
  }

  getRules(): RuleInfo[] {
    return Array.from(this.rules.values());
  }

  addRule(rule: RuleInfo): void {
    this.rules.set(rule.ruleId, rule);
  }

  removeRule(ruleId: string): boolean {
    return this.rules.delete(ruleId);
  }
}
