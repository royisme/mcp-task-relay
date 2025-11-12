# Testing Guide

Comprehensive testing strategies for MCP Task Relay, from unit tests to end-to-end validation.

## Test Suite Overview

MCP Task Relay uses **Bun** as its test runner, providing:

- ⚡ Fast execution (parallel by default)
- 🔍 Built-in TypeScript support
- 📊 Code coverage reports
- 🎯 Watch mode for TDD

### Current Test Coverage

```
✅ 19 tests passing
✅ 36 assertions
✅ 0 failures
```

**Coverage by module**:

- ✅ **Models**: Zod schemas, branded types, state machine
- ✅ **Utils**: Hashing, ID generation
- ✅ **Result Type**: Error handling patterns
- 🟡 **Database**: Repository methods (planned)
- 🟡 **Executors**: Mocked execution (planned)
- 🟡 **End-to-End**: Full job lifecycle (planned)

## Running Tests

### Basic Usage

```bash
# Run all tests once
bun test

# Watch mode (re-run on file changes)
bun run test:watch

# Run specific test file
bun test test/models.test.ts

# Run with coverage
bun test --coverage
```

### Quality Checks

```bash
# Full quality suite
bun test && bun run typecheck && bun run lint:type-aware

# Individual checks
bun run typecheck       # TypeScript compilation
bun run lint            # Basic linting (89 rules)
bun run lint:type-aware # Type-aware linting (103 rules)
```

## Unit Tests

### Testing Zod Schemas

```typescript
import { test, expect } from 'bun:test';
import { JobSpecSchema } from '../src/models/schemas.js';

test('JobSpecSchema validates valid spec', () => {
  const validSpec = {
    repo: {
      type: 'git' as const,
      url: 'https://github.com/test/repo.git',
      baseBranch: 'main',
      baselineCommit: 'a'.repeat(40),
    },
    task: {
      title: 'Test Task',
      description: 'Test description',
      acceptance: ['Criterion 1'],
    },
    // ... rest of spec
  };

  const result = JobSpecSchema.safeParse(validSpec);
  expect(result.success).toBe(true);
});

test('JobSpecSchema rejects invalid commit hash', () => {
  const invalidSpec = {
    repo: {
      baselineCommit: 'short',  // Too short
    },
  };

  const result = JobSpecSchema.safeParse(invalidSpec);
  expect(result.success).toBe(false);
  expect(result.error?.issues[0]?.message).toContain('commit');
});
```

### Testing Branded Types

```typescript
import { test, expect } from 'bun:test';
import { asJobId, asCommitHash, isJobId } from '../src/models/brands.js';

test('asJobId creates branded JobId', () => {
  const jobId = asJobId('job_abc123');
  expect(jobId).toBe('job_abc123');

  // Type system prevents misuse
  // const commitHash: CommitHash = jobId;  // ❌ TypeScript error
});

test('asCommitHash validates format', () => {
  const validHash = 'a'.repeat(40);
  expect(() => asCommitHash(validHash)).not.toThrow();

  const invalidHash = 'invalid';
  expect(() => asCommitHash(invalidHash)).toThrow('Invalid commit hash');
});

test('isJobId type guard works', () => {
  expect(isJobId('job_123')).toBe(true);
  expect(isJobId('')).toBe(false);
  expect(isJobId(null)).toBe(false);
});
```

### Testing State Machine

```typescript
import { test, expect } from 'bun:test';
import { canTransition, priorityToNumber } from '../src/models/states.js';

test('canTransition validates legal transitions', () => {
  expect(canTransition('QUEUED', 'RUNNING')).toBe(true);
  expect(canTransition('RUNNING', 'SUCCEEDED')).toBe(true);
  expect(canTransition('RUNNING', 'FAILED')).toBe(true);

  // Illegal transitions
  expect(canTransition('SUCCEEDED', 'RUNNING')).toBe(false);  // Terminal
  expect(canTransition('QUEUED', 'SUCCEEDED')).toBe(false);   // Must run first
});

test('priorityToNumber mapping', () => {
  expect(priorityToNumber('P0')).toBe(0);
  expect(priorityToNumber('P1')).toBe(1);
  expect(priorityToNumber('P2')).toBe(2);
});
```

### Testing Result Type

```typescript
import { test, expect } from 'bun:test';
import { Ok, Err, mapResult, unwrap } from '../src/models/result.js';

test('Ok/Err constructors', () => {
  const success = Ok(42);
  expect(success.ok).toBe(true);
  if (success.ok) {
    expect(success.value).toBe(42);
  }

  const failure = Err('error');
  expect(failure.ok).toBe(false);
  if (!failure.ok) {
    expect(failure.error).toBe('error');
  }
});

test('mapResult transforms values', () => {
  const result = Ok(10);
  const doubled = mapResult(result, x => x * 2);

  expect(doubled.ok).toBe(true);
  if (doubled.ok) {
    expect(doubled.value).toBe(20);
  }
});

test('unwrap throws on Err', () => {
  const failure = Err('oops');
  expect(() => unwrap(failure)).toThrow();
});
```

## Integration Tests (Planned)

### Database Repository Tests

```typescript
import { test, expect, beforeEach, afterEach } from 'bun:test';
import { createConnection } from '../src/db/connection.js';
import { JobsRepository } from '../src/db/jobs-repository.js';

let db: Database;
let repo: JobsRepository;

beforeEach(() => {
  // Use in-memory database
  db = new Database(':memory:');
  runMigrations(db);
  repo = new JobsRepository(db);
});

afterEach(() => {
  db.close();
});

test('create job and retrieve', () => {
  const jobId = asJobId(generateJobId());
  const spec = createValidSpec();

  const createResult = repo.create({
    id: jobId,
    spec,
    priority: 'P1',
    ttlS: 3600,
  });

  expect(createResult.ok).toBe(true);

  const getResult = repo.getById(jobId);
  expect(getResult.ok).toBe(true);
  if (getResult.ok) {
    expect(getResult.value.id).toBe(jobId);
    expect(getResult.value.state).toBe('QUEUED');
  }
});

test('acquire lease atomically', () => {
  // Create two jobs
  const job1 = createJob('P0');
  const job2 = createJob('P1');

  // First acquire gets P0 (higher priority)
  const lease1 = repo.acquireLease({
    owner: asLeaseOwner('worker-1'),
    leaseTtlMs: 60000,
  });

  expect(lease1.ok).toBe(true);
  if (lease1.ok) {
    expect(lease1.value).toBe(job1);
  }

  // Second acquire gets P1
  const lease2 = repo.acquireLease({
    owner: asLeaseOwner('worker-2'),
    leaseTtlMs: 60000,
  });

  expect(lease2.ok).toBe(true);
  if (lease2.ok) {
    expect(lease2.value).toBe(job2);
  }
});
```

### Executor Tests

```typescript
import { test, expect, mock } from 'bun:test';
import { CodexCliExecutor } from '../src/executors/codex-cli.js';

test('CodexCliExecutor parses output correctly', async () => {
  const executor = new CodexCliExecutor({
    binary: 'mock-codex',
    defaultModel: 'gpt-4',
    enableSearch: true,
  });

  const mockOutput = `
### DIFF
diff --git a/file.ts b/file.ts
...

### TEST_PLAN
1. Test step one
2. Test step two

### NOTES
Implementation notes here
`;

  // Mock execa to return test output
  const execaMock = mock(() => ({
    exitCode: 0,
    stdout: mockOutput,
    all: mockOutput,
  }));

  const result = await executor.execute(testSpec, testContext);

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.diff).toContain('diff --git');
    expect(result.value.testPlan).toContain('Test step one');
    expect(result.value.notes).toContain('Implementation notes');
  }
});
```

## End-to-End Tests (Planned)

### Full Job Lifecycle

```typescript
import { test, expect } from 'bun:test';

test('complete job execution flow', async () => {
  // 1. Start server
  const server = await startTestServer();

  // 2. Submit job
  const { jobId } = await server.submit(testSpec);
  expect(isJobId(jobId)).toBe(true);

  // 3. Wait for execution
  const status = await server.waitForState(jobId, 'RUNNING', 5000);
  expect(status.state).toBe('RUNNING');

  // 4. Wait for completion
  const final = await server.waitForTerminal(jobId, 30000);
  expect(final.state).toBe('SUCCEEDED');

  // 5. Verify artifacts
  const patch = await server.readArtifact(jobId, 'patch.diff');
  expect(patch).toContain('diff --git');

  const out = await server.readArtifact(jobId, 'out.md');
  expect(out).toContain('# Test Plan');
  expect(out).toContain('# Notes');

  // 6. Verify event log
  const events = await server.getEvents(jobId);
  expect(events).toContainEqual(
    expect.objectContaining({ type: 'job.submitted' })
  );
  expect(events).toContainEqual(
    expect.objectContaining({ type: 'job.state.succeeded' })
  );

  await server.stop();
});
```

## Testing with MCP Inspector

For manual/exploratory testing, use the MCP Inspector:

```bash
# Start inspector in MCP mode
bun run inspector

# Or standalone mode
bun run inspector:standalone
```

### Inspector Test Scenarios

**Scenario 1: Submit and Monitor**

1. Open Inspector → Tools tab
2. Select `jobs_submit`
3. Fill in JobSpec (use template)
4. Click "Call Tool" → Note `jobId`
5. Go to Resources tab
6. Subscribe to `mcp://jobs/{jobId}/status`
7. Watch real-time updates

**Scenario 2: Cancel Job**

1. Submit long-running job
2. Wait for state = RUNNING
3. Go to Tools → `jobs_cancel`
4. Enter `jobId`
5. Verify state → CANCELED
6. Check logs for graceful shutdown

**Scenario 3: Idempotency**

1. Submit job with `idempotencyKey="test-1"`
2. Note `jobId`
3. Submit again with same key
4. Verify same `jobId` returned
5. Check job state is unchanged

## Continuous Integration

### GitHub Actions Example

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1

      - name: Install dependencies
        run: bun install

      - name: Run type check
        run: bun run typecheck

      - name: Run linters
        run: |
          bun run lint
          bun run lint:type-aware

      - name: Run tests
        run: bun test --coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

## Best Practices

### 1. Test at the Right Level

- **Unit tests**: Pure functions, schemas, types
- **Integration tests**: Database, executor mocks
- **E2E tests**: Full job lifecycle (expensive, use sparingly)

### 2. Use Type-Safe Mocks

```typescript
// Good: Type-safe mock
const mockExecutor: Executor = {
  name: 'test-executor',
  execute: async () => Ok(testOutput),
};

// Bad: Untyped mock
const mockExecutor: any = { ... };
```

### 3. Test Error Paths

```typescript
test('handles executor timeout', async () => {
  const executor = new TimeoutExecutor(100);  // 100ms timeout
  const longSpec = createLongRunningSpec();

  const result = await executor.execute(longSpec, context);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toContain('timeout');
  }
});
```

### 4. Use Descriptive Test Names

```typescript
// Good
test('JobsRepository.acquireLease returns null when no jobs available', ...);

// Bad
test('lease test', ...);
```

---

Continue to [**Development Guide**](development.md) for contribution guidelines.
