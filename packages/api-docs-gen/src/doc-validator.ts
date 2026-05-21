/**
 * Documentation Validator Module
 * Validates documentation completeness and quality.
 */

import type { DocModel, ModuleDoc, ClassDoc, MethodDoc, InterfaceDoc, FunctionDoc, DocStats } from './doc-model.js';

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  coverage: CoverageReport;
  moduleResults: Map<string, ModuleValidation>;
}

export interface ValidationError {
  symbol: string;
  fqn: string;
  rule: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationWarning {
  symbol: string;
  fqn: string;
  rule: string;
  message: string;
  suggestion?: string;
}

export interface CoverageReport {
  totalSymbols: number;
  documentedSymbols: number;
  coveragePercent: number;
  byType: Record<string, { total: number; documented: number; percent: number }>;
  byModule: Record<string, { total: number; documented: number; percent: number }>;
}

export interface ModuleValidation {
  moduleName: string;
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  coverage: number;
}

export interface MissingDoc {
  symbol: string;
  fqn: string;
  type: string;
  moduleName: string;
  reason: string;
}

export class DocValidator {
  private rules: ValidationRule[] = [];

  /**
   * Validate all documentation in the model.
   */
  validate(docModel: DocModel): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const moduleResults = new Map<string, ModuleValidation>();
    const modules = docModel.getAllModules();

    for (const mod of modules) {
      const modResult = this.validateModule(mod);
      moduleResults.set(mod.name, modResult);
      errors.push(...modResult.errors);
      warnings.push(...modResult.warnings);
    }

    const coverage = this.checkCoverage(docModel);

    // Execute custom validation rules
    for (const rule of this.rules) {
      try {
        const ruleErrors = rule.validate(docModel);
        errors.push(...ruleErrors);
      } catch {
        // Skip broken rules gracefully
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      coverage,
      moduleResults,
    };
  }

  /**
   * Validate a single module's documentation.
   */
  validateModule(modDoc: ModuleDoc): ModuleValidation {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    for (const cls of modDoc.classes) {
      const classResult = this.validateClass(cls);
      errors.push(...classResult.errors);
      warnings.push(...classResult.warnings);
    }

    for (const iface of modDoc.interfaces) {
      if (!iface.description) {
        warnings.push({
          symbol: iface.name,
          fqn: iface.fqn,
          rule: 'interface-description',
          message: `Interface '${iface.name}' is missing a description`,
          suggestion: `Add a JSDoc comment above the interface definition`,
        });
      }
    }

    for (const fn of modDoc.functions) {
      if (!fn.description) {
        warnings.push({
          symbol: fn.name,
          fqn: fn.fqn,
          rule: 'function-description',
          message: `Function '${fn.name}' is missing a description`,
          suggestion: `Add a JSDoc comment above the function definition`,
        });
      }
      if (fn.parameters.length > 0 && (!fn.jsdoc || fn.jsdoc.params.length === 0)) {
        warnings.push({
          symbol: fn.name,
          fqn: fn.fqn,
          rule: 'function-params',
          message: `Function '${fn.name}' has ${fn.parameters.length} parameter(s) but no @param tags`,
          suggestion: `Add @param tags for each parameter in the JSDoc comment`,
        });
      }
    }

    const totalSymbols = modDoc.classes.length + modDoc.interfaces.length + modDoc.functions.length + modDoc.typeAliases.length + modDoc.enums.length;
    const documentedSymbols = [modDoc.classes, modDoc.interfaces, modDoc.functions, modDoc.typeAliases, modDoc.enums]
      .flat()
      .filter((s) => {
        if ('description' in s) return (s as { description: string }).description;
        return false;
      }).length;
    const coveragePercent = totalSymbols > 0 ? Math.round((documentedSymbols / totalSymbols) * 100) : 100;

    return {
      moduleName: modDoc.name,
      isValid: errors.length === 0,
      errors,
      warnings,
      coverage: coveragePercent,
    };
  }

  /**
   * Validate a class's documentation.
   */
  validateClass(classDoc: ClassDoc): { errors: ValidationError[]; warnings: ValidationWarning[] } {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    if (!classDoc.description) {
      warnings.push({
        symbol: classDoc.name,
        fqn: classDoc.fqn,
        rule: 'class-description',
        message: `Class '${classDoc.name}' is missing a description`,
        suggestion: `Add a JSDoc comment above the class definition`,
      });
    }

    for (const method of classDoc.methods) {
      const methodResult = this.validateMethod(method);
      errors.push(...methodResult.errors);
      warnings.push(...methodResult.warnings);
    }

    for (const prop of classDoc.properties) {
      if (!prop.description) {
        warnings.push({
          symbol: prop.name,
          fqn: `${classDoc.fqn}.${prop.name}`,
          rule: 'property-description',
          message: `Property '${classDoc.name}.${prop.name}' is missing a description`,
        });
      }
    }

    return { errors, warnings };
  }

  /**
   * Validate a method's documentation.
   */
  validateMethod(methodDoc: MethodDoc): { errors: ValidationError[]; warnings: ValidationWarning[] } {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    if (!methodDoc.description) {
      warnings.push({
        symbol: methodDoc.name,
        fqn: methodDoc.fqn,
        rule: 'method-description',
        message: `Method '${methodDoc.fqn}' is missing a description`,
      });
    }

    if (methodDoc.parameters.length > 0) {
      if (!methodDoc.jsdoc || methodDoc.jsdoc.params.length < methodDoc.parameters.length) {
        const missing = methodDoc.parameters.length - (methodDoc.jsdoc?.params.length ?? 0);
        warnings.push({
          symbol: methodDoc.name,
          fqn: methodDoc.fqn,
          rule: 'method-params',
          message: `Method '${methodDoc.fqn}' is missing ${missing} @param tag(s)`,
          suggestion: `Add @param tags for all ${methodDoc.parameters.length} parameters`,
        });
      }
    }

    if (methodDoc.returnType !== 'void' && (!methodDoc.jsdoc || methodDoc.jsdoc.returns.length === 0)) {
      warnings.push({
        symbol: methodDoc.name,
        fqn: methodDoc.fqn,
        rule: 'method-returns',
        message: `Method '${methodDoc.fqn}' returns '${methodDoc.returnType}' but has no @returns tag`,
        suggestion: `Add a @returns tag describing the return value`,
      });
    }

    return { errors, warnings };
  }

  /**
   * Check documentation coverage.
   */
  checkCoverage(docModel: DocModel): CoverageReport {
    const modules = docModel.getAllModules();
    let totalSymbols = 0;
    let documentedSymbols = 0;
    const byType: Record<string, { total: number; documented: number; percent: number }> = {};
    const byModule: Record<string, { total: number; documented: number; percent: number }> = {};

    for (const mod of modules) {
      let modTotal = 0;
      let modDocumented = 0;

      const typeGroups: Array<{ items: Array<{ description: string }>; typeName: string }> = [
        { items: mod.classes, typeName: 'class' },
        { items: mod.interfaces, typeName: 'interface' },
        { items: mod.functions, typeName: 'function' },
        { items: mod.typeAliases, typeName: 'type' },
        { items: mod.enums, typeName: 'enum' },
      ];

      for (const group of typeGroups) {
        if (!byType[group.typeName]) {
          byType[group.typeName] = { total: 0, documented: 0, percent: 0 };
        }
        for (const item of group.items) {
          totalSymbols++;
          modTotal++;
          byType[group.typeName]!.total++;
          if (item.description) {
            documentedSymbols++;
            modDocumented++;
            byType[group.typeName]!.documented++;
          }
        }
      }

      // Also count methods and properties
      for (const cls of mod.classes) {
        for (const method of cls.methods) {
          totalSymbols++;
          modTotal++;
          if (!byType['method']) byType['method'] = { total: 0, documented: 0, percent: 0 };
          byType['method']!.total++;
          if (method.description) {
            documentedSymbols++;
            modDocumented++;
            byType['method']!.documented++;
          }
        }
        for (const prop of cls.properties) {
          totalSymbols++;
          modTotal++;
          if (!byType['property']) byType['property'] = { total: 0, documented: 0, percent: 0 };
          byType['property']!.total++;
          if (prop.description) {
            documentedSymbols++;
            modDocumented++;
            byType['property']!.documented++;
          }
        }
      }

      byModule[mod.name] = {
        total: modTotal,
        documented: modDocumented,
        percent: modTotal > 0 ? Math.round((modDocumented / modTotal) * 100) : 100,
      };
    }

    // Calculate percentages
    for (const type of Object.keys(byType)) {
      const t = byType[type]!;
      t.percent = t.total > 0 ? Math.round((t.documented / t.total) * 100) : 100;
    }

    return {
      totalSymbols,
      documentedSymbols,
      coveragePercent: totalSymbols > 0 ? Math.round((documentedSymbols / totalSymbols) * 100) : 100,
      byType,
      byModule,
    };
  }

  /**
   * Get all undocumented symbols.
   */
  getMissingDocs(docModel: DocModel): MissingDoc[] {
    const missing: MissingDoc[] = [];
    const modules = docModel.getAllModules();

    for (const mod of modules) {
      for (const cls of mod.classes) {
        if (!cls.description) {
          missing.push({
            symbol: cls.name,
            fqn: cls.fqn,
            type: 'class',
            moduleName: mod.name,
            reason: 'Missing class description',
          });
        }
        for (const method of cls.methods) {
          if (!method.description) {
            missing.push({
              symbol: method.name,
              fqn: method.fqn,
              type: 'method',
              moduleName: mod.name,
              reason: 'Missing method description',
            });
          }
        }
        for (const prop of cls.properties) {
          if (!prop.description) {
            missing.push({
              symbol: prop.name,
              fqn: `${cls.fqn}.${prop.name}`,
              type: 'property',
              moduleName: mod.name,
              reason: 'Missing property description',
            });
          }
        }
      }
      for (const iface of mod.interfaces) {
        if (!iface.description) {
          missing.push({
            symbol: iface.name,
            fqn: iface.fqn,
            type: 'interface',
            moduleName: mod.name,
            reason: 'Missing interface description',
          });
        }
      }
      for (const fn of mod.functions) {
        if (!fn.description) {
          missing.push({
            symbol: fn.name,
            fqn: fn.fqn,
            type: 'function',
            moduleName: mod.name,
            reason: 'Missing function description',
          });
        }
      }
    }

    return missing;
  }

  /**
   * Get validation warnings.
   */
  getWarnings(validation: ValidationResult): ValidationWarning[] {
    return validation.warnings;
  }

  /**
   * Generate a validation report.
   */
  generateReport(validation: ValidationResult): string {
    const lines: string[] = [];

    lines.push('# Documentation Validation Report');
    lines.push('');
    lines.push(`**Status:** ${validation.isValid ? 'PASSED' : 'FAILED'}`);
    lines.push('');
    lines.push(`- Total Symbols: ${validation.coverage.totalSymbols}`);
    lines.push(`- Documented: ${validation.coverage.documentedSymbols}`);
    lines.push(`- Coverage: ${validation.coverage.coveragePercent}%`);
    lines.push(`- Errors: ${validation.errors.length}`);
    lines.push(`- Warnings: ${validation.warnings.length}`);
    lines.push('');

    if (validation.errors.length > 0) {
      lines.push('## Errors');
      lines.push('');
      for (const error of validation.errors) {
        lines.push(`- **${error.fqn}** [${error.rule}]: ${error.message}`);
      }
      lines.push('');
    }

    if (validation.warnings.length > 0) {
      lines.push('## Warnings');
      lines.push('');
      for (const warning of validation.warnings) {
        lines.push(`- **${warning.fqn}** [${warning.rule}]: ${warning.message}`);
        if (warning.suggestion) {
          lines.push(`  - Suggestion: ${warning.suggestion}`);
        }
      }
      lines.push('');
    }

    lines.push('## Coverage by Type');
    lines.push('');
    lines.push('| Type | Total | Documented | Coverage |');
    lines.push('|------|-------|------------|----------|');
    for (const [type, data] of Object.entries(validation.coverage.byType)) {
      lines.push(`| ${type} | ${data.total} | ${data.documented} | ${data.percent}% |`);
    }
    lines.push('');

    lines.push('## Coverage by Module');
    lines.push('');
    lines.push('| Module | Total | Documented | Coverage |');
    lines.push('|--------|-------|------------|----------|');
    for (const [mod, data] of Object.entries(validation.coverage.byModule)) {
      lines.push(`| ${mod} | ${data.total} | ${data.documented} | ${data.percent}% |`);
    }
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Add a custom validation rule.
   */
  addRule(rule: ValidationRule): void {
    this.rules.push(rule);
  }
}

export interface ValidationRule {
  name: string;
  validate(docModel: DocModel): ValidationError[];
}
