# Core Concepts

Deep dive into the architecture and design principles of MCP Task Relay.

## System Architecture

```
┌─────────────┐
│   MCP       │  MCP Tools & Resources
│   Client    │  ├─ jobs_submit
└──────┬──────┘  ├─ jobs_get
       │         ├─ jobs_list
       ▼         └─ jobs_cancel
┌──────────────────────┐
│   MCP Task Relay     │
│   ┌────────────────┐ │
│   │  Job Manager   │ │  State Machine
│   └────────┬───────┘ │  Lease Management
│            │          │
│   ┌────────▼───────┐ │
│   │   Worker Pool  │ │  Concurrent Execution
│   └────────┬───────┘ │  Heartbeat Monitoring
│            │          │
│   ┌────────▼───────┐ │
│   │   Executors    │ │  Codex CLI
│   │                │ │  Claude Code
│   └────────────────┘ │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  Storage Layer       │
│  ├─ SQLite (WAL)     │  Jobs, Artifacts
│  └─ Filesystem       │  patch.diff, out.md
└──────────────────────┘
```

## State Machine

Jobs progress through a well-defined state machine:

```
QUEUED ─────┐
            ▼
        RUNNING ───┬──▶ SUCCEEDED
                   ├──▶ FAILED
                   ├──▶ CANCELED
                   └──▶ EXPIRED

           STALE ──▶ FAILED (heartbeat lost)
```

**State Descriptions**:

- **QUEUED**: Job submitted, waiting for worker
- **RUNNING**: Worker executing task
- **SUCCEEDED**: Task completed, artifacts ready
- **FAILED**: Execution error (see reasonCode)
- **CANCELED**: User-initiated cancellation
- **EXPIRED**: Exceeded TTL
- **STALE**: Worker lost heartbeat

## Concurrency Model

MCP Task Relay uses a **lease-based** concurrency model:

1. Worker acquires lease (atomic transaction)
2. Lease has TTL (default: 60s)
3. Worker sends heartbeat every 15s to renew
4. If heartbeat stops, lease expires → job returns to queue

This prevents:
- Duplicate execution
- Stuck jobs (auto-recovery)
- Worker crashes (graceful failover)

## Type Safety

Zero-Any achieved through:

1. **Branded Types**: Prevent ID confusion
2. **Zod Schemas**: Runtime validation
3. **Result<T, E>**: Type-safe errors
4. **Strict TSConfig**: All safety flags enabled

See [Testing](testing.md) for verification.
