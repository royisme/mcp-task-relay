# Getting Started

This guide will walk you through setting up MCP Task Relay and submitting your first job in under 10 minutes.

## Prerequisites

Before you begin, ensure you have:

- **Node.js** ≥ 20.0.0
- **Bun** (recommended) or npm
- **Git** for repository operations
- **Python 3** (optional, for MkDocs documentation)

### Installing Bun

```bash
# macOS/Linux
curl -fsSL https://bun.sh/install | bash

# Or use npm
npm install -g bun
```

## Installation

### Step 1: Clone the Repository

```bash
git clone https://github.com/royisme/mcp-task-relay
cd mcp-task-relay
```

### Step 2: Install Dependencies

```bash
bun install
```

This installs all required packages:

- `@modelcontextprotocol/sdk`: MCP protocol implementation
- `better-sqlite3`: High-performance SQLite bindings
- `zod`: Runtime type validation
- `execa`: Process execution
- `pino`: Structured logging

### Step 3: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` to customize settings:

```env
# Storage
ARTIFACT_ROOT=./artifacts
DB_PATH=./jobhub.db

# Executors
CODEX_ENABLED=true
CODEX_BINARY=codex

CLAUDE_ENABLED=false
CLAUDE_BINARY=claude

# Web UI
WEB_UI_PORT=3000

# Logging
LOG_LEVEL=info
LOG_PRETTY=true
```

### Step 4: Initialize Database

```bash
bun run migrate
```

This creates the SQLite database with WAL mode enabled for concurrent access:

```sql
-- Tables created:
-- jobs: Task metadata and state
-- attempts: Execution history
-- artifacts: Generated files (patches, notes)
-- events: Audit log
```

## Running MCP Task Relay

MCP Task Relay supports two operational modes:

### Mode 1: MCP Server (Default)

Runs as an MCP server, communicating via stdio with MCP clients:

```bash
bun run dev
```

The server exposes:

- **Tools**: `jobs_submit`, `jobs_get`, `jobs_list`, `jobs_cancel`
- **Resources**: `mcp://jobs/{id}/status`, `mcp://jobs/{id}/artifacts/*`
- **Notifications**: Real-time updates on job state changes

### Mode 2: Standalone Worker

Runs as a standalone worker with web dashboard:

```bash
MCP_MODE=false bun run dev
```

Open `http://localhost:3000` to access the monitoring dashboard.

## Your First Job

### Using MCP Inspector

The easiest way to test the system is with the official MCP Inspector:

```bash
bun run inspector
```

This launches an interactive web interface where you can:

1. View available tools
2. Submit jobs with a visual form
3. Monitor resource updates in real-time

### Manual Submission (via MCP)

Connect to the MCP server and call `jobs_submit`:

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
      title: "Add README badge",
      description: "Add a build status badge to README.md",
      acceptance: [
        "Badge is visible in README",
        "Badge links to CI/CD pipeline"
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

// Response: { jobId: "job_abc123..." }
```

### Monitoring Progress

Subscribe to job updates:

```typescript
const statusUri = `mcp://jobs/${response.jobId}/status`;

mcp.subscribeResource(statusUri, (update) => {
  console.log(`State: ${update.state}, Version: ${update.stateVersion}`);

  if (update.state === "SUCCEEDED") {
    // Read artifacts
    const patch = await mcp.readResource(
      `mcp://jobs/${response.jobId}/artifacts/patch.diff`
    );
    console.log("Generated patch:", patch.contents[0].text);
  }
});
```

## Understanding the Output

When a job succeeds, you'll find three artifacts:

### 1. `patch.diff`

A git-compatible unified diff:

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

Structured documentation:

````markdown
# Test Plan

## Manual Testing
1. Open README.md in browser
2. Verify badge is visible
3. Click badge, confirm redirect to CI

## Automated Testing
- Add E2E test for badge presence
- Mock CI API responses

# Notes

## Implementation Details
- Badge added using standard Markdown syntax
- Used shields.io format for consistency
- Positioned before main content
````

### 3. `logs.txt`

Full execution transcript for debugging.

## Next Steps

Now that you have MCP Task Relay running:

1. [**Core Concepts**](concepts.md): Understand the architecture
2. [**API Reference**](api-reference.md): Explore all MCP tools
3. [**Executors**](executors.md): Configure AI backends
4. [**Testing**](testing.md): Write integration tests

## Troubleshooting

### "Failed to acquire lease"

**Cause**: Another worker is processing the job.

**Solution**: Increase `MAX_CONCURRENCY` in `.env` or wait for completion.

### "Patch does not apply cleanly"

**Cause**: Repository has diverged from `baselineCommit`.

**Solution**: Update `baselineCommit` to latest commit hash.

### "Executor timeout exceeded"

**Cause**: Task took longer than `timeoutS`.

**Solution**: Increase timeout or simplify task description.

---

**Need help?** [Open an issue](https://github.com/royisme/mcp-task-relay/issues) or check the [Development Guide](development.md).
