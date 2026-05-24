/**
 * 配置验证模块
 * 支持类型检查、约束检查、必填验证、自定义验证和跨字段验证
 */

export type ConfigType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any';

export interface ConfigSchema {
  type?: ConfigType;
  required?: boolean;
  default?: unknown;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp | string;
  enum?: unknown[];
  custom?: (value: unknown) => string | null;
  message?: string;
  coerce?: boolean;
  dependencies?: Record<string, (value: unknown, allValues: Record<string, unknown>) => string | null>;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  value: unknown;
}

export interface ValidationError {
  path: string;
  message: string;
  constraint: string;
}

export interface ValidationReport {
  valid: boolean;
  results: Record<string, ValidationResult>;
  errors: ValidationError[];
}

/**
 * ConfigValidator - 配置验证器
 */
export class ConfigValidator {
  private schemas: Map<string, ConfigSchema> = new Map();

  /**
   * 注册配置 schema
   */
  registerSchema(path: string, schema: ConfigSchema): void {
    this.schemas.set(path, schema);
  }

  /**
   * 验证单个配置路径
   */
  validate(path: string, value: unknown, schema?: ConfigSchema): ValidationResult {
    const resolvedSchema = schema || this.schemas.get(path);
    if (!resolvedSchema) {
      return { valid: true, errors: [], value };
    }

    const errors: ValidationError[] = [];
    let finalValue = value;

    // Handle default values
    if (value === undefined && resolvedSchema.default !== undefined) {
      finalValue = resolvedSchema.default;
    }

    // Required check
    if (resolvedSchema.required && (finalValue === undefined || finalValue === null)) {
      errors.push({
        path,
        message: resolvedSchema.message || `Field "${path}" is required`,
        constraint: 'required',
      });
      return { valid: false, errors, value: finalValue };
    }

    // Skip further validation if value is undefined and not required
    if (finalValue === undefined) {
      return { valid: true, errors: [], value: finalValue };
    }

    // null values should still go through type checking (unless type is 'any')
    if (finalValue === null && (!resolvedSchema.type || resolvedSchema.type === 'any')) {
      return { valid: true, errors: [], value: finalValue };
    }

    // Type checking
    if (resolvedSchema.type && resolvedSchema.type !== 'any') {
      const typeError = this.checkType(path, finalValue, resolvedSchema.type);
      if (typeError) {
        // Try coercion first
        if (resolvedSchema.coerce) {
          const coerced = this.coerceValue(finalValue, resolvedSchema.type);
          if (coerced !== undefined) {
            finalValue = coerced;
          } else {
            errors.push(typeError);
          }
        } else {
          errors.push(typeError);
        }
      }
    }

    // Constraint checking
    if (resolvedSchema.type === 'number' || typeof finalValue === 'number') {
      if (resolvedSchema.min !== undefined && (finalValue as number) < resolvedSchema.min) {
        errors.push({
          path,
          message: `Value must be >= ${resolvedSchema.min}`,
          constraint: 'min',
        });
      }
      if (resolvedSchema.max !== undefined && (finalValue as number) > resolvedSchema.max) {
        errors.push({
          path,
          message: `Value must be <= ${resolvedSchema.max}`,
          constraint: 'max',
        });
      }
    }

    if (resolvedSchema.type === 'string' || typeof finalValue === 'string') {
      if (resolvedSchema.minLength !== undefined && (finalValue as string).length < resolvedSchema.minLength) {
        errors.push({
          path,
          message: `Length must be >= ${resolvedSchema.minLength}`,
          constraint: 'minLength',
        });
      }
      if (resolvedSchema.maxLength !== undefined && (finalValue as string).length > resolvedSchema.maxLength) {
        errors.push({
          path,
          message: `Length must be <= ${resolvedSchema.maxLength}`,
          constraint: 'maxLength',
        });
      }
      if (resolvedSchema.pattern) {
        const regex = typeof resolvedSchema.pattern === 'string'
          ? new RegExp(resolvedSchema.pattern)
          : resolvedSchema.pattern;
        if (!regex.test(finalValue as string)) {
          errors.push({
            path,
            message: `Value does not match pattern ${resolvedSchema.pattern}`,
            constraint: 'pattern',
          });
        }
      }
    }

    // Enum check
    if (resolvedSchema.enum && !resolvedSchema.enum.includes(finalValue)) {
      errors.push({
        path,
        message: `Value must be one of: ${resolvedSchema.enum.join(', ')}`,
        constraint: 'enum',
      });
    }

    // Custom validation
    if (resolvedSchema.custom) {
      const customError = resolvedSchema.custom(finalValue);
      if (customError) {
        errors.push({
          path,
          message: customError,
          constraint: 'custom',
        });
      }
    }

    return { valid: errors.length === 0, errors, value: finalValue };
  }

  /**
   * 批量验证多个配置
   */
  validateAll(
    values: Record<string, unknown>,
    schemas?: Record<string, ConfigSchema>,
  ): ValidationReport {
    const allSchemas = schemas || Object.fromEntries(this.schemas);
    const results: Record<string, ValidationResult> = {};
    const allErrors: ValidationError[] = [];

    for (const [path, schema] of Object.entries(allSchemas)) {
      const value = values[path];
      const result = this.validate(path, value, schema);
      results[path] = result;
      allErrors.push(...result.errors);
    }

    // Cross-field validation (dependencies)
    for (const [path, schema] of Object.entries(allSchemas)) {
      if (schema.dependencies) {
        for (const [depPath, depValidator] of Object.entries(schema.dependencies)) {
          const depError = depValidator(values[path], values);
          if (depError) {
            allErrors.push({
              path,
              message: depError,
              constraint: 'dependency',
            });
            if (results[path]) {
              results[path].valid = false;
              results[path].errors.push({
                path,
                message: depError,
                constraint: 'dependency',
              });
            }
          }
        }
      }
    }

    return {
      valid: allErrors.length === 0,
      results,
      errors: allErrors,
    };
  }

  /**
   * 获取已注册的所有 schema 路径
   */
  getSchemaPaths(): string[] {
    return Array.from(this.schemas.keys());
  }

  /**
   * 移除 schema
   */
  removeSchema(path: string): boolean {
    return this.schemas.delete(path);
  }

  private checkType(path: string, value: unknown, type: ConfigType): ValidationError | null {
    if (type === 'any') return null;

    // Special handling for null - reject it for all types except 'any'
    if (value === null) {
      return {
        path,
        message: `Expected type "${type}", got "null"`,
        constraint: 'type',
      };
    }

    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (actualType === type) {
      return null;
    }
    if (type === 'object' && actualType === 'object' && !Array.isArray(value)) return null;
    return {
      path,
      message: `Expected type "${type}", got "${actualType}"`,
      constraint: 'type',
    };
  }

  private coerceValue(value: unknown, type: ConfigType): unknown {
    if (value === undefined || value === null) return undefined;
    try {
      switch (type) {
        case 'number': {
          const num = Number(value);
          // Return undefined if coercion results in NaN (and value wasn't 'NaN')
          if (isNaN(num) && value !== 'NaN') return undefined;
          return num;
        }
        case 'boolean':
          if (value === 'true') return true;
          if (value === 'false') return false;
          return Boolean(value);
        case 'string':
          return String(value);
        case 'object':
          if (typeof value === 'string') return JSON.parse(value);
          return value;
        default:
          return undefined;
      }
    } catch {
      return undefined;
    }
  }
}
