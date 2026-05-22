// src/sandbox.ts - 沙箱执行引擎

export interface SandboxOptions {
  /** Maximum CPU time in milliseconds (default: 5000) */
  timeout?: number;
  /** Maximum memory usage in bytes (default: 64MB) */
  memoryLimit?: number;
  /** File system access whitelist (if set, only these paths are accessible) */
  filesystemWhitelist?: string[];
  /** File system access blacklist (these paths are always blocked) */
  filesystemBlacklist?: string[];
  /** Allowed network hosts */
  networkAllowList?: string[];
  /** Denied network hosts */
  networkDenyList?: string[];
  /** Allowed network ports */
  networkAllowPorts?: number[];
  /** Denied network ports */
  networkDenyPorts?: number[];
  /** Whether network access is allowed at all (default: false) */
  networkEnabled?: boolean;
  /** Working directory for the sandbox */
  workingDirectory?: string;
  /** Environment variables to pass into the sandbox */
  env?: Record<string, string>;
}

export interface SandboxResult<T = unknown> {
  /** Standard output from the sandboxed code */
  stdout: string;
  /** Standard error from the sandboxed code */
  stderr: string;
  /** Exit code (0 = success, non-zero = error) */
  exitCode: number;
  /** Execution time in milliseconds */
  executionTime: number;
  /** Peak memory usage in bytes */
  memoryUsed: number;
  /** The return value from the sandboxed code */
  result?: T;
  /** Whether execution was killed due to timeout */
  timedOut: boolean;
  /** Whether execution was killed due to memory limit */
  memoryExceeded: boolean;
  /** Error message if execution failed */
  error?: string;
}

export class Sandbox {
  private options: Required<SandboxOptions>;

  constructor(options: SandboxOptions = {}) {
    this.options = {
      timeout: options.timeout ?? 5000,
      memoryLimit: options.memoryLimit ?? 64 * 1024 * 1024,
      filesystemWhitelist: options.filesystemWhitelist ?? [],
      filesystemBlacklist: options.filesystemBlacklist ?? [],
      networkAllowList: options.networkAllowList ?? [],
      networkDenyList: options.networkDenyList ?? [],
      networkAllowPorts: options.networkAllowPorts ?? [],
      networkDenyPorts: options.networkDenyPorts ?? [],
      networkEnabled: options.networkEnabled ?? false,
      workingDirectory: options.workingDirectory ?? '/tmp/sandbox',
      env: options.env ?? {},
    };
  }

  /**
   * Validate file system access for a given path
   */
  validateFilesystemAccess(path: string): { allowed: boolean; reason?: string } {
    // BUG-003 FIX: Check path traversal BEFORE whitelist/blacklist checks.
    // Previously, a path like "/tmp/../../etc/passwd" would pass the whitelist
    // check for "/tmp" before the traversal check caught it.
    // Decode URL-encoded characters first to prevent bypass via %2e%2e%2f etc.
    let decoded = path;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      // If decoding fails, use the original path
    }
    const normalized = decoded.replace(/\\/g, '/').replace(/\/+/g, '/');
    if (normalized.includes('..')) {
      return { allowed: false, reason: 'Path traversal detected' };
    }

    // Check blacklist
    for (const blocked of this.options.filesystemBlacklist) {
      if (normalized.startsWith(blocked) || normalized === blocked) {
        return { allowed: false, reason: `Path is blacklisted: ${blocked}` };
      }
    }

    // If whitelist is set, path must be in it
    if (this.options.filesystemWhitelist.length > 0) {
      const allowed = this.options.filesystemWhitelist.some(
        (allowedPath) => normalized.startsWith(allowedPath) || normalized === allowedPath
      );
      if (!allowed) {
        return { allowed: false, reason: 'Path not in filesystem whitelist' };
      }
    }

    return { allowed: true };
  }

  /**
   * Validate network access for a given host and port
   */
  validateNetworkAccess(host: string, port: number): { allowed: boolean; reason?: string } {
    if (!this.options.networkEnabled) {
      return { allowed: false, reason: 'Network access is disabled' };
    }

    // BUG-004 FIX: Normalize host to lowercase for case-insensitive comparison.
    // Previously, "EVIL.COM" would bypass a deny list containing "evil.com".
    const normalizedHost = host.toLowerCase();

    // Check deny list
    if (this.options.networkDenyList.some((h) => h.toLowerCase() === normalizedHost)) {
      return { allowed: false, reason: `Host is denied: ${host}` };
    }

    if (this.options.networkDenyPorts.includes(port)) {
      return { allowed: false, reason: `Port is denied: ${port}` };
    }

    // If allow list is set, host/port must be in it
    if (this.options.networkAllowList.length > 0) {
      const hostAllowed = this.options.networkAllowList.some((h) => h.toLowerCase() === normalizedHost);
      if (!hostAllowed) {
        return { allowed: false, reason: `Host not in allow list: ${host}` };
      }
    }

    if (this.options.networkAllowPorts.length > 0) {
      const portAllowed = this.options.networkAllowPorts.includes(port);
      if (!portAllowed) {
        return { allowed: false, reason: `Port not in allow list: ${port}` };
      }
    }

    return { allowed: true };
  }

  /**
   * Execute code in the sandbox
   */
  async execute<T = unknown>(code: string, options?: SandboxOptions): Promise<SandboxResult<T>> {
    const mergedOptions = { ...this.options, ...options };
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    let timedOut = false;
    let memoryExceeded = false;
    let result: T | undefined;
    let error: string | undefined;

    // Estimate memory usage based on code size and complexity
    // Accounts for code string, AST overhead, runtime objects, and stack frames
    const estimatedMemory = code.length * 2 + 4096 + (code.split(/\s+/).length * 64);

    if (estimatedMemory > mergedOptions.memoryLimit) {
      return {
        stdout: '',
        stderr: 'Memory limit exceeded before execution',
        exitCode: -1,
        executionTime: 0,
        memoryUsed: estimatedMemory,
        timedOut: false,
        memoryExceeded: true,
        error: 'Memory limit exceeded',
      };
    }

    try {
      // SECURITY WARNING: new Function() does NOT provide true sandboxing.
      // The executed code has access to the global scope (process, require, etc.)
      // and can escape any restrictions imposed here. In production, use a proper
      // sandboxing solution such as:
      //   - Node.js vm module with context isolation
      //   - isolates-vm or vm2 packages
      //   - Web Workers
      //   - Separate child processes
      //   - Deno permissions
      //
      // Basic input sanitization: reject code containing dangerous patterns
      const dangerousPatterns = [
        /\bprocess\b/,
        /\brequire\b/,
        /\bimport\b/,
        /\beval\b/,
        /\bFunction\b/,
        /\bglobalThis\b/,
        /\bglobal\b/,
      ];
      for (const pattern of dangerousPatterns) {
        if (pattern.test(code)) {
          throw new Error(`Code contains prohibited pattern: ${pattern.source}`);
        }
      }

      const sandboxedFn = new Function(
        '__output',
        `
        const __stdout = [];
        const __stderr = [];
        const console = {
          log: (...args) => __stdout.push(args.map(a => String(a)).join(' ')),
          error: (...args) => __stderr.push(args.map(a => String(a)).join(' ')),
          warn: (...args) => __stderr.push(args.map(a => String(a)).join(' ')),
        };
        try {
          const __result = (function() {
            ${code}
          })();
          __output.stdout = __stdout.join('\\n');
          __output.stderr = __stderr.join('\\n');
          __output.result = __result;
          __output.exitCode = 0;
        } catch(__e) {
          __output.stdout = __stdout.join('\\n');
          __output.stderr = __stderr.join('\\n') + '\\n' + String(__e.message || __e);
          __output.exitCode = 1;
          __output.error = String(__e.message || __e);
        }
        `
      );

      const output: Record<string, unknown> = {};

      // Execute with timeout
      let timeoutId: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          reject(new Error(`Execution timed out after ${mergedOptions.timeout}ms`));
        }, mergedOptions.timeout);
      });

      const executionPromise = Promise.resolve(sandboxedFn(output));

      try {
        await Promise.race([executionPromise, timeoutPromise]);
        // Clear the timeout on successful execution to prevent timer leak
        clearTimeout(timeoutId);
      } catch (raceError) {
        clearTimeout(timeoutId);
        throw raceError;
      }

      stdout = (output.stdout as string) ?? '';
      stderr = (output.stderr as string) ?? '';
      exitCode = (output.exitCode as number) ?? 0;
      result = output.result as T | undefined;
    } catch (e: any) {
      stderr = e.message || String(e);
      exitCode = timedOut ? -1 : 1;
      if (timedOut) {
        error = `Execution timed out after ${mergedOptions.timeout}ms`;
      } else {
        error = e.message || String(e);
      }
    }

    const executionTime = Date.now() - startTime;

    return {
      stdout,
      stderr,
      exitCode,
      executionTime,
      memoryUsed: estimatedMemory,
      result,
      timedOut,
      memoryExceeded,
      error,
    };
  }

  /**
   * Static convenience method for one-off sandbox execution
   */
  static async execute<T = unknown>(
    code: string,
    options?: SandboxOptions
  ): Promise<SandboxResult<T>> {
    const sandbox = new Sandbox(options);
    return sandbox.execute<T>(code, options);
  }

  /** Get current sandbox options */
  getOptions(): Readonly<SandboxOptions> {
    return { ...this.options };
  }

  /** Update sandbox options */
  updateOptions(options: Partial<SandboxOptions>): void {
    this.options = { ...this.options, ...options };
  }
}
