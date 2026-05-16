// src/code-smell-detector.ts

export interface SmellResult {
  type: string;
  name: string;
  category: SmellCategory;
  severity: Severity;
  line: number;
  endLine?: number;
  message: string;
  suggestion?: string;
}

export type SmellCategory = 'bloaters' | 'object-orientation_abusers' | 'change_preventers' | 'dispensables' | 'couplers';

export type Severity = 'info' | 'warning' | 'error' | 'critical';

export interface SmellSummary {
  total: number;
  byCategory: Record<SmellCategory, number>;
  bySeverity: Record<Severity, number>;
  mostCommon: string;
}

interface SmellRule {
  name: string;
  category: SmellCategory;
  severity: Severity;
  detect: (code: string, lines: string[]) => SmellResult[];
}

const SMELL_RULES: SmellRule[] = [
  {
    name: 'Long Method',
    category: 'bloaters',
    severity: 'warning',
    detect: (code, lines) => {
      const results: SmellResult[] = [];
      const funcRegex = /(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))/g;
      let match;
      while ((match = funcRegex.exec(code)) !== null) {
        const startLine = code.substring(0, match.index).split('\n').length;
        // Find end of function
        let braceCount = 0;
        let foundOpen = false;
        let endLine = startLine;
        for (let i = startLine - 1; i < lines.length; i++) {
          for (const ch of lines[i]) {
            if (ch === '{') { braceCount++; foundOpen = true; }
            if (ch === '}') braceCount--;
          }
          if (foundOpen && braceCount <= 0) { endLine = i + 1; break; }
        }
        const methodLength = endLine - startLine + 1;
        if (methodLength > 20) {
          results.push({
            type: 'Long Method',
            name: 'Long Method',
            category: 'bloaters',
            severity: 'warning',
            line: startLine,
            endLine,
            message: `Method is ${methodLength} lines long (threshold: 20)`,
            suggestion: 'Break this method into smaller, focused methods',
          });
        }
      }
      return results;
    },
  },
  {
    name: 'Large Class',
    category: 'bloaters',
    severity: 'warning',
    detect: (code, lines) => {
      const results: SmellResult[] = [];
      const classRegex = /\bclass\s+(\w+)/g;
      let match;
      while ((match = classRegex.exec(code)) !== null) {
        const startLine = code.substring(0, match.index).split('\n').length;
        let braceCount = 0;
        let foundOpen = false;
        let endLine = startLine;
        for (let i = startLine - 1; i < lines.length; i++) {
          for (const ch of lines[i]) {
            if (ch === '{') { braceCount++; foundOpen = true; }
            if (ch === '}') braceCount--;
          }
          if (foundOpen && braceCount <= 0) { endLine = i + 1; break; }
        }
        const classLength = endLine - startLine + 1;
        if (classLength > 200) {
          results.push({
            type: 'Large Class',
            name: 'Large Class',
            category: 'bloaters',
            severity: 'warning',
            line: startLine,
            endLine,
            message: `Class is ${classLength} lines long (threshold: 200)`,
            suggestion: 'Split this class into smaller, single-responsibility classes',
          });
        }
      }
      return results;
    },
  },
  {
    name: 'Long Parameter List',
    category: 'bloaters',
    severity: 'info',
    detect: (code) => {
      const results: SmellResult[] = [];
      const funcRegex = /\b(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))\s*\(([^)]*)\)/g;
      let match;
      while ((match = funcRegex.exec(code)) !== null) {
        const params = match[1].split(',').filter(p => p.trim().length > 0);
        if (params.length > 4) {
          const line = code.substring(0, match.index).split('\n').length;
          results.push({
            type: 'Long Parameter List',
            name: 'Long Parameter List',
            category: 'bloaters',
            severity: 'info',
            line,
            message: `Function has ${params.length} parameters (threshold: 4)`,
            suggestion: 'Consider using an options object or builder pattern',
          });
        }
      }
      return results;
    },
  },
  {
    name: 'Feature Envy',
    category: 'couplers',
    severity: 'warning',
    detect: (code) => {
      const results: SmellResult[] = [];
      const lines = code.split('\n');
      lines.forEach((line, i) => {
        // Count member access chains (e.g., obj.a.b.c counts as deep access)
        const memberAccess = (line.match(/\.\w+/g) || []).length;
        if (memberAccess > 3) {
          results.push({
            type: 'Feature Envy',
            name: 'Feature Envy',
            category: 'couplers',
            severity: 'warning',
            line: i + 1,
            message: `Line has ${memberAccess} member accesses (threshold: 3)`,
            suggestion: 'Consider moving this logic to the class it accesses most',
          });
        }
      });
      return results;
    },
  },
  {
    name: 'Switch Statements',
    category: 'object-orientation_abusers',
    severity: 'info',
    detect: (code) => {
      const results: SmellResult[] = [];
      const switchRegex = /\bswitch\s*\(/g;
      let match;
      while ((match = switchRegex.exec(code)) !== null) {
        const line = code.substring(0, match.index).split('\n').length;
        results.push({
          type: 'Switch Statements',
          name: 'Switch Statements',
          category: 'object-orientation_abusers',
          severity: 'info',
          line,
          message: 'Switch statement detected',
          suggestion: 'Consider using polymorphism or a strategy pattern',
        });
      }
      return results;
    },
  },
  {
    name: 'Dead Code',
    category: 'dispensables',
    severity: 'warning',
    detect: (code) => {
      const results: SmellResult[] = [];
      const lines = code.split('\n');
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        // Detect unreachable return patterns
        if (trimmed.includes('return') && i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();
          if (nextLine.includes('return') && !nextLine.startsWith('}') && !nextLine.startsWith('//')) {
            results.push({
              type: 'Dead Code',
              name: 'Dead Code',
              category: 'dispensables',
              severity: 'warning',
              line: i + 2,
              message: 'Potentially unreachable code after return statement',
              suggestion: 'Remove unreachable code',
            });
          }
        }
      });
      return results;
    },
  },
  {
    name: 'Excessive Comments',
    category: 'dispensables',
    severity: 'info',
    detect: (code) => {
      const results: SmellResult[] = [];
      const lines = code.split('\n');
      let consecutiveComments = 0;
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
          consecutiveComments++;
          if (consecutiveComments > 5) {
            results.push({
              type: 'Excessive Comments',
              name: 'Excessive Comments',
              category: 'dispensables',
              severity: 'info',
              line: i + 1,
              message: 'Excessive block of comments detected',
              suggestion: 'Consider if the code itself can be made more self-documenting',
            });
          }
        } else {
          consecutiveComments = 0;
        }
      });
      return results;
    },
  },
  {
    name: 'Data Clumps',
    category: 'bloaters',
    severity: 'info',
    detect: (code) => {
      const results: SmellResult[] = [];
      const paramLists: string[] = [];
      const funcRegex = /\(([^)]{10,})\)/g;
      let match;
      while ((match = funcRegex.exec(code)) !== null) {
        const params = match[1].split(',').map(p => p.trim()).filter(p => p.length > 0);
        if (params.length >= 3) {
          paramLists.push(params.join(','));
        }
      }
      // Check for duplicate parameter groups
      const seen = new Map<string, number>();
      for (const pl of paramLists) {
        if (seen.has(pl)) {
          const line = seen.get(pl)!;
          results.push({
            type: 'Data Clumps',
            name: 'Data Clumps',
            category: 'bloaters',
            severity: 'info',
            line,
            message: 'Same group of parameters appears in multiple functions',
            suggestion: 'Consider creating a class or type to encapsulate these parameters',
          });
        } else {
          const line = code.substring(0, code.indexOf(pl)).split('\n').length;
          seen.set(pl, line);
        }
      }
      return results;
    },
  },
  {
    name: 'Primitive Obsession',
    category: 'object-orientation_abusers',
    severity: 'info',
    detect: (code) => {
      const results: SmellResult[] = [];
      const lines = code.split('\n');
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        // Detect string/number used as type identifiers
        if ((trimmed.includes("=== '") || trimmed.includes("=== \"") || trimmed.includes("=== `")) &&
            (trimmed.includes('if') || trimmed.includes('switch') || trimmed.includes('case'))) {
          results.push({
            type: 'Primitive Obsession',
            name: 'Primitive Obsession',
            category: 'object-orientation_abusers',
            severity: 'info',
            line: i + 1,
            message: 'String literal used as type identifier',
            suggestion: 'Consider using an enum or class instead of primitive types',
          });
        }
      });
      return results;
    },
  },
  {
    name: 'Duplicate Code',
    category: 'change_preventers',
    severity: 'warning',
    detect: (code) => {
      const results: SmellResult[] = [];
      const lines = code.split('\n').map(l => l.trim()).filter(l => l.length > 10);
      const seen = new Map<string, number>();
      for (let i = 0; i < lines.length; i++) {
        if (seen.has(lines[i])) {
          results.push({
            type: 'Duplicate Code',
            name: 'Duplicate Code',
            category: 'change_preventers',
            severity: 'warning',
            line: i + 1,
            message: `Duplicate of line ${seen.get(lines[i])}`,
            suggestion: 'Extract the duplicated code into a shared function',
          });
        } else {
          seen.set(lines[i], i + 1);
        }
      }
      return results;
    },
  },
];

export class CodeSmellDetector {
  detect(code: string, language: string): SmellResult[] {
    const lines = code.split('\n');
    const results: SmellResult[] = [];

    for (const rule of SMELL_RULES) {
      try {
        const smells = rule.detect(code, lines);
        results.push(...smells);
      } catch {
        // Skip rules that fail
      }
    }

    return results;
  }

  async detectFile(filePath: string): Promise<SmellResult[]> {
    const { readFile } = await import('node:fs/promises');
    const code = await readFile(filePath, 'utf-8');
    const ext = filePath.split('.').pop() || '';
    const language = ext === 'ts' || ext === 'tsx' ? 'typescript' : 'javascript';
    return this.detect(code, language);
  }

  getSmellSummary(smells: SmellResult[]): SmellSummary {
    const byCategory: Record<SmellCategory, number> = {
      bloaters: 0, 'object-orientation_abusers': 0, change_preventers: 0, dispensables: 0, couplers: 0,
    };
    const bySeverity: Record<Severity, number> = { info: 0, warning: 0, error: 0, critical: 0 };
    const typeCounts = new Map<string, number>();

    for (const smell of smells) {
      byCategory[smell.category]++;
      bySeverity[smell.severity]++;
      typeCounts.set(smell.type, (typeCounts.get(smell.type) || 0) + 1);
    }

    let mostCommon = '';
    let maxCount = 0;
    for (const [type, count] of typeCounts) {
      if (count > maxCount) {
        mostCommon = type;
        maxCount = count;
      }
    }

    return { total: smells.length, byCategory, bySeverity, mostCommon };
  }
}
