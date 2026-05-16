# Claude Agent Platform

Claude Agent Platform 是一个统一的 AI 代理开发平台，将 agent-runtime 和 claude-code-toolkit 深度融合为一个完整产品。使用 TypeScript + Bun 构建。

## 项目结构

```
claude-agent-platform/
├── package.json              # Monorepo 根配置
├── tsconfig.base.json        # 共享 TypeScript 配置
├── bun.lock                  # 依赖锁文件
├── VERIFICATION_REPORT.md    # 验证报告
├── packages/
│   ├── types/                # @claude-agent/types - 统一类型定义
│   ├── errors/               # @claude-agent/errors - 统一错误处理
│   ├── logger/               # @claude-agent/logger - 结构化日志系统
│   ├── config/               # @claude-agent/config - 配置管理系统
│   ├── core/                 # @claude-agent/core - 核心引擎
│   ├── pipeline/             # @claude-agent/pipeline - 任务管道系统
│   ├── plugins/              # @claude-agent/plugins - 插件系统
│   ├── orchestrator/         # @claude-agent/orchestrator - 智能编排
│   ├── perf/                 # @claude-agent/perf - 性能优化与内存管理
│   ├── cli/                  # @claude-agent/cli - 统一 CLI
│   ├── http/                 # @claude-agent/http - HTTP 服务
│   │   # --- Part A: 重构模块 ---
│   ├── config-schema/        # @claude-agent/config-schema - 统一配置 Schema
│   ├── middleware/            # @claude-agent/middleware - 中间件系统
│   ├── event-sourcing/       # @claude-agent/event-sourcing - 事件溯源
│   ├── commands/             # @claude-agent/commands - 命令模式 (CQRS)
│   ├── domain-events/        # @claude-agent/domain-events - 领域事件
│   ├── repository/           # @claude-agent/repository - 仓储模式
│   ├── specification/        # @claude-agent/specification - 规格模式
│   ├── strategy/             # @claude-agent/strategy - 策略模式
│   ├── observer/             # @claude-agent/observer - 观察者模式
│   ├── decorators/           # @claude-agent/decorators - 装饰器模式
│   │   # --- Part B: 完善模块 ---
│   ├── repl/                 # @claude-agent/repl - 交互式 REPL
│   ├── config-wizard/        # @claude-agent/config-wizard - 配置向导
│   ├── themes/               # @claude-agent/themes - 主题系统
│   ├── i18n/                 # @claude-agent/i18n - 国际化
│   ├── shell-completions/    # @claude-agent/shell-completions - Shell 补全
│   ├── update-checker/       # @claude-agent/update-checker - 更新检查
│   ├── diagnostics/          # @claude-agent/diagnostics - 诊断工具
│   ├── exporter/             # @claude-agent/exporter - 导出功能
│   ├── examples/             # @claude-agent/examples - 示例项目
│   └── api-docs/             # @claude-agent/api-docs - API 文档
├── apps/
│   └── claude-agent/         # 主应用入口
├── tests/                    # 测试文件 (652 tests)
└── docs/                     # 文档
```

## 快速开始

```bash
# 安装依赖
bun install

# 运行测试 (652 tests, 0 failures)
bun test

# 启动应用
bun run apps/claude-agent/src/bin.ts --help
```

## CLI 命令

```
claude-agent run <task>        运行代理任务
claude-agent analyze [path]    代码分析
claude-agent test [pattern]    运行测试
claude-agent graph [path]      依赖图生成
claude-agent devops <action>   DevOps 自动化
claude-agent design <action>   设计系统生成
claude-agent monitor           性能监控
claude-agent checkpoint <act>  检查点管理
claude-agent ask "<task>"      自然语言任务（智能编排）
```

## 子包说明

### 核心包 (Core)

| 包 | 说明 |
|---|---|
| `@claude-agent/types` | 统一类型定义，品牌类型，接口规范 |
| `@claude-agent/errors` | 错误类层次，错误码，全局错误处理 |
| `@claude-agent/logger` | 结构化日志，多传输层，子日志器 |
| `@claude-agent/config` | Zod 配置验证，热重载，多级配置 |
| `@claude-agent/core` | AgentCore, EventBus, LifecycleManager |
| `@claude-agent/pipeline` | PipelineEngine, PipelineBuilder, 中间件 |
| `@claude-agent/plugins` | PluginSystem, 6 个内置插件 |
| `@claude-agent/orchestrator` | NLTaskParser, TaskDecomposer, SmartOrchestrator |
| `@claude-agent/perf` | ObjectPool, LRUCache, BatchProcessor 等 11 个性能模块 |
| `@claude-agent/http` | HealthServer, HealthCheckRegistry |
| `@claude-agent/cli` | ClaudeAgentCLI, ProgressBar, 9 个子命令 |

### 重构模块 (Part A - Design Patterns)

| 包 | 说明 | 核心类 |
|---|---|---|
| `@claude-agent/config-schema` | 统一配置 Schema，环境变量覆盖，文档生成 | SchemaManager, EnvSchema, PlatformSchema |
| `@claude-agent/middleware` | 请求/响应中间件系统 | MiddlewarePipeline, logging/auth/cors/rateLimit 中间件 |
| `@claude-agent/event-sourcing` | 事件溯源，快照，投影，重放 | InMemoryEventStore, AggregateRoot, SnapshotStrategy, ProjectionManager |
| `@claude-agent/commands` | 命令模式 (CQRS)，验证，历史 | CommandBus, CommandHandler, CommandValidator |
| `@claude-agent/domain-events` | 领域事件，版本控制，序列化 | DomainEventBus, EventAggregator, EventVersionManager |
| `@claude-agent/repository` | 仓储模式，缓存/日志装饰器 | InMemoryRepository, CachedRepository, LoggingRepository |
| `@claude-agent/specification` | 规格模式，可组合查询 | eq/ne/gt/lt/between/regex, QueryBuilder |
| `@claude-agent/strategy` | 策略模式，注册表，组合 | StrategyRegistry, CompositeStrategy, FallbackStrategy |
| `@claude-agent/observer` | 观察者模式，发布-订阅 | Subject, PubSub, ObservableLifecycle |
| `@claude-agent/decorators` | 装饰器模式，日志/缓存/重试/计时 | LoggingDecorator, CachingDecorator, RetryDecorator |

### 完善模块 (Part B - Enhancements)

| 包 | 说明 | 核心类 |
|---|---|---|
| `@claude-agent/repl` | 交互式 REPL，命令历史，自动补全 | ClaudeREPL |
| `@claude-agent/config-wizard` | 配置向导，验证，导入/导出 | ConfigWizard |
| `@claude-agent/themes` | 主题系统，亮色/暗色，CSS 变量 | ThemeManager |
| `@claude-agent/i18n` | 国际化，多语言 (en/zh/ja) | I18nManager |
| `@claude-agent/shell-completions` | Shell 补全 (Bash/Zsh/Fish/PowerShell) | ShellCompletionGenerator |
| `@claude-agent/update-checker` | 版本检测，更新通知 | UpdateChecker |
| `@claude-agent/diagnostics` | 环境诊断，依赖检查 | DiagnosticsRunner |
| `@claude-agent/exporter` | JSON/Markdown/HTML/PDF 导出 | Exporter |
| `@claude-agent/examples` | 5 个完整示例项目 | EXAMPLES |
| `@claude-agent/api-docs` | API 文档生成，搜索 | APIDocumentation |

## 测试

```bash
# 运行所有测试 (652 tests)
bun test

# 运行特定包测试
bun test tests/config-schema.test.ts
bun test tests/middleware.test.ts
bun test tests/event-sourcing.test.ts
bun test tests/commands.test.ts
bun test tests/domain-events.test.ts
bun test tests/repository.test.ts
bun test tests/specification.test.ts
bun test tests/strategy.test.ts
bun test tests/observer.test.ts
bun test tests/decorators.test.ts
bun test tests/repl.test.ts
bun test tests/config-wizard.test.ts
bun test tests/themes.test.ts
bun test tests/i18n.test.ts
bun test tests/shell-completions.test.ts
bun test tests/update-checker.test.ts
bun test tests/diagnostics.test.ts
bun test tests/exporter.test.ts
bun test tests/examples.test.ts
bun test tests/api-docs.test.ts
```

### 测试统计

| 指标 | 数值 |
|------|------|
| 总测试数 | 652 |
| 通过 | 652 |
| 失败 | 0 |
| 通过率 | 100% |
| 新增测试文件 | 20 |
| 新增包 | 20 |

### 性能基准结果

| 操作 | 平均耗时 |
|---|---|
| ObjectPool: acquire + release | ~0.2 us |
| LRUCache: set + get | ~0.1 us |
| Binary: encode + decode | ~4.5 us |
| BatchProcessor: 10000 items | ~139 ms |
| StartupOptimizer: parallel tasks | ~53 ms |

## 技术栈

- **Runtime**: Bun 1.3+
- **Language**: TypeScript 5.6+
- **Validation**: Zod 3.23+
- **Testing**: Bun 内置测试运行器
- **Architecture**: Monorepo (Bun Workspaces)
- **Design Patterns**: Event Sourcing, CQRS, Repository, Specification, Strategy, Observer, Decorator, Middleware

## 路线图

详细的路线图文档请参阅 [Claude_Agent_Platform_完整路线图.docx](./Claude_Agent_Platform_完整路线图.docx)。

### 短期计划 (1-3 月)
1. REPL 真实终端集成
2. 配置向导 CLI 集成
3. Web 仪表板开发
4. 持久化存储实现
5. gRPC/IPC 通信层
6. 安全审计自动化
7. 测试覆盖率门禁 (80%+)
8. 性能基准测试套件
9. NPM 发布流程
10. 完整示例项目

### 中期计划 (3-6 月)
1. 分布式事件存储
2. 插件市场
3. AI 集成层
4. 可视化管道编辑器
5. 多租户支持
6. 实时监控系统
7. GraphQL API
8. 自动缩放
9. WebSocket 实时通信
10. 国际化完善

### 长期计划 (6-12 月)
1. 云原生部署 (Kubernetes)
2. 低代码平台
3. 多模型编排
4. 知识图谱
5. SaaS 托管服务
6. 软件开发工具集成
7. 安全合规认证
8. 边缘计算集成
9. 自然语言编程接口
10. 开源社区建设
