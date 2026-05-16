// ============================================================================
// @claude-agent/update-checker - Update Checker
// ============================================================================

export interface VersionInfo {
  current: string;
  latest: string;
  hasUpdate: boolean;
  isMajor: boolean;
  isMinor: boolean;
  isPatch: boolean;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  type: 'major' | 'minor' | 'patch';
  changes: string[];
}

export class UpdateChecker {
  private currentVersion: string;
  private registryUrl: string;
  private checkInterval: number;
  private lastCheck: number = 0;
  private cachedResult: VersionInfo | null = null;

  constructor(options?: { currentVersion?: string; registryUrl?: string; checkInterval?: number }) {
    this.currentVersion = options?.currentVersion ?? '1.0.0';
    this.registryUrl = options?.registryUrl ?? 'https://registry.npmjs.org/claude-agent-platform';
    this.checkInterval = options?.checkInterval ?? 3600000; // 1 hour
  }

  parseVersion(version: string): { major: number; minor: number; patch: number; prerelease?: string } {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
    if (!match) return { major: 0, minor: 0, patch: 0 };
    return {
      major: parseInt(match[1]!),
      minor: parseInt(match[2]!),
      patch: parseInt(match[3]!),
      prerelease: match[4],
    };
  }

  compareVersions(a: string, b: string): number {
    const va = this.parseVersion(a);
    const vb = this.parseVersion(b);
    if (va.major !== vb.major) return va.major - vb.major;
    if (va.minor !== vb.minor) return va.minor - vb.minor;
    if (va.patch !== vb.patch) return va.patch - vb.patch;
    if (va.prerelease && !vb.prerelease) return -1;
    if (!va.prerelease && vb.prerelease) return 1;
    return 0;
  }

  async check(): Promise<VersionInfo> {
    const now = Date.now();
    if (this.cachedResult && now - this.lastCheck < this.checkInterval) {
      return this.cachedResult;
    }

    // Simulate version check (in real impl, would fetch from registry)
    const latest = '1.0.0';
    const comparison = this.compareVersions(latest, this.currentVersion);
    const hasUpdate = comparison > 0;

    const current = this.parseVersion(this.currentVersion);
    const latestParsed = this.parseVersion(latest);

    const result: VersionInfo = {
      current: this.currentVersion,
      latest,
      hasUpdate,
      isMajor: hasUpdate && latestParsed.major > current.major,
      isMinor: hasUpdate && latestParsed.major === current.major && latestParsed.minor > current.minor,
      isPatch: hasUpdate && latestParsed.major === current.major && latestParsed.minor === current.minor && latestParsed.patch > current.patch,
    };

    this.cachedResult = result;
    this.lastCheck = now;
    return result;
  }

  formatUpdateMessage(info: VersionInfo): string {
    if (!info.hasUpdate) return `You are on the latest version (${info.current}).`;
    const severity = info.isMajor ? 'MAJOR' : info.isMinor ? 'MINOR' : 'PATCH';
    return `Update available! ${info.current} -> ${info.latest} [${severity}]`;
  }

  generateChangelog(): ChangelogEntry[] {
    return [
      {
        version: '1.0.0',
        date: new Date().toISOString().split('T')[0]!,
        type: 'major',
        changes: [
          'Initial release of Claude Agent Platform',
          '10 core packages with monorepo architecture',
          'Unified CLI with 8 subcommands',
          'Event sourcing and CQRS support',
          'Plugin system with lifecycle management',
          'Interactive REPL and configuration wizard',
        ],
      },
    ];
  }

  getCurrentVersion(): string {
    return this.currentVersion;
  }

  setCurrentVersion(version: string): void {
    this.currentVersion = version;
    this.cachedResult = null;
  }
}
