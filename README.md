# MCP Task Relay (JobHub)

一个基于 MCP (Model Context Protocol) 的异步任务执行系统，支持提交、执行、工件生成和通知的完整闭环。

## 🌟 特性

- **异步任务队列**：提交任务后立即返回 job_id，通过 MCP 资源订阅或 Web UI 查看进度
- **零 Any 类型安全**：完整的 TypeScript 类型系统，使用 Zod 进行运行时校验
- **多执行器支持**：支持 Codex CLI 和 Claude Code 作为执行器
- **工件管理**：自动生成 patch.diff、TEST_PLAN、NOTES 并持久化
- **实时监控**：Web UI 仪表盘，SSE 实时更新
- **并发控制**：基于租约（lease）的并发任务执行，支持心跳续租
- **审计日志**：完整的事件日志记录所有状态变更

## 📋 系统架构

```
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│ MCP Client  │ ───▶ │   JobHub     │ ───▶ │  Executors  │
│             │      │   (Server)   │      │ (Codex/     │
│             │ ◀─── │              │      │  Claude)    │
└─────────────┘      └──────────────┘      └─────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │   SQLite     │
                     │   (WAL mode) │
                     └──────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │  Artifacts   │
                     │  (Disk)      │
                     └──────────────┘
```

## 🚀 快速开始

### 安装依赖

```bash
bun install
```

### 配置

复制 `.env.example` 到 `.env` 并根据需要修改：

```bash
cp .env.example .env
```

关键配置项：

```env
# 工件存储路径
ARTIFACT_ROOT=./artifacts

# 数据库路径
DB_PATH=./jobhub.db

# 执行器配置
CODEX_ENABLED=true
CODEX_BINARY=codex

CLAUDE_ENABLED=false
CLAUDE_BINARY=claude

# Web UI 端口
WEB_UI_PORT=3000
```

### 运行数据库迁移

```bash
bun run migrate
```

### 启动模式

#### 1. MCP 服务器模式（默认）

作为 MCP 服务器运行，通过 stdio 与 MCP 客户端通信：

```bash
bun run dev
```

#### 2. 独立工作模式

作为独立的任务执行器运行（带 Web UI）：

```bash
MCP_MODE=false bun run dev
```

访问 `http://localhost:3000` 查看 Web 仪表盘。

## 📖 使用指南

### MCP Tools

#### 1. `jobs_submit` - 提交任务

```typescript
{
  spec: {
    repo: {
      type: "git",
      url: "https://github.com/user/repo.git",
      baseBranch: "main",
      baselineCommit: "abc123..."
    },
    task: {
      title: "Add feature X",
      description: "Implement feature X with Y requirements",
      acceptance: ["Criterion 1", "Criterion 2"]
    },
    scope: {
      readPaths: ["src/"],
      fileGlobs: ["**/*.ts"],
      disallowReformatting: false
    },
    execution: {
      preferredModel: "gpt-4",
      sandbox: "read-only",
      askPolicy: "untrusted",
      priority: "P1",
      ttlS: 3600
    },
    idempotencyKey: "unique-key-123",
    outputContract: ["DIFF", "TEST_PLAN", "NOTES"]
  }
}
```

响应：

```json
{
  "jobId": "job_abc123"
}
```

#### 2. `jobs_get` - 查询任务

```typescript
{
  jobId: "job_abc123"
}
```

#### 3. `jobs_list` - 列出任务

```typescript
{
  state: "RUNNING", // 可选：QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELED
  limit: 20,
  offset: 0
}
```

#### 4. `jobs_cancel` - 取消任务

```typescript
{
  jobId: "job_abc123"
}
```

### MCP Resources

#### 查看任务状态

```
mcp://jobs/{jobId}/status
```

返回：

```json
{
  "state": "RUNNING",
  "stateVersion": 5,
  "createdAt": 1699999999000,
  "startedAt": 1700000000000,
  "attempt": 0
}
```

#### 读取工件

```
mcp://jobs/{jobId}/artifacts/patch.diff
mcp://jobs/{jobId}/artifacts/out.md
mcp://jobs/{jobId}/artifacts/logs.txt
```

### 状态机

```
QUEUED → RUNNING → SUCCEEDED
                → FAILED
                → CANCELED
                → EXPIRED
                → STALE (丢失心跳)
```

### 通知

系统会在以下情况发送 MCP 通知：

1. **资源更新**：`notifications/resources/updated`
   - 任何状态或工件变化
   - 包含 `uri` 和 `stateVersion`

2. **任务完成**：`notifications/job/finished`
   - 任务成功完成
   - 包含工件 URIs

3. **任务失败**：`notifications/job/failed`
   - 任务失败
   - 包含 `reasonCode`（BAD_ARTIFACTS, CONFLICT, POLICY, EXECUTOR_ERROR）

## 🏗️ 项目结构

```
mcp-task-relay/
├── src/
│   ├── mcp/              # MCP 服务器实现
│   │   └── server.ts
│   ├── core/             # 核心业务逻辑
│   │   ├── job-manager.ts
│   │   └── worker.ts
│   ├── db/               # 数据库层
│   │   ├── connection.ts
│   │   ├── jobs-repository.ts
│   │   ├── artifacts-repository.ts
│   │   └── events-repository.ts
│   ├── executors/        # 执行器实现
│   │   ├── base.ts
│   │   ├── codex-cli.ts
│   │   ├── claude-code.ts
│   │   └── factory.ts
│   ├── models/           # 类型定义和 Zod schemas
│   │   ├── brands.ts
│   │   ├── states.ts
│   │   ├── result.ts
│   │   └── schemas.ts
│   ├── services/         # 服务层
│   │   ├── artifacts.ts
│   │   ├── notifier.ts
│   │   └── web-ui.ts
│   ├── config/           # 配置管理
│   │   ├── schema.ts
│   │   └── index.ts
│   ├── utils/            # 工具函数
│   │   ├── logger.ts
│   │   └── hash.ts
│   └── index.ts          # 主入口
├── migrations/           # 数据库迁移
│   └── 001_initial_schema.sql
├── artifacts/            # 工件存储（运行时生成）
├── .env.example          # 配置模板
├── package.json
├── tsconfig.json
└── README.md
```

## 🔒 类型安全保证

本项目严格遵循"零 any"原则：

- ✅ 所有外部输入通过 Zod 校验
- ✅ 使用品牌类型（Branded Types）防止字符串混用
- ✅ Result 类型处理错误，避免异常抛出
- ✅ 完整的 TypeScript strict 模式
- ✅ 编译时和运行时双重类型检查

## 🧪 测试

```bash
# 类型检查
bun run typecheck

# Lint
bun run lint

# 构建
bun run build
```

## 📊 Web UI

访问 `http://localhost:3000` 查看实时仪表盘：

- 📈 任务统计（总数、运行中、成功、失败）
- 📋 任务列表（实时更新）
- 🔄 Server-Sent Events (SSE) 实时推送
- 🎨 Tailwind CSS 现代 UI

## 🛠️ 开发

### 添加新的执行器

1. 在 `src/executors/` 下创建新文件
2. 实现 `Executor` 接口
3. 在 `factory.ts` 中注册
4. 在配置 schema 中添加配置项

### 扩展通知渠道

在 `src/services/notifier.ts` 中添加新的通知方法（如 Slack, Webhook 等）。

## 📝 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📞 支持

如有问题，请提交 GitHub Issue。
