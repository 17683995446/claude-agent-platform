// src/naming-analyzer.ts

export type NamingConvention = 'camelCase' | 'PascalCase' | 'snake_case' | 'SCREAMING_SNAKE_CASE' | 'kebab-case';

export type EntityType = 'variable' | 'function' | 'class' | 'interface' | 'constant' | 'file';

export interface NamingConfig {
  conventions: Partial<Record<EntityType, NamingConvention>>;
  minLength?: number;
  maxLength?: number;
  allowSingleLetter?: boolean;
  forbiddenNames?: string[];
  forbiddenPrefixes?: string[];
  forbiddenSuffixes?: string[];
}

export interface NamingIssue {
  name: string;
  entityType: EntityType;
  expectedConvention: NamingConvention;
  actualConvention: NamingConvention | 'unknown';
  message: string;
  suggestion?: string;
}

export interface NamingResult {
  issues: NamingIssue[];
  score: number;
  totalNames: number;
  validNames: number;
  consistencyScore: number;
}

const CONVENTION_PATTERNS: Record<NamingConvention, RegExp> = {
  camelCase: /^[a-z][a-zA-Z0-9]*$/,
  PascalCase: /^[A-Z][a-zA-Z0-9]*$/,
  snake_case: /^[a-z][a-z0-9_]*$/,
  SCREAMING_SNAKE_CASE: /^[A-Z][A-Z0-9_]*$/,
  'kebab-case': /^[a-z][a-z0-9-]*$/,
};

const DEFAULT_CONFIG: NamingConfig = {
  conventions: {
    variable: 'camelCase',
    function: 'camelCase',
    class: 'PascalCase',
    interface: 'PascalCase',
    constant: 'SCREAMING_SNAKE_CASE',
    file: 'kebab-case',
  },
  minLength: 2,
  maxLength: 50,
  allowSingleLetter: false,
  forbiddenNames: ['data', 'info', 'temp', 'tmp', 'obj', 'item', 'result', 'foo', 'bar', 'baz'],
  forbiddenPrefixes: [],
  forbiddenSuffixes: [],
};

export class NamingAnalyzer {
  private config: NamingConfig;

  constructor(config?: NamingConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config, conventions: { ...DEFAULT_CONFIG.conventions, ...config?.conventions } };
  }

  analyze(code: string, config?: NamingConfig): NamingResult {
    const cfg = { ...this.config, ...config, conventions: { ...this.config.conventions, ...config?.conventions } };
    const issues: NamingIssue[] = [];
    const names = this.extractNames(code);
    let validCount = 0;

    for (const { name, entityType } of names) {
      const expected = cfg.conventions[entityType];
      if (!expected) continue;

      const detected = this.detectConvention(name);
      const isCorrect = this.checkConvention(name, entityType, expected, cfg);

      if (!isCorrect) {
        const suggestion = this.suggestAlternative(name, entityType, expected);
        issues.push({
          name,
          entityType,
          expectedConvention: expected,
          actualConvention: detected,
          message: `"${name}" (${entityType}) should use ${expected} but uses ${detected}`,
          suggestion,
        });
      } else {
        validCount++;
      }

      // Check length
      if (name.length < (cfg.minLength || 2) && !(cfg.allowSingleLetter && name.length === 1)) {
        issues.push({
          name,
          entityType,
          expectedConvention: expected,
          actualConvention: detected,
          message: `"${name}" is too short (minimum length: ${cfg.minLength})`,
        });
      }

      if (name.length > (cfg.maxLength || 50)) {
        issues.push({
          name,
          entityType,
          expectedConvention: expected,
          actualConvention: detected,
          message: `"${name}" is too long (maximum length: ${cfg.maxLength})`,
        });
      }

      // Check forbidden names
      if (cfg.forbiddenNames?.includes(name.toLowerCase())) {
        issues.push({
          name,
          entityType,
          expectedConvention: expected,
          actualConvention: detected,
          message: `"${name}" is a forbidden name`,
          suggestion: 'Use a more descriptive name',
        });
      }
    }

    const totalNames = names.length;
    const score = totalNames > 0 ? Math.round((validCount / totalNames) * 10000) / 100 : 100;
    const consistencyScore = this.calculateConsistencyScore(names, cfg);

    return { issues, score, totalNames, validNames: validCount, consistencyScore };
  }

  checkConvention(name: string, entityType: EntityType, expectedConvention: NamingConvention, config?: NamingConfig): boolean {
    const cfg = config || this.config;
    const pattern = CONVENTION_PATTERNS[expectedConvention];
    if (!pattern) return true;

    // Allow single letter for loop variables
    if (cfg.allowSingleLetter && name.length === 1 && (entityType === 'variable' || entityType === 'function')) {
      return true;
    }

    return pattern.test(name);
  }

  suggestName(entityType: EntityType, purpose: string): string[] {
    const words = purpose.split(/[\s_-]+/).filter(w => w.length > 0);
    const suggestions: string[] = [];

    const expected = this.config.conventions[entityType];

    if (expected === 'camelCase') {
      suggestions.push(words.map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(''));
    } else if (expected === 'PascalCase') {
      suggestions.push(words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(''));
    } else if (expected === 'snake_case') {
      suggestions.push(words.map(w => w.toLowerCase()).join('_'));
    } else if (expected === 'SCREAMING_SNAKE_CASE') {
      suggestions.push(words.map(w => w.toUpperCase()).join('_'));
    } else if (expected === 'kebab-case') {
      suggestions.push(words.map(w => w.toLowerCase()).join('-'));
    }

    // Add variations
    if (words.length > 1) {
      suggestions.push(words.map(w => w.toLowerCase()).join(''));
    }

    return suggestions;
  }

  private detectConvention(name: string): NamingConvention | 'unknown' {
    if (CONVENTION_PATTERNS['SCREAMING_SNAKE_CASE'].test(name)) return 'SCREAMING_SNAKE_CASE';
    if (CONVENTION_PATTERNS['snake_case'].test(name)) return 'snake_case';
    if (CONVENTION_PATTERNS['kebab-case'].test(name)) return 'kebab-case';
    if (CONVENTION_PATTERNS['PascalCase'].test(name)) return 'PascalCase';
    if (CONVENTION_PATTERNS['camelCase'].test(name)) return 'camelCase';
    return 'unknown';
  }

  private extractNames(code: string): Array<{ name: string; entityType: EntityType }> {
    const names: Array<{ name: string; entityType: EntityType }> = [];

    // Classes
    const classMatches = code.match(/\bclass\s+(\w+)/g) || [];
    for (const m of classMatches) {
      const name = m.replace('class ', '');
      names.push({ name, entityType: 'class' });
    }

    // Interfaces
    const interfaceMatches = code.match(/\binterface\s+(\w+)/g) || [];
    for (const m of interfaceMatches) {
      const name = m.replace('interface ', '');
      names.push({ name, entityType: 'interface' });
    }

    // Functions
    const funcMatches = code.match(/\bfunction\s+(\w+)/g) || [];
    for (const m of funcMatches) {
      const name = m.replace('function ', '');
      names.push({ name, entityType: 'function' });
    }

    // Constants (SCREAMING_SNAKE_CASE)
    const constMatches = code.match(/(?:const|let|var)\s+([A-Z][A-Z0-9_]*)\s*=/g) || [];
    for (const m of constMatches) {
      const nameMatch = m.match(/(?:const|let|var)\s+([A-Z][A-Z0-9_]*)\s*=/);
      if (nameMatch) {
        names.push({ name: nameMatch[1], entityType: 'constant' });
      }
    }

    // Variables (camelCase)
    const varMatches = code.match(/(?:const|let|var)\s+([a-z][a-zA-Z0-9]*)\s*=/g) || [];
    for (const m of varMatches) {
      const nameMatch = m.match(/(?:const|let|var)\s+([a-z][a-zA-Z0-9]*)\s*=/);
      if (nameMatch) {
        names.push({ name: nameMatch[1], entityType: 'variable' });
      }
    }

    return names;
  }

  private suggestAlternative(name: string, entityType: EntityType, expected: NamingConvention): string {
    // Split name into words
    const words = name.split(/(?=[A-Z])|[_\-\s]+/).filter(w => w.length > 0).map(w => w.toLowerCase());

    if (expected === 'camelCase') {
      return words.map((w, i) => i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)).join('');
    } else if (expected === 'PascalCase') {
      return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
    } else if (expected === 'snake_case') {
      return words.join('_');
    } else if (expected === 'SCREAMING_SNAKE_CASE') {
      return words.join('_').toUpperCase();
    } else if (expected === 'kebab-case') {
      return words.join('-');
    }
    return name;
  }

  private calculateConsistencyScore(names: Array<{ name: string; entityType: EntityType }>, config: NamingConfig): number {
    if (names.length === 0) return 100;

    let consistent = 0;
    for (const { name, entityType } of names) {
      const expected = config.conventions[entityType];
      if (expected && this.checkConvention(name, entityType, expected, config)) {
        consistent++;
      }
    }

    return Math.round((consistent / names.length) * 10000) / 100;
  }
}
