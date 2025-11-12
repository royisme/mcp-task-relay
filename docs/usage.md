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

### Context Envelope Protocol

To prevent context drift between Executor and Answer Runner, every Ask includes an explicit **context envelope** with cryptographic verification:

**Context Envelope Structure:**
```json
{
  "job_snapshot": {
    "repo": "github.com/user/repo",
    "commit_sha": "abc123...",
    "env_profile": "dev",
    "policy_version": "1.0"
  },
  "facts": {
    "job_id": "job_123",
    "step_id": "step_456",
    "custom_fact": "value"
  },
  "tool_caps": {
    "database": {
      "timeout_ms": 5000,
      "read_only": true
    }
  },
  "role": "diff_planner"
}
```

**Verification Flow:**
1. Executor builds context_envelope and computes SHA-256 hash (context_hash)
2. Ask sent to Scheduler with both context_envelope and context_hash
3. Answer Runner verifies hash matches envelope before processing (fail-fast on mismatch)
4. Answer Runner generates attestation proving which context/role/model/tools were used
5. Executor verifies answer attestation matches original context_hash

**Error Codes:**
- `E_CONTEXT_MISMATCH` — Context hash verification failed
- `E_CAPS_VIOLATION` — Tool capability violation
- `E_NO_CONTEXT_ENVELOPE` — Missing required context envelope

**Environment Variables for Executors:**
```bash
export TASK_RELAY_JOB_ID="job_123"
export TASK_RELAY_STEP_ID="step_456"
export TASK_RELAY_REPO="github.com/user/repo"
export TASK_RELAY_COMMIT_SHA="abc123..."
export TASK_RELAY_PROFILE="dev"
export TASK_RELAY_POLICY_VERSION="1.0"
export TASK_RELAY_FACT_custom_key="value"  # Custom facts with TASK_RELAY_FACT_ prefix
```

The Executor SDK automatically builds and verifies context envelopes — no manual intervention required.

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

**Q: What is the context envelope protocol?**
A: An explicit, structured context snapshot that prevents context drift between Executor and Answer Runner. Each Ask includes a context envelope with cryptographic hash verification (SHA-256). The Answer Runner verifies the hash before processing and generates an attestation proving which context/role/model was used.

**Q: Do I need to manually build context envelopes?**
A: No. The Executor SDK (`src/sdk/executor.ts`) automatically builds context envelopes from environment variables and computes the hash. Verification happens automatically on both sides (Runner and Executor).

**Q: What happens if context verification fails?**
A: The Answer Runner returns an `E_CONTEXT_MISMATCH` error immediately (fail-fast). The Executor SDK also verifies the answer attestation and throws the same error if the context hash doesn't match.

**Q: How do I pass custom facts to the context envelope?**
A: Use environment variables with the `TASK_RELAY_FACT_` prefix. For example, `TASK_RELAY_FACT_branch=main` adds `"branch": "main"` to the facts object.
