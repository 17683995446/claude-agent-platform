// src/data-schema.ts - Data Schema Manager Module
// Schema definition, validation, evolution, versioning, and migration

export interface SchemaField {
  type: 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object' | 'any';
  required?: boolean;
  default?: unknown;
  description?: string;
  constraints?: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    enum?: unknown[];
    items?: SchemaDefinition; // for array items
    fields?: Record<string, SchemaField>; // for object fields
  };
}

export interface SchemaDefinition {
  name: string;
  version: string;
  fields: Record<string, SchemaField>;
  description?: string;
}

export interface SchemaDiff {
  added: string[];
  removed: string[];
  changed: Array<{ field: string; from: SchemaField; to: SchemaField; breaking: boolean }>;
  versionFrom: string;
  versionTo: string;
}

export interface MigrationStep {
  type: 'add_field' | 'remove_field' | 'rename_field' | 'change_type' | 'transform';
  field?: string;
  from?: string;
  to?: string;
  newType?: string;
  transform?: (data: any) => any;
  defaultValue?: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ field: string; message: string; value: unknown }>;
}

export class DataSchemaManager {
  private schemas: Map<string, Map<string, SchemaDefinition>> = new Map(); // name -> version -> schema
  private migrations: Map<string, MigrationStep[]> = new Map(); // "from:to" -> steps

  /**
   * Define a new schema
   */
  define(name: string, schema: SchemaDefinition): void {
    if (!this.schemas.has(name)) {
      this.schemas.set(name, new Map());
    }
    this.schemas.get(name)!.set(schema.version, schema);
  }

  /**
   * Validate data against a named schema
   */
  validate(data: unknown, schemaName: string, version?: string): ValidationResult {
    const versionMap = this.schemas.get(schemaName);
    if (!versionMap) {
      return { valid: false, errors: [{ field: '', message: `Schema "${schemaName}" not found`, value: data }] };
    }

    const schemaVersion = version ?? this.getLatestVersion(schemaName);
    const schema = versionMap.get(schemaVersion);

    if (!schema) {
      return { valid: false, errors: [{ field: '', message: `Version "${schemaVersion}" not found`, value: data }] };
    }

    return this.validateAgainstSchema(data, schema);
  }

  /**
   * Migrate data from one schema version to another
   */
  migrate(data: unknown, schemaName: string, from: string, to: string): unknown {
    const migrationKey = `${schemaName}:${from}:${to}`;

    // Check for direct migration
    let steps = this.migrations.get(migrationKey);

    if (!steps) {
      // Try to find a path through intermediate versions
      steps = this.findMigrationPath(schemaName, from, to);
    }

    if (!steps) {
      throw new Error(`No migration path found from ${from} to ${to} for schema ${schemaName}`);
    }

    let result = data;
    for (const step of steps) {
      result = this.applyMigrationStep(result, step);
    }

    return result;
  }

  /**
   * Compute diff between two schema versions
   */
  diff(schemaName: string, version1: string, version2: string): SchemaDiff {
    const versionMap = this.schemas.get(schemaName);
    if (!versionMap) {
      return { added: [], removed: [], changed: [], versionFrom: version1, versionTo: version2 };
    }

    const schema1 = versionMap.get(version1);
    const schema2 = versionMap.get(version2);

    if (!schema1 || !schema2) {
      return { added: [], removed: [], changed: [], versionFrom: version1, versionTo: version2 };
    }

    const fields1 = new Set(Object.keys(schema1.fields));
    const fields2 = new Set(Object.keys(schema2.fields));

    const added = [...fields2].filter(f => !fields1.has(f));
    const removed = [...fields1].filter(f => !fields2.has(f));
    const changed: SchemaDiff['changed'] = [];

    for (const field of fields1) {
      if (fields2.has(field)) {
        const f1 = schema1.fields[field];
        const f2 = schema2.fields[field];
        if (f1.type !== f2.type) {
          changed.push({
            field,
            from: f1,
            to: f2,
            breaking: !this.isCompatibleType(f1.type, f2.type),
          });
        }
      }
    }

    return { added, removed, changed, versionFrom: version1, versionTo: version2 };
  }

  /**
   * Register a migration between versions
   */
  registerMigration(schemaName: string, from: string, to: string, steps: MigrationStep[]): void {
    this.migrations.set(`${schemaName}:${from}:${to}`, steps);
  }

  /**
   * Get the latest version of a schema
   */
  getLatestVersion(schemaName: string): string {
    const versionMap = this.schemas.get(schemaName);
    if (!versionMap || versionMap.size === 0) {
      throw new Error(`Schema "${schemaName}" not found`);
    }

    const versions = [...versionMap.keys()].sort(semverCompare);
    return versions[versions.length - 1];
  }

  /**
   * List all versions of a schema
   */
  getVersions(schemaName: string): string[] {
    const versionMap = this.schemas.get(schemaName);
    if (!versionMap) return [];
    return [...versionMap.keys()].sort(semverCompare);
  }

  /**
   * Get a schema definition
   */
  getSchema(schemaName: string, version: string): SchemaDefinition | undefined {
    return this.schemas.get(schemaName)?.get(version);
  }

  // --- Private methods ---

  private validateAgainstSchema(data: unknown, schema: SchemaDefinition): ValidationResult {
    const errors: ValidationResult['errors'] = [];

    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return { valid: false, errors: [{ field: '', message: 'Expected object', value: data }] };
    }

    const obj = data as Record<string, unknown>;

    for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
      const value = obj[fieldName];

      // Required check
      if (fieldDef.required && (value === undefined || value === null)) {
        errors.push({ field: fieldName, message: `Field "${fieldName}" is required`, value });
        continue;
      }

      // Skip validation if not required and value is null/undefined
      if (value === undefined || value === null) continue;

      // Type check
      const typeValid = this.checkType(value, fieldDef.type, fieldDef.constraints);
      if (!typeValid) {
        errors.push({ field: fieldName, message: `Field "${fieldName}" expected type ${fieldDef.type}`, value });
        continue;
      }

      // Constraint checks
      if (fieldDef.constraints) {
        this.checkConstraints(value, fieldDef.constraints, fieldName, errors);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  private checkType(value: unknown, type: string, constraints?: SchemaField['constraints']): boolean {
    switch (type) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'date':
        return value instanceof Date || (!isNaN(Date.parse(value as string)));
      case 'array':
        return Array.isArray(value);
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      case 'any':
        return true;
      default:
        return true;
    }
  }

  private checkConstraints(
    value: unknown,
    constraints: NonNullable<SchemaField['constraints']>,
    fieldName: string,
    errors: ValidationResult['errors']
  ): void {
    if (typeof value === 'string') {
      if (constraints.minLength !== undefined && value.length < constraints.minLength) {
        errors.push({ field: fieldName, message: `Minimum length ${constraints.minLength}`, value });
      }
      if (constraints.maxLength !== undefined && value.length > constraints.maxLength) {
        errors.push({ field: fieldName, message: `Maximum length ${constraints.maxLength}`, value });
      }
      if (constraints.pattern) {
        if (!new RegExp(constraints.pattern).test(value)) {
          errors.push({ field: fieldName, message: `Does not match pattern`, value });
        }
      }
      if (constraints.enum && !constraints.enum.includes(value)) {
        errors.push({ field: fieldName, message: `Not in enum`, value });
      }
    }

    if (typeof value === 'number') {
      if (constraints.min !== undefined && value < constraints.min) {
        errors.push({ field: fieldName, message: `Minimum value ${constraints.min}`, value });
      }
      if (constraints.max !== undefined && value > constraints.max) {
        errors.push({ field: fieldName, message: `Maximum value ${constraints.max}`, value });
      }
    }
  }

  private applyMigrationStep(data: unknown, step: MigrationStep): unknown {
    if (typeof data !== 'object' || data === null) return data;
    const obj = { ...(data as Record<string, unknown>) };

    switch (step.type) {
      case 'add_field':
        if (step.field) {
          obj[step.field] = step.defaultValue ?? null;
        }
        break;
      case 'remove_field':
        if (step.field) {
          delete obj[step.field];
        }
        break;
      case 'rename_field':
        if (step.from && step.to) {
          obj[step.to] = obj[step.from];
          delete obj[step.from];
        }
        break;
      case 'change_type':
        if (step.field && step.newType) {
          const current = obj[step.field];
          switch (step.newType) {
            case 'string': obj[step.field] = String(current); break;
            case 'number': obj[step.field] = Number(current); break;
            case 'boolean': obj[step.field] = Boolean(current); break;
          }
        }
        break;
      case 'transform':
        if (step.transform) {
          return step.transform(data);
        }
        break;
    }

    return obj;
  }

  private findMigrationPath(schemaName: string, from: string, to: string): MigrationStep[] | undefined {
    const versionMap = this.schemas.get(schemaName);
    if (!versionMap) return undefined;

    const versions = [...versionMap.keys()].sort(semverCompare);
    const fromIdx = versions.indexOf(from);
    const toIdx = versions.indexOf(to);

    if (fromIdx === -1 || toIdx === -1) return undefined;

    const allSteps: MigrationStep[] = [];
    const direction = fromIdx < toIdx ? 1 : -1;

    for (let i = fromIdx; i !== toIdx; i += direction) {
      const v1 = versions[i];
      const v2 = versions[i + direction];
      const key = `${schemaName}:${v1}:${v2}`;
      const steps = this.migrations.get(key);
      if (steps) {
        allSteps.push(...steps);
      }
    }

    return allSteps.length > 0 ? allSteps : undefined;
  }

  private isCompatibleType(from: string, to: string): boolean {
    const compatible: Record<string, Set<string>> = {
      string: new Set(['string', 'any']),
      number: new Set(['number', 'any']),
      boolean: new Set(['boolean', 'any']),
      date: new Set(['date', 'string', 'any']),
      array: new Set(['array', 'any']),
      object: new Set(['object', 'any']),
      any: new Set(['string', 'number', 'boolean', 'date', 'array', 'object', 'any']),
    };
    return compatible[from]?.has(to) ?? false;
  }
}

function semverCompare(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);

  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }

  return 0;
}
