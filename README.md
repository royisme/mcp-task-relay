# MCP Task Relay

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-green.svg)](https://nodejs.org/)

> **[中文文档](README.zh-CN.md)** | English

MCP Task Relay is a production-ready Model Context Protocol (MCP) server that exposes a sophisticated scheduler/executor workflow for autonomous agents. Built with enterprise-grade reliability, it features an intelligent Ask/Answer protocol with cryptographic context verification, preventing context drift while reducing token usage by 95%+.

## Architecture Overview

```
┌─────────────┐     MCP Protocol     ┌──────────────┐
│   MCP       │ ◄──────────────────► │  Scheduler   │
│  Clients    │    (stdio/SSE)       │   (Relay)    │
│ (Claude/    │                      │              │
│  Codex)     │                      │  ┌────────┐  │
└─────────────┘                      │  │Answer  │  │
                                     │  │Runner  │  │
                                     │  │(LLM)   │  │
                                     │  └────────┘  │
                                     │      ▲       │
                                     │      │ Ask   │
                                     │      ▼       │
       ┌─────────────────────────────┤  ┌────────┐ │
       │   Ask/Answer Protocol       │  │Context │ │
       │   (Context Envelope)        │  │Envelope│ │
       │   ┌──────────────┐          │  │+ Hash  │ │
       │   │ Executor SDK │ ◄────────┤  └────────┘ │
       │   └──────────────┘          │              │
       │   Job Execution             └──────────────┘
       │   Environment
       └──────────────────────────────────────────────┘
```

**Key Innovation:** Context Envelope Protocol with SHA-256 verification ensures perfect context alignment between Executor and Answer Runner, eliminating context drift while minimizing token overhead.

---

## ✨ Key Features

### 🔐 Context Envelope Protocol

Prevents context drift through explicit, verifiable context snapshots:

- **Cryptographic Verification**: SHA-256 hash ensures context integrity
- **Token Optimization**: ~50 tokens (minimal) vs 10k-50k tokens (full history)
- **Zero Session Memory**: Each Ask processed independently with complete context reconstruction
- **Answer Attestation**: Cryptographic proof of context/role/model/tools used

### 🤖 Intelligent Ask/Answer System

- **Four-Layer Prompt Architecture**: Base → Role → Context → Task
- **Role Catalog**: YAML-based extensible role definitions
- **LLM Integration**: Anthropic Claude with automatic retry and validation
- **JSON Schema Validation**: Type-safe responses with schema enforcement
- **Decision Caching**: Eliminates redundant LLM calls for identical queries

### 💾 Enterprise-Grade Storage

- **SQLite with WAL Mode**: High-performance concurrent access
- **Automatic Schema Management**: No manual migrations required
- **In-Memory Mode**: Perfect for testing and CI/CD
- **Full Audit Trail**: Complete event tracking for all state transitions

### 📊 Production Observability

- **Structured Logging**: JSON logs via Pino
- **Real-Time Updates**: Server-Sent Events (SSE) for job/ask status
- **Comprehensive Metrics**: Request latency, cache hit rates, token usage

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 20
- **npm** or **bun** 1.3+
- **Anthropic API Key** (for Answer Runner)

### Installation

```bash
# NPM (recommended for production)
npm install -g mcp-task-relay

# Or use npx for one-off execution
npx -y mcp-task-relay@latest serve --profile dev
```

### Basic Usage

```bash
# Start with in-memory storage (development)
mcp-task-relay serve \
  --profile dev \
  --storage memory \
  --config-dir ./.mcp-task-relay

# Start with persistent storage (production)
export ANTHROPIC_API_KEY="sk-ant-..."
mcp-task-relay serve \
  --profile prod \
  --storage sqlite \
  --sqlite ./data/relay.db \
  --config-dir ./config
```

---

## 📖 Configuration

### CLI Options

| Flag | Description | Environment Variable |
|------|-------------|---------------------|
| `--profile <env>` | Environment profile (dev/staging/prod) | `TASK_RELAY_PROFILE` |
| `--config-dir <dir>` | Configuration directory path | `TASK_RELAY_CONFIG_DIR` |
| `--storage <type>` | Storage backend (memory/sqlite) | `TASK_RELAY_STORAGE` |
| `--sqlite <path>` | SQLite database file path | `TASK_RELAY_SQLITE_URL` |
| `--transport <type>` | Transport protocol (stdio only in Phase 2) | `TASK_RELAY_TRANSPORT` |

### Environment Variables

**Required:**
- `ANTHROPIC_API_KEY` — Anthropic API key for Answer Runner

**Optional:**
- `TASK_RELAY_PROMPTS_DIR` — Custom prompts directory
- `TASK_RELAY_SCHEMATA_DIR` — Custom JSON schemas directory
- `TASK_RELAY_POLICY_FILE` — Custom policy YAML file
- `TASK_RELAY_ANSWER_RUNNER_ENABLED` — Enable/disable Answer Runner (default: true)

**Context Envelope (Executor-side):**
- `TASK_RELAY_JOB_ID` — Current job identifier
- `TASK_RELAY_STEP_ID` — Current execution step
- `TASK_RELAY_REPO` — Repository identifier
- `TASK_RELAY_COMMIT_SHA` — Git commit SHA
- `TASK_RELAY_POLICY_VERSION` — Policy version
- `TASK_RELAY_FACT_*` — Custom facts (e.g., `TASK_RELAY_FACT_branch=main`)

### Configuration Directory Structure

```
.mcp-task-relay/
├── config.yaml              # Main configuration
├── policy.yaml              # Security policy rules
├── prompts/                 # Role definitions
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

**Example `config.yaml`:**

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

## 🔧 MCP Client Integration

### Codex CLI

```bash
# Add to Codex configuration
codex mcp add task-relay -- \
  mcp-task-relay serve \
  --profile prod \
  --storage sqlite \
  --sqlite ./relay.db
```

### Claude Code (Desktop)

Add to your Claude Code MCP settings (`~/.claude-code/mcp.json`):

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
# Configure in Gemini workspace settings
gemini config mcp add task-relay \
  --command "mcp-task-relay serve" \
  --args "--profile prod --storage sqlite"
```

---

## 🎯 Context Envelope Protocol

### Overview

The Context Envelope Protocol eliminates context drift through explicit, cryptographically verified context snapshots.

**Problem:** Traditional approaches require transmitting complete conversation history (10k-50k tokens), causing:
- Massive token usage and cost
- Context window limitations
- Potential context misalignment between Executor and Answer Runner

**Solution:** Structured context snapshots with SHA-256 verification (50-300 tokens).

### Token Usage Comparison

| Approach | Token Usage | Context Integrity | Use Case |
|----------|-------------|-------------------|----------|
| **No Context** | ~50 tokens | None | Answer Runner blind to context ❌ |
| **Context Envelope** | **50-300 tokens** | **Cryptographic** | **Optimal for 95%+ scenarios** ✅ |
| **Full History** | 10k-50k tokens | Complete | Complex decisions requiring full context |

### Context Envelope Structure

**Minimal (Default Environment):**
```json
{
  "job_snapshot": {},
  "role": "default"
}
```
**Token Cost:** ~50 tokens

**Typical (Production with Custom Facts):**
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
**Token Cost:** ~150-200 tokens

### Verification Flow

```
1. Executor builds context_envelope
   └─► Computes SHA-256 hash → context_hash

2. Ask sent with both context_envelope + context_hash

3. Scheduler stores Ask in database

4. Answer Runner retrieves Ask
   ├─► Verifies: computed_hash == stored_hash
   └─► FAIL-FAST on mismatch (E_CONTEXT_MISMATCH)

5. Answer Runner generates response
   └─► Creates attestation with context_hash

6. Answer sent back to Executor

7. Executor verifies attestation
   └─► Ensures context_hash matches original
```

### Error Codes

- **E_CONTEXT_MISMATCH** — Context hash verification failed
- **E_CAPS_VIOLATION** — Tool capability constraint violated
- **E_NO_CONTEXT_ENVELOPE** — Required context envelope missing

### Smart Defaults (Token Optimization)

The SDK automatically omits default values to minimize token usage:

- `repo`: Omitted if "unknown" (default)
- `commit_sha`: Omitted if "unknown" (default)
- `env_profile`: Omitted if "dev" (default)
- `policy_version`: Omitted if "1.0" (default)
- `facts`: Omitted if empty
- `tool_caps`: Omitted if no tools specified

**Result:** 75-85% token reduction in typical scenarios.

---

## 🛠️ Development

### Build from Source

```bash
# Clone repository
git clone https://github.com/royisme/mcp-task-relay.git
cd mcp-task-relay

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Link for local development
npm link
```

### Project Structure

```
src/
├── cli.ts                   # CLI entry point
├── server.ts                # Runtime bootstrap
├── answer-runner/           # LLM-powered answering engine
│   ├── runner.ts            # Core Answer Runner
│   ├── role-catalog.ts      # YAML role loader
│   └── prompt-builder.ts    # 4-layer prompt architecture
├── core/                    # Business logic
│   └── job-manager.ts       # Job orchestration
├── db/                      # Data persistence
│   ├── connection.ts        # SQLite setup
│   ├── asks-repository.ts   # Ask/Answer storage
│   └── answers-repository.ts
├── models/                  # Type definitions
│   ├── schemas.ts           # Zod schemas
│   └── states.ts            # State machine & error codes
├── sdk/                     # Executor SDK
│   └── executor.ts          # Context envelope auto-packing
├── services/                # HTTP/SSE services
│   └── ask-answer.ts        # Ask/Answer API endpoints
└── utils/                   # Shared utilities
    ├── hash.ts              # Context hashing & verification
    └── logger.ts            # Structured logging

prompts/                     # Built-in role catalog
schemata/                    # JSON Schema definitions
```

---

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guidelines](CONTRIBUTING.md) before submitting PRs.

### Development Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

MIT © 2025 Roy. See [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

- **Anthropic** — For the Claude API and MCP specification
- **Better-SQLite3** — High-performance SQLite bindings
- **Zod** — Type-safe schema validation

---

## 📮 Support

- **Issues**: [GitHub Issues](https://github.com/royisme/mcp-task-relay/issues)
- **Discussions**: [GitHub Discussions](https://github.com/royisme/mcp-task-relay/discussions)
