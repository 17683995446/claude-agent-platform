// ============================================================================
// Tests for @claude-agent/examples
// ============================================================================
import { describe, test, expect } from 'bun:test';
import { EXAMPLES, getExample, listExamples, listExamplesByDifficulty, listExamplesByTag } from '../packages/examples/src/index.js';

describe('@claude-agent/examples', () => {
  test('has 5 examples', () => {
    expect(EXAMPLES.length).toBe(5);
  });

  test('lists all examples', () => {
    const list = listExamples();
    expect(list.length).toBe(5);
    expect(list[0]!.id).toBe('hello-agent');
  });

  test('gets example by id', () => {
    const example = getExample('hello-agent');
    expect(example).toBeDefined();
    expect(example!.name).toBe('Hello Agent');
    expect(example!.difficulty).toBe('beginner');
  });

  test('returns undefined for unknown example', () => {
    expect(getExample('unknown')).toBeUndefined();
  });

  test('lists by difficulty', () => {
    const beginner = listExamplesByDifficulty('beginner');
    expect(beginner.length).toBeGreaterThan(0);
    const advanced = listExamplesByDifficulty('advanced');
    expect(advanced.length).toBeGreaterThan(0);
  });

  test('lists by tag', () => {
    const core = listExamplesByTag('core');
    expect(core.length).toBeGreaterThan(0);
    const pipeline = listExamplesByTag('pipeline');
    expect(pipeline.length).toBeGreaterThan(0);
  });

  test('examples have readme', () => {
    for (const example of EXAMPLES) {
      expect(example.readme).toBeDefined();
      expect(example.readme.length).toBeGreaterThan(0);
    }
  });

  test('examples have code', () => {
    for (const example of EXAMPLES) {
      expect(example.code).toBeDefined();
      expect(example.code.length).toBeGreaterThan(0);
    }
  });

  test('examples have tags', () => {
    for (const example of EXAMPLES) {
      expect(example.tags.length).toBeGreaterThan(0);
    }
  });

  test('difficulty progression', () => {
    const difficulties = EXAMPLES.map(e => e.difficulty);
    expect(difficulties).toContain('beginner');
    expect(difficulties).toContain('intermediate');
    expect(difficulties).toContain('advanced');
  });
});
