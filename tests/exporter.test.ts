// ============================================================================
// Tests for @claude-agent/exporter
// ============================================================================
import { describe, test, expect } from 'bun:test';
import { Exporter } from '../packages/exporter/src/index.js';

describe('@claude-agent/exporter', () => {
  let exporter: Exporter;
  const sampleData = {
    title: 'Test Report',
    content: 'This is a test report.',
    metadata: { author: 'Claude', date: '2024-01-01' },
    sections: [
      { heading: 'Introduction', content: 'Intro text.' },
      { heading: 'Conclusion', content: 'Conclusion text.' },
    ],
    tables: [
      { headers: ['Name', 'Value'], rows: [['A', '1'], ['B', '2']] },
    ],
  };

  beforeEach(() => { exporter = new Exporter(); });

  test('exports JSON', () => {
    const result = exporter.exportJSON(sampleData);
    expect(result.format).toBe('json');
    expect(result.size).toBeGreaterThan(0);
    const parsed = JSON.parse(result.content);
    expect(parsed.title).toBe('Test Report');
  });

  test('exports Markdown', () => {
    const result = exporter.exportMarkdown(sampleData);
    expect(result.format).toBe('markdown');
    expect(result.content).toContain('# Test Report');
    expect(result.content).toContain('## Introduction');
    expect(result.content).toContain('| Name | Value |');
  });

  test('exports HTML', () => {
    const result = exporter.exportHTML(sampleData);
    expect(result.format).toBe('html');
    expect(result.content).toContain('<h1>Test Report</h1>');
    expect(result.content).toContain('<h2>Introduction</h2>');
    expect(result.content).toContain('<table>');
  });

  test('exports PDF (HTML wrapper)', () => {
    const result = exporter.exportPDF(sampleData);
    expect(result.format).toBe('pdf');
    expect(result.content).toContain('<h1>Test Report</h1>');
  });

  test('export method dispatches correctly', () => {
    const json = exporter.export(sampleData, 'json');
    expect(json.format).toBe('json');
    const md = exporter.export(sampleData, 'markdown');
    expect(md.format).toBe('markdown');
    const html = exporter.export(sampleData, 'html');
    expect(html.format).toBe('html');
  });

  test('handles minimal data', () => {
    const minimal = { title: 'Minimal', content: 'Content' };
    const result = exporter.exportJSON(minimal);
    expect(result.format).toBe('json');
  });
});
