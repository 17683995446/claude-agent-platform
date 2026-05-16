// ============================================================================
// Tests for @claude-agent/api-docs
// ============================================================================
import { describe, test, expect, beforeEach } from 'bun:test';
import { APIDocumentation } from '../packages/api-docs/src/index.js';

describe('@claude-agent/api-docs', () => {
  let docs: APIDocumentation;

  beforeEach(() => { docs = APIDocumentation.createDefault(); });

  test('creates with default entries', () => {
    expect(docs.listEntities().length).toBeGreaterThan(0);
  });

  test('lists packages', () => {
    const packages = docs.listPackages();
    expect(packages).toContain('core');
    expect(packages).toContain('pipeline');
    expect(packages).toContain('plugins');
  });

  test('gets entry by package and name', () => {
    const entry = docs.getEntry('core', 'AgentCore');
    expect(entry).toBeDefined();
    expect(entry!.description).toContain('agent');
  });

  test('returns undefined for unknown entry', () => {
    expect(docs.getEntry('unknown', 'Unknown')).toBeUndefined();
  });

  test('gets entries by package', () => {
    const core = docs.getByPackage('core');
    expect(core.length).toBeGreaterThan(0);
  });

  test('searches by name', () => {
    const results = docs.search('EventBus');
    expect(results.length).toBeGreaterThan(0);
  });

  test('searches by description', () => {
    const results = docs.search('lifecycle');
    expect(results.length).toBeGreaterThan(0);
  });

  test('searches by tag', () => {
    const results = docs.search('events');
    expect(results.length).toBeGreaterThan(0);
  });

  test('lists entities', () => {
    const entities = docs.listEntities();
    expect(entities.length).toBeGreaterThan(0);
    expect(entities[0]!.name).toBeDefined();
    expect(entities[0]!.type).toBeDefined();
  });

  test('lists entities for package', () => {
    const entities = docs.listEntities('core');
    expect(entities.length).toBeGreaterThan(0);
  });

  test('generates markdown documentation', () => {
    const md = docs.generateMarkdown();
    expect(md).toContain('# Claude Agent Platform API Documentation');
    expect(md).toContain('## @claude-agent/core');
    expect(md).toContain('AgentCore');
  });

  test('adds custom entry', () => {
    docs.addEntry({
      packageName: 'custom',
      entityName: 'CustomClass',
      entityType: 'class',
      description: 'A custom class',
      members: [{ name: 'method()', type: 'void', description: 'Does something' }],
    });
    expect(docs.getEntry('custom', 'CustomClass')).toBeDefined();
  });
});
