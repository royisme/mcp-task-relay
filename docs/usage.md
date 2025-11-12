# MCP Task Relay — Usage Guide

> Installation, configuration, and integration with MCP clients (Codex, Claude Code, Gemini).

---

## Prerequisites

* Node.js ≥ 20
* `ANTHROPIC_API_KEY` environment variable (required for Answer Runner)

---

## Installation

### Via npx (recommended)

```bash
npx -y mcp-task-relay@latest serve --profile dev
```

### Via npm global install

```bash
npm install -g mcp-task-relay
mcp-task-relay serve --profile dev
```

### Local development

```bash
git clone https://github.com/royisme/mcp-task-relay.git
cd mcp-task-relay
npm install
npm run build
npm link
mcp-task-relay serve --profile dev
```

---

## Configuration

### CLI Flags

```bash
mcp-task-relay serve [options]
```

| Flag | Description | Environment Override |
| --- | --- | --- |
| `--profile dev\|staging\|prod` | Logging level and defaults | `TASK_RELAY_PROFILE` |
| `--config-dir <dir>` | Custom prompts/schemata location | `TASK_RELAY_CONFIG_DIR` |
| `--storage memory\|sqlite` | Storage backend | `TASK_RELAY_STORAGE` |
| `--sqlite <path>` | SQLite file path | `TASK_RELAY_SQLITE_URL` |
| `--transport stdio` | Transport type (stdio only) | `TASK_RELAY_TRANSPORT` |

### Environment Variables

**Required:**
* `ANTHROPIC_API_KEY` — Answer Runner LLM access

**Optional:**
* `TASK_RELAY_PROFILE` — Profile selection
* `TASK_RELAY_PROMPTS_DIR` — Custom prompts directory
* `TASK_RELAY_SCHEMATA_DIR` — Custom schemas directory
* `TASK_RELAY_POLICY_FILE` — Policy YAML path
* `TASK_RELAY_STORAGE` — Storage mode
* `TASK_RELAY_SQLITE_URL` — SQLite database path

**Answer Runner:**
* `TASK_RELAY_ANSWER_RUNNER_ENABLED=false` — Disable automatic Ask processing

**Priority:** CLI flags > env vars > config-dir files > built-in defaults

---

## User Overrides

Create a `.mcp-task-relay/` directory in your workspace to customize behavior:

```
.mcp-task-relay/
  policy.yaml
  prompts/
    role.diff_planner@v1.yaml
    role.test_planner@v1.yaml
    role.schema_summarizer@v1.yaml
  schemata/
    artifacts/
      diff_plan.schema.json
      test_plan.schema.json
```

Launch with custom config:

```bash
mcp-task-relay serve --profile dev --config-dir ./.mcp-task-relay
```

The server loads user files first, then falls back to bundled defaults.

---

## MCP Client Integrations

### Codex CLI

```bash
codex mcp add task-relay -- \
  npx -y mcp-task-relay@latest serve \
    --profile dev \
    --config-dir ./.mcp-task-relay
```

### Claude Code (VS Code Extension)

```bash
claude mcp add --transport stdio task-relay --scope project -- \
  npx -y mcp-task-relay@latest serve --profile dev --config-dir ./.mcp-task-relay
```

This creates `.mcp.json` in your repo root:

```json
{
  "mcpServers": {
    "task-relay": {
      "command": "npx",
      "args": ["-y", "mcp-task-relay@latest", "serve", "--profile", "dev", "--config-dir", "./.mcp-task-relay"],
      "transport": "stdio"
    }
  }
}
```

### Gemini CLI

```bash
gemini mcp add --transport stdio task-relay \
  npx -y mcp-task-relay@latest serve --profile dev --config-dir ./.mcp-task-relay
```

Optional: Add to `~/.gemini/settings.json` for global availability.

---

## Storage Modes

### In-memory (default)

Fast, ephemeral storage for testing:

```bash
mcp-task-relay serve --storage memory
```

Connection string: `file:mcp-task-relay?mode=memory&cache=shared`

### SQLite (persistent)

On-disk database for production:

```bash
mcp-task-relay serve --storage sqlite --sqlite ./.tmp/prod.sqlite
```

Uses WAL mode for high concurrency. Tables auto-create on first run.

---

## Answer Runner

The scheduler automatically processes Ask messages using an LLM-powered Answer Runner.

**How it works:**
1. Executor sends an Ask (e.g., "RESOURCE_FETCH" for schema info)
2. Answer Runner loads the appropriate role from `prompts/`
3. Builds a layered prompt: Base → Role → Context → Task
4. Calls Anthropic Claude API
5. Validates JSON response against schema
6. Records Answer back to the job

**Configuration:**

Set `ANTHROPIC_API_KEY` before starting:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
mcp-task-relay serve --profile dev
```

**Disable automatic processing:**

```bash
export TASK_RELAY_ANSWER_RUNNER_ENABLED=false
mcp-task-relay serve --profile dev
```

Or via config file (`.mcp-task-relay/config.yaml`):

```yaml
askAnswer:
  runner:
    enabled: false
```

---

## Smoke Test

```bash
# 1. Set API key
export ANTHROPIC_API_KEY="sk-ant-..."

# 2. Create config directory
mkdir -p .mcp-task-relay/prompts .mcp-task-relay/schemata/artifacts
cp -r prompts/* .mcp-task-relay/prompts/
cp -r schemata/* .mcp-task-relay/schemata/

# 3. Start server
npx -y mcp-task-relay@latest serve --profile dev --config-dir ./.mcp-task-relay

# 4. Register with MCP client
codex mcp add task-relay -- npx -y mcp-task-relay@latest serve --profile dev --config-dir ./.mcp-task-relay

# 5. Verify: list servers
codex mcp list

# 6. Test Ask/Answer cycle
# (via MCP client tools)
```

---

## FAQ

**Q: Why stdio only?**
A: Phase 2 prioritizes reliability and simplicity. Remote HTTP transports will arrive in a future phase.

**Q: How do I customize roles or policies?**
A: Create `.mcp-task-relay/` with your overrides and point `--config-dir` to it.

**Q: Do I need database migrations?**
A: No. Tables auto-create on first run. Use in-memory mode for development.

**Q: What is the Answer Runner?**
A: A scheduler-side LLM engine that automatically processes Ask messages using role-based prompts and Anthropic Claude.

**Q: Can I disable automatic answer processing?**
A: Yes, set `TASK_RELAY_ANSWER_RUNNER_ENABLED=false` or configure `askAnswer.runner.enabled: false`.

**Q: Which LLM models are supported?**
A: Currently Anthropic Claude only (configurable via `askAnswer.runner.model`). Defaults to `claude-3-5-sonnet-20241022`.

**Q: How do I debug Answer Runner issues?**
A: Set `TASK_RELAY_PROFILE=dev` for debug-level logs. Check logs for "Answer Runner initialized" and "Processing Ask with Answer Runner".

**Q: What if I don't have an Anthropic API key?**
A: Disable the Answer Runner (`TASK_RELAY_ANSWER_RUNNER_ENABLED=false`). Asks will remain in `PENDING` state until manually answered via the HTTP API.
