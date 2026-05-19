// ============================================================
// Module: plugin-sandbox.ts - 插件沙箱
// API whitelisting, resource limits, capability-based security
// ============================================================

export type PluginPermission =
  | 'fs.read'
  | 'fs.write'
  | 'net.request'
  | 'net.listen'
  | 'env.access'
  | 'process.spawn'
  | 'clipboard'
  | 'notification'
  | 'ui.render'
  | 'data.store'
  | 'plugin.communicate'
  | 'system.info';

export interface SandboxContext {
  pluginName: string;
  permissions: Set<PluginPermission>;
  api: Record<string, unknown>;
  callApi(apiName: string, ...args: unknown[]): unknown;
  hasPermission(permission: PluginPermission): boolean;
  getAuditLog(): AuditEntry[];
  getResourceUsage(): ResourceUsage;
}

export interface ResourceLimits {
  maxMemoryMB?: number;
  maxCpuTimeMs?: number;
  maxFileSizeKB?: number;
  maxRequestsPerMinute?: number;
}

export interface ResourceUsage {
  memoryUsedMB: number;
  cpuTimeMs: number;
  requestCount: number;
  lastRequestTime: number;
}

export interface AuditEntry {
  timestamp: number;
  pluginName: string;
  apiName: string;
  args: unknown[];
  result: 'allowed' | 'denied';
  duration?: number;
}

export interface WhitelistedApi {
  name: string;
  requiredPermissions: PluginPermission[];
  handler: (...args: unknown[]) => unknown;
  rateLimit?: number;
}

export class PluginSandbox {
  private sandboxes = new Map<string, SandboxContext>();
  private whitelistedApis = new Map<string, WhitelistedApi>();
  private defaultLimits: ResourceLimits = {
    maxMemoryMB: 128,
    maxCpuTimeMs: 5000,
    maxFileSizeKB: 1024,
    maxRequestsPerMinute: 60,
  };

  registerApi(api: WhitelistedApi): void {
    this.whitelistedApis.set(api.name, api);
  }

  removeApi(apiName: string): void {
    this.whitelistedApis.delete(apiName);
  }

  setDefaultLimits(limits: ResourceLimits): void {
    this.defaultLimits = { ...this.defaultLimits, ...limits };
  }

  createSandbox(pluginName: string, permissions: PluginPermission[], limits?: ResourceLimits): SandboxContext {
    const effectiveLimits = { ...this.defaultLimits, ...limits };
    const permissionSet = new Set(permissions);
    const auditLog: AuditEntry[] = [];
    const resourceUsage: ResourceUsage = {
      memoryUsedMB: 0,
      cpuTimeMs: 0,
      requestCount: 0,
      lastRequestTime: 0,
    };
    const self = this;

    // Build safe API object
    const api: Record<string, unknown> = {};
    for (const [apiName, apiDef] of this.whitelistedApis) {
      const hasAllPerms = apiDef.requiredPermissions.every(p => permissionSet.has(p));
      if (hasAllPerms) {
        api[apiName] = (...args: unknown[]) => {
          const startTime = Date.now();
          const entry: AuditEntry = {
            timestamp: startTime,
            pluginName,
            apiName,
            args,
            result: 'allowed',
          };

          try {
            const result = apiDef.handler(...args);
            entry.duration = Date.now() - startTime;
            auditLog.push(entry);
            resourceUsage.requestCount++;
            resourceUsage.lastRequestTime = startTime;
            return result;
          } catch (err) {
            entry.result = 'denied';
            entry.duration = Date.now() - startTime;
            auditLog.push(entry);
            throw err;
          }
        };
      }
    }

    const context: SandboxContext = {
      pluginName,
      permissions: permissionSet,
      api,
      callApi(apiName: string, ...args: unknown[]): unknown {
        const startTime = Date.now();
        const apiDef = self.whitelistedApis.get(apiName);

        if (!apiDef) {
          auditLog.push({
            timestamp: startTime,
            pluginName,
            apiName,
            args,
            result: 'denied',
          });
          throw new Error(`API "${apiName}" is not whitelisted`);
        }

        const hasAllPerms = apiDef.requiredPermissions.every(p => permissionSet.has(p));
        if (!hasAllPerms) {
          auditLog.push({
            timestamp: startTime,
            pluginName,
            apiName,
            args,
            result: 'denied',
          });
          throw new Error(`Plugin "${pluginName}" lacks required permissions for API "${apiName}"`);
        }

        // Rate limiting - only count successful (allowed) requests
        if (apiDef.rateLimit) {
          const now = Date.now();
          const recentCalls = auditLog.filter(
            e => e.pluginName === pluginName && e.apiName === apiName && e.result === 'allowed' && now - e.timestamp < 60000,
          );
          if (recentCalls.length >= apiDef.rateLimit) {
            auditLog.push({
              timestamp: startTime,
              pluginName,
              apiName,
              args,
              result: 'denied',
            });
            throw new Error(`Rate limit exceeded for API "${apiName}"`);
          }
        }

        const result = apiDef.handler(...args);
        auditLog.push({
          timestamp: startTime,
          pluginName,
          apiName,
          args,
          result: 'allowed',
          duration: Date.now() - startTime,
        });
        resourceUsage.requestCount++;
        resourceUsage.lastRequestTime = startTime;
        return result;
      },
      hasPermission(permission: PluginPermission): boolean {
        return permissionSet.has(permission);
      },
      getAuditLog(): AuditEntry[] {
        return [...auditLog];
      },
      getResourceUsage(): ResourceUsage {
        return { ...resourceUsage };
      },
    };

    this.sandboxes.set(pluginName, context);
    return context;
  }

  destroySandbox(pluginName: string): boolean {
    return this.sandboxes.delete(pluginName);
  }

  getSandbox(pluginName: string): SandboxContext | undefined {
    return this.sandboxes.get(pluginName);
  }

  listSandboxes(): string[] {
    return Array.from(this.sandboxes.keys());
  }
}
