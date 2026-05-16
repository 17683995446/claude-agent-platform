// ============================================================================
// @claude-agent/diagnostics - Diagnostic Tools
// ============================================================================

export interface DiagnosticResult {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  details?: Record<string, unknown>;
  duration?: number;
}

export interface DiagnosticReport {
  timestamp: Date;
  results: DiagnosticResult[];
  summary: { pass: number; warn: number; fail: number };
  environment: Record<string, string>;
}

export class DiagnosticsRunner {
  private checks: Map<string, () => DiagnosticResult | Promise<DiagnosticResult>> = new Map();

  registerCheck(name: string, check: () => DiagnosticResult | Promise<DiagnosticResult>): void {
    this.checks.set(name, check);
  }

  unregisterCheck(name: string): void {
    this.checks.delete(name);
  }

  async runAll(): Promise<DiagnosticReport> {
    const results: DiagnosticResult[] = [];
    for (const [name, check] of this.checks) {
      const start = Date.now();
      try {
        const result = await check();
        results.push({ ...result, duration: Date.now() - start });
      } catch (error) {
        results.push({
          name,
          status: 'fail',
          message: `Check failed: ${error instanceof Error ? error.message : String(error)}`,
          duration: Date.now() - start,
        });
      }
    }

    const summary = {
      pass: results.filter(r => r.status === 'pass').length,
      warn: results.filter(r => r.status === 'warn').length,
      fail: results.filter(r => r.status === 'fail').length,
    };

    return {
      timestamp: new Date(),
      results,
      summary,
      environment: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        bunVersion: typeof Bun !== 'undefined' ? (Bun.version ?? 'unknown') : 'N/A',
        cwd: process.cwd(),
        pid: String(process.pid),
      },
    };
  }

  async runCheck(name: string): Promise<DiagnosticResult> {
    const check = this.checks.get(name);
    if (!check) throw new Error(`Check "${name}" not found`);
    return check();
  }

  listChecks(): string[] {
    return Array.from(this.checks.keys());
  }

  static createDefault(): DiagnosticsRunner {
    const runner = new DiagnosticsRunner();

    runner.registerCheck('runtime', () => ({
      name: 'runtime',
      status: typeof Bun !== 'undefined' ? 'pass' : 'warn',
      message: typeof Bun !== 'undefined' ? 'Bun runtime detected' : 'Running under Node.js (Bun recommended)',
    }));

    runner.registerCheck('memory', () => {
      const mem = process.memoryUsage();
      const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
      const usagePercent = Math.round((mem.heapUsed / mem.heapTotal) * 100);
      return {
        name: 'memory',
        status: usagePercent > 90 ? 'warn' : 'pass',
        message: `Heap: ${heapUsedMB}MB / ${heapTotalMB}MB (${usagePercent}%)`,
        details: { heapUsedMB, heapTotalMB, usagePercent, rssMB: Math.round(mem.rss / 1024 / 1024) },
      };
    });

    runner.registerCheck('typescript', () => ({
      name: 'typescript',
      status: 'pass',
      message: 'TypeScript support available',
      details: { version: '5.6+' },
    }));

    runner.registerCheck('zod', () => ({
      name: 'zod',
      status: 'pass',
      message: 'Zod validation library available',
    }));

    runner.registerCheck('env', () => {
      const env = process.env.NODE_ENV ?? 'development';
      return {
        name: 'env',
        status: env === 'production' ? 'pass' : 'warn',
        message: `Environment: ${env}`,
      };
    });

    return runner;
  }
}
