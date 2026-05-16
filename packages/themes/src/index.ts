// ============================================================================
// @claude-agent/themes - Theme System
// ============================================================================

export interface ThemeColors {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  foreground: string;
  muted: string;
  border: string;
  error: string;
  warning: string;
  success: string;
  info: string;
}

export interface ThemeConfig {
  name: string;
  label: string;
  type: 'light' | 'dark';
  colors: ThemeColors;
  extends?: string;
  variables?: Record<string, string>;
}

export interface ThemeDefinition {
  [key: string]: string;
}

export class ThemeManager {
  private themes: Map<string, ThemeConfig> = new Map();
  private activeTheme: string;
  private listeners: Set<(theme: ThemeConfig) => void> = new Set();

  constructor(defaultTheme?: string) {
    this.activeTheme = defaultTheme ?? 'dark';
    this.registerDefaults();
  }

  private registerDefaults(): void {
    this.register({
      name: 'dark',
      label: 'Dark',
      type: 'dark',
      colors: {
        primary: '#6366f1',
        secondary: '#8b5cf6',
        accent: '#06b6d4',
        background: '#0f172a',
        foreground: '#f8fafc',
        muted: '#64748b',
        border: '#334155',
        error: '#ef4444',
        warning: '#f59e0b',
        success: '#22c55e',
        info: '#3b82f6',
      },
    });
    this.register({
      name: 'light',
      label: 'Light',
      type: 'light',
      colors: {
        primary: '#4f46e5',
        secondary: '#7c3aed',
        accent: '#0891b2',
        background: '#ffffff',
        foreground: '#0f172a',
        muted: '#94a3b8',
        border: '#e2e8f0',
        error: '#dc2626',
        warning: '#d97706',
        success: '#16a34a',
        info: '#2563eb',
      },
    });
    this.register({
      name: 'high-contrast',
      label: 'High Contrast',
      type: 'dark',
      extends: 'dark',
      colors: {
        primary: '#818cf8',
        secondary: '#a78bfa',
        accent: '#22d3ee',
        background: '#000000',
        foreground: '#ffffff',
        muted: '#9ca3af',
        border: '#4b5563',
        error: '#f87171',
        warning: '#fbbf24',
        success: '#4ade80',
        info: '#60a5fa',
      },
    });
  }

  register(theme: ThemeConfig): void {
    // Resolve inheritance
    if (theme.extends) {
      const parent = this.themes.get(theme.extends);
      if (parent) {
        theme.colors = { ...parent.colors, ...theme.colors };
      }
    }
    this.themes.set(theme.name, theme);
  }

  unregister(name: string): void {
    this.themes.delete(name);
  }

  get(name: string): ThemeConfig | undefined {
    return this.themes.get(name);
  }

  getActive(): ThemeConfig {
    return this.themes.get(this.activeTheme)!;
  }

  setActive(name: string): void {
    if (!this.themes.has(name)) throw new Error(`Theme "${name}" not found`);
    this.activeTheme = name;
    const theme = this.getActive();
    for (const listener of this.listeners) {
      try { listener(theme); } catch {}
    }
  }

  onChange(listener: (theme: ThemeConfig) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  list(): { name: string; label: string; type: string }[] {
    return Array.from(this.themes.values()).map(t => ({ name: t.name, label: t.label, type: t.type }));
  }

  toCSSVariables(theme?: ThemeConfig): Record<string, string> {
    const t = theme ?? this.getActive();
    const vars: Record<string, string> = {};
    for (const [key, value] of Object.entries(t.colors)) {
      vars[`--color-${key}`] = value;
    }
    if (t.variables) {
      for (const [key, value] of Object.entries(t.variables)) {
        vars[key] = value;
      }
    }
    return vars;
  }

  toCSSString(theme?: ThemeConfig): string {
    const vars = this.toCSSVariables(theme);
    return ':root {\n' + Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join('\n') + '\n}';
  }

  createCustomTheme(name: string, label: string, type: 'light' | 'dark', overrides: Partial<ThemeColors>, extendsTheme?: string): ThemeConfig {
    const base = extendsTheme ? this.themes.get(extendsTheme) : this.getActive();
    return {
      name,
      label,
      type,
      extends: extendsTheme ?? this.activeTheme,
      colors: { ...base!.colors, ...overrides },
    };
  }
}
