// tests/cli-enhanced.test.ts
import { describe, test, expect, beforeEach } from 'bun:test';
import {
  InteractivePrompt,
  ProgressBar,
  MultiProgress,
  TableRenderer,
  TerminalUtils,
  LogViewer,
  ConfigEditor,
  CommandDiscovery,
  OutputFormatter,
  ScriptRunner,
  CLISessionManager,
} from '../src/index.ts';
import type {
  Choice,
  ColumnDef,
  TableRow,
  LogEntry,
  LogSource,
  CommandModule,
  ScriptDefinition,
  ScriptStep,
} from '../src/index.ts';

// ============================================================
// Module 1: InteractivePrompt
// ============================================================
describe('InteractivePrompt', () => {
  let prompt: InteractivePrompt;

  beforeEach(() => {
    prompt = new InteractivePrompt();
  });

  test('should be instantiable', () => {
    expect(prompt).toBeDefined();
    expect(prompt).toBeInstanceOf(InteractivePrompt);
  });

  test('askText should return default value in non-interactive mode', async () => {
    const result = await prompt.askText('Name?', { defaultValue: 'hello' });
    expect(result).toBe('hello');
  });

  test('askText should return empty string when no default in non-interactive mode', async () => {
    const result = await prompt.askText('Name?');
    expect(result).toBe('');
  });

  test('askText should throw on required field with no default', async () => {
    await expect(prompt.askText('Name?', { required: true })).rejects.toThrow('is required');
  });

  test('askText should accept default value for required field', async () => {
    const result = await prompt.askText('Name?', { required: true, defaultValue: 'test' });
    expect(result).toBe('test');
  });

  test('askText should apply transform function', async () => {
    const result = await prompt.askText('Name?', {
      defaultValue: 'hello',
      transform: (s) => s.toUpperCase(),
    });
    expect(result).toBe('HELLO');
  });

  test('askText should apply validation', async () => {
    await expect(
      prompt.askText('Email?', {
        defaultValue: 'not-an-email',
        validation: (s) => s.includes('@') ? true : 'Must contain @',
      })
    ).rejects.toThrow('Must contain @');
  });

  test('askText should pass valid validation', async () => {
    const result = await prompt.askText('Email?', {
      defaultValue: 'test@example.com',
      validation: (s) => s.includes('@') ? true : 'Must contain @',
    });
    expect(result).toBe('test@example.com');
  });

  test('askText should enforce minLength', async () => {
    await expect(
      prompt.askText('Code?', { defaultValue: 'ab', minLength: 3 })
    ).rejects.toThrow('at least 3 characters');
  });

  test('askText should enforce maxLength', async () => {
    await expect(
      prompt.askText('Code?', { defaultValue: 'abcdefgh', maxLength: 5 })
    ).rejects.toThrow('at most 5 characters');
  });

  test('askText should enforce pattern', async () => {
    await expect(
      prompt.askText('Code?', { defaultValue: 'abc', pattern: /^[0-9]+$/ })
    ).rejects.toThrow('does not match required pattern');
  });

  test('askPassword should return empty string in non-interactive mode', async () => {
    const result = await prompt.askPassword('Password?');
    expect(result).toBe('');
  });

  test('askConfirm should return false by default in non-interactive mode', async () => {
    const result = await prompt.askConfirm('Continue?');
    expect(result).toBe(false);
  });

  test('askConfirm should return provided default', async () => {
    const result = await prompt.askConfirm('Continue?', true);
    expect(result).toBe(true);
  });

  test('askSelect should return first enabled choice in non-interactive mode', async () => {
    const choices: Choice[] = [
      { name: 'Option A', value: 'a' },
      { name: 'Option B', value: 'b' },
    ];
    const result = await prompt.askSelect('Pick one', choices);
    expect(result).toBe('a');
  });

  test('askSelect should throw on empty choices', async () => {
    await expect(prompt.askSelect('Pick one', [])).rejects.toThrow('No choices available');
  });

  test('askSelect should skip disabled choices in non-interactive mode', async () => {
    const choices: Choice[] = [
      { name: 'Option A', value: 'a', disabled: true },
      { name: 'Option B', value: 'b' },
    ];
    const result = await prompt.askSelect('Pick one', choices);
    expect(result).toBe('b');
  });

  test('askMultiSelect should return all enabled choices in non-interactive mode', async () => {
    const choices: Choice[] = [
      { name: 'Option A', value: 'a' },
      { name: 'Option B', value: 'b' },
    ];
    const result = await prompt.askMultiSelect('Pick many', choices);
    expect(result).toEqual(['a', 'b']);
  });

  test('askMultiSelect should throw on empty choices', async () => {
    await expect(prompt.askMultiSelect('Pick many', [])).rejects.toThrow('No choices available');
  });

  test('getCompletions should filter candidates by prefix', () => {
    const result = prompt.getCompletions('hel', ['hello', 'help', 'world', 'hell']);
    expect(result).toEqual(['hello', 'help', 'hell']);
  });

  test('getCompletions should return all candidates for empty input', () => {
    const result = prompt.getCompletions('', ['a', 'b', 'c']);
    expect(result).toEqual(['a', 'b', 'c']);
  });

  test('getCompletions should be case-insensitive', () => {
    const result = prompt.getCompletions('HEL', ['hello', 'help', 'world']);
    expect(result).toEqual(['hello', 'help']);
  });

  test('history should be empty initially', () => {
    expect(prompt.getHistory()).toEqual([]);
  });

  test('clearHistory should clear history', () => {
    prompt.clearHistory();
    expect(prompt.getHistory()).toEqual([]);
  });

  test('searchHistory should find matching entries', () => {
    // Manually add to history via askText with default
    // In non-interactive mode, defaults are used but history is only added for non-empty
    // We test the search method directly
    expect(prompt.searchHistory('test')).toEqual([]);
  });
});

// ============================================================
// Module 2: ProgressBar
// ============================================================
describe('ProgressBar', () => {
  let bar: ProgressBar;

  beforeEach(() => {
    bar = new ProgressBar();
  });

  test('should be instantiable', () => {
    expect(bar).toBeDefined();
    expect(bar).toBeInstanceOf(ProgressBar);
  });

  test('start should initialize progress', () => {
    bar.start(100, 'Loading');
    const state = bar.getState();
    expect(state).not.toBeNull();
    expect(state!.total).toBe(100);
    expect(state!.current).toBe(0);
    expect(state!.label).toBe('Loading');
    expect(state!.running).toBe(true);
  });

  test('update should change current progress', () => {
    bar.start(100);
    bar.update(50);
    expect(bar.getPercentage()).toBe(50);
  });

  test('update should clamp to total', () => {
    bar.start(100);
    bar.update(150);
    expect(bar.getPercentage()).toBe(100);
  });

  test('update should not go below 0', () => {
    bar.start(100);
    bar.update(-10);
    expect(bar.getPercentage()).toBe(0);
  });

  test('increment should increase progress', () => {
    bar.start(100);
    bar.increment(10);
    expect(bar.getPercentage()).toBe(10);
    bar.increment(20);
    expect(bar.getPercentage()).toBe(30);
  });

  test('increment should default to step of 1', () => {
    bar.start(100);
    bar.increment();
    expect(bar.getPercentage()).toBe(1);
  });

  test('increment should not exceed total', () => {
    bar.start(10);
    bar.increment(20);
    expect(bar.getPercentage()).toBe(100);
  });

  test('stop should clear state', () => {
    bar.start(100);
    bar.update(50);
    bar.stop();
    expect(bar.getState()).toBeNull();
  });

  test('getPercentage should return 0 when not started', () => {
    expect(bar.getPercentage()).toBe(0);
  });

  test('getPercentage should calculate correctly', () => {
    bar.start(200);
    bar.update(150);
    expect(bar.getPercentage()).toBe(75);
  });

  test('formatBar standard style', () => {
    const result = bar.formatBar('standard', 50, 10);
    expect(result).toBe('[=====     ]');
  });

  test('formatBar blocks style', () => {
    const result = bar.formatBar('blocks', 50, 10);
    expect(result).toBe('[█████░░░░░]');
  });

  test('formatBar emoji style', () => {
    const result = bar.formatBar('emoji', 50, 4);
    expect(result).toBe('[🟩🟩⬜⬜]');
  });

  test('formatBar minimal style', () => {
    const result = bar.formatBar('minimal', 50, 10);
    expect(result).toBe('>>>>>.....');
  });

  test('formatBar at 0%', () => {
    const result = bar.formatBar('standard', 0, 10);
    expect(result).toBe('[          ]');
  });

  test('formatBar at 100%', () => {
    const result = bar.formatBar('standard', 100, 10);
    expect(result).toBe('[==========]');
  });

  test('formatTime should format milliseconds', () => {
    expect(bar.formatTime(500)).toBe('500ms');
  });

  test('formatTime should format seconds', () => {
    expect(bar.formatTime(5000)).toBe('5s');
  });

  test('formatTime should format minutes and seconds', () => {
    expect(bar.formatTime(90000)).toBe('1m 30s');
  });

  test('startWithOptions should apply custom options', () => {
    bar.startWithOptions(100, {
      label: 'Test',
      style: 'blocks',
      width: 20,
      showPercent: false,
    });
    const state = bar.getState();
    expect(state!.style).toBe('blocks');
    expect(state!.width).toBe(20);
    expect(state!.showPercent).toBe(false);
  });

  test('getETA should return 0 when not started', () => {
    expect(bar.getETA()).toBe(0);
  });

  test('getThroughput should return 0 when not started', () => {
    expect(bar.getThroughput()).toBe(0);
  });

  test('startSpinner should initialize spinner', () => {
    bar.startSpinner('Working...');
    const state = bar.getState();
    expect(state).not.toBeNull();
    expect(state!.running).toBe(true);
    expect(state!.label).toBe('Working...');
    bar.stop();
  });

  test('updateSpinnerLabel should change label', () => {
    bar.startSpinner('Old');
    bar.updateSpinnerLabel('New');
    const state = bar.getState();
    expect(state!.label).toBe('New');
    bar.stop();
  });

  test('stop should handle no active progress gracefully', () => {
    expect(() => bar.stop()).not.toThrow();
  });
});

// ============================================================
// Module 2b: MultiProgress
// ============================================================
describe('MultiProgress', () => {
  let multi: MultiProgress;

  beforeEach(() => {
    multi = new MultiProgress();
  });

  test('should add progress bars', () => {
    const bar = multi.add('task1', 100, 'Task 1');
    expect(bar).toBeInstanceOf(ProgressBar);
    expect(multi.getIds()).toEqual(['task1']);
  });

  test('should get progress bars by id', () => {
    multi.add('task1', 100);
    const bar = multi.get('task1');
    expect(bar).toBeInstanceOf(ProgressBar);
  });

  test('should return undefined for non-existent id', () => {
    expect(multi.get('nonexistent')).toBeUndefined();
  });

  test('should remove progress bars', () => {
    multi.add('task1', 100);
    multi.remove('task1');
    expect(multi.getIds()).toEqual([]);
  });

  test('should stop all progress bars', () => {
    multi.add('task1', 100);
    multi.add('task2', 200);
    multi.stopAll();
    expect(multi.getIds()).toEqual([]);
  });

  test('getAll should return all bars', () => {
    multi.add('task1', 100);
    multi.add('task2', 200);
    expect(multi.getAll().size).toBe(2);
  });
});

// ============================================================
// Module 3: TableRenderer
// ============================================================
describe('TableRenderer', () => {
  let renderer: TableRenderer;

  beforeEach(() => {
    renderer = new TableRenderer();
  });

  test('should be instantiable', () => {
    expect(renderer).toBeDefined();
    expect(renderer).toBeInstanceOf(TableRenderer);
  });

  test('render should produce a table string', () => {
    const data: TableRow[] = [
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ];
    const columns: ColumnDef[] = [
      { key: 'name', header: 'Name' },
      { key: 'age', header: 'Age' },
    ];
    const result = renderer.render(data, columns);
    expect(result).toContain('Name');
    expect(result).toContain('Age');
    expect(result).toContain('Alice');
    expect(result).toContain('Bob');
    expect(result).toContain('30');
    expect(result).toContain('25');
  });

  test('render should handle empty data', () => {
    const columns: ColumnDef[] = [
      { key: 'name', header: 'Name' },
    ];
    const result = renderer.render([], columns);
    expect(result).toContain('no data');
  });

  test('renderCSV should produce CSV output', () => {
    const data: TableRow[] = [
      { name: 'Alice', age: 30 },
    ];
    const columns: ColumnDef[] = [
      { key: 'name', header: 'Name' },
      { key: 'age', header: 'Age' },
    ];
    const result = renderer.renderCSV(data, columns);
    expect(result).toBe('Name,Age\nAlice,30');
  });

  test('renderCSV should escape values with commas', () => {
    const data: TableRow[] = [
      { name: 'Doe, John', age: 30 },
    ];
    const columns: ColumnDef[] = [
      { key: 'name', header: 'Name' },
    ];
    const result = renderer.renderCSV(data, columns);
    expect(result).toBe('Name\n"Doe, John"');
  });

  test('renderMarkdown should produce markdown table', () => {
    const data: TableRow[] = [
      { name: 'Alice', age: 30 },
    ];
    const columns: ColumnDef[] = [
      { key: 'name', header: 'Name' },
      { key: 'age', header: 'Age' },
    ];
    const result = renderer.renderMarkdown(data, columns);
    expect(result).toContain('| Name | Age |');
    expect(result).toContain('| --- |');
    expect(result).toContain('| Alice | 30 |');
  });

  test('sort should sort ascending', () => {
    const data: TableRow[] = [
      { name: 'Charlie', score: 85 },
      { name: 'Alice', score: 95 },
      { name: 'Bob', score: 90 },
    ];
    const result = renderer.sort(data, { column: 'score', direction: 'asc' });
    expect(result[0].score).toBe(85);
    expect(result[2].score).toBe(95);
  });

  test('sort should sort descending', () => {
    const data: TableRow[] = [
      { name: 'Charlie', score: 85 },
      { name: 'Alice', score: 95 },
    ];
    const result = renderer.sort(data, { column: 'score', direction: 'desc' });
    expect(result[0].score).toBe(95);
    expect(result[1].score).toBe(85);
  });

  test('sort should sort strings alphabetically', () => {
    const data: TableRow[] = [
      { name: 'Charlie' },
      { name: 'Alice' },
      { name: 'Bob' },
    ];
    const result = renderer.sort(data, { column: 'name', direction: 'asc' });
    expect(result[0].name).toBe('Alice');
    expect(result[2].name).toBe('Charlie');
  });

  test('filter should filter by equality', () => {
    const data: TableRow[] = [
      { name: 'Alice', status: 'active' },
      { name: 'Bob', status: 'inactive' },
    ];
    const result = renderer.filter(data, { column: 'status', value: 'active' });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Alice');
  });

  test('filter should filter by contains', () => {
    const data: TableRow[] = [
      { name: 'Alice Johnson' },
      { name: 'Bob Smith' },
      { name: 'Alice Williams' },
    ];
    const result = renderer.filter(data, { column: 'name', value: 'Alice', operator: 'contains' });
    expect(result).toHaveLength(2);
  });

  test('filter should filter by greater than', () => {
    const data: TableRow[] = [
      { score: 85 },
      { score: 95 },
      { score: 75 },
    ];
    const result = renderer.filter(data, { column: 'score', value: 80, operator: 'gt' });
    expect(result).toHaveLength(2);
  });

  test('filter should filter by less than', () => {
    const data: TableRow[] = [
      { score: 85 },
      { score: 95 },
      { score: 75 },
    ];
    const result = renderer.filter(data, { column: 'score', value: 80, operator: 'lt' });
    expect(result).toHaveLength(1);
  });

  test('paginate should return correct page', () => {
    const data: TableRow[] = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    const result = renderer.paginate(data, { page: 2, pageSize: 3 });
    expect(result.data).toHaveLength(3);
    expect(result.total).toBe(10);
    expect(result.pages).toBe(4);
    expect(result.data[0].id).toBe(3);
  });

  test('calculateWidths should auto-calculate column widths', () => {
    const data: TableRow[] = [
      { name: 'Alice', description: 'A long description' },
      { name: 'Bob', description: 'Short' },
    ];
    const columns: ColumnDef[] = [
      { key: 'name', header: 'Name' },
      { key: 'description', header: 'Description' },
    ];
    const widths = renderer.calculateWidths(data, columns);
    expect(widths[0]).toBeGreaterThanOrEqual(4); // 'Name' or 'Alice'
    expect(widths[1]).toBeGreaterThanOrEqual(11); // 'A long description'
  });

  test('calculateWidths should respect fixed width', () => {
    const columns: ColumnDef[] = [
      { key: 'name', header: 'Name', width: 20 },
    ];
    const widths = renderer.calculateWidths([{ name: 'Alice' }], columns);
    expect(widths[0]).toBe(20);
  });

  test('setBorderStyle should return this for chaining', () => {
    const result = renderer.setBorderStyle('dashed');
    expect(result).toBe(renderer);
  });

  test('setDefaultAlignment should return this for chaining', () => {
    const result = renderer.setDefaultAlignment('center');
    expect(result).toBe(renderer);
  });

  test('setPadding should return this for chaining', () => {
    const result = renderer.setPadding(4);
    expect(result).toBe(renderer);
  });

  test('render should use custom format function', () => {
    const data: TableRow[] = [{ price: 1234.5 }];
    const columns: ColumnDef[] = [
      { key: 'price', header: 'Price', format: (v) => `$${Number(v).toFixed(2)}` },
    ];
    const result = renderer.render(data, columns);
    expect(result).toContain('$1234.50');
  });
});

// ============================================================
// Module 4: TerminalUtils
// ============================================================
describe('TerminalUtils', () => {
  let utils: TerminalUtils;

  beforeEach(() => {
    utils = TerminalUtils.getInstance();
  });

  test('should return singleton instance', () => {
    const instance1 = TerminalUtils.getInstance();
    const instance2 = TerminalUtils.getInstance();
    expect(instance1).toBe(instance2);
  });

  test('color should apply ANSI color codes', () => {
    const result = utils.color('hello', '#ff0000');
    expect(result).toContain('hello');
    expect(result).toContain('\x1b[38;2;255;0;0m');
    expect(result).toContain('\x1b[39m');
  });

  test('color should return text unchanged for invalid color', () => {
    const result = utils.color('hello', 'not-a-color');
    expect(result).toBe('hello');
  });

  test('color should parse named colors', () => {
    const result = utils.color('hello', 'red');
    expect(result).toContain('\x1b[38;2;255;0;0m');
  });

  test('color should parse short hex colors', () => {
    const result = utils.color('hello', '#f00');
    expect(result).toContain('\x1b[38;2;255;0;0m');
  });

  test('color should parse rgb() format', () => {
    const result = utils.color('hello', 'rgb(100, 200, 50)');
    expect(result).toContain('\x1b[38;2;100;200;50m');
  });

  test('bgColor should apply background color', () => {
    const result = utils.bgColor('hello', '#ff0000');
    expect(result).toContain('\x1b[48;2;255;0;0m');
    expect(result).toContain('\x1b[49m');
  });

  test('bold should apply bold ANSI code', () => {
    const result = utils.bold('hello');
    expect(result).toContain('\x1b[1m');
    expect(result).toContain('\x1b[22m');
  });

  test('italic should apply italic ANSI code', () => {
    const result = utils.italic('hello');
    expect(result).toContain('\x1b[3m');
    expect(result).toContain('\x1b[23m');
  });

  test('underline should apply underline ANSI code', () => {
    const result = utils.underline('hello');
    expect(result).toContain('\x1b[4m');
    expect(result).toContain('\x1b[24m');
  });

  test('strikethrough should apply strikethrough ANSI code', () => {
    const result = utils.strikethrough('hello');
    expect(result).toContain('\x1b[9m');
    expect(result).toContain('\x1b[29m');
  });

  test('dim should apply dim ANSI code', () => {
    const result = utils.dim('hello');
    expect(result).toContain('\x1b[2m');
  });

  test('reverse should apply reverse ANSI code', () => {
    const result = utils.reverse('hello');
    expect(result).toContain('\x1b[7m');
    expect(result).toContain('\x1b[27m');
  });

  test('getSize should return terminal dimensions', () => {
    const size = utils.getSize();
    expect(size).toHaveProperty('columns');
    expect(size).toHaveProperty('rows');
    expect(typeof size.columns).toBe('number');
    expect(typeof size.rows).toBe('number');
  });

  test('supportsColor should return a color level', () => {
    const level = utils.supportsColor();
    expect(['truecolor', '256', '16', 'none']).toContain(level);
  });

  test('color256 should apply 256-color code', () => {
    const result = utils.color256('hello', 196);
    expect(result).toContain('\x1b[38;5;196m');
    expect(result).toContain('\x1b[39m');
  });

  test('bgColor256 should apply 256-color background', () => {
    const result = utils.bgColor256('hello', 196);
    expect(result).toContain('\x1b[48;5;196m');
    expect(result).toContain('\x1b[49m');
  });

  test('colorRGB should apply RGB color', () => {
    const result = utils.colorRGB('hello', 255, 128, 0);
    expect(result).toContain('\x1b[38;2;255;128;0m');
  });

  test('bgColorRGB should apply RGB background', () => {
    const result = utils.bgColorRGB('hello', 255, 128, 0);
    expect(result).toContain('\x1b[48;2;255;128;0m');
  });

  test('combineStyles should apply multiple styles', () => {
    const result = utils.combineStyles('hello', [utils.bold.bind(utils), utils.underline.bind(utils)]);
    expect(result).toContain('\x1b[1m');
    expect(result).toContain('\x1b[4m');
  });

  test('stripAnsi should remove all ANSI codes', () => {
    const styled = utils.bold(utils.color('hello', 'red'));
    const stripped = utils.stripAnsi(styled);
    expect(stripped).toBe('hello');
  });

  test('parseColor should return null for invalid color', () => {
    expect(utils.parseColor('')).toBeNull();
    expect(utils.parseColor('xyz')).toBeNull();
  });

  test('parseColor should parse various named colors', () => {
    expect(utils.parseColor('green')).toEqual({ r: 0, g: 128, b: 0 });
    expect(utils.parseColor('blue')).toEqual({ r: 0, g: 0, b: 255 });
    expect(utils.parseColor('white')).toEqual({ r: 255, g: 255, b: 255 });
    expect(utils.parseColor('black')).toEqual({ r: 0, g: 0, b: 0 });
  });
});

// ============================================================
// Module 5: LogViewer
// ============================================================
describe('LogViewer', () => {
  let viewer: LogViewer;
  const sampleEntries: LogEntry[] = [
    {
      timestamp: new Date('2025-01-01T10:00:00Z'),
      level: 'info',
      message: 'Server started',
      source: 'app',
      raw: '[INFO] Server started',
    },
    {
      timestamp: new Date('2025-01-01T10:01:00Z'),
      level: 'warn',
      message: 'Low memory',
      source: 'app',
      raw: '[WARN] Low memory',
    },
    {
      timestamp: new Date('2025-01-01T10:02:00Z'),
      level: 'error',
      message: 'Connection failed',
      source: 'db',
      raw: '[ERROR] Connection failed',
    },
    {
      timestamp: new Date('2025-01-01T10:03:00Z'),
      level: 'debug',
      message: 'Cache hit',
      source: 'cache',
      raw: '[DEBUG] Cache hit',
    },
  ];

  beforeEach(() => {
    viewer = new LogViewer();
  });

  test('should be instantiable', () => {
    expect(viewer).toBeDefined();
    expect(viewer).toBeInstanceOf(LogViewer);
  });

  test('loadSource should add entries', () => {
    const source: LogSource = {
      name: 'test',
      type: 'memory',
      entries: sampleEntries,
    };
    viewer.loadSource(source);
    expect(viewer.getAllEntries()).toHaveLength(4);
  });

  test('filter should filter by level', () => {
    const source: LogSource = {
      name: 'test',
      type: 'memory',
      entries: sampleEntries,
    };
    viewer.loadSource(source);
    const errors = viewer.filter('error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('Connection failed');
  });

  test('filter with info level should include warn and error', () => {
    const source: LogSource = {
      name: 'test',
      type: 'memory',
      entries: sampleEntries,
    };
    viewer.loadSource(source);
    const result = viewer.filter('info');
    expect(result).toHaveLength(3); // info, warn, error
  });

  test('filter with debug level should return all', () => {
    const source: LogSource = {
      name: 'test',
      type: 'memory',
      entries: sampleEntries,
    };
    viewer.loadSource(source);
    const result = viewer.filter('debug');
    expect(result).toHaveLength(4);
  });

  test('tail should return last N entries', () => {
    const source: LogSource = {
      name: 'test',
      type: 'memory',
      entries: sampleEntries,
    };
    viewer.loadSource(source);
    const result = viewer.tail(2);
    expect(result).toHaveLength(2);
    expect(result[0].level).toBe('error');
    expect(result[1].level).toBe('debug');
  });

  test('search should find matching entries', () => {
    const source: LogSource = {
      name: 'test',
      type: 'memory',
      entries: sampleEntries,
    };
    viewer.loadSource(source);
    const result = viewer.search('memory');
    expect(result).toHaveLength(1);
    expect(result[0].message).toBe('Low memory');
  });

  test('search should be case-insensitive by default', () => {
    const source: LogSource = {
      name: 'test',
      type: 'memory',
      entries: sampleEntries,
    };
    viewer.loadSource(source);
    const result = viewer.search('SERVER');
    expect(result).toHaveLength(1);
  });

  test('search should support case-sensitive mode', () => {
    const source: LogSource = {
      name: 'test',
      type: 'memory',
      entries: sampleEntries,
    };
    viewer.loadSource(source);
    const result = viewer.search('SERVER', { caseSensitive: true });
    expect(result).toHaveLength(0);
  });

  test('search should filter by level', () => {
    const source: LogSource = {
      name: 'test',
      type: 'memory',
      entries: sampleEntries,
    };
    viewer.loadSource(source);
    const result = viewer.search('failed', { level: 'error' });
    expect(result).toHaveLength(1);
  });

  test('export as JSON should produce valid JSON', () => {
    const source: LogSource = {
      name: 'test',
      type: 'memory',
      entries: sampleEntries,
    };
    viewer.loadSource(source);
    const json = viewer.export('json');
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(4);
    expect(parsed[0].level).toBe('info');
  });

  test('export as text should produce readable output', () => {
    const source: LogSource = {
      name: 'test',
      type: 'memory',
      entries: sampleEntries,
    };
    viewer.loadSource(source);
    const text = viewer.export('text');
    expect(text).toContain('[INFO]');
    expect(text).toContain('Server started');
  });

  test('clear should remove all entries', () => {
    const source: LogSource = {
      name: 'test',
      type: 'memory',
      entries: sampleEntries,
    };
    viewer.loadSource(source);
    viewer.clear();
    expect(viewer.getAllEntries()).toHaveLength(0);
  });

  test('getStats should return correct statistics', () => {
    const source: LogSource = {
      name: 'test',
      type: 'memory',
      entries: sampleEntries,
    };
    viewer.loadSource(source);
    const stats = viewer.getStats();
    expect(stats.total).toBe(4);
    expect(stats.byLevel.debug).toBe(1);
    expect(stats.byLevel.info).toBe(1);
    expect(stats.byLevel.warn).toBe(1);
    expect(stats.byLevel.error).toBe(1);
    expect(stats.sources).toContain('test');
  });

  test('formatTimestamp should format as ISO by default', () => {
    const date = new Date('2025-01-01T10:00:00Z');
    const result = viewer.formatTimestamp(date);
    expect(result).toBe('2025-01-01T10:00:00.000Z');
  });

  test('formatTimestamp should format as unix', () => {
    const date = new Date('2025-01-01T10:00:00Z');
    const result = viewer.formatTimestamp(date, 'unix');
    expect(result).toBe(String(Math.floor(date.getTime() / 1000)));
  });

  test('formatTimestamp should format as simple', () => {
    const date = new Date('2025-06-15T14:30:45Z');
    const result = viewer.formatTimestamp(date, 'simple');
    expect(result).toContain('2025-06-15');
    expect(result).toContain('14:30:45');
  });

  test('getSources should return loaded sources', () => {
    const source: LogSource = {
      name: 'test',
      type: 'memory',
      entries: sampleEntries,
    };
    viewer.loadSource(source);
    const sources = viewer.getSources();
    expect(sources).toHaveLength(1);
    expect(sources[0].name).toBe('test');
  });

  test('addEntry should add a single entry', () => {
    viewer.addEntry({
      timestamp: new Date(),
      level: 'info',
      message: 'Test',
      raw: '[INFO] Test',
    });
    expect(viewer.getAllEntries()).toHaveLength(1);
  });

  test('startFollow and stopFollow should work', () => {
    viewer.startFollow(() => {});
    viewer.stopFollow();
    // Should not throw
  });
});

// ============================================================
// Module 6: ConfigEditor
// ============================================================
describe('ConfigEditor', () => {
  let editor: ConfigEditor;
  const sampleConfig = {
    server: {
      host: 'localhost',
      port: 3000,
      ssl: false,
    },
    database: {
      url: 'postgres://localhost/db',
      poolSize: 10,
    },
    debug: true,
  };

  beforeEach(() => {
    editor = new ConfigEditor(sampleConfig);
  });

  test('should be instantiable', () => {
    expect(editor).toBeDefined();
    expect(editor).toBeInstanceOf(ConfigEditor);
  });

  test('getConfig should return current config', () => {
    const config = editor.getConfig();
    expect(config.server.host).toBe('localhost');
  });

  test('getValue should get nested values', () => {
    expect(editor.getValue('server.host')).toBe('localhost');
    expect(editor.getValue('server.port')).toBe(3000);
    expect(editor.getValue('debug')).toBe(true);
  });

  test('getValue should return undefined for non-existent path', () => {
    expect(editor.getValue('nonexistent')).toBeUndefined();
    expect(editor.getValue('server.nonexistent')).toBeUndefined();
  });

  test('setValue should set top-level values', () => {
    editor.setValue('debug', false);
    expect(editor.getValue('debug')).toBe(false);
  });

  test('setValue should set nested values', () => {
    editor.setValue('server.host', '0.0.0.0');
    expect(editor.getValue('server.host')).toBe('0.0.0.0');
  });

  test('setValue should create intermediate objects', () => {
    editor.setValue('new.nested.value', 42);
    expect(editor.getValue('new.nested.value')).toBe(42);
  });

  test('deleteValue should delete top-level values', () => {
    editor.deleteValue('debug');
    expect(editor.getValue('debug')).toBeUndefined();
  });

  test('deleteValue should delete nested values', () => {
    editor.deleteValue('server.ssl');
    expect(editor.getValue('server.ssl')).toBeUndefined();
    expect(editor.getValue('server.host')).toBe('localhost');
  });

  test('navigate should return ConfigNode for top-level key', () => {
    const node = editor.navigate('debug');
    expect(node.key).toBe('debug');
    expect(node.value).toBe(true);
    expect(node.type).toBe('boolean');
  });

  test('navigate should return ConfigNode for nested key', () => {
    const node = editor.navigate('server');
    expect(node.key).toBe('server');
    expect(node.type).toBe('object');
    expect(node.children).toBeDefined();
    expect(node.children!.length).toBe(3);
  });

  test('navigate should throw for invalid path', () => {
    expect(() => editor.navigate('nonexistent.deep.path')).toThrow();
  });

  test('preview should detect changes', () => {
    editor.setValue('debug', false);
    const diffs = editor.preview();
    expect(diffs.length).toBeGreaterThan(0);
    const debugDiff = diffs.find(d => d.path === 'debug');
    expect(debugDiff).toBeDefined();
    expect(debugDiff!.type).toBe('changed');
    expect(debugDiff!.oldValue).toBe(true);
    expect(debugDiff!.newValue).toBe(false);
  });

  test('preview should detect additions', () => {
    editor.setValue('newKey', 'value');
    const diffs = editor.preview();
    const addDiff = diffs.find(d => d.path === 'newKey');
    expect(addDiff).toBeDefined();
    expect(addDiff!.type).toBe('added');
  });

  test('preview should detect removals', () => {
    editor.deleteValue('debug');
    const diffs = editor.preview();
    const removeDiff = diffs.find(d => d.path === 'debug');
    expect(removeDiff).toBeDefined();
    expect(removeDiff!.type).toBe('removed');
  });

  test('isDirty should return false initially', () => {
    expect(editor.isDirty()).toBe(false);
  });

  test('isDirty should return true after changes', () => {
    editor.setValue('debug', false);
    expect(editor.isDirty()).toBe(true);
  });

  test('validate should pass with no schema', () => {
    const result = editor.validate();
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('validate should check schema types', () => {
    editor.setSchema({
      'debug': { type: 'boolean' },
    });
    const result = editor.validate();
    expect(result.valid).toBe(true);
  });

  test('validate should detect type mismatches', () => {
    editor.setValue('debug', 'not-a-boolean');
    editor.setSchema({
      'debug': { type: 'boolean' },
    });
    const result = editor.validate();
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('validate should check required fields', () => {
    editor.deleteValue('debug');
    editor.setSchema({
      'debug': { required: true },
    });
    const result = editor.validate();
    expect(result.valid).toBe(false);
  });

  test('validate should check enum values', () => {
    editor.setSchema({
      'server.host': { enum: ['localhost', '0.0.0.0'] },
    });
    editor.setValue('server.host', 'invalid');
    const result = editor.validate();
    expect(result.valid).toBe(false);
  });

  test('validate should check number ranges', () => {
    editor.setSchema({
      'server.port': { type: 'number', minimum: 1, maximum: 65535 },
    });
    editor.setValue('server.port', 0);
    const result = editor.validate();
    expect(result.valid).toBe(false);
  });

  test('validate should check string patterns', () => {
    editor.setSchema({
      'database.url': { type: 'string', pattern: '^postgres://' },
    });
    editor.setValue('database.url', 'mysql://localhost');
    const result = editor.validate();
    expect(result.valid).toBe(false);
  });

  test('reset should restore defaults', () => {
    editor.setDefaults({ debug: false, server: { host: '0.0.0.0', port: 8080, ssl: true } });
    editor.setValue('debug', true);
    editor.reset('debug');
    expect(editor.getValue('debug')).toBe(false);
  });

  test('merge should merge configs', () => {
    editor.merge({ debug: false, newKey: 'value' });
    expect(editor.getValue('debug')).toBe(false);
    expect(editor.getValue('newKey')).toBe('value');
    expect(editor.getValue('server.host')).toBe('localhost');
  });

  test('getKeys should return top-level keys', () => {
    const keys = editor.getKeys();
    expect(keys).toContain('server');
    expect(keys).toContain('database');
    expect(keys).toContain('debug');
  });

  test('getHistory should track changes', () => {
    editor.setValue('debug', false);
    editor.setValue('debug', true);
    const history = editor.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0].action).toBe('set');
    expect(history[0].path).toBe('debug');
  });

  test('edit should replace config', async () => {
    const newConfig = { foo: 'bar' };
    const result = await editor.edit(newConfig);
    expect(result.foo).toBe('bar');
  });
});

// ============================================================
// Module 7: CommandDiscovery
// ============================================================
describe('CommandDiscovery', () => {
  let discovery: CommandDiscovery;

  beforeEach(() => {
    discovery = new CommandDiscovery();
  });

  test('should be instantiable', () => {
    expect(discovery).toBeDefined();
    expect(discovery).toBeInstanceOf(CommandDiscovery);
  });

  test('registerCommand should register a command', () => {
    const module: CommandModule = {
      name: 'build',
      description: 'Build the project',
      aliases: ['b'],
      category: 'build',
    };
    const info = discovery.registerCommand(module);
    expect(info.name).toBe('build');
    expect(info.description).toBe('Build the project');
    expect(info.aliases).toEqual(['b']);
  });

  test('getCommand should find registered command', () => {
    discovery.registerCommand({ name: 'test', description: 'Run tests' });
    const cmd = discovery.getCommand('test');
    expect(cmd).toBeDefined();
    expect(cmd!.name).toBe('test');
  });

  test('getCommand should find command by alias', () => {
    discovery.registerCommand({ name: 'build', description: 'Build', aliases: ['b'] });
    const cmd = discovery.getCommand('b');
    expect(cmd).toBeDefined();
    expect(cmd!.name).toBe('build');
  });

  test('getCommand should return undefined for unknown command', () => {
    expect(discovery.getCommand('nonexistent')).toBeUndefined();
  });

  test('getHelp should return help text', () => {
    discovery.registerCommand({
      name: 'deploy',
      description: 'Deploy application',
      options: [
        { name: 'env', description: 'Environment', type: 'string', short: 'e' },
      ],
      arguments: [
        { name: 'target', description: 'Deploy target', required: true },
      ],
      examples: ['deploy production', 'deploy staging --env=dev'],
    });
    const help = discovery.getHelp('deploy');
    expect(help.name).toBe('deploy');
    expect(help.description).toBe('Deploy application');
    expect(help.options).toHaveLength(1);
    expect(help.arguments).toHaveLength(1);
    expect(help.examples).toHaveLength(2);
  });

  test('getHelp should throw for unknown command', () => {
    expect(() => discovery.getHelp('unknown')).toThrow('not found');
  });

  test('searchCommands should find by name', () => {
    discovery.registerCommand({ name: 'build', description: 'Build project' });
    discovery.registerCommand({ name: 'test', description: 'Run tests' });
    const results = discovery.searchCommands('build');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('build');
  });

  test('searchCommands should find by description', () => {
    discovery.registerCommand({ name: 'build', description: 'Build the project' });
    discovery.registerCommand({ name: 'test', description: 'Run the tests' });
    const results = discovery.searchCommands('project');
    expect(results).toHaveLength(1);
  });

  test('searchCommands should be case-insensitive', () => {
    discovery.registerCommand({ name: 'Build', description: 'Build project' });
    const results = discovery.searchCommands('build');
    expect(results).toHaveLength(1);
  });

  test('getAllCommands should return all non-hidden commands', () => {
    discovery.registerCommand({ name: 'cmd1', description: 'Command 1' });
    discovery.registerCommand({ name: 'cmd2', description: 'Command 2', hidden: true });
    expect(discovery.getAllCommands()).toHaveLength(1);
  });

  test('getAllCommandsIncludingHidden should return all commands', () => {
    discovery.registerCommand({ name: 'cmd1', description: 'Command 1' });
    discovery.registerCommand({ name: 'cmd2', description: 'Command 2', hidden: true });
    expect(discovery.getAllCommandsIncludingHidden()).toHaveLength(2);
  });

  test('getCommandsByCategory should filter by category', () => {
    discovery.registerCommand({ name: 'build', description: 'Build', category: 'build' });
    discovery.registerCommand({ name: 'test', description: 'Test', category: 'test' });
    discovery.registerCommand({ name: 'lint', description: 'Lint', category: 'build' });
    const results = discovery.getCommandsByCategory('build');
    expect(results).toHaveLength(2);
  });

  test('getCategories should return all categories', () => {
    discovery.registerCommand({ name: 'build', description: 'Build', category: 'build' });
    discovery.registerCommand({ name: 'test', description: 'Test', category: 'test' });
    expect(discovery.getCategories()).toContain('build');
    expect(discovery.getCategories()).toContain('test');
  });

  test('checkDependencies should return satisfied for no deps', () => {
    discovery.registerCommand({ name: 'standalone', description: 'No deps' });
    const result = discovery.checkDependencies('standalone');
    expect(result.satisfied).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  test('checkDependencies should detect missing deps', () => {
    discovery.registerCommand({
      name: 'deploy',
      description: 'Deploy',
      dependencies: ['build', 'test'],
    });
    const result = discovery.checkDependencies('deploy');
    expect(result.satisfied).toBe(false);
    expect(result.missing).toContain('build');
    expect(result.missing).toContain('test');
  });

  test('checkDependencies should pass when deps are registered', () => {
    discovery.registerCommand({ name: 'build', description: 'Build' });
    discovery.registerCommand({ name: 'test', description: 'Test' });
    discovery.registerCommand({
      name: 'deploy',
      description: 'Deploy',
      dependencies: ['build', 'test'],
    });
    const result = discovery.checkDependencies('deploy');
    expect(result.satisfied).toBe(true);
  });

  test('hasCommand should check existence', () => {
    discovery.registerCommand({ name: 'exists', description: 'Exists' });
    expect(discovery.hasCommand('exists')).toBe(true);
    expect(discovery.hasCommand('nope')).toBe(false);
  });

  test('getCount should return command count', () => {
    discovery.registerCommand({ name: 'a', description: 'A' });
    discovery.registerCommand({ name: 'b', description: 'B' });
    expect(discovery.getCount()).toBe(2);
  });

  test('clear should remove all commands', () => {
    discovery.registerCommand({ name: 'a', description: 'A' });
    discovery.clear();
    expect(discovery.getCount()).toBe(0);
  });

  test('discover should return empty array', () => {
    const result = discovery.discover('/nonexistent');
    expect(result).toEqual([]);
  });
});

// ============================================================
// Module 8: OutputFormatter
// ============================================================
describe('OutputFormatter', () => {
  let formatter: OutputFormatter;

  beforeEach(() => {
    formatter = new OutputFormatter();
  });

  test('should be instantiable', () => {
    expect(formatter).toBeDefined();
    expect(formatter).toBeInstanceOf(OutputFormatter);
  });

  test('format as JSON should produce valid JSON', () => {
    const result = formatter.format({ foo: 'bar' }, 'json');
    const parsed = JSON.parse(result);
    expect(parsed.foo).toBe('bar');
  });

  test('format as text should produce readable output', () => {
    const result = formatter.format('hello world', 'text');
    expect(result).toBe('hello world');
  });

  test('format as YAML should produce YAML-like output', () => {
    const result = formatter.format({ key: 'value' }, 'yaml');
    expect(result).toContain('key');
    expect(result).toContain('value');
  });

  test('format as table should produce table output', () => {
    const data = [{ name: 'Alice', age: 30 }];
    const result = formatter.format(data, 'table');
    expect(result).toContain('name');
    expect(result).toContain('age');
    expect(result).toContain('Alice');
  });

  test('format as tree should produce tree output', () => {
    const data = { parent: { child: 'value' } };
    const result = formatter.format(data, 'tree');
    expect(result).toContain('parent');
    expect(result).toContain('child');
  });

  test('formatError should format error as text', () => {
    const error = new Error('test error');
    const result = formatter.formatError(error, 'text');
    expect(result).toContain('Error');
    expect(result).toContain('test error');
  });

  test('formatError should format error as JSON', () => {
    const error = new Error('test error');
    const result = formatter.formatError(error, 'json');
    const parsed = JSON.parse(result);
    expect(parsed.message).toBe('test error');
    expect(parsed.name).toBe('Error');
  });

  test('formatSuccess should include success message', () => {
    const result = formatter.formatSuccess('Done!');
    expect(result).toContain('Done!');
  });

  test('formatWarning should include warning message', () => {
    const result = formatter.formatWarning('Be careful!');
    expect(result).toContain('Be careful!');
  });

  test('formatList should format list as text', () => {
    const result = formatter.formatList(['a', 'b', 'c'], 'text');
    expect(result).toContain('- a');
    expect(result).toContain('- b');
    expect(result).toContain('- c');
  });

  test('formatList should format list as JSON', () => {
    const result = formatter.formatList(['a', 'b'], 'json');
    const parsed = JSON.parse(result);
    expect(parsed).toEqual(['a', 'b']);
  });

  test('formatList should format list as table', () => {
    const result = formatter.formatList(['a', 'b'], 'table');
    expect(result).toContain('#');
    expect(result).toContain('item');
  });

  test('setTheme should change theme', () => {
    formatter.setTheme('light');
    expect(formatter.getTheme()).toBe('light');
  });

  test('setVerbosity should change verbosity', () => {
    formatter.setVerbosity('verbose');
    expect(formatter.getVerbosity()).toBe('verbose');
  });

  test('setTheme should return this for chaining', () => {
    const result = formatter.setTheme('none');
    expect(result).toBe(formatter);
  });

  test('setVerbosity should return this for chaining', () => {
    const result = formatter.setVerbosity('debug');
    expect(result).toBe(formatter);
  });

  test('setIndent should return this for chaining', () => {
    const result = formatter.setIndent(4);
    expect(result).toBe(formatter);
  });

  test('setColorize should return this for chaining', () => {
    const result = formatter.setColorize(false);
    expect(result).toBe(formatter);
  });

  test('createFormattedOutput should include metadata', () => {
    const output = formatter.createFormattedOutput('json', '{}');
    expect(output.format).toBe('json');
    expect(output.content).toBe('{}');
    expect(output.metadata).toBeDefined();
    expect(output.metadata!.timestamp).toBeDefined();
  });

  test('formatJSON should respect indent option', () => {
    const result = formatter.formatJSON({ a: 1 }, { indent: 4 });
    expect(result).toContain('    '); // 4 spaces
  });

  test('formatTable should handle empty array', () => {
    const result = formatter.formatTable([]);
    expect(result).toBe('(no data)');
  });

  test('formatTable should handle non-array input', () => {
    const result = formatter.formatTable('hello');
    expect(result).toBe('hello');
  });

  test('formatTree should handle primitive values', () => {
    const result = formatter.formatTree(42);
    expect(result).toContain('42');
  });

  test('formatTree should handle arrays', () => {
    const result = formatter.formatTree(['a', 'b', 'c']);
    expect(result).toContain('a');
    expect(result).toContain('b');
    expect(result).toContain('c');
  });
});

// ============================================================
// Module 9: ScriptRunner
// ============================================================
describe('ScriptRunner', () => {
  let runner: ScriptRunner;

  beforeEach(() => {
    runner = new ScriptRunner();
  });

  test('should be instantiable', () => {
    expect(runner).toBeDefined();
    expect(runner).toBeInstanceOf(ScriptRunner);
  });

  test('validate should pass for valid script', () => {
    const script: ScriptDefinition = {
      name: 'test-script',
      steps: [
        { name: 'step1', command: 'echo hello' },
      ],
    };
    const result = runner.validate(script);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('validate should fail for missing name', () => {
    const script: ScriptDefinition = {
      name: '',
      steps: [{ name: 's1', command: 'echo' }],
    };
    const result = runner.validate(script);
    expect(result.valid).toBe(false);
  });

  test('validate should fail for empty steps', () => {
    const script: ScriptDefinition = {
      name: 'test',
      steps: [],
    };
    const result = runner.validate(script);
    expect(result.valid).toBe(false);
  });

  test('validate should fail for step without name', () => {
    const script: ScriptDefinition = {
      name: 'test',
      steps: [{ name: '', command: 'echo' }],
    };
    const result = runner.validate(script);
    expect(result.valid).toBe(false);
  });

  test('validate should fail for step without command', () => {
    const script: ScriptDefinition = {
      name: 'test',
      steps: [{ name: 's1', command: '' }],
    };
    const result = runner.validate(script);
    expect(result.valid).toBe(false);
  });

  test('validate should warn about negative retryCount', () => {
    const script: ScriptDefinition = {
      name: 'test',
      steps: [{ name: 's1', command: 'echo', retryCount: -1 }],
    };
    const result = runner.validate(script);
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test('run should execute a simple script', async () => {
    const script: ScriptDefinition = {
      name: 'simple',
      steps: [
        { name: 'echo', command: 'echo hello' },
      ],
    };
    const result = await runner.run(script);
    expect(result.success).toBe(true);
    expect(result.name).toBe('simple');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].name).toBe('echo');
    expect(result.steps[0].success).toBe(true);
  });

  test('run should handle multiple steps', async () => {
    const script: ScriptDefinition = {
      name: 'multi',
      steps: [
        { name: 'step1', command: 'echo 1' },
        { name: 'step2', command: 'echo 2' },
        { name: 'step3', command: 'echo 3' },
      ],
    };
    const result = await runner.run(script);
    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(3);
  });

  test('run in dry-run mode should not execute', async () => {
    runner.setDryRun(true);
    const script: ScriptDefinition = {
      name: 'dry',
      steps: [
        { name: 'step1', command: 'echo hello' },
      ],
    };
    const result = await runner.run(script);
    expect(result.success).toBe(true);
    expect(result.steps[0].stdout).toContain('DRY RUN');
  });

  test('run should resolve variables', async () => {
    const script: ScriptDefinition = {
      name: 'vars',
      variables: { name: 'world' },
      steps: [
        { name: 'greet', command: 'echo {{name}}' },
      ],
    };
    const result = await runner.run(script);
    expect(result.success).toBe(true);
    expect(result.output).toContain('world');
  });

  test('run should skip steps with false conditions', async () => {
    const script: ScriptDefinition = {
      name: 'conditional',
      variables: { run: 'false' },
      steps: [
        { name: 'skip', command: 'echo skip', condition: '{{run}}' },
        { name: 'run', command: 'echo run' },
      ],
    };
    const result = await runner.run(script);
    expect(result.steps[0].skipped).toBe(true);
    expect(result.steps[1].skipped).toBe(false);
  });

  test('run should stop on failure unless continueOnError', async () => {
    const script: ScriptDefinition = {
      name: 'fail',
      steps: [
        { name: 'fail', command: 'false', expectExitCode: 1 },
        { name: 'after', command: 'echo after' },
      ],
    };
    const result = await runner.run(script);
    expect(result.success).toBe(false);
    expect(result.steps).toHaveLength(1);
  });

  test('run should continue on failure with continueOnError', async () => {
    const script: ScriptDefinition = {
      name: 'continue',
      steps: [
        { name: 'fail', command: 'false', expectExitCode: 1, continueOnError: true },
        { name: 'after', command: 'echo after' },
      ],
    };
    const result = await runner.run(script);
    expect(result.success).toBe(false);
    expect(result.steps).toHaveLength(2);
  });

  test('run should include timing information', async () => {
    const script: ScriptDefinition = {
      name: 'timed',
      steps: [{ name: 's1', command: 'echo test' }],
    };
    const result = await runner.run(script);
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.steps[0].duration).toBeGreaterThanOrEqual(0);
  });

  test('registerScript and listAvailableScripts should work', () => {
    const script: ScriptDefinition = {
      name: 'registered',
      description: 'A registered script',
      steps: [{ name: 's1', command: 'echo' }],
    };
    runner.registerScript(script, 'test-source');
    const list = runner.listAvailableScripts();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('registered');
    expect(list[0].source).toBe('test-source');
  });

  test('getResult should return stored result', async () => {
    const script: ScriptDefinition = {
      name: 'result-test',
      steps: [{ name: 's1', command: 'echo' }],
    };
    await runner.run(script);
    const result = runner.getResult('result-test');
    expect(result).toBeDefined();
    expect(result!.success).toBe(true);
  });

  test('clearResults should clear stored results', async () => {
    const script: ScriptDefinition = {
      name: 'clear-test',
      steps: [{ name: 's1', command: 'echo' }],
    };
    await runner.run(script);
    runner.clearResults();
    expect(runner.getResult('clear-test')).toBeUndefined();
  });

  test('runFile should throw for unregistered script', async () => {
    await expect(runner.runFile('nonexistent')).rejects.toThrow('not found');
  });

  test('setStepByStep should set the flag', () => {
    runner.setStepByStep(true);
    // No direct getter, but should not throw
  });
});

// ============================================================
// Module 10: CLISessionManager
// ============================================================
describe('CLISessionManager', () => {
  let manager: CLISessionManager;

  beforeEach(() => {
    manager = new CLISessionManager();
  });

  test('should be instantiable', () => {
    expect(manager).toBeDefined();
    expect(manager).toBeInstanceOf(CLISessionManager);
  });

  test('createSession should create a new session', () => {
    const session = manager.createSession('test');
    expect(session.name).toBe('test');
    expect(session.id).toBeDefined();
    expect(session.isActive).toBe(false);
    expect(session.createdAt).toBeInstanceOf(Date);
  });

  test('switchSession should activate a session', () => {
    const session = manager.createSession('test');
    manager.switchSession(session.id);
    expect(session.isActive).toBe(true);
    expect(manager.getActiveSession()?.id).toBe(session.id);
  });

  test('switchSession should deactivate previous session', () => {
    const s1 = manager.createSession('s1');
    const s2 = manager.createSession('s2');
    manager.switchSession(s1.id);
    manager.switchSession(s2.id);
    expect(s1.isActive).toBe(false);
    expect(s2.isActive).toBe(true);
  });

  test('switchSession should throw for non-existent session', () => {
    expect(() => manager.switchSession('nonexistent')).toThrow('not found');
  });

  test('getSession should return session by id', () => {
    const session = manager.createSession('test');
    expect(manager.getSession(session.id)).toBe(session);
  });

  test('getSession should return undefined for non-existent', () => {
    expect(manager.getSession('nonexistent')).toBeUndefined();
  });

  test('getAllSessions should return all sessions', () => {
    manager.createSession('s1');
    manager.createSession('s2');
    expect(manager.getAllSessions()).toHaveLength(2);
  });

  test('deleteSession should remove a session', () => {
    const session = manager.createSession('test');
    expect(manager.deleteSession(session.id)).toBe(true);
    expect(manager.getSession(session.id)).toBeUndefined();
  });

  test('deleteSession should clear activeSessionId if active', () => {
    const session = manager.createSession('test');
    manager.switchSession(session.id);
    manager.deleteSession(session.id);
    expect(manager.getActiveSession()).toBeUndefined();
  });

  test('addToHistory should add entry', () => {
    manager.createSession('test');
    manager.switchSession(manager.getAllSessions()[0].id);
    manager.addToHistory({ command: 'ls -la' });
    const history = manager.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].command).toBe('ls -la');
    expect(history[0].timestamp).toBeInstanceOf(Date);
  });

  test('getHistory should filter by session', () => {
    const s1 = manager.createSession('s1');
    const s2 = manager.createSession('s2');
    manager.switchSession(s1.id);
    manager.addToHistory({ command: 'cmd1' });
    manager.switchSession(s2.id);
    manager.addToHistory({ command: 'cmd2' });
    expect(manager.getHistory(s1.id)).toHaveLength(1);
    expect(manager.getHistory(s1.id)[0].command).toBe('cmd1');
    expect(manager.getHistory(s2.id)).toHaveLength(1);
    expect(manager.getHistory(s2.id)[0].command).toBe('cmd2');
  });

  test('searchHistory should find matching commands', () => {
    manager.createSession('test');
    manager.switchSession(manager.getAllSessions()[0].id);
    manager.addToHistory({ command: 'git status' });
    manager.addToHistory({ command: 'git log' });
    manager.addToHistory({ command: 'npm install' });
    const results = manager.searchHistory('git');
    expect(results).toHaveLength(2);
  });

  test('clearHistory should clear all history', () => {
    manager.createSession('test');
    manager.switchSession(manager.getAllSessions()[0].id);
    manager.addToHistory({ command: 'cmd1' });
    manager.addToHistory({ command: 'cmd2' });
    manager.clearHistory();
    expect(manager.getHistory()).toHaveLength(0);
  });

  test('clearHistory should clear only specified session', () => {
    const s1 = manager.createSession('s1');
    const s2 = manager.createSession('s2');
    manager.switchSession(s1.id);
    manager.addToHistory({ command: 'cmd1' });
    manager.switchSession(s2.id);
    manager.addToHistory({ command: 'cmd2' });
    manager.clearHistory(s1.id);
    expect(manager.getHistory(s1.id)).toHaveLength(0);
    expect(manager.getHistory(s2.id)).toHaveLength(1);
  });

  test('addFavorite should add a favorite command', () => {
    const fav = manager.addFavorite('deploy', 'npm run deploy', 'Deploy to production', ['deploy', 'prod']);
    expect(fav.name).toBe('deploy');
    expect(fav.command).toBe('npm run deploy');
    expect(fav.tags).toEqual(['deploy', 'prod']);
  });

  test('getFavorites should return all favorites', () => {
    manager.addFavorite('f1', 'cmd1');
    manager.addFavorite('f2', 'cmd2');
    expect(manager.getFavorites()).toHaveLength(2);
  });

  test('getFavorites should filter by tags', () => {
    manager.addFavorite('f1', 'cmd1', undefined, ['a']);
    manager.addFavorite('f2', 'cmd2', undefined, ['b']);
    manager.addFavorite('f3', 'cmd3', undefined, ['a', 'b']);
    expect(manager.getFavorites(['a'])).toHaveLength(2);
    expect(manager.getFavorites(['b'])).toHaveLength(2);
    expect(manager.getFavorites(['c'])).toHaveLength(0);
  });

  test('removeFavorite should remove a favorite', () => {
    manager.addFavorite('f1', 'cmd1');
    expect(manager.removeFavorite('f1')).toBe(true);
    expect(manager.getFavorites()).toHaveLength(0);
  });

  test('removeFavorite should return false for non-existent', () => {
    expect(manager.removeFavorite('nonexistent')).toBe(false);
  });

  test('recordSession should start a recording', () => {
    const recording = manager.recordSession();
    expect(recording.id).toBeDefined();
    expect(recording.isActive).toBe(true);
    expect(recording.entries).toHaveLength(0);
  });

  test('stopRecording should stop a recording', () => {
    const recording = manager.recordSession();
    const stopped = manager.stopRecording(recording.id);
    expect(stopped).toBeDefined();
    expect(stopped!.isActive).toBe(false);
    expect(stopped!.endTime).toBeInstanceOf(Date);
  });

  test('getRecording should return recording by id', () => {
    const recording = manager.recordSession();
    expect(manager.getRecording(recording.id)).toBe(recording);
  });

  test('getRecordings should filter by session', () => {
    const r1 = manager.recordSession();
    manager.stopRecording(r1.id);
    const recordings = manager.getRecordings();
    expect(recordings).toHaveLength(1);
  });

  test('replaySession should throw for non-existent recording', async () => {
    await expect(manager.replaySession('nonexistent')).rejects.toThrow('not found');
  });

  test('exportSession as JSON should produce valid JSON', () => {
    manager.createSession('test');
    manager.switchSession(manager.getAllSessions()[0].id);
    manager.addToHistory({ command: 'ls' });
    const json = manager.exportSession('json');
    const parsed = JSON.parse(json);
    expect(parsed.history).toHaveLength(1);
  });

  test('exportSession as markdown should produce readable output', () => {
    manager.createSession('test');
    manager.switchSession(manager.getAllSessions()[0].id);
    manager.addToHistory({ command: 'ls' });
    const md = manager.exportSession('markdown');
    expect(md).toContain('# Session: test');
    expect(md).toContain('Command History');
  });

  test('getHistoryStats should return statistics', () => {
    manager.createSession('test');
    manager.switchSession(manager.getAllSessions()[0].id);
    manager.addToHistory({ command: 'ls' });
    manager.addToHistory({ command: 'ls' });
    manager.addToHistory({ command: 'pwd' });
    const stats = manager.getHistoryStats();
    expect(stats.total).toBe(3);
    expect(stats.mostUsed[0].command).toBe('ls');
    expect(stats.mostUsed[0].count).toBe(2);
  });

  test('setMaxHistory should limit history size', () => {
    manager.createSession('test');
    manager.switchSession(manager.getAllSessions()[0].id);
    manager.setMaxHistory(2);
    manager.addToHistory({ command: 'cmd1' });
    manager.addToHistory({ command: 'cmd2' });
    manager.addToHistory({ command: 'cmd3' });
    expect(manager.getHistory()).toHaveLength(2);
  });
});
