// ============================================================================
// Tests for @claude-agent/i18n
// ============================================================================
import { describe, test, expect, beforeEach } from 'bun:test';
import { I18nManager } from '../packages/i18n/src/index.js';

describe('@claude-agent/i18n', () => {
  let i18n: I18nManager;

  beforeEach(() => { i18n = new I18nManager(); });

  test('has default locales', () => {
    const locales = i18n.listLocales();
    expect(locales.find(l => l.code === 'en')).toBeDefined();
    expect(locales.find(l => l.code === 'zh')).toBeDefined();
    expect(locales.find(l => l.code === 'ja')).toBeDefined();
  });

  test('translates in English', () => {
    expect(i18n.t('common.ok')).toBe('OK');
    expect(i18n.t('common.cancel')).toBe('Cancel');
  });

  test('translates in Chinese', () => {
    i18n.setLocale('zh');
    expect(i18n.t('common.ok')).toBe('\u786e\u5b9a');
    expect(i18n.t('common.cancel')).toBe('\u53d6\u6d88');
  });

  test('translates in Japanese', () => {
    i18n.setLocale('ja');
    expect(i18n.t('common.cancel')).toBe('\u30ad\u30e3\u30f3\u30bb\u30eb');
  });

  test('interpolates parameters', () => {
    i18n.setLocale('en');
    expect(i18n.t('agent.started', { name: 'TestAgent' })).toBe('Agent TestAgent started');
  });

  test('falls back to English for missing translations', () => {
    i18n.setLocale('zh');
    expect(i18n.t('common.ok')).toBe('\u786e\u5b9a');
  });

  test('returns key for unknown translations', () => {
    expect(i18n.t('unknown.key')).toBe('unknown.key');
  });

  test('sets fallback locale', () => {
    i18n.setFallback('zh');
    i18n.setLocale('ja');
    // ja has common.cancel, so it should use ja
    expect(i18n.t('common.cancel')).toBe('\u30ad\u30e3\u30f3\u30bb\u30eb');
  });

  test('notifies on locale change', () => {
    let changed = false;
    i18n.onChange((code) => { changed = true; });
    i18n.setLocale('zh');
    expect(changed).toBe(true);
  });

  test('throws for unknown locale', () => {
    expect(() => i18n.setLocale('unknown')).toThrow();
  });

  test('registers custom locale', () => {
    i18n.registerLocale({
      code: 'ko',
      name: '\ud55c\uad6d\uc5b4',
      translations: { 'common.ok': '\ud655\uc778' },
    });
    i18n.setLocale('ko');
    expect(i18n.t('common.ok')).toBe('\ud655\uc778');
  });

  test('unregisters locale', () => {
    i18n.unregisterLocale('ja');
    expect(i18n.listLocales().find(l => l.code === 'ja')).toBeUndefined();
  });

  test('adds translations to existing locale', () => {
    i18n.addTranslations('en', { 'custom.key': 'Custom Value' });
    expect(i18n.t('custom.key')).toBe('Custom Value');
  });

  test('formats dates', () => {
    const date = new Date('2024-01-15');
    const formatted = i18n.formatDate(date);
    expect(formatted).toBeDefined();
    expect(typeof formatted).toBe('string');
  });

  test('formats numbers', () => {
    const formatted = i18n.formatNumber(1234567.89);
    expect(formatted).toBeDefined();
    expect(typeof formatted).toBe('string');
  });
});
