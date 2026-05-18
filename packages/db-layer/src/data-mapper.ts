// ============================================================
// Module 6: Data Mapper
// ============================================================

export type RelationType = 'one-to-one' | 'one-to-many' | 'many-to-many';

export interface ColumnMapping {
  entityField: string;
  columnName: string;
  type?: 'string' | 'number' | 'boolean' | 'date' | 'json';
  transform?: (value: unknown) => unknown;
  reverseTransform?: (value: unknown) => unknown;
  nullable?: boolean;
}

export interface RelationMapping {
  name: string;
  type: RelationType;
  targetEntity: string;
  foreignKey?: string;
  joinTable?: string;
  sourceKey?: string;
  targetKey?: string;
}

export interface EntityMapping {
  entityName: string;
  tableName: string;
  columns: ColumnMapping[];
  relations: RelationMapping[];
  customMappers?: Map<string, (value: unknown) => unknown>;
}

export class DataMapper<T extends Record<string, unknown> = Record<string, unknown>> {
  private mappings: Map<string, EntityMapping> = new Map();
  private defaultEntityName: string | null = null;

  defineMapping(mapping: EntityMapping): void {
    this.mappings.set(mapping.entityName, mapping);
    if (!this.defaultEntityName) {
      this.defaultEntityName = mapping.entityName;
    }
  }

  getMapping(entityName: string): EntityMapping {
    const mapping = this.mappings.get(entityName);
    if (!mapping) {
      throw new Error(`Mapping for entity '${entityName}' not found`);
    }
    return mapping;
  }

  setDefaultEntity(name: string): void {
    if (!this.mappings.has(name)) {
      throw new Error(`Entity '${name}' not registered`);
    }
    this.defaultEntityName = name;
  }

  mapToEntity(row: Record<string, unknown>, entityName?: string): T {
    const name = entityName ?? this.defaultEntityName;
    if (!name) {
      throw new Error('No entity name specified and no default entity set');
    }

    const mapping = this.getMapping(name);
    const entity: Record<string, unknown> = {};

    for (const col of mapping.columns) {
      let value = row[col.columnName];

      // Apply reverse transform (db -> entity)
      if (value !== undefined && value !== null && col.reverseTransform) {
        value = col.reverseTransform(value);
      }

      // Type conversion
      if (value !== undefined && value !== null && col.type) {
        value = this.convertType(value, col.type);
      }

      entity[col.entityField] = value;
    }

    // Apply custom mappers
    if (mapping.customMappers) {
      for (const [field, mapper] of mapping.customMappers) {
        if (row[field] !== undefined) {
          entity[field] = mapper(row[field]);
        }
      }
    }

    return entity as T;
  }

  mapToRow(entity: Partial<T>, entityName?: string): Record<string, unknown> {
    const name = entityName ?? this.defaultEntityName;
    if (!name) {
      throw new Error('No entity name specified and no default entity set');
    }

    const mapping = this.getMapping(name);
    const row: Record<string, unknown> = {};
    const entityRecord = entity as Record<string, unknown>;

    for (const col of mapping.columns) {
      let value = entityRecord[col.entityField];

      // Apply transform (entity -> db)
      if (value !== undefined && value !== null && col.transform) {
        value = col.transform(value);
      }

      // Type conversion
      if (value !== undefined && value !== null && col.type) {
        value = this.convertType(value, col.type);
      }

      if (value !== undefined) {
        row[col.columnName] = value;
      }
    }

    return row;
  }

  private convertType(value: unknown, type: ColumnMapping['type']): unknown {
    if (value === null || value === undefined) return value;

    switch (type) {
      case 'number':
        if (typeof value === 'string') {
          const num = Number(value);
          return isNaN(num) ? value : num;
        }
        return value;
      case 'boolean':
        if (typeof value === 'string') {
          return value === 'true' || value === '1';
        }
        if (typeof value === 'number') {
          return value !== 0;
        }
        return Boolean(value);
      case 'date':
        if (typeof value === 'string') {
          return new Date(value).toISOString();
        }
        if (value instanceof Date) {
          return value.toISOString();
        }
        return value;
      case 'json':
        if (typeof value === 'string') {
          try {
            return JSON.parse(value);
          } catch {
            return value;
          }
        }
        if (typeof value === 'object') {
          return JSON.stringify(value);
        }
        return value;
      case 'string':
        return String(value);
      default:
        return value;
    }
  }

  getAllMappings(): Map<string, EntityMapping> {
    return new Map(this.mappings);
  }

  hasMapping(entityName: string): boolean {
    return this.mappings.has(entityName);
  }

  removeMapping(entityName: string): boolean {
    if (this.defaultEntityName === entityName) {
      this.defaultEntityName = null;
    }
    return this.mappings.delete(entityName);
  }

  getRelations(entityName: string): RelationMapping[] {
    const mapping = this.getMapping(entityName);
    return mapping.relations;
  }

  getColumns(entityName: string): ColumnMapping[] {
    const mapping = this.getMapping(entityName);
    return mapping.columns;
  }

  getTableName(entityName: string): string {
    const mapping = this.getMapping(entityName);
    return mapping.tableName;
  }
}
