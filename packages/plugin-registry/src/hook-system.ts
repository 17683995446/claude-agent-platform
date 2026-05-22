// ============================================================
// Module: hook-system.ts - 钩子系统
// Action hooks, filter hooks, async variants, priority, conditions
// ============================================================

export type HookType = 'action' | 'filter' | 'async_action' | 'async_filter';

export interface HookOptions {
  priority?: number; // lower = higher priority, default 10
  once?: boolean;
  condition?: (...args: unknown[]) => boolean;
}

export interface HookHandler {
  id: string;
  handler: (...args: unknown[]) => unknown;
  options: Required<HookOptions>;
}

export interface RegisteredHook {
  name: string;
  type: HookType;
  handlers: HookHandler[];
}

export class HookSystem {
  private hooks = new Map<string, RegisteredHook>();
  private hookTypes = new Map<string, HookType>();
  private handlerCounter = 0;

  constructor() {
    // Register built-in hooks
    this.registerHookType('before_init', 'action');
    this.registerHookType('after_init', 'action');
    this.registerHookType('before_execute', 'filter');
    this.registerHookType('after_execute', 'filter');
    this.registerHookType('on_error', 'action');
    this.registerHookType('on_shutdown', 'action');
  }

  registerHookType(hookName: string, type: HookType): void {
    this.hookTypes.set(hookName, type);
    if (!this.hooks.has(hookName)) {
      this.hooks.set(hookName, { name: hookName, type, handlers: [] });
    }
  }

  addHook(hookName: string, handler: (...args: unknown[]) => unknown, options?: HookOptions): string {
    const id = `hook_${++this.handlerCounter}_${Date.now()}`;

    if (!this.hooks.has(hookName)) {
      // Default to action type for unregistered hooks
      this.registerHookType(hookName, 'action');
    }

    const hook = this.hooks.get(hookName)!;
    const fullOptions: Required<HookOptions> = {
      priority: options?.priority ?? 10,
      once: options?.once ?? false,
      condition: options?.condition ?? (() => true),
    };

    const hookHandler: HookHandler = { id, handler, options: fullOptions };
    hook.handlers.push(hookHandler);

    // Sort by priority (lower number = higher priority)
    hook.handlers.sort((a, b) => a.options.priority - b.options.priority);

    return id;
  }

  removeHook(hookName: string, handlerId: string): boolean {
    const hook = this.hooks.get(hookName);
    if (!hook) return false;

    const index = hook.handlers.findIndex(h => h.id === handlerId);
    if (index === -1) return false;

    hook.handlers.splice(index, 1);
    return true;
  }

  doAction(hookName: string, ...args: unknown[]): void {
    const hook = this.hooks.get(hookName);
    if (!hook) return;

    const handlersToRemove: string[] = [];

    for (const hh of hook.handlers) {
      if (!hh.options.condition(...args)) continue;

      try {
        const result = hh.handler(...args);
        if (result instanceof Promise) {
          // Fire and forget for sync doAction - log errors but don't block
          result.catch(() => {});
        }
      } catch (err) {
        // Silently handle errors in action hooks
      }

      if (hh.options.once) {
        handlersToRemove.push(hh.id);
      }
    }

    for (const id of handlersToRemove) {
      this.removeHook(hookName, id);
    }
  }

  applyFilters<T>(hookName: string, value: T, ...args: unknown[]): T {
    const hook = this.hooks.get(hookName);
    if (!hook) return value;

    let result: T = value;
    const handlersToRemove: string[] = [];

    for (const hh of hook.handlers) {
      if (!hh.options.condition(result, ...args)) continue;

      try {
        result = hh.handler(result, ...args) as T;
      } catch (err) {
        // Skip failing filter handlers
      }

      if (hh.options.once) {
        handlersToRemove.push(hh.id);
      }
    }

    for (const id of handlersToRemove) {
      this.removeHook(hookName, id);
    }

    return result;
  }

  async doAsyncAction(hookName: string, ...args: unknown[]): Promise<void> {
    const hook = this.hooks.get(hookName);
    if (!hook) return;

    const handlersToRemove: string[] = [];

    for (const hh of hook.handlers) {
      if (!hh.options.condition(...args)) continue;

      try {
        const result = hh.handler(...args);
        if (result instanceof Promise) await result;
      } catch (err) {
        // Silently handle errors
      }

      if (hh.options.once) {
        handlersToRemove.push(hh.id);
      }
    }

    for (const id of handlersToRemove) {
      this.removeHook(hookName, id);
    }
  }

  async applyAsyncFilters<T>(hookName: string, value: T, ...args: unknown[]): Promise<T> {
    const hook = this.hooks.get(hookName);
    if (!hook) return value;

    let result: T = value;
    const handlersToRemove: string[] = [];

    for (const hh of hook.handlers) {
      if (!hh.options.condition(result, ...args)) continue;

      try {
        const handlerResult = hh.handler(result, ...args);
        result = handlerResult instanceof Promise ? (await handlerResult) as T : handlerResult as T;
      } catch (err) {
        // Skip failing filter handlers
      }

      if (hh.options.once) {
        handlersToRemove.push(hh.id);
      }
    }

    for (const id of handlersToRemove) {
      this.removeHook(hookName, id);
    }

    return result;
  }

  getHookNames(): string[] {
    return Array.from(this.hooks.keys());
  }

  getHookHandlers(hookName: string): HookHandler[] {
    return this.hooks.get(hookName)?.handlers ?? [];
  }

  removeAllHooks(hookName?: string): void {
    if (hookName) {
      this.hooks.delete(hookName);
      this.hookTypes.delete(hookName);
    } else {
      this.hooks.clear();
      this.hookTypes.clear();
    }
  }
}
