# Development Guide

Contribution guidelines and development workflow.

## Setup

```bash
git clone https://github.com/royisme/mcp-task-relay
cd mcp-task-relay
bun install
bun run migrate
```

## Development Workflow

1. Create feature branch: `git checkout -b feature/my-feature`
2. Make changes
3. Run quality checks: `bun test && bun run typecheck && bun run lint:type-aware`
4. Commit with conventional commits
5. Push and create PR

## Code Standards

- ✅ Zero `any` types (enforced by oxlint)
- ✅ All schemas have Zod validation
- ✅ Use `Result<T, E>` for error handling
- ✅ Branded types for IDs
- ✅ Write tests for new features

## Project Structure

```
src/
├── mcp/          # MCP server
├── core/         # Business logic
├── db/           # Database layer
├── executors/    # AI backends
├── models/       # Types & schemas
├── services/     # Services
├── config/       # Configuration
└── utils/        # Utilities
```

## Adding Features

### New Executor

1. Create `src/executors/my-executor.ts`
2. Implement `Executor` interface
3. Register in `factory.ts`
4. Add config schema
5. Write tests

### New MCP Tool

1. Add schema in `models/schemas.ts`
2. Add handler in `mcp/server.ts`
3. Update API docs
4. Write integration test

## License

MIT - See LICENSE file
