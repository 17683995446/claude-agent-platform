// src/dependency-scanner.ts - 依赖安全扫描

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Vulnerability {
  package: string;
  version: string;
  severity: Severity;
  title: string;
  description: string;
  cve?: string;
  patchedVersions?: string;
  advisoryUrl?: string;
}

export interface OutdatedPackage {
  package: string;
  current: string;
  latest: string;
  updateType: 'major' | 'minor' | 'patch';
}

export interface LicenseIssue {
  package: string;
  license: string;
  reason: 'denied' | 'unknown';
}

export interface DependencyInfo {
  name: string;
  version: string;
  direct: boolean;
  licenses?: string[];
  dependencies?: DependencyInfo[];
}

export interface ScanResult {
  vulnerabilities: Vulnerability[];
  outdated: OutdatedPackage[];
  licenseIssues: LicenseIssue[];
  dependencies: DependencyInfo[];
  summary: {
    totalPackages: number;
    criticalVulnerabilities: number;
    highVulnerabilities: number;
    mediumVulnerabilities: number;
    lowVulnerabilities: number;
    infoCount: number;
    outdatedCount: number;
    licenseIssueCount: number;
  };
  scannedAt: number;
  projectPath: string;
}

export interface ScannerOptions {
  /** List of allowed licenses */
  allowedLicenses?: string[];
  /** List of denied licenses */
  deniedLicenses?: string[];
  /** Whether to check for outdated packages */
  checkOutdated?: boolean;
  /** Whether to check for vulnerabilities */
  checkVulnerabilities?: boolean;
  /** Whether to check license compliance */
  checkLicenses?: boolean;
  /** Severity threshold for reporting */
  severityThreshold?: Severity;
}

// Simulated CVE database for demonstration
const SIMULATED_VULNERABILITIES: Vulnerability[] = [
  {
    package: 'lodash',
    version: '<4.17.21',
    severity: 'high',
    title: 'Prototype Pollution in lodash',
    description: 'Lodash versions prior to 4.17.21 are vulnerable to prototype pollution.',
    cve: 'CVE-2021-23337',
    patchedVersions: '>=4.17.21',
  },
  {
    package: 'express',
    version: '<4.17.3',
    severity: 'medium',
    title: 'Open Redirect in express',
    description: 'Express.js is vulnerable to open redirect attacks.',
    cve: 'CVE-2022-24999',
    patchedVersions: '>=4.17.3',
  },
  {
    package: 'minimist',
    version: '<1.2.6',
    severity: 'critical',
    title: 'Prototype Pollution in minimist',
    description: 'Minimist is vulnerable to prototype pollution.',
    cve: 'CVE-2021-44906',
    patchedVersions: '>=1.2.6',
  },
  {
    package: 'axios',
    version: '<0.21.2',
    severity: 'high',
    title: 'Server-Side Request Forgery in axios',
    description: 'Axios is vulnerable to SSRF attacks.',
    cve: 'CVE-2021-3749',
    patchedVersions: '>=0.21.2',
  },
  {
    package: 'debug',
    version: '<4.3.2',
    severity: 'low',
    title: 'Regular Expression DoS in debug',
    description: 'The debug module is vulnerable to ReDoS.',
    cve: 'CVE-2021-42238',
    patchedVersions: '>=4.3.2',
  },
];

// Simulated latest versions
const SIMULATED_LATEST: Record<string, string> = {
  lodash: '4.17.21',
  express: '4.18.2',
  minimist: '1.2.8',
  axios: '1.6.0',
  debug: '4.3.4',
  typescript: '5.3.0',
  bun: '1.0.0',
  react: '18.2.0',
  'react-dom': '18.2.0',
  webpack: '5.89.0',
  eslint: '8.54.0',
  jest: '29.7.0',
  'ts-node': '10.9.2',
  '@types/node': '20.10.0',
};

export class DependencyScanner {
  private options: Required<ScannerOptions>;

  constructor(options?: ScannerOptions) {
    this.options = {
      allowedLicenses: options?.allowedLicenses ?? ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD'],
      deniedLicenses: options?.deniedLicenses ?? ['GPL-2.0', 'GPL-3.0', 'AGPL-3.0'],
      checkOutdated: options?.checkOutdated ?? true,
      checkVulnerabilities: options?.checkVulnerabilities ?? true,
      checkLicenses: options?.checkLicenses ?? true,
      severityThreshold: options?.severityThreshold ?? 'low',
    };
  }

  /**
   * Scan a project for security issues
   */
  async scan(projectPath: string): Promise<ScanResult> {
    const dependencies = await this.resolveDependencies(projectPath);
    const vulnerabilities = this.options.checkVulnerabilities
      ? this.checkVulnerabilities(dependencies)
      : [];
    const outdated = this.options.checkOutdated
      ? this.checkOutdatedPackages(dependencies)
      : [];
    const licenseIssues = this.options.checkLicenses
      ? this.checkLicenses(dependencies)
      : [];

    return {
      vulnerabilities,
      outdated,
      licenseIssues,
      dependencies,
      summary: this.generateSummary(vulnerabilities, outdated, licenseIssues, dependencies),
      scannedAt: Date.now(),
      projectPath,
    };
  }

  /**
   * Resolve dependencies from package.json
   */
  private async resolveDependencies(projectPath: string): Promise<DependencyInfo[]> {
    // In a real implementation, this would read package.json and resolve the dependency tree
    // For simulation, return a set of known dependencies
    return [
      { name: 'lodash', version: '4.17.20', direct: true, licenses: ['MIT'] },
      { name: 'express', version: '4.17.1', direct: true, licenses: ['MIT'] },
      { name: 'minimist', version: '1.2.5', direct: false, licenses: ['MIT'] },
      { name: 'axios', version: '0.21.1', direct: true, licenses: ['MIT'] },
      { name: 'debug', version: '4.3.1', direct: false, licenses: ['MIT'] },
      { name: 'typescript', version: '5.0.0', direct: true, licenses: ['Apache-2.0'] },
    ];
  }

  /**
   * Check for known vulnerabilities
   */
  checkVulnerabilities(dependencies: DependencyInfo[]): Vulnerability[] {
    const found: Vulnerability[] = [];

    for (const dep of dependencies) {
      for (const vuln of SIMULATED_VULNERABILITIES) {
        if (vuln.package === dep.name && this.versionMatches(dep.version, vuln.version)) {
          if (this.severityMeetsThreshold(vuln.severity)) {
            found.push({
              ...vuln,
              version: dep.version,
            });
          }
        }
      }
    }

    return found;
  }

  /**
   * Check for outdated packages
   */
  checkOutdatedPackages(dependencies: DependencyInfo[]): OutdatedPackage[] {
    const outdated: OutdatedPackage[] = [];

    for (const dep of dependencies) {
      const latest = SIMULATED_LATEST[dep.name];
      if (latest && latest !== dep.version) {
        const updateType = this.getUpdateType(dep.version, latest);
        outdated.push({
          package: dep.name,
          current: dep.version,
          latest,
          updateType,
        });
      }
    }

    return outdated;
  }

  /**
   * Check license compliance
   */
  checkLicenses(dependencies: DependencyInfo[]): LicenseIssue[] {
    const issues: LicenseIssue[] = [];

    for (const dep of dependencies) {
      const licenses = dep.licenses ?? [];

      if (licenses.length === 0) {
        issues.push({
          package: dep.name,
          license: 'unknown',
          reason: 'unknown',
        });
        continue;
      }

      for (const license of licenses) {
        if (this.options.deniedLicenses.some((d) => license.toLowerCase().includes(d.toLowerCase()))) {
          issues.push({
            package: dep.name,
            license,
            reason: 'denied',
          });
        } else if (!this.options.allowedLicenses.some((a) => license.toLowerCase().includes(a.toLowerCase()))) {
          issues.push({
            package: dep.name,
            license,
            reason: 'unknown',
          });
        }
      }
    }

    return issues;
  }

  /**
   * Generate a summary of scan results
   */
  private generateSummary(
    vulnerabilities: Vulnerability[],
    outdated: OutdatedPackage[],
    licenseIssues: LicenseIssue[],
    dependencies: DependencyInfo[]
  ): ScanResult['summary'] {
    return {
      totalPackages: dependencies.length,
      criticalVulnerabilities: vulnerabilities.filter((v) => v.severity === 'critical').length,
      highVulnerabilities: vulnerabilities.filter((v) => v.severity === 'high').length,
      mediumVulnerabilities: vulnerabilities.filter((v) => v.severity === 'medium').length,
      lowVulnerabilities: vulnerabilities.filter((v) => v.severity === 'low').length,
      infoCount: vulnerabilities.filter((v) => v.severity === 'info').length,
      outdatedCount: outdated.length,
      licenseIssueCount: licenseIssues.length,
    };
  }

  /**
   * Check if a version matches a version range (simplified)
   */
  private versionMatches(version: string, range: string): boolean {
    if (range.startsWith('<')) {
      const target = range.slice(1);
      return this.compareVersions(version, target) < 0;
    }
    if (range.startsWith('>=')) {
      const target = range.slice(2);
      return this.compareVersions(version, target) >= 0;
    }
    if (range.startsWith('>')) {
      const target = range.slice(1);
      return this.compareVersions(version, target) > 0;
    }
    return version === range;
  }

  /**
   * Compare two semver versions
   */
  private compareVersions(a: string, b: string): number {
    const pa = a.replace(/^v/, '').split('.').map(Number);
    const pb = b.replace(/^v/, '').split('.').map(Number);

    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = pa[i] ?? 0;
      const nb = pb[i] ?? 0;
      if (na < nb) return -1;
      if (na > nb) return 1;
    }
    return 0;
  }

  /**
   * Determine the type of update between two versions
   */
  private getUpdateType(current: string, latest: string): 'major' | 'minor' | 'patch' {
    const ca = current.replace(/^v/, '').split('.').map(Number);
    const la = latest.replace(/^v/, '').split('.').map(Number);

    if (la[0] > (ca[0] ?? 0)) return 'major';
    if (la[1] > (ca[1] ?? 0)) return 'minor';
    return 'patch';
  }

  /**
   * Check if a severity meets the threshold
   */
  private severityMeetsThreshold(severity: Severity): boolean {
    const levels: Record<Severity, number> = {
      critical: 5,
      high: 4,
      medium: 3,
      low: 2,
      info: 1,
    };
    return levels[severity] >= levels[this.options.severityThreshold];
  }

  /**
   * Add a custom vulnerability to the database
   */
  addVulnerability(vulnerability: Vulnerability): void {
    SIMULATED_VULNERABILITIES.push(vulnerability);
  }

  /**
   * Update scanner options
   */
  updateOptions(options: Partial<ScannerOptions>): void {
    this.options = { ...this.options, ...options };
  }
}
