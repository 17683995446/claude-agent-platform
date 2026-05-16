// ============================================================================
// Tests for @claude-agent/update-checker
// ============================================================================
import { describe, test, expect, beforeEach } from 'bun:test';
import { UpdateChecker } from '../packages/update-checker/src/index.js';

describe('@claude-agent/update-checker', () => {
  let checker: UpdateChecker;

  beforeEach(() => { checker = new UpdateChecker({ currentVersion: '1.0.0' }); });

  test('parses version', () => {
    const v = checker.parseVersion('2.3.1');
    expect(v.major).toBe(2);
    expect(v.minor).toBe(3);
    expect(v.patch).toBe(1);
  });

  test('parses version with prerelease', () => {
    const v = checker.parseVersion('1.0.0-beta.1');
    expect(v.major).toBe(1);
    expect(v.prerelease).toBe('beta.1');
  });

  test('compares versions', () => {
    expect(checker.compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
    expect(checker.compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
    expect(checker.compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  test('checks for updates', async () => {
    const info = await checker.check();
    expect(info.current).toBe('1.0.0');
    expect(info.latest).toBeDefined();
    expect(typeof info.hasUpdate).toBe('boolean');
  });

  test('formats update message when no update', async () => {
    const info = await checker.check();
    const msg = checker.formatUpdateMessage(info);
    expect(msg).toContain('latest');
  });

  test('generates changelog', () => {
    const changelog = checker.generateChangelog();
    expect(changelog.length).toBeGreaterThan(0);
    expect(changelog[0]!.version).toBe('1.0.0');
    expect(changelog[0]!.changes.length).toBeGreaterThan(0);
  });

  test('gets and sets current version', () => {
    expect(checker.getCurrentVersion()).toBe('1.0.0');
    checker.setCurrentVersion('2.0.0');
    expect(checker.getCurrentVersion()).toBe('2.0.0');
  });

  test('caches check results', async () => {
    await checker.check();
    const info = await checker.check();
    expect(info).toBeDefined();
  });
});
