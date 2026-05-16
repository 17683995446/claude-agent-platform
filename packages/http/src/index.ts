// ============================================================================
// @claude-agent/http - HTTP Health Check Endpoints
// ============================================================================

import type {
  HealthCheckResult,
  HealthCheck,
  MetricsData,
  MemoryUsage,
  LoggerInterface,
  EventBusInterface,
} from '@claude-agent/types';
import { HttpError } from '@claude-agent/errors';
import { Logger } from '@claude-agent/logger';
import { EventBus } from '@claude-agent/core';

// ---- Health Check Registry ----

export type HealthCheckFn = () => Promise<HealthCheck> | HealthCheck;

export class HealthCheckRegistry {
  private checks: Map<string, HealthCheckFn> = new Map();

  /** Register a health check */
  register(name: string, check: HealthCheckFn): void {
    this.checks.set(name, check);
  }

  /** Unregister a health check */
  unregister(name: string): void {
    this.checks.delete(name);
  }

  /** Run all health checks */
  async runAll(): Promise<HealthCheck[]> {
    const results: HealthCheck[] = [];

    for (const [name, check] of this.checks) {
      try {
        const startTime = Date.now();
        const result = await check();
        const duration = Date.now() - startTime;
        results.push({ ...result, name, duration });
      } catch (error) {
        results.push({
          name,
          status: 'unhealthy',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  /** Run a specific health check */
  async run(name: string): Promise<HealthCheck> {
    const check = this.checks.get(name);
    if (!check) {
      throw new HttpError(`Health check "${name}" not found`, 404);
    }
    return check();
  }

  /** List registered health checks */
  list(): string[] {
    return Array.from(this.checks.keys());
  }
}

// ---- HTTP Server ----

export class HealthServer {
  private registry: HealthCheckRegistry;
  private logger: LoggerInterface;
  private eventBus: EventBusInterface;
  private server: ReturnType<typeof Bun.serve> | null = null;
  private startTime: number = 0;
  private version: string;
  private host: string;
  private port: number;
  private healthPath: string;
  private ready: boolean = false;

  constructor(options: {
    registry?: HealthCheckRegistry;
    logger?: LoggerInterface;
    eventBus?: EventBusInterface;
    version?: string;
    host?: string;
    port?: number;
    healthPath?: string;
  }) {
    this.registry = options.registry ?? new HealthCheckRegistry();
    this.logger = options?.logger ?? new Logger();
    this.eventBus = options?.eventBus ?? new EventBus();
    this.version = options?.version ?? '1.0.0';
    this.host = options?.host ?? '127.0.0.1';
    this.port = options?.port ?? 3000;
    this.healthPath = options?.healthPath ?? '/';
  }

  /** Get the health check registry */
  getRegistry(): HealthCheckRegistry {
    return this.registry;
  }

  /** Start the HTTP server */
  start(): void {
    if (this.server) {
      this.logger.warn('HTTP server is already running');
      return;
    }

    this.startTime = Date.now();

    this.server = Bun.serve({
      hostname: this.host,
      port: this.port,
      fetch: (req, server) => this.handleRequest(req),
    });

    this.ready = true;
    this.logger.info(`HTTP server started on ${this.host}:${this.port}`);
  }

  /** Stop the HTTP server */
  async stop(): Promise<void> {
    if (!this.server) return;

    this.ready = false;
    this.server.stop();
    this.server = null;
    this.logger.info('HTTP server stopped');
  }

  /** Check if the server is ready */
  isReady(): boolean {
    return this.ready;
  }

  /** Get the server URL */
  getUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  /** Handle incoming requests */
  private async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    try {
      // Health endpoint
      if (path === `${this.healthPath}health`) {
        return await this.handleHealth();
      }

      // Readiness endpoint
      if (path === `${this.healthPath}ready`) {
        return this.handleReady();
      }

      // Metrics endpoint
      if (path === `${this.healthPath}metrics`) {
        return this.handleMetrics();
      }

      // 404 for unknown paths
      return Response.json({ error: 'Not Found' }, { status: 404 });
    } catch (error) {
      this.logger.error('HTTP request error', {
        path,
        error: error instanceof Error ? error.message : String(error),
      });

      return Response.json(
        {
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 },
      );
    }
  }

  /** Handle /health endpoint */
  private async handleHealth(): Promise<Response> {
    const checks = await this.registry.runAll();
    const overallStatus = checks.every((c) => c.status === 'healthy')
      ? 'healthy'
      : checks.some((c) => c.status === 'unhealthy')
        ? 'unhealthy'
        : 'degraded';

    const result: HealthCheckResult = {
      status: overallStatus,
      timestamp: new Date(),
      checks,
      uptime: Date.now() - this.startTime,
      version: this.version,
    };

    const statusCode = overallStatus === 'healthy' ? 200 : overallStatus === 'degraded' ? 200 : 503;

    return Response.json(result, { status: statusCode });
  }

  /** Handle /ready endpoint */
  private handleReady(): Response {
    const result = {
      status: this.ready ? 'ready' : 'not_ready',
      timestamp: new Date(),
      uptime: Date.now() - this.startTime,
    };

    return Response.json(result, { status: this.ready ? 200 : 503 });
  }

  /** Handle /metrics endpoint */
  private handleMetrics(): Response {
    const memoryUsage = process.memoryUsage();

    const metrics: MetricsData = {
      timestamp: new Date(),
      tasksTotal: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      pipelinesTotal: 0,
      pipelinesCompleted: 0,
      activePlugins: 0,
      uptime: Date.now() - this.startTime,
      memoryUsage: {
        rss: memoryUsage.rss,
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        external: memoryUsage.external ?? 0,
      },
    };

    return Response.json(metrics);
  }
}
