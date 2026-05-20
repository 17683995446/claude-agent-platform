/**
 * Security Scanner Module
 *
 * Scan code for security vulnerabilities including injection attacks,
 * XSS, CSRF, insecure dependencies, hardcoded secrets, and unsafe deserialization.
 */

import type { ASTNode } from "./ast-parser.js";

/** Severity of a security vulnerability */
export type VulnerabilitySeverity = "info" | "low" | "medium" | "high" | "critical";

/** A detected security vulnerability */
export interface Vulnerability {
  id: string;
  type: string;
  severity: VulnerabilitySeverity;
  description: string;
  location: {
    file?: string;
    line?: number;
    column?: number;
    node?: string;
  };
  cwe?: string;
  owasp?: string;
  recommendation: string;
  code?: string;
}

/** Dependency information */
export interface DependencyInfo {
  name: string;
  version: string;
  isDev: boolean;
}

/** Security report */
export interface SecurityReport {
  vulnerabilities: Vulnerability[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    total: number;
    score: number;
  };
  scannedAt: string;
  recommendations: string[];
}

/** Known vulnerable package patterns */
interface VulnerablePackage {
  name: string;
  versions: string;
  severity: VulnerabilitySeverity;
  cwe: string;
  description: string;
}

/**
 * SecurityScanner - Scan code for security vulnerabilities.
 */
export class SecurityScanner {
  private vulnIdCounter = 0;
  private knownVulnerablePackages: VulnerablePackage[] = [
    { name: "lodash", versions: "<4.17.21", severity: "high", cwe: "CWE-77", description: "Command injection in lodash" },
    { name: "express", versions: "<4.17.2", severity: "medium", cwe: "CWE-400", description: "Open redirect in express" },
    { name: "minimist", versions: "<1.2.6", severity: "high", cwe: "CWE-77", description: "Prototype pollution in minimist" },
    { name: "axios", versions: "<0.21.2", severity: "medium", cwe: "CWE-918", description: "SSRF in axios" },
    { name: "jsonwebtoken", versions: "<8.5.2", severity: "high", cwe: "CWE-327", description: "Insecure algorithm in jsonwebtoken" },
  ];

  private secretPatterns: Array<{ pattern: RegExp; name: string; severity: VulnerabilitySeverity }> = [
    { pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*(?:\\"|')[^'\\"]{8,}(?:\\"|')/gi, name: "API Key", severity: "critical" },
    { pattern: /(?:password|passwd|pwd)\s*[:=]\s*(?:\\"|')[^'\\"]{6,}(?:\\"|')/gi, name: "Password", severity: "critical" },
    { pattern: /(?:secret|token|auth)\s*[:=]\s*(?:\\"|')[^'\\"]{10,}(?:\\"|')/gi, name: "Secret/Token", severity: "high" },
    { pattern: /(?:private[_-]?key|privatekey)\s*[:=]\s*(?:\\"|')-----BEGIN[^'\\"]+(?:\\"|')/gi, name: "Private Key", severity: "critical" },
    { pattern: /AWS_ACCESS_KEY_ID\s*[:=]\s*(?:\\"|')[A-Z0-9]{16,}(?:\\"|')/gi, name: "AWS Access Key", severity: "critical" },
    { pattern: /AWS_SECRET_ACCESS_KEY\s*[:=]\s*(?:\\"|')[A-Za-z0-9/+=]{32,}(?:\\"|')/gi, name: "AWS Secret Key", severity: "critical" },
    { pattern: /(?:github|gitlab)_token\s*[:=]\s*(?:\\"|')[a-zA-Z0-9]{30,}(?:\\"|')/gi, name: "Git Token", severity: "critical" },
    { pattern: /(?:mongodb|mysql|postgres):\/\/[^\s'"]+/gi, name: "Database Connection String", severity: "high" },
  ];

  /**
   * Scan AST for injection vulnerabilities (SQL, command, LDAP injection).
   * @param ast - The AST to scan
   * @returns Array of injection vulnerabilities
   */
  scanForInjection(ast: ASTNode): Vulnerability[] {
    const vulnerabilities: Vulnerability[] = [];
    this.scanNodeForInjection(ast, vulnerabilities);
    return vulnerabilities;
  }

  /**
   * Scan AST for Cross-Site Scripting (XSS) vulnerabilities.
   * @param ast - The AST to scan
   * @returns Array of XSS vulnerabilities
   */
  scanForXSS(ast: ASTNode): Vulnerability[] {
    const vulnerabilities: Vulnerability[] = [];
    this.scanNodeForXSS(ast, vulnerabilities);
    return vulnerabilities;
  }

  /**
   * Scan AST for Cross-Site Request Forgery (CSRF) vulnerabilities.
   * @param ast - The AST to scan
   * @returns Array of CSRF vulnerabilities
   */
  scanForCSRF(ast: ASTNode): Vulnerability[] {
    const vulnerabilities: Vulnerability[] = [];

    // Check for state-changing operations without CSRF protection
    const walk = (node: ASTNode): void => {
      if (node.type === "FunctionDeclaration" || node.kind === "function") {
        const name = (node.name as string) ?? "";
        const body = node.body;

        // Check if it's a POST/PUT/DELETE handler without CSRF token
        if (
          (name.toLowerCase().includes("post") ||
            name.toLowerCase().includes("put") ||
            name.toLowerCase().includes("delete") ||
            name.toLowerCase().includes("update") ||
            name.toLowerCase().includes("create")) &&
          body
        ) {
          const bodyStr = JSON.stringify(body);
          const hasCSRFProtection =
            bodyStr.includes("csrf") ||
            bodyStr.includes("xsrf") ||
            bodyStr.includes("_token") ||
            bodyStr.includes("csrfToken");

          if (!hasCSRFProtection) {
            this.vulnIdCounter++;
            vulnerabilities.push({
              id: `VULN-${this.vulnIdCounter}`,
              type: "csrf",
              severity: "medium",
              description: `Function "${name}" performs state-changing operation without CSRF protection`,
              location: { node: name },
              cwe: "CWE-352",
              owasp: "A01:2021",
              recommendation: "Add CSRF token validation for state-changing operations",
            });
          }
        }
      }

      this.walkChildren(node, walk);
    };

    walk(ast);
    return vulnerabilities;
  }

  /**
   * Scan dependencies for known vulnerabilities.
   * @param deps - Array of dependency information
   * @returns Array of vulnerable dependency findings
   */
  scanForInsecureDeps(deps: DependencyInfo[]): Vulnerability[] {
    const vulnerabilities: Vulnerability[] = [];

    for (const dep of deps) {
      const known = this.knownVulnerablePackages.find(
        (vp) => vp.name === dep.name && this.versionMatches(dep.version, vp.versions)
      );

      if (known) {
        this.vulnIdCounter++;
        vulnerabilities.push({
          id: `VULN-${this.vulnIdCounter}`,
          type: "insecure_dependency",
          severity: known.severity,
          description: `${dep.name}@${dep.version}: ${known.description}`,
          location: { node: `${dep.name}@${dep.version}` },
          cwe: known.cwe,
          recommendation: `Upgrade ${dep.name} to a version that addresses this vulnerability`,
        });
      }
    }

    return vulnerabilities;
  }

  /**
   * Scan AST for hardcoded secrets and credentials.
   * @param ast - The AST to scan
   * @returns Array of hardcoded secret vulnerabilities
   */
  scanForHardcodedSecrets(ast: ASTNode): Vulnerability[] {
    const vulnerabilities: Vulnerability[] = [];
    const code = JSON.stringify(ast);

    for (const { pattern, name, severity } of this.secretPatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(code)) !== null) {
        this.vulnIdCounter++;
        vulnerabilities.push({
          id: `VULN-${this.vulnIdCounter}`,
          type: "hardcoded_secret",
          severity,
          description: `Hardcoded ${name} detected`,
          location: {},
          cwe: "CWE-798",
          owasp: "A02:2021",
          recommendation: `Move ${name} to environment variables or a secure vault`,
          code: match[0].substring(0, 50) + "...",
        });
      }
    }

    return vulnerabilities;
  }

  /**
   * Scan AST for unsafe deserialization patterns.
   * @param ast - The AST to scan
   * @returns Array of unsafe deserialization vulnerabilities
   */
  scanForUnsafeDeserialization(ast: ASTNode): Vulnerability[] {
    const vulnerabilities: Vulnerability[] = [];

    const unsafePatterns = [
      { pattern: /eval\s*\(/g, desc: "Use of eval() for deserialization", severity: "critical" as VulnerabilitySeverity },
      { pattern: /JSON\.parse\s*\(\s*(?:userInput|req\.|request\.|params\.|query\.)/g, desc: "Parsing untrusted JSON input", severity: "high" as VulnerabilitySeverity },
      { pattern: /new Function\s*\(/g, desc: "Use of Function constructor for deserialization", severity: "critical" as VulnerabilitySeverity },
      { pattern: /unserialize|deserialize/g, desc: "Direct deserialization call", severity: "high" as VulnerabilitySeverity },
      { pattern: /child_process\.(exec|spawn|execSync|spawnSync)/g, desc: "Command execution with potential deserialized input", severity: "high" as VulnerabilitySeverity },
    ];

    const code = JSON.stringify(ast);

    for (const { pattern, desc, severity } of unsafePatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(code)) !== null) {
        this.vulnIdCounter++;
        vulnerabilities.push({
          id: `VULN-${this.vulnIdCounter}`,
          type: "unsafe_deserialization",
          severity,
          description: desc,
          location: {},
          cwe: "CWE-502",
          owasp: "A08:2021",
          recommendation: "Use safe parsing alternatives and validate input before deserialization",
          code: match[0],
        });
      }
    }

    return vulnerabilities;
  }

  /**
   * Generate a comprehensive security report for source code.
   * @param code - Source code string
   * @returns Complete security report
   */
  generateSecurityReport(code: string): SecurityReport {
    const vulnerabilities: Vulnerability[] = [];

    // Build a simple AST from the code
    const ast: ASTNode = {
      type: "Program",
      body: code.split("\n").map((line, i) => ({
        type: "Statement",
        range: { start: { line: i + 1, column: 0 }, end: { line: i + 1, column: line.length } },
        raw: line,
      })),
    };

    vulnerabilities.push(...this.scanForInjection(ast));
    vulnerabilities.push(...this.scanForXSS(ast));
    vulnerabilities.push(...this.scanForCSRF(ast));
    vulnerabilities.push(...this.scanForHardcodedSecrets(ast));
    vulnerabilities.push(...this.scanForUnsafeDeserialization(ast));

    // Sort by severity
    const severityOrder: Record<VulnerabilitySeverity, number> = {
      critical: 5,
      high: 4,
      medium: 3,
      low: 2,
      info: 1,
    };
    vulnerabilities.sort((a, b) => severityOrder[b.severity] - severityOrder[a.severity]);

    const summary = {
      critical: vulnerabilities.filter((v) => v.severity === "critical").length,
      high: vulnerabilities.filter((v) => v.severity === "high").length,
      medium: vulnerabilities.filter((v) => v.severity === "medium").length,
      low: vulnerabilities.filter((v) => v.severity === "low").length,
      info: vulnerabilities.filter((v) => v.severity === "info").length,
      total: vulnerabilities.length,
      score: this.calculateSecurityScore(vulnerabilities),
    };

    const recommendations = this.generateRecommendations(vulnerabilities);

    return {
      vulnerabilities,
      summary,
      scannedAt: new Date().toISOString(),
      recommendations,
    };
  }

  // --- Private helpers ---

  private scanNodeForInjection(node: ASTNode, vulns: Vulnerability[]): void {
    const code = JSON.stringify(node);

    // Check for parameterized query patterns (these are safe)
    const parameterizedPatterns = [
      /parameterized|prepared\s*statement|\.query\s*\(\s*\?|\.execute\s*\(\s*\?|pool\.query|knex|sequelize|typeorm|prisma/i,
    ];
    const isParameterized = parameterizedPatterns.some((p) => p.test(code));
    if (isParameterized) {
      this.walkChildren(node, (child) => this.scanNodeForInjection(child, vulns));
      return;
    }

    const injectionPatterns = [
      { pattern: /\$\{.*?\}/, desc: "Template literal injection", severity: "medium" as VulnerabilitySeverity, cwe: "CWE-96" },
      { pattern: /(?:query|sql)\s*\+\s*/, desc: "String concatenation in SQL query", severity: "critical" as VulnerabilitySeverity, cwe: "CWE-89" },
      { pattern: /exec\s*\(\s*(?:user|input|req|param)/, desc: "Command injection via exec()", severity: "critical" as VulnerabilitySeverity, cwe: "CWE-78" },
      { pattern: /innerHTML\s*=/, desc: "innerHTML assignment (potential XSS)", severity: "high" as VulnerabilitySeverity, cwe: "CWE-79" },
      { pattern: /document\.write\s*\(/, desc: "document.write() usage", severity: "medium" as VulnerabilitySeverity, cwe: "CWE-79" },
      { pattern: /\.exec\s*\(\s*`/, desc: "Template literal in exec()", severity: "critical" as VulnerabilitySeverity, cwe: "CWE-78" },
    ];

    for (const { pattern, desc, severity, cwe } of injectionPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(code)) {
        this.vulnIdCounter++;
        vulns.push({
          id: `VULN-${this.vulnIdCounter}`,
          type: "injection",
          severity,
          description: desc,
          location: { line: node.range?.start.line },
          cwe,
          owasp: "A03:2021",
          recommendation: "Use parameterized queries or prepared statements instead of string concatenation",
        });
      }
    }

    this.walkChildren(node, (child) => this.scanNodeForInjection(child, vulns));
  }

  private scanNodeForXSS(node: ASTNode, vulns: Vulnerability[]): void {
    const code = JSON.stringify(node);

    const xssPatterns = [
      { pattern: /dangerouslySetInnerHTML/, desc: "Use of dangerouslySetInnerHTML", severity: "high" as VulnerabilitySeverity },
      { pattern: /v-html\s*=/, desc: "Use of v-html directive (Vue)", severity: "high" as VulnerabilitySeverity },
      { pattern: /\[innerHTML\]/, desc: "Use of innerHTML binding (Angular)", severity: "high" as VulnerabilitySeverity },
      { pattern: /innerHTML\s*=/, desc: "innerHTML assignment", severity: "high" as VulnerabilitySeverity },
      { pattern: /document\.cookie/, desc: "Direct cookie access", severity: "low" as VulnerabilitySeverity },
      { pattern: /location\.href\s*=\s*(?:user|input|req|param)/, desc: "Open redirect via location.href", severity: "medium" as VulnerabilitySeverity },
    ];

    for (const { pattern, desc, severity } of xssPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(code)) {
        this.vulnIdCounter++;
        vulns.push({
          id: `VULN-${this.vulnIdCounter}`,
          type: "xss",
          severity,
          description: desc,
          location: { line: node.range?.start.line },
          cwe: "CWE-79",
          owasp: "A03:2021",
          recommendation: "Sanitize user input before rendering and use safe rendering methods",
        });
      }
    }

    this.walkChildren(node, (child) => this.scanNodeForXSS(child, vulns));
  }

  /**
   * Escape special regex characters in a string to prevent regex injection.
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private walkChildren(node: ASTNode, visitor: (child: ASTNode) => void): void {
    const childKeys = ["body", "declarations", "methods", "properties", "arguments", "elements", "consequent", "alternate", "init", "test"];
    for (const key of childKeys) {
      const child = (node as Record<string, unknown>)[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object") visitor(item as ASTNode);
        }
      } else if (child && typeof child === "object") {
        visitor(child as ASTNode);
      }
    }
  }

  private versionMatches(version: string, range: string): boolean {
    const cleanVersion = version.replace(/^[\^~>=<]/, "");
    const parts = cleanVersion.split(".").map(Number);
    const rangeMatch = range.match(/<(\d+)\.(\d+)\.(\d+)/);
    if (!rangeMatch) return false;

    const minParts = [Number(rangeMatch[1]), Number(rangeMatch[2]), Number(rangeMatch[3])];

    for (let i = 0; i < 3; i++) {
      if ((parts[i] ?? 0) < minParts[i]) return true;
      if ((parts[i] ?? 0) > minParts[i]) return false;
    }

    return false;
  }

  private calculateSecurityScore(vulnerabilities: Vulnerability[]): number {
    let score = 100;
    for (const vuln of vulnerabilities) {
      switch (vuln.severity) {
        case "critical": score -= 25; break;
        case "high": score -= 15; break;
        case "medium": score -= 7; break;
        case "low": score -= 3; break;
        case "info": score -= 1; break;
      }
    }
    return Math.max(0, score);
  }

  private generateRecommendations(vulnerabilities: Vulnerability[]): string[] {
    const recs = new Set<string>();

    for (const vuln of vulnerabilities) {
      recs.add(vuln.recommendation);
    }

    if (vulnerabilities.some((v) => v.severity === "critical")) {
      recs.add("Address critical vulnerabilities immediately before deployment");
    }

    return [...recs];
  }
}
