/**
 * Version Differ Module
 * Compares documentation between versions and generates changelogs.
 */

import type { DocModel, ModuleDoc, ClassDoc, InterfaceDoc, FunctionDoc, TypeAliasDoc, EnumDoc, DocStats } from './doc-model.js';

export interface DiffResult {
  addedSymbols: DiffEntry[];
  removedSymbols: DiffEntry[];
  modifiedSymbols: ModifiedEntry[];
  breakingChanges: BreakingChange[];
  summary: DiffSummary;
}

export interface DiffEntry {
  name: string;
  fqn: string;
  type: 'class' | 'interface' | 'function' | 'type' | 'enum' | 'method' | 'property';
  moduleName: string;
}

export interface ModifiedEntry {
  name: string;
  fqn: string;
  type: string;
  moduleName: string;
  changes: ChangeDetail[];
}

export interface ChangeDetail {
  field: string;
  oldValue: string;
  newValue: string;
  isBreaking: boolean;
}

export interface BreakingChange {
  symbol: string;
  fqn: string;
  type: string;
  description: string;
  migration: string;
}

export interface DiffSummary {
  totalAdded: number;
  totalRemoved: number;
  totalModified: number;
  totalBreaking: number;
  hasBreakingChanges: boolean;
}

export class VersionDiffer {
  /**
   * Diff two documentation models.
   */
  diff(oldModel: DocModel, newModel: DocModel): DiffResult {
    const added: DiffEntry[] = [];
    const removed: DiffEntry[] = [];
    const modified: ModifiedEntry[] = [];
    const breaking: BreakingChange[] = [];

    const oldModules = oldModel.getAllModules();
    const newModules = newModel.getAllModules();

    const oldModuleMap = new Map(oldModules.map((m) => [m.name, m]));
    const newModuleMap = new Map(newModules.map((m) => [m.name, m]));

    // Find added/removed modules and their contents
    const allModuleNames = new Set([...oldModuleMap.keys(), ...newModuleMap.keys()]);

    for (const moduleName of allModuleNames) {
      const oldMod = oldModuleMap.get(moduleName);
      const newMod = newModuleMap.get(moduleName);

      if (!oldMod && newMod) {
        // Entire module is new
        this.collectAllSymbols(newMod, added, moduleName);
        continue;
      }
      if (oldMod && !newMod) {
        // Entire module was removed
        const beforeLen = removed.length;
        this.collectAllSymbols(oldMod, removed, moduleName);
        // Removed modules are breaking changes
        for (let i = beforeLen; i < removed.length; i++) {
          const entry = removed[i]!;
          breaking.push({
            symbol: entry.name,
            fqn: entry.fqn,
            type: entry.type,
            description: `${entry.type} '${entry.name}' was removed from module '${moduleName}'`,
            migration: `Remove or replace usages of '${entry.fqn}'`,
          });
        }
        continue;
      }

      // Both exist, diff contents
      this.diffModules(oldMod!, newMod!, added, removed, modified, breaking, moduleName);
    }

    const summary: DiffSummary = {
      totalAdded: added.length,
      totalRemoved: removed.length,
      totalModified: modified.length,
      totalBreaking: breaking.length,
      hasBreakingChanges: breaking.length > 0,
    };

    return {
      addedSymbols: added,
      removedSymbols: removed,
      modifiedSymbols: modified,
      breakingChanges: breaking,
      summary,
    };
  }

  /**
   * Get newly added symbols from a diff.
   */
  getAddedSymbols(diffResult: DiffResult): DiffEntry[] {
    return diffResult.addedSymbols;
  }

  /**
   * Get removed symbols from a diff.
   */
  getRemovedSymbols(diffResult: DiffResult): DiffEntry[] {
    return diffResult.removedSymbols;
  }

  /**
   * Get modified symbols from a diff.
   */
  getModifiedSymbols(diffResult: DiffResult): ModifiedEntry[] {
    return diffResult.modifiedSymbols;
  }

  /**
   * Get breaking changes from a diff.
   */
  getBreakingChanges(diffResult: DiffResult): BreakingChange[] {
    return diffResult.breakingChanges;
  }

  /**
   * Generate a changelog from a diff.
   */
  generateChangelog(diff: DiffResult): string {
    const lines: string[] = [];

    lines.push('# Changelog');
    lines.push('');

    if (diff.summary.totalAdded > 0) {
      lines.push('## Added');
      lines.push('');
      for (const entry of diff.addedSymbols) {
        lines.push(`- \`${entry.type}\` ${entry.fqn}`);
      }
      lines.push('');
    }

    if (diff.summary.totalRemoved > 0) {
      lines.push('## Removed');
      lines.push('');
      for (const entry of diff.removedSymbols) {
        lines.push(`- \`${entry.type}\` ${entry.fqn}`);
      }
      lines.push('');
    }

    if (diff.summary.totalModified > 0) {
      lines.push('## Changed');
      lines.push('');
      for (const entry of diff.modifiedSymbols) {
        lines.push(`- \`${entry.type}\` ${entry.fqn}`);
        for (const change of entry.changes) {
          lines.push(`  - ${change.field}: \`${change.oldValue}\` -> \`${change.newValue}\`${change.isBreaking ? ' **BREAKING**' : ''}`);
        }
      }
      lines.push('');
    }

    if (diff.summary.totalBreaking > 0) {
      lines.push('## Breaking Changes');
      lines.push('');
      for (const bc of diff.breakingChanges) {
        lines.push(`- **${bc.fqn}**: ${bc.description}`);
        if (bc.migration) {
          lines.push(`  - Migration: ${bc.migration}`);
        }
      }
      lines.push('');
    }

    if (diff.summary.totalAdded === 0 && diff.summary.totalRemoved === 0 && diff.summary.totalModified === 0) {
      lines.push('No changes detected.');
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Generate a migration guide from a diff.
   */
  generateMigrationGuide(diff: DiffResult): string {
    const lines: string[] = [];

    lines.push('# Migration Guide');
    lines.push('');

    if (!diff.summary.hasBreakingChanges) {
      lines.push('No breaking changes detected. Migration should be seamless.');
      lines.push('');
      return lines.join('\n');
    }

    lines.push('This guide helps you migrate from the previous version.');
    lines.push('');
    lines.push('## Breaking Changes');
    lines.push('');

    for (const bc of diff.breakingChanges) {
      lines.push(`### ${bc.fqn}`);
      lines.push('');
      lines.push(`**Impact:** ${bc.description}`);
      lines.push('');
      if (bc.migration) {
        lines.push(`**Migration:** ${bc.migration}`);
        lines.push('');
      }
    }

    if (diff.summary.totalRemoved > 0) {
      lines.push('## Removed Symbols');
      lines.push('');
      lines.push('The following symbols have been removed and should be replaced:');
      lines.push('');
      for (const entry of diff.removedSymbols) {
        lines.push(`- \`${entry.fqn}\` (${entry.type})`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  // --- Internal helpers ---

  private collectAllSymbols(mod: ModuleDoc, entries: DiffEntry[], moduleName: string): void {
    for (const cls of mod.classes) {
      entries.push({ name: cls.name, fqn: cls.fqn, type: 'class', moduleName });
      for (const method of cls.methods) {
        entries.push({ name: method.name, fqn: method.fqn, type: 'method', moduleName });
      }
      for (const prop of cls.properties) {
        entries.push({ name: prop.name, fqn: `${cls.fqn}.${prop.name}`, type: 'property', moduleName });
      }
    }
    for (const iface of mod.interfaces) {
      entries.push({ name: iface.name, fqn: iface.fqn, type: 'interface', moduleName });
    }
    for (const fn of mod.functions) {
      entries.push({ name: fn.name, fqn: fn.fqn, type: 'function', moduleName });
    }
    for (const ta of mod.typeAliases) {
      entries.push({ name: ta.name, fqn: ta.fqn, type: 'type', moduleName });
    }
    for (const en of mod.enums) {
      entries.push({ name: en.name, fqn: en.fqn, type: 'enum', moduleName });
    }
  }

  private diffModules(
    oldMod: ModuleDoc,
    newMod: ModuleDoc,
    added: DiffEntry[],
    removed: DiffEntry[],
    modified: ModifiedEntry[],
    breaking: BreakingChange[],
    moduleName: string,
  ): void {
    // Diff classes
    this.diffClassLists(oldMod.classes, newMod.classes, added, removed, modified, breaking, moduleName);
    // Diff interfaces
    this.diffInterfaceLists(oldMod.interfaces, newMod.interfaces, added, removed, modified, breaking, moduleName);
    // Diff functions
    this.diffFunctionLists(oldMod.functions, newMod.functions, added, removed, modified, breaking, moduleName);
    // Diff type aliases
    this.diffTypeAliasLists(oldMod.typeAliases, newMod.typeAliases, added, removed, modified, breaking, moduleName);
    // Diff enums
    this.diffEnumLists(oldMod.enums, newMod.enums, added, removed, modified, breaking, moduleName);
  }

  private diffClassLists(
    oldClasses: ClassDoc[],
    newClasses: ClassDoc[],
    added: DiffEntry[],
    removed: DiffEntry[],
    modified: ModifiedEntry[],
    breaking: BreakingChange[],
    moduleName: string,
  ): void {
    const oldMap = new Map(oldClasses.map((c) => [c.name, c]));
    const newMap = new Map(newClasses.map((c) => [c.name, c]));

    for (const [name, cls] of newMap) {
      if (!oldMap.has(name)) {
        added.push({ name, fqn: cls.fqn, type: 'class', moduleName });
      }
    }
    for (const [name, cls] of oldMap) {
      if (!newMap.has(name)) {
        removed.push({ name, fqn: cls.fqn, type: 'class', moduleName });
        breaking.push({
          symbol: name,
          fqn: cls.fqn,
          type: 'class',
          description: `Class '${name}' was removed`,
          migration: `Replace usages of '${name}' with an alternative`,
        });
      } else {
        const newCls = newMap.get(name)!;
        this.diffClass(cls, newCls, modified, breaking, moduleName);
      }
    }
  }

  private diffClass(oldCls: ClassDoc, newCls: ClassDoc, modified: ModifiedEntry[], breaking: BreakingChange[], moduleName: string): void {
    const changes: ChangeDetail[] = [];

    if (oldCls.extends !== newCls.extends) {
      changes.push({
        field: 'extends',
        oldValue: oldCls.extends ?? 'none',
        newValue: newCls.extends ?? 'none',
        isBreaking: true,
      });
    }

    if (JSON.stringify(oldCls.implements) !== JSON.stringify(newCls.implements)) {
      changes.push({
        field: 'implements',
        oldValue: oldCls.implements.join(', '),
        newValue: newCls.implements.join(', '),
        isBreaking: true,
      });
    }

    // Check for removed methods
    const oldMethods = new Set(oldCls.methods.map((m) => m.name));
    const newMethods = new Set(newCls.methods.map((m) => m.name));
    for (const m of oldMethods) {
      if (!newMethods.has(m)) {
        changes.push({
          field: `method ${m}`,
          oldValue: 'present',
          newValue: 'removed',
          isBreaking: true,
        });
        breaking.push({
          symbol: `${oldCls.name}.${m}`,
          fqn: `${oldCls.fqn}.${m}`,
          type: 'method',
          description: `Method '${m}' was removed from class '${oldCls.name}'`,
          migration: `Remove or replace calls to '${oldCls.name}.${m}'`,
        });
      }
    }

    // Check for changed return types
    const newMethodMap = new Map(newCls.methods.map((m) => [m.name, m]));
    for (const oldMethod of oldCls.methods) {
      const newMethod = newMethodMap.get(oldMethod.name);
      if (newMethod && oldMethod.returnType !== newMethod.returnType) {
        changes.push({
          field: `${oldMethod.name} return type`,
          oldValue: oldMethod.returnType,
          newValue: newMethod.returnType,
          isBreaking: true,
        });
      }
    }

    if (changes.length > 0) {
      modified.push({
        name: oldCls.name,
        fqn: oldCls.fqn,
        type: 'class',
        moduleName,
        changes,
      });
    }
  }

  private diffInterfaceLists(
    oldIfaces: InterfaceDoc[],
    newIfaces: InterfaceDoc[],
    added: DiffEntry[],
    removed: DiffEntry[],
    modified: ModifiedEntry[],
    breaking: BreakingChange[],
    moduleName: string,
  ): void {
    const oldMap = new Map(oldIfaces.map((i) => [i.name, i]));
    const newMap = new Map(newIfaces.map((i) => [i.name, i]));

    for (const [name, iface] of newMap) {
      if (!oldMap.has(name)) {
        added.push({ name, fqn: iface.fqn, type: 'interface', moduleName });
      }
    }
    for (const [name, iface] of oldMap) {
      if (!newMap.has(name)) {
        removed.push({ name, fqn: iface.fqn, type: 'interface', moduleName });
      } else {
        const newIface = newMap.get(name)!;
        const changes: ChangeDetail[] = [];
        if (JSON.stringify(oldIfaces.find((i) => i.name === name)?.extends) !== JSON.stringify(newIface.extends)) {
          changes.push({
            field: 'extends',
            oldValue: iface.extends.join(', '),
            newValue: newIface.extends.join(', '),
            isBreaking: true,
          });
        }
        if (changes.length > 0) {
          modified.push({ name, fqn: iface.fqn, type: 'interface', moduleName, changes });
        }
      }
    }
  }

  private diffFunctionLists(
    oldFns: FunctionDoc[],
    newFns: FunctionDoc[],
    added: DiffEntry[],
    removed: DiffEntry[],
    modified: ModifiedEntry[],
    breaking: BreakingChange[],
    moduleName: string,
  ): void {
    const oldMap = new Map(oldFns.map((f) => [f.name, f]));
    const newMap = new Map(newFns.map((f) => [f.name, f]));

    for (const [name, fn] of newMap) {
      if (!oldMap.has(name)) {
        added.push({ name, fqn: fn.fqn, type: 'function', moduleName });
      }
    }
    for (const [name, fn] of oldMap) {
      if (!newMap.has(name)) {
        removed.push({ name, fqn: fn.fqn, type: 'function', moduleName });
      } else {
        const newFn = newMap.get(name)!;
        const changes: ChangeDetail[] = [];
        if (fn.returnType !== newFn.returnType) {
          changes.push({
            field: 'return type',
            oldValue: fn.returnType,
            newValue: newFn.returnType,
            isBreaking: true,
          });
        }
        if (fn.parameters.length !== newFn.parameters.length) {
          changes.push({
            field: 'parameters',
            oldValue: `${fn.parameters.length} params`,
            newValue: `${newFn.parameters.length} params`,
            isBreaking: true,
          });
        }
        if (changes.length > 0) {
          modified.push({ name, fqn: fn.fqn, type: 'function', moduleName, changes });
        }
      }
    }
  }

  private diffTypeAliasLists(
    oldTypes: TypeAliasDoc[],
    newTypes: TypeAliasDoc[],
    added: DiffEntry[],
    removed: DiffEntry[],
    _modified: ModifiedEntry[],
    _breaking: BreakingChange[],
    moduleName: string,
  ): void {
    const oldNames = new Set(oldTypes.map((t) => t.name));
    const newNames = new Set(newTypes.map((t) => t.name));

    for (const ta of newTypes) {
      if (!oldNames.has(ta.name)) {
        added.push({ name: ta.name, fqn: ta.fqn, type: 'type', moduleName });
      }
    }
    for (const ta of oldTypes) {
      if (!newNames.has(ta.name)) {
        removed.push({ name: ta.name, fqn: ta.fqn, type: 'type', moduleName });
      }
    }
  }

  private diffEnumLists(
    oldEnums: EnumDoc[],
    newEnums: EnumDoc[],
    added: DiffEntry[],
    removed: DiffEntry[],
    _modified: ModifiedEntry[],
    _breaking: BreakingChange[],
    moduleName: string,
  ): void {
    const oldNames = new Set(oldEnums.map((e) => e.name));
    const newNames = new Set(newEnums.map((e) => e.name));

    for (const en of newEnums) {
      if (!oldNames.has(en.name)) {
        added.push({ name: en.name, fqn: en.fqn, type: 'enum', moduleName });
      }
    }
    for (const en of oldEnums) {
      if (!newNames.has(en.name)) {
        removed.push({ name: en.name, fqn: en.fqn, type: 'enum', moduleName });
      }
    }
  }
}
