/**
 * OpenAPI Generator Module
 * Generates OpenAPI/Swagger specifications from route definitions.
 */

export interface RouteDefinition {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
  path: string;
  summary?: string;
  description?: string;
  parameters?: Array<{
    name: string;
    in: 'query' | 'header' | 'path' | 'cookie';
    required?: boolean;
    schema?: Record<string, unknown>;
    description?: string;
  }>;
  requestBody?: {
    description?: string;
    required?: boolean;
    content: Record<string, {
      schema: Record<string, unknown>;
      example?: unknown;
    }>;
  };
  responses?: Record<string, {
    description?: string;
    content?: Record<string, {
      schema: Record<string, unknown>;
      example?: unknown;
    }>;
  }>;
  tags?: string[];
  security?: Array<Record<string, string[]>>;
  deprecated?: boolean;
}

export interface SchemaDefinition {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  items?: Record<string, unknown>;
  $ref?: string;
  description?: string;
  [key: string]: unknown;
}

export interface SecurityScheme {
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect';
  description?: string;
  name?: string;
  in?: 'header' | 'query' | 'cookie';
  scheme?: string;
  bearerFormat?: string;
  flows?: Record<string, unknown>;
  openIdConnectUrl?: string;
}

export interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
    contact?: Record<string, string>;
    license?: Record<string, string>;
  };
  paths: Record<string, Record<string, unknown>>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
    responses?: Record<string, unknown>;
    parameters?: Record<string, unknown>;
  };
  tags?: Array<{ name: string; description?: string }>;
  security?: Array<Record<string, string[]>>;
  servers?: Array<{ url: string; description?: string }>;
}

export class OpenAPIGenerator {
  private spec: OpenAPISpec;
  private schemas: Map<string, SchemaDefinition> = new Map();
  private securitySchemes: Map<string, SecurityScheme> = new Map();

  constructor(info?: { title?: string; version?: string; description?: string }) {
    this.spec = {
      openapi: '3.0.3',
      info: {
        title: info?.title ?? 'API Documentation',
        version: info?.version ?? '1.0.0',
        description: info?.description,
      },
      paths: {},
      components: {
        schemas: {},
        securitySchemes: {},
      },
      tags: [],
      servers: [],
    };
  }

  /**
   * Generate OpenAPI spec from route definitions.
   */
  fromRoutes(routeDefinitions: RouteDefinition[]): OpenAPISpec {
    for (const route of routeDefinitions) {
      this.addRoute(route);
    }
    return this.spec;
  }

  /**
   * Generate from Express-like app (simplified).
   */
  fromExpress(app: { _routes?: RouteDefinition[] }): OpenAPISpec {
    if (app._routes) {
      return this.fromRoutes(app._routes);
    }
    return this.spec;
  }

  /**
   * Add a schema definition.
   */
  addSchema(name: string, schema: SchemaDefinition): void {
    this.schemas.set(name, schema);
    if (this.spec.components) {
      this.spec.components.schemas![name] = schema;
    }
  }

  /**
   * Add a security scheme.
   */
  addSecurity(name: string, config: SecurityScheme): void {
    this.securitySchemes.set(name, config);
    if (this.spec.components) {
      this.spec.components.securitySchemes![name] = config;
    }
  }

  /**
   * Generate the OpenAPI 3.0 specification.
   */
  generate(): OpenAPISpec {
    // Collect all tags
    const tagSet = new Set<string>();
    for (const pathItem of Object.values(this.spec.paths)) {
      for (const operation of Object.values(pathItem)) {
        const op = operation as Record<string, unknown>;
        if (Array.isArray(op.tags)) {
          for (const tag of op.tags) {
            if (typeof tag === 'string') tagSet.add(tag);
          }
        }
      }
    }
    this.spec.tags = Array.from(tagSet).map((name) => ({ name }));

    return { ...this.spec };
  }

  /**
   * Generate as JSON string.
   */
  generateJSON(): string {
    return JSON.stringify(this.generate(), null, 2);
  }

  /**
   * Generate as YAML string (simplified).
   */
  generateYAML(): string {
    const spec = this.generate();
    return this.jsonToYaml(spec);
  }

  // --- Internal helpers ---

  private addRoute(route: RouteDefinition): void {
    const path = route.path;
    if (!this.spec.paths[path]) {
      this.spec.paths[path] = {};
    }

    const method = route.method.toLowerCase();
    const operation: Record<string, unknown> = {
      summary: route.summary || '',
      description: route.description || '',
      operationId: `${method}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`,
    };

    if (route.parameters && route.parameters.length > 0) {
      operation.parameters = route.parameters;
    }

    if (route.requestBody) {
      operation.requestBody = route.requestBody;
    }

    if (route.responses) {
      operation.responses = route.responses;
    } else {
      operation.responses = {
        '200': { description: 'Successful response' },
      };
    }

    if (route.tags && route.tags.length > 0) {
      operation.tags = route.tags;
    }

    if (route.security) {
      operation.security = route.security;
    }

    if (route.deprecated) {
      operation.deprecated = true;
    }

    (this.spec.paths[path] as Record<string, unknown>)[method] = operation;
  }

  private jsonToYaml(obj: unknown, indent: number = 0): string {
    const spaces = '  '.repeat(indent);
    const lines: string[] = [];

    if (obj === null || obj === undefined) {
      return 'null';
    }

    if (typeof obj === 'string') {
      if (obj.includes('\n') || obj.includes(':') || obj.includes('#')) {
        return `"${obj.replace(/"/g, '\\"')}"`;
      }
      return obj;
    }

    if (typeof obj === 'number' || typeof obj === 'boolean') {
      return String(obj);
    }

    if (Array.isArray(obj)) {
      for (const item of obj) {
        lines.push(`${spaces}- ${this.jsonToYaml(item, indent + 1)}`);
      }
      return lines.join('\n');
    }

    if (typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          lines.push(`${spaces}${key}:`);
          lines.push(this.jsonToYaml(value, indent + 1));
        } else if (Array.isArray(value)) {
          if (value.length === 0) {
            lines.push(`${spaces}${key}: []`);
          } else {
            lines.push(`${spaces}${key}:`);
            for (const item of value) {
              lines.push(`${spaces}  - ${this.jsonToYaml(item, indent + 2)}`);
            }
          }
        } else {
          lines.push(`${spaces}${key}: ${this.jsonToYaml(value, indent)}`);
        }
      }
      return lines.join('\n');
    }

    return String(obj);
  }
}
