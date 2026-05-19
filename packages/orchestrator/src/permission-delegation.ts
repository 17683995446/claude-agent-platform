// ============================================================================
// PermissionDelegation - Task-level Permission Control
// ============================================================================

import type {
  PermissionLevel,
  PermissionRule,
  AuditLogEntry,
  SandboxConfig,
} from './types.js';

// ---- ID generators ----

let permCounter = 0;
let auditCounter = 0;

function generatePermId(): string {
  permCounter++;
  return `perm-${Date.now().toString(36)}-${permCounter.toString(36)}`;
}

function generateAuditId(): string {
  auditCounter++;
  return `audit-${Date.now().toString(36)}-${auditCounter.toString(36)}`;
}

// ---- Default sandbox config ----

const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  enabled: false,
  allowedTools: [],
  deniedTools: [],
  maxExecutionTime: 60000,
  maxMemoryMB: 512,
  networkAccess: false,
  fileSystemAccess: true,
};

// ---- PermissionDelegation Class ----

export class PermissionDelegation {
  private rules: Map<string, PermissionRule> = new Map();
  private sandboxConfig: SandboxConfig;
  private auditLogMap: Map<string, AuditLogEntry> = new Map();

  constructor(sandboxConfig?: Partial<SandboxConfig>) {
    this.sandboxConfig = { ...DEFAULT_SANDBOX_CONFIG, ...sandboxConfig };
  }

  /** Get sandbox configuration */
  getSandboxConfig(): SandboxConfig {
    return { ...this.sandboxConfig };
  }

  /** Update sandbox configuration */
  updateSandboxConfig(config: Partial<SandboxConfig>): void {
    this.sandboxConfig = { ...this.sandboxConfig, ...config };
  }

  /** Grant permission for a task to use a tool */
  grant(
    taskId: string,
    toolName: string,
    level: PermissionLevel,
    grantedBy: 'system' | 'user' = 'system',
    expiresIn?: number,
  ): PermissionRule {
    const rule: PermissionRule = {
      id: generatePermId(),
      taskId,
      toolName,
      level,
      grantedAt: new Date(),
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn) : undefined,
      grantedBy,
    };

    this.rules.set(`${taskId}:${toolName}`, rule);

    // Audit log
    this.addAuditEntry({
      id: generateAuditId(),
      timestamp: new Date(),
      taskId,
      action: 'grant',
      toolName,
      permissionLevel: level,
      granted: true,
      reason: `Permission granted by ${grantedBy}`,
    });

    return rule;
  }

  /** Revoke permission */
  revoke(taskId: string, toolName: string): boolean {
    const key = `${taskId}:${toolName}`;
    const rule = this.rules.get(key);
    if (!rule) return false;

    this.rules.delete(key);

    this.addAuditEntry({
      id: generateAuditId(),
      timestamp: new Date(),
      taskId,
      action: 'revoke',
      toolName,
      permissionLevel: rule.level,
      granted: false,
      reason: 'Permission revoked',
    });

    return true;
  }

  /** Check if a task has permission to use a tool */
  check(taskId: string, toolName: string, requiredLevel: PermissionLevel): {
    granted: boolean;
    reason?: string;
  } {
    // Check sandbox denied tools
    if (this.sandboxConfig.enabled && this.sandboxConfig.deniedTools.includes(toolName)) {
      this.addAuditEntry({
        id: generateAuditId(),
        timestamp: new Date(),
        taskId,
        action: 'check',
        toolName,
        permissionLevel: requiredLevel,
        granted: false,
        reason: 'Tool is in sandbox deny list',
      });
      return { granted: false, reason: `Tool "${toolName}" is blocked by sandbox` };
    }

    // Check sandbox allowed tools (if specified)
    if (
      this.sandboxConfig.enabled &&
      this.sandboxConfig.allowedTools.length > 0 &&
      !this.sandboxConfig.allowedTools.includes(toolName)
    ) {
      this.addAuditEntry({
        id: generateAuditId(),
        timestamp: new Date(),
        taskId,
        action: 'check',
        toolName,
        permissionLevel: requiredLevel,
        granted: false,
        reason: 'Tool is not in sandbox allow list',
      });
      return { granted: false, reason: `Tool "${toolName}" is not in the sandbox allow list` };
    }

    // Check specific permission rule
    const key = `${taskId}:${toolName}`;
    const rule = this.rules.get(key);

    if (!rule) {
      // No specific rule - deny by default
      this.addAuditEntry({
        id: generateAuditId(),
        timestamp: new Date(),
        taskId,
        action: 'check',
        toolName,
        permissionLevel: requiredLevel,
        granted: false,
        reason: 'No permission rule found',
      });
      return { granted: false, reason: `No permission granted for tool "${toolName}"` };
    }

    // Check expiration
    if (rule.expiresAt && rule.expiresAt < new Date()) {
      this.addAuditEntry({
        id: generateAuditId(),
        timestamp: new Date(),
        taskId,
        action: 'check',
        toolName,
        permissionLevel: requiredLevel,
        granted: false,
        reason: 'Permission has expired',
      });
      return { granted: false, reason: `Permission for "${toolName}" has expired` };
    }

    // Check level
    const levels: PermissionLevel[] = ['read', 'write', 'execute', 'admin'];
    const requiredIndex = levels.indexOf(requiredLevel);
    const grantedIndex = levels.indexOf(rule.level);

    if (grantedIndex >= requiredIndex) {
      this.addAuditEntry({
        id: generateAuditId(),
        timestamp: new Date(),
        taskId,
        action: 'check',
        toolName,
        permissionLevel: requiredLevel,
        granted: true,
      });
      return { granted: true };
    }

    this.addAuditEntry({
      id: generateAuditId(),
      timestamp: new Date(),
      taskId,
      action: 'check',
      toolName,
      permissionLevel: requiredLevel,
      granted: false,
      reason: `Insufficient permission level: has ${rule.level}, needs ${requiredLevel}`,
    });
    return { granted: false, reason: `Insufficient permission: has ${rule.level}, needs ${requiredLevel}` };
  }

  /** Get all permission rules */
  getRules(): PermissionRule[] {
    return Array.from(this.rules.values());
  }

  /** Get rules for a specific task */
  getRulesForTask(taskId: string): PermissionRule[] {
    return Array.from(this.rules.values()).filter((r) => r.taskId === taskId);
  }

  /** Get audit log */
  getAuditLog(filters?: { taskId?: string; toolName?: string; granted?: boolean }): AuditLogEntry[] {
    let entries = Array.from(this.auditLogMap.values());

    if (filters?.taskId) {
      entries = entries.filter((e) => e.taskId === filters.taskId);
    }
    if (filters?.toolName) {
      entries = entries.filter((e) => e.toolName === filters.toolName);
    }
    if (filters?.granted !== undefined) {
      entries = entries.filter((e) => e.granted === filters.granted);
    }

    return entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /** Add audit log entry */
  private addAuditEntry(entry: AuditLogEntry): void {
    this.auditLogMap.set(entry.id, entry);
  }

  /** Clear all rules and audit log */
  clear(): void {
    this.rules.clear();
    this.auditLogMap.clear();
  }
}
