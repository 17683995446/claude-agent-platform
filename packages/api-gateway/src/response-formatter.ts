// src/response-formatter.ts - 响应格式化

export interface ResponseMeta {
  requestId?: string;
  duration?: number;
  [key: string]: unknown;
}

export interface ResponseEnvelope {
  success: boolean;
  data?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: ResponseMeta;
  timestamp: string;
}

export interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse extends ResponseEnvelope {
  data: unknown[];
  pagination: PaginationInfo;
}

export interface HATEOASLink {
  href: string;
  rel: string;
  method?: string;
  title?: string;
}

export type ContentType = 'json' | 'xml' | 'msgpack';

export class ResponseFormatter {
  private defaultContentType: ContentType = 'json';

  setDefaultContentType(type: ContentType): void {
    this.defaultContentType = type;
  }

  success(data: unknown, meta?: ResponseMeta): ResponseEnvelope {
    return {
      success: true,
      data,
      meta,
      timestamp: new Date().toISOString(),
    };
  }

  error(code: string, message: string, details?: unknown): ResponseEnvelope {
    return {
      success: false,
      error: {
        code,
        message,
        details,
      },
      timestamp: new Date().toISOString(),
    };
  }

  paginate(data: unknown[], page: number, pageSize: number, meta?: ResponseMeta): PaginatedResponse {
    const total = data.length;
    const totalPages = Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const pageData = data.slice(start, end);

    return {
      success: true,
      data: pageData,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
      meta,
      timestamp: new Date().toISOString(),
    };
  }

  paginateWithTotal(
    data: unknown[],
    total: number,
    page: number,
    pageSize: number,
    meta?: ResponseMeta
  ): PaginatedResponse {
    const totalPages = Math.ceil(total / pageSize);

    return {
      success: true,
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
      meta,
      timestamp: new Date().toISOString(),
    };
  }

  created(data: unknown, location?: string): ResponseEnvelope {
    return {
      success: true,
      data,
      meta: location ? { location } : undefined,
      timestamp: new Date().toISOString(),
    };
  }

  noContent(): ResponseEnvelope {
    return {
      success: true,
      timestamp: new Date().toISOString(),
    };
  }

  notFound(resource: string, id?: string): ResponseEnvelope {
    const message = id ? `${resource} with id '${id}' not found` : `${resource} not found`;
    return this.error('NOT_FOUND', message);
  }

  unauthorized(message?: string): ResponseEnvelope {
    return this.error('UNAUTHORIZED', message || 'Authentication required');
  }

  forbidden(message?: string): ResponseEnvelope {
    return this.error('FORBIDDEN', message || 'Access denied');
  }

  badRequest(message: string, details?: unknown): ResponseEnvelope {
    return this.error('BAD_REQUEST', message, details);
  }

  internalError(message?: string, details?: unknown): ResponseEnvelope {
    return this.error('INTERNAL_ERROR', message || 'Internal server error', details);
  }

  tooManyRequests(retryAfter?: number): ResponseEnvelope {
    return {
      success: false,
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Rate limit exceeded',
        details: retryAfter !== undefined ? { retryAfter } : undefined,
      },
      timestamp: new Date().toISOString(),
    };
  }

  generateHATEOASLinks(baseUrl: string, page: number, pageSize: number, total: number): HATEOASLink[] {
    const totalPages = Math.ceil(total / pageSize);
    const links: HATEOASLink[] = [];

    links.push({
      href: `${baseUrl}?page=${page}&pageSize=${pageSize}`,
      rel: 'self',
      method: 'GET',
    });

    if (page > 1) {
      links.push({
        href: `${baseUrl}?page=${page - 1}&pageSize=${pageSize}`,
        rel: 'prev',
        method: 'GET',
      });
    }

    if (page < totalPages) {
      links.push({
        href: `${baseUrl}?page=${page + 1}&pageSize=${pageSize}`,
        rel: 'next',
        method: 'GET',
      });
    }

    links.push({
      href: `${baseUrl}?page=1&pageSize=${pageSize}`,
      rel: 'first',
      method: 'GET',
    });

    if (totalPages > 0) {
      links.push({
        href: `${baseUrl}?page=${totalPages}&pageSize=${pageSize}`,
        rel: 'last',
        method: 'GET',
      });
    }

    return links;
  }

  format(envelope: ResponseEnvelope, contentType?: ContentType): string {
    const type = contentType || this.defaultContentType;

    switch (type) {
      case 'json':
        return JSON.stringify(envelope, null, 2);
      case 'xml':
        return this.toXML(envelope);
      case 'msgpack':
        // Simulated MessagePack - in production use a real library
        return JSON.stringify({ __msgpack: true, ...envelope });
      default:
        return JSON.stringify(envelope, null, 2);
    }
  }

  private toXML(envelope: ResponseEnvelope): string {
    const timestamp = this.escapeXML(envelope.timestamp);
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<response>\n`;
    xml += `  <success>${envelope.success}</success>\n`;
    xml += `  <timestamp>${timestamp}</timestamp>\n`;

    if (envelope.data !== undefined) {
      xml += `  <data>${this.valueToXML(envelope.data)}</data>\n`;
    }

    if (envelope.error) {
      xml += `  <error>\n`;
      xml += `    <code>${this.escapeXML(envelope.error.code)}</code>\n`;
      xml += `    <message>${this.escapeXML(envelope.error.message)}</message>\n`;
      if (envelope.error.details !== undefined) {
        xml += `    <details>${this.valueToXML(envelope.error.details)}</details>\n`;
      }
      xml += `  </error>\n`;
    }

    if (envelope.meta) {
      xml += `  <meta>${this.valueToXML(envelope.meta)}</meta>\n`;
    }

    xml += `</response>`;
    return xml;
  }

  private valueToXML(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return this.escapeXML(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
      return value.map((item) => `<item>${this.valueToXML(item)}</item>`).join('');
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      return entries
        .map(([k, v]) => `<${k}>${this.valueToXML(v)}</${k}>`)
        .join('');
    }
    return String(value);
  }

  private escapeXML(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
