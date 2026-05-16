// ============================================================================
// Tests for @claude-agent/themes
// ============================================================================
import { describe, test, expect, beforeEach } from 'bun:test';
import { ThemeManager } from '../packages/themes/src/index.js';

describe('@claude-agent/themes', () => {
  let manager: ThemeManager;

  beforeEach(() => { manager = new ThemeManager(); });

  test('has default themes', () => {
    const list = manager.list();
    expect(list.find(t => t.name === 'dark')).toBeDefined();
    expect(list.find(t => t.name === 'light')).toBeDefined();
  });

  test('gets active theme', () => {
    const theme = manager.getActive();
    expect(theme.name).toBe('dark');
    expect(theme.type).toBe('dark');
  });

  test('sets active theme', () => {
    manager.setActive('light');
    expect(manager.getActive().name).toBe('light');
  });

  test('throws for unknown theme', () => {
    expect(() => manager.setActive('unknown')).toThrow();
  });

  test('registers custom theme', () => {
    manager.register({
      name: 'custom',
      label: 'Custom',
      type: 'dark',
      colors: { primary: '#ff0000', secondary: '#00ff00', accent: '#0000ff', background: '#000', foreground: '#fff', muted: '#888', border: '#444', error: '#f00', warning: '#ff0', success: '#0f0', info: '#0ff' },
    });
    expect(manager.get('custom')).toBeDefined();
  });

  test('unregisters theme', () => {
    manager.register({
      name: 'temp',
      label: 'Temp',
      type: 'dark',
      colors: { primary: '#000', secondary: '#000', accent: '#000', background: '#000', foreground: '#fff', muted: '#888', border: '#444', error: '#f00', warning: '#ff0', success: '#0f0', info: '#0ff' },
    });
    manager.unregister('temp');
    expect(manager.get('temp')).toBeUndefined();
  });

  test('notifies on theme change', () => {
    let notified = false;
    manager.onChange((theme) => { notified = true; });
    manager.setActive('light');
    expect(notified).toBe(true);
  });

  test('generates CSS variables', () => {
    const vars = manager.toCSSVariables();
    expect(vars['--color-primary']).toBeDefined();
    expect(vars['--color-background']).toBeDefined();
  });

  test('generates CSS string', () => {
    const css = manager.toCSSString();
    expect(css).toContain(':root');
    expect(css).toContain('--color-primary');
  });

  test('creates custom theme with inheritance', () => {
    const custom = manager.createCustomTheme('ocean', 'Ocean', 'dark', { primary: '#0077b6' });
    manager.register(custom);
    const theme = manager.get('ocean')!;
    expect(theme.colors.primary).toBe('#0077b6');
    expect(theme.colors.background).toBe('#0f172a'); // inherited from dark
  });

  test('high-contrast theme extends dark', () => {
    const hc = manager.get('high-contrast')!;
    expect(hc.colors.background).toBe('#000000');
    expect(hc.colors.primary).toBe('#818cf8');
  });
});
