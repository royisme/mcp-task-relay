# MCP Task Relay — Publish & Install Guide (npm + stdio)

> This guide focuses on npm distribution, local stdio runtime, and integrations with Codex CLI, Claude Code, and Gemini CLI. Docker and Homebrew flows are out of scope.

---

## 1. Prerequisites

* Node.js ≥ 20
* bun 1.3+

---

## 2. Package Structure & `package.json`

```
package.json
src/
  cli.ts          # CLI entry (commander)
  server.ts       # Runtime bootstrap (stdio transport)
  answer-runner/  # Scheduler logic
  lib/            # Shared helpers/types
prompts/          # Built-in role YAML catalog
schemata/         # JSON Schema registry (Ask/Answer + artifacts)
README.md
LICENSE
```

Minimal `package.json` fields:

```json
{
  "name": "mcp-task-relay",
  "version": "0.3.0",
  "type": "module",
  "bin": { "mcp-task-relay": "dist/cli.js" },
  "files": ["dist","prompts","schemata","README.md","LICENSE"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "serve": "node dist/cli.js serve"
  },
  "engines": { "node": ">=20" }
}
```

Key points:

* The `bin` field exposes the compiled CLI so users can run `npx -y mcp-task-relay serve` immediately after install.
* `files` ensures the role catalog and schema registry ship with the package.

---

## 3. Runtime Modes (Development Focus)

* Default transport: **stdio**.
* Storage: in-memory SQLite (`file:mcp-task-relay?mode=memory&cache=shared`) or a disposable on-disk file when `--storage sqlite` is used.

Example CLI invocation:

```bash
npx -y mcp-task-relay@latest serve \
  --profile dev \
  --storage sqlite --sqlite ./.tmp/dev.sqlite \
  --config-dir ./.mcp-task-relay
```

Supported flags:

* `--profile dev|staging|prod`
* `--config-dir <dir>`
* `--storage memory|sqlite`
* `--sqlite <path>`
* `--transport stdio`

Environment variable equivalents:

* `ANTHROPIC_API_KEY` — **required** for Answer Runner (scheduler-side LLM processing).
* `TASK_RELAY_PROFILE`
* `TASK_RELAY_PROMPTS_DIR`, `TASK_RELAY_SCHEMATA_DIR`, `TASK_RELAY_POLICY_FILE`
* `TASK_RELAY_STORAGE`, `TASK_RELAY_SQLITE_URL`

Priority order: **CLI > env vars > config-dir contents > built-in defaults**.

**Note on Answer Runner**: The scheduler automatically processes Ask messages using an LLM-powered Answer Runner. Set `ANTHROPIC_API_KEY` in your environment before starting the server. To disable automatic answer processing (e.g., for manual testing), set `TASK_RELAY_ANSWER_RUNNER_ENABLED=false`.

---

## 4. User Overrides

Recommended project layout:

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

Point the CLI at the directory:

```bash
mcp-task-relay serve --profile dev --config-dir ./.mcp-task-relay
```

The runtime loads user-provided files first and falls back to bundled defaults.

---

## 5. Publish to npm (Minimal Flow)

```bash
# 1) Bump version
npm version patch

# 2) Build TypeScript
npm run build

# 3) Authenticate & publish
npm login
npm publish --access public

# 4) Smoke test from registry
npx -y mcp-task-relay@latest --help
```

Private scopes follow the same steps with `--access restricted` and a scoped package name (e.g., `@your-org/mcp-task-relay`).

---

## 6. CLI Integrations (stdio)

### 6.1 Codex CLI

```bash
codex mcp add task-relay -- \
  npx -y mcp-task-relay@latest serve \
    --profile dev \
    --config-dir ./.mcp-task-relay
```

### 6.2 Claude Code (VS Code)

```bash
claude mcp add --transport stdio task-relay --scope project -- \
  npx -y mcp-task-relay@latest serve --profile dev --config-dir ./.mcp-task-relay
```

Generates `.mcp.json` at repo root:

```json
{
  "mcpServers": {
    "task-relay": {
      "command": "npx",
      "args": ["-y","mcp-task-relay@latest","serve","--profile","dev","--config-dir","./.mcp-task-relay"],
      "transport": "stdio"
    }
  }
}
```

### 6.3 Gemini CLI

```bash
gemini mcp add --transport stdio task-relay \
  npx -y mcp-task-relay@latest serve --profile dev --config-dir ./.mcp-task-relay
```

Optional global config: `~/.gemini/settings.json`.

---

## 7. Local Iteration (AI-friendly)

**Option A: `npm link`**

```bash
npm run build && npm link
mcp-task-relay serve --profile dev --config-dir ./.mcp-task-relay
```

**Option B: local file spec**

```bash
npx -y mcp-task-relay@file:./ serve --profile dev --config-dir ./.mcp-task-relay
```

Use this when testing agent-driven edits without publishing to npm.

Implementation hints for AI contributors:

* `src/cli.ts` – argument parsing & environment merging.
* `src/server.ts` – stdio bootstrap, ask/answer bridge, worker pool.
* `prompts/` & `schemata/` – override-ready defaults.
* `src/lib/types.ts` – shared request/response definitions.

---

## 8. Smoke Test Checklist

```bash
mkdir -p .mcp-task-relay/prompts .mcp-task-relay/schemata/artifacts
cp -r prompts/* .mcp-task-relay/prompts/
cp -r schemata/artifacts/* .mcp-task-relay/schemata/artifacts/

npx -y mcp-task-relay@latest serve --profile dev --config-dir ./.mcp-task-relay
codex mcp add task-relay -- npx -y mcp-task-relay@latest serve --profile dev --config-dir ./.mcp-task-relay
```

If the MCP client can register the server and successfully fulfill a sample `RESOURCE_FETCH` Ask→Answer cycle, the release is ready.

---

## 9. FAQ

* **Why stdio only?** Phase&nbsp;2 prioritises reliability and simplicity. Remote HTTP transports will arrive in a future phase.
* **How do I customise roles or policies?** Provide overrides in `.mcp-task-relay/` and point the CLI to the directory.
* **Do I need database migrations?** Development flows use in-memory or disposable SQLite and auto-create tables on first run.
* **How do AI agents consume new code?** Use `npm link` or publish a patch release after running the smoke test.
* **What is the Answer Runner?** A scheduler-side LLM engine that automatically processes Ask messages using role-based prompts and Anthropic Claude. It requires `ANTHROPIC_API_KEY` to be set.
* **Can I disable automatic answer processing?** Yes, set `TASK_RELAY_ANSWER_RUNNER_ENABLED=false` or configure via `askAnswer.runner.enabled: false` in your config.
