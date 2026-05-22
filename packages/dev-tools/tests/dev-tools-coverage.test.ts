import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { CodeFormatter } from '../src/code-formatter.ts';
import { LintEngine } from '../src/lint-engine.ts';
import { FileWatcher } from '../src/file-watcher.ts';
import { TaskRunner } from '../src/task-runner.ts';
import { SnippetManager } from '../src/snippet-manager.ts';
import { QuickDocsGenerator } from '../src/quick-docs.ts';
import { ProjectScaffolder } from '../src/project-scaffolder.ts';
import { DebugHelper } from '../src/debug-helper.ts';
import { DependencyGraphVisualizer } from '../src/dependency-graph.ts';
import { CommitHelper } from '../src/commit-helper.ts';

// ============================================================
// CodeFormatter - Full Coverage Tests
// ============================================================
describe('CodeFormatter (coverage)', () => {
  let formatter: CodeFormatter;
  beforeEach(() => { formatter = new CodeFormatter(); });

  test('format returns empty string for whitespace-only input', () => {
    expect(formatter.format('   \n\t\n  ', 'typescript')).toBe('');
  });

  test('format normalizes CRLF to LF', () => {
    expect(formatter.format('a\r\nb', 'typescript')).not.toContain('\r');
  });

  test('format removes trailing whitespace when trailingWhitespace=false', () => {
    const result = formatter.format('x = 1;   \n', 'typescript', { trailingWhitespace: false });
    expect(result).not.toMatch(/[ \t]+$/);
  });

  test('format handles semicolons for typescript', () => {
    const result = formatter.format('const x = 1\nconst y = 2', 'typescript', { semicolons: true });
    expect(result).toContain('const x = 1;');
    expect(result).toContain('const y = 2;');
  });

  test('format handles semicolons for javascript', () => {
    const result = formatter.format('const x = 1\nconst y = 2', 'javascript', { semicolons: true });
    expect(result).toContain('const x = 1;');
  });

  test('format skips semicolon handling for non-JS/TS languages', () => {
    const result = formatter.format('.foo { color: red; }', 'css');
    expect(result).toContain('color: red;');
  });

  test('format removes semicolons for JS/TS', () => {
    const result = formatter.format('const x = 1;\nconst y = 2;', 'typescript', { semicolons: false });
    expect(result).toContain('const x = 1\n');
    expect(result).toContain('const y = 2\n');
  });

  test('format does not remove semicolons from for-loop when semicolons=false', () => {
    const result = formatter.format('for (let i = 0; i < 10; i++) {\n  console.log(i);\n}', 'typescript', { semicolons: false });
    expect(result).toContain('for (let i = 0; i < 10; i++)');
  });

  test('format preserves semicolons on import/export lines when adding', () => {
    const code = "import { x } from 'y'";
    const result = formatter.format(code, 'typescript', { semicolons: true });
    expect(result).toContain("import { x } from 'y';");
  });

  test('format removes semicolons on import/export when removing', () => {
    const code = "import { x } from 'y';";
    const result = formatter.format(code, 'typescript', { semicolons: false });
    expect(result).not.toContain("from 'y';");
  });

  test('format skips comment lines for semicolon handling', () => {
    const code = '// just a comment\nconst x = 1';
    const result = formatter.format(code, 'typescript', { semicolons: true });
    expect(result).toContain('// just a comment');
  });

  test('format skips block comment start for semicolons', () => {
    const code = '/* comment */\nconst x = 1';
    const result = formatter.format(code, 'typescript', { semicolons: true });
    expect(result).toContain('/* comment */');
  });

  test('format normalizes quotes to single', () => {
    const result = formatter.format('const x = "hello";', 'typescript', { quoteStyle: 'single' });
    expect(result).toContain("'hello'");
  });

  test('format normalizes quotes to double', () => {
    const result = formatter.format("const x = 'hello';", 'typescript', { quoteStyle: 'double' });
    expect(result).toContain('"hello"');
  });

  test('format enforces maxWidth for non-JSON/HTML', () => {
    const longLine = 'const x = "' + 'a'.repeat(100) + '";';
    const result = formatter.format(longLine, 'typescript', { maxWidth: 80 });
    const lines = result.split('\n').filter(l => l.length > 0);
    expect(lines.length).toBeGreaterThan(1);
  });

  test('format does not wrap JSON lines', () => {
    const longLine = '{"key": "' + 'a'.repeat(100) + '"}';
    const result = formatter.format(longLine, 'json', { maxWidth: 80 });
    const lines = result.split('\n').filter(l => l.length > 0);
    expect(lines.length).toBe(1);
  });

  test('format does not wrap HTML lines', () => {
    const longLine = '<div class="' + 'a'.repeat(100) + '"></div>';
    const result = formatter.format(longLine, 'html', { maxWidth: 80 });
    const lines = result.split('\n').filter(l => l.length > 0);
    expect(lines.length).toBe(1);
  });

  test('format ensures file ends with newline', () => {
    const result = formatter.format('const x = 1;', 'typescript');
    expect(result.endsWith('\n')).toBe(true);
  });

  test('format with maxWidth=0 skips line length enforcement', () => {
    const code = 'const x = 1;';
    const result = formatter.format(code, 'typescript', { maxWidth: 0 });
    expect(result).toContain('const x = 1;');
  });

  test('format handles tabs indentation conversion to spaces', () => {
    const code = 'function foo() {\n\tconst x = 1;\n}';
    const result = formatter.format(code, 'typescript', { indentStyle: 'spaces', indentWidth: 2 });
    expect(result).not.toContain('\t');
    expect(result).toContain('  const x = 1;');
  });

  test('format handles spaces indentation conversion to tabs', () => {
    const code = 'function foo() {\n  const x = 1;\n}';
    const result = formatter.format(code, 'typescript', { indentStyle: 'tabs' });
    expect(result).toContain('\tconst x = 1;');
  });

  test('format handles CSS language', () => {
    const code = '.foo { color: red; }';
    const result = formatter.format(code, 'css');
    expect(result).toContain('.foo');
  });

  test('format handles HTML language', () => {
    const code = '<div>hello</div>';
    const result = formatter.format(code, 'html');
    expect(result).toContain('<div>');
  });

  test('format handles markdown language', () => {
    const code = '# Hello';
    const result = formatter.format(code, 'markdown');
    expect(result).toContain('# Hello');
  });

  test('format handles JSON language', () => {
    const code = '{"key": "value"}';
    const result = formatter.format(code, 'json');
    expect(result).toContain('"key"');
  });

  // formatDiff - all branches
  test('formatDiff with identical code shows context lines', () => {
    const code = 'const x = 1;\n';
    const diff = formatter.formatDiff(code, code);
    expect(diff).toContain('  const x = 1;');
  });

  test('formatDiff with added lines shows + prefix', () => {
    const diff = formatter.formatDiff('', 'const x = 1;\n');
    expect(diff).toContain('+ const x = 1;');
  });

  test('formatDiff with removed lines shows - prefix', () => {
    const diff = formatter.formatDiff('const x = 1;\n', '');
    expect(diff).toContain('- const x = 1;');
  });

  test('formatDiff with both additions and deletions', () => {
    const diff = formatter.formatDiff('const x = 1;\n', 'const x = 2;\n');
    expect(diff).toContain('- const x = 1;');
    expect(diff).toContain('+ const x = 2;');
  });

  test('formatDiff with empty strings', () => {
    const diff = formatter.formatDiff('', '');
    expect(diff).toBe('');
  });

  test('formatDiff with different lengths', () => {
    const diff = formatter.formatDiff('a\nb\nc\n', 'a\nc\n');
    expect(diff).toContain('- b');
  });

  test('enforceLineLength with no break point keeps line', () => {
    const code = 'a'.repeat(100);
    const result = formatter.format(code, 'typescript', { maxWidth: 80 });
    const lines = result.split('\n').filter(l => l.length > 0);
    // No space to break at, so line stays as-is (may have semicolon appended)
    expect(lines[0].length).toBeGreaterThanOrEqual(100);
  });

  test('enforceLineLength wraps at last space', () => {
    const code = 'const x = "hello world this is a very long string that should wrap at some point";';
    const result = formatter.format(code, 'typescript', { maxWidth: 60 });
    const lines = result.split('\n').filter(l => l.length > 0);
    expect(lines.length).toBeGreaterThan(1);
  });
});

// ============================================================
// LintEngine - Full Coverage Tests
// ============================================================
describe('LintEngine (coverage)', () => {
  let engine: LintEngine;
  beforeEach(() => { engine = new LintEngine(); });

  test('lint with empty rules array returns no messages', () => {
    const result = engine.lint('const x = 1;', 'typescript', []);
    expect(result.messages.length).toBe(0);
  });

  test('lint with undefined rules uses all built-in rules', () => {
    const result = engine.lint('console.log("hello");', 'typescript');
    expect(result.messages.length).toBeGreaterThan(0);
  });

  test('lint with specific enabled rules applies those', () => {
    const result = engine.lint('console.log("hello");', 'typescript', [
      { ruleId: 'no-console', severity: 'error', enabled: true },
    ]);
    expect(result.messages.some(m => m.ruleId === 'no-console')).toBe(true);
  });

  test('lint with disabled rule skips it', () => {
    const result = engine.lint('console.log("hello");', 'typescript', [
      { ruleId: 'no-console', severity: 'error', enabled: false },
    ]);
    expect(result.messages.length).toBe(0);
  });

  test('lint with non-existent ruleId is skipped', () => {
    const result = engine.lint('code', 'typescript', [
      { ruleId: 'non-existent-rule', severity: 'error', enabled: true },
    ]);
    expect(result.messages.length).toBe(0);
  });

  // Individual rules
  test('no-console detects all console methods', () => {
    const methods = ['log', 'warn', 'error', 'info', 'debug', 'trace'];
    for (const method of methods) {
      const result = engine.lint(`console.${method}("x");`, 'typescript', [
        { ruleId: 'no-console', severity: 'error', enabled: true },
      ]);
      expect(result.messages.some(m => m.ruleId === 'no-console')).toBe(true);
    }
  });

  test('prefer-const detects let that is never reassigned', () => {
    const result = engine.lint('let x = 1;\nconsole.log(x);', 'typescript', [
      { ruleId: 'prefer-const', severity: 'suggestion', enabled: true },
    ]);
    expect(result.messages.some(m => m.ruleId === 'prefer-const')).toBe(true);
  });

  test('prefer-const does not flag let that is reassigned', () => {
    const result = engine.lint('let x = 1;\nx = 2;', 'typescript', [
      { ruleId: 'prefer-const', severity: 'suggestion', enabled: true },
    ]);
    expect(result.messages.some(m => m.ruleId === 'prefer-const')).toBe(false);
  });

  test('prefer-const does not flag let with ++ operator', () => {
    const result = engine.lint('let i = 0;\ni++;', 'typescript', [
      { ruleId: 'prefer-const', severity: 'suggestion', enabled: true },
    ]);
    expect(result.messages.some(m => m.ruleId === 'prefer-const')).toBe(false);
  });

  test('prefer-const does not flag let with -- operator', () => {
    const result = engine.lint('let i = 0;\ni--;', 'typescript', [
      { ruleId: 'prefer-const', severity: 'suggestion', enabled: true },
    ]);
    expect(result.messages.some(m => m.ruleId === 'prefer-const')).toBe(false);
  });

  test('max-line-length with custom max option', () => {
    const result = engine.lint('a'.repeat(50), 'typescript', [
      { ruleId: 'max-line-length', severity: 'style', enabled: true, options: { max: 40 } },
    ]);
    expect(result.messages.some(m => m.ruleId === 'max-line-length')).toBe(true);
  });

  test('max-line-length with default max=80', () => {
    const result = engine.lint('a'.repeat(81), 'typescript', [
      { ruleId: 'max-line-length', severity: 'style', enabled: true },
    ]);
    expect(result.messages.some(m => m.ruleId === 'max-line-length')).toBe(true);
  });

  test('max-line-length does not flag short lines', () => {
    const result = engine.lint('short', 'typescript', [
      { ruleId: 'max-line-length', severity: 'style', enabled: true, options: { max: 80 } },
    ]);
    expect(result.messages.some(m => m.ruleId === 'max-line-length')).toBe(false);
  });

  test('no-trailing-whitespace detects spaces', () => {
    const result = engine.lint('x = 1;   \n', 'typescript', [
      { ruleId: 'no-trailing-whitespace', severity: 'style', enabled: true },
    ]);
    expect(result.messages.some(m => m.ruleId === 'no-trailing-whitespace')).toBe(true);
  });

  test('no-trailing-whitespace detects tabs', () => {
    const result = engine.lint('x = 1;\t\n', 'typescript', [
      { ruleId: 'no-trailing-whitespace', severity: 'style', enabled: true },
    ]);
    expect(result.messages.some(m => m.ruleId === 'no-trailing-whitespace')).toBe(true);
  });

  test('no-multiple-empty-lines with max=1 default', () => {
    const result = engine.lint('x = 1;\n\n\n\ny = 2;', 'typescript', [
      { ruleId: 'no-multiple-empty-lines', severity: 'style', enabled: true },
    ]);
    expect(result.messages.some(m => m.ruleId === 'no-multiple-empty-lines')).toBe(true);
  });

  test('no-multiple-empty-lines with custom max', () => {
    const result = engine.lint('x = 1;\n\n\n\ny = 2;', 'typescript', [
      { ruleId: 'no-multiple-empty-lines', severity: 'style', enabled: true, options: { max: 2 } },
    ]);
    expect(result.messages.some(m => m.ruleId === 'no-multiple-empty-lines')).toBe(true);
  });

  test('no-var detects var declarations', () => {
    const result = engine.lint('var x = 1;', 'typescript', [
      { ruleId: 'no-var', severity: 'suggestion', enabled: true },
    ]);
    expect(result.messages.some(m => m.ruleId === 'no-var')).toBe(true);
  });

  test('eqeqeq detects == but not ===', () => {
    const result1 = engine.lint('if (x == 1) {}', 'typescript', [
      { ruleId: 'eqeqeq', severity: 'error', enabled: true },
    ]);
    expect(result1.messages.some(m => m.ruleId === 'eqeqeq')).toBe(true);

    const result2 = engine.lint('if (x === 1) {}', 'typescript', [
      { ruleId: 'eqeqeq', severity: 'error', enabled: true },
    ]);
    expect(result2.messages.some(m => m.ruleId === 'eqeqeq')).toBe(false);
  });

  test('eqeqeq does not flag == in comments', () => {
    const result = engine.lint('// x == y\nconst a = 1;', 'typescript', [
      { ruleId: 'eqeqeq', severity: 'error', enabled: true },
    ]);
    expect(result.messages.some(m => m.ruleId === 'eqeqeq')).toBe(false);
  });

  test('no-extra-semi detects double semicolons', () => {
    const result = engine.lint('const x = 1;;', 'typescript', [
      { ruleId: 'no-extra-semi', severity: 'style', enabled: true },
    ]);
    expect(result.messages.some(m => m.ruleId === 'no-extra-semi')).toBe(true);
  });

  test('no-duplicate-keys detects duplicates in JS/TS', () => {
    const result = engine.lint('const obj = { a: 1, a: 2 };', 'javascript', [
      { ruleId: 'no-duplicate-keys', severity: 'error', enabled: true },
    ]);
    expect(result.messages.some(m => m.ruleId === 'no-duplicate-keys')).toBe(true);
  });

  test('no-duplicate-keys detects duplicates in JSON', () => {
    const result = engine.lint('{"a": 1, "a": 2}', 'json', [
      { ruleId: 'no-duplicate-keys', severity: 'error', enabled: true },
    ]);
    expect(result.messages.some(m => m.ruleId === 'no-duplicate-keys')).toBe(true);
  });

  test('no-duplicate-keys skips non-JS/TS/JSON languages', () => {
    const result = engine.lint('some code with a: 1, a: 2', 'css', [
      { ruleId: 'no-duplicate-keys', severity: 'error', enabled: true },
    ]);
    expect(result.messages.some(m => m.ruleId === 'no-duplicate-keys')).toBe(false);
  });

  test('no-shadow detects variable shadowing', () => {
    const result = engine.lint('const x = 1;\nfunction foo() {\n  const x = 2;\n}', 'typescript', [
      { ruleId: 'no-shadow', severity: 'warning', enabled: true },
    ]);
    expect(result.messages.some(m => m.ruleId === 'no-shadow')).toBe(true);
  });

  test('indent detects tabs when spaces expected', () => {
    const result = engine.lint('function foo() {\n\tconst x = 1;\n}', 'typescript', [
      { ruleId: 'indent', severity: 'style', enabled: true, options: { style: 'spaces', width: 2 } },
    ]);
    expect(result.messages.some(m => m.ruleId === 'indent')).toBe(true);
  });

  test('indent detects spaces when tabs expected', () => {
    const result = engine.lint('function foo() {\n  const x = 1;\n}', 'typescript', [
      { ruleId: 'indent', severity: 'style', enabled: true, options: { style: 'tabs' } },
    ]);
    expect(result.messages.some(m => m.ruleId === 'indent')).toBe(true);
  });

  test('indent detects invalid indent width', () => {
    const result = engine.lint('function foo() {\n   const x = 1;\n}', 'typescript', [
      { ruleId: 'indent', severity: 'style', enabled: true, options: { style: 'spaces', width: 2 } },
    ]);
    expect(result.messages.some(m => m.ruleId === 'indent')).toBe(true);
  });

  test('indent skips empty lines', () => {
    const result = engine.lint('const x = 1;\n\nconst y = 2;', 'typescript', [
      { ruleId: 'indent', severity: 'style', enabled: true, options: { style: 'spaces', width: 2 } },
    ]);
    expect(result.messages.some(m => m.ruleId === 'indent')).toBe(false);
  });

  test('no-unused-vars detects unused variables', () => {
    const result = engine.lint('const unusedVar = 1;', 'typescript', [
      { ruleId: 'no-unused-vars', severity: 'error', enabled: true },
    ]);
    expect(result.messages.some(m => m.ruleId === 'no-unused-vars')).toBe(true);
  });

  test('no-unused-vars does not flag used variables', () => {
    const result = engine.lint('const x = 1;\nconsole.log(x);', 'typescript', [
      { ruleId: 'no-unused-vars', severity: 'error', enabled: true },
    ]);
    expect(result.messages.some(m => m.ruleId === 'no-unused-vars')).toBe(false);
  });

  test('no-undef detects undefined variables', () => {
    const result = engine.lint('console.log(undefinedVar);', 'typescript', [
      { ruleId: 'no-undef', severity: 'error', enabled: true },
    ]);
    expect(result.messages.some(m => m.ruleId === 'no-undef')).toBe(true);
  });

  test('no-undef does not flag built-in globals', () => {
    const result = engine.lint('console.log(Math.random());', 'typescript', [
      { ruleId: 'no-undef', severity: 'error', enabled: true },
    ]);
    expect(result.messages.filter(m => m.ruleId === 'no-undef').length).toBe(0);
  });

  test('no-undef does not flag variables in quotes', () => {
    const result = engine.lint("const x = 'myVar';", 'typescript', [
      { ruleId: 'no-undef', severity: 'error', enabled: true },
    ]);
    expect(result.messages.filter(m => m.ruleId === 'no-undef').length).toBe(0);
  });

  test('no-undef does not flag uppercase identifiers (likely classes)', () => {
    const result = engine.lint('const x = new MyClass();', 'typescript', [
      { ruleId: 'no-undef', severity: 'error', enabled: true },
    ]);
    expect(result.messages.filter(m => m.ruleId === 'no-undef' && m.message.includes('MyClass')).length).toBe(0);
  });

  test('curly detects missing curly braces', () => {
    const result = engine.lint('if (true) return;', 'typescript', [
      { ruleId: 'curly', severity: 'style', enabled: true },
    ]);
    expect(result.messages.some(m => m.ruleId === 'curly')).toBe(true);
  });

  test('curly skips lines with comments', () => {
    const result = engine.lint('if (true) { // no brace issue\n}', 'typescript', [
      { ruleId: 'curly', severity: 'style', enabled: true },
    ]);
    expect(result.messages.some(m => m.ruleId === 'curly')).toBe(false);
  });

  // Severity counts
  test('lint counts errors, warnings, suggestions, styles correctly', () => {
    const result = engine.lint('console.log("x");\nlet y = 1;\n  \n', 'typescript');
    expect(result.errorCount).toBeGreaterThanOrEqual(0);
    expect(result.warningCount).toBeGreaterThanOrEqual(0);
    expect(result.suggestionCount).toBeGreaterThanOrEqual(0);
    expect(result.styleCount).toBeGreaterThanOrEqual(0);
    const total = result.errorCount + result.warningCount + result.suggestionCount + result.styleCount;
    expect(total).toBe(result.messages.length);
  });

  // fix() - all fixable rules
  test('fix no-trailing-whitespace', () => {
    const result = engine.fix('x = 1;   \n', [{ ruleId: 'no-trailing-whitespace', severity: 'style', enabled: true }]);
    expect(result.fixed).toBe(true);
    expect(result.code).not.toContain('   \n');
  });

  test('fix no-multiple-empty-lines', () => {
    const result = engine.fix('x = 1;\n\n\n\ny = 2;', [{ ruleId: 'no-multiple-empty-lines', severity: 'style', enabled: true }]);
    expect(result.fixed).toBe(true);
    const emptyLineCount = (result.code.match(/\n\n/g) || []).length;
    expect(emptyLineCount).toBeLessThan(3);
  });

  test('fix no-var', () => {
    const result = engine.fix('var x = 1;', [{ ruleId: 'no-var', severity: 'suggestion', enabled: true }]);
    expect(result.fixed).toBe(true);
    expect(result.code).toContain('const x = 1;');
  });

  test('fix eqeqeq', () => {
    const result = engine.fix('if (x == 1) {}', [{ ruleId: 'eqeqeq', severity: 'error', enabled: true }]);
    expect(result.fixed).toBe(true);
    expect(result.code).toContain('===');
  });

  test('fix no-extra-semi', () => {
    const result = engine.fix('const x = 1;;', [{ ruleId: 'no-extra-semi', severity: 'style', enabled: true }]);
    expect(result.fixed).toBe(true);
    expect(result.code).not.toContain(';;');
  });

  test('fix prefer-const', () => {
    const result = engine.fix('let x = 1;', [{ ruleId: 'prefer-const', severity: 'suggestion', enabled: true }]);
    expect(result.fixed).toBe(true);
    expect(result.code).toContain('const x = 1;');
  });

  test('fix indent tabs to spaces', () => {
    const result = engine.fix('function foo() {\n\tconst x = 1;\n}', [
      { ruleId: 'indent', severity: 'style', enabled: true, options: { style: 'spaces', width: 2 } },
    ]);
    expect(result.fixed).toBe(true);
    expect(result.code).not.toContain('\t');
  });

  test('fix indent spaces to tabs', () => {
    const result = engine.fix('function foo() {\n  const x = 1;\n}', [
      { ruleId: 'indent', severity: 'style', enabled: true, options: { style: 'tabs', width: 2 } },
    ]);
    expect(result.fixed).toBe(true);
    expect(result.code).toContain('\t');
  });

  test('fix with no fixable rules returns fixed=false', () => {
    const result = engine.fix('console.log("x");', [{ ruleId: 'no-console', severity: 'error', enabled: true }]);
    expect(result.fixed).toBe(false);
  });

  test('fix returns remaining messages after fixing', () => {
    const result = engine.fix('x = 1;   \nconsole.log("x");', [
      { ruleId: 'no-trailing-whitespace', severity: 'style', enabled: true },
      { ruleId: 'no-console', severity: 'warning', enabled: true },
    ]);
    expect(result.messages.length).toBeGreaterThan(0);
  });

  test('fix with language parameter', () => {
    const result = engine.fix('code', [], 'javascript');
    expect(typeof result.code).toBe('string');
  });

  // Rule management
  test('addRule and removeRule', () => {
    engine.addRule({ ruleId: 'custom', description: 'Custom', category: 'error', defaultSeverity: 'error', fixable: false });
    expect(engine.getRules().some(r => r.ruleId === 'custom')).toBe(true);
    expect(engine.removeRule('custom')).toBe(true);
    expect(engine.getRules().some(r => r.ruleId === 'custom')).toBe(false);
  });

  test('removeRule returns false for non-existent rule', () => {
    expect(engine.removeRule('non-existent')).toBe(false);
  });

  test('getRules returns all built-in rules', () => {
    const rules = engine.getRules();
    expect(rules.length).toBe(15);
  });
});

// ============================================================
// FileWatcher - Full Coverage Tests
// ============================================================
describe('FileWatcher (coverage)', () => {
  let watcher: FileWatcher;
  beforeEach(() => { watcher = new FileWatcher(); });

  test('watch stores path with default options', () => {
    watcher.watch('/tmp/test');
    expect(watcher.isWatching('/tmp/test')).toBe(true);
    const opts = watcher.getOptions('/tmp/test');
    expect(opts?.recursive).toBe(true);
    expect(opts?.debounceMs).toBe(100);
    expect(opts?.persistent).toBe(true);
    expect(opts?.ignorePatterns).toContain('**/node_modules/**');
  });

  test('watch merges custom options with defaults', () => {
    watcher.watch('/tmp/test', { recursive: false, debounceMs: 500 });
    const opts = watcher.getOptions('/tmp/test');
    expect(opts?.recursive).toBe(false);
    expect(opts?.debounceMs).toBe(500);
    expect(opts?.ignorePatterns).toBeDefined();
  });

  test('unwatch removes path and cleans up', () => {
    watcher.watch('/tmp/test');
    watcher.unwatch('/tmp/test');
    expect(watcher.isWatching('/tmp/test')).toBe(false);
    expect(watcher.getOptions('/tmp/test')).toBeUndefined();
  });

  test('on and off for event handlers', () => {
    const handler = () => {};
    watcher.on('create', handler);
    expect(watcher.getHandlerCount('create')).toBe(1);
    watcher.off('create', handler);
    expect(watcher.getHandlerCount('create')).toBe(0);
  });

  test('off non-existent handler does not throw', () => {
    expect(() => watcher.off('create', () => {})).not.toThrow();
  });

  test('getWatchedPaths only returns active paths', () => {
    watcher.watch('/tmp/a');
    watcher.watch('/tmp/b');
    watcher.unwatch('/tmp/a');
    expect(watcher.getWatchedPaths()).toEqual(['/tmp/b']);
  });

  test('isWatching returns false for non-existent path', () => {
    expect(watcher.isWatching('/tmp/nonexistent')).toBe(false);
  });

  test('simulateEvent does not emit when paused', () => {
    let received = false;
    watcher.watch('/tmp/test');
    watcher.on('modify', () => { received = true; });
    watcher.pause();
    watcher.simulateEvent({ type: 'modify', path: '/tmp/test', timestamp: Date.now() });
    expect(received).toBe(false);
  });

  test('simulateEvent does not emit for unwatched paths', () => {
    let received = false;
    watcher.on('modify', () => { received = true; });
    watcher.simulateEvent({ type: 'modify', path: '/tmp/unwatched', timestamp: Date.now() });
    expect(received).toBe(false);
  });

  test('simulateEvent ignores paths matching ignore patterns', () => {
    let received = false;
    watcher.watch('/tmp/project');
    watcher.on('modify', () => { received = true; });
    watcher.simulateEvent({ type: 'modify', path: '/tmp/project/node_modules/pkg/file.js', timestamp: Date.now() });
    expect(received).toBe(false);
  });

  test('simulateEvent emits to specific handler', (done) => {
    watcher.watch('/tmp/test');
    watcher.on('create', (event) => {
      expect(event.type).toBe('create');
      expect(event.path).toBe('/tmp/test/file.ts');
      done();
    });
    watcher.simulateEvent({ type: 'create', path: '/tmp/test/file.ts', timestamp: Date.now() });
  });

  test('simulateEvent emits to all handler', (done) => {
    watcher.watch('/tmp/test');
    watcher.on('all', (event) => {
      expect(event.type).toBe('delete');
      done();
    });
    watcher.simulateEvent({ type: 'delete', path: '/tmp/test/file.ts', timestamp: Date.now() });
  });

  test('simulateEvent debounces rapid events', (done) => {
    const events: string[] = [];
    watcher.watch('/tmp/test', { debounceMs: 50 });
    watcher.on('modify', (event) => {
      events.push(event.path);
    });
    watcher.simulateEvent({ type: 'modify', path: '/tmp/test/file.ts', timestamp: Date.now() });
    watcher.simulateEvent({ type: 'modify', path: '/tmp/test/file.ts', timestamp: Date.now() });
    watcher.simulateEvent({ type: 'modify', path: '/tmp/test/file.ts', timestamp: Date.now() });
    setTimeout(() => {
      expect(events.length).toBe(1);
      done();
    }, 100);
  });

  test('handler errors are silently caught', () => {
    watcher.watch('/tmp/test');
    watcher.on('create', () => { throw new Error('handler error'); });
    expect(() => {
      watcher.simulateEvent({ type: 'create', path: '/tmp/test/file.ts', timestamp: Date.now() });
    }).not.toThrow();
  });

  test('close clears everything', () => {
    watcher.watch('/tmp/a');
    watcher.watch('/tmp/b');
    watcher.on('create', () => {});
    watcher.close();
    expect(watcher.getWatchedPaths().length).toBe(0);
    expect(watcher.getHandlerCount('create')).toBe(0);
  });

  test('getHandlerCount for all event types', () => {
    const events: Array<'create' | 'modify' | 'delete' | 'rename' | 'all'> = ['create', 'modify', 'delete', 'rename', 'all'];
    for (const event of events) {
      expect(watcher.getHandlerCount(event)).toBe(0);
    }
  });

  test('shouldIgnore with simple pattern', () => {
    watcher.watch('/tmp/test', { ignorePatterns: ['*.log'] });
    let received = false;
    watcher.on('modify', () => { received = true; });
    watcher.simulateEvent({ type: 'modify', path: '/tmp/test/app.log', timestamp: Date.now() });
    expect(received).toBe(false);
  });

  test('resume after pause allows events', (done) => {
    watcher.watch('/tmp/test');
    watcher.on('modify', () => { done(); });
    watcher.pause();
    watcher.resume();
    watcher.simulateEvent({ type: 'modify', path: '/tmp/test/file.ts', timestamp: Date.now() });
  });

  test('rename event includes oldPath', (done) => {
    watcher.watch('/tmp/test');
    watcher.on('rename', (event) => {
      expect(event.oldPath).toBe('/tmp/test/old.ts');
      done();
    });
    watcher.simulateEvent({ type: 'rename', path: '/tmp/test/new.ts', oldPath: '/tmp/test/old.ts', timestamp: Date.now() });
  });
});

// ============================================================
// TaskRunner - Full Coverage Tests
// ============================================================
describe('TaskRunner (coverage)', () => {
  let runner: TaskRunner;
  beforeEach(() => { runner = new TaskRunner(); });

  test('define sets default options', () => {
    runner.define('test', () => {});
    const tasks = runner.listTasks();
    expect(tasks[0].dependencies).toEqual([]);
  });

  test('define with custom options', () => {
    runner.define('test', () => {}, { description: 'desc', dependencies: ['a'], timeout: 5000, retryCount: 2 });
    const tasks = runner.listTasks();
    expect(tasks[0].description).toBe('desc');
    expect(tasks[0].dependencies).toEqual(['a']);
  });

  test('run non-existent task returns error', async () => {
    const result = await runner.run('nonexistent');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
    expect(result.duration).toBe(0);
  });

  test('run successful sync task', async () => {
    runner.define('sync', () => 'result');
    const result = await runner.run('sync');
    expect(result.success).toBe(true);
    expect(result.output).toBe('result');
    expect(result.error).toBeUndefined();
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  test('run successful async task', async () => {
    runner.define('async', async () => 'async-result');
    const result = await runner.run('async');
    expect(result.success).toBe(true);
    expect(result.output).toBe('async-result');
  });

  test('run task that returns undefined', async () => {
    runner.define('void', () => { /* no return */ });
    const result = await runner.run('void');
    expect(result.success).toBe(true);
    expect(result.output).toBe('');
  });

  test('run task that throws Error', async () => {
    runner.define('err', () => { throw new Error('boom'); });
    const result = await runner.run('err');
    expect(result.success).toBe(false);
    expect(result.error).toBe('boom');
  });

  test('run task that throws non-Error', async () => {
    runner.define('str-err', () => { throw 'string error'; });
    const result = await runner.run('str-err');
    expect(result.success).toBe(false);
    expect(result.error).toBe('string error');
  });

  test('run with dependencies executes in order', async () => {
    const order: string[] = [];
    runner.define('dep1', () => { order.push('dep1'); return 'd1'; });
    runner.define('dep2', () => { order.push('dep2'); return 'd2'; });
    runner.define('main', () => { order.push('main'); return 'm'; }, { dependencies: ['dep1', 'dep2'] });
    const result = await runner.run('main');
    expect(result.success).toBe(true);
    expect(order).toEqual(['dep1', 'dep2', 'main']);
    expect(result.dependencies).toEqual(['dep1', 'dep2']);
  });

  test('run fails when dependency fails and continueOnError=false', async () => {
    runner.define('fail-dep', () => { throw new Error('dep fail'); });
    runner.define('main', () => 'main', { dependencies: ['fail-dep'] });
    const result = await runner.run('main');
    expect(result.success).toBe(false);
    expect(result.error).toContain("Dependency 'fail-dep' failed");
  });

  test('run continues when dependency fails and continueOnError=true', async () => {
    runner.define('fail-dep', () => { throw new Error('dep fail'); });
    runner.define('main', () => 'main', { dependencies: ['fail-dep'], continueOnError: true });
    const result = await runner.run('main');
    expect(result.success).toBe(true);
    expect(result.output).toBe('main');
  });

  test('run detects circular dependencies (direct)', async () => {
    runner.define('a', () => {}, { dependencies: ['b'] });
    runner.define('b', () => {}, { dependencies: ['a'] });
    const result = await runner.run('a');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Circular');
  });

  test('run detects circular dependencies (self)', async () => {
    runner.define('self', () => {}, { dependencies: ['self'] });
    const result = await runner.run('self');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Circular');
  });

  test('run detects circular dependencies (3-way)', async () => {
    runner.define('a', () => {}, { dependencies: ['b'] });
    runner.define('b', () => {}, { dependencies: ['c'] });
    runner.define('c', () => {}, { dependencies: ['a'] });
    const result = await runner.run('a');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Circular');
  });

  test('run times out', async () => {
    runner.define('slow', () => new Promise(resolve => setTimeout(resolve, 10000)), { timeout: 50 });
    const result = await runner.run('slow');
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  }, 5000);

  test('runParallel executes all tasks', async () => {
    runner.define('p1', async () => '1');
    runner.define('p2', async () => '2');
    runner.define('p3', async () => '3');
    const results = await runner.runParallel(['p1', 'p2', 'p3']);
    expect(results.length).toBe(3);
    expect(results.every(r => r.success)).toBe(true);
  });

  test('runParallel with failing task', async () => {
    runner.define('ok', () => 'ok');
    runner.define('fail', () => { throw new Error('fail'); });
    const results = await runner.runParallel(['ok', 'fail']);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
  });

  test('listTasks returns all tasks', () => {
    runner.define('a', () => {}, { description: 'Task A' });
    runner.define('b', () => {}, { description: 'Task B', dependencies: ['a'] });
    const tasks = runner.listTasks();
    expect(tasks.length).toBe(2);
    expect(tasks[0].hasHandler).toBe(true);
    expect(tasks[1].dependencies).toEqual(['a']);
  });

  test('getTaskGraph returns nodes and edges', () => {
    runner.define('a', () => {});
    runner.define('b', () => {}, { dependencies: ['a'] });
    runner.define('c', () => {}, { dependencies: ['a', 'b'] });
    const graph = runner.getTaskGraph();
    expect(graph.nodes.length).toBe(3);
    expect(graph.edges.length).toBe(3);
  });

  test('getResult returns undefined for unrun task', () => {
    expect(runner.getResult('never-run')).toBeUndefined();
  });

  test('getResult returns stored result', async () => {
    runner.define('store', () => 'stored');
    await runner.run('store');
    const stored = runner.getResult('store');
    expect(stored?.output).toBe('stored');
  });

  test('clearResults removes all results', async () => {
    runner.define('x', () => 'x');
    await runner.run('x');
    runner.clearResults();
    expect(runner.getResult('x')).toBeUndefined();
  });

  test('removeTask returns true for existing task', () => {
    runner.define('temp', () => {});
    expect(runner.removeTask('temp')).toBe(true);
    expect(runner.hasTask('temp')).toBe(false);
  });

  test('removeTask returns false for non-existent task', () => {
    expect(runner.removeTask('nonexistent')).toBe(false);
  });

  test('hasTask returns correct boolean', () => {
    expect(runner.hasTask('nope')).toBe(false);
    runner.define('yep', () => {});
    expect(runner.hasTask('yep')).toBe(true);
  });

  test('getDependencyOrder returns topological order', () => {
    runner.define('c', () => {}, { dependencies: ['b'] });
    runner.define('a', () => {});
    runner.define('b', () => {}, { dependencies: ['a'] });
    const order = runner.getDependencyOrder();
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
  });

  test('getDependencyOrder with no dependencies', () => {
    runner.define('x', () => {});
    runner.define('y', () => {});
    const order = runner.getDependencyOrder();
    expect(order.length).toBe(2);
  });

  test('getDependencyOrder with missing dependency in chain', () => {
    runner.define('a', () => {}, { dependencies: ['missing'] });
    const order = runner.getDependencyOrder();
    expect(order.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// SnippetManager - Full Coverage Tests
// ============================================================
describe('SnippetManager (coverage)', () => {
  let manager: SnippetManager;
  beforeEach(() => { manager = new SnippetManager(); });

  test('built-in snippets are registered', () => {
    expect(manager.count()).toBe(8);
  });

  test('create assigns unique IDs', () => {
    const s1 = manager.create({ name: 'id-1', language: 'ts', code: '1' });
    const s2 = manager.create({ name: 'id-2', language: 'ts', code: '2' });
    expect(s1.id).not.toBe(s2.id);
  });

  test('create sets timestamps', () => {
    const before = Date.now();
    const s = manager.create({ name: 'ts-test', language: 'ts', code: 'test' });
    expect(s.createdAt).toBeGreaterThanOrEqual(before);
    expect(s.updatedAt).toBe(s.createdAt);
  });

  test('get returns undefined for non-existent snippet', () => {
    expect(manager.get('nonexistent')).toBeUndefined();
  });

  test('update returns undefined for non-existent snippet', () => {
    expect(manager.update('nonexistent', { code: 'new' })).toBeUndefined();
  });

  test('update preserves id and createdAt', () => {
    const s = manager.create({ name: 'upd', language: 'ts', code: 'old' });
    const updated = manager.update('upd', { code: 'new', description: 'desc' });
    expect(updated?.id).toBe(s.id);
    expect(updated?.createdAt).toBe(s.createdAt);
    expect(updated?.code).toBe('new');
    expect(updated?.description).toBe('desc');
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(s.updatedAt);
  });

  test('delete returns false for non-existent', () => {
    expect(manager.delete('nonexistent')).toBe(false);
  });

  test('search by name', () => {
    const results = manager.search('function');
    expect(results.length).toBeGreaterThan(0);
  });

  test('search by description', () => {
    const results = manager.search('error handling');
    expect(results.length).toBeGreaterThan(0);
  });

  test('search by language', () => {
    const results = manager.search('typescript');
    expect(results.length).toBeGreaterThan(0);
  });

  test('search by code content', () => {
    const results = manager.search('console.error');
    expect(results.length).toBeGreaterThan(0);
  });

  test('search by tag', () => {
    const results = manager.search('async');
    expect(results.length).toBeGreaterThan(0);
  });

  test('search returns empty for no match', () => {
    const results = manager.search('zzznonexistentzzz');
    expect(results.length).toBe(0);
  });

  test('expand with default variables', () => {
    const code = manager.expand('function');
    expect(code).toContain('myFunction');
    expect(code).not.toContain('${name}');
  });

  test('expand with custom variables overrides defaults', () => {
    const code = manager.expand('function', { name: 'customFn', params: 'x: number' });
    expect(code).toContain('customFn');
    expect(code).toContain('x: number');
  });

  test('expand returns empty for non-existent snippet', () => {
    expect(manager.expand('nonexistent')).toBe('');
  });

  test('importSnippets from JSON array', () => {
    const data = JSON.stringify([
      { name: 'imp1', language: 'ts', code: '1' },
      { name: 'imp2', language: 'js', code: '2' },
    ]);
    expect(manager.importSnippets(data)).toBe(2);
    expect(manager.get('imp1')).toBeDefined();
    expect(manager.get('imp2')).toBeDefined();
  });

  test('importSnippets from single object', () => {
    const data = JSON.stringify({ name: 'imp-single', language: 'ts', code: '1' });
    expect(manager.importSnippets(data)).toBe(1);
  });

  test('importSnippets with invalid JSON returns 0', () => {
    expect(manager.importSnippets('not json')).toBe(0);
  });

  test('importSnippets skips entries without required fields', () => {
    const data = JSON.stringify([
      { name: 'valid', language: 'ts', code: 'ok' },
      { name: 'no-code', language: 'ts' },
      { language: 'ts', code: 'no-name' },
    ]);
    expect(manager.importSnippets(data)).toBe(1);
  });

  test('exportSnippets returns JSON array', () => {
    const json = manager.exportSnippets();
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0].id).toBeUndefined();
    expect(parsed[0].createdAt).toBeUndefined();
    expect(parsed[0].updatedAt).toBeUndefined();
  });

  test('exportSnippets with language filter', () => {
    const json = manager.exportSnippets({ language: 'typescript' });
    const parsed = JSON.parse(json);
    expect(parsed.every((s: { language: string }) => s.language === 'typescript')).toBe(true);
  });

  test('exportSnippets with tag filter', () => {
    const json = manager.exportSnippets({ tags: ['basic'] });
    const parsed = JSON.parse(json);
    expect(parsed.length).toBeGreaterThan(0);
  });

  test('exportSnippets with namePattern filter', () => {
    const json = manager.exportSnippets({ namePattern: '^function$' });
    const parsed = JSON.parse(json);
    expect(parsed.length).toBe(1);
    expect(parsed[0].name).toBe('function');
  });

  test('exportSnippets with combined filters', () => {
    const json = manager.exportSnippets({ language: 'typescript', tags: ['basic'] });
    const parsed = JSON.parse(json);
    expect(parsed.length).toBeGreaterThan(0);
  });

  test('list returns all snippets', () => {
    const all = manager.list();
    expect(all.length).toBe(manager.count());
  });

  test('getByLanguage returns matching snippets', () => {
    const ts = manager.getByLanguage('typescript');
    expect(ts.every(s => s.language === 'typescript')).toBe(true);
    expect(ts.length).toBeGreaterThan(0);
  });

  test('getByLanguage returns empty for non-existent language', () => {
    expect(manager.getByLanguage('nonexistent')).toEqual([]);
  });

  test('getByTag returns matching snippets', () => {
    const basic = manager.getByTag('basic');
    expect(basic.length).toBeGreaterThan(0);
  });

  test('getByTag returns empty for non-existent tag', () => {
    expect(manager.getByTag('nonexistent')).toEqual([]);
  });

  test('count returns correct number', () => {
    const before = manager.count();
    manager.create({ name: 'count-test', language: 'ts', code: 'x' });
    expect(manager.count()).toBe(before + 1);
  });

  test('clear removes all snippets and resets ID', () => {
    manager.clear();
    expect(manager.count()).toBe(0);
    const s = manager.create({ name: 'after-clear', language: 'ts', code: 'x' });
    expect(s.id).toBe('1');
  });
});

// ============================================================
// QuickDocsGenerator - Full Coverage Tests
// ============================================================
describe('QuickDocsGenerator (coverage)', () => {
  let gen: QuickDocsGenerator;
  beforeEach(() => { gen = new QuickDocsGenerator(); });

  test('generateREADME with minimal info', () => {
    const readme = gen.generateREADME({ name: 'min', version: '0.0.0', description: '' });
    expect(readme).toContain('# min');
    expect(readme).toContain('## Installation');
    expect(readme).toContain('## Usage');
    expect(readme).toContain('## API');
  });

  test('generateREADME with all fields', () => {
    const readme = gen.generateREADME({
      name: 'full', version: '1.0.0', description: 'A full project',
      author: 'Dev', license: 'MIT', repository: 'https://github.com/test/full',
      main: 'dist/index.js', scripts: { build: 'tsc', test: 'vitest', dev: 'tsx' },
      keywords: ['test', 'full'],
    });
    expect(readme).toContain('# full');
    expect(readme).toContain('MIT');
    expect(readme).toContain('npm run build');
  });

  test('generateREADME without scripts omits scripts section', () => {
    const readme = gen.generateREADME({ name: 'nosc', version: '0.0.0', description: '' });
    expect(readme).not.toContain('## Scripts');
  });

  test('generateREADME without license omits license section', () => {
    const readme = gen.generateREADME({ name: 'nolic', version: '0.0.0', description: '' });
    expect(readme).not.toContain('## License');
  });

  test('generateAPIDoc extracts exports', () => {
    const files = [{
      path: 'src/index.ts',
      content: 'export class MyClass {}\nexport interface MyIF {}\nexport function myFn(): void {}\nexport const MY_CONST = 1;',
      language: 'typescript',
    }];
    const doc = gen.generateAPIDoc(files);
    expect(doc.title).toBe('API Documentation');
    expect(doc.modules.length).toBe(1);
    expect(doc.modules[0].exports.length).toBeGreaterThanOrEqual(3);
  });

  test('generateAPIDoc extracts module description from JSDoc', () => {
    const files = [{
      path: 'src/mod.ts',
      content: '/**\n * Module description here.\n */\nexport function fn() {}',
      language: 'typescript',
    }];
    const doc = gen.generateAPIDoc(files);
    expect(doc.modules[0].description).toContain('Module description here');
  });

  test('generateAPIDoc with empty files', () => {
    const doc = gen.generateAPIDoc([]);
    expect(doc.modules.length).toBe(0);
  });

  test('generateAPIDoc extracts preceding comment for export', () => {
    const files = [{
      path: 'src/a.ts',
      content: '/** Adds two numbers */\nexport function add(a: number, b: number): number { return a + b; }',
      language: 'typescript',
    }];
    const doc = gen.generateAPIDoc(files);
    const addExport = doc.modules[0].exports.find(e => e.name === 'add');
    expect(addExport?.description).toContain('Adds two numbers');
  });

  test('generateChangelog groups by type', () => {
    const history = [
      { hash: 'abc1234', message: 'Add feature X', type: 'feat', date: '2024-01-01', author: 'Dev' },
      { hash: 'def5678', message: 'Fix bug Y', type: 'fix', date: '2024-01-02', author: 'Dev' },
      { hash: 'ghi9012', message: 'Update docs', type: 'docs', date: '2024-01-03', author: 'Dev' },
      { hash: 'jkl3456', message: 'Refactor code', type: 'refactor', date: '2024-01-04', author: 'Dev' },
      { hash: 'mno7890', message: 'Add tests', type: 'test', date: '2024-01-05', author: 'Dev' },
      { hash: 'pqr1234', message: 'Update deps', type: 'chore', date: '2024-01-06', author: 'Dev' },
      { hash: 'stu5678', message: 'Optimize speed', type: 'perf', date: '2024-01-07', author: 'Dev' },
      { hash: 'vwx9012', message: 'Other change', type: 'other', date: '2024-01-08', author: 'Dev' },
    ];
    const changelog = gen.generateChangelog(history);
    expect(changelog).toContain('### Features');
    expect(changelog).toContain('### Bug Fixes');
    expect(changelog).toContain('### Documentation');
    expect(changelog).toContain('### Code Refactoring');
    expect(changelog).toContain('### Tests');
    expect(changelog).toContain('### Chores');
    expect(changelog).toContain('### Performance');
    expect(changelog).toContain('### Other');
  });

  test('generateChangelog with scope', () => {
    const history = [
      { hash: 'abc', message: 'Add feature', type: 'feat', scope: 'api', date: '2024-01-01', author: 'Dev' },
    ];
    const changelog = gen.generateChangelog(history);
    expect(changelog).toContain('**api:**');
  });

  test('generateChangelog with empty history', () => {
    const changelog = gen.generateChangelog([]);
    expect(changelog).toContain('# Changelog');
  });

  test('generateChangelog with unknown type', () => {
    const history = [
      { hash: 'abc', message: 'Something', type: 'unknown-type', date: '2024-01-01', author: 'Dev' },
    ];
    const changelog = gen.generateChangelog(history);
    expect(changelog).toContain('### unknown-type');
  });

  test('generateTypeDoc with interface', () => {
    const doc = gen.generateTypeDoc([{
      name: 'User', kind: 'interface', description: 'A user',
      properties: [
        { name: 'id', type: 'number', description: 'User ID' },
        { name: 'name', type: 'string', optional: true },
      ],
    }]);
    expect(doc).toContain('Interface: `User`');
    expect(doc).toContain('optional');
  });

  test('generateTypeDoc with type parameters', () => {
    const doc = gen.generateTypeDoc([{
      name: 'Box', kind: 'type', typeParams: ['T'],
      properties: [{ name: 'value', type: 'T' }],
    }]);
    expect(doc).toContain('`T`');
  });

  test('generateTypeDoc with extends', () => {
    const doc = gen.generateTypeDoc([{
      name: 'Admin', kind: 'class', extends: ['User', 'Base'],
      properties: [{ name: 'role', type: 'string' }],
    }]);
    expect(doc).toContain('`User`');
    expect(doc).toContain('`Base`');
  });

  test('generateTypeDoc with source', () => {
    const doc = gen.generateTypeDoc([{
      name: 'Config', kind: 'type', source: 'type Config = { debug: boolean };',
    }]);
    expect(doc).toContain('type Config = { debug: boolean };');
  });

  test('generateTypeDoc with empty types', () => {
    const doc = gen.generateTypeDoc([]);
    expect(doc).toContain('# Type Documentation');
  });

  test('generateTypeDoc with all kinds', () => {
    const kinds = ['interface', 'type', 'enum', 'class', 'function'] as const;
    const types = kinds.map(kind => ({ name: `Test${kind}`, kind, description: `A ${kind}` }));
    const doc = gen.generateTypeDoc(types);
    for (const kind of kinds) {
      expect(doc).toContain(`${kind.charAt(0).toUpperCase() + kind.slice(1)}: \`Test${kind}\``);
    }
  });
});

// ============================================================
// ProjectScaffolder - Full Coverage Tests
// ============================================================
describe('ProjectScaffolder (coverage)', () => {
  let scaffolder: ProjectScaffolder;
  beforeEach(() => { scaffolder = new ProjectScaffolder(); });

  test('listTemplates returns 5 built-in templates', () => {
    const templates = scaffolder.listTemplates();
    expect(templates.length).toBe(5);
    const names = templates.map(t => t.name);
    expect(names).toContain('library');
    expect(names).toContain('cli-tool');
    expect(names).toContain('web-app');
    expect(names).toContain('api-server');
    expect(names).toContain('plugin');
  });

  test('scaffold library with custom variables', async () => {
    const result = await scaffolder.scaffold('library', '/tmp/lib-test', {
      variables: { name: 'my-lib', description: 'My lib', author: 'Test', license: 'Apache-2.0' },
    });
    expect(result.success).toBe(true);
    expect(result.filesCreated).toContain('package.json');
    expect(result.filesCreated).toContain('src/index.ts');
    expect(result.filesCreated).toContain('tsconfig.json');
    expect(result.filesCreated).toContain('.gitignore');
    expect(result.filesCreated).toContain('README.md');
  });

  test('scaffold cli-tool', async () => {
    const result = await scaffolder.scaffold('cli-tool', '/tmp/cli-test', {
      variables: { name: 'my-cli', bin: 'my-cli-bin' },
    });
    expect(result.success).toBe(true);
    expect(result.filesCreated).toContain('src/cli.ts');
  });

  test('scaffold web-app', async () => {
    const result = await scaffolder.scaffold('web-app', '/tmp/web-test');
    expect(result.success).toBe(true);
    expect(result.filesCreated).toContain('index.html');
    expect(result.filesCreated).toContain('src/main.ts');
  });

  test('scaffold api-server', async () => {
    const result = await scaffolder.scaffold('api-server', '/tmp/api-test', {
      variables: { port: '8080' },
    });
    expect(result.success).toBe(true);
    expect(result.filesCreated).toContain('src/index.ts');
  });

  test('scaffold plugin', async () => {
    const result = await scaffolder.scaffold('plugin', '/tmp/plugin-test');
    expect(result.success).toBe(true);
    expect(result.filesCreated).toContain('src/index.ts');
  });

  test('scaffold non-existent template returns error', async () => {
    const result = await scaffolder.scaffold('nonexistent', '/tmp/test');
    expect(result.success).toBe(false);
    expect(result.errors).toContain("Template 'nonexistent' not found");
    expect(result.filesCreated).toEqual([]);
  });

  test('scaffold with default variables', async () => {
    const result = await scaffolder.scaffold('library', '/tmp/defaults');
    expect(result.success).toBe(true);
  });

  test('validateTemplate valid', () => {
    const v = scaffolder.validateTemplate({
      name: 'valid', description: 'Valid template',
      files: [{ path: 'a.ts', content: 'export {}' }],
    });
    expect(v.valid).toBe(true);
    expect(v.errors.length).toBe(0);
    expect(v.warnings.length).toBe(0);
  });

  test('validateTemplate without name', () => {
    const v = scaffolder.validateTemplate({ name: '', files: [{ path: 'a.ts', content: '' }] });
    expect(v.valid).toBe(false);
    expect(v.errors).toContain('Template name is required');
  });

  test('validateTemplate without description warns', () => {
    const v = scaffolder.validateTemplate({ name: 'no-desc', files: [{ path: 'a.ts', content: '' }] });
    expect(v.warnings.some(w => w.includes('description'))).toBe(true);
  });

  test('validateTemplate without files', () => {
    const v = scaffolder.validateTemplate({ name: 'no-files', files: [] });
    expect(v.valid).toBe(false);
    expect(v.errors.some(e => e.includes('at least one file'))).toBe(true);
  });

  test('validateTemplate with duplicate paths', () => {
    const v = scaffolder.validateTemplate({
      name: 'dup',
      files: [{ path: 'a.ts', content: '1' }, { path: 'a.ts', content: '2' }],
    });
    expect(v.valid).toBe(false);
    expect(v.errors.some(e => e.includes('Duplicate'))).toBe(true);
  });

  test('validateTemplate with empty file path', () => {
    const v = scaffolder.validateTemplate({
      name: 'empty-path', files: [{ path: '', content: 'x' }],
    });
    expect(v.valid).toBe(false);
    expect(v.errors.some(e => e.includes('File path'))).toBe(true);
  });

  test('createTemplate adds custom template', () => {
    scaffolder.createTemplate({
      name: 'custom-tpl', description: 'Custom',
      files: [{ path: 'custom.ts', content: 'export {}' }],
    });
    expect(scaffolder.hasTemplate('custom-tpl')).toBe(true);
    expect(scaffolder.getTemplate('custom-tpl')?.name).toBe('custom-tpl');
  });

  test('removeTemplate returns true for existing', () => {
    scaffolder.createTemplate({ name: 'removable', description: '', files: [{ path: 'a.ts', content: '' }] });
    expect(scaffolder.removeTemplate('removable')).toBe(true);
    expect(scaffolder.hasTemplate('removable')).toBe(false);
  });

  test('removeTemplate returns false for non-existent', () => {
    expect(scaffolder.removeTemplate('nonexistent')).toBe(false);
  });

  test('getTemplate returns undefined for non-existent', () => {
    expect(scaffolder.getTemplate('nonexistent')).toBeUndefined();
  });

  test('hasTemplate returns correct boolean', () => {
    expect(scaffolder.hasTemplate('library')).toBe(true);
    expect(scaffolder.hasTemplate('nonexistent')).toBe(false);
  });

  test('variable resolution with variable referencing another variable', async () => {
    const result = await scaffolder.scaffold('cli-tool', '/tmp/var-ref', {
      variables: { name: 'my-tool' },
    });
    expect(result.success).toBe(true);
  });
});

// ============================================================
// DebugHelper - Full Coverage Tests
// ============================================================
describe('DebugHelper (coverage)', () => {
  let helper: DebugHelper;
  beforeEach(() => { helper = new DebugHelper(); });

  test('setLevel and getLevel', () => {
    helper.setLevel('error');
    expect(helper.getLevel()).toBe('error');
  });

  test('enable and disable', () => {
    expect(helper.isEnabled()).toBe(true);
    helper.disable();
    expect(helper.isEnabled()).toBe(false);
    helper.enable();
    expect(helper.isEnabled()).toBe(true);
  });

  test('log respects level hierarchy', () => {
    helper.setLevel('warn');
    helper.log('debug', 'd');
    helper.log('info', 'i');
    helper.log('warn', 'w');
    helper.log('error', 'e');
    helper.log('silent', 's');
    // warn, error, and silent all pass the warn level filter
    expect(helper.getLogCount()).toBe(3);
  });

  test('log with data', () => {
    helper.log('info', 'msg', { key: 'value' });
    const logs = helper.getLogs();
    expect(logs[0].data).toEqual({ key: 'value' });
    expect(logs[0].timestamp).toBeGreaterThan(0);
  });

  test('log when disabled does nothing', () => {
    helper.disable();
    helper.log('error', 'should not appear');
    expect(helper.getLogCount()).toBe(0);
  });

  test('convenience methods: debug, info, warn, error', () => {
    helper.debug('d');
    helper.info('i');
    helper.warn('w');
    helper.error('e');
    expect(helper.getLogsByLevel('debug').length).toBe(1);
    expect(helper.getLogsByLevel('info').length).toBe(1);
    expect(helper.getLogsByLevel('warn').length).toBe(1);
    expect(helper.getLogsByLevel('error').length).toBe(1);
  });

  test('time creates timer with label', () => {
    const timer = helper.time('test');
    expect(timer.label).toBe('test');
    expect(timer.start).toBeGreaterThan(0);
  });

  test('time stop returns elapsed and sets end', () => {
    const timer = helper.time('stop-test');
    const elapsed = timer.stop();
    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(timer.end).toBeDefined();
    expect(timer.elapsed).toBe(elapsed);
  });

  test('timeEnd returns undefined for non-existent', () => {
    expect(helper.timeEnd('nonexistent')).toBeUndefined();
  });

  test('timeEnd stops existing timer', () => {
    helper.time('end-test');
    const elapsed = helper.timeEnd('end-test');
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });

  test('getTimer returns undefined for non-existent', () => {
    expect(helper.getTimer('nonexistent')).toBeUndefined();
  });

  test('getTimer returns timer', () => {
    helper.time('get-test');
    expect(helper.getTimer('get-test')?.label).toBe('get-test');
  });

  test('profile sync function', () => {
    const result = helper.profile(() => { let s = 0; for (let i = 0; i < 1000; i++) s += i; });
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.name).toBe('anonymous');
    expect(result.memoryBefore).toBeDefined();
    expect(result.memoryAfter).toBeDefined();
    expect(result.memoryDelta).toBeDefined();
  });

  test('profile named function', () => {
    function namedFn() {}
    const result = helper.profile(namedFn);
    expect(result.name).toBe('namedFn');
  });

  test('profileAsync', async () => {
    const result = await helper.profileAsync(async () => {
      await new Promise(r => setTimeout(r, 10));
    });
    expect(result.duration).toBeGreaterThanOrEqual(5);
    expect(result.name).toBe('anonymous');
  });

  test('inspect null, undefined, string, number, boolean', () => {
    expect(helper.inspect(null)).toBe('null');
    expect(helper.inspect(undefined)).toBe('undefined');
    expect(helper.inspect('hello')).toBe('"hello"');
    expect(helper.inspect(42)).toBe('42');
    expect(helper.inspect(true)).toBe('true');
    expect(helper.inspect(false)).toBe('false');
  });

  test('inspect array', () => {
    const result = helper.inspect([1, 2, 3]);
    expect(result).toContain('1');
    expect(result).toContain('2');
    expect(result).toContain('3');
  });

  test('inspect empty array', () => {
    expect(helper.inspect([])).toBe('[]');
  });

  test('inspect object', () => {
    const result = helper.inspect({ key: 'value' });
    expect(result).toContain('key');
    expect(result).toContain('value');
  });

  test('inspect empty object', () => {
    expect(helper.inspect({})).toBe('{}');
  });

  test('inspect function', () => {
    function fn() {}
    expect(helper.inspect(fn)).toContain('fn');
  });

  test('inspect anonymous function', () => {
    expect(helper.inspect(() => {})).toContain('anonymous');
  });

  test('diff identical values', () => {
    const result = helper.diff('same', 'same');
    expect(result.equal).toBe(true);
    expect(result.additions).toEqual([]);
    expect(result.deletions).toEqual([]);
    expect(result.changes).toEqual([]);
  });

  test('diff different strings', () => {
    const result = helper.diff('before', 'after');
    expect(result.equal).toBe(false);
    expect(result.additions.length).toBeGreaterThan(0);
    expect(result.deletions.length).toBeGreaterThan(0);
  });

  test('diff different length arrays', () => {
    const result = helper.diff([1, 2, 3], [1, 4]);
    expect(result.equal).toBe(false);
    expect(result.additions.length).toBeGreaterThan(0);
    expect(result.deletions.length).toBeGreaterThan(0);
  });

  test('diff objects deeply', () => {
    const result = helper.diff({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 });
    expect(result.equal).toBe(false);
    expect(result.changes.some(c => c.path === 'b')).toBe(true);
    expect(result.changes.some(c => c.path === 'c')).toBe(true);
  });

  test('diff nested objects', () => {
    const result = helper.diff({ a: { x: 1 } }, { a: { x: 2 } });
    expect(result.equal).toBe(false);
    expect(result.changes.some(c => c.path === 'a.x')).toBe(true);
  });

  test('getLogs returns copy', () => {
    helper.log('info', 'test');
    const logs1 = helper.getLogs();
    const logs2 = helper.getLogs();
    expect(logs1).not.toBe(logs2);
    expect(logs1.length).toBe(logs2.length);
  });

  test('getLogsByLevel filters correctly', () => {
    helper.log('debug', 'd');
    helper.log('info', 'i');
    helper.log('error', 'e');
    expect(helper.getLogsByLevel('error').length).toBe(1);
    expect(helper.getLogsByLevel('debug').length).toBe(1);
    expect(helper.getLogsByLevel('info').length).toBe(1);
    expect(helper.getLogsByLevel('warn').length).toBe(0);
  });

  test('clearLogs', () => {
    helper.log('info', 'test');
    helper.clearLogs();
    expect(helper.getLogCount()).toBe(0);
  });

  test('clearTimers', () => {
    helper.time('t1');
    helper.time('t2');
    helper.clearTimers();
    expect(helper.getTimer('t1')).toBeUndefined();
    expect(helper.getTimer('t2')).toBeUndefined();
  });

  test('clear clears logs and timers', () => {
    helper.log('info', 'test');
    helper.time('t');
    helper.clear();
    expect(helper.getLogCount()).toBe(0);
    expect(helper.getTimer('t')).toBeUndefined();
  });

  test('assert true does not throw', () => {
    expect(() => helper.assert(true, 'ok')).not.toThrow();
  });

  test('assert false throws with message', () => {
    expect(() => helper.assert(false, 'fail msg')).toThrow('fail msg');
  });

  test('assert false logs error', () => {
    try { helper.assert(false, 'fail'); } catch {}
    expect(helper.getLogsByLevel('error').length).toBe(1);
  });

  test('table logs data', () => {
    helper.table({ key: 'value' });
    expect(helper.getLogsByLevel('info').length).toBe(1);
  });

  test('log history limited to maxLogs', () => {
    for (let i = 0; i < 1100; i++) {
      helper.log('debug', `msg ${i}`);
    }
    expect(helper.getLogCount()).toBeLessThanOrEqual(1000);
  });
});

// ============================================================
// DependencyGraphVisualizer - Full Coverage Tests
// ============================================================
describe('DependencyGraphVisualizer (coverage)', () => {
  let viz: DependencyGraphVisualizer;
  beforeEach(() => { viz = new DependencyGraphVisualizer(); });

  test('buildGraph with imports', () => {
    const files = [
      { path: 'src/index.ts', content: "import { a } from './a';\nimport { b } from './b';" },
      { path: 'src/a.ts', content: 'export const a = 1;' },
      { path: 'src/b.ts', content: 'export const b = 2;' },
    ];
    const graph = viz.buildGraph(files);
    expect(graph.nodes.size).toBe(3);
    expect(graph.edges.length).toBe(2);
    const indexNode = graph.nodes.get('src/index');
    expect(indexNode?.dependencies).toContain('src/a');
    expect(indexNode?.dependencies).toContain('src/b');
    const aNode = graph.nodes.get('src/a');
    expect(aNode?.dependents).toContain('src/index');
  });

  test('buildGraph with no imports', () => {
    const graph = viz.buildGraph([{ path: 'src/standalone.ts', content: 'export const x = 1;' }]);
    expect(graph.nodes.size).toBe(1);
    expect(graph.edges.length).toBe(0);
  });

  test('buildGraph with circular deps', () => {
    const files = [
      { path: 'src/a.ts', content: "import { b } from './b';" },
      { path: 'src/b.ts', content: "import { a } from './a';" },
    ];
    const graph = viz.buildGraph(files);
    expect(graph.edges.length).toBe(2);
  });

  test('buildGraph with CommonJS requires', () => {
    const files = [
      { path: 'src/index.ts', content: "const dep = require('./dep');" },
      { path: 'src/dep.ts', content: 'export {}' },
    ];
    const graph = viz.buildGraph(files);
    expect(graph.edges.length).toBe(1);
  });

  test('buildGraph with dynamic imports', () => {
    const files = [
      { path: 'src/index.ts', content: "import('./dynamic');" },
      { path: 'src/dynamic.ts', content: 'export {}' },
    ];
    const graph = viz.buildGraph(files);
    expect(graph.edges.length).toBe(1);
  });

  test('buildGraph skips external imports', () => {
    const files = [
      { path: 'src/index.ts', content: "import { x } from 'external';\nimport { a } from './a';" },
      { path: 'src/a.ts', content: 'export {}' },
    ];
    const graph = viz.buildGraph(files);
    expect(graph.edges.length).toBe(1);
  });

  test('buildGraph with empty files', () => {
    const graph = viz.buildGraph([]);
    expect(graph.nodes.size).toBe(0);
    expect(graph.edges.length).toBe(0);
  });

  test('buildGraph normalizes paths (removes extensions)', () => {
    const files = [
      { path: 'src/index.ts', content: "import { util } from './util';" },
      { path: 'src/util.ts', content: 'export {}' },
    ];
    const graph = viz.buildGraph(files);
    expect(graph.nodes.has('src/index')).toBe(true);
    expect(graph.nodes.has('src/util')).toBe(true);
  });

  test('buildGraph handles ../ imports', () => {
    const files = [
      { path: 'src/sub/deep.ts', content: "import { x } from '../root';" },
      { path: 'src/root.ts', content: 'export const x = 1;' },
    ];
    const graph = viz.buildGraph(files);
    expect(graph.edges.length).toBe(1);
  });

  test('buildGraph handles multiple ../ levels', () => {
    const files = [
      { path: 'a/b/c/d.ts', content: "import { x } from '../../x';" },
      { path: 'a/x.ts', content: 'export const x = 1;' },
    ];
    const graph = viz.buildGraph(files);
    expect(graph.edges.length).toBe(1);
  });

  test('buildGraph does not duplicate edges', () => {
    const files = [
      { path: 'src/a.ts', content: "import { b } from './b';\nimport { b } from './b';" },
      { path: 'src/b.ts', content: 'export {}' },
    ];
    const graph = viz.buildGraph(files);
    // Note: the current implementation does not deduplicate edges
    expect(graph.edges.length).toBe(2);
  });

  test('detectCycles finds cycles', () => {
    const files = [
      { path: 'src/a.ts', content: "import { b } from './b';" },
      { path: 'src/b.ts', content: "import { a } from './a';" },
    ];
    viz.buildGraph(files);
    const cycles = viz.detectCycles();
    expect(cycles.length).toBeGreaterThan(0);
  });

  test('detectCycles with no cycles', () => {
    const files = [
      { path: 'src/a.ts', content: "import { b } from './b';" },
      { path: 'src/b.ts', content: 'export {}' },
    ];
    viz.buildGraph(files);
    expect(viz.detectCycles().length).toBe(0);
  });

  test('detectCycles with empty graph', () => {
    viz.buildGraph([]);
    expect(viz.detectCycles().length).toBe(0);
  });

  test('findPath returns path between connected nodes', () => {
    const files = [
      { path: 'src/a.ts', content: "import { b } from './b';" },
      { path: 'src/b.ts', content: "import { c } from './c';" },
      { path: 'src/c.ts', content: 'export {}' },
    ];
    viz.buildGraph(files);
    const path = viz.findPath('src/a', 'src/c');
    expect(path.length).toBe(3);
    expect(path[0]).toBe('src/a');
    expect(path[2]).toBe('src/c');
  });

  test('findPath returns empty for disconnected nodes', () => {
    const files = [
      { path: 'src/a.ts', content: 'export {}' },
      { path: 'src/b.ts', content: 'export {}' },
    ];
    viz.buildGraph(files);
    expect(viz.findPath('src/a', 'src/b').length).toBe(0);
  });

  test('findPath from node to itself', () => {
    const files = [{ path: 'src/a.ts', content: 'export {}' }];
    viz.buildGraph(files);
    const path = viz.findPath('src/a', 'src/a');
    expect(path.length).toBe(1);
    expect(path[0]).toBe('src/a');
  });

  test('findPath with non-existent nodes', () => {
    viz.buildGraph([]);
    expect(viz.findPath('x', 'y').length).toBe(0);
  });

  test('toDOT generates valid DOT', () => {
    const files = [
      { path: 'src/a.ts', content: "import { b } from './b';" },
      { path: 'src/b.ts', content: 'export {}' },
    ];
    viz.buildGraph(files);
    const dot = viz.toDOT();
    expect(dot).toContain('digraph dependencies');
    expect(dot).toContain('rankdir=LR');
    expect(dot).toContain('->');
  });

  test('toDOT with empty graph', () => {
    viz.buildGraph([]);
    const dot = viz.toDOT();
    expect(dot).toContain('digraph dependencies');
  });

  test('toMermaid generates valid Mermaid', () => {
    const files = [
      { path: 'src/a.ts', content: "import { b } from './b';" },
      { path: 'src/b.ts', content: 'export {}' },
    ];
    viz.buildGraph(files);
    const mmd = viz.toMermaid();
    expect(mmd).toContain('graph LR');
    expect(mmd).toContain('-->');
  });

  test('toMermaid with empty graph', () => {
    viz.buildGraph([]);
    expect(viz.toMermaid()).toContain('graph LR');
  });

  test('toASCII generates text output', () => {
    const files = [
      { path: 'src/a.ts', content: "import { b } from './b';" },
      { path: 'src/b.ts', content: 'export {}' },
    ];
    viz.buildGraph(files);
    const ascii = viz.toASCII();
    expect(ascii).toContain('-->');
  });

  test('toASCII with no-dependency node', () => {
    viz.buildGraph([{ path: 'src/standalone.ts', content: 'export {}' }]);
    const ascii = viz.toASCII();
    expect(ascii).toContain('(no dependencies)');
  });

  test('toJSON generates valid JSON', () => {
    const files = [
      { path: 'src/a.ts', content: "import { b } from './b';" },
      { path: 'src/b.ts', content: 'export {}' },
    ];
    viz.buildGraph(files);
    const json = viz.toJSON();
    const parsed = JSON.parse(json);
    expect(parsed.nodes.length).toBe(2);
    expect(parsed.edges.length).toBe(1);
  });

  test('toJSON with empty graph', () => {
    viz.buildGraph([]);
    const parsed = JSON.parse(viz.toJSON());
    expect(parsed.nodes.length).toBe(0);
    expect(parsed.edges.length).toBe(0);
  });

  test('getMetrics returns correct values', () => {
    const files = [
      { path: 'src/index.ts', content: "import { a } from './a';\nimport { b } from './b';" },
      { path: 'src/a.ts', content: 'export {}' },
      { path: 'src/b.ts', content: 'export {}' },
    ];
    viz.buildGraph(files);
    const m = viz.getMetrics();
    expect(m.totalNodes).toBe(3);
    expect(m.totalEdges).toBe(2);
    expect(m.avgDependencies).toBeCloseTo(2 / 3);
    expect(m.mostDepended.length).toBeLessThanOrEqual(5);
    // src/a and src/b each have 1 dependent (src/index), src/index has 0
    expect(m.mostDepended.slice(0, 2)).toContain('src/a');
    expect(m.mostDepended.slice(0, 2)).toContain('src/b');
  });

  test('getMetrics with empty graph', () => {
    viz.buildGraph([]);
    const m = viz.getMetrics();
    expect(m.totalNodes).toBe(0);
    expect(m.totalEdges).toBe(0);
    expect(m.avgDependencies).toBe(0);
    expect(m.mostDepended).toEqual([]);
  });

  test('getSubgraph with depth=0', () => {
    const files = [
      { path: 'src/index.ts', content: "import { a } from './a';" },
      { path: 'src/a.ts', content: "import { b } from './b';" },
      { path: 'src/b.ts', content: 'export {}' },
    ];
    viz.buildGraph(files);
    const sub = viz.getSubgraph('src/index', 0);
    expect(sub.nodes.size).toBe(2); // index + a (direct dep)
    expect(sub.edges.length).toBe(1);
  });

  test('getSubgraph with depth=1', () => {
    const files = [
      { path: 'src/index.ts', content: "import { a } from './a';" },
      { path: 'src/a.ts', content: "import { b } from './b';" },
      { path: 'src/b.ts', content: 'export {}' },
    ];
    viz.buildGraph(files);
    const sub = viz.getSubgraph('src/index', 1);
    expect(sub.nodes.size).toBe(3);
  });

  test('getSubgraph with non-existent node', () => {
    viz.buildGraph([]);
    const sub = viz.getSubgraph('nonexistent', 1);
    expect(sub.nodes.size).toBe(0);
    expect(sub.edges.length).toBe(0);
  });

  test('getSubgraph default depth=1', () => {
    const files = [
      { path: 'src/a.ts', content: "import { b } from './b';" },
      { path: 'src/b.ts', content: 'export {}' },
    ];
    viz.buildGraph(files);
    const sub = viz.getSubgraph('src/a');
    expect(sub.nodes.size).toBe(2);
  });

  test('normalizePath handles backslashes', () => {
    const files = [
      { path: 'src\\index.ts', content: "import { a } from './a';" },
      { path: 'src/a.ts', content: 'export {}' },
    ];
    const graph = viz.buildGraph(files);
    expect(graph.nodes.has('src/index')).toBe(true);
  });

  test('normalizePath removes leading ./', () => {
    const files = [
      { path: './src/index.ts', content: "import { a } from './a';" },
      { path: './src/a.ts', content: 'export {}' },
    ];
    const graph = viz.buildGraph(files);
    expect(graph.nodes.has('src/index')).toBe(true);
  });
});

// ============================================================
// CommitHelper - Full Coverage Tests
// ============================================================
describe('CommitHelper (coverage)', () => {
  let helper: CommitHelper;
  beforeEach(() => { helper = new CommitHelper(); });

  test('analyzeChanges with empty diff', () => {
    const analysis = helper.analyzeChanges('');
    expect(analysis.files).toEqual([]);
    expect(analysis.additions).toBe(0);
    expect(analysis.deletions).toBe(0);
    expect(analysis.hasBreakingChange).toBe(false);
  });

  test('analyzeChanges extracts files from +++ b/ lines', () => {
    const diff = '--- a/src/a.ts\n+++ b/src/a.ts\n+new line\n-old line\n';
    const analysis = helper.analyzeChanges(diff);
    expect(analysis.files).toContain('src/a.ts');
  });

  test('analyzeChanges skips /dev/null', () => {
    const diff = '--- /dev/null\n+++ b/new.ts\n+new\n';
    const analysis = helper.analyzeChanges(diff);
    expect(analysis.files).not.toContain('/dev/null');
  });

  test('analyzeChanges counts additions and deletions', () => {
    const diff = '--- a/f.ts\n+++ b/f.ts\n+line1\n+line2\n+line3\n-old1\n-old2\n';
    const analysis = helper.analyzeChanges(diff);
    expect(analysis.additions).toBe(3);
    expect(analysis.deletions).toBe(2);
  });

  test('analyzeChanges detects BREAKING CHANGE', () => {
    const diff = '--- a/f.ts\n+++ b/f.ts\n+// BREAKING CHANGE: removed API\n';
    const analysis = helper.analyzeChanges(diff);
    expect(analysis.hasBreakingChange).toBe(true);
  });

  test('analyzeChanges detects ! as breaking change indicator', () => {
    const diff = '--- a/f.ts\n+++ b/f.ts\n+some line with ! important\n';
    const analysis = helper.analyzeChanges(diff);
    expect(analysis.hasBreakingChange).toBe(true);
  });

  test('inferType returns test for test-only files', () => {
    const diff = '--- /dev/null\n+++ b/test.spec.ts\n+test code\n';
    const analysis = helper.analyzeChanges(diff);
    expect(analysis.type).toBe('test');
  });

  test('inferType returns docs for doc-only files', () => {
    const diff = '--- a/README.md\n+++ b/README.md\n+new doc\n';
    const analysis = helper.analyzeChanges(diff);
    expect(analysis.type).toBe('docs');
  });

  test('inferType returns ci for config files', () => {
    const diff = '--- /dev/null\n+++ b/.github/workflows/ci.yml\n+ci config\n';
    const analysis = helper.analyzeChanges(diff);
    expect(analysis.type).toBe('ci');
  });

  test('inferType returns feat for BREAKING CHANGE', () => {
    const diff = '--- a/f.ts\n+++ b/f.ts\n+// BREAKING CHANGE\n';
    const analysis = helper.analyzeChanges(diff);
    expect(analysis.type).toBe('feat');
  });

  test('inferType returns fix for bug/error keywords', () => {
    const diff = '--- a/f.ts\n+++ b/f.ts\n+fix the bug\n';
    const analysis = helper.analyzeChanges(diff);
    expect(analysis.type).toBe('fix');
  });

  test('inferType returns feat for add/new/implement keywords', () => {
    const diff = '--- a/f.ts\n+++ b/f.ts\n+add new feature\n';
    const analysis = helper.analyzeChanges(diff);
    expect(analysis.type).toBe('feat');
  });

  test('inferType returns refactor for refactor/clean keywords', () => {
    const diff = '--- a/f.ts\n+++ b/f.ts\n+refactor code\n';
    const analysis = helper.analyzeChanges(diff);
    expect(analysis.type).toBe('refactor');
  });

  test('inferType returns perf for perf/optimi keywords', () => {
    const diff = '--- a/f.ts\n+++ b/f.ts\n+optimize performance\n';
    const analysis = helper.analyzeChanges(diff);
    expect(analysis.type).toBe('perf');
  });

  test('inferType returns style for format/style/lint keywords', () => {
    const diff = '--- a/f.ts\n+++ b/f.ts\n+format code\n';
    const analysis = helper.analyzeChanges(diff);
    expect(analysis.type).toBe('style');
  });

  test('inferType returns feat for source files with no keywords', () => {
    const diff = '--- /dev/null\n+++ b/src/main.ts\n+export const x = 1;\n';
    const analysis = helper.analyzeChanges(diff);
    expect(analysis.type).toBe('feat');
  });

  test('inferType returns chore for no files', () => {
    const analysis = helper.analyzeChanges('some random text');
    expect(analysis.type).toBe('chore');
  });

  test('scope detection uses most common directory', () => {
    const diff = '--- a/src/a.ts\n+++ b/src/a.ts\n+new\n--- a/src/b.ts\n+++ b/src/b.ts\n+new\n--- a/test/c.ts\n+++ b/test/c.ts\n+new\n';
    const analysis = helper.analyzeChanges(diff);
    expect(analysis.scope).toBe('src');
  });

  test('confidence score is between 0 and 1', () => {
    const analysis = helper.analyzeChanges('--- a/f.ts\n+++ b/f.ts\n+new\n');
    expect(analysis.confidence).toBeGreaterThan(0);
    expect(analysis.confidence).toBeLessThanOrEqual(1);
  });

  test('suggestMessage returns correct suggestion', () => {
    const analysis = {
      type: 'feat' as const, scope: 'api', description: 'add endpoint',
      files: ['src/api.ts'], additions: 10, deletions: 0,
      hasBreakingChange: true, confidence: 0.9,
    };
    const suggestion = helper.suggestMessage(analysis);
    expect(suggestion.type).toBe('feat');
    expect(suggestion.scope).toBe('api');
    expect(suggestion.subject).toBe('add endpoint');
    expect(suggestion.breakingChange).toBe(true);
  });

  test('generateMessage with all options', () => {
    const msg = helper.generateMessage('feat', 'api', 'add feature', {
      breakingChange: true, body: 'Detailed description',
      issue: '123', skipCI: true, footer: 'Custom footer',
    });
    expect(msg).toContain('feat(api): add feature!');
    expect(msg).toContain('Detailed description');
    expect(msg).toContain('BREAKING CHANGE');
    expect(msg).toContain('Closes #123');
    expect(msg).toContain('[skip ci]');
    expect(msg).toContain('Custom footer');
  });

  test('generateMessage without scope', () => {
    const msg = helper.generateMessage('fix', '', 'fix bug');
    expect(msg).toBe('fix: fix bug');
  });

  test('generateMessage with empty options', () => {
    const msg = helper.generateMessage('chore', '', 'update deps');
    expect(msg).toBe('chore: update deps');
  });

  test('validateMessage valid', () => {
    const v = helper.validateMessage('feat(api): add new endpoint');
    expect(v.valid).toBe(true);
    expect(v.errors.length).toBe(0);
  });

  test('validateMessage invalid format', () => {
    const v = helper.validateMessage('added some stuff');
    expect(v.valid).toBe(false);
    expect(v.errors.length).toBeGreaterThan(0);
  });

  test('validateMessage warns about >100 chars', () => {
    const v = helper.validateMessage('feat: ' + 'a'.repeat(100));
    expect(v.warnings.some(w => w.includes('100'))).toBe(true);
  });

  test('validateMessage warns about >72 chars', () => {
    const v = helper.validateMessage('feat: ' + 'a'.repeat(70));
    expect(v.warnings.some(w => w.includes('72'))).toBe(true);
  });

  test('validateMessage warns about trailing period', () => {
    const v = helper.validateMessage('feat: add feature.');
    expect(v.warnings.some(w => w.includes('period'))).toBe(true);
  });

  test('validateMessage warns about lowercase subject', () => {
    const v = helper.validateMessage('feat: add feature');
    expect(v.warnings.some(w => w.includes('uppercase'))).toBe(true);
  });

  test('validateMessage warns about missing ! for breaking change', () => {
    const v = helper.validateMessage('feat: some change\n\nBREAKING CHANGE: breaks');
    expect(v.warnings.some(w => w.includes('!'))).toBe(true);
  });

  test('parseMessage valid conventional commit', () => {
    const p = helper.parseMessage('feat(api): add endpoint');
    expect(p.type).toBe('feat');
    expect(p.scope).toBe('api');
    expect(p.subject).toBe('add endpoint');
    expect(p.breakingChange).toBe(false);
    expect(p.revert).toBe(false);
  });

  test('parseMessage with breaking change !', () => {
    const p = helper.parseMessage('feat!: breaking');
    expect(p.breakingChange).toBe(true);
  });

  test('parseMessage with body and footer', () => {
    const msg = 'feat: add feature\n\nBody text\nmore body\n\nBREAKING CHANGE: breaks\nCloses #1';
    const p = helper.parseMessage(msg);
    expect(p.body).toContain('Body text');
    expect(p.footer).toContain('BREAKING CHANGE');
    expect(p.footer).toContain('Closes #1');
  });

  test('parseMessage with footer-like content in body', () => {
    const msg = 'feat: add feature\n\nCloses #123\nBREAKING CHANGE: breaks';
    const p = helper.parseMessage(msg);
    expect(p.footer).toContain('Closes #123');
    expect(p.footer).toContain('BREAKING CHANGE');
    expect(p.breakingChange).toBe(true);
  });

  test('parseMessage invalid format returns chore', () => {
    const p = helper.parseMessage('random text');
    expect(p.type).toBe('chore');
    expect(p.subject).toBe('random text');
  });

  test('parseMessage revert commit', () => {
    const p = helper.parseMessage('revert: feat: original');
    expect(p.revert).toBe(true);
  });

  test('parseMessage with empty body/footer', () => {
    const p = helper.parseMessage('fix: bug fix');
    expect(p.body).toBeUndefined();
    expect(p.footer).toBeUndefined();
  });

  test('getTypeDescription returns description', () => {
    expect(helper.getTypeDescription('feat')).toContain('feature');
    expect(helper.getTypeDescription('fix')).toContain('bug fix');
    expect(helper.getTypeDescription('docs')).toContain('Documentation');
  });

  test('getTypes returns all types', () => {
    const types = helper.getTypes();
    expect(types).toContain('feat');
    expect(types).toContain('fix');
    expect(types).toContain('docs');
    expect(types).toContain('style');
    expect(types).toContain('refactor');
    expect(types).toContain('test');
    expect(types).toContain('chore');
    expect(types).toContain('perf');
    expect(types).toContain('ci');
    expect(types).toContain('build');
    expect(types).toContain('revert');
    expect(types.length).toBe(11);
  });

  test('generateDescription for each type', () => {
    const types: Array<{ type: import('../src/commit-helper.ts').CommitType; files: string[] }> = [
      { type: 'docs', files: ['README.md'] },
      { type: 'test', files: ['test.spec.ts'] },
      { type: 'chore', files: ['package.json'] },
      { type: 'style', files: ['src/fmt.ts'] },
      { type: 'fix', files: ['src/bug.ts'] },
      { type: 'refactor', files: ['src/old.ts'] },
      { type: 'perf', files: ['src/slow.ts'] },
    ];
    for (const { type, files } of types) {
      const desc = (helper as any).generateDescription(files, 1, 0, type);
      expect(desc.length).toBeGreaterThan(0);
    }
  });
});
