# 快速开始

本指南将引导你在 10 分钟内完成 MCP Task Relay 的设置并提交第一个任务。

## 前置要求

开始之前，请确保你已安装：

- **Node.js** ≥ 20.0.0
- **Bun**（推荐）或 npm
- **Git** 用于仓库操作
- **Python 3**（可选，用于 MkDocs 文档）

### 安装 Bun

```bash
# macOS/Linux
curl -fsSL https://bun.sh/install | bash

# 或使用 npm
npm install -g bun
```

## 安装步骤

### 步骤 1: 克隆仓库

```bash
git clone https://github.com/royisme/mcp-task-relay
cd mcp-task-relay
```

### 步骤 2: 安装依赖

```bash
bun install
```

这会安装所有必需的包：

- `@modelcontextprotocol/sdk`: MCP 协议实现
- `better-sqlite3`: 高性能 SQLite 绑定
- `zod`: 运行时类型验证
- `execa`: 进程执行
- `pino`: 结构化日志

### 步骤 3: 配置环境

```bash
cp .env.example .env
```

编辑 `.env` 自定义设置：

```dotenv
# 存储
ARTIFACT_ROOT=./artifacts
DB_PATH=./jobhub.db

# 执行器
CODEX_ENABLED=true
CODEX_BINARY=codex

CLAUDE_ENABLED=false
CLAUDE_BINARY=claude

# Web UI
WEB_UI_PORT=3000

# 日志
LOG_LEVEL=info
LOG_PRETTY=true
```

### 步骤 4: 初始化数据库

```bash
bun run migrate
```

这将创建启用了 WAL 模式的 SQLite 数据库，以支持并发访问：

```sql
-- 创建的表：
-- jobs: 任务元数据和状态
-- attempts: 执行历史
-- artifacts: 生成的文件（补丁、说明）
-- events: 审计日志
```

## 运行 MCP Task Relay

MCP Task Relay 支持两种运行模式：

### 模式 1: MCP 服务器（默认）

作为 MCP 服务器运行，通过 stdio 与 MCP 客户端通信：

```bash
bun run dev
```

服务器提供：

- **工具**: `jobs_submit`、`jobs_get`、`jobs_list`、`jobs_cancel`
- **资源**: `mcp://jobs/{id}/status`、`mcp://jobs/{id}/artifacts/*`
- **通知**: 任务状态变化的实时更新

### 模式 2: 独立工作模式

作为带 Web 仪表板的独立 worker 运行：

```bash
MCP_MODE=false bun run dev
```

打开 `http://localhost:3000` 访问监控仪表板。

## 你的第一个任务

### 使用 MCP Inspector

测试系统最简单的方法是使用官方 MCP Inspector：

```bash
bun run inspector
```

这将启动一个交互式 Web 界面，你可以：

1. 查看可用工具
2. 使用可视化表单提交任务
3. 实时监控资源更新

### 手动提交（通过 MCP）

连接到 MCP 服务器并调用 `jobs_submit`：

```typescript
const response = await mcp.callTool("jobs_submit", {
  spec: {
    repo: {
      type: "git",
      url: "https://github.com/octocat/Hello-World.git",
      baseBranch: "main",
      baselineCommit: "7fd1a60b01f91b314f59955a4e4d4e80d8edf11d"
    },
    task: {
      title: "添加 README 徽章",
      description: "在 README.md 中添加构建状态徽章",
      acceptance: [
        "README 中可见徽章",
        "徽章链接到 CI/CD 管道"
      ]
    },
    scope: {
      readPaths: ["README.md"],
      disallowReformatting: false
    },
    outputContract: ["DIFF", "TEST_PLAN", "NOTES"],
    execution: {
      preferredModel: "gpt-4",
      sandbox: "read-only",
      askPolicy: "untrusted",
      priority: "P1",
      ttlS: 600
    },
    idempotencyKey: "readme-badge-v1"
  }
});

// 响应: { jobId: "job_abc123..." }
```

### 监控进度

订阅任务更新：

```typescript
const statusUri = `mcp://jobs/${response.jobId}/status`;

mcp.subscribeResource(statusUri, (update) => {
  console.log(`状态: ${update.state}, 版本: ${update.stateVersion}`);

  if (update.state === "SUCCEEDED") {
    // 读取工件
    const patch = await mcp.readResource(
      `mcp://jobs/${response.jobId}/artifacts/patch.diff`
    );
    console.log("生成的补丁:", patch.contents[0].text);
  }
});
```

## 理解输出

当任务成功时，你会找到三个工件：

### 1. `patch.diff`

Git 兼容的统一差异格式：

```diff
diff --git a/README.md b/README.md
index 1234567..abcdefg 100644
--- a/README.md
+++ b/README.md
@@ -1,3 +1,5 @@
 # Hello World

+[![Build Status](https://ci.example.com/badge.svg)](https://ci.example.com)
+
 This is a sample repository.
```

### 2. `out.md`

结构化文档：

````markdown
# 测试计划

## 手动测试
1. 在浏览器中打开 README.md
2. 验证徽章可见
3. 点击徽章，确认重定向到 CI

## 自动化测试
- 添加 E2E 测试检查徽章存在
- Mock CI API 响应

# 说明

## 实现细节
- 使用标准 Markdown 语法添加徽章
- 使用 shields.io 格式保持一致性
- 定位在主要内容之前
````

### 3. `logs.txt`

完整的执行记录，用于调试。

## 下一步

现在你已经运行了 MCP Task Relay：

1. [**核心概念**](../concepts.md): 理解架构
2. [**API 参考**](../api-reference.md): 探索所有 MCP 工具
3. [**执行器**](../executors.md): 配置 AI 后端
4. [**测试**](../testing.md): 编写集成测试

## 故障排除

### "无法获取租约"

**原因**: 另一个 worker 正在处理任务。

**解决方案**: 在 `.env` 中增加 `MAX_CONCURRENCY` 或等待完成。

### "补丁无法干净应用"

**原因**: 仓库已从 `baselineCommit` 分叉。

**解决方案**: 将 `baselineCommit` 更新为最新的提交哈希。

### "执行器超时"

**原因**: 任务执行时间超过 `timeoutS`。

**解决方案**: 增加超时时间或简化任务描述。

---

**需要帮助？** [提交问题](https://github.com/royisme/mcp-task-relay/issues) 或查看 [开发指南](../development.md)。
