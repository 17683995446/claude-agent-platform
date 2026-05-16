// src/commit-helper.ts - Git 提交助手

export interface ChangeAnalysis {
  type: CommitType;
  scope?: string;
  description: string;
  files: string[];
  additions: number;
  deletions: number;
  hasBreakingChange: boolean;
  confidence: number;
}

export type CommitType = 'feat' | 'fix' | 'docs' | 'style' | 'refactor' | 'test' | 'chore' | 'perf' | 'ci' | 'build' | 'revert';

export interface CommitSuggestion {
  type: CommitType;
  scope?: string;
  subject: string;
  body?: string;
  footer?: string;
  breakingChange?: boolean;
}

export interface CommitOptions {
  breakingChange?: boolean;
  body?: string;
  footer?: string;
  issue?: string;
  skipCI?: boolean;
}

export interface ParsedCommit {
  type: CommitType;
  scope?: string;
  subject: string;
  body?: string;
  footer?: string;
  breakingChange: boolean;
  revert: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class CommitHelper {
  private typeDescriptions: Record<CommitType, string> = {
    feat: 'A new feature',
    fix: 'A bug fix',
    docs: 'Documentation only changes',
    style: 'Changes that do not affect the meaning of the code',
    refactor: 'A code change that neither fixes a bug nor adds a feature',
    test: 'Adding missing tests or correcting existing tests',
    chore: 'Changes to the build process or auxiliary tools',
    perf: 'A code change that improves performance',
    ci: 'Changes to CI configuration files and scripts',
    build: 'Changes that affect the build system or external dependencies',
    revert: 'Reverts a previous commit',
  };

  analyzeChanges(diff: string): ChangeAnalysis {
    const files: string[] = [];
    let additions = 0;
    let deletions = 0;
    let hasBreakingChange = false;
    let scope: string | undefined;

    const lines = diff.split('\n');
    for (const line of lines) {
      if (line.startsWith('+++ b/') || line.startsWith('--- a/')) {
        const filePath = line.substring(6);
        if (filePath !== '/dev/null') {
          files.push(filePath);
        }
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++;
        // Check for breaking change indicators
        if (line.includes('BREAKING CHANGE') || line.includes('!')) {
          hasBreakingChange = true;
        }
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++;
      }
    }

    // Determine scope from files
    if (files.length > 0) {
      const dirs = files.map(f => f.split('/')[0]).filter(Boolean);
      const mostCommon = dirs.sort((a, b) =>
        dirs.filter(d => d === b).length - dirs.filter(d => d === a).length
      )[0];
      if (mostCommon && mostCommon !== dirs[0]) {
        scope = mostCommon;
      } else if (dirs[0]) {
        scope = dirs[0];
      }
    }

    // Determine type based on file patterns and content
    const type = this.inferType(diff, files);

    // Generate description
    const description = this.generateDescription(files, additions, deletions, type);

    // Calculate confidence
    const confidence = this.calculateConfidence(files, additions, deletions, type);

    return {
      type,
      scope,
      description,
      files,
      additions,
      deletions,
      hasBreakingChange,
      confidence,
    };
  }

  private inferType(diff: string, files: string[]): CommitType {
    const hasTestFiles = files.some(f => f.includes('.test.') || f.includes('.spec.') || f.includes('__tests__'));
    const hasDocFiles = files.some(f => f.endsWith('.md') || f.endsWith('.txt') || f.includes('docs/'));
    const hasConfigFiles = files.some(f =>
      f.includes('.github/') || f.includes('Dockerfile') || f.includes('.yml') || f.includes('.yaml')
    );
    const hasSourceFiles = files.some(f =>
      (f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.tsx') || f.endsWith('.jsx')) &&
      !f.includes('.test.') && !f.includes('.spec.') && !f.includes('__tests__')
    );

    // Test files take priority
    if (hasTestFiles && !hasSourceFiles) return 'test';
    if (hasDocFiles && !hasSourceFiles && !hasTestFiles) return 'docs';
    if (hasConfigFiles && !hasSourceFiles && !hasTestFiles) return 'ci';

    // Check diff content for patterns
    if (diff.includes('BREAKING CHANGE') || diff.includes('!')) return 'feat';

    const lowerDiff = diff.toLowerCase();
    if (lowerDiff.includes('fix') || lowerDiff.includes('bug') || lowerDiff.includes('error') || lowerDiff.includes('issue')) {
      return 'fix';
    }
    if (lowerDiff.includes('add') || lowerDiff.includes('new') || lowerDiff.includes('implement') || lowerDiff.includes('feature')) {
      return 'feat';
    }
    if (lowerDiff.includes('refactor') || lowerDiff.includes('clean') || lowerDiff.includes('restructure')) {
      return 'refactor';
    }
    if (lowerDiff.includes('perf') || lowerDiff.includes('optimi') || lowerDiff.includes('speed')) {
      return 'perf';
    }
    if (lowerDiff.includes('format') || lowerDiff.includes('style') || lowerDiff.includes('lint')) {
      return 'style';
    }

    if (hasSourceFiles) return 'feat';
    return 'chore';
  }

  private generateDescription(files: string[], additions: number, deletions: number, type: CommitType): string {
    const fileNames = files.map(f => f.split('/').pop() || f);

    if (type === 'docs') {
      return `update documentation (${fileNames.join(', ')})`;
    }
    if (type === 'test') {
      return `add tests for ${fileNames.join(', ')}`;
    }
    if (type === 'chore') {
      return `update ${fileNames.join(', ')}`;
    }
    if (type === 'style') {
      return `format code in ${fileNames.join(', ')}`;
    }
    if (type === 'fix') {
      return `fix issue in ${fileNames[0] || 'code'}`;
    }
    if (type === 'refactor') {
      return `refactor ${fileNames[0] || 'code'}`;
    }
    if (type === 'perf') {
      return `improve performance of ${fileNames[0] || 'code'}`;
    }

    return `update ${fileNames[0] || 'code'}`;
  }

  private calculateConfidence(files: string[], additions: number, deletions: number, type: CommitType): number {
    let confidence = 0.5;

    if (files.length > 0) confidence += 0.1;
    if (files.length <= 3) confidence += 0.1;
    if (additions > 0 || deletions > 0) confidence += 0.1;
    if (additions < 100 && deletions < 100) confidence += 0.1;

    // Higher confidence for clear-cut types
    if (type === 'docs' || type === 'test' || type === 'chore') {
      confidence += 0.1;
    }

    return Math.min(confidence, 1.0);
  }

  suggestMessage(analysis: ChangeAnalysis): CommitSuggestion {
    const subject = analysis.description;

    return {
      type: analysis.type,
      scope: analysis.scope,
      subject,
      breakingChange: analysis.hasBreakingChange,
    };
  }

  generateMessage(type: string, scope: string, description: string, options?: CommitOptions): string {
    let message = '';

    // Header
    if (scope) {
      message += `${type}(${scope}): ${description}`;
    } else {
      message += `${type}: ${description}`;
    }

    // Breaking change marker
    if (options?.breakingChange) {
      message += '!';
    }

    // Body
    if (options?.body) {
      message += `\n\n${options.body}`;
    }

    // Footer
    const footerParts: string[] = [];
    if (options?.breakingChange) {
      footerParts.push('BREAKING CHANGE: This commit introduces breaking changes');
    }
    if (options?.issue) {
      footerParts.push(`Closes #${options.issue}`);
    }
    if (options?.skipCI) {
      footerParts.push('[skip ci]');
    }
    if (options?.footer) {
      footerParts.push(options.footer);
    }

    if (footerParts.length > 0) {
      message += `\n\n${footerParts.join('\n')}`;
    }

    return message;
  }

  validateMessage(message: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check conventional commit format
    const pattern = /^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\(.+\))?!?:\s.+$/;
    if (!pattern.test(message.split('\n')[0])) {
      errors.push('Message does not follow Conventional Commits format');
    }

    // Check subject length
    const firstLine = message.split('\n')[0];
    if (firstLine.length > 100) {
      warnings.push('Subject line exceeds 100 characters');
    }
    if (firstLine.length > 72) {
      warnings.push('Subject line exceeds 72 characters (recommended)');
    }

    // Check for period at end of subject
    if (firstLine.endsWith('.')) {
      warnings.push('Subject should not end with a period');
    }

    // Check for capitalization
    const subjectMatch = firstLine.match(/^(?:\w+(?:\([^)]*\))?!?:\s)(.+)/);
    if (subjectMatch && subjectMatch[1][0] !== subjectMatch[1][0].toUpperCase()) {
      warnings.push('Subject should start with uppercase');
    }

    // Check for breaking change
    if (message.includes('BREAKING CHANGE') && !firstLine.includes('!')) {
      warnings.push('Breaking change indicated in body but not in subject (missing !)');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  parseMessage(message: string): ParsedCommit {
    const lines = message.split('\n');
    const header = lines[0];

    // Parse header
    const headerMatch = header.match(/^(revert:\s)?(\w+)(?:\(([^)]+)\))?(!?):\s(.+)$/);

    if (!headerMatch) {
      return {
        type: 'chore',
        subject: header,
        breakingChange: false,
        revert: false,
      };
    }

    const [, revertPrefix, type, scope, bang, subject] = headerMatch;

    // Parse body and footer
    const bodyLines: string[] = [];
    const footerLines: string[] = [];
    let section = 'header'; // header -> body -> footer

    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === '') {
        if (section === 'header') {
          section = 'body';
        } else if (section === 'body') {
          section = 'footer';
        }
        continue;
      }
      if (section === 'body') {
        bodyLines.push(lines[i]);
      } else if (section === 'footer') {
        footerLines.push(lines[i]);
      }
    }

    // If there's no body but there are lines after the first blank line, treat them as footer
    // if they look like footer content (BREAKING CHANGE, Closes, etc.)
    if (bodyLines.length > 0 && footerLines.length === 0) {
      const footerPatterns = /^(BREAKING CHANGE|Closes|Fixes|Refs|Reviewed-by|Signed-off-by)/i;
      const possibleFooters: string[] = [];
      const actualBody: string[] = [];
      for (const line of bodyLines) {
        if (footerPatterns.test(line)) {
          possibleFooters.push(line);
        } else {
          actualBody.push(line);
        }
      }
      if (possibleFooters.length > 0 && actualBody.length === 0) {
        footerLines.push(...possibleFooters);
        bodyLines.length = 0;
      }
    }

    const hasBreakingChange = bang === '!' ||
      footerLines.some(l => l.includes('BREAKING CHANGE'));

    return {
      type: (type as CommitType) || 'chore',
      scope,
      subject: subject || '',
      body: bodyLines.length > 0 ? bodyLines.join('\n') : undefined,
      footer: footerLines.length > 0 ? footerLines.join('\n') : undefined,
      breakingChange: hasBreakingChange,
      revert: !!revertPrefix,
    };
  }

  getTypeDescription(type: CommitType): string {
    return this.typeDescriptions[type] || 'Unknown type';
  }

  getTypes(): CommitType[] {
    return Object.keys(this.typeDescriptions) as CommitType[];
  }
}
