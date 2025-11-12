# MCP Task Relay

MCP Task Relay exposes the JobHub scheduler/executor workflow as a portable Model Context Protocol (MCP) server. Phase&nbsp;2 introduces Ask/Answer collaboration, a role catalog, and JSON Schema guarded artifacts so autonomous agents can plan, validate, and ship diffs with minimal context.

---

## 🚀 Quick Start (stdio transport)

```bash
npx -y mcp-task-relay@latest serve \
  --profile dev \
  --storage memory \
  --config-dir ./.mcp-task-relay
```

* Requires **Node.js ≥ 20** and **bun 1.3+** for local development.
* Defaults to the in-memory SQLite connection string `file:mcp-task-relay?mode=memory&cache=shared`.
* Use `--storage sqlite --sqlite ./.tmp/dev.sqlite` to persist across restarts.

The CLI reads configuration in the following priority order: **flags > environment variables > `--config-dir` contents > package defaults**.

---

## 🧰 CLI Reference

`mcp-task-relay serve [options]`

| Flag | Description | Environment Override |
| --- | --- | --- |
| `--profile dev|staging|prod` | Enables profile-tuned logging and rate defaults. | `TASK_RELAY_PROFILE` |
| `--config-dir <dir>` | Preferred location for `prompts/`, `schemata/`, and `policy.yaml`. | `TASK_RELAY_CONFIG_DIR` |
| `--storage memory|sqlite` | Selects transient memory DB or file-backed SQLite. | `TASK_RELAY_STORAGE` |
| `--sqlite <path>` | SQLite path when using file-backed storage. | `TASK_RELAY_SQLITE_URL` |
| `--transport stdio` | Transport selection (Phase&nbsp;2 supports `stdio` only). | `TASK_RELAY_TRANSPORT` |

Additional environment variables:

* `TASK_RELAY_PROMPTS_DIR`, `TASK_RELAY_SCHEMATA_DIR`, `TASK_RELAY_POLICY_FILE` – override resource lookup without a config dir.
* `TASK_RELAY_WEB_UI=true` – opt-in to the legacy HTTP dashboard.
* `ENABLE_WEB_UI=true` – backward-compatible toggle for `node dist/index.js` entry.

---

## 📦 Package Layout

```
package.json
src/
  cli.ts           # CLI entry point
  server.ts        # Runtime bootstrap (stdio + ask/answer bridge)
  answer-runner/   # Scheduler-side prompt orchestration
  lib/             # Shared helpers and types
prompts/           # Built-in role catalog (diff planner, test planner, etc.)
schemata/          # JSON Schema registry (Ask/Answer + artifacts)
README.md
LICENSE
```

Published packages ship with the pre-built `dist/` directory plus the default prompts and schemata so downstream users can copy or override them.

---

## ⚙️ User Overrides (`--config-dir`)

Add a `.mcp-task-relay/` directory to your workspace to override prompts, schemata, or policy files:

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

On startup the CLI resolves overrides first, falling back to the bundled catalog when a file is missing.

---

## 🧪 Smoke Test

```bash
# Build and link locally
npm run build && npm link

# Launch stdio server against local overrides
mcp-task-relay serve --profile dev --config-dir ./.mcp-task-relay

# Register with Codex CLI (example)
codex mcp add task-relay -- \
  mcp-task-relay serve --profile dev --config-dir ./.mcp-task-relay
```

A successful smoke test allows an MCP client to list the `task-relay` server and execute a `RESOURCE_FETCH` Ask→Answer round trip using the bundled schemas.

---

## 📚 Documentation

* [Phase&nbsp;2 Development Spec](docs/phase-2.md) – Ask/Answer roles, prompt layering, policy and observability expectations.
* [Publish & Install Guide](docs/publish-install.md) – npm workflow, CLI flags, and stdio integration examples for Codex, Claude, and Gemini.

---

## 📝 License

MIT © 2025 Roy.
