// src/data-validator.ts - Data Validator Module
// Declarative validation with nested objects, arrays, and cross-field support

export interface ValidationError {
  path: string;
  message: string;
  value: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationRule {
  name: string;
  validate: (value: unknown, data?: unknown) => boolean | Promise<boolean>;
  message?: string;
}

export type ValidationSchema =
  | { type: 'object'; fields: Record<string, ValidationSchema>; required?: string[]; crossField?: CrossFieldRule[] }
  | { type: 'array'; items: ValidationSchema; minLength?: number; maxLength?: number }
  | { type: 'string'; minLength?: number; maxLength?: number; pattern?: string; enum?: unknown[] }
  | { type: 'number'; min?: number; max?: number }
  | { type: 'boolean' }
  | { type: 'any' }
  | { type: 'union'; schemas: ValidationSchema[] }
  | { type: 'intersection'; schemas: ValidationSchema[] }
  | { type: 'partial'; schema: ValidationSchema }
  | ValidationRuleFn;

export interface ValidationRuleFn {
  validate: (value: unknown, data?: unknown) => boolean | Promise<boolean>;
  message: string;
}

export interface CrossFieldRule {
  fields: string[];
  validate: (values: Record<string, unknown>, data: unknown) => boolean;
  message: string;
}

export class DataValidator {
  private customRules: Map<string, ValidationRule> = new Map();

  /**
   * Validate data against a schema
   */
  async validate(data: unknown, schema: ValidationSchema): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    await this.validateField(data, schema, '', errors, data);
    return { valid: errors.length === 0, errors };
  }

  private async validateField(
    value: unknown,
    schema: ValidationSchema,
    path: string,
    errors: ValidationError[],
    rootData: unknown
  ): Promise<void> {
    // Custom rule function
    if (typeof schema === 'object' && 'validate' in schema && typeof (schema as any).validate === 'function') {
      const ruleFn = schema as ValidationRuleFn;
      const valid = await ruleFn.validate(value, rootData);
      if (!valid) {
        errors.push({ path: path || '$', message: ruleFn.message, value });
      }
      return;
    }

    const s = schema as any;

    // Union type
    if (s.type === 'union') {
      let anyValid = false;
      for (const subSchema of s.schemas) {
        const subErrors: ValidationError[] = [];
        await this.validateField(value, subSchema, path, subErrors, rootData);
        if (subErrors.length === 0) {
          anyValid = true;
          break;
        }
      }
      if (!anyValid) {
        errors.push({ path: path || '$', message: `Value does not match any union schema`, value });
      }
      return;
    }

    // Intersection type
    if (s.type === 'intersection') {
      for (const subSchema of s.schemas) {
        await this.validateField(value, subSchema, path, errors, rootData);
      }
      return;
    }

    // Partial type
    if (s.type === 'partial') {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const partialSchema: ValidationSchema = { ...s.schema, required: [] };
        await this.validateField(value, partialSchema, path, errors, rootData);
      }
      return;
    }

    // Any type
    if (s.type === 'any') return;

    // Type checking
    if (s.type === 'string') {
      if (typeof value !== 'string') {
        errors.push({ path: path || '$', message: `Expected string, got ${typeof value}`, value });
        return;
      }
      if (s.minLength !== undefined && value.length < s.minLength) {
        errors.push({ path, message: `Minimum length is ${s.minLength}`, value });
      }
      if (s.maxLength !== undefined && value.length > s.maxLength) {
        errors.push({ path, message: `Maximum length is ${s.maxLength}`, value });
      }
      if (s.pattern) {
        const regex = new RegExp(s.pattern);
        if (!regex.test(value)) {
          errors.push({ path, message: `Does not match pattern ${s.pattern}`, value });
        }
      }
      if (s.enum && !s.enum.includes(value)) {
        errors.push({ path, message: `Value not in enum: [${s.enum.join(', ')}]`, value });
      }
      return;
    }

    if (s.type === 'number') {
      if (typeof value !== 'number' || isNaN(value)) {
        errors.push({ path: path || '$', message: `Expected number, got ${typeof value}`, value });
        return;
      }
      if (s.min !== undefined && value < s.min) {
        errors.push({ path, message: `Minimum value is ${s.min}`, value });
      }
      if (s.max !== undefined && value > s.max) {
        errors.push({ path, message: `Maximum value is ${s.max}`, value });
      }
      return;
    }

    if (s.type === 'boolean') {
      if (typeof value !== 'boolean') {
        errors.push({ path: path || '$', message: `Expected boolean, got ${typeof value}`, value });
      }
      return;
    }

    if (s.type === 'array') {
      if (!Array.isArray(value)) {
        errors.push({ path: path || '$', message: `Expected array, got ${typeof value}`, value });
        return;
      }
      if (s.minLength !== undefined && value.length < s.minLength) {
        errors.push({ path, message: `Minimum array length is ${s.minLength}`, value });
      }
      if (s.maxLength !== undefined && value.length > s.maxLength) {
        errors.push({ path, message: `Maximum array length is ${s.maxLength}`, value });
      }
      if (s.items) {
        for (let i = 0; i < value.length; i++) {
          await this.validateField(value[i], s.items, `${path}[${i}]`, errors, rootData);
        }
      }
      return;
    }

    if (s.type === 'object') {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        errors.push({ path: path || '$', message: `Expected object, got ${typeof value}`, value });
        return;
      }

      const requiredFields = s.required ?? [];
      for (const field of requiredFields) {
        if (!(field in value)) {
          errors.push({ path: `${path}.${field}`, message: `Required field "${field}" is missing`, value: undefined });
        }
      }

      for (const [field, fieldSchema] of Object.entries(s.fields)) {
        if (field in value) {
          await this.validateField((value as any)[field], fieldSchema, `${path}.${field}`, errors, rootData);
        }
      }

      // Cross-field validation
      if (s.crossField) {
        for (const rule of s.crossField) {
          const values: Record<string, unknown> = {};
          for (const f of rule.fields) {
            values[f] = (value as any)[f];
          }
          if (!rule.validate(values, rootData)) {
            errors.push({ path, message: rule.message, value });
          }
        }
      }
      return;
    }
  }

  /**
   * Add a custom validation rule
   */
  addRule(name: string, rule: ValidationRule): void {
    this.customRules.set(name, rule);
  }

  /**
   * Create an intersection schema (all must pass)
   */
  intersection(...schemas: ValidationSchema[]): ValidationSchema {
    return { type: 'intersection', schemas };
  }

  /**
   * Create a union schema (any must pass)
   */
  union(...schemas: ValidationSchema[]): ValidationSchema {
    return { type: 'union', schemas };
  }

  /**
   * Create a partial schema (all fields optional)
   */
  partial(schema: ValidationSchema): ValidationSchema {
    return { type: 'partial', schema };
  }
}
