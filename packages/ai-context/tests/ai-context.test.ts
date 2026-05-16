import { describe, test, expect, beforeEach } from 'bun:test';
import { ContextWindowManager, countTokens } from '../src/context-window.ts';
import { CodeUnderstandingEngine } from '../src/code-understanding.ts';
import { IntentRecognizer } from '../src/intent-recognition.ts';
import { KnowledgeSynthesizer } from '../src/knowledge-synthesis.ts';
import { ConversationMemory } from '../src/conversation-memory.ts';
import { TaskPlanner } from '../src/task-planner.ts';
import { CodeGenerationAssistant } from '../src/code-generation.ts';
import { ErrorDiagnosisEngine } from '../src/error-diagnosis.ts';
import { ProjectInsightsEngine } from '../src/project-insights.ts';
import { AdaptiveLearningSystem } from '../src/adaptive-learning.ts';

// ============================================================
// Module 1: ContextWindowManager Tests
// ============================================================
describe('ContextWindowManager', () => {
  let manager: ContextWindowManager;

  beforeEach(() => {
    manager = new ContextWindowManager(10_000);
  });

  test('should create with default token budget', () => {
    const m = new ContextWindowManager();
    expect(m.getRemainingTokens()).toBe(200_000);
  });

  test('should create with custom token budget', () => {
    expect(manager.getRemainingTokens()).toBe(10_000);
  });

  test('should add a message and reduce remaining tokens', () => {
    manager.addMessage('user', 'Hello world');
    expect(manager.getMessageCount()).toBe(1);
    expect(manager.getRemainingTokens()).toBeLessThan(10_000);
  });

  test('should count tokens for English text', () => {
    const tokens = countTokens('Hello world this is a test');
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThanOrEqual(30);
  });

  test('should count tokens for CJK text', () => {
    const tokens = countTokens('你好世界这是一个测试');
    expect(tokens).toBeGreaterThan(0);
  });

  test('should add messages with different roles', () => {
    manager.addMessage('system', 'You are helpful');
    manager.addMessage('user', 'Hello');
    manager.addMessage('assistant', 'Hi there');
    manager.addMessage('code', 'const x = 1;');
    expect(manager.getMessageCount()).toBe(4);
  });

  test('should add message with custom priority', () => {
    manager.addMessage('user', 'Hello', 99);
    const snapshot = manager.getOptimalContext();
    expect(snapshot.messages.length).toBe(1);
  });

  test('should return optimal context snapshot', () => {
    manager.addMessage('system', 'System prompt');
    manager.addMessage('user', 'User message');
    const snapshot = manager.getOptimalContext();
    expect(snapshot.messages.length).toBeGreaterThan(0);
    expect(snapshot.totalTokens).toBeGreaterThan(0);
  });

  test('should categorize tokens by role in snapshot', () => {
    manager.addMessage('system', 'System prompt here');
    manager.addMessage('user', 'User message here');
    manager.addMessage('code', 'const x = 1;');
    const snapshot = manager.getOptimalContext();
    expect(snapshot.systemTokens).toBeGreaterThan(0);
    expect(snapshot.userTokens).toBeGreaterThan(0);
    expect(snapshot.codeTokens).toBeGreaterThan(0);
  });

  test('should prioritize system messages in optimal context', () => {
    manager.addMessage('user', 'a'.repeat(5000));
    manager.addMessage('system', 'System prompt');
    const snapshot = manager.getOptimalContext();
    const hasSystem = snapshot.messages.some(m => m.role === 'system');
    expect(hasSystem).toBe(true);
  });

  test('should compress context when over target', () => {
    for (let i = 0; i < 100; i++) {
      manager.addMessage('history', `Historical message number ${i} with some content`);
    }
    const result = manager.compress(1000);
    expect(result.compressionRatio).toBeLessThan(1);
    expect(result.originalTokens).toBeGreaterThan(result.compressedTokens);
  });

  test('should not compress when under target', () => {
    manager.addMessage('user', 'Hello');
    const result = manager.compress(10000);
    expect(result.compressionRatio).toBe(1);
    expect(result.removedMessages.length).toBe(0);
  });

  test('should clear all messages', () => {
    manager.addMessage('user', 'Hello');
    manager.clear();
    expect(manager.getMessageCount()).toBe(0);
    expect(manager.getRemainingTokens()).toBe(10_000);
  });

  test('should handle empty context gracefully', () => {
    const snapshot = manager.getOptimalContext();
    expect(snapshot.messages.length).toBe(0);
    expect(snapshot.totalTokens).toBe(0);
  });
});

// ============================================================
// Module 2: CodeUnderstandingEngine Tests
// ============================================================
describe('CodeUnderstandingEngine', () => {
  let engine: CodeUnderstandingEngine;

  beforeEach(() => {
    engine = new CodeUnderstandingEngine();
  });

  test('should analyze a simple TypeScript function', () => {
    const code = `function add(a: number, b: number): number {\n  return a + b;\n}`;
    const result = engine.analyzeFile(code, 'typescript');
    expect(result.functions.length).toBeGreaterThan(0);
    expect(result.functions[0].name).toBe('add');
  });

  test('should extract function parameters', () => {
    const code = `function greet(name: string, age: number): string {\n  return \`Hello \${name}\`;\n}`;
    const result = engine.analyzeFile(code, 'typescript');
    expect(result.functions[0].parameters).toContain('name');
    expect(result.functions[0].parameters).toContain('age');
  });

  test('should extract function return type', () => {
    const code = `function add(a: number, b: number): number {\n  return a + b;\n}`;
    const result = engine.analyzeFile(code, 'typescript');
    expect(result.functions[0].returnType).toBe('number');
  });

  test('should analyze a class with methods', () => {
    const code = `class Calculator {\n  add(a: number, b: number): number {\n    return a + b;\n  }\n  subtract(a: number, b: number): number {\n    return a - b;\n  }\n}`;
    const result = engine.analyzeFile(code, 'typescript');
    expect(result.classes.length).toBe(1);
    expect(result.classes[0].name).toBe('Calculator');
    expect(result.classes[0].methods.length).toBeGreaterThanOrEqual(2);
  });

  test('should detect class inheritance', () => {
    const code = `class Animal {\n  name: string;\n}\nclass Dog extends Animal {\n  bark(): void {}\n}`;
    const result = engine.analyzeFile(code, 'typescript');
    expect(result.classes.length).toBe(2);
    const dog = result.classes.find(c => c.name === 'Dog');
    expect(dog?.inheritance).toContain('Animal');
  });

  test('should extract imports', () => {
    const code = `import { useState } from 'react';\nimport fs from 'fs';`;
    const result = engine.analyzeFile(code, 'typescript');
    expect(result.imports.length).toBe(2);
    expect(result.imports[0].source).toBe('react');
    expect(result.imports[0].specifiers).toContain('useState');
  });

  test('should extract exports', () => {
    const code = `export function hello() {}\nexport class Foo {}\nexport const bar = 1;`;
    const result = engine.analyzeFile(code, 'typescript');
    expect(result.exports).toContain('hello');
    expect(result.exports).toContain('Foo');
    expect(result.exports).toContain('bar');
  });

  test('should compute cyclomatic complexity', () => {
    const code = `function complex(x: number) {\n  if (x > 0) {\n    if (x > 10) {\n      return 1;\n    } else {\n      return 2;\n    }\n  } else {\n    return 3;\n  }\n}`;
    const result = engine.analyzeFile(code, 'typescript');
    expect(result.complexity.cyclomaticComplexity).toBeGreaterThan(1);
  });

  test('should count lines of code', () => {
    const code = `function test() {\n  const a = 1;\n  const b = 2;\n  return a + b;\n}`;
    const result = engine.analyzeFile(code, 'typescript');
    expect(result.complexity.linesOfCode).toBeGreaterThan(0);
  });

  test('should analyze a project with multiple files', () => {
    const files = [
      { path: 'src/index.ts', content: `export function main() { return helper(); }`, language: 'typescript' },
      { path: 'src/helper.ts', content: `export function helper() { return 42; }`, language: 'typescript' },
    ];
    const result = engine.analyzeProject(files);
    expect(result.files.size).toBe(2);
    expect(result.dependencyGraph.size).toBe(2);
  });

  test('should find related symbols in project analysis', () => {
    const files = [
      { path: 'src/index.ts', content: `import { helper } from './helper';\nexport function main() { return helper(); }`, language: 'typescript' },
      { path: 'src/helper.ts', content: `export function helper() { return 42; }`, language: 'typescript' },
    ];
    const analysis = engine.analyzeProject(files);
    const relations = engine.findRelatedSymbols('main', analysis);
    expect(relations.length).toBeGreaterThan(0);
  });

  test('should generate code summary', () => {
    const code = `export function add(a: number, b: number): number { return a + b; }`;
    const result = engine.analyzeFile(code, 'typescript');
    expect(result.summary).toContain('function');
  });

  test('should analyze arrow functions', () => {
    const code = `const multiply = (a: number, b: number): number => a * b;`;
    const result = engine.analyzeFile(code, 'typescript');
    expect(result.functions.some(f => f.name === 'multiply')).toBe(true);
  });

  test('should detect async functions', () => {
    const code = `async function fetchData(): Promise<string> { return 'data'; }`;
    const result = engine.analyzeFile(code, 'typescript');
    expect(result.functions.length).toBeGreaterThan(0);
    expect(result.functions[0].name).toBe('fetchData');
  });
});

// ============================================================
// Module 3: IntentRecognizer Tests
// ============================================================
describe('IntentRecognizer', () => {
  let recognizer: IntentRecognizer;

  beforeEach(() => {
    recognizer = new IntentRecognizer();
  });

  test('should recognize code_generate intent', () => {
    const result = recognizer.recognize('Create a new function to calculate fibonacci');
    expect(result.primaryIntent).toBe('code_generate');
  });

  test('should recognize code_fix intent', () => {
    const result = recognizer.recognize('Fix the bug in the login function');
    expect(result.primaryIntent).toBe('code_fix');
  });

  test('should recognize code_review intent', () => {
    const result = recognizer.recognize('Review this code for potential issues');
    expect(result.primaryIntent).toBe('code_review');
  });

  test('should recognize code_refactor intent', () => {
    const result = recognizer.recognize('Refactor this component to use hooks');
    expect(result.primaryIntent).toBe('code_refactor');
  });

  test('should recognize code_explain intent', () => {
    const result = recognizer.recognize('Explain how this algorithm works');
    expect(result.primaryIntent).toBe('code_explain');
  });

  test('should recognize code_test intent', () => {
    const result = recognizer.recognize('Write tests for the user service');
    expect(result.primaryIntent).toBe('code_test');
  });

  test('should recognize code_search intent', () => {
    const result = recognizer.recognize('Find where the database connection is configured');
    expect(result.primaryIntent).toBe('code_search');
  });

  test('should recognize project_setup intent', () => {
    const result = recognizer.recognize('Set up a new Express project');
    expect(result.primaryIntent).toBe('project_setup');
  });

  test('should recognize deployment intent', () => {
    const result = recognizer.recognize('Deploy this application to production');
    expect(result.primaryIntent).toBe('deployment');
  });

  test('should recognize debugging intent', () => {
    const result = recognizer.recognize('Debug the memory leak in the worker');
    expect(result.primaryIntent).toBe('debugging');
  });

  test('should recognize documentation intent', () => {
    const result = recognizer.recognize('Generate documentation for the API');
    expect(result.primaryIntent).toBe('documentation');
  });

  test('should default to general_question for unclear input', () => {
    const result = recognizer.recognize('What time is it?');
    expect(result.primaryIntent).toBe('general_question');
  });

  test('should detect Chinese language', () => {
    const result = recognizer.recognize('创建一个新的函数');
    expect(result.language).toBe('chinese');
  });

  test('should detect English language', () => {
    const result = recognizer.recognize('Create a new function');
    expect(result.language).toBe('english');
  });

  test('should detect urgent priority', () => {
    const result = recognizer.recognize('urgent fix the login bug');
    expect(result.priority).toBe('urgent');
  });

  test('should detect high priority', () => {
    const result = recognizer.recognize('This is important, fix the bug');
    expect(result.priority).toBe('high');
  });

  test('should detect low priority', () => {
    const result = recognizer.recognize('When possible, refactor this code');
    expect(result.priority).toBe('low');
  });

  test('should default to normal priority', () => {
    const result = recognizer.recognize('Explain this function');
    expect(result.priority).toBe('normal');
  });

  test('should extract file path entities', () => {
    const result = recognizer.recognize('Look at src/index.ts');
    const hasFilePath = result.entities.some(e => e.type === 'file_path');
    expect(hasFilePath).toBe(true);
  });

  test('should extract code snippet entities', () => {
    const result = recognizer.recognize('What does `useState` do?');
    const hasSnippet = result.entities.some(e => e.type === 'code_snippet');
    expect(hasSnippet).toBe(true);
  });

  test('should extract URL entities', () => {
    const result = recognizer.recognize('Check https://example.com/api');
    const hasUrl = result.entities.some(e => e.type === 'url');
    expect(hasUrl).toBe(true);
  });

  test('should return confidence score', () => {
    const result = recognizer.recognize('Create a function');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  test('should detect secondary intents', () => {
    const result = recognizer.recognize('Create and test a new API endpoint');
    expect(result.secondaryIntents.length).toBeGreaterThan(0);
  });

  test('should use conversation history for context', () => {
    recognizer.addToHistory('user', 'Create a function');
    const result = recognizer.recognize('Now add tests for it');
    expect(result).toBeDefined();
  });

  test('should clear history', () => {
    recognizer.addToHistory('user', 'Hello');
    recognizer.clearHistory();
    // Should not throw
    const result = recognizer.recognize('Hello');
    expect(result).toBeDefined();
  });
});

// ============================================================
// Module 4: KnowledgeSynthesizer Tests
// ============================================================
describe('KnowledgeSynthesizer', () => {
  let synthesizer: KnowledgeSynthesizer;

  beforeEach(() => {
    synthesizer = new KnowledgeSynthesizer();
  });

  test('should add a knowledge fact', () => {
    synthesizer.addKnowledge({
      id: 'f1',
      entity: 'UserService',
      attribute: 'purpose',
      value: 'Handles user authentication',
      source: 'code_analysis',
      confidence: 0.9,
      timestamp: Date.now(),
    });
    expect(synthesizer.getFactCount()).toBe(1);
  });

  test('should not add duplicate facts', () => {
    synthesizer.addKnowledge({
      id: 'f1',
      entity: 'UserService',
      attribute: 'purpose',
      value: 'Handles user authentication',
      source: 'code_analysis',
      confidence: 0.9,
      timestamp: Date.now(),
    });
    synthesizer.addKnowledge({
      id: 'f2',
      entity: 'UserService',
      attribute: 'purpose',
      value: 'Handles user authentication',
      source: 'code_analysis',
      confidence: 0.8,
      timestamp: Date.now(),
    });
    expect(synthesizer.getFactCount()).toBe(1);
  });

  test('should update confidence for duplicate with higher confidence', () => {
    synthesizer.addKnowledge({
      id: 'f1', entity: 'A', attribute: 'x', value: '1',
      source: 'code_analysis', confidence: 0.5, timestamp: Date.now(),
    });
    synthesizer.addKnowledge({
      id: 'f2', entity: 'A', attribute: 'x', value: '1',
      source: 'code_analysis', confidence: 0.9, timestamp: Date.now(),
    });
    const related = synthesizer.getRelatedKnowledge('A');
    expect(related[0].confidence).toBe(0.9);
  });

  test('should synthesize from multiple sources', () => {
    const sources = [
      { type: 'code_analysis' as const, content: 'UserService handles authentication', confidence: 0.9, timestamp: Date.now() },
      { type: 'documentation' as const, content: 'UserService is responsible for user management', confidence: 0.8, timestamp: Date.now() },
    ];
    const result = synthesizer.synthesize(sources);
    expect(result.facts.length).toBeGreaterThan(0);
    expect(result.sourceCount).toBe(2);
  });

  test('should detect contradictions in sources', () => {
    const sources = [
      { type: 'code_analysis' as const, content: 'Framework is React', confidence: 0.9, timestamp: Date.now() },
      { type: 'documentation' as const, content: 'Framework is Vue', confidence: 0.8, timestamp: Date.now() },
    ];
    const result = synthesizer.synthesize(sources);
    expect(result.contradictions.length).toBeGreaterThan(0);
  });

  test('should query the knowledge graph', () => {
    synthesizer.addKnowledge({
      id: 'f1', entity: 'React', attribute: 'type', value: 'framework',
      source: 'code_analysis', confidence: 0.9, timestamp: Date.now(),
    });
    const results = synthesizer.queryGraph('React');
    expect(results.length).toBeGreaterThan(0);
  });

  test('should return empty for unknown graph queries', () => {
    const results = synthesizer.queryGraph('NonExistentEntity');
    expect(results.length).toBe(0);
  });

  test('should get related knowledge for an entity', () => {
    synthesizer.addKnowledge({
      id: 'f1', entity: 'UserService', attribute: 'depends', value: 'DatabaseService',
      source: 'code_analysis', confidence: 0.9, timestamp: Date.now(),
    });
    synthesizer.addKnowledge({
      id: 'f2', entity: 'DatabaseService', attribute: 'type', value: 'service',
      source: 'code_analysis', confidence: 0.9, timestamp: Date.now(),
    });
    const related = synthesizer.getRelatedKnowledge('UserService');
    expect(related.length).toBeGreaterThan(0);
  });

  test('should generate synthesis summary', () => {
    const sources = [
      { type: 'code_analysis' as const, content: 'App uses TypeScript', confidence: 0.9, timestamp: Date.now() },
    ];
    const result = synthesizer.synthesize(sources);
    expect(result.summary).toContain('1 facts');
  });

  test('should clear all knowledge', () => {
    synthesizer.addKnowledge({
      id: 'f1', entity: 'A', attribute: 'x', value: '1',
      source: 'code_analysis', confidence: 0.9, timestamp: Date.now(),
    });
    synthesizer.clear();
    expect(synthesizer.getFactCount()).toBe(0);
  });
});

// ============================================================
// Module 5: ConversationMemory Tests
// ============================================================
describe('ConversationMemory', () => {
  let memory: ConversationMemory;

  beforeEach(() => {
    memory = new ConversationMemory(10);
  });

  test('should add a message', () => {
    memory.addMessage({
      id: 'm1', role: 'user', content: 'Hello', timestamp: Date.now(),
    });
    expect(memory.getShortTermMessageCount()).toBe(1);
  });

  test('should recall messages by query', () => {
    memory.addMessage({
      id: 'm1', role: 'user', content: 'I need help with TypeScript', timestamp: Date.now(),
    });
    memory.addMessage({
      id: 'm2', role: 'assistant', content: 'Sure, I can help with TypeScript', timestamp: Date.now(),
    });
    const result = memory.recall('TypeScript');
    expect(result.shortTerm.length).toBeGreaterThan(0);
  });

  test('should respect recall options for memory types', () => {
    memory.addMessage({
      id: 'm1', role: 'user', content: 'Hello', timestamp: Date.now(),
    });
    const result = memory.recall('Hello', { memoryTypes: ['short_term'] });
    expect(result.shortTerm.length).toBeGreaterThan(0);
    expect(result.longTerm.length).toBe(0);
  });

  test('should respect maxResults in recall', () => {
    for (let i = 0; i < 5; i++) {
      memory.addMessage({
        id: `m${i}`, role: 'user', content: `Message about TypeScript ${i}`, timestamp: Date.now(),
      });
    }
    const result = memory.recall('TypeScript', { maxResults: 2 });
    expect(result.shortTerm.length).toBeLessThanOrEqual(2);
  });

  test('should consolidate to long-term memory when window overflows', () => {
    for (let i = 0; i < 15; i++) {
      memory.addMessage({
        id: `m${i}`, role: 'user', content: `Message ${i} about various topics`, timestamp: Date.now(),
      });
    }
    expect(memory.getLongTermMemoryCount()).toBeGreaterThan(0);
  });

  test('should generate conversation summary', () => {
    memory.addMessage({
      id: 'm1', role: 'user', content: 'Hello', timestamp: Date.now(),
    });
    memory.addMessage({
      id: 'm2', role: 'assistant', content: 'Hi there', timestamp: Date.now(),
    });
    const summary = memory.getSummary();
    expect(summary.totalMessages).toBe(2);
    expect(summary.userMessages).toBe(1);
    expect(summary.assistantMessages).toBe(1);
  });

  test('should export memory as JSON', () => {
    memory.addMessage({
      id: 'm1', role: 'user', content: 'Hello', timestamp: Date.now(),
    });
    const json = memory.exportMemory('json');
    const parsed = JSON.parse(json);
    expect(parsed.shortTerm.length).toBe(1);
  });

  test('should export memory as markdown', () => {
    memory.addMessage({
      id: 'm1', role: 'user', content: 'Hello', timestamp: Date.now(),
    });
    const md = memory.exportMemory('markdown');
    expect(md).toContain('Conversation Memory');
  });

  test('should add semantic memory', () => {
    memory.addSemanticMemory('user prefers', 'TypeScript over JavaScript', 'conversation');
    const result = memory.recall('TypeScript', { memoryTypes: ['semantic'] });
    expect(result.semantic.length).toBeGreaterThan(0);
  });

  test('should update existing semantic memory', () => {
    memory.addSemanticMemory('pattern', 'rule1', 'source1');
    memory.addSemanticMemory('pattern', 'rule2', 'source2');
    const result = memory.recall('pattern', { memoryTypes: ['semantic'] });
    expect(result.semantic[0].rule).toBe('rule2');
    expect(result.semantic[0].confidence).toBeGreaterThan(0.5);
  });

  test('should clear all memory', () => {
    memory.addMessage({ id: 'm1', role: 'user', content: 'Hello', timestamp: Date.now() });
    memory.clear();
    expect(memory.getShortTermMessageCount()).toBe(0);
    expect(memory.getLongTermMemoryCount()).toBe(0);
  });

  test('should handle empty recall gracefully', () => {
    const result = memory.recall('nonexistent');
    expect(result.shortTerm.length).toBe(0);
    expect(result.totalRelevance).toBe(0);
  });
});

// ============================================================
// Module 6: TaskPlanner Tests
// ============================================================
describe('TaskPlanner', () => {
  let planner: TaskPlanner;

  beforeEach(() => {
    planner = new TaskPlanner();
  });

  test('should create a plan from a request', () => {
    const plan = planner.plan('Create a REST API');
    expect(plan.tasks.length).toBeGreaterThan(0);
    expect(plan.goal).toBe('Create a REST API');
  });

  test('should use refactor template', () => {
    const plan = planner.plan('Refactor the authentication module');
    expect(plan.tasks.length).toBeGreaterThan(0);
    const hasAnalysis = plan.tasks.some(t => t.name.includes('Analyze'));
    expect(hasAnalysis).toBe(true);
  });

  test('should use test template', () => {
    const plan = planner.plan('Write tests for the calculator');
    expect(plan.tasks.length).toBeGreaterThan(0);
    const hasTest = plan.tasks.some(t => t.tags.includes('testing'));
    expect(hasTest).toBe(true);
  });

  test('should use deploy template', () => {
    const plan = planner.plan('Deploy the application');
    expect(plan.tasks.length).toBeGreaterThan(0);
    const hasDeploy = plan.tasks.some(t => t.tags.includes('deployment'));
    expect(hasDeploy).toBe(true);
  });

  test('should calculate total estimated duration', () => {
    const plan = planner.plan('Create a REST API');
    expect(plan.totalEstimatedDuration).toBeGreaterThan(0);
  });

  test('should identify critical path', () => {
    const plan = planner.plan('Create a REST API');
    expect(plan.criticalPath.length).toBeGreaterThan(0);
  });

  test('should order tasks by dependencies', () => {
    const plan = planner.plan('Refactor the code');
    const taskIds = plan.tasks.map(t => t.id);
    for (const task of plan.tasks) {
      for (const dep of task.dependencies) {
        const depIndex = taskIds.indexOf(dep);
        const taskIndex = taskIds.indexOf(task.id);
        expect(depIndex).toBeLessThan(taskIndex);
      }
    }
  });

  test('should adjust plan with approve feedback', () => {
    const plan = planner.plan('Create a function');
    const adjusted = planner.adjustPlan(plan, {
      taskId: plan.tasks[0].id,
      type: 'approve',
    });
    expect(adjusted.tasks[0].status).toBe('completed');
  });

  test('should adjust plan with modify feedback', () => {
    const plan = planner.plan('Create a function');
    const adjusted = planner.adjustPlan(plan, {
      taskId: plan.tasks[0].id,
      type: 'modify',
      modifications: { name: 'Updated task name' },
    });
    expect(adjusted.tasks[0].name).toBe('Updated task name');
  });

  test('should estimate effort for a task', () => {
    const plan = planner.plan('Create a function');
    const estimate = planner.estimateEffort(plan.tasks[0]);
    expect(estimate.complexity).toBeGreaterThan(0);
    expect(estimate.duration).toBeGreaterThan(0);
    expect(['low', 'medium', 'high']).toContain(estimate.riskLevel);
  });

  test('should include required skills in effort estimate', () => {
    const plan = planner.plan('Write tests for the code');
    const testTask = plan.tasks.find(t => t.tags.includes('testing'));
    if (testTask) {
      const estimate = planner.estimateEffort(testTask);
      expect(estimate.requiredSkills).toContain('testing');
    }
  });

  test('should use planning context', () => {
    const plan = planner.plan('Create an API', {
      language: 'typescript',
      framework: 'express',
    });
    expect(plan.context.language).toBe('typescript');
    expect(plan.context.framework).toBe('express');
  });
});

// ============================================================
// Module 7: CodeGenerationAssistant Tests
// ============================================================
describe('CodeGenerationAssistant', () => {
  let assistant: CodeGenerationAssistant;

  beforeEach(() => {
    assistant = new CodeGenerationAssistant();
  });

  test('should generate a function template', () => {
    const result = assistant.generate('function', {
      name: 'add',
      parameters: ['a', 'b'],
      returnType: 'number',
    });
    expect(result.code).toContain('function add');
    expect(result.template).toBe('function');
  });

  test('should generate a class template', () => {
    const result = assistant.generate('class', { name: 'Calculator' });
    expect(result.code).toContain('class Calculator');
    expect(result.template).toBe('class');
  });

  test('should generate an interface template', () => {
    const result = assistant.generate('interface', {
      name: 'User',
      parameters: ['name', 'age', 'email'],
    });
    expect(result.code).toContain('interface User');
    expect(result.code).toContain('name');
  });

  test('should generate a test template', () => {
    const result = assistant.generate('test', { name: 'add' });
    expect(result.code).toContain('describe');
    expect(result.code).toContain('test');
  });

  test('should generate an API endpoint template', () => {
    const result = assistant.generate('api-endpoint', {
      name: 'users',
      parameters: ['GET'],
    });
    expect(result.code).toContain('api/users');
    expect(result.code).toContain('get');
  });

  test('should generate a component template', () => {
    const result = assistant.generate('component', { name: 'Button' });
    expect(result.code).toContain('Button');
    expect(result.code).toContain('className');
  });

  test('should provide completion suggestions', () => {
    const suggestions = assistant.complete({
      prefix: 'import ',
      suffix: '',
      language: 'typescript',
    });
    expect(suggestions.length).toBeGreaterThan(0);
  });

  test('should provide block completion', () => {
    const suggestions = assistant.complete({
      prefix: 'if (true) {',
      suffix: '',
      language: 'typescript',
    });
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].type).toBe('block');
  });

  test('should transform code to arrow function', () => {
    const code = 'function add(a, b) {\n  return a + b;\n}';
    const result = assistant.transform(code, 'arrow-function');
    expect(result.transformed).toContain('const add');
    expect(result.changes.length).toBeGreaterThan(0);
  });

  test('should transform code to use const', () => {
    const code = 'var x = 1;\nlet y = 2;';
    const result = assistant.transform(code, 'const');
    expect(result.transformed).toContain('const');
    expect(result.transformed).not.toContain('var');
  });

  test('should generate unit tests for code', () => {
    const code = 'function add(a, b) { return a + b; }';
    const result = assistant.generateTests(code, 'typescript');
    expect(result.code).toContain('describe');
    expect(result.code).toContain('test');
    expect(result.template).toBe('unit_test');
  });

  test('should generate Python tests', () => {
    const code = 'def add(a, b):\n    return a + b';
    const result = assistant.generateTests(code, 'python');
    expect(result.code).toContain('pytest');
    expect(result.code).toContain('def test');
  });

  test('should register custom template', () => {
    assistant.registerTemplate('custom', (params) => `// Custom: ${params.name}`);
    const result = assistant.generate('custom', { name: 'test' });
    expect(result.code).toContain('Custom: test');
  });

  test('should handle unknown template gracefully', () => {
    const result = assistant.generate('unknown_template', { name: 'test' });
    expect(result.code).toBeDefined();
    expect(result.template).toBe('unknown_template');
  });
});

// ============================================================
// Module 8: ErrorDiagnosisEngine Tests
// ============================================================
describe('ErrorDiagnosisEngine', () => {
  let engine: ErrorDiagnosisEngine;

  beforeEach(() => {
    engine = new ErrorDiagnosisEngine();
  });

  test('should diagnose syntax error', () => {
    const result = engine.diagnose('Unexpected token )');
    expect(result.category).toBe('syntax');
    expect(result.suggestedFixes.length).toBeGreaterThan(0);
  });

  test('should diagnose reference error', () => {
    const result = engine.diagnose('foo is not defined');
    expect(result.category).toBe('runtime');
  });

  test('should diagnose null reference error', () => {
    const result = engine.diagnose('Cannot read properties of null');
    expect(result.category).toBe('runtime');
  });

  test('should diagnose type error', () => {
    const result = engine.diagnose("Type 'string' is not assignable to type 'number'");
    expect(result.category).toBe('type');
  });

  test('should diagnose module not found error', () => {
    const result = engine.diagnose("Cannot find module 'lodash'");
    expect(result.category).toBe('dependency');
  });

  test('should diagnose stack overflow', () => {
    const result = engine.diagnose('Maximum call stack size exceeded');
    expect(result.category).toBe('runtime');
    expect(result.severity).not.toBe('low');
  });

  test('should parse V8 stack trace', () => {
    const stack = `Error: test\n    at Object.<anonymous> (/src/index.js:10:5)\n    at Module._compile (internal/modules/cjs/loader.js:1085:14)`;
    const frames = engine.parseStackTrace(stack);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0].file).toContain('index.js');
    expect(frames[0].line).toBe(10);
  });

  test('should parse empty stack trace', () => {
    const frames = engine.parseStackTrace('');
    expect(frames.length).toBe(0);
  });

  test('should assess severity correctly', () => {
    const critical = engine.diagnose('FATAL: heap out of memory');
    expect(critical.severity).toBe('critical');
  });

  test('should provide fix suggestions', () => {
    const result = engine.diagnose('Cannot find module "express"');
    const fixes = engine.suggestFixes(result);
    expect(fixes.length).toBeGreaterThan(0);
  });

  test('should learn from fixes', () => {
    engine.learnFromFix('Cannot find module "express"', 'bun add express');
    expect(engine.getLearnedFixCount()).toBe(1);
  });

  test('should apply learned fixes to future diagnoses', () => {
    engine.learnFromFix('Cannot find module "express"', 'bun add express');
    engine.learnFromFix('Cannot find module "express"', 'bun add express');
    const result = engine.diagnose('Cannot find module "express"');
    const hasLearnedFix = result.suggestedFixes.some(f => f.description.includes('Previously applied'));
    expect(hasLearnedFix).toBe(true);
  });

  test('should diagnose Error objects', () => {
    const result = engine.diagnose(new Error('Unexpected token'));
    expect(result.category).toBe('syntax');
  });

  test('should provide related errors', () => {
    const result = engine.diagnose('Unexpected token');
    expect(result.relatedErrors.length).toBeGreaterThan(0);
  });

  test('should clear learned fixes', () => {
    engine.learnFromFix('test error', 'test fix');
    engine.clearLearnedFixes();
    expect(engine.getLearnedFixCount()).toBe(0);
  });

  test('should handle diagnosis with context', () => {
    const result = engine.diagnose('Cannot read properties of undefined', {
      code: 'const x = obj.prop;',
      language: 'typescript',
    });
    expect(result.category).toBe('runtime');
    expect(result.suggestedFixes.length).toBeGreaterThan(0);
  });
});

// ============================================================
// Module 9: ProjectInsightsEngine Tests
// ============================================================
describe('ProjectInsightsEngine', () => {
  let engine: ProjectInsightsEngine;

  beforeEach(() => {
    engine = new ProjectInsightsEngine();
  });

  test('should analyze a project', () => {
    const project = {
      files: [
        { path: 'src/index.ts', content: 'export function main() { return 1; }', language: 'typescript' },
      ],
    };
    const insight = engine.analyze(project);
    expect(insight).toBeDefined();
    expect(insight.analyzedAt).toBeGreaterThan(0);
  });

  test('should detect MVC architecture', () => {
    const project = {
      files: [
        { path: 'src/controllers/UserController.ts', content: 'class UserController {}', language: 'typescript' },
        { path: 'src/models/User.ts', content: 'class User {}', language: 'typescript' },
        { path: 'src/views/UserView.ts', content: 'class UserView {}', language: 'typescript' },
      ],
    };
    const insight = engine.analyze(project);
    expect(insight.architecture).toBe('mvc');
  });

  test('should detect component-based architecture', () => {
    const project = {
      files: [
        { path: 'src/App.tsx', content: 'import React from "react";\nfunction App() { return <div />; }', language: 'typescript' },
      ],
    };
    const insight = engine.analyze(project);
    expect(insight.architecture).toBe('component-based');
  });

  test('should compute quality metrics', () => {
    const project = {
      files: [
        { path: 'src/index.ts', content: 'export function add(a: number, b: number): number { return a + b; }', language: 'typescript' },
      ],
    };
    const insight = engine.analyze(project);
    expect(insight.quality.maintainabilityIndex).toBeGreaterThan(0);
    expect(insight.quality.technicalDebtScore).toBeGreaterThanOrEqual(0);
    expect(insight.quality.duplicationRatio).toBeGreaterThanOrEqual(0);
  });

  test('should analyze dependencies', () => {
    const project = {
      files: [
        { path: 'src/index.ts', content: "import { helper } from './helper';\nimport fs from 'fs';", language: 'typescript' },
        { path: 'src/helper.ts', content: "export function helper() {}", language: 'typescript' },
      ],
    };
    const insight = engine.analyze(project);
    expect(insight.dependencies.dependencyCount).toBeGreaterThan(0);
    expect(insight.dependencies.externalDependencyCount).toBeGreaterThan(0);
  });

  test('should detect team patterns', () => {
    const project = {
      files: [
        { path: 'src/index.ts', content: "const x = 'hello';\nconst y = 'world';", language: 'typescript' },
      ],
    };
    const insight = engine.analyze(project);
    expect(insight.patterns.codingStyleConsistency).toBeGreaterThan(0);
  });

  test('should generate insight summary', () => {
    const project = {
      files: [
        { path: 'src/index.ts', content: 'export function main() {}', language: 'typescript' },
      ],
    };
    const insight = engine.analyze(project);
    expect(insight.summary).toContain('Architecture');
  });

  test('should provide recommendations', () => {
    const project = {
      files: [
        { path: 'src/index.ts', content: 'function complex(x) { if (x) { if (x > 0) { if (x > 10) { return 1; } } } }', language: 'typescript' },
      ],
    };
    const insight = engine.analyze(project);
    const recs = engine.getRecommendations(insight);
    expect(recs.length).toBeGreaterThan(0);
  });

  test('should compare two insights', () => {
    const project1 = {
      files: [{ path: 'src/index.ts', content: 'function a() {}', language: 'typescript' }],
    };
    const project2 = {
      files: [
        { path: 'src/index.ts', content: 'function a() {}', language: 'typescript' },
        { path: 'src/index.test.ts', content: 'test("a", () => {})', language: 'typescript' },
      ],
    };
    const before = engine.analyze(project1);
    const after = engine.analyze(project2);
    const diff = engine.compareInsights(before, after);
    expect(diff.qualityChanges.length).toBeGreaterThan(0);
    expect(diff.summary).toBeDefined();
  });

  test('should detect unknown architecture for small projects', () => {
    const project = {
      files: [
        { path: 'index.ts', content: 'console.log("hello");', language: 'typescript' },
      ],
    };
    const insight = engine.analyze(project);
    expect(insight.architecture).toBe('unknown');
  });
});

// ============================================================
// Module 10: AdaptiveLearningSystem Tests
// ============================================================
describe('AdaptiveLearningSystem', () => {
  let system: AdaptiveLearningSystem;

  beforeEach(() => {
    system = new AdaptiveLearningSystem();
  });

  test('should record an interaction', () => {
    system.recordInteraction({
      type: 'code_request',
      input: 'Create a function',
      timestamp: Date.now(),
    });
    expect(system.getInteractionCount()).toBe(1);
  });

  test('should learn user preferences from interactions', () => {
    system.recordInteraction({
      type: 'code_request',
      input: "const x = 'hello'; // using single quotes",
      timestamp: Date.now(),
    });
    expect(system.getPreference('quoteStyle')).toBe('single');
  });

  test('should learn framework preference', () => {
    system.recordInteraction({
      type: 'code_request',
      input: 'Create a React component',
      timestamp: Date.now(),
    });
    expect(system.getPreference('framework')).toBe('react');
  });

  test('should predict intent from partial input', () => {
    system.recordInteraction({
      type: 'code_request',
      input: 'Create a new function',
      output: 'function newFunc() {}',
      timestamp: Date.now(),
    });
    const predictions = system.predictIntent('Create a new');
    expect(predictions.length).toBeGreaterThan(0);
  });

  test('should suggest approaches based on learned patterns', () => {
    for (let i = 0; i < 3; i++) {
      system.recordInteraction({
        type: 'code_request',
        input: 'Create a REST API endpoint',
        timestamp: Date.now(),
        satisfaction: 0.9,
      });
    }
    const suggestions = system.suggestApproach('Create a REST API');
    expect(suggestions.length).toBeGreaterThan(0);
  });

  test('should get learned patterns', () => {
    system.recordInteraction({
      type: 'code_request',
      input: 'Create a new function',
      timestamp: Date.now(),
    });
    const patterns = system.getLearnedPatterns();
    expect(patterns.length).toBeGreaterThan(0);
  });

  test('should export model as JSON', () => {
    system.recordInteraction({
      type: 'code_request',
      input: 'Create a function',
      timestamp: Date.now(),
    });
    const json = system.exportModel('json');
    const parsed = JSON.parse(json);
    expect(parsed.interactionCount).toBe(1);
    expect(parsed.exportedAt).toBeDefined();
  });

  test('should import model from JSON', () => {
    const modelData = JSON.stringify({
      preferences: { quoteStyle: 'single', framework: 'react' },
      patterns: [],
      approachSuccess: {},
      interactionCount: 0,
      exportedAt: Date.now(),
    });
    system.importModel(modelData);
    expect(system.getPreference('quoteStyle')).toBe('single');
    expect(system.getPreference('framework')).toBe('react');
  });

  test('should throw on invalid model import', () => {
    expect(() => system.importModel('not valid json')).toThrow();
  });

  test('should clear all learned data', () => {
    system.recordInteraction({
      type: 'code_request',
      input: 'Create a function',
      timestamp: Date.now(),
    });
    system.clear();
    expect(system.getInteractionCount()).toBe(0);
    expect(system.getLearnedPatterns().length).toBe(0);
  });

  test('should trim old interactions', () => {
    const smallSystem = new AdaptiveLearningSystem(5);
    for (let i = 0; i < 10; i++) {
      smallSystem.recordInteraction({
        type: 'code_request',
        input: `Request ${i}`,
        timestamp: Date.now(),
      });
    }
    expect(smallSystem.getInteractionCount()).toBeLessThanOrEqual(5);
  });

  test('should learn from satisfaction scores', () => {
    system.recordInteraction({
      type: 'code_request',
      input: 'Create a function',
      output: 'function test() {}',
      timestamp: Date.now(),
      satisfaction: 0.95,
    });
    expect(system.getPreference('preferredStyle')).toBeDefined();
  });

  test('should return empty predictions for no history', () => {
    const predictions = system.predictIntent('random input');
    expect(predictions.length).toBe(0);
  });

  test('should return empty suggestions for no history', () => {
    const suggestions = system.suggestApproach('random task');
    expect(suggestions.length).toBe(0);
  });

  test('should track approach success from context', () => {
    system.recordInteraction({
      type: 'code_request',
      input: 'Create API',
      timestamp: Date.now(),
      context: { approach: 'REST' },
      satisfaction: 0.9,
    });
    system.recordInteraction({
      type: 'code_request',
      input: 'Create API',
      timestamp: Date.now(),
      context: { approach: 'REST' },
      satisfaction: 0.8,
    });
    const suggestions = system.suggestApproach('Create API');
    expect(suggestions.length).toBeGreaterThan(0);
  });
});
