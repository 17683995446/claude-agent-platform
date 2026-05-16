// src/api-documentation.ts - API 文档生成

export interface EndpointMetadata {
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: ParameterSpec[];
  requestBody?: RequestBodySpec;
  responses?: Record<string, ResponseSpec>;
  security?: SecuritySpec[];
  deprecated?: boolean;
  examples?: Record<string, unknown>;
}

export interface ParameterSpec {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  type?: string;
  schema?: Record<string, unknown>;
  example?: unknown;
}

export interface RequestBodySpec {
  description?: string;
  required?: boolean;
  content: Record<string, MediaSpec>;
}

export interface MediaSpec {
  schema?: Record<string, unknown>;
  example?: unknown;
}

export interface ResponseSpec {
  description?: string;
  content?: Record<string, MediaSpec>;
}

export interface SecuritySpec {
  type: string;
  scheme?: string;
  bearerFormat?: string;
  scopes?: string[];
}

export interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  paths: Record<string, Record<string, OperationObject>>;
  components?: {
    securitySchemes?: Record<string, SecuritySpec>;
    schemas?: Record<string, unknown>;
  };
  tags?: TagObject[];
}

export interface OperationObject {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: ParameterSpec[];
  requestBody?: RequestBodySpec;
  responses: Record<string, ResponseSpec>;
  security?: SecuritySpec[];
  deprecated?: boolean;
}

export interface TagObject {
  name: string;
  description?: string;
}

export class APIDocumentationGenerator {
  private endpoints: Map<string, Map<string, EndpointMetadata>> = new Map();
  private title: string;
  private version: string;
  private description: string;
  private securitySchemes: Record<string, SecuritySpec> = {};
  private tags: Map<string, string> = new Map();

  constructor(options?: { title?: string; version?: string; description?: string }) {
    this.title = options?.title || 'API Documentation';
    this.version = options?.version || '1.0.0';
    this.description = options?.description || '';
  }

  registerEndpoint(route: string, method: string, metadata: EndpointMetadata): void {
    const normalizedRoute = this.normalizeRoute(route);
    const normalizedMethod = method.toUpperCase();

    if (!this.endpoints.has(normalizedRoute)) {
      this.endpoints.set(normalizedRoute, new Map());
    }

    this.endpoints.get(normalizedRoute)!.set(normalizedMethod, metadata);

    // Collect tags
    if (metadata.tags) {
      for (const tag of metadata.tags) {
        if (!this.tags.has(tag)) {
          this.tags.set(tag, tag);
        }
      }
    }
  }

  addSecurityScheme(name: string, scheme: SecuritySpec): void {
    this.securitySchemes[name] = scheme;
  }

  addTag(name: string, description?: string): void {
    this.tags.set(name, description || name);
  }

  generateOpenAPISpec(): OpenAPISpec {
    const paths: Record<string, Record<string, OperationObject>> = {};

    for (const [route, methods] of this.endpoints) {
      paths[route] = {};
      for (const [method, metadata] of methods) {
        const operation: OperationObject = {
          responses: metadata.responses || { '200': { description: 'Successful response' } },
        };

        if (metadata.summary) operation.summary = metadata.summary;
        if (metadata.description) operation.description = metadata.description;
        if (metadata.tags) operation.tags = metadata.tags;
        if (metadata.parameters) operation.parameters = metadata.parameters;
        if (metadata.requestBody) operation.requestBody = metadata.requestBody;
        if (metadata.security) operation.security = metadata.security;
        if (metadata.deprecated) operation.deprecated = metadata.deprecated;

        operation.operationId = `${method.toLowerCase()}${this.routeToOperationId(route)}`;

        paths[route][method.toLowerCase()] = operation;
      }
    }

    const spec: OpenAPISpec = {
      openapi: '3.0.0',
      info: {
        title: this.title,
        version: this.version,
        description: this.description || undefined,
      },
      paths,
    };

    if (Object.keys(this.securitySchemes).length > 0) {
      spec.components = { securitySchemes: this.securitySchemes };
    }

    if (this.tags.size > 0) {
      spec.tags = Array.from(this.tags.entries()).map(([name, description]) => ({ name, description }));
    }

    return spec;
  }

  generateMarkdown(): string {
    let md = `# ${this.title}\n\n`;
    md += `Version: ${this.version}\n\n`;

    if (this.description) {
      md += `${this.description}\n\n`;
    }

    // Group by tags
    const tagGroups: Map<string, { route: string; method: string; metadata: EndpointMetadata }[]> = new Map();

    for (const [route, methods] of this.endpoints) {
      for (const [method, metadata] of methods) {
        const tags = metadata.tags || ['default'];
        for (const tag of tags) {
          if (!tagGroups.has(tag)) {
            tagGroups.set(tag, []);
          }
          tagGroups.get(tag)!.push({ route, method, metadata });
        }
      }
    }

    for (const [tag, endpoints] of tagGroups) {
      md += `## ${tag}\n\n`;
      for (const { route, method, metadata } of endpoints) {
        md += `### ${method} ${route}\n\n`;
        if (metadata.summary) md += `${metadata.summary}\n\n`;
        if (metadata.description) md += `${metadata.description}\n\n`;
        if (metadata.deprecated) md += `> **Deprecated**\n\n`;
        if (metadata.parameters && metadata.parameters.length > 0) {
          md += `**Parameters:**\n\n`;
          md += `| Name | In | Required | Type | Description |\n`;
          md += `|------|-----|----------|------|-------------|\n`;
          for (const param of metadata.parameters) {
            md += `| ${param.name} | ${param.in} | ${param.required ? 'Yes' : 'No'} | ${param.type || '-'} | ${param.description || '-'} |\n`;
          }
          md += '\n';
        }
        if (metadata.responses) {
          md += `**Responses:**\n\n`;
          for (const [code, resp] of Object.entries(metadata.responses)) {
            md += `- \`${code}\`: ${resp.description || 'No description'}\n`;
          }
          md += '\n';
        }
      }
    }

    return md;
  }

  generateExplorerData(): { routes: Array<{ method: string; path: string; summary?: string; tags?: string[] }> } {
    const routes: Array<{ method: string; path: string; summary?: string; tags?: string[] }> = [];

    for (const [route, methods] of this.endpoints) {
      for (const [method, metadata] of methods) {
        routes.push({
          method,
          path: route,
          summary: metadata.summary,
          tags: metadata.tags,
        });
      }
    }

    return { routes };
  }

  getEndpoints(): Array<{ route: string; method: string; metadata: EndpointMetadata }> {
    const result: Array<{ route: string; method: string; metadata: EndpointMetadata }> = [];
    for (const [route, methods] of this.endpoints) {
      for (const [method, metadata] of methods) {
        result.push({ route, method, metadata });
      }
    }
    return result;
  }

  private normalizeRoute(route: string): string {
    // Remove trailing slash unless it's the root
    if (route !== '/' && route.endsWith('/')) {
      route = route.slice(0, -1);
    }
    return route;
  }

  private routeToOperationId(route: string): string {
    return route
      .split('/')
      .filter(Boolean)
      .map((segment) => {
        if (segment.startsWith('{') || segment.startsWith(':')) {
          return 'By' + segment.replace(/[{}:]/g, '').charAt(0).toUpperCase() + segment.replace(/[{}:]/g, '').slice(1);
        }
        return segment.charAt(0).toUpperCase() + segment.slice(1);
      })
      .join('');
  }
}
