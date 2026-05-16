// ============================================================
// Module: plugin-versioning.ts - 版本管理
// Semantic versioning, comparison, range matching
// ============================================================

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  build?: string;
  raw: string;
}

export type RangeOperator = '^' | '~' | '=' | '>' | '<' | '>=' | '<=' | 'range';

export interface VersionRange {
  operator: RangeOperator;
  version: SemVer;
  max?: SemVer; // for range operator
  raw: string;
}

export class PluginVersionManager {
  private cache = new Map<string, SemVer>();

  parseVersion(version: string): SemVer {
    if (this.cache.has(version)) return this.cache.get(version)!;

    const cleaned = version.replace(/^\s*v/, '');
    const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.]+))?(?:\+([a-zA-Z0-9.]+))?$/);
    if (!match) {
      throw new Error(`Invalid version string: ${version}`);
    }

    const semver: SemVer = {
      major: parseInt(match[1], 10),
      minor: parseInt(match[2], 10),
      patch: parseInt(match[3], 10),
      prerelease: match[4],
      build: match[5],
      raw: version,
    };

    this.cache.set(version, semver);
    return semver;
  }

  compare(a: string | SemVer, b: string | SemVer): number {
    const va = typeof a === 'string' ? this.parseVersion(a) : a;
    const vb = typeof b === 'string' ? this.parseVersion(b) : b;

    if (va.major !== vb.major) return va.major > vb.major ? 1 : -1;
    if (va.minor !== vb.minor) return va.minor > vb.minor ? 1 : -1;
    if (va.patch !== vb.patch) return va.patch > vb.patch ? 1 : -1;

    // prerelease versions have lower precedence
    if (va.prerelease && !vb.prerelease) return -1;
    if (!va.prerelease && vb.prerelease) return 1;
    if (va.prerelease && vb.prerelease) {
      return va.prerelease < vb.prerelease ? -1 : va.prerelease > vb.prerelease ? 1 : 0;
    }

    return 0;
  }

  gt(a: string | SemVer, b: string | SemVer): boolean {
    return this.compare(a, b) > 0;
  }

  lt(a: string | SemVer, b: string | SemVer): boolean {
    return this.compare(a, b) < 0;
  }

  eq(a: string | SemVer, b: string | SemVer): boolean {
    return this.compare(a, b) === 0;
  }

  gte(a: string | SemVer, b: string | SemVer): boolean {
    return this.compare(a, b) >= 0;
  }

  lte(a: string | SemVer, b: string | SemVer): boolean {
    return this.compare(a, b) <= 0;
  }

  parseRange(range: string): VersionRange {
    range = range.trim();

    // caret range: ^1.2.3 -> >=1.2.3 <2.0.0
    if (range.startsWith('^')) {
      const version = this.parseVersion(range.slice(1));
      return {
        operator: '^',
        version,
        max: { major: version.major + 1, minor: 0, patch: 0, raw: `${version.major + 1}.0.0` },
        raw: range,
      };
    }

    // tilde range: ~1.2.3 -> >=1.2.3 <1.3.0
    if (range.startsWith('~')) {
      const version = this.parseVersion(range.slice(1));
      return {
        operator: '~',
        version,
        max: { major: version.major, minor: version.minor + 1, patch: 0, raw: `${version.major}.${version.minor + 1}.0` },
        raw: range,
      };
    }

    // range: >=1.0.0 <2.0.0
    const rangeMatch = range.match(/>=(\S+)\s+<(\S+)/);
    if (rangeMatch) {
      return {
        operator: 'range',
        version: this.parseVersion(rangeMatch[1]),
        max: this.parseVersion(rangeMatch[2]),
        raw: range,
      };
    }

    // comparison operators
    const compMatch = range.match(/^(>=|<=|>|<|=)(.+)$/);
    if (compMatch) {
      const op = compMatch[1] as RangeOperator;
      return {
        operator: op,
        version: this.parseVersion(compMatch[2]),
        raw: range,
      };
    }

    // exact version
    return {
      operator: '=',
      version: this.parseVersion(range),
      raw: range,
    };
  }

  satisfies(version: string, range: string): boolean {
    const v = this.parseVersion(version);
    const r = this.parseRange(range);

    switch (r.operator) {
      case '=':
        return this.eq(v, r.version);
      case '>':
        return this.gt(v, r.version);
      case '<':
        return this.lt(v, r.version);
      case '>=':
        return this.gte(v, r.version);
      case '<=':
        return this.lte(v, r.version);
      case '^':
        return this.gte(v, r.version) && this.lt(v, r.max!);
      case '~':
        return this.gte(v, r.version) && this.lt(v, r.max!);
      case 'range':
        return this.gte(v, r.version) && this.lt(v, r.max!);
      default:
        return false;
    }
  }

  getLatestCompatible(versions: string[], range: string): string | undefined {
    const compatible = versions.filter(v => this.satisfies(v, range));
    if (compatible.length === 0) return undefined;

    compatible.sort((a, b) => this.compare(b, a));
    return compatible[0];
  }

  getUpdatePath(from: string, to: string): string[] {
    const fromVer = this.parseVersion(from);
    const toVer = this.parseVersion(to);

    if (this.eq(fromVer, toVer)) return [from];

    const path: string[] = [from];

    // Simple path: just step through major.minor versions
    let current = { ...fromVer };

    while (current.major !== toVer.major || current.minor !== toVer.minor || current.patch !== toVer.patch) {
      if (current.major < toVer.major) {
        current = { major: current.major + 1, minor: 0, patch: 0, raw: `${current.major + 1}.0.0` };
      } else if (current.minor < toVer.minor) {
        current = { ...current, minor: current.minor + 1, patch: 0, raw: `${current.major}.${current.minor + 1}.0` };
      } else {
        current = { ...current, patch: current.patch + 1, raw: `${current.major}.${current.minor}.${current.patch + 1}` };
      }
      path.push(current.raw);
    }

    return path;
  }

  formatVersion(v: SemVer): string {
    let result = `${v.major}.${v.minor}.${v.patch}`;
    if (v.prerelease) result += `-${v.prerelease}`;
    if (v.build) result += `+${v.build}`;
    return result;
  }
}
