// ============================================================================
// @claude-agent/i18n - Internationalization (i18n)
// ============================================================================

export interface TranslationData {
  [key: string]: string | TranslationData;
}

export interface LocaleConfig {
  code: string;
  name: string;
  translations: TranslationData;
  dateLocale?: string;
  numberLocale?: string;
}

type InterpolateParams = Record<string, string | number>;

export class I18nManager {
  private locales: Map<string, LocaleConfig> = new Map();
  private currentLocale: string = 'en';
  private fallbackLocale: string = 'en';
  private listeners: Set<(locale: string) => void> = new Set();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    this.registerLocale({
      code: 'en',
      name: 'English',
      translations: {
        'common.ok': 'OK',
        'common.cancel': 'Cancel',
        'common.save': 'Save',
        'common.delete': 'Delete',
        'common.edit': 'Edit',
        'common.search': 'Search',
        'common.loading': 'Loading...',
        'common.error': 'An error occurred',
        'common.confirm': 'Are you sure?',
        'agent.started': 'Agent {name} started',
        'agent.stopped': 'Agent {name} stopped',
        'task.completed': 'Task {name} completed in {duration}ms',
        'task.failed': 'Task {name} failed: {error}',
        'pipeline.running': 'Pipeline {name} is running ({step}/{total})',
        'plugin.loaded': 'Plugin {name} v{version} loaded',
      },
    });
    this.registerLocale({
      code: 'zh',
      name: '中文',
      translations: {
        'common.ok': '确定',
        'common.cancel': '取消',
        'common.save': '保存',
        'common.delete': '删除',
        'common.edit': '编辑',
        'common.search': '搜索',
        'common.loading': '加载中...',
        'common.error': '发生错误',
        'common.confirm': '你确定吗？',
        'agent.started': '代理 {name} 已启动',
        'agent.stopped': '代理 {name} 已停止',
        'task.completed': '任务 {name} 已完成，耗时 {duration}ms',
        'task.failed': '任务 {name} 失败: {error}',
        'pipeline.running': '管道 {name} 正在运行 ({step}/{total})',
        'plugin.loaded': '插件 {name} v{version} 已加载',
      },
    });
    this.registerLocale({
      code: 'ja',
      name: '日本語',
      translations: {
        'common.ok': 'OK',
        'common.cancel': 'キャンセル',
        'common.save': '保存',
        'common.delete': '削除',
        'common.edit': '編集',
        'common.search': '検索',
        'common.loading': '読み込み中...',
        'common.error': 'エラーが発生しました',
        'common.confirm': '本当ですか？',
        'agent.started': 'エージェント {name} が起動しました',
        'agent.stopped': 'エージェント {name} が停止しました',
      },
    });
  }

  registerLocale(locale: LocaleConfig): void {
    this.locales.set(locale.code, locale);
  }

  unregisterLocale(code: string): void {
    this.locales.delete(code);
  }

  getLocale(code: string): LocaleConfig | undefined {
    return this.locales.get(code);
  }

  getCurrentLocale(): string {
    return this.currentLocale;
  }

  setLocale(code: string): void {
    if (!this.locales.has(code)) throw new Error(`Locale "${code}" not found`);
    this.currentLocale = code;
    for (const listener of this.listeners) {
      try { listener(code); } catch {}
    }
  }

  setFallback(code: string): void {
    this.fallbackLocale = code;
  }

  onChange(listener: (locale: string) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  t(key: string, params?: InterpolateParams): string {
    const locale = this.locales.get(this.currentLocale);
    let value = this.resolveKey(locale?.translations ?? {}, key);
    if (value === null) {
      const fallback = this.locales.get(this.fallbackLocale);
      value = this.resolveKey(fallback?.translations ?? {}, key);
    }
    if (value === null) return key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        value = value.replace(new RegExp(`\{${k}\}`, 'g'), String(v));
      }
    }
    return value;
  }

  private resolveKey(data: TranslationData, key: string): string | null {
    // Try direct flat key lookup first
    if (typeof (data as any)[key] === 'string') {
      return (data as any)[key] as string;
    }
    // Try nested lookup
    const parts = key.split('.');
    let current: string | TranslationData = data;
    for (const part of parts) {
      if (typeof current !== 'object' || current === null) return null;
      const next = (current as TranslationData)[part];
      if (next === undefined) return null;
      current = next;
    }
    return typeof current === 'string' ? current : null;
  }

  listLocales(): { code: string; name: string }[] {
    return Array.from(this.locales.values()).map(l => ({ code: l.code, name: l.name }));
  }

  formatDate(date: Date, options?: Intl.DateTimeFormatOptions): string {
    const locale = this.locales.get(this.currentLocale);
    return date.toLocaleDateString(locale?.dateLocale ?? this.currentLocale, options);
  }

  formatNumber(num: number, options?: Intl.NumberFormatOptions): string {
    const locale = this.locales.get(this.currentLocale);
    return num.toLocaleString(locale?.numberLocale ?? this.currentLocale, options);
  }

  addTranslations(code: string, translations: TranslationData): void {
    const locale = this.locales.get(code);
    if (locale) {
      Object.assign(locale.translations, translations);
    }
  }
}
