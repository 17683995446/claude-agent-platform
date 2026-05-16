// src/input-validator.ts - 输入验证与净化

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  sanitizedValue?: unknown;
  warnings?: string[];
}

export interface ValidationSchema {
  type?: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  email?: boolean;
  url?: boolean;
  uuid?: boolean;
  integer?: boolean;
  positive?: boolean;
  uniqueItems?: boolean;
  requiredFields?: string[];
  nested?: Record<string, ValidationSchema>;
  custom?: (value: unknown) => string | null;
  defaultValue?: unknown;
  enum?: unknown[];
}

export interface SanitizationResult {
  sanitized: string;
  changes: string[];
}

export class InputValidator {
  private errors: string[] = [];
  private warnings: string[] = [];
  private value: unknown;

  constructor(value: unknown) {
    this.value = value;
  }

  /**
   * Create a new validator for the given value
   */
  static for(value: unknown): InputValidator {
    return new InputValidator(value);
  }

  /**
   * Validate that the value is a string
   */
  isString(): this {
    if (typeof this.value !== 'string') {
      this.errors.push(`Expected string, got ${typeof this.value}`);
    }
    return this;
  }

  /**
   * Validate minimum string length
   */
  minLength(min: number): this {
    if (typeof this.value === 'string' && this.value.length < min) {
      this.errors.push(`String length ${this.value.length} is less than minimum ${min}`);
    }
    return this;
  }

  /**
   * Validate maximum string length
   */
  maxLength(max: number): this {
    if (typeof this.value === 'string' && this.value.length > max) {
      this.errors.push(`String length ${this.value.length} exceeds maximum ${max}`);
    }
    return this;
  }

  /**
   * Validate against a regex pattern
   */
  matches(pattern: RegExp): this {
    if (typeof this.value === 'string' && !pattern.test(this.value)) {
      this.errors.push(`Value does not match pattern ${pattern.toString()}`);
    }
    return this;
  }

  /**
   * Validate that the value is a valid email
   */
  isEmail(): this {
    if (typeof this.value === 'string') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(this.value)) {
        this.errors.push(`"${this.value}" is not a valid email address`);
      }
    }
    return this;
  }

  /**
   * Validate that the value is a valid URL
   */
  isURL(): this {
    if (typeof this.value === 'string') {
      try {
        new URL(this.value);
      } catch {
        this.errors.push(`"${this.value}" is not a valid URL`);
      }
    }
    return this;
  }

  /**
   * Validate that the value is a valid UUID
   */
  isUUID(): this {
    if (typeof this.value === 'string') {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(this.value)) {
        this.errors.push(`"${this.value}" is not a valid UUID`);
      }
    }
    return this;
  }

  /**
   * Validate that the value is a number
   */
  isNumber(): this {
    if (typeof this.value !== 'number' || isNaN(this.value)) {
      this.errors.push(`Expected number, got ${typeof this.value}`);
    }
    return this;
  }

  /**
   * Validate minimum number value
   */
  min(minVal: number): this {
    if (typeof this.value === 'number' && this.value < minVal) {
      this.errors.push(`Value ${this.value} is less than minimum ${minVal}`);
    }
    return this;
  }

  /**
   * Validate maximum number value
   */
  max(maxVal: number): this {
    if (typeof this.value === 'number' && this.value > maxVal) {
      this.errors.push(`Value ${this.value} exceeds maximum ${maxVal}`);
    }
    return this;
  }

  /**
   * Validate that the value is an integer
   */
  isInteger(): this {
    if (typeof this.value === 'number' && !Number.isInteger(this.value)) {
      this.errors.push(`Value ${this.value} is not an integer`);
    }
    return this;
  }

  /**
   * Validate that the value is positive
   */
  isPositive(): this {
    if (typeof this.value === 'number' && this.value <= 0) {
      this.errors.push(`Value ${this.value} is not positive`);
    }
    return this;
  }

  /**
   * Validate that the value is an array
   */
  isArray(): this {
    if (!Array.isArray(this.value)) {
      this.errors.push(`Expected array, got ${typeof this.value}`);
    }
    return this;
  }

  /**
   * Validate minimum array length
   */
  minItems(min: number): this {
    if (Array.isArray(this.value) && this.value.length < min) {
      this.errors.push(`Array length ${this.value.length} is less than minimum ${min}`);
    }
    return this;
  }

  /**
   * Validate maximum array length
   */
  maxItems(max: number): this {
    if (Array.isArray(this.value) && this.value.length > max) {
      this.errors.push(`Array length ${this.value.length} exceeds maximum ${max}`);
    }
    return this;
  }

  /**
   * Validate that array items are unique
   */
  uniqueItems(): this {
    if (Array.isArray(this.value)) {
      const seen = new Set();
      for (const item of this.value) {
        const key = JSON.stringify(item);
        if (seen.has(key)) {
          this.errors.push(`Array contains duplicate item: ${key}`);
          break;
        }
        seen.add(key);
      }
    }
    return this;
  }

  /**
   * Validate that the value is an object
   */
  isObject(): this {
    if (typeof this.value !== 'object' || this.value === null || Array.isArray(this.value)) {
      this.errors.push(`Expected object, got ${typeof this.value}`);
    }
    return this;
  }

  /**
   * Validate that an object has required fields
   */
  requiredFields(fields: string[]): this {
    if (typeof this.value === 'object' && this.value !== null && !Array.isArray(this.value)) {
      const obj = this.value as Record<string, unknown>;
      for (const field of fields) {
        if (!(field in obj) || obj[field] === undefined || obj[field] === null) {
          this.errors.push(`Missing required field: ${field}`);
        }
      }
    }
    return this;
  }

  /**
   * Validate nested object fields
   */
  nested(nestedSchema: Record<string, ValidationSchema>): this {
    if (typeof this.value === 'object' && this.value !== null && !Array.isArray(this.value)) {
      const obj = this.value as Record<string, unknown>;
      for (const [field, schema] of Object.entries(nestedSchema)) {
        const fieldValidator = InputValidator.for(obj[field]);
        fieldValidator.applySchema(schema);
        if (!fieldValidator.isValid()) {
          for (const err of fieldValidator.getErrors()) {
            this.errors.push(`${field}: ${err}`);
          }
        }
      }
    }
    return this;
  }

  /**
   * Validate that value is one of allowed values
   */
  isOneOf(allowed: unknown[]): this {
    if (!allowed.includes(this.value)) {
      this.errors.push(`Value "${this.value}" is not one of: ${allowed.join(', ')}`);
    }
    return this;
  }

  /**
   * Add a custom validation
   */
  custom(validator: (value: unknown) => string | null): this {
    const error = validator(this.value);
    if (error) {
      this.errors.push(error);
    }
    return this;
  }

  /**
   * Apply a validation schema
   */
  applySchema(schema: ValidationSchema): this {
    // Check required
    if (schema.required && (this.value === undefined || this.value === null)) {
      this.errors.push('Value is required');
      return this;
    }

    // Skip further validation if not required and value is empty
    if (this.value === undefined || this.value === null) {
      return this;
    }

    // Type validation
    if (schema.type === 'string') this.isString();
    if (schema.type === 'number') this.isNumber();
    if (schema.type === 'array') this.isArray();
    if (schema.type === 'object') this.isObject();

    // String validations
    if (schema.minLength !== undefined) this.minLength(schema.minLength);
    if (schema.maxLength !== undefined) this.maxLength(schema.maxLength);
    if (schema.pattern) this.matches(schema.pattern);
    if (schema.email) this.isEmail();
    if (schema.url) this.isURL();
    if (schema.uuid) this.isUUID();

    // Number validations
    if (schema.min !== undefined) this.min(schema.min);
    if (schema.max !== undefined) this.max(schema.max);
    if (schema.integer) this.isInteger();
    if (schema.positive) this.isPositive();

    // Array validations
    if (schema.uniqueItems) this.uniqueItems();

    // Object validations
    if (schema.requiredFields) this.requiredFields(schema.requiredFields);
    if (schema.nested) this.nested(schema.nested);

    // Enum validation
    if (schema.enum) this.isOneOf(schema.enum);

    // Custom validation
    if (schema.custom) this.custom(schema.custom);

    return this;
  }

  /**
   * Check if validation passed
   */
  isValid(): boolean {
    return this.errors.length === 0;
  }

  /**
   * Get all validation errors
   */
  getErrors(): string[] {
    return [...this.errors];
  }

  /**
   * Get all warnings
   */
  getWarnings(): string[] {
    return [...this.warnings];
  }

  /**
   * Get the validation result
   */
  getResult(): ValidationResult {
    return {
      valid: this.errors.length === 0,
      errors: [...this.errors],
      sanitizedValue: this.value,
      warnings: this.warnings.length > 0 ? [...this.warnings] : undefined,
    };
  }

  /**
   * Sanitize HTML - strip dangerous tags and attributes
   */
  static sanitizeHTML(input: string): string {
    let result = input;

    // Remove script tags and their content
    result = result.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

    // Remove event handler attributes
    result = result.replace(/\s*on\w+\s*=\s*(['"])[^'"]*\1/gi, '');
    result = result.replace(/\s*on\w+\s*=\s*\S+/gi, '');

    // Remove javascript: URLs
    result = result.replace(/href\s*=\s*(['"])javascript:[^'"]*\1/gi, 'href="#"');
    result = result.replace(/src\s*=\s*(['"])javascript:[^'"]*\1/gi, 'src=""');

    // Remove data: URLs in src attributes
    result = result.replace(/src\s*=\s*(['"])data:[^'"]*\1/gi, 'src=""');

    // Remove iframe, object, embed, form tags (including closing tags)
    result = result.replace(/<\/?(iframe|object|embed|form|base|link|meta)\b[^>]*\/?>/gi, '');

    // Remove style tags
    result = result.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

    return result;
  }

  /**
   * Sanitize SQL input - escape SQL special characters
   */
  static sanitizeSQL(input: string): string {
    return input
      .replace(/'/g, "''")
      .replace(/\\/g, '\\\\')
      .replace(/\0/g, '\\0')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\x1a/g, '\\Z');
  }

  /**
   * Sanitize file path - normalize and validate against traversal
   */
  static sanitizePath(input: string): string {
    // Normalize path separators
    let normalized = input.replace(/\\/g, '/');

    // Remove null bytes
    normalized = normalized.replace(/\0/g, '');

    // Collapse multiple slashes
    normalized = normalized.replace(/\/+/g, '/');

    // Remove leading/trailing whitespace
    normalized = normalized.trim();

    // Remove path traversal sequences
    const parts = normalized.split('/');
    const safeParts: string[] = [];
    for (const part of parts) {
      if (part === '..') {
        // Don't allow going up
        continue;
      }
      if (part === '.' || part === '') {
        continue;
      }
      safeParts.push(part);
    }

    return '/' + safeParts.join('/');
  }

  /**
   * Sanitize command input - escape shell metacharacters
   */
  static sanitizeCommand(input: string): string {
    return input
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\|/g, '\\|')
      .replace(/;/g, '\\;')
      .replace(/&/g, '\\&')
      .replace(/</g, '\\<')
      .replace(/>/g, '\\>')
      .replace(/!/g, '\\!')
      .replace(/\n/g, ' ')
      .replace(/\r/g, ' ')
      .replace(/\t/g, ' ');
  }

  /**
   * Validate and sanitize input against a schema
   */
  static validateAndSanitize(input: unknown, schema: ValidationSchema): ValidationResult {
    const validator = InputValidator.for(input);
    validator.applySchema(schema);
    return validator.getResult();
  }
}
