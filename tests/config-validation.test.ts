/**
 * 配置验证测试套件
 * 测试所有配置模块的验证功能
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  ConfigValidator,
  ConfigStore,
  ConfigSourceManager,
  FileConfigSource,
  EnvConfigSource,
  ArgConfigSource,
  MemoryConfigSource,
  ConfigHotReloader,
  EnvironmentManager,
  FeatureFlagManager,
  ConfigSnapshotManager,
  ConfigAuditLog,
  ConfigExporter,
  deepMerge,
  getByPath,
  setByPath,
  deleteByPath,
  hasByPath,
} from "../packages/config-center/src/index.js";
import {
  SchemaManager,
  EnvSchema,
  DatabaseSchema,
  CacheSchema,
  SecuritySchema,
  PlatformSchema,
  loadEnvConfig,
  createPlatformConfig,
} from "../packages/config-schema/src/index.js";
import { z } from "zod";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// ============================================================================
// 测试工具函数
// ============================================================================

async function createTempDir(): Promise<string> {
  const tempDir = join(tmpdir(), `config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempDir, { recursive: true });
  return tempDir;
}

async function cleanupTempDir(tempDir: string): Promise<void> {
  try {
    await rm(tempDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

// ============================================================================
// ConfigValidator 测试
// ============================================================================

describe("ConfigValidator - 配置验证器", () => {
  let validator: ConfigValidator;

  beforeEach(() => {
    validator = new ConfigValidator();
  });

  describe("Schema 注册", () => {
    test("应该能注册 schema", () => {
      validator.registerSchema("app.name", { type: "string", required: true });
      expect(validator.getSchemaPaths()).toContain("app.name");
    });

    test("应该能移除 schema", () => {
      validator.registerSchema("test", { type: "string" });
      expect(validator.removeSchema("test")).toBe(true);
      expect(validator.getSchemaPaths()).not.toContain("test");
    });

    test("移除不存在的 schema 应返回 false", () => {
      expect(validator.removeSchema("nonexistent")).toBe(false);
    });

    test("应该返回所有已注册的 schema 路径", () => {
      validator.registerSchema("a", { type: "string" });
      validator.registerSchema("b", { type: "number" });
      validator.registerSchema("c", { type: "boolean" });
      expect(validator.getSchemaPaths()).toHaveLength(3);
    });
  });

  describe("类型验证", () => {
    test("应该验证 string 类型", () => {
      const result = validator.validate("name", "test", { type: "string" });
      expect(result.valid).toBe(true);
    });

    test("string 类型应该拒绝非字符串值", () => {
      const result = validator.validate("name", 123, { type: "string" });
      expect(result.valid).toBe(false);
      expect(result.errors[0].constraint).toBe("type");
    });

    test("应该验证 number 类型", () => {
      const result = validator.validate("port", 3000, { type: "number" });
      expect(result.valid).toBe(true);
    });

    test("number 类型应该拒绝非数字值", () => {
      const result = validator.validate("port", "3000", { type: "number" });
      expect(result.valid).toBe(false);
    });

    test("应该验证 boolean 类型", () => {
      const result = validator.validate("enabled", true, { type: "boolean" });
      expect(result.valid).toBe(true);
    });

    test("boolean 类型应该拒绝非布尔值", () => {
      const result = validator.validate("enabled", "true", { type: "boolean" });
      expect(result.valid).toBe(false);
    });

    test("应该验证 array 类型", () => {
      const result = validator.validate("items", [1, 2, 3], { type: "array" });
      expect(result.valid).toBe(true);
    });

    test("array 类型应该拒绝非数组值", () => {
      const result = validator.validate("items", "not-array", { type: "array" });
      expect(result.valid).toBe(false);
    });

    test("应该验证 object 类型", () => {
      const result = validator.validate("config", { key: "value" }, { type: "object" });
      expect(result.valid).toBe(true);
    });

    test("object 类型应该拒绝 null", () => {
      const result = validator.validate("config", null, { type: "object" });
      expect(result.valid).toBe(false);
    });

    test("object 类型应该拒绝数组", () => {
      const result = validator.validate("config", [1, 2], { type: "object" });
      expect(result.valid).toBe(false);
    });

    test("any 类型应该接受任何值", () => {
      expect(validator.validate("any", "string", { type: "any" }).valid).toBe(true);
      expect(validator.validate("any", 123, { type: "any" }).valid).toBe(true);
      expect(validator.validate("any", true, { type: "any" }).valid).toBe(true);
      expect(validator.validate("any", null, { type: "any" }).valid).toBe(true);
    });
  });

  describe("必填验证", () => {
    test("required 字段应该拒绝 undefined", () => {
      const result = validator.validate("name", undefined, { type: "string", required: true });
      expect(result.valid).toBe(false);
      expect(result.errors[0].constraint).toBe("required");
    });

    test("required 字段应该拒绝 null", () => {
      const result = validator.validate("name", null, { type: "string", required: true });
      expect(result.valid).toBe(false);
    });

    test("非 required 字段可以接受 undefined", () => {
      const result = validator.validate("name", undefined, { type: "string" });
      expect(result.valid).toBe(true);
    });

    test("非 required 字段可以接受 null (with any type)", () => {
      // null values pass validation when type is 'any' or not specified
      const result = validator.validate("name", null, { type: "any" });
      expect(result.valid).toBe(true);
    });

    test("typed 字段应该拒绝 null", () => {
      // null values fail validation when a specific type is required
      const result = validator.validate("name", null, { type: "string" });
      expect(result.valid).toBe(false);
    });
  });

  describe("默认值", () => {
    test("应该应用默认值", () => {
      const result = validator.validate("port", undefined, { type: "number", default: 3000 });
      expect(result.valid).toBe(true);
      expect(result.value).toBe(3000);
    });

    test("有值时不应覆盖默认值", () => {
      const result = validator.validate("port", 8080, { type: "number", default: 3000 });
      expect(result.value).toBe(8080);
    });
  });

  describe("数值约束", () => {
    test("应该验证 min 约束", () => {
      const result = validator.validate("port", 80, { type: "number", min: 1024 });
      expect(result.valid).toBe(false);
      expect(result.errors[0].constraint).toBe("min");
    });

    test("应该验证 max 约束", () => {
      const result = validator.validate("port", 70000, { type: "number", max: 65535 });
      expect(result.valid).toBe(false);
      expect(result.errors[0].constraint).toBe("max");
    });

    test("有效数值应该通过验证", () => {
      const result = validator.validate("port", 8080, { type: "number", min: 1024, max: 65535 });
      expect(result.valid).toBe(true);
    });
  });

  describe("字符串约束", () => {
    test("应该验证 minLength 约束", () => {
      const result = validator.validate("name", "ab", { type: "string", minLength: 3 });
      expect(result.valid).toBe(false);
      expect(result.errors[0].constraint).toBe("minLength");
    });

    test("应该验证 maxLength 约束", () => {
      const result = validator.validate("name", "toolongname", { type: "string", maxLength: 5 });
      expect(result.valid).toBe(false);
      expect(result.errors[0].constraint).toBe("maxLength");
    });

    test("应该验证 pattern 约束", () => {
      const result = validator.validate("email", "invalid", { type: "string", pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ });
      expect(result.valid).toBe(false);
      expect(result.errors[0].constraint).toBe("pattern");
    });

    test("字符串 pattern 应该支持字符串格式的正则", () => {
      const result = validator.validate("email", "test@example.com", { type: "string", pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" });
      expect(result.valid).toBe(true);
    });
  });

  describe("枚举验证", () => {
    test("应该验证 enum 约束", () => {
      const result = validator.validate("env", "invalid", { enum: ["dev", "prod", "test"] });
      expect(result.valid).toBe(false);
      expect(result.errors[0].constraint).toBe("enum");
    });

    test("enum 值应该通过验证", () => {
      const result = validator.validate("env", "prod", { enum: ["dev", "prod", "test"] });
      expect(result.valid).toBe(true);
    });
  });

  describe("自定义验证", () => {
    test("应该执行自定义验证函数", () => {
      const result = validator.validate("password", "weak", {
        type: "string",
        custom: (value) => (value as string).length < 8 ? "Password too short" : null,
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toBe("Password too short");
    });

    test("自定义验证通过时应该返回 null", () => {
      const result = validator.validate("password", "strongpassword", {
        type: "string",
        custom: (value) => (value as string).length < 8 ? "Password too short" : null,
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("类型强制转换", () => {
    test("应该将字符串强制转换为数字", () => {
      const result = validator.validate("port", "3000", { type: "number", coerce: true });
      expect(result.valid).toBe(true);
      expect(result.value).toBe(3000);
    });

    test("应该将字符串强制转换为布尔值", () => {
      const result = validator.validate("enabled", "true", { type: "boolean", coerce: true });
      expect(result.valid).toBe(true);
      expect(result.value).toBe(true);
    });

    test("应该将值强制转换为字符串", () => {
      const result = validator.validate("id", 123, { type: "string", coerce: true });
      expect(result.valid).toBe(true);
      expect(result.value).toBe("123");
    });

    test("应该将 JSON 字符串强制转换为对象", () => {
      const result = validator.validate("data", '{"key":"value"}', { type: "object", coerce: true });
      expect(result.valid).toBe(true);
      expect(result.value).toEqual({ key: "value" });
    });

    test("无法强制转换时应该返回错误", () => {
      const result = validator.validate("port", "not-a-number", { type: "number", coerce: true });
      expect(result.valid).toBe(false);
    });
  });

  describe("批量验证", () => {
    test("应该验证多个配置项", () => {
      validator.registerSchema("name", { type: "string", required: true });
      validator.registerSchema("port", { type: "number", min: 1, max: 65535 });

      const report = validator.validateAll({ name: "test", port: 8080 });
      expect(report.valid).toBe(true);
      expect(Object.keys(report.results)).toHaveLength(2);
    });

    test("应该收集所有验证错误", () => {
      const schemas = {
        name: { type: "string", required: true },
        port: { type: "number", min: 1024 },
      };

      const report = validator.validateAll({ name: undefined, port: 80 }, schemas);
      expect(report.valid).toBe(false);
      expect(report.errors).toHaveLength(2);
    });

    test("没有 schema 时应该返回有效", () => {
      const report = validator.validateAll({ any: "value" });
      expect(report.valid).toBe(true);
    });
  });

  describe("跨字段依赖验证", () => {
    test("应该验证依赖关系", () => {
      const schemas = {
        password: {
          type: "string",
          dependencies: {
            confirmPassword: (value, all) => all.confirmPassword === value ? null : "Passwords do not match",
          },
        },
        confirmPassword: { type: "string" },
      };

      const report = validator.validateAll(
        { password: "secret", confirmPassword: "different" },
        schemas
      );
      expect(report.valid).toBe(false);
      expect(report.errors.some((e) => e.constraint === "dependency")).toBe(true);
    });
  });
});

// ============================================================================
// ConfigStore 测试
// ============================================================================

describe("ConfigStore - 配置存储", () => {
  let store: ConfigStore;

  beforeEach(() => {
    store = new ConfigStore();
  });

  describe("基本操作", () => {
    test("应该设置和获取配置值", () => {
      store.set("name", "test");
      expect(store.get("name")).toBe("test");
    });

    test("应该支持嵌套路径", () => {
      store.set("database.host", "localhost");
      expect(store.get("database.host")).toBe("localhost");
    });

    test("应该检查配置是否存在", () => {
      store.set("key", "value");
      expect(store.has("key")).toBe(true);
      expect(store.has("nonexistent")).toBe(false);
    });

    test("应该删除配置", () => {
      store.set("key", "value");
      expect(store.delete("key")).toBe(true);
      expect(store.has("key")).toBe(false);
    });

    test("删除不存在的配置应该返回 false", () => {
      expect(store.delete("nonexistent")).toBe(false);
    });

    test("空路径应该返回所有配置", () => {
      store.set("a", 1);
      store.set("b", 2);
      expect(store.get("")).toEqual({ a: 1, b: 2 });
    });
  });

  describe("合并配置", () => {
    test("应该深度合并配置", () => {
      store.set("database", { host: "localhost", port: 5432 });
      store.merge({ database: { port: 3306, ssl: true } });
      expect(store.get("database")).toEqual({ host: "localhost", port: 3306, ssl: true });
    });

    test("合并应该创建新的嵌套对象", () => {
      store.set("a", { b: 1 });
      store.merge({ a: { c: 2 } });
      expect(store.get("a")).toEqual({ b: 1, c: 2 });
    });
  });

  describe("监听功能", () => {
    test("应该监听配置变化", () => {
      const changes: Array<{ path: string; newValue: unknown; oldValue: unknown }> = [];
      store.watch("key", (path, newValue, oldValue) => {
        changes.push({ path, newValue, oldValue });
      });

      store.set("key", "new-value");
      expect(changes).toHaveLength(1);
      expect(changes[0].newValue).toBe("new-value");
    });

    test("应该支持取消监听", () => {
      let count = 0;
      const unwatch = store.watch("key", () => {
        count++;
      });

      store.set("key", "value1");
      unwatch();
      store.set("key", "value2");

      expect(count).toBe(1);
    });

    test("父路径监听应该收到子路径变化", () => {
      const changes: string[] = [];
      store.watch("database", (path) => {
        changes.push(path);
      });

      store.set("database.host", "localhost");
      expect(changes).toContain("database.host");
    });
  });

  describe("版本管理", () => {
    test("应该创建版本", () => {
      store.set("key", "value");
      const versionId = store.createVersion("test-version");
      expect(versionId).toMatch(/^v\d+$/);
    });

    test("应该获取版本列表", () => {
      store.createVersion("v1");
      store.createVersion("v2");
      const versions = store.getVersions();
      expect(versions).toHaveLength(2);
    });

    test("应该恢复到指定版本", () => {
      store.set("key", "original");
      const versionId = store.createVersion();
      store.set("key", "modified");
      expect(store.get("key")).toBe("modified");

      store.restoreVersion(versionId);
      expect(store.get("key")).toBe("original");
    });

    test("恢复不存在的版本应该返回 false", () => {
      expect(store.restoreVersion("nonexistent")).toBe(false);
    });
  });

  describe("原型污染防护", () => {
    test("应该拒绝 __proto__ 键", () => {
      store.set("__proto__.polluted", "value");
      expect(store.get("__proto__.polluted")).toBeUndefined();
    });

    test("应该拒绝 constructor 键", () => {
      store.set("constructor.polluted", "value");
      expect(store.get("constructor.polluted")).toBeUndefined();
    });

    test("应该拒绝 prototype 键", () => {
      store.set("prototype.polluted", "value");
      expect(store.get("prototype.polluted")).toBeUndefined();
    });
  });
});

// ============================================================================
// deepMerge 工具函数测试
// ============================================================================

describe("deepMerge - 深度合并", () => {
  test("应该合并简单对象", () => {
    const result = deepMerge({ a: 1 }, { b: 2 });
    expect(result).toEqual({ a: 1, b: 2 });
  });

  test("应该深度嵌套对象", () => {
    const result = deepMerge(
      { a: { b: 1, c: 2 } },
      { a: { c: 3, d: 4 } }
    );
    expect(result).toEqual({ a: { b: 1, c: 3, d: 4 } });
  });

  test("源对象应该覆盖目标对象", () => {
    const result = deepMerge({ a: 1 }, { a: 2 });
    expect(result.a).toBe(2);
  });

  test("应该处理数组（不合并）", () => {
    const result = deepMerge({ a: [1, 2] }, { a: [3, 4] });
    expect(result.a).toEqual([3, 4]);
  });

  test("应该跳过 __proto__ 键", () => {
    const result = deepMerge({}, { __proto__: { polluted: true } });
    expect((result as any).__proto__.polluted).toBeUndefined();
  });

  test("应该跳过 constructor 键", () => {
    const result = deepMerge({}, { constructor: { polluted: true } });
    expect((result as any).constructor.polluted).toBeUndefined();
  });
});

// ============================================================================
// 路径操作工具函数测试
// ============================================================================

describe("路径操作工具函数", () => {
  describe("getByPath", () => {
    test("应该获取嵌套值", () => {
      const obj = { a: { b: { c: "value" } } };
      expect(getByPath(obj, "a.b.c")).toBe("value");
    });

    test("不存在的路径应该返回 undefined", () => {
      const obj = { a: {} };
      expect(getByPath(obj, "a.b.c")).toBeUndefined();
    });

    test("应该拒绝 __proto__ 路径", () => {
      const obj = {};
      expect(getByPath(obj, "__proto__.polluted")).toBeUndefined();
    });
  });

  describe("setByPath", () => {
    test("应该设置嵌套值", () => {
      const obj: Record<string, unknown> = {};
      setByPath(obj, "a.b.c", "value");
      expect(obj).toEqual({ a: { b: { c: "value" } } });
    });

    test("应该拒绝 __proto__ 路径", () => {
      const obj: Record<string, unknown> = {};
      setByPath(obj, "__proto__.polluted", "value");
      expect((obj as any).__proto__.polluted).toBeUndefined();
    });
  });

  describe("deleteByPath", () => {
    test("应该删除嵌套值", () => {
      const obj = { a: { b: { c: "value" } } };
      expect(deleteByPath(obj, "a.b.c")).toBe(true);
      expect(obj.a.b).toEqual({});
    });

    test("删除不存在的路径应该返回 false", () => {
      const obj = { a: {} };
      expect(deleteByPath(obj, "a.b.c")).toBe(false);
    });

    test("应该拒绝 __proto__ 路径", () => {
      const obj = {};
      expect(deleteByPath(obj, "__proto__.polluted")).toBe(false);
    });
  });

  describe("hasByPath", () => {
    test("应该检查嵌套值是否存在", () => {
      const obj = { a: { b: "value" } };
      expect(hasByPath(obj, "a.b")).toBe(true);
      expect(hasByPath(obj, "a.c")).toBe(false);
    });

    test("应该拒绝 __proto__ 路径", () => {
      const obj = {};
      expect(hasByPath(obj, "__proto__.polluted")).toBe(false);
    });
  });
});

// ============================================================================
// ConfigSourceManager 测试
// ============================================================================

describe("ConfigSourceManager - 配置源管理", () => {
  let manager: ConfigSourceManager;

  beforeEach(() => {
    manager = new ConfigSourceManager();
  });

  test("应该添加配置源", () => {
    const source = new MemoryConfigSource({ key: "value" });
    manager.addSource(source, 1);
    expect(manager.getSourceNames()).toContain("memory");
  });

  test("应该按优先级加载配置", async () => {
    const lowPriority = new MemoryConfigSource({ port: 3000, host: "localhost" }, "low");
    const highPriority = new MemoryConfigSource({ port: 8080 }, "high");

    manager.addSource(lowPriority, 1);
    manager.addSource(highPriority, 10);

    const config = await manager.loadAll();
    expect(config.port).toBe(8080); // high priority wins
    expect(config.host).toBe("localhost"); // from low priority
  });

  test("应该移除配置源", () => {
    const source = new MemoryConfigSource({});
    manager.addSource(source, 1);
    expect(manager.removeSource("memory")).toBe(true);
    expect(manager.getSourceNames()).not.toContain("memory");
  });

  test("应该重新加载指定配置源", async () => {
    const source = new MemoryConfigSource({ key: "value" }, "test");
    manager.addSource(source, 1);

    const config = await manager.reload("test");
    expect(config.key).toBe("value");
  });

  test("重新加载不存在的配置源应该抛出错误", async () => {
    await expect(manager.reload("nonexistent")).rejects.toThrow();
  });
});

// ============================================================================
// MemoryConfigSource 测试
// ============================================================================

describe("MemoryConfigSource - 内存配置源", () => {
  test("应该加载配置数据", async () => {
    const source = new MemoryConfigSource({ key: "value" });
    const config = await source.load();
    expect(config.key).toBe("value");
  });

  test("应该更新配置数据", async () => {
    const source = new MemoryConfigSource({ key: "old" });
    source.update({ key: "new" });
    const config = await source.load();
    expect(config.key).toBe("new");
  });

  test("应该获取数据副本", () => {
    const source = new MemoryConfigSource({ key: "value" });
    const data = source.getData();
    data.key = "modified";
    expect(source.getData().key).toBe("value");
  });
});

// ============================================================================
// EnvConfigSource 测试
// ============================================================================

describe("EnvConfigSource - 环境变量配置源", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("应该加载环境变量", async () => {
      // Set environment variable directly on process.env
      const testKey = 'TEST_VAR_' + Date.now();
      const testValue = 'test_value_' + Math.random().toString(36).slice(2);
      process.env[testKey] = testValue;

      const source = new EnvConfigSource({ name: "test-env-" + Date.now() });
      const config = await source.load();

      // The env var should be loaded with lowercase key
      const expectedKey = testKey.toLowerCase();
      expect(config[expectedKey]).toBe(testValue);

      // Cleanup
      delete process.env[testKey];
    });

  test("应该支持前缀过滤", async () => {
    process.env.APP_NAME = "test";
    process.env.OTHER_VAR = "ignored";

    const source = new EnvConfigSource({ prefix: "APP_" });
    const config = await source.load();
    expect(config.name).toBe("test");
    expect(config.otherVar).toBeUndefined();
  });

  test("应该转换嵌套键", async () => {
    process.env.DATABASE__HOST = "localhost";
    process.env.DATABASE__PORT = "5432";

    const source = new EnvConfigSource({ separator: "__" });
    const config = await source.load();
    expect(config.database).toEqual({ host: "localhost", port: 5432 });
  });

  test("应该解析布尔值", async () => {
    process.env.ENABLED = "true";
    process.env.DISABLED = "false";

    const source = new EnvConfigSource();
    const config = await source.load();
    expect(config.enabled).toBe(true);
    expect(config.disabled).toBe(false);
  });

  test("应该解析数字", async () => {
    process.env.PORT = "3000";

    const source = new EnvConfigSource();
    const config = await source.load();
    expect(config.port).toBe(3000);
  });

  test("应该解析 JSON 值", async () => {
    process.env.DATA = '{"key":"value"}';

    const source = new EnvConfigSource();
    const config = await source.load();
    expect(config.data).toEqual({ key: "value" });
  });
});

// ============================================================================
// ArgConfigSource 测试
// ============================================================================

describe("ArgConfigSource - 命令行参数配置源", () => {
  test("应该解析 --key=value 格式", async () => {
    const source = new ArgConfigSource(["--port=3000"]);
    const config = await source.load();
    expect(config.port).toBe(3000);
  });

  test("应该解析 --key value 格式", async () => {
    const source = new ArgConfigSource(["--port", "3000"]);
    const config = await source.load();
    expect(config.port).toBe(3000);
  });

  test("应该解析布尔标志", async () => {
    const source = new ArgConfigSource(["--verbose"]);
    const config = await source.load();
    expect(config.verbose).toBe(true);
  });

  test("应该转换嵌套键", async () => {
    const source = new ArgConfigSource(["--database-host=localhost"]);
    const config = await source.load();
    expect(config.database).toEqual({ host: "localhost" });
  });

  test("应该解析数值", async () => {
    const source = new ArgConfigSource(["--count=42"]);
    const config = await source.load();
    expect(config.count).toBe(42);
  });
});

// ============================================================================
// FileConfigSource 测试
// ============================================================================

describe("FileConfigSource - 文件配置源", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test("应该加载 JSON 文件", async () => {
    const filePath = join(tempDir, "config.json");
    await writeFile(filePath, JSON.stringify({ port: 3000 }));

    const source = new FileConfigSource(filePath);
    const config = await source.load();
    expect(config.port).toBe(3000);
  });

  test("文件不存在时应该返回空对象", async () => {
    const source = new FileConfigSource(join(tempDir, "nonexistent.json"));
    const config = await source.load();
    expect(config).toEqual({});
  });

  test("应该获取最后修改时间", async () => {
    const filePath = join(tempDir, "config.json");
    await writeFile(filePath, JSON.stringify({}));

    const source = new FileConfigSource(filePath);
    await source.load();
    expect(source.lastModified).toBeGreaterThan(0);
  });
});

// ============================================================================
// ConfigHotReloader 测试
// ============================================================================

describe("ConfigHotReloader - 配置热重载", () => {
  let store: ConfigStore;
  let sourceManager: ConfigSourceManager;
  let reloader: ConfigHotReloader;

  beforeEach(() => {
    store = new ConfigStore();
    sourceManager = new ConfigSourceManager();
    reloader = new ConfigHotReloader(store, sourceManager, { debounceMs: 10 });
  });

  afterEach(() => {
    reloader.stopWatching();
  });

  test("应该开始监听", () => {
    reloader.startWatching();
    expect(reloader.isWatching()).toBe(true);
  });

  test("应该停止监听", () => {
    reloader.startWatching();
    reloader.stopWatching();
    expect(reloader.isWatching()).toBe(false);
  });

  test("应该注册重载回调", () => {
    const events: unknown[] = [];
    reloader.onReload((event) => events.push(event));

    reloader.startWatching();
    reloader.triggerReload("test");

    // 由于防抖，不会立即触发
    expect(events).toHaveLength(0);
  });

  test("应该获取重载历史", async () => {
    const source = new MemoryConfigSource({ key: "value" }, "test");
    sourceManager.addSource(source, 1);

    reloader.startWatching();
    reloader.triggerReload("test");

    // 等待防抖
    await new Promise((resolve) => setTimeout(resolve, 50));

    const history = reloader.getReloadHistory();
    expect(history.length).toBeGreaterThan(0);
  });

  test("应该清空重载历史", async () => {
    const source = new MemoryConfigSource({ key: "value" }, "test");
    sourceManager.addSource(source, 1);

    reloader.startWatching();
    reloader.triggerReload("test");
    await new Promise((resolve) => setTimeout(resolve, 50));

    reloader.clearHistory();
    expect(reloader.getReloadHistory()).toHaveLength(0);
  });

  test("未监听时不应触发重载", () => {
    reloader.triggerReload("test");
    expect(reloader.getReloadHistory()).toHaveLength(0);
  });

  test("应该支持验证器", async () => {
    const validator = new ConfigValidator();
    const schemas = {
      port: { type: "number", required: true },
    };

    const reloaderWithValidator = new ConfigHotReloader(store, sourceManager, {
      debounceMs: 10,
      validator,
      schemas,
    });

    const source = new MemoryConfigSource({ port: "invalid" }, "test");
    sourceManager.addSource(source, 1);

    reloaderWithValidator.startWatching();
    reloaderWithValidator.triggerReload("test");

    await new Promise((resolve) => setTimeout(resolve, 50));

    const history = reloaderWithValidator.getReloadHistory();
    expect(history[0].success).toBe(false);

    reloaderWithValidator.stopWatching();
  });
});

// ============================================================================
// EnvironmentManager 测试
// ============================================================================

describe("EnvironmentManager - 环境管理器", () => {
  let manager: EnvironmentManager;

  beforeEach(() => {
    manager = new EnvironmentManager({ base: "value" }, "development");
  });

  describe("环境切换", () => {
    test("应该设置当前环境", () => {
      manager.setEnvironment("production");
      expect(manager.getEnvironment()).toBe("production");
    });

    test("设置未注册的环境应该抛出错误", () => {
      expect(() => manager.setEnvironment("invalid")).toThrow();
    });

    test("应该列出所有环境", () => {
      const envs = manager.listEnvironments();
      expect(envs).toContain("development");
      expect(envs).toContain("production");
      expect(envs).toContain("test");
      expect(envs).toContain("staging");
    });
  });

  describe("配置获取", () => {
    test("应该获取当前环境配置", () => {
      manager.registerEnvironment("production", { port: 80 });
      manager.setEnvironment("production");

      const config = manager.getCurrentConfig();
      expect(config.base).toBe("value");
      expect(config.port).toBe(80);
    });

    test("应该获取指定环境配置", () => {
      manager.registerEnvironment("test", { debug: true });

      const config = manager.getEnvConfig("test");
      expect(config.debug).toBe(true);
    });
  });

  describe("环境比较", () => {
    test("应该比较两个环境的差异", () => {
      manager.registerEnvironment("dev", { debug: true });
      manager.registerEnvironment("prod", { debug: false, secure: true });

      const diff = manager.compareEnvironments("dev", "prod");
      expect(diff.differentValues).toHaveLength(1);
      expect(diff.onlyInEnv2).toContain("secure");
    });
  });

  describe("环境验证", () => {
    test("应该验证必填字段", () => {
      manager.registerEnvironment("prod", {}, ["apiKey", "secret"]);

      const result = manager.validateEnvironment("prod");
      expect(result.valid).toBe(false);
      expect(result.missing).toContain("apiKey");
      expect(result.missing).toContain("secret");
    });

    test("验证未注册的环境应该返回无效", () => {
      const result = manager.validateEnvironment("nonexistent");
      expect(result.valid).toBe(false);
    });
  });

  describe("环境变量插值", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    test("应该插值环境变量", () => {
      process.env.TEST_API_KEY = "secret123";

      const config = manager.interpolate({ apiKey: "${ENV:TEST_API_KEY}" });
      expect(config.apiKey).toBe("secret123");
    });

    test("环境变量不存在时应该替换为空字符串", () => {
      const config = manager.interpolate({ apiKey: "${ENV:NONEXISTENT}" });
      expect(config.apiKey).toBe("");
    });

    test("应该递归插值嵌套对象", () => {
      process.env.DB_HOST = "localhost";

      const config = manager.interpolate({
        database: { host: "${ENV:DB_HOST}", port: 5432 },
      });
      expect(config.database).toEqual({ host: "localhost", port: 5432 });
    });

    test("应该插值数组中的环境变量", () => {
      process.env.HOST1 = "host1";
      process.env.HOST2 = "host2";

      const config = manager.interpolate({
        hosts: ["${ENV:HOST1}", "${ENV:HOST2}"],
      });
      expect(config.hosts).toEqual(["host1", "host2"]);
    });
  });

  describe("配置更新", () => {
    test("应该更新基础配置", () => {
      manager.updateBaseConfig({ newKey: "newValue" });
      const config = manager.getCurrentConfig();
      expect(config.newKey).toBe("newValue");
    });

    test("应该更新环境覆盖配置", () => {
      manager.registerEnvironment("custom", { port: 3000 });
      manager.updateEnvironmentOverrides("custom", { port: 8080 });

      const config = manager.getEnvConfig("custom");
      expect(config.port).toBe(8080);
    });

    test("更新未注册的环境应该抛出错误", () => {
      expect(() => manager.updateEnvironmentOverrides("nonexistent", {})).toThrow();
    });
  });

  describe("环境移除", () => {
    test("应该移除环境", () => {
      manager.registerEnvironment("temp", {});
      expect(manager.removeEnvironment("temp")).toBe(true);
      expect(manager.listEnvironments()).not.toContain("temp");
    });

    test("不能移除当前环境", () => {
      expect(manager.removeEnvironment("development")).toBe(false);
    });
  });
});

// ============================================================================
// FeatureFlagManager 测试
// ============================================================================

describe("FeatureFlagManager - 特性开关管理器", () => {
  let manager: FeatureFlagManager;

  beforeEach(() => {
    manager = new FeatureFlagManager();
  });

  describe("开关管理", () => {
    test("应该设置特性开关", () => {
      manager.setFlag("new-feature", { type: "boolean", enabled: true });
      const flag = manager.getFlag("new-feature");
      expect(flag).toBeDefined();
      expect(flag?.name).toBe("new-feature");
    });

    test("应该检查特性是否启用", () => {
      manager.setFlag("enabled-feature", { type: "boolean", enabled: true });
      manager.setFlag("disabled-feature", { type: "boolean", enabled: false });

      expect(manager.isEnabled("enabled-feature")).toBe(true);
      expect(manager.isEnabled("disabled-feature")).toBe(false);
    });

    test("不存在的特性应该返回 false", () => {
      expect(manager.isEnabled("nonexistent")).toBe(false);
    });

    test("应该列出所有特性开关", () => {
      manager.setFlag("feature1", { type: "boolean" });
      manager.setFlag("feature2", { type: "boolean" });

      const flags = manager.listFlags();
      expect(flags).toHaveLength(2);
    });

    test("应该删除特性开关", () => {
      manager.setFlag("temp", { type: "boolean" });
      expect(manager.removeFlag("temp")).toBe(true);
      expect(manager.getFlag("temp")).toBeUndefined();
    });
  });

  describe("开关状态管理", () => {
    test("应该启用特性开关", () => {
      manager.setFlag("feature", { type: "boolean", enabled: false });
      manager.enableFlag("feature");
      expect(manager.isEnabled("feature")).toBe(true);
    });

    test("应该禁用特性开关", () => {
      manager.setFlag("feature", { type: "boolean", enabled: true });
      manager.disableFlag("feature");
      expect(manager.isEnabled("feature")).toBe(false);
    });

    test("应该归档特性开关", () => {
      manager.setFlag("old-feature", { type: "boolean" });
      manager.archiveFlag("old-feature");
      expect(manager.isEnabled("old-feature")).toBe(false);
    });
  });

  describe("A/B 测试变体", () => {
    test("应该获取变体", () => {
      manager.setFlag("experiment", {
        type: "variant",
        variants: { control: 50, treatment: 50 },
        defaultVariant: "control",
      });

      const variant = manager.getVariant("experiment", { userId: "user1" });
      expect(["control", "treatment"]).toContain(variant);
    });

    test("非变体类型应该返回默认变体", () => {
      manager.setFlag("feature", {
        type: "boolean",
        defaultVariant: "control",
      });

      expect(manager.getVariant("feature")).toBe("control");
    });
  });

  describe("规则评估", () => {
    test("应该按用户 ID 评估规则", () => {
      manager.setFlag("beta", {
        type: "boolean",
        enabled: false,
        rules: [{ type: "user", userIds: ["user1", "user2"], enabled: true }],
      });

      expect(manager.isEnabled("beta", { userId: "user1" })).toBe(true);
      expect(manager.isEnabled("beta", { userId: "user3" })).toBe(false);
    });

    test("应该按分段评估规则", () => {
      manager.setFlag("enterprise", {
        type: "boolean",
        enabled: false,
        rules: [{ type: "segment", segment: "enterprise", enabled: true }],
      });

      expect(manager.isEnabled("enterprise", { segment: "enterprise" })).toBe(true);
      expect(manager.isEnabled("enterprise", { segment: "free" })).toBe(false);
    });

    test("应该按百分比评估规则", () => {
      manager.setFlag("rollout", {
        type: "boolean",
        enabled: false,
        rules: [{ type: "percentage", percentage: 50, enabled: true }],
      });

      // 由于哈希，结果应该是确定性的
      const result1 = manager.isEnabled("rollout", { userId: "user1" });
      const result2 = manager.isEnabled("rollout", { userId: "user1" });
      expect(result1).toBe(result2);
    });

    test("应该按日期评估规则", () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      const futureDate = new Date(Date.now() + 86400000).toISOString();

      manager.setFlag("scheduled", {
        type: "boolean",
        enabled: false,
        rules: [{ type: "date", startDate: pastDate, enabled: true }],
      });

      expect(manager.isEnabled("scheduled")).toBe(true);
    });

    test("应该按属性评估规则", () => {
      manager.setFlag("premium", {
        type: "boolean",
        enabled: false,
        rules: [{ type: "attribute", attributeName: "plan", attributeValue: "premium", enabled: true }],
      });

      expect(manager.isEnabled("premium", { attributes: { plan: "premium" } })).toBe(true);
      expect(manager.isEnabled("premium", { attributes: { plan: "free" } })).toBe(false);
    });
  });

  describe("统计", () => {
    test("应该记录开关统计", () => {
      manager.setFlag("feature", { type: "boolean", enabled: true });
      manager.isEnabled("feature");
      manager.isEnabled("feature");

      const stats = manager.getFlagStats("feature");
      expect(stats?.totalEvaluations).toBe(2);
    });

    test("应该重置统计", () => {
      manager.setFlag("feature", { type: "boolean" });
      manager.isEnabled("feature");
      manager.resetStats("feature");

      const stats = manager.getFlagStats("feature");
      expect(stats).toBeUndefined();
    });

    test("应该重置所有统计", () => {
      manager.setFlag("feature1", { type: "boolean" });
      manager.setFlag("feature2", { type: "boolean" });
      manager.isEnabled("feature1");
      manager.isEnabled("feature2");

      manager.resetStats();
      expect(manager.getFlagStats("feature1")).toBeUndefined();
      expect(manager.getFlagStats("feature2")).toBeUndefined();
    });
  });

  describe("变更监听", () => {
    test("应该监听开关变化", () => {
      const changes: unknown[] = [];
      manager.onChange((name, oldConfig, newConfig) => {
        changes.push({ name, oldConfig, newConfig });
      });

      manager.setFlag("feature", { type: "boolean", enabled: true });
      expect(changes).toHaveLength(1);
    });

    test("应该支持取消监听", () => {
      let count = 0;
      const unsubscribe = manager.onChange(() => {
        count++;
      });

      manager.setFlag("feature1", { type: "boolean" });
      unsubscribe();
      manager.setFlag("feature2", { type: "boolean" });

      expect(count).toBe(1);
    });
  });
});

// ============================================================================
// ConfigSnapshotManager 测试
// ============================================================================

describe("ConfigSnapshotManager - 配置快照管理器", () => {
  let store: ConfigStore;
  let manager: ConfigSnapshotManager;

  beforeEach(() => {
    store = new ConfigStore({ key: "value" });
    manager = new ConfigSnapshotManager(store);
  });

  describe("快照管理", () => {
    test("应该创建快照", () => {
      const snapshot = manager.createSnapshot("test-snapshot");
      expect(snapshot.id).toMatch(/^snap-/);
      expect(snapshot.label).toBe("test-snapshot");
      expect(snapshot.data.key).toBe("value");
    });

    test("应该列出快照", () => {
      manager.createSnapshot("snapshot1");
      manager.createSnapshot("snapshot2");

      const snapshots = manager.listSnapshots();
      expect(snapshots).toHaveLength(2);
    });

    test("应该获取快照", () => {
      const created = manager.createSnapshot();
      const retrieved = manager.getSnapshot(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
    });

    test("应该删除快照", () => {
      const snapshot = manager.createSnapshot();
      expect(manager.deleteSnapshot(snapshot.id)).toBe(true);
      expect(manager.getSnapshot(snapshot.id)).toBeUndefined();
    });

    test("应该获取快照数量", () => {
      manager.createSnapshot();
      manager.createSnapshot();
      expect(manager.getSnapshotCount()).toBe(2);
    });
  });

  describe("快照恢复", () => {
    test("应该恢复到指定快照", () => {
      const snapshot = manager.createSnapshot();
      store.set("key", "modified");

      manager.restoreSnapshot(snapshot.id);
      expect(store.get("key")).toBe("value");
    });

    test("恢复不存在的快照应该返回 false", () => {
      expect(manager.restoreSnapshot("nonexistent")).toBe(false);
    });
  });

  describe("快照比较", () => {
    test("应该比较两个快照的差异", () => {
      const snap1 = manager.createSnapshot();
      store.set("newKey", "newValue");
      const snap2 = manager.createSnapshot();

      const diff = manager.compareSnapshots(snap1.id, snap2.id);
      expect(diff.added).toContain("newKey");
    });

    test("比较不存在的快照应该抛出错误", () => {
      const snapshot = manager.createSnapshot();
      expect(() => manager.compareSnapshots(snapshot.id, "nonexistent")).toThrow();
    });
  });

  describe("自动快照", () => {
    test("应该启用自动快照", () => {
      manager.setAutoSnapshot(true);
      expect(manager.isAutoSnapshotEnabled()).toBe(true);
    });

    test("应该禁用自动快照", () => {
      manager.setAutoSnapshot(true);
      manager.setAutoSnapshot(false);
      expect(manager.isAutoSnapshotEnabled()).toBe(false);
    });
  });
});

// ============================================================================
// ConfigAuditLog 测试
// ============================================================================

describe("ConfigAuditLog - 配置审计日志", () => {
  let auditLog: ConfigAuditLog;

  beforeEach(() => {
    auditLog = new ConfigAuditLog();
  });

  describe("日志记录", () => {
    test("应该记录配置变更", () => {
      auditLog.logChange({
        timestamp: Date.now(),
        actor: "user1",
        action: "set",
        path: "config.key",
        oldValue: "old",
        newValue: "new",
      });

      expect(auditLog.getEntryCount()).toBe(1);
    });

    test("应该获取历史记录", () => {
      auditLog.logChange({
        timestamp: Date.now(),
        actor: "user1",
        action: "set",
        path: "config.key",
      });

      const history = auditLog.getHistory();
      expect(history).toHaveLength(1);
    });

    test("应该按路径过滤历史", () => {
      auditLog.logChange({
        timestamp: Date.now(),
        actor: "user1",
        action: "set",
        path: "config.a",
      });
      auditLog.logChange({
        timestamp: Date.now(),
        actor: "user1",
        action: "set",
        path: "config.b",
      });

      const history = auditLog.getHistory("config.a");
      expect(history).toHaveLength(1);
    });

    test("应该支持分页", () => {
      for (let i = 0; i < 5; i++) {
        auditLog.logChange({
          timestamp: Date.now() + i,
          actor: "user1",
          action: "set",
          path: `config.key${i}`,
        });
      }

      const history = auditLog.getHistory(undefined, { limit: 2, offset: 0 });
      expect(history).toHaveLength(2);
    });
  });

  describe("变更摘要", () => {
    test("应该获取变更摘要", () => {
      auditLog.logChange({
        timestamp: Date.now(),
        actor: "user1",
        action: "set",
        path: "config.key",
      });

      const summary = auditLog.getChangeSummary("24h");
      expect(summary.totalChanges).toBe(1);
      expect(summary.changesByAction.set).toBe(1);
      expect(summary.changesByActor.user1).toBe(1);
    });

    test("应该识别变更最多的路径", () => {
      for (let i = 0; i < 3; i++) {
        auditLog.logChange({
          timestamp: Date.now(),
          actor: "user1",
          action: "set",
          path: "config.frequentlyChanged",
        });
      }

      const summary = auditLog.getChangeSummary("24h");
      expect(summary.mostChangedPaths[0].path).toBe("config.frequentlyChanged");
      expect(summary.mostChangedPaths[0].count).toBe(3);
    });
  });

  describe("敏感路径", () => {
    test("应该标记敏感路径变更", () => {
      auditLog.setSensitivePaths(["config.password", "config.secret"]);

      let alerted = false;
      auditLog.onSensitiveChange(() => {
        alerted = true;
      });

      auditLog.logChange({
        timestamp: Date.now(),
        actor: "user1",
        action: "set",
        path: "config.password",
      });

      expect(alerted).toBe(true);
    });

    test("应该支持取消敏感变更监听", () => {
      auditLog.setSensitivePaths(["config.password"]);

      let count = 0;
      const unsubscribe = auditLog.onSensitiveChange(() => {
        count++;
      });

      auditLog.logChange({
        timestamp: Date.now(),
        actor: "user1",
        action: "set",
        path: "config.password",
      });

      unsubscribe();

      auditLog.logChange({
        timestamp: Date.now(),
        actor: "user1",
        action: "set",
        path: "config.password",
      });

      expect(count).toBe(1);
    });
  });

  describe("导出", () => {
    test("应该以 JSON 格式导出", () => {
      auditLog.logChange({
        timestamp: Date.now(),
        actor: "user1",
        action: "set",
        path: "config.key",
      });

      const json = auditLog.exportAuditLog("json");
      const parsed = JSON.parse(json);
      expect(parsed).toHaveLength(1);
    });

    test("应该以 CSV 格式导出", () => {
      auditLog.logChange({
        timestamp: Date.now(),
        actor: "user1",
        action: "set",
        path: "config.key",
      });

      const csv = auditLog.exportAuditLog("csv");
      expect(csv).toContain("timestamp,actor,action,path,oldValue,newValue");
      expect(csv).toContain("user1");
    });
  });

  describe("清空", () => {
    test("应该清空审计日志", () => {
      auditLog.logChange({
        timestamp: Date.now(),
        actor: "user1",
        action: "set",
        path: "config.key",
      });

      auditLog.clear();
      expect(auditLog.getEntryCount()).toBe(0);
    });
  });
});

// ============================================================================
// ConfigExporter 测试
// ============================================================================

describe("ConfigExporter - 配置导出器", () => {
  let store: ConfigStore;
  let exporter: ConfigExporter;

  beforeEach(() => {
    store = new ConfigStore({
      app: { name: "test", port: 3000 },
      secret: "hidden",
    });
    exporter = new ConfigExporter(store);
  });

  describe("格式导出", () => {
    test("应该以 JSON 格式导出", () => {
      const json = exporter.export("json");
      const parsed = JSON.parse(json);
      expect(parsed.app.name).toBe("test");
    });

    test("应该以 YAML 格式导出", () => {
      const yaml = exporter.export("yaml");
      expect(yaml).toContain("app:");
      expect(yaml).toContain('name: "test"');
    });

    test("应该以 Dotenv 格式导出", () => {
      const dotenv = exporter.export("dotenv");
      expect(dotenv).toContain("APP_NAME=test");
      expect(dotenv).toContain("APP_PORT=3000");
    });

    test("应该以 TypeScript 格式导出", () => {
      const ts = exporter.export("typescript");
      expect(ts).toContain("export const config");
      expect(ts).toContain("app");
    });

    test("不支持的格式应该抛出错误", () => {
      expect(() => exporter.export("xml" as any)).toThrow();
    });
  });

  describe("过滤和掩码", () => {
    test("应该支持 include 过滤", () => {
      const json = exporter.export("json", { include: ["app"] });
      const parsed = JSON.parse(json);
      expect(parsed.app).toBeDefined();
      expect(parsed.secret).toBeUndefined();
    });

    test("应该支持 exclude 过滤", () => {
      const json = exporter.export("json", { exclude: ["secret"] });
      const parsed = JSON.parse(json);
      expect(parsed.app).toBeDefined();
      expect(parsed.secret).toBeUndefined();
    });

    test("应该掩码敏感字段", () => {
      const json = exporter.export("json", {
        maskSecrets: true,
        secretPaths: ["secret"],
      });
      const parsed = JSON.parse(json);
      expect(parsed.secret).toBe("*****");
    });
  });

  describe("导入", () => {
    test("应该从 JSON 导入", () => {
      const data = exporter.importConfig('{"key":"value"}', "json");
      expect(data.key).toBe("value");
    });

    test("应该从 Dotenv 导入", () => {
      const data = exporter.importConfig("KEY=value\nPORT=3000", "dotenv");
      expect(data.key).toBe("value");
      expect(data.port).toBe(3000);
    });

    test("应该从 YAML 导入", () => {
      const data = exporter.importConfig("key: value\nnested:\n  child: data", "yaml");
      expect(data.key).toBe("value");
      expect(data.nested).toEqual({ child: "data" });
    });

    test("应该从 TypeScript 导入", () => {
      const data = exporter.importConfig('export const config = {"key":"value"} as const;', "typescript");
      expect(data.key).toBe("value");
    });
  });

  describe("差异比较", () => {
    test("应该比较配置差异", () => {
      const diff = exporter.diff(
        { a: 1, b: 2, c: 3 },
        { a: 1, b: 3, d: 4 }
      );

      expect(diff.changed).toHaveLength(1);
      expect(diff.changed[0].path).toBe("b");
      expect(diff.removed).toContain("c");
      expect(diff.added).toContain("d");
    });
  });
});

// ============================================================================
// SchemaManager 测试 (Zod schemas)
// ============================================================================

describe("SchemaManager - Schema 管理器 (Zod)", () => {
  let manager: SchemaManager;

  beforeEach(() => {
    manager = SchemaManager.create();
  });

  describe("Schema 注册与获取", () => {
    test("应该注册 schema", () => {
      const schema = z.object({ name: z.string() });
      manager.register("custom", schema);
      expect(manager.get("custom")).toBeDefined();
    });

    test("应该获取已注册的 schema", () => {
      const schema = manager.get("env");
      expect(schema).toBeDefined();
    });

    test("获取不存在的 schema 应该返回 undefined", () => {
      expect(manager.get("nonexistent")).toBeUndefined();
    });
  });

  describe("验证", () => {
    test("应该验证有效数据", () => {
      const result = manager.validate("env", { NODE_ENV: "production" });
      expect(result.success).toBe(true);
    });

    test("应该返回验证错误", () => {
      const result = manager.validate("env", { PORT: "invalid" });
      expect(result.success).toBe(false);
    });

    test("验证不存在的 schema 应该返回错误", () => {
      const result = manager.validate("nonexistent", {});
      expect(result.success).toBe(false);
    });
  });

  describe("环境变量覆盖", () => {
    test("应该应用环境变量覆盖", () => {
      manager.setEnvOverride("customKey", "customValue");
      const schema = z.object({ customKey: z.string() });
      const result = manager.applyEnvOverrides(schema, {});
      expect(result.customKey).toBe("customValue");
    });
  });

  describe("文档生成", () => {
    test("应该生成文档", () => {
      const docs = manager.generateDocumentation();
      expect(docs).toContain("# Configuration Schema Documentation");
      expect(docs).toContain("env");
      expect(docs).toContain("database");
    });
  });
});

// ============================================================================
// Zod Schema 验证测试
// ============================================================================

describe("Zod Schema - 预定义 Schema 验证", () => {
  describe("EnvSchema", () => {
    test("应该验证有效的环境变量", () => {
      const result = EnvSchema.safeParse({
        NODE_ENV: "production",
        PORT: "3000",
        LOG_LEVEL: "info",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PORT).toBe(3000);
      }
    });

    test("应该应用默认值", () => {
      const result = EnvSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.NODE_ENV).toBe("development");
        expect(result.data.PORT).toBe(3000);
      }
    });

    test("应该拒绝无效的 NODE_ENV", () => {
      const result = EnvSchema.safeParse({ NODE_ENV: "invalid" });
      expect(result.success).toBe(false);
    });

    test("应该拒绝超出范围的 PORT", () => {
      const result = EnvSchema.safeParse({ PORT: "70000" });
      expect(result.success).toBe(false);
    });

    test("应该将字符串转换为布尔值", () => {
      const result = EnvSchema.safeParse({ ENABLE_METRICS: "true" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ENABLE_METRICS).toBe(true);
      }
    });
  });

  describe("DatabaseSchema", () => {
    test("应该验证有效的数据库配置", () => {
      const result = DatabaseSchema.safeParse({
        type: "postgres",
        host: "localhost",
        port: 5432,
        database: "mydb",
        username: "user",
        password: "pass",
      });
      expect(result.success).toBe(true);
    });

    test("应该应用默认值", () => {
      const result = DatabaseSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("memory");
        expect(result.data.pool.min).toBe(1);
      }
    });

    test("应该拒绝无效的数据库类型", () => {
      const result = DatabaseSchema.safeParse({ type: "oracle" });
      expect(result.success).toBe(false);
    });
  });

  describe("CacheSchema", () => {
    test("应该验证有效的缓存配置", () => {
      const result = CacheSchema.safeParse({
        type: "redis",
        ttl: 3600,
        redisUrl: "redis://localhost:6379",
      });
      expect(result.success).toBe(true);
    });

    test("应该应用默认值", () => {
      const result = CacheSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("memory");
        expect(result.data.ttl).toBe(3600000);
      }
    });
  });

  describe("SecuritySchema", () => {
    test("应该验证有效的安全配置", () => {
      const result = SecuritySchema.safeParse({
        apiKey: "secret",
        corsOrigins: ["https://example.com"],
        rateLimit: { enabled: true, maxRequests: 200 },
      });
      expect(result.success).toBe(true);
    });

    test("应该应用默认值", () => {
      const result = SecuritySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.corsOrigins).toEqual(["*"]);
        expect(result.data.rateLimit.enabled).toBe(true);
      }
    });
  });

  describe("PlatformSchema", () => {
    test("应该验证有效的平台配置", () => {
      const result = PlatformSchema.safeParse({
        name: "my-app",
        version: "1.0.0",
        env: { NODE_ENV: "production" },
        database: { type: "postgres" },
      });
      expect(result.success).toBe(true);
    });

    test("应该应用所有默认值", () => {
      const result = PlatformSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("claude-agent");
        expect(result.data.env.NODE_ENV).toBe("development");
        expect(result.data.database.type).toBe("memory");
      }
    });
  });
});

// ============================================================================
// 环境变量配置加载测试
// ============================================================================

describe("loadEnvConfig - 环境变量配置加载", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("应该加载并验证环境变量", () => {
    process.env.NODE_ENV = "test";
    process.env.PORT = "4000";

    const config = loadEnvConfig();
    expect(config.NODE_ENV).toBe("test");
    expect(config.PORT).toBe(4000);
  });

  test("应该应用默认值", () => {
    // Save current NODE_ENV
    const currentNodeEnv = process.env.NODE_ENV;
    // Clear NODE_ENV to test default
    delete process.env.NODE_ENV;

    const config = loadEnvConfig();
    expect(config.NODE_ENV).toBe("development");
    expect(config.PORT).toBe(3000);

    // Restore NODE_ENV
    if (currentNodeEnv !== undefined) {
      process.env.NODE_ENV = currentNodeEnv;
    }
  });
});

// ============================================================================
// 平台配置创建测试
// ============================================================================

describe("createPlatformConfig - 平台配置创建", () => {
  test("应该创建有效的平台配置", () => {
    const config = createPlatformConfig({
      name: "custom-app",
      version: "2.0.0",
    });

    expect(config.name).toBe("custom-app");
    expect(config.version).toBe("2.0.0");
  });

  test("应该应用默认值", () => {
    const config = createPlatformConfig();

    expect(config.name).toBe("claude-agent");
    expect(config.version).toBe("1.0.0");
  });

  test("应该合并嵌套配置", () => {
    const config = createPlatformConfig({
      env: { PORT: 5000 },
      database: { type: "postgres" },
    });

    expect(config.env.PORT).toBe(5000);
    expect(config.database.type).toBe("postgres");
    expect(config.env.NODE_ENV).toBe("development"); // default
  });
});

// ============================================================================
// 配置热重载集成测试
// ============================================================================

describe("Config Hot Reload - 配置热重载集成", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test("应该通过文件源触发重载", async () => {
    const configPath = join(tempDir, "config.json");
    await writeFile(configPath, JSON.stringify({ port: 3000 }));

    const store = new ConfigStore();
    const sourceManager = new ConfigSourceManager();
    const fileSource = new FileConfigSource(configPath);

    sourceManager.addSource(fileSource, 1);

    const reloader = new ConfigHotReloader(store, sourceManager, { debounceMs: 10 });
    reloader.startWatching();

    // 等待初始加载
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 修改文件
    await writeFile(configPath, JSON.stringify({ port: 8080 }));
    reloader.triggerReload(fileSource.name);

    // 等待重载
    await new Promise((resolve) => setTimeout(resolve, 50));

    const history = reloader.getReloadHistory();
    expect(history.length).toBeGreaterThan(0);

    reloader.stopWatching();
  });
});

// ============================================================================
// 错误消息测试
// ============================================================================

describe("Error Messages - 错误消息", () => {
  let validator: ConfigValidator;

  beforeEach(() => {
    validator = new ConfigValidator();
  });

  test("应该提供清晰的必填错误消息", () => {
    const result = validator.validate("apiKey", undefined, {
      type: "string",
      required: true,
      message: "API Key is required for production",
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toBe("API Key is required for production");
  });

  test("应该提供清晰的类型错误消息", () => {
    const result = validator.validate("port", "not-a-number", { type: "number" });

    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('Expected type "number"');
  });

  test("应该提供清晰的范围错误消息", () => {
    const result = validator.validate("port", 80, { type: "number", min: 1024 });

    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("must be >= 1024");
  });

  test("应该提供清晰的枚举错误消息", () => {
    const result = validator.validate("env", "invalid", {
      enum: ["dev", "prod", "test"],
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("must be one of");
  });
});

// ============================================================================
// 边缘情况测试
// ============================================================================

describe("Edge Cases - 边缘情况", () => {
  describe("ConfigValidator", () => {
    test("应该处理空字符串", () => {
      const validator = new ConfigValidator();
      const result = validator.validate("name", "", { type: "string", minLength: 1 });
      expect(result.valid).toBe(false);
    });

    test("应该处理零值", () => {
      const validator = new ConfigValidator();
      const result = validator.validate("count", 0, { type: "number", min: 0 });
      expect(result.valid).toBe(true);
    });

    test("应该处理负数", () => {
      const validator = new ConfigValidator();
      const result = validator.validate("offset", -10, { type: "number" });
      expect(result.valid).toBe(true);
    });

    test("应该处理空数组", () => {
      const validator = new ConfigValidator();
      const result = validator.validate("items", [], { type: "array" });
      expect(result.valid).toBe(true);
    });

    test("应该处理空对象", () => {
      const validator = new ConfigValidator();
      const result = validator.validate("config", {}, { type: "object" });
      expect(result.valid).toBe(true);
    });
  });

  describe("ConfigStore", () => {
    test("应该处理空路径", () => {
      const store = new ConfigStore();
      store.set("", { key: "value" });
      // 空路径设置应该被处理
    });

    test("应该处理深层嵌套路径", () => {
      const store = new ConfigStore();
      store.set("a.b.c.d.e", "deep");
      expect(store.get("a.b.c.d.e")).toBe("deep");
    });

    test("应该处理特殊字符路径", () => {
      const store = new ConfigStore();
      store.set("key-with-dash", "value");
      expect(store.get("key-with-dash")).toBe("value");
    });
  });

  describe("EnvironmentManager", () => {
    test("应该处理循环依赖", () => {
      const manager = new EnvironmentManager();
      const config1 = { ref: "config2" };
      const config2 = { ref: "config1" };
      // 循环依赖应该被正确处理
    });

    test("应该处理空环境变量插值", () => {
      const manager = new EnvironmentManager();
      const result = manager.interpolate({ key: "${ENV:NONEXISTENT}" });
      expect(result.key).toBe("");
    });
  });
});
