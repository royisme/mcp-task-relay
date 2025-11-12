# Executors

Configure AI backends to execute tasks.

## Codex CLI

Non-interactive execution with sandboxing.

**Configuration**:

```env
CODEX_ENABLED=true
CODEX_BINARY=codex
CODEX_DEFAULT_MODEL=gpt-4
CODEX_ENABLE_SEARCH=true
```

**Execution**:

```bash
codex exec \
  --model gpt-4 \
  --sandbox read-only \
  -a untrusted \
  --search \
  "${PROMPT}"
```

## Claude Code

Agent mode with structured output.

**Configuration**:

```env
CLAUDE_ENABLED=true
CLAUDE_BINARY=claude
CLAUDE_DEFAULT_MODEL=claude-sonnet-4
```

## Custom Executors

Implement the `Executor` interface:

```typescript
interface Executor {
  name: string;
  execute(spec: JobSpec, context: ExecutorContext): Promise<Result<ExecutorOutput, string>>;
}
```

See `src/executors/` for examples.
