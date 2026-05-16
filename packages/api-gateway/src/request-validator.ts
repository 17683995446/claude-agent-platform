// src/request-validator.ts - 请求验证

import type { RequestContext, ResponseContext } from './router.ts';

export type { RequestContext, ResponseContext };

// --- Schema Types ---

export type FieldValidationRule =
  | { type: 'string'; minLength?: number; maxLength?: number; pattern?: string; enum?: string[] }
  | { type: 'number'; min?: number; max?: number; integer?: boolean }
  | { type: 'boolean' }
  | { type: 'array'; items?: FieldValidationRule; minItems?: number; maxItems?: number }
  | { type: 'object'; properties?: Record<string, FieldValidationRule>; required?: string[] }
  | { type: 'any' };

export interface HeaderRule {
  required?: boolean;
  pattern?: string;
  values?: string[];
  customMessage?: string;
}

export interface QueryParamRule extends FieldValidationRule {
  required?: boolean;
  customMessage?: string;
}

export interface PathParamRule extends FieldValidationRule {
  customMessage?: string;
}

export interface FileUploadRule {
  maxSizeBytes?: number;
  allowedTypes?: string[];
  maxCount?: number;
  customMessage?: string;
}

export interface RequestSchema {
  body?: FieldValidationRule;
  headers?: Record<string, HeaderRule>;
  query?: Record<string, QueryParamRule>;
  pathParams?: Record<string, PathParamRule>;
  contentType?: string[];
  fileUpload?: FileUploadRule;
}

export interface ValidationError {
  field: string;
  message: string;
  value?: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  response?: ResponseContext;
}

export interface IncomingRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
  params?: Record<string, string>;
  files?: { name: string; size: number; type: string }[];
}

export class RequestValidator {
  validateRequest(request: IncomingRequest, schema: RequestSchema): ValidationResult {
    const errors: ValidationError[] = [];

    // Validate Content-Type
    if (schema.contentType && schema.contentType.length > 0) {
      const ct = request.headers['content-type'] || '';
      const matched = schema.contentType.some(
        (allowed) => ct.toLowerCase().startsWith(allowed.toLowerCase())
      );
      if (!matched) {
        errors.push({
          field: 'content-type',
          message: `Content-Type must be one of: ${schema.contentType.join(', ')}`,
          value: ct,
        });
      }
    }

    // Validate headers
    if (schema.headers) {
      for (const [name, rule] of Object.entries(schema.headers)) {
        const value = request.headers[name.toLowerCase()];
        if (rule.required && (value === undefined || value === '')) {
          errors.push({
            field: `header:${name}`,
            message: rule.customMessage || `Header '${name}' is required`,
          });
          continue;
        }
        if (value !== undefined) {
          if (rule.pattern && !new RegExp(rule.pattern).test(value)) {
            errors.push({
              field: `header:${name}`,
              message: rule.customMessage || `Header '${name}' does not match pattern ${rule.pattern}`,
              value,
            });
          }
          if (rule.values && !rule.values.includes(value)) {
            errors.push({
              field: `header:${name}`,
              message: rule.customMessage || `Header '${name}' must be one of: ${rule.values.join(', ')}`,
              value,
            });
          }
        }
      }
    }

    // Validate query parameters
    if (schema.query) {
      for (const [name, rule] of Object.entries(schema.query)) {
        const value = request.query?.[name];
        if (rule.required && (value === undefined || value === '')) {
          errors.push({
            field: `query:${name}`,
            message: (rule as any).customMessage || `Query parameter '${name}' is required`,
          });
          continue;
        }
        if (value !== undefined) {
          const fieldErrors = this.validateField(value, name, rule as FieldValidationRule);
          errors.push(...fieldErrors);
        }
      }
    }

    // Validate path parameters
    if (schema.pathParams && request.params) {
      for (const [name, rule] of Object.entries(schema.pathParams)) {
        const value = request.params[name];
        if (value !== undefined) {
          const fieldErrors = this.validateField(value, name, rule as FieldValidationRule);
          if (rule.customMessage && fieldErrors.length > 0) {
            fieldErrors[0].message = rule.customMessage;
          }
          errors.push(...fieldErrors);
        }
      }
    }

    // Validate body
    if (schema.body && request.body !== undefined) {
      const bodyErrors = this.validateField(request.body, 'body', schema.body);
      errors.push(...bodyErrors);
    } else if (schema.body && request.body === undefined) {
      errors.push({
        field: 'body',
        message: 'Request body is required',
      });
    }

    // Validate file uploads
    if (schema.fileUpload && request.files) {
      const rule = schema.fileUpload;
      if (rule.maxCount && request.files.length > rule.maxCount) {
        errors.push({
          field: 'files',
          message: rule.customMessage || `Maximum ${rule.maxCount} files allowed, got ${request.files.length}`,
        });
      }
      for (const file of request.files) {
        if (rule.maxSizeBytes && file.size > rule.maxSizeBytes) {
          errors.push({
            field: `file:${file.name}`,
            message: rule.customMessage || `File '${file.name}' exceeds maximum size of ${rule.maxSizeBytes} bytes`,
            value: file.size,
          });
        }
        if (rule.allowedTypes && !rule.allowedTypes.includes(file.type)) {
          errors.push({
            field: `file:${file.name}`,
            message: rule.customMessage || `File '${file.name}' has invalid type '${file.type}'. Allowed: ${rule.allowedTypes.join(', ')}`,
            value: file.type,
          });
        }
      }
    }

    if (errors.length > 0) {
      return {
        valid: false,
        errors,
        response: this.createErrorResponse(errors),
      };
    }

    return { valid: true, errors: [] };
  }

  private validateField(value: unknown, fieldName: string, rule: FieldValidationRule): ValidationError[] {
    const errors: ValidationError[] = [];

    switch (rule.type) {
      case 'string': {
        if (typeof value !== 'string') {
          errors.push({ field: fieldName, message: `Field '${fieldName}' must be a string`, value });
          break;
        }
        if (rule.minLength !== undefined && value.length < rule.minLength) {
          errors.push({
            field: fieldName,
            message: `Field '${fieldName}' must be at least ${rule.minLength} characters`,
            value,
          });
        }
        if (rule.maxLength !== undefined && value.length > rule.maxLength) {
          errors.push({
            field: fieldName,
            message: `Field '${fieldName}' must be at most ${rule.maxLength} characters`,
            value,
          });
        }
        if (rule.pattern && !new RegExp(rule.pattern).test(value)) {
          errors.push({
            field: fieldName,
            message: `Field '${fieldName}' does not match pattern ${rule.pattern}`,
            value,
          });
        }
        if (rule.enum && !rule.enum.includes(value)) {
          errors.push({
            field: fieldName,
            message: `Field '${fieldName}' must be one of: ${rule.enum.join(', ')}`,
            value,
          });
        }
        break;
      }
      case 'number': {
        const num = Number(value);
        if (isNaN(num)) {
          errors.push({ field: fieldName, message: `Field '${fieldName}' must be a number`, value });
          break;
        }
        if (rule.integer && !Number.isInteger(num)) {
          errors.push({ field: fieldName, message: `Field '${fieldName}' must be an integer`, value });
        }
        if (rule.min !== undefined && num < rule.min) {
          errors.push({ field: fieldName, message: `Field '${fieldName}' must be at least ${rule.min}`, value });
        }
        if (rule.max !== undefined && num > rule.max) {
          errors.push({ field: fieldName, message: `Field '${fieldName}' must be at most ${rule.max}`, value });
        }
        break;
      }
      case 'boolean': {
        if (typeof value !== 'boolean') {
          errors.push({ field: fieldName, message: `Field '${fieldName}' must be a boolean`, value });
        }
        break;
      }
      case 'array': {
        if (!Array.isArray(value)) {
          errors.push({ field: fieldName, message: `Field '${fieldName}' must be an array`, value });
          break;
        }
        if (rule.minItems !== undefined && value.length < rule.minItems) {
          errors.push({
            field: fieldName,
            message: `Field '${fieldName}' must have at least ${rule.minItems} items`,
            value,
          });
        }
        if (rule.maxItems !== undefined && value.length > rule.maxItems) {
          errors.push({
            field: fieldName,
            message: `Field '${fieldName}' must have at most ${rule.maxItems} items`,
            value,
          });
        }
        if (rule.items) {
          value.forEach((item, i) => {
            const itemErrors = this.validateField(item, `${fieldName}[${i}]`, rule.items!);
            errors.push(...itemErrors);
          });
        }
        break;
      }
      case 'object': {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          errors.push({ field: fieldName, message: `Field '${fieldName}' must be an object`, value });
          break;
        }
        const obj = value as Record<string, unknown>;
        if (rule.required) {
          for (const req of rule.required) {
            if (obj[req] === undefined) {
              errors.push({ field: `${fieldName}.${req}`, message: `Field '${fieldName}.${req}' is required` });
            }
          }
        }
        if (rule.properties) {
          for (const [propName, propRule] of Object.entries(rule.properties)) {
            if (obj[propName] !== undefined) {
              const propErrors = this.validateField(obj[propName], `${fieldName}.${propName}`, propRule);
              errors.push(...propErrors);
            }
          }
        }
        break;
      }
      case 'any':
        // Any type is valid
        break;
    }

    return errors;
  }

  private createErrorResponse(errors: ValidationError[]): ResponseContext {
    return {
      status: 400,
      body: {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: errors,
        },
      },
    };
  }
}
