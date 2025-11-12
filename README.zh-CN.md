# MCP Task Relay

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-green.svg)](https://nodejs.org/)

> 中文文档 | **[English](README.md)**

MCP Task Relay 是一个生产就绪的 Model Context Protocol (MCP) 服务器，为自主代理提供复杂的调度器/执行器工作流。构建于企业级可靠性之上，采用智能问答（Ask/Answer）协议和密码学上下文验证，有效防止上下文漂移，同时将 token 使用量减少 95% 以上。

## 架构概览

```
┌─────────────┐    MCP 协议         ┌──────────────┐
│   MCP       │ ◄──────────────────► │  调度器       │
│   客户端     │   (stdio/SSE)       │  (Relay)     │
│ (Claude/    │                      │              │
│  Codex)     │                      │  ┌────────┐  │
└─────────────┘                      │  │回答     │  │
                                     │  │执行器   │  │
                                     │  │(LLM)   │  │
                                     │  └────────┘  │
                                     │      ▲       │
                                     │      │ Ask   │
                                     │      ▼       │
       ┌─────────────────────────────┤  ┌────────┐ │
       │   Ask/Answer 协议           │  │上下文  │ │
       │   (上下文信封)              │  │信封    │ │
       │   ┌──────────────┐          │  │+ Hash  │ │
       │   │ Executor SDK │ ◄────────┤  └────────┘ │
       │   └──────────────┘          │              │
       │   作业执行环境              └──────────────┘
       └──────────────────────────────────────────────┘
```

**核心创新：** 上下文信封协议（Context Envelope Protocol）通过 SHA-256 验证确保执行器（Executor）和回答执行器（Answer Runner）之间的上下文完全对齐，消除上下文漂移并最小化 token 开销。

---

## ✨ 核心特性

### 🔐 上下文信封协议

通过显式、可验证的上下文快照防止上下文漂移：

- **密码学验证**：SHA-256 哈希确保上下文完整性
- **Token 优化**：~50 tokens（最小）vs 10k-50k tokens（完整历史）
- **零会话记忆**：每个 Ask 独立处理，完全重建上下文
- **回答证明**：密码学证明使用的上下文/角色/模型/工具

### 🤖 智能问答系统

- **四层提示架构**：基础 → 角色 → 上下文 → 任务
- **角色目录**：基于 YAML 的可扩展角色定义
- **LLM 集成**：Anthropic Claude，自动重试和验证
- **JSON Schema 验证**：类型安全的响应与 schema 强制执行
- **决策缓存**：消除相同查询的冗余 LLM 调用

### 💾 企业级存储

- **SQLite with WAL 模式**：高性能并发访问
- **自动 Schema 管理**：无需手动迁移
- **内存模式**：完美适配测试和 CI/CD
- **完整审计跟踪**：所有状态转换的完整事件追踪

### 📊 生产级可观测性

- **结构化日志**：通过 Pino 输出 JSON 日志
- **实时更新**：Server-Sent Events (SSE) 推送作业/问答状态
- **全面指标**：请求延迟、缓存命中率、token 使用量

---

## 🚀 快速开始

### 环境要求

- **Node.js** ≥ 20
- **npm** 或 **bun** 1.3+
- **Anthropic API Key**（用于 Answer Runner）

### 安装

```bash
# NPM（推荐用于生产环境）
npm install -g mcp-task-relay

# 或使用 npx 进行一次性执行
npx -y mcp-task-relay@latest serve --profile dev
```

### 基本使用

```bash
# 使用内存存储启动（开发环境）
mcp-task-relay serve \
  --profile dev \
  --storage memory \
  --config-dir ./.mcp-task-relay

# 使用持久化存储启动（生产环境）
export ANTHROPIC_API_KEY="sk-ant-..."
mcp-task-relay serve \
  --profile prod \
  --storage sqlite \
  --sqlite ./data/relay.db \
  --config-dir ./config
```

---

## 📖 配置

### CLI 选项

| 参数 | 说明 | 环境变量 |
|------|------|---------|
| `--profile <env>` | 环境配置文件 (dev/staging/prod) | `TASK_RELAY_PROFILE` |
| `--config-dir <dir>` | 配置目录路径 | `TASK_RELAY_CONFIG_DIR` |
| `--storage <type>` | 存储后端 (memory/sqlite) | `TASK_RELAY_STORAGE` |
| `--sqlite <path>` | SQLite 数据库文件路径 | `TASK_RELAY_SQLITE_URL` |
| `--transport <type>` | 传输协议 (Phase 2 仅支持 stdio) | `TASK_RELAY_TRANSPORT` |

### 环境变量

**必需：**
- `ANTHROPIC_API_KEY` — Anthropic API 密钥（用于 Answer Runner）

**可选：**
- `TASK_RELAY_PROMPTS_DIR` — 自定义提示词目录
- `TASK_RELAY_SCHEMATA_DIR` — 自定义 JSON schemas 目录
- `TASK_RELAY_POLICY_FILE` — 自定义策略 YAML 文件
- `TASK_RELAY_ANSWER_RUNNER_ENABLED` — 启用/禁用 Answer Runner（默认：true）

**上下文信封（执行器侧）：**
- `TASK_RELAY_JOB_ID` — 当前作业标识符
- `TASK_RELAY_STEP_ID` — 当前执行步骤
- `TASK_RELAY_REPO` — 仓库标识符
- `TASK_RELAY_COMMIT_SHA` — Git commit SHA
- `TASK_RELAY_POLICY_VERSION` — 策略版本
- `TASK_RELAY_FACT_*` — 自定义事实（例如：`TASK_RELAY_FACT_branch=main`）

### 配置目录结构

```
.mcp-task-relay/
├── config.yaml              # 主配置文件
├── policy.yaml              # 安全策略规则
├── prompts/                 # 角色定义
│   ├── role.diff_planner@v1.yaml
│   ├── role.test_planner@v1.yaml
│   └── role.schema_summarizer@v1.yaml
└── schemata/                # JSON Schemas
    ├── ask.schema.json
    ├── answer.schema.json
    └── artifacts/
        ├── diff_plan.schema.json
        └── test_plan.schema.json
```

**示例 `config.yaml`：**

```yaml
askAnswer:
  port: 3415
  longPollTimeoutSec: 25
  sseHeartbeatSec: 10
  runner:
    enabled: true
    model: claude-3-5-sonnet-20241022
    maxRetries: 1
    defaultTimeout: 60
```

---

## 🔧 MCP 客户端集成

### Codex CLI

```bash
# 添加到 Codex 配置
codex mcp add task-relay -- \
  mcp-task-relay serve \
  --profile prod \
  --storage sqlite \
  --sqlite ./relay.db
```

### Claude Code (桌面版)

添加到 Claude Code MCP 设置（`~/.claude-code/mcp.json`）：

```json
{
  "mcpServers": {
    "task-relay": {
      "command": "mcp-task-relay",
      "args": [
        "serve",
        "--profile", "prod",
        "--storage", "sqlite",
        "--sqlite", "./relay.db"
      ],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

### Gemini Code Assist

```bash
# 在 Gemini 工作区设置中配置
gemini config mcp add task-relay \
  --command "mcp-task-relay serve" \
  --args "--profile prod --storage sqlite"
```

---

## 🎯 上下文信封协议

### 概述

上下文信封协议通过显式、密码学验证的上下文快照消除上下文漂移。

**问题：** 传统方法需要传输完整对话历史（10k-50k tokens），导致：
- 巨大的 token 使用量和成本
- 上下文窗口限制
- 执行器与回答执行器之间可能的上下文不对齐

**解决方案：** 结构化上下文快照 + SHA-256 验证（50-300 tokens）。

### Token 使用量对比

| 方法 | Token 使用量 | 上下文完整性 | 使用场景 |
|------|-------------|-------------|---------|
| **无上下文** | ~50 tokens | 无 | Answer Runner 对上下文盲目 ❌ |
| **上下文信封** | **50-300 tokens** | **密码学验证** | **95%+ 场景的最优方案** ✅ |
| **完整历史** | 10k-50k tokens | 完整 | 需要完整上下文的复杂决策 |

### 上下文信封结构

**最小（默认环境）：**
```json
{
  "job_snapshot": {},
  "role": "default"
}
```
**Token 成本：** ~50 tokens

**典型（生产环境 + 自定义事实）：**
```json
{
  "job_snapshot": {
    "repo": "github.com/user/repo",
    "commit_sha": "abc123def456...",
    "env_profile": "production",
    "policy_version": "2.0"
  },
  "facts": {
    "branch": "main",
    "pr_number": "123"
  },
  "tool_caps": {
    "database": {
      "timeout_ms": 5000
    }
  },
  "role": "code_reviewer"
}
```
**Token 成本：** ~150-200 tokens

### 验证流程

```
1. 执行器构建 context_envelope
   └─► 计算 SHA-256 哈希 → context_hash

2. 发送包含 context_envelope + context_hash 的 Ask

3. 调度器将 Ask 存储到数据库

4. Answer Runner 检索 Ask
   ├─► 验证：computed_hash == stored_hash
   └─► 不匹配时立即失败（E_CONTEXT_MISMATCH）

5. Answer Runner 生成响应
   └─► 创建包含 context_hash 的证明（attestation）

6. 将 Answer 发送回执行器

7. 执行器验证证明
   └─► 确保 context_hash 与原始值匹配
```

### 错误代码

- **E_CONTEXT_MISMATCH** — 上下文哈希验证失败
- **E_CAPS_VIOLATION** — 工具能力约束违规
- **E_NO_CONTEXT_ENVELOPE** — 缺少必需的上下文信封

### 智能默认值（Token 优化）

SDK 自动省略默认值以最小化 token 使用量：

- `repo`：如果是 "unknown"（默认值）则省略
- `commit_sha`：如果是 "unknown"（默认值）则省略
- `env_profile`：如果是 "dev"（默认值）则省略
- `policy_version`：如果是 "1.0"（默认值）则省略
- `facts`：如果为空则省略
- `tool_caps`：如果没有工具则省略

**结果：** 在典型场景中减少 75-85% 的 token 使用量。

---

## 🛠️ 开发

### 从源码构建

```bash
# 克隆仓库
git clone https://github.com/royisme/mcp-task-relay.git
cd mcp-task-relay

# 安装依赖
npm install

# 构建
npm run build

# 运行测试
npm test

# 本地开发链接
npm link
```

### 项目结构

```
src/
├── cli.ts                   # CLI 入口点
├── server.ts                # 运行时引导
├── answer-runner/           # LLM 驱动的回答引擎
│   ├── runner.ts            # 核心 Answer Runner
│   ├── role-catalog.ts      # YAML 角色加载器
│   └── prompt-builder.ts    # 四层提示架构
├── core/                    # 业务逻辑
│   └── job-manager.ts       # 作业编排
├── db/                      # 数据持久化
│   ├── connection.ts        # SQLite 设置
│   ├── asks-repository.ts   # Ask/Answer 存储
│   └── answers-repository.ts
├── models/                  # 类型定义
│   ├── schemas.ts           # Zod schemas
│   └── states.ts            # 状态机 & 错误代码
├── sdk/                     # 执行器 SDK
│   └── executor.ts          # 上下文信封自动打包
├── services/                # HTTP/SSE 服务
│   └── ask-answer.ts        # Ask/Answer API 端点
└── utils/                   # 共享工具
    ├── hash.ts              # 上下文哈希 & 验证
    └── logger.ts            # 结构化日志

prompts/                     # 内置角色目录
schemata/                    # JSON Schema 定义
```

---

## 🤝 贡献

欢迎贡献！在提交 PR 之前，请阅读我们的[贡献指南](CONTRIBUTING.md)。

### 开发工作流

1. Fork 仓库
2. 创建特性分支（`git checkout -b feature/amazing-feature`）
3. 提交更改（`git commit -m 'Add amazing feature'`）
4. 推送到分支（`git push origin feature/amazing-feature`）
5. 打开 Pull Request

---

## 📄 许可证

MIT © 2025 Roy。详见 [LICENSE](LICENSE)。

---

## 🙏 致谢

- **Anthropic** — Claude API 和 MCP 规范
- **Better-SQLite3** — 高性能 SQLite 绑定
- **Zod** — 类型安全的 schema 验证

---

## 📮 支持

- **问题反馈**：[GitHub Issues](https://github.com/royisme/mcp-task-relay/issues)
- **讨论交流**：[GitHub Discussions](https://github.com/royisme/mcp-task-relay/discussions)
