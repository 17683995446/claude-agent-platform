// ============================================================
// Module 8: Error Diagnosis System
// Pattern matching, stack trace parsing, fix suggestions
// ============================================================

export interface DiagnosisContext {
  code?: string;
  language?: string;
  recentChanges?: string[];
  environment?: Record<string, string>;
}

export interface DiagnosisResult {
  error: string;
  category: ErrorCategory;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  probableCause: string;
  suggestedFixes: FixSuggestion[];
  relatedErrors: string[];
  stackFrames: StackFrame[];
}

export interface StackFrame {
  file: string;
  line: number;
  column?: number;
  functionName: string;
  context?: string;
}

export interface FixSuggestion {
  description: string;
  code?: string;
  confidence: number;
  effort: 'low' | 'medium' | 'high';
  explanation: string;
}

export type ErrorCategory = 'syntax' | 'runtime' | 'logic' | 'type' | 'dependency' | 'configuration';

interface ErrorPattern {
  pattern: RegExp;
  category: ErrorCategory;
  description: string;
  fix: string;
  fixCode?: string;
  confidence: number;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  {
    pattern: /Unexpected token/i,
    category: 'syntax',
    description: 'Syntax error: unexpected token in the code',
    fix: 'Check for missing brackets, parentheses, or semicolons near the indicated position',
    confidence: 0.9,
  },
  {
    pattern: /is not defined/i,
    category: 'runtime',
    description: 'Reference error: variable or function is not defined',
    fix: 'Ensure the variable/function is declared before use, or check for typos',
    confidence: 0.85,
  },
  {
    pattern: /Cannot read propert(?:y|ies) of (?:null|undefined)/i,
    category: 'runtime',
    description: 'Null reference error: trying to access property of null/undefined',
    fix: 'Add null checks before accessing properties, or ensure the value is properly initialized',
    fixCode: 'if (obj && obj.prop) { /* safe access */ }',
    confidence: 0.9,
  },
  {
    pattern: /Type '(.+?)' is not assignable to type '(.+?)'/i,
    category: 'type',
    description: 'Type error: incompatible type assignment',
    fix: 'Check the types and add proper type assertions or conversions',
    confidence: 0.85,
  },
  {
    pattern: /Cannot find module '(.+?)'/i,
    category: 'dependency',
    description: 'Module not found: missing dependency',
    fix: 'Install the missing package or check the import path',
    fixCode: 'bun add <package-name>',
    confidence: 0.9,
  },
  {
    pattern: /ECONNREFUSED|ENOTFOUND|network/i,
    category: 'runtime',
    description: 'Network error: connection refused or host not found',
    fix: 'Check that the server/service is running and the URL is correct',
    confidence: 0.8,
  },
  {
    pattern: /permission denied|EACCES/i,
    category: 'configuration',
    description: 'Permission error: insufficient permissions',
    fix: 'Check file/directory permissions or run with appropriate privileges',
    confidence: 0.85,
  },
  {
    pattern: /Maximum call stack size exceeded/i,
    category: 'runtime',
    description: 'Stack overflow: infinite recursion detected',
    fix: 'Check for missing base cases in recursive functions or circular references',
    confidence: 0.9,
  },
  {
    pattern: /SyntaxError.*unexpected/i,
    category: 'syntax',
    description: 'JavaScript/TypeScript syntax error',
    fix: 'Review the code for syntax issues near the error location',
    confidence: 0.9,
  },
  {
    pattern: /config(?:uration)?\s*(?:error|not found|missing)/i,
    category: 'configuration',
    description: 'Configuration error: missing or invalid configuration',
    fix: 'Check configuration files and environment variables',
    confidence: 0.8,
  },
];

export class ErrorDiagnosisEngine {
  private learnedFixes: Map<string, { fix: string; count: number }> = new Map();

  diagnose(error: Error | string, context?: DiagnosisContext): DiagnosisResult {
    const errorMessage = typeof error === 'string' ? error : error.message;
    const stack = typeof error === 'object' && error instanceof Error ? error.stack || '' : '';
    const stackFrames = stack ? this.parseStackTrace(stack) : [];

    // Match against known patterns
    let bestMatch: ErrorPattern | null = null;
    let bestConfidence = 0;

    for (const pattern of ERROR_PATTERNS) {
      if (pattern.pattern.test(errorMessage)) {
        if (pattern.confidence > bestConfidence) {
          bestMatch = pattern;
          bestConfidence = pattern.confidence;
        }
      }
    }

    // Check learned fixes
    for (const [errorKey, learned] of this.learnedFixes) {
      if (errorMessage.includes(errorKey) && learned.count > 1) {
        // Boost confidence for frequently seen errors
        bestConfidence = Math.min(1, bestConfidence + learned.count * 0.05);
      }
    }

    const category = bestMatch?.category ?? this.categorizeError(errorMessage);
    const severity = this.assessSeverity(errorMessage, category);
    const description = bestMatch?.description ?? `Unknown error: ${errorMessage.slice(0, 100)}`;
    const probableCause = bestMatch?.fix ?? 'Unable to determine probable cause automatically';
    const suggestedFixes = this.suggestFixesFromDiagnosis(errorMessage, category, context, bestMatch);

    const relatedErrors = this.findRelatedErrors(errorMessage, category);

    return {
      error: errorMessage,
      category,
      severity,
      description,
      probableCause,
      suggestedFixes,
      relatedErrors,
      stackFrames,
    };
  }

  parseStackTrace(stack: string): StackFrame[] {
    const frames: StackFrame[] = [];
    const lines = stack.split('\n');

    // Common stack trace formats
    const patterns = [
      /at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/,       // Chrome/V8
      /at\s+(.+?)\s+\((.+?):(\d+)\)/,               // V8 without column
      /(.+?)@(.+?):(\d+):(\d+)/,                     // Firefox
      /#\d+\s+(.+?)\s+at\s+(.+?):(\d+):(\d+)/,     // Ruby-like
    ];

    for (const line of lines) {
      for (const pattern of patterns) {
        const match = line.trim().match(pattern);
        if (match) {
          frames.push({
            functionName: match[1].trim(),
            file: match[2].trim(),
            line: parseInt(match[3], 10),
            column: match[4] ? parseInt(match[4], 10) : undefined,
          });
          break;
        }
      }
    }

    return frames;
  }

  suggestFixes(diagnosis: DiagnosisResult): FixSuggestion[] {
    return diagnosis.suggestedFixes;
  }

  learnFromFix(error: string, fix: string): void {
    const key = error.slice(0, 100);
    const existing = this.learnedFixes.get(key);
    if (existing) {
      existing.count++;
      existing.fix = fix;
    } else {
      this.learnedFixes.set(key, { fix, count: 1 });
    }
  }

  getLearnedFixCount(): number {
    return this.learnedFixes.size;
  }

  clearLearnedFixes(): void {
    this.learnedFixes.clear();
  }

  private categorizeError(errorMessage: string): ErrorCategory {
    const lower = errorMessage.toLowerCase();
    if (lower.includes('syntax') || lower.includes('parse') || lower.includes('unexpected token')) return 'syntax';
    if (lower.includes('type') && (lower.includes('assignable') || lower.includes('argument'))) return 'type';
    if (lower.includes('module') || lower.includes('import') || lower.includes('require')) return 'dependency';
    if (lower.includes('config') || lower.includes('env') || lower.includes('permission')) return 'configuration';
    if (lower.includes('logic') || lower.includes('expected') || lower.includes('assertion')) return 'logic';
    return 'runtime';
  }

  private assessSeverity(errorMessage: string, category: ErrorCategory): DiagnosisResult['severity'] {
    const criticalKeywords = ['fatal', 'crash', 'unhandled', 'segfault', 'heap out of memory', 'maximum call stack'];
    const highKeywords = ['error', 'exception', 'failed', 'cannot', 'stack', 'overflow'];
    const mediumKeywords = ['is not defined', 'not found', 'undefined', 'null', 'reference'];

    const lower = errorMessage.toLowerCase();
    if (criticalKeywords.some(k => lower.includes(k))) return 'critical';
    if (category === 'syntax' || category === 'type') return 'high';
    if (highKeywords.some(k => lower.includes(k))) {
      return 'high';
    }
    if (mediumKeywords.some(k => lower.includes(k))) {
      return 'medium';
    }
    return 'low';
  }

  private suggestFixesFromDiagnosis(
    errorMessage: string,
    category: ErrorCategory,
    context?: DiagnosisContext,
    pattern?: ErrorPattern,
  ): FixSuggestion[] {
    const fixes: FixSuggestion[] = [];

    if (pattern) {
      fixes.push({
        description: pattern.fix,
        code: pattern.fixCode,
        confidence: pattern.confidence,
        effort: 'low',
        explanation: `Based on matched error pattern: ${pattern.description}`,
      });
    }

    // Check learned fixes
    for (const [errorKey, learned] of this.learnedFixes) {
      if (errorMessage.includes(errorKey)) {
        fixes.push({
          description: `Previously applied fix (used ${learned.count} times)`,
          code: learned.fix,
          confidence: Math.min(0.95, 0.5 + learned.count * 0.1),
          effort: 'low',
          explanation: 'This fix has been successfully applied before',
        });
      }
    }

    // Category-specific suggestions
    switch (category) {
      case 'syntax':
        fixes.push({
          description: 'Run a linter to find exact syntax error location',
          confidence: 0.7,
          effort: 'low',
          explanation: 'Linters can pinpoint syntax errors precisely',
        });
        break;
      case 'type':
        fixes.push({
          description: 'Add type assertions or update type definitions',
          confidence: 0.6,
          effort: 'medium',
          explanation: 'Type errors often require understanding the expected vs actual types',
        });
        break;
      case 'dependency':
        fixes.push({
          description: 'Install missing dependencies',
          code: 'bun install',
          confidence: 0.7,
          effort: 'low',
          explanation: 'Missing packages can be resolved by installing dependencies',
        });
        break;
      case 'runtime':
        fixes.push({
          description: 'Check for null/undefined values and add proper guards',
          confidence: 0.6,
          effort: 'medium',
          explanation: 'Runtime errors often involve unexpected null or undefined values',
        });
        break;
    }

    // Ensure at least one fix suggestion
    if (fixes.length === 0) {
      fixes.push({
        description: 'Review the error message and check the code at the indicated location',
        confidence: 0.5,
        effort: 'medium',
        explanation: 'No specific fix pattern matched, general troubleshooting recommended',
      });
    }

    return fixes;
  }

  private findRelatedErrors(errorMessage: string, category: ErrorCategory): string[] {
    const related: string[] = [];
    for (const pattern of ERROR_PATTERNS) {
      if (pattern.category === category && !pattern.pattern.test(errorMessage)) {
        related.push(pattern.description);
      }
    }
    return related.slice(0, 3);
  }
}
