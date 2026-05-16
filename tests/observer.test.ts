// ============================================================================
// Tests for @claude-agent/observer
// ============================================================================
import { describe, test, expect, beforeEach } from 'bun:test';
import { Subject, PubSub, ObservableLifecycle, AutoCleanupObserver, createObserver } from '../packages/observer/src/index.js';

describe('@claude-agent/observer', () => {
  describe('Subject', () => {
    let subject: Subject<string>;

    beforeEach(() => { subject = new Subject(); });

    test('attaches and notifies observers', () => {
      let received = '';
      subject.attach({ id: 'obs-1', update: (data) => { received = data; } });
      subject.notify('hello');
      expect(received).toBe('hello');
    });

    test('detaches observers', () => {
      let received = '';
      const unsub = subject.attach({ id: 'obs-1', update: (data) => { received = data; } });
      unsub();
      subject.notify('hello');
      expect(received).toBe('');
    });

    test('notifies multiple observers', () => {
      const results: string[] = [];
      subject.attach({ id: 'obs-1', update: (data) => { results.push(data + '-1'); } });
      subject.attach({ id: 'obs-2', update: (data) => { results.push(data + '-2'); } });
      subject.notify('test');
      expect(results).toEqual(['test-1', 'test-2']);
    });

    test('returns observer count', () => {
      subject.attach({ id: 'obs-1', update: () => {} });
      subject.attach({ id: 'obs-2', update: () => {} });
      expect(subject.getObserverCount()).toBe(2);
    });

    test('clears all observers', () => {
      subject.attach({ id: 'obs-1', update: () => {} });
      subject.clear();
      expect(subject.getObserverCount()).toBe(0);
    });

    test('handles async observers', async () => {
      let received = false;
      subject.attach({ id: 'obs-1', update: async (data) => { await new Promise(r => setTimeout(r, 10)); received = true; } });
      subject.notify('test');
      await new Promise(r => setTimeout(r, 50));
      expect(received).toBe(true);
    });

    test('handles observer errors gracefully', () => {
      subject.attach({ id: 'obs-1', update: () => { throw new Error('observer error'); } });
      expect(() => subject.notify('test')).not.toThrow();
    });
  });

  describe('PubSub', () => {
    let pubsub: PubSub;

    beforeEach(() => { pubsub = new PubSub(); });

    test('publishes to channel subscribers', () => {
      let received = '';
      pubsub.subscribe('news', { id: 'sub-1', update: (data) => { received = data; } });
      pubsub.publish('news', 'breaking');
      expect(received).toBe('breaking');
    });

    test('unsubscribes from channel', () => {
      let received = '';
      const unsub = pubsub.subscribe('news', { id: 'sub-1', update: (data) => { received = data; } });
      unsub();
      pubsub.publish('news', 'breaking');
      expect(received).toBe('');
    });

    test('returns channel count', () => {
      pubsub.subscribe('a', { id: 's1', update: () => {} });
      pubsub.subscribe('b', { id: 's2', update: () => {} });
      expect(pubsub.getChannelCount()).toBe(2);
    });

    test('returns subscriber count', () => {
      pubsub.subscribe('news', { id: 's1', update: () => {} });
      pubsub.subscribe('news', { id: 's2', update: () => {} });
      expect(pubsub.getSubscriberCount('news')).toBe(2);
    });

    test('destroys channel', () => {
      pubsub.subscribe('news', { id: 's1', update: () => {} });
      pubsub.destroyChannel('news');
      expect(pubsub.getSubscriberCount('news')).toBe(0);
    });

    test('clears all channels', () => {
      pubsub.subscribe('a', { id: 's1', update: () => {} });
      pubsub.subscribe('b', { id: 's2', update: () => {} });
      pubsub.clear();
      expect(pubsub.getChannelCount()).toBe(0);
    });
  });

  describe('ObservableLifecycle', () => {
    test('tracks phases', () => {
      const lc = new ObservableLifecycle();
      expect(lc.getPhase()).toBe('created');
      lc.setPhase('started');
      expect(lc.getPhase()).toBe('started');
    });

    test('notifies phase changes', () => {
      const phases: string[] = [];
      const lc = new ObservableLifecycle();
      lc.onPhaseChange({ id: 'obs', update: (phase) => { phases.push(phase); } });
      lc.setPhase('started');
      lc.setPhase('stopped');
      expect(phases).toEqual(['started', 'stopped']);
    });

    test('runs cleanup callbacks', async () => {
      let cleaned = false;
      const lc = new ObservableLifecycle();
      lc.onCleanup(() => { cleaned = true; });
      await lc.cleanup();
      expect(cleaned).toBe(true);
      expect(lc.getPhase()).toBe('destroyed');
    });
  });

  describe('AutoCleanupObserver', () => {
    test('auto-disposes after max notifications', () => {
      let count = 0;
      const obs = new AutoCleanupObserver('auto', () => { count++; }, { maxNotifications: 3 });
      const subject = new Subject();
      obs.bind(subject);
      subject.notify('a');
      subject.notify('b');
      expect(count).toBe(2);
      expect(obs.isDisposed).toBe(false);
      subject.notify('c');
      // Third notification triggers dispose, handler may or may not run
      expect(obs.isDisposed).toBe(true);
    });
  });

  describe('createObserver', () => {
    test('creates observer with factory', () => {
      const obs = createObserver((data: string) => { /* noop */ });
      expect(obs.id).toMatch(/^obs-/);
    });
  });
});
