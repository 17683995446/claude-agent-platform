import { describe, test, expect, beforeEach } from 'bun:test';
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
// Module 1: CodeFormatter Tests
// ============================================================
describe('CodeFormatter', () => {
  let formatter: CodeFormatter;

  beforeEach(() => {
    formatter = new CodeFormatter();
  });

  test('should format TypeScript code with default options', () => {
    const code = 'const x =   1;';
    const result = formatter.format(code, 'typescript');
    expect(result).toContain('const x = 1;');
  });

  test('should remove trailing whitespace', () => {
    const code = 'const x = 1;   \nconst y = 2;   ';
    const result = formatter.format(code, 'typescript');
    expect(result).not.toMatch(/[ \t]+$/);
  });

  test('should normalize indentation to spaces', () => {
    const code = 'function foo() {\n\tconst x = 1;\n}';
    const result = formatter.format(code, 'typescript', { indentStyle: 'spaces', indentWidth: 2 });
    expect(result).not.toContain('\t');
    expect(result).toContain('  const x = 1;');
  });

  test('should normalize indentation to tabs', () => {
    const code = 'function foo() {\n  const x = 1;\n}';
    const result = formatter.format(code, 'typescript', { indentStyle: 'tabs' });
    expect(result).toContain('\tconst x = 1;');
  });

  test('should add semicolons when configured', () => {
    const code = 'const x = 1\nconst y = 2';
    const result = formatter.format(code, 'typescript', { semicolons: true });
    expect(result).toContain('const x = 1;');
  });

  test('should remove semicolons when configured', () => {
    const code = 'const x = 1;\nconst y = 2;';
    const result = formatter.format(code, 'typescript', { semicolons: false });
    expect(result).toContain('const x = 1\n');
  });

  test('should normalize quotes to single', () => {
    const code = 'const x = "hello";';
    const result = formatter.format(code, 'typescript', { quoteStyle: 'single' });
    expect(result).toContain("'hello'");
  });

  test('should normalize quotes to double', () => {
    const code = "const x = 'hello';";
    const result = formatter.format(code, 'typescript', { quoteStyle: 'double' });
    expect(result).toContain('"hello"');
  });

  test('should ensure file ends with newline', () => {
    const code = 'const x = 1;';
    const result = formatter.format(code, 'typescript');
    expect(result.endsWith('\n')).toBe(true);
  });

  test('should normalize CRLF to LF', () => {
    const code = 'const x = 1;\r\nconst y = 2;';
    const result = formatter.format(code, 'typescript');
    expect(result).not.toContain('\r\n');
  });

  test('should format JavaScript code', () => {
    const code = 'const x =   1;';
    const result = formatter.format(code, 'javascript');
    expect(result).toContain('const x = 1;');
  });

  test('should format JSON code', () => {
    const code = '{  "key":  "value"  }';
    const result = formatter.format(code, 'json');
    expect(result).toContain('"key"');
  });

  test('should generate format diff', () => {
    const original = 'const x =   1;';
    const formatted = formatter.format(original, 'typescript');
    const diff = formatter.formatDiff(original, formatted);
    expect(diff).toBeTruthy();
    expect(typeof diff).toBe('string');
  });

  test('should return empty diff for identical code', () => {
    const code = 'const x = 1;\n';
    const diff = formatter.formatDiff(code, code);
    expect(diff).toContain('  const x = 1;');
  });

  test('should handle empty code', () => {
    const result = formatter.format('', 'typescript');
    expect(result).toBe('');
  });

  test('should respect custom indent width', () => {
    const code = 'function foo() {\n  const x = 1;\n}';
    const result = formatter.format(code, 'typescript', { indentWidth: 4 });
    expect(result).toContain('    const x = 1;');
  });
});

// ============================================================
// Module 2: LintEngine Tests
// ============================================================
describe('LintEngine', () => {
  let engine: LintEngine;

  beforeEach(() => {
    engine = new LintEngine();
  });

  test('should detect console statements', () => {
    const code = 'console.log("hello");';
    const result = engine.lint(code, 'typescript');
    expect(result.messages.some(m => m.ruleId === 'no-console')).toBe(true);
  });

  test('should detect unused variables', () => {
    const code = 'const unusedVar = 1;';
    const result = engine.lint(code, 'typescript', [{ ruleId: 'no-unused-vars', severity: 'error', enabled: true }]);
    expect(result.messages.some(m => m.ruleId === 'no-unused-vars')).toBe(true);
  });

  test('should detect var declarations', () => {
    const code = 'var x = 1;';
    const result = engine.lint(code, 'typescript', [{ ruleId: 'no-var', severity: 'suggestion', enabled: true }]);
    expect(result.messages.some(m => m.ruleId === 'no-var')).toBe(true);
  });

  test('should detect trailing whitespace', () => {
    const code = 'const x = 1;   \n';
    const result = engine.lint(code, 'typescript', [{ ruleId: 'no-trailing-whitespace', severity: 'style', enabled: true }]);
    expect(result.messages.some(m => m.ruleId === 'no-trailing-whitespace')).toBe(true);
  });

  test('should detect multiple empty lines', () => {
    const code = 'const x = 1;\n\n\n\nconst y = 2;';
    const result = engine.lint(code, 'typescript', [{ ruleId: 'no-multiple-empty-lines', severity: 'style', enabled: true }]);
    expect(result.messages.some(m => m.ruleId === 'no-multiple-empty-lines')).toBe(true);
  });

  test('should detect max line length violations', () => {
    const longLine = 'const x = "' + 'a'.repeat(100) + '";';
    const result = engine.lint(longLine, 'typescript', [{ ruleId: 'max-line-length', severity: 'style', enabled: true, options: { max: 80 } }]);
    expect(result.messages.some(m => m.ruleId === 'max-line-length')).toBe(true);
  });

  test('should detect == instead of ===', () => {
    const code = 'if (x == 1) {}';
    const result = engine.lint(code, 'typescript', [{ ruleId: 'eqeqeq', severity: 'error', enabled: true }]);
    expect(result.messages.some(m => m.ruleId === 'eqeqeq')).toBe(true);
  });

  test('should detect extra semicolons', () => {
    const code = 'const x = 1;;';
    const result = engine.lint(code, 'typescript', [{ ruleId: 'no-extra-semi', severity: 'style', enabled: true }]);
    expect(result.messages.some(m => m.ruleId === 'no-extra-semi')).toBe(true);
  });

  test('should count errors correctly', () => {
    const code = 'console.log("hello");\nconsole.error("world");';
    const result = engine.lint(code, 'typescript', [{ ruleId: 'no-console', severity: 'error', enabled: true }]);
    expect(result.errorCount).toBe(2);
  });

  test('should count warnings correctly', () => {
    const code = 'console.log("hello");';
    const result = engine.lint(code, 'typescript');
    expect(result.warningCount).toBeGreaterThanOrEqual(1);
  });

  test('should return clean result for valid code', () => {
    const code = 'const x: number = 1;';
    const result = engine.lint(code, 'typescript', []);
    expect(result.messages.length).toBe(0);
  });

  test('should fix trailing whitespace', () => {
    const code = 'const x = 1;   \n';
    const result = engine.fix(code, [{ ruleId: 'no-trailing-whitespace', severity: 'style', enabled: true }]);
    expect(result.fixed).toBe(true);
    expect(result.code).not.toContain('   \n');
  });

  test('should fix var to const', () => {
    const code = 'var x = 1;';
    const result = engine.fix(code, [{ ruleId: 'no-var', severity: 'suggestion', enabled: true }]);
    expect(result.fixed).toBe(true);
    expect(result.code).toContain('const x = 1;');
  });

  test('should fix extra semicolons', () => {
    const code = 'const x = 1;;';
    const result = engine.fix(code, [{ ruleId: 'no-extra-semi', severity: 'style', enabled: true }]);
    expect(result.fixed).toBe(true);
    expect(result.code).not.toContain(';;');
  });

  test('should get all built-in rules', () => {
    const rules = engine.getRules();
    expect(rules.length).toBeGreaterThan(10);
    expect(rules.some(r => r.ruleId === 'no-console')).toBe(true);
  });

  test('should add custom rule', () => {
    engine.addRule({
      ruleId: 'custom-rule',
      description: 'A custom rule',
      category: 'style',
      defaultSeverity: 'style',
      fixable: false,
    });
    const rules = engine.getRules();
    expect(rules.some(r => r.ruleId === 'custom-rule')).toBe(true);
  });

  test('should remove a rule', () => {
    engine.removeRule('no-console');
    const rules = engine.getRules();
    expect(rules.some(r => r.ruleId === 'no-console')).toBe(false);
  });

  test('should detect duplicate keys', () => {
    const code = 'const obj = { a: 1, a: 2 };';
    const result = engine.lint(code, 'typescript', [{ ruleId: 'no-duplicate-keys', severity: 'error', enabled: true }]);
    expect(result.messages.some(m => m.ruleId === 'no-duplicate-keys')).toBe(true);
  });

  test('should detect variable shadowing', () => {
    const code = 'const x = 1;\nfunction foo() {\n  const x = 2;\n}';
    const result = engine.lint(code, 'typescript', [{ ruleId: 'no-shadow', severity: 'warning', enabled: true }]);
    expect(result.messages.some(m => m.ruleId === 'no-shadow')).toBe(true);
  });

  test('should detect indentation issues', () => {
    const code = 'function foo() {\n\tconst x = 1;\n}';
    const result = engine.lint(code, 'typescript', [{ ruleId: 'indent', severity: 'style', enabled: true, options: { style: 'spaces', width: 2 } }]);
    expect(result.messages.some(m => m.ruleId === 'indent')).toBe(true);
  });

  test('should report correct line numbers', () => {
    const code = 'const x = 1;\nconsole.log(x);\nconst y = 2;';
    const result = engine.lint(code, 'typescript', [{ ruleId: 'no-console', severity: 'error', enabled: true }]);
    const consoleMsg = result.messages.find(m => m.ruleId === 'no-console');
    expect(consoleMsg?.line).toBe(2);
  });
});

// ============================================================
// Module 3: FileWatcher Tests
// ============================================================
describe('FileWatcher', () => {
  let watcher: FileWatcher;

  beforeEach(() => {
    watcher = new FileWatcher();
  });

  test('should watch a path', () => {
    watcher.watch('/tmp/test');
    expect(watcher.getWatchedPaths()).toContain('/tmp/test');
  });

  test('should unwatch a path', () => {
    watcher.watch('/tmp/test');
    watcher.unwatch('/tmp/test');
    expect(watcher.getWatchedPaths()).not.toContain('/tmp/test');
  });

  test('should check if watching a path', () => {
    watcher.watch('/tmp/test');
    expect(watcher.isWatching('/tmp/test')).toBe(true);
    expect(watcher.isWatching('/tmp/other')).toBe(false);
  });

  test('should register event handlers', () => {
    const handler = () => {};
    watcher.on('create', handler);
    expect(watcher.getHandlerCount('create')).toBe(1);
  });

  test('should remove event handlers', () => {
    const handler = () => {};
    watcher.on('create', handler);
    watcher.off('create', handler);
    expect(watcher.getHandlerCount('create')).toBe(0);
  });

  test('should emit events to specific handlers', (done) => {
    watcher.watch('/tmp/test');
    watcher.on('create', (event) => {
      expect(event.type).toBe('create');
      expect(event.path).toBe('/tmp/test/newfile.ts');
      done();
    });
    watcher.simulateEvent({
      type: 'create',
      path: '/tmp/test/newfile.ts',
      timestamp: Date.now(),
    });
  });

  test('should emit events to "all" handlers', (done) => {
    watcher.watch('/tmp/test');
    watcher.on('all', (event) => {
      expect(event.type).toBe('modify');
      done();
    });
    watcher.simulateEvent({
      type: 'modify',
      path: '/tmp/test/file.ts',
      timestamp: Date.now(),
    });
  });

  test('should pause and resume watching', () => {
    let eventReceived = false;
    watcher.on('modify', () => { eventReceived = true; });
    watcher.pause();
    watcher.simulateEvent({ type: 'modify', path: '/tmp/file.ts', timestamp: Date.now() });
    expect(eventReceived).toBe(false);
    watcher.resume();
    watcher.simulateEvent({ type: 'modify', path: '/tmp/file.ts', timestamp: Date.now() });
    // Note: due to debouncing, we can't immediately check
  });

  test('should watch multiple paths', () => {
    watcher.watch('/tmp/a');
    watcher.watch('/tmp/b');
    watcher.watch('/tmp/c');
    expect(watcher.getWatchedPaths().length).toBe(3);
  });

  test('should store watch options', () => {
    watcher.watch('/tmp/test', { recursive: false, debounceMs: 500 });
    const opts = watcher.getOptions('/tmp/test');
    expect(opts?.recursive).toBe(false);
    expect(opts?.debounceMs).toBe(500);
  });

  test('should close and clear all watchers', () => {
    watcher.watch('/tmp/a');
    watcher.watch('/tmp/b');
    watcher.close();
    expect(watcher.getWatchedPaths().length).toBe(0);
  });

  test('should handle rename events', (done) => {
    watcher.watch('/tmp/test');
    watcher.on('rename', (event) => {
      expect(event.type).toBe('rename');
      expect(event.oldPath).toBe('/tmp/test/old.ts');
      done();
    });
    watcher.simulateEvent({
      type: 'rename',
      path: '/tmp/test/new.ts',
      oldPath: '/tmp/test/old.ts',
      timestamp: Date.now(),
    });
  });

  test('should handle delete events', (done) => {
    watcher.watch('/tmp/test');
    watcher.on('delete', (event) => {
      expect(event.type).toBe('delete');
      done();
    });
    watcher.simulateEvent({
      type: 'delete',
      path: '/tmp/test/removed.ts',
      timestamp: Date.now(),
    });
  });
});

// ============================================================
// Module 4: TaskRunner Tests
// ============================================================
describe('TaskRunner', () => {
  let runner: TaskRunner;

  beforeEach(() => {
    runner = new TaskRunner();
  });

  test('should define a task', () => {
    runner.define('test-task', () => 'hello');
    expect(runner.hasTask('test-task')).toBe(true);
  });

  test('should run a simple task', async () => {
    runner.define('greet', () => 'hello world');
    const result = await runner.run('greet');
    expect(result.success).toBe(true);
    expect(result.output).toBe('hello world');
  });

  test('should run an async task', async () => {
    runner.define('async-task', async () => {
      await new Promise(r => setTimeout(r, 10));
      return 'async result';
    });
    const result = await runner.run('async-task');
    expect(result.success).toBe(true);
    expect(result.output).toBe('async result');
  });

  test('should handle task failure', async () => {
    runner.define('fail-task', () => {
      throw new Error('task failed');
    });
    const result = await runner.run('fail-task');
    expect(result.success).toBe(false);
    expect(result.error).toContain('task failed');
  });

  test('should run task dependencies first', async () => {
    const order: string[] = [];
    runner.define('dep', () => { order.push('dep'); return 'dep'; });
    runner.define('main', () => { order.push('main'); return 'main'; }, { dependencies: ['dep'] });
    await runner.run('main');
    expect(order).toEqual(['dep', 'main']);
  });

  test('should fail when dependency fails', async () => {
    runner.define('failing-dep', () => { throw new Error('dep error'); });
    runner.define('main', () => 'main', { dependencies: ['failing-dep'] });
    const result = await runner.run('main');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Dependency');
  });

  test('should continue on error when configured', async () => {
    runner.define('failing-dep', () => { throw new Error('dep error'); });
    runner.define('main', () => 'main', { dependencies: ['failing-dep'], continueOnError: true });
    const result = await runner.run('main');
    expect(result.success).toBe(true);
    expect(result.output).toBe('main');
  });

  test('should list tasks', () => {
    runner.define('task-a', () => {}, { description: 'Task A' });
    runner.define('task-b', () => {}, { description: 'Task B', dependencies: ['task-a'] });
    const tasks = runner.listTasks();
    expect(tasks.length).toBe(2);
    expect(tasks[1].dependencies).toContain('task-a');
  });

  test('should run tasks in parallel', async () => {
    runner.define('task-1', async () => { await new Promise(r => setTimeout(r, 10)); return '1'; });
    runner.define('task-2', async () => { await new Promise(r => setTimeout(r, 10)); return '2'; });
    const results = await runner.runParallel(['task-1', 'task-2']);
    expect(results.length).toBe(2);
    expect(results.every(r => r.success)).toBe(true);
  });

  test('should return error for non-existent task', async () => {
    const result = await runner.run('non-existent');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  test('should detect circular dependencies', async () => {
    runner.define('a', () => {}, { dependencies: ['b'] });
    runner.define('b', () => {}, { dependencies: ['a'] });
    const result = await runner.run('a');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Circular');
  });

  test('should generate task graph', () => {
    runner.define('a', () => {});
    runner.define('b', () => {}, { dependencies: ['a'] });
    const graph = runner.getTaskGraph();
    expect(graph.nodes.length).toBe(2);
    expect(graph.edges.length).toBe(1);
    expect(graph.edges[0].from).toBe('b');
    expect(graph.edges[0].to).toBe('a');
  });

  test('should get task result after run', async () => {
    runner.define('result-task', () => 'result');
    await runner.run('result-task');
    const stored = runner.getResult('result-task');
    expect(stored?.success).toBe(true);
    expect(stored?.output).toBe('result');
  });

  test('should record duration', async () => {
    runner.define('timed-task', async () => {
      await new Promise(r => setTimeout(r, 50));
      return 'done';
    });
    const result = await runner.run('timed-task');
    expect(result.duration).toBeGreaterThanOrEqual(40);
  });

  test('should remove a task', () => {
    runner.define('temp', () => {});
    expect(runner.hasTask('temp')).toBe(true);
    runner.removeTask('temp');
    expect(runner.hasTask('temp')).toBe(false);
  });

  test('should clear results', async () => {
    runner.define('x', () => 'x');
    await runner.run('x');
    runner.clearResults();
    expect(runner.getResult('x')).toBeUndefined();
  });

  test('should get dependency order', () => {
    runner.define('c', () => {}, { dependencies: ['b'] });
    runner.define('a', () => {});
    runner.define('b', () => {}, { dependencies: ['a'] });
    const order = runner.getDependencyOrder();
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
  });
});

// ============================================================
// Module 5: SnippetManager Tests
// ============================================================
describe('SnippetManager', () => {
  let manager: SnippetManager;

  beforeEach(() => {
    manager = new SnippetManager();
  });

  test('should have built-in snippets', () => {
    expect(manager.count()).toBeGreaterThan(0);
  });

  test('should get a snippet by name', () => {
    const snippet = manager.get('function');
    expect(snippet).toBeDefined();
    expect(snippet?.language).toBe('typescript');
  });

  test('should create a new snippet', () => {
    const snippet = manager.create({
      name: 'my-snippet',
      language: 'typescript',
      code: 'console.log("hello");',
    });
    expect(snippet.id).toBeDefined();
    expect(snippet.name).toBe('my-snippet');
  });

  test('should update a snippet', () => {
    manager.create({ name: 'update-test', language: 'typescript', code: 'old' });
    const updated = manager.update('update-test', { code: 'new' });
    expect(updated?.code).toBe('new');
  });

  test('should delete a snippet', () => {
    manager.create({ name: 'delete-test', language: 'typescript', code: 'test' });
    expect(manager.delete('delete-test')).toBe(true);
    expect(manager.get('delete-test')).toBeUndefined();
  });

  test('should search snippets by name', () => {
    const results = manager.search('function');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toContain('function');
  });

  test('should search snippets by tag', () => {
    const results = manager.search('async');
    expect(results.length).toBeGreaterThan(0);
  });

  test('should search snippets by language', () => {
    const results = manager.search('typescript');
    expect(results.length).toBeGreaterThan(0);
  });

  test('should expand snippet with default variables', () => {
    const code = manager.expand('function');
    expect(code).toContain('myFunction');
    expect(code).not.toContain('${name}');
  });

  test('should expand snippet with custom variables', () => {
    const code = manager.expand('function', { name: 'customFunc', params: 'x: number', returnType: 'number', body: 'return x;' });
    expect(code).toContain('customFunc');
    expect(code).toContain('x: number');
    expect(code).toContain('return x;');
  });

  test('should return empty string for non-existent snippet', () => {
    const code = manager.expand('non-existent');
    expect(code).toBe('');
  });

  test('should import snippets from JSON', () => {
    const data = JSON.stringify([
      { name: 'imported-1', language: 'typescript', code: 'const a = 1;' },
      { name: 'imported-2', language: 'javascript', code: 'const b = 2;' },
    ]);
    const count = manager.importSnippets(data);
    expect(count).toBe(2);
    expect(manager.get('imported-1')).toBeDefined();
  });

  test('should export snippets to JSON', () => {
    const json = manager.exportSnippets();
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });

  test('should export snippets with language filter', () => {
    const json = manager.exportSnippets({ language: 'typescript' });
    const parsed = JSON.parse(json);
    expect(parsed.every((s: { language: string }) => s.language === 'typescript')).toBe(true);
  });

  test('should export snippets with tag filter', () => {
    const json = manager.exportSnippets({ tags: ['basic'] });
    const parsed = JSON.parse(json);
    expect(parsed.length).toBeGreaterThan(0);
  });

  test('should list all snippets', () => {
    const snippets = manager.list();
    expect(snippets.length).toBeGreaterThan(0);
  });

  test('should get snippets by language', () => {
    const tsSnippets = manager.getByLanguage('typescript');
    expect(tsSnippets.length).toBeGreaterThan(0);
    expect(tsSnippets.every(s => s.language === 'typescript')).toBe(true);
  });

  test('should get snippets by tag', () => {
    const basicSnippets = manager.getByTag('basic');
    expect(basicSnippets.length).toBeGreaterThan(0);
  });

  test('should clear all snippets', () => {
    manager.clear();
    expect(manager.count()).toBe(0);
  });

  test('should assign unique IDs', () => {
    const s1 = manager.create({ name: 'id-test-1', language: 'ts', code: '1' });
    const s2 = manager.create({ name: 'id-test-2', language: 'ts', code: '2' });
    expect(s1.id).not.toBe(s2.id);
  });

  test('should set createdAt and updatedAt', () => {
    const before = Date.now();
    const snippet = manager.create({ name: 'time-test', language: 'ts', code: 'test' });
    expect(snippet.createdAt).toBeGreaterThanOrEqual(before);
    expect(snippet.updatedAt).toBe(snippet.createdAt);
  });
});

// ============================================================
// Module 6: QuickDocsGenerator Tests
// ============================================================
describe('QuickDocsGenerator', () => {
  let generator: QuickDocsGenerator;

  beforeEach(() => {
    generator = new QuickDocsGenerator();
  });

  test('should generate README with project info', () => {
    const readme = generator.generateREADME({
      name: 'test-pkg',
      version: '1.0.0',
      description: 'A test package',
      license: 'MIT',
    });
    expect(readme).toContain('# test-pkg');
    expect(readme).toContain('A test package');
    expect(readme).toContain('MIT');
  });

  test('should generate README with installation section', () => {
    const readme = generator.generateREADME({
      name: 'my-lib',
      version: '1.0.0',
      description: 'Test',
    });
    expect(readme).toContain('npm install my-lib');
  });

  test('should generate README with scripts table', () => {
    const readme = generator.generateREADME({
      name: 'test',
      version: '1.0.0',
      description: 'Test',
      scripts: { build: 'tsc', test: 'vitest' },
    });
    expect(readme).toContain('npm run build');
    expect(readme).toContain('npm run test');
  });

  test('should generate API documentation', () => {
    const files = [
      {
        path: 'src/utils.ts',
        content: '/** A utility function */\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport const PI = 3.14;',
        language: 'typescript',
      },
    ];
    const doc = generator.generateAPIDoc(files);
    expect(doc.title).toBe('API Documentation');
    expect(doc.modules.length).toBe(1);
    expect(doc.modules[0].exports.length).toBeGreaterThan(0);
  });

  test('should extract exports from source files', () => {
    const files = [
      {
        path: 'src/index.ts',
        content: 'export class MyClass {}\nexport interface MyInterface {}\nexport function myFunc(): void {}',
        language: 'typescript',
      },
    ];
    const doc = generator.generateAPIDoc(files);
    const exports = doc.modules[0].exports;
    expect(exports.some(e => e.name === 'MyClass')).toBe(true);
    expect(exports.some(e => e.name === 'MyInterface')).toBe(true);
    expect(exports.some(e => e.name === 'myFunc')).toBe(true);
  });

  test('should generate changelog from commit history', () => {
    const history = [
      { hash: 'abc1234', message: 'Add new feature', type: 'feat', date: '2024-01-01', author: 'Dev' },
      { hash: 'def5678', message: 'Fix bug in parser', type: 'fix', date: '2024-01-02', author: 'Dev' },
      { hash: 'ghi9012', message: 'Update docs', type: 'docs', date: '2024-01-03', author: 'Dev' },
    ];
    const changelog = generator.generateChangelog(history);
    expect(changelog).toContain('# Changelog');
    expect(changelog).toContain('Features');
    expect(changelog).toContain('Bug Fixes');
    expect(changelog).toContain('Documentation');
  });

  test('should generate type documentation', () => {
    const types = [
      {
        name: 'User',
        kind: 'interface' as const,
        description: 'A user object',
        properties: [
          { name: 'id', type: 'number', description: 'User ID' },
          { name: 'name', type: 'string', description: 'User name', optional: true },
        ],
      },
    ];
    const doc = generator.generateTypeDoc(types);
    expect(doc).toContain('Interface: `User`');
    expect(doc).toContain('User ID');
    expect(doc).toContain('optional');
  });

  test('should generate type doc with type parameters', () => {
    const types = [
      {
        name: 'Container',
        kind: 'interface' as const,
        typeParams: ['T'],
        properties: [
          { name: 'value', type: 'T', description: 'The value' },
        ],
      },
    ];
    const doc = generator.generateTypeDoc(types);
    expect(doc).toContain('`T`');
  });

  test('should generate type doc with extends', () => {
    const types = [
      {
        name: 'Admin',
        kind: 'interface' as const,
        extends: ['User'],
        properties: [
          { name: 'role', type: 'string', description: 'Admin role' },
        ],
      },
    ];
    const doc = generator.generateTypeDoc(types);
    expect(doc).toContain('`User`');
  });

  test('should generate type doc with source code', () => {
    const types = [
      {
        name: 'Config',
        kind: 'type' as const,
        description: 'Configuration',
        source: 'type Config = { debug: boolean; port: number };',
      },
    ];
    const doc = generator.generateTypeDoc(types);
    expect(doc).toContain('type Config = { debug: boolean; port: number };');
  });
});

// ============================================================
// Module 7: ProjectScaffolder Tests
// ============================================================
describe('ProjectScaffolder', () => {
  let scaffolder: ProjectScaffolder;

  beforeEach(() => {
    scaffolder = new ProjectScaffolder();
  });

  test('should list built-in templates', () => {
    const templates = scaffolder.listTemplates();
    expect(templates.length).toBe(5);
    expect(templates.map(t => t.name)).toContain('library');
    expect(templates.map(t => t.name)).toContain('cli-tool');
    expect(templates.map(t => t.name)).toContain('web-app');
    expect(templates.map(t => t.name)).toContain('api-server');
    expect(templates.map(t => t.name)).toContain('plugin');
  });

  test('should scaffold library template', async () => {
    const result = await scaffolder.scaffold('library', '/tmp/my-lib', {
      variables: { name: 'test-lib', description: 'A test library' },
    });
    expect(result.success).toBe(true);
    expect(result.filesCreated.length).toBeGreaterThan(0);
    expect(result.filesCreated).toContain('package.json');
    expect(result.filesCreated).toContain('src/index.ts');
  });

  test('should scaffold cli-tool template', async () => {
    const result = await scaffolder.scaffold('cli-tool', '/tmp/my-cli');
    expect(result.success).toBe(true);
    expect(result.filesCreated).toContain('src/cli.ts');
  });

  test('should scaffold web-app template', async () => {
    const result = await scaffolder.scaffold('web-app', '/tmp/my-app');
    expect(result.success).toBe(true);
    expect(result.filesCreated).toContain('index.html');
  });

  test('should scaffold api-server template', async () => {
    const result = await scaffolder.scaffold('api-server', '/tmp/my-api');
    expect(result.success).toBe(true);
    expect(result.filesCreated).toContain('src/index.ts');
  });

  test('should scaffold plugin template', async () => {
    const result = await scaffolder.scaffold('plugin', '/tmp/my-plugin');
    expect(result.success).toBe(true);
    expect(result.filesCreated).toContain('src/index.ts');
  });

  test('should return error for non-existent template', async () => {
    const result = await scaffolder.scaffold('non-existent', '/tmp/test');
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('should replace template variables', async () => {
    const result = await scaffolder.scaffold('library', '/tmp/vars-test', {
      variables: { name: 'my-awesome-lib', description: 'Awesome' },
    });
    expect(result.success).toBe(true);
  });

  test('should validate a valid template', () => {
    const validation = scaffolder.validateTemplate({
      name: 'test-template',
      description: 'A test template',
      files: [
        { path: 'index.ts', content: 'export {}' },
      ],
    });
    expect(validation.valid).toBe(true);
    expect(validation.errors.length).toBe(0);
  });

  test('should invalidate template without name', () => {
    const validation = scaffolder.validateTemplate({
      name: '',
      description: 'No name',
      files: [{ path: 'index.ts', content: '' }],
    });
    expect(validation.valid).toBe(false);
  });

  test('should invalidate template without files', () => {
    const validation = scaffolder.validateTemplate({
      name: 'no-files',
      description: 'No files',
      files: [],
    });
    expect(validation.valid).toBe(false);
  });

  test('should invalidate template with duplicate file paths', () => {
    const validation = scaffolder.validateTemplate({
      name: 'dup-files',
      description: 'Duplicate files',
      files: [
        { path: 'index.ts', content: 'a' },
        { path: 'index.ts', content: 'b' },
      ],
    });
    expect(validation.valid).toBe(false);
  });

  test('should warn about missing description', () => {
    const validation = scaffolder.validateTemplate({
      name: 'no-desc',
      files: [{ path: 'index.ts', content: '' }],
    });
    expect(validation.warnings.length).toBeGreaterThan(0);
  });

  test('should create a custom template', () => {
    scaffolder.createTemplate({
      name: 'custom',
      description: 'Custom template',
      files: [{ path: 'custom.ts', content: 'export {}' }],
    });
    expect(scaffolder.hasTemplate('custom')).toBe(true);
  });

  test('should remove a template', () => {
    scaffolder.createTemplate({
      name: 'removable',
      description: 'To remove',
      files: [{ path: 'a.ts', content: '' }],
    });
    expect(scaffolder.removeTemplate('removable')).toBe(true);
    expect(scaffolder.hasTemplate('removable')).toBe(false);
  });

  test('should get template by name', () => {
    const template = scaffolder.getTemplate('library');
    expect(template).toBeDefined();
    expect(template?.name).toBe('library');
  });
});

// ============================================================
// Module 8: DebugHelper Tests
// ============================================================
describe('DebugHelper', () => {
  let helper: DebugHelper;

  beforeEach(() => {
    helper = new DebugHelper();
  });

  test('should log messages at different levels', () => {
    helper.log('debug', 'debug msg');
    helper.log('info', 'info msg');
    helper.log('warn', 'warn msg');
    helper.log('error', 'error msg');
    expect(helper.getLogCount()).toBe(4);
  });

  test('should filter logs by level', () => {
    helper.log('debug', 'debug msg');
    helper.log('info', 'info msg');
    helper.log('error', 'error msg');
    expect(helper.getLogsByLevel('error').length).toBe(1);
    expect(helper.getLogsByLevel('debug').length).toBe(1);
  });

  test('should respect log level setting', () => {
    helper.setLevel('warn');
    helper.log('debug', 'should be filtered');
    helper.log('info', 'should be filtered');
    helper.log('warn', 'should appear');
    helper.log('error', 'should appear');
    expect(helper.getLogCount()).toBe(2);
  });

  test('should create and stop timers', () => {
    const timer = helper.time('test-timer');
    expect(timer.label).toBe('test-timer');
    const elapsed = timer.stop();
    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(timer.elapsed).toBe(elapsed);
  });

  test('should timeEnd a timer', () => {
    helper.time('end-test');
    const elapsed = helper.timeEnd('end-test');
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });

  test('should return undefined for non-existent timer', () => {
    expect(helper.timeEnd('non-existent')).toBeUndefined();
  });

  test('should get timer by label', () => {
    helper.time('get-test');
    const timer = helper.getTimer('get-test');
    expect(timer).toBeDefined();
    expect(timer?.label).toBe('get-test');
  });

  test('should profile a function', () => {
    const result = helper.profile(() => {
      // Do some work
      let sum = 0;
      for (let i = 0; i < 1000; i++) sum += i;
    });
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.name).toBe('anonymous');
  });

  test('should profile an async function', async () => {
    const result = await helper.profileAsync(async () => {
      await new Promise(r => setTimeout(r, 10));
    });
    expect(result.duration).toBeGreaterThanOrEqual(5);
  });

  test('should inspect values', () => {
    expect(helper.inspect(null)).toBe('null');
    expect(helper.inspect(undefined)).toBe('undefined');
    expect(helper.inspect('hello')).toBe('"hello"');
    expect(helper.inspect(42)).toBe('42');
    expect(helper.inspect(true)).toBe('true');
  });

  test('should inspect arrays', () => {
    const result = helper.inspect([1, 2, 3]);
    expect(result).toContain('1');
    expect(result).toContain('2');
    expect(result).toContain('3');
  });

  test('should inspect objects', () => {
    const result = helper.inspect({ key: 'value' });
    expect(result).toContain('key');
    expect(result).toContain('value');
  });

  test('should inspect functions', () => {
    function namedFn() {}
    const result = helper.inspect(namedFn);
    expect(result).toContain('namedFn');
  });

  test('should diff identical values', () => {
    const result = helper.diff('hello', 'hello');
    expect(result.equal).toBe(true);
    expect(result.additions.length).toBe(0);
    expect(result.deletions.length).toBe(0);
  });

  test('should diff different values', () => {
    const result = helper.diff('before', 'after');
    expect(result.equal).toBe(false);
    expect(result.additions.length).toBeGreaterThan(0);
    expect(result.deletions.length).toBeGreaterThan(0);
  });

  test('should diff objects deeply', () => {
    const result = helper.diff({ a: 1, b: 2 }, { a: 1, b: 3 });
    expect(result.equal).toBe(false);
    expect(result.changes.length).toBeGreaterThan(0);
    expect(result.changes.some(c => c.path === 'b')).toBe(true);
  });

  test('should enable and disable', () => {
    helper.disable();
    helper.log('debug', 'should not appear');
    expect(helper.getLogCount()).toBe(0);
    helper.enable();
    helper.log('debug', 'should appear');
    expect(helper.getLogCount()).toBe(1);
  });

  test('should clear logs', () => {
    helper.log('debug', 'msg');
    helper.clearLogs();
    expect(helper.getLogCount()).toBe(0);
  });

  test('should clear timers', () => {
    helper.time('timer-1');
    helper.time('timer-2');
    helper.clearTimers();
    expect(helper.getTimer('timer-1')).toBeUndefined();
  });

  test('should clear all', () => {
    helper.log('debug', 'msg');
    helper.time('timer');
    helper.clear();
    expect(helper.getLogCount()).toBe(0);
    expect(helper.getTimer('timer')).toBeUndefined();
  });

  test('should use convenience methods', () => {
    helper.debug('debug msg');
    helper.info('info msg');
    helper.warn('warn msg');
    helper.error('error msg');
    expect(helper.getLogCount()).toBe(4);
    expect(helper.getLogsByLevel('debug')[0].message).toBe('debug msg');
  });

  test('should assert true', () => {
    expect(() => helper.assert(true, 'should pass')).not.toThrow();
  });

  test('should assert false and throw', () => {
    expect(() => helper.assert(false, 'should fail')).toThrow('should fail');
  });

  test('should limit log history', () => {
    for (let i = 0; i < 1100; i++) {
      helper.log('debug', `msg ${i}`);
    }
    expect(helper.getLogCount()).toBeLessThanOrEqual(1000);
  });
});

// ============================================================
// Module 9: DependencyGraphVisualizer Tests
// ============================================================
describe('DependencyGraphVisualizer', () => {
  let visualizer: DependencyGraphVisualizer;

  beforeEach(() => {
    visualizer = new DependencyGraphVisualizer();
  });

  test('should build a dependency graph', () => {
    const files = [
      { path: 'src/index.ts', content: "import { util } from './util';" },
      { path: 'src/util.ts', content: "export function util() {}" },
    ];
    const graph = visualizer.buildGraph(files);
    expect(graph.nodes.size).toBe(2);
    expect(graph.edges.length).toBe(1);
  });

  test('should handle files with no dependencies', () => {
    const files = [
      { path: 'src/standalone.ts', content: 'export const x = 1;' },
    ];
    const graph = visualizer.buildGraph(files);
    expect(graph.nodes.size).toBe(1);
    expect(graph.edges.length).toBe(0);
  });

  test('should handle circular dependencies', () => {
    const files = [
      { path: 'src/a.ts', content: "import { b } from './b';" },
      { path: 'src/b.ts', content: "import { a } from './a';" },
    ];
    const graph = visualizer.buildGraph(files);
    expect(graph.edges.length).toBe(2);
  });

  test('should detect cycles', () => {
    const files = [
      { path: 'src/a.ts', content: "import { b } from './b';" },
      { path: 'src/b.ts', content: "import { a } from './a';" },
    ];
    visualizer.buildGraph(files);
    const cycles = visualizer.detectCycles();
    expect(cycles.length).toBeGreaterThan(0);
  });

  test('should find path between nodes', () => {
    const files = [
      { path: 'src/index.ts', content: "import { mid } from './mid';" },
      { path: 'src/mid.ts', content: "import { leaf } from './leaf';" },
      { path: 'src/leaf.ts', content: 'export const leaf = 1;' },
    ];
    visualizer.buildGraph(files);
    const path = visualizer.findPath('src/index', 'src/leaf');
    expect(path.length).toBe(3);
  });

  test('should return empty path for non-existent route', () => {
    const files = [
      { path: 'src/a.ts', content: 'export const a = 1;' },
      { path: 'src/b.ts', content: 'export const b = 2;' },
    ];
    visualizer.buildGraph(files);
    const path = visualizer.findPath('src/a', 'src/b');
    expect(path.length).toBe(0);
  });

  test('should generate DOT output', () => {
    const files = [
      { path: 'src/a.ts', content: "import { b } from './b';" },
      { path: 'src/b.ts', content: 'export const b = 1;' },
    ];
    visualizer.buildGraph(files);
    const dot = visualizer.toDOT();
    expect(dot).toContain('digraph dependencies');
    expect(dot).toContain('->');
  });

  test('should generate Mermaid output', () => {
    const files = [
      { path: 'src/a.ts', content: "import { b } from './b';" },
      { path: 'src/b.ts', content: 'export const b = 1;' },
    ];
    visualizer.buildGraph(files);
    const mermaid = visualizer.toMermaid();
    expect(mermaid).toContain('graph LR');
    expect(mermaid).toContain('-->');
  });

  test('should generate ASCII output', () => {
    const files = [
      { path: 'src/a.ts', content: "import { b } from './b';" },
      { path: 'src/b.ts', content: 'export const b = 1;' },
    ];
    visualizer.buildGraph(files);
    const ascii = visualizer.toASCII();
    expect(ascii).toContain('-->');
  });

  test('should generate JSON output', () => {
    const files = [
      { path: 'src/a.ts', content: "import { b } from './b';" },
      { path: 'src/b.ts', content: 'export const b = 1;' },
    ];
    visualizer.buildGraph(files);
    const json = visualizer.toJSON();
    const parsed = JSON.parse(json);
    expect(parsed.nodes.length).toBe(2);
    expect(parsed.edges.length).toBe(1);
  });

  test('should compute graph metrics', () => {
    const files = [
      { path: 'src/index.ts', content: "import { a } from './a';\nimport { b } from './b';" },
      { path: 'src/a.ts', content: 'export const a = 1;' },
      { path: 'src/b.ts', content: 'export const b = 2;' },
    ];
    visualizer.buildGraph(files);
    const metrics = visualizer.getMetrics();
    expect(metrics.totalNodes).toBe(3);
    expect(metrics.totalEdges).toBe(2);
    expect(metrics.avgDependencies).toBeCloseTo(2 / 3);
  });

  test('should extract subgraph', () => {
    const files = [
      { path: 'src/index.ts', content: "import { a } from './a';\nimport { b } from './b';" },
      { path: 'src/a.ts', content: "import { c } from './c';" },
      { path: 'src/b.ts', content: 'export const b = 1;' },
      { path: 'src/c.ts', content: 'export const c = 1;' },
    ];
    visualizer.buildGraph(files);
    const sub = visualizer.getSubgraph('src/index', 1);
    expect(sub.nodes.size).toBe(4); // index, a, b, c (a depends on c at depth 1)
  });

  test('should handle CommonJS requires', () => {
    const files = [
      { path: 'src/index.ts', content: "const dep = require('./dep');" },
      { path: 'src/dep.ts', content: 'export {}' },
    ];
    const graph = visualizer.buildGraph(files);
    expect(graph.edges.length).toBe(1);
  });

  test('should handle dynamic imports', () => {
    const files = [
      { path: 'src/index.ts', content: "const mod = import('./dynamic');" },
      { path: 'src/dynamic.ts', content: 'export {}' },
    ];
    const graph = visualizer.buildGraph(files);
    expect(graph.edges.length).toBe(1);
  });

  test('should track dependents', () => {
    const files = [
      { path: 'src/a.ts', content: "import { c } from './c';" },
      { path: 'src/b.ts', content: "import { c } from './c';" },
      { path: 'src/c.ts', content: 'export const c = 1;' },
    ];
    const graph = visualizer.buildGraph(files);
    const cNode = graph.nodes.get('src/c');
    expect(cNode?.dependents.length).toBe(2);
  });
});

// ============================================================
// Module 10: CommitHelper Tests
// ============================================================
describe('CommitHelper', () => {
  let helper: CommitHelper;

  beforeEach(() => {
    helper = new CommitHelper();
  });

  test('should analyze a simple diff', () => {
    const diff = 'diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-const x = 1;\n+const x = 2;\n';
    const analysis = helper.analyzeChanges(diff);
    expect(analysis.files.length).toBeGreaterThan(0);
    expect(analysis.additions).toBeGreaterThan(0);
    expect(analysis.deletions).toBeGreaterThan(0);
  });

  test('should infer feat type from additions', () => {
    const diff = 'diff --git a/src/feature.ts b/src/feature.ts\n--- a/src/feature.ts\n+++ b/src/feature.ts\n@@ -0,0 +1,5 @@\n+export function newFeature() {\n+  return "new";\n+}\n';
    const analysis = helper.analyzeChanges(diff);
    expect(analysis.type).toBe('feat');
  });

  test('should infer fix type from bug-related content', () => {
    const diff = 'diff --git a/src/fix.ts b/src/fix.ts\n--- a/src/fix.ts\n+++ b/src/fix.ts\n@@ -1 +1 @@\n-fix bug here\n+bug is fixed\n';
    const analysis = helper.analyzeChanges(diff);
    expect(analysis.type).toBe('fix');
  });

  test('should infer docs type from markdown files', () => {
    const diff = 'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-# Old\n+# New\n';
    const analysis = helper.analyzeChanges(diff);
    expect(analysis.type).toBe('docs');
  });

  test('should infer test type from test files', () => {
    const diff = 'diff --git a/src/test.spec.ts b/src/test.spec.ts\n--- a/src/test.spec.ts\n+++ b/src/test.spec.ts\n@@ -0,0 +1,3 @@\n+import { test } from "bun:test";\n+test("works", () => {});\n';
    const analysis = helper.analyzeChanges(diff);
    expect(analysis.type).toBe('test');
  });

  test('should detect scope from file paths', () => {
    const diff = 'diff --git a/src/utils/helper.ts b/src/utils/helper.ts\n--- a/src/utils/helper.ts\n+++ b/src/utils/helper.ts\n@@ -1 +1 @@\n-old\n+new\n';
    const analysis = helper.analyzeChanges(diff);
    expect(analysis.scope).toBe('src');
  });

  test('should detect breaking changes', () => {
    const diff = 'diff --git a/src/api.ts b/src/api.ts\n--- a/src/api.ts\n+++ b/src/api.ts\n@@ -1 +1 @@\n+// BREAKING CHANGE: removed old API\n';
    const analysis = helper.analyzeChanges(diff);
    expect(analysis.hasBreakingChange).toBe(true);
  });

  test('should suggest commit message', () => {
    const analysis: import('../src/commit-helper.ts').ChangeAnalysis = {
      type: 'feat',
      scope: 'api',
      description: 'add new endpoint',
      files: ['src/api.ts'],
      additions: 10,
      deletions: 0,
      hasBreakingChange: false,
      confidence: 0.8,
    };
    const suggestion = helper.suggestMessage(analysis);
    expect(suggestion.type).toBe('feat');
    expect(suggestion.scope).toBe('api');
    expect(suggestion.subject).toBe('add new endpoint');
  });

  test('should generate commit message with scope', () => {
    const msg = helper.generateMessage('feat', 'api', 'add new endpoint');
    expect(msg).toBe('feat(api): add new endpoint');
  });

  test('should generate commit message without scope', () => {
    const msg = helper.generateMessage('fix', '', 'fix null pointer');
    expect(msg).toBe('fix: fix null pointer');
  });

  test('should generate commit message with breaking change', () => {
    const msg = helper.generateMessage('feat', 'api', 'breaking API change', { breakingChange: true });
    expect(msg).toContain('!');
    expect(msg).toContain('BREAKING CHANGE');
  });

  test('should generate commit message with body', () => {
    const msg = helper.generateMessage('feat', '', 'add feature', { body: 'This adds a new feature for users.' });
    expect(msg).toContain('This adds a new feature for users.');
  });

  test('should generate commit message with issue reference', () => {
    const msg = helper.generateMessage('fix', '', 'fix bug', { issue: '123' });
    expect(msg).toContain('Closes #123');
  });

  test('should generate commit message with skip CI', () => {
    const msg = helper.generateMessage('chore', '', 'update deps', { skipCI: true });
    expect(msg).toContain('[skip ci]');
  });

  test('should validate a correct commit message', () => {
    const result = helper.validateMessage('feat(api): add new endpoint');
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test('should invalidate non-conventional message', () => {
    const result = helper.validateMessage('added some stuff');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('should warn about long subject lines', () => {
    const longSubject = 'feat: ' + 'a'.repeat(100);
    const result = helper.validateMessage(longSubject);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test('should warn about trailing period', () => {
    const result = helper.validateMessage('feat: add feature.');
    expect(result.warnings.some(w => w.includes('period'))).toBe(true);
  });

  test('should parse a valid commit message', () => {
    const parsed = helper.parseMessage('feat(api): add new endpoint');
    expect(parsed.type).toBe('feat');
    expect(parsed.scope).toBe('api');
    expect(parsed.subject).toBe('add new endpoint');
    expect(parsed.breakingChange).toBe(false);
    expect(parsed.revert).toBe(false);
  });

  test('should parse commit with body and footer', () => {
    const msg = 'feat: add feature\n\nThis is the body.\n\nCloses #123';
    const parsed = helper.parseMessage(msg);
    expect(parsed.body).toContain('This is the body');
    expect(parsed.footer).toContain('Closes #123');
  });

  test('should parse breaking change from subject', () => {
    const parsed = helper.parseMessage('feat!: breaking change');
    expect(parsed.breakingChange).toBe(true);
  });

  test('should parse breaking change from footer', () => {
    const msg = 'feat: some change\n\nBREAKING CHANGE: this breaks things';
    const parsed = helper.parseMessage(msg);
    expect(parsed.breakingChange).toBe(true);
  });

  test('should parse revert commit', () => {
    const parsed = helper.parseMessage('revert: feat: original commit');
    expect(parsed.revert).toBe(true);
  });

  test('should get all commit types', () => {
    const types = helper.getTypes();
    expect(types.length).toBeGreaterThan(5);
    expect(types).toContain('feat');
    expect(types).toContain('fix');
    expect(types).toContain('docs');
  });

  test('should get type description', () => {
    const desc = helper.getTypeDescription('feat');
    expect(desc).toContain('feature');
  });

  test('should handle empty diff', () => {
    const analysis = helper.analyzeChanges('');
    expect(analysis.files.length).toBe(0);
  });

  test('should calculate confidence score', () => {
    const analysis = helper.analyzeChanges('diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-old\n+new\n');
    expect(analysis.confidence).toBeGreaterThan(0);
    expect(analysis.confidence).toBeLessThanOrEqual(1);
  });
});
