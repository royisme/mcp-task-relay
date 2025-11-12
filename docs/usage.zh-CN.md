# MCP Task Relay 使用指南

> 中文文档 | **[English](usage.md)**

本文档面向 **使用者**，介绍如何安装、配置和使用 MCP Task Relay。

---

## 目录

- [安装](#安装)
- [快速开始](#快速开始)
- [配置](#配置)
- [MCP 客户端集成](#mcp-客户端集成)
- [回答执行器（Answer Runner）](#回答执行器answer-runner)
- [上下文信封协议](#上下文信封协议)
- [示例测试](#示例测试)
- [常见问题](#常见问题)

---

## 安装

### 方式 1：NPM 全局安装（推荐）

```bash
npm install -g mcp-task-relay
```

安装后可直接使用 `mcp-task-relay` 命令。

### 方式 2：使用 npx（无需安装）

```bash
npx -y mcp-task-relay@latest serve --profile dev
```

适用于一次性使用或测试场景。

### 方式 3：从源码构建

```bash
# 克隆仓库
git clone https://github.com/royisme/mcp-task-relay.git
cd mcp-task-relay

# 安装依赖
npm install

# 构建
npm run build

# 本地链接（可选）
npm link
```

---

## 快速开始

### 最小化配置（开发环境）

```bash
# 设置 Anthropic API 密钥
export ANTHROPIC_API_KEY="sk-ant-..."

# 使用内存存储启动
mcp-task-relay serve \
  --profile dev \
  --storage memory \
  --config-dir ./.mcp-task-relay
```

**说明：**
- `--profile dev`：启用开发模式日志（详细输出）
- `--storage memory`：使用内存数据库（重启后数据丢失）
- `--config-dir ./.mcp-task-relay`：配置文件目录

### 生产环境配置

```bash
# 设置 Anthropic API 密钥
export ANTHROPIC_API_KEY="sk-ant-..."

# 使用 SQLite 持久化存储
mcp-task-relay serve \
  --profile prod \
  --storage sqlite \
  --sqlite ./data/relay.db \
  --config-dir ./config
```

**说明：**
- `--profile prod`：生产模式（精简日志）
- `--storage sqlite`：使用 SQLite 持久化存储
- `--sqlite ./data/relay.db`：数据库文件路径

---

## 配置

### CLI 选项

| 选项 | 说明 | 环境变量 |
|-----|------|---------|
| `--profile <env>` | 环境配置（dev/staging/prod） | `TASK_RELAY_PROFILE` |
| `--config-dir <dir>` | 配置目录路径 | `TASK_RELAY_CONFIG_DIR` |
| `--storage <type>` | 存储类型（memory/sqlite） | `TASK_RELAY_STORAGE` |
| `--sqlite <path>` | SQLite 数据库路径 | `TASK_RELAY_SQLITE_URL` |
| `--transport <type>` | 传输协议（Phase 2 仅支持 stdio） | `TASK_RELAY_TRANSPORT` |

### 环境变量

**必需：**
```bash
export ANTHROPIC_API_KEY="sk-ant-..."  # Anthropic API 密钥
```

**可选：**
```bash
export TASK_RELAY_PROMPTS_DIR="./custom-prompts"      # 自定义提示词目录
export TASK_RELAY_SCHEMATA_DIR="./custom-schemas"     # 自定义 Schema 目录
export TASK_RELAY_POLICY_FILE="./policy.yaml"         # 自定义策略文件
export TASK_RELAY_ANSWER_RUNNER_ENABLED=true          # 启用/禁用 Answer Runner
```

### 配置文件（config.yaml）

在配置目录创建 `config.yaml`：

```yaml
# Ask/Answer 配置
askAnswer:
  port: 3415                # Ask/Answer HTTP 端口
  longPollTimeoutSec: 25    # 长轮询超时（秒）
  sseHeartbeatSec: 10       # SSE 心跳间隔（秒）

  # Answer Runner 配置
  runner:
    enabled: true                        # 启用自动回答
    model: claude-3-5-sonnet-20241022   # Claude 模型
    maxRetries: 1                        # 最大重试次数
    defaultTimeout: 60                   # 默认超时（秒）
```

### 配置目录结构

```
.mcp-task-relay/
├── config.yaml              # 主配置文件
├── policy.yaml              # 安全策略（可选）
├── prompts/                 # 角色提示词
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

---

## MCP 客户端集成

### Codex CLI

```bash
# 添加 MCP 服务器到 Codex
codex mcp add task-relay -- \
  mcp-task-relay serve \
  --profile prod \
  --storage sqlite \
  --sqlite ./relay.db

# 验证配置
codex mcp list

# 使用示例
codex ask "创建一个新的 feature 分支并实现用户认证"
```

### Claude Code（桌面版）

**步骤 1：** 编辑 MCP 配置文件

打开 `~/.claude-code/mcp.json` 或 `~/Library/Application Support/Claude/mcp.json`：

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

**步骤 2：** 重启 Claude Code

**步骤 3：** 验证连接

在 Claude Code 中输入：
```
列出所有可用的 MCP 工具
```

### Gemini Code Assist

```bash
# 配置 MCP 服务器
gemini config mcp add task-relay \
  --command "mcp-task-relay serve" \
  --args "--profile prod --storage sqlite --sqlite ./relay.db"

# 验证
gemini mcp status
```

---

## 回答执行器（Answer Runner）

调度器自动使用 LLM 驱动的 Answer Runner 处理 Ask 消息。

### 工作原理

1. 执行器发送 Ask（例如："RESOURCE_FETCH" 获取 schema 信息）
2. Answer Runner 从 `prompts/` 加载对应角色
3. 构建分层提示：基础 → 角色 → 上下文 → 任务
4. 调用 Anthropic Claude API
5. 验证 JSON 响应是否符合 schema
6. 将 Answer 记录回作业

### 配置

**启用 Answer Runner：**

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
mcp-task-relay serve --profile dev
```

**禁用自动处理：**

```bash
export TASK_RELAY_ANSWER_RUNNER_ENABLED=false
mcp-task-relay serve --profile dev
```

或通过配置文件（`.mcp-task-relay/config.yaml`）：

```yaml
askAnswer:
  runner:
    enabled: false
```

### 上下文信封协议

为防止执行器和回答执行器之间的上下文漂移，每个 Ask 都包含带密码学验证的显式**上下文信封**：

**上下文信封结构（完整示例）：**
```json
{
  "job_snapshot": {
    "repo": "github.com/user/repo",
    "commit_sha": "abc123...",
    "env_profile": "production",
    "policy_version": "2.0"
  },
  "facts": {
    "custom_fact": "value"
  },
  "tool_caps": {
    "database": {
      "timeout_ms": 5000
    }
  },
  "role": "diff_planner"
}
```

**最小示例（默认环境）：**
```json
{
  "job_snapshot": {},
  "role": "default"
}
```

**Token 优化：**
上下文信封使用智能默认值来最小化 token 使用：
- `job_snapshot` 字段如果使用默认值则省略（repo: unknown, commit_sha: unknown, env_profile: dev, policy_version: 1.0）
- `facts` 如果为空则省略（job_id/step_id 已在 Ask payload 中）
- `tool_caps` 如果没有工具则省略
- 典型最小信封：**~50 tokens** vs **200-300 tokens**（完整信封）
- 在默认配置下减少 **75-85%** 带宽

**验证流程：**
1. 执行器构建 context_envelope 并计算 SHA-256 哈希（context_hash）
2. Ask 同时发送 context_envelope 和 context_hash
3. Answer Runner 在处理前验证哈希是否匹配（不匹配时立即失败）
4. Answer Runner 生成证明，证明使用了哪些 context/role/model/tools
5. 执行器验证 answer 证明是否匹配原始 context_hash

**错误代码：**
- `E_CONTEXT_MISMATCH` — 上下文哈希验证失败
- `E_CAPS_VIOLATION` — 工具能力约束违规
- `E_NO_CONTEXT_ENVELOPE` — 缺少必需的上下文信封

**执行器环境变量：**
```bash
export TASK_RELAY_JOB_ID="job_123"
export TASK_RELAY_STEP_ID="step_456"
export TASK_RELAY_REPO="github.com/user/repo"
export TASK_RELAY_COMMIT_SHA="abc123..."
export TASK_RELAY_PROFILE="dev"
export TASK_RELAY_POLICY_VERSION="1.0"
export TASK_RELAY_FACT_custom_key="value"  # 自定义 facts，使用 TASK_RELAY_FACT_ 前缀
```

执行器 SDK 自动构建和验证上下文信封——无需手动干预。

---

## 示例测试

```bash
# 1. 设置 API 密钥
export ANTHROPIC_API_KEY="sk-ant-..."

# 2. 创建配置目录
mkdir -p .mcp-task-relay/prompts .mcp-task-relay/schemata/artifacts
cp -r prompts/* .mcp-task-relay/prompts/
cp -r schemata/* .mcp-task-relay/schemata/

# 3. 启动服务器
mcp-task-relay serve \
  --profile dev \
  --storage memory \
  --config-dir ./.mcp-task-relay

# 4. 验证（在另一个终端）
# 使用 MCP 客户端连接并测试 Ask/Answer 流程
```

---

## 常见问题

**Q: 为什么只支持 stdio？**
A: Phase 2 优先考虑可靠性和简单性。远程 HTTP 传输将在未来版本中提供。

**Q: 如何自定义角色或策略？**
A: 创建 `.mcp-task-relay/` 目录并放入自定义配置，使用 `--config-dir` 指向它。

**Q: 需要数据库迁移吗？**
A: 不需要。表在首次运行时自动创建。开发时使用内存模式。

**Q: 什么是 Answer Runner？**
A: 调度器侧的 LLM 引擎，使用基于角色的提示和 Anthropic Claude 自动处理 Ask 消息。

**Q: 可以禁用自动回答处理吗？**
A: 是的，设置 `TASK_RELAY_ANSWER_RUNNER_ENABLED=false` 或配置 `askAnswer.runner.enabled: false`。

**Q: 支持哪些 LLM 模型？**
A: 目前仅支持 Anthropic Claude（可通过 `askAnswer.runner.model` 配置）。默认为 `claude-3-5-sonnet-20241022`。

**Q: 如何调试 Answer Runner 问题？**
A: 设置 `TASK_RELAY_PROFILE=dev` 以获取调试级别日志。检查日志中的 "Answer Runner initialized" 和 "Processing Ask with Answer Runner"。

**Q: 如果没有 Anthropic API 密钥怎么办？**
A: 禁用 Answer Runner（`TASK_RELAY_ANSWER_RUNNER_ENABLED=false`）。Asks 将保持 `PENDING` 状态，直到通过 HTTP API 手动回答。

**Q: 什么是上下文信封协议？**
A: 一种显式、结构化的上下文快照，防止执行器和回答执行器之间的上下文漂移。每个 Ask 包含带密码学哈希验证（SHA-256）的上下文信封。Answer Runner 在处理前验证哈希，并生成证明表明使用了哪些 context/role/model。

**Q: 需要手动构建上下文信封吗？**
A: 不需要。执行器 SDK（`src/sdk/executor.ts`）自动从环境变量构建上下文信封并计算哈希。验证在两侧（Runner 和 Executor）自动进行。

**Q: 上下文验证失败会怎样？**
A: Answer Runner 立即返回 `E_CONTEXT_MISMATCH` 错误（快速失败）。执行器 SDK 也会验证 answer 证明，如果上下文哈希不匹配则抛出相同错误。

**Q: 如何向上下文信封传递自定义 facts？**
A: 使用带 `TASK_RELAY_FACT_` 前缀的环境变量。例如，`TASK_RELAY_FACT_branch=main` 会向 facts 对象添加 `"branch": "main"`。

**Q: 上下文信封会增加多少 token 使用量？**
A: 非常少。使用智能默认值时，最小信封约 **~50 tokens**（仅 role 字段）。带自定义 facts 的典型信封为 **100-150 tokens**。这比传输完整对话历史（10k-50k tokens）**小 95% 以上**。

**Q: 可以进一步减少 token 使用吗？**
A: 是的。SDK 自动跳过默认值：
- 除非需要，不要设置 `TASK_RELAY_REPO`/`TASK_RELAY_COMMIT_SHA`（默认为 "unknown"）
- 除非非 dev 环境，不要设置 `TASK_RELAY_PROFILE`（默认为 "dev"）
- 除非非 1.0 版本，不要设置 `TASK_RELAY_POLICY_VERSION`（默认为 "1.0"）
- 避免不必要的 `TASK_RELAY_FACT_*` 环境变量
- 仅在需要时使用 `role_id`（默认为基于类型的角色）
