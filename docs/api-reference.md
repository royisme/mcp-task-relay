# API Reference

Complete reference for all MCP tools, resources, and notifications exposed by MCP Task Relay.

## MCP Tools

### `jobs_submit`

Submit a new job to the execution queue.

**Input Schema**:

```typescript
{
  spec: JobSpec  // Complete job specification
}
```

**JobSpec Structure**:

```typescript
interface JobSpec {
  repo: {
    type: "git" | "local"
    url?: string          // Required for type="git"
    path?: string         // Required for type="local"
    baseBranch: string
    baselineCommit: string  // Full 40-character Git SHA
  }

  task: {
    title: string         // Max 200 characters
    description: string   // Max 10,000 characters
    acceptance: string[]  // List of acceptance criteria
  }

  scope: {
    readPaths: string[]         // Directories/files to include
    fileGlobs?: string[]        // Glob patterns (e.g., "**/*.ts")
    disallowReformatting: boolean
  }

  context?: {
    dirTreeDigest?: string
    keySignatures?: string[]
    codeSnippets?: {
      path: string
      from: number  // Start line
      to: number    // End line
    }[]
  }

  outputContract: ["DIFF", "TEST_PLAN", "NOTES"]  // Fixed

  execution: {
    preferredModel: string        // e.g., "gpt-4", "claude-sonnet-4"
    sandbox: "read-only"          // Fixed
    askPolicy: "untrusted"        // Fixed
    timeoutS?: number             // Optional timeout in seconds
    priority: "P0" | "P1" | "P2"  // P0 = highest
    ttlS: number                  // Time-to-live in seconds
  }

  idempotencyKey: string  // Unique key for deduplication
  notify?: {
    enablePr?: boolean
    webhook?: string      // URL for notifications
  }
}
```

**Response**:

```typescript
{
  jobId: string  // Branded JobId type
}
```

**Example**:

```typescript
const result = await mcp.callTool("jobs_submit", {
  spec: {
    repo: {
      type: "git",
      url: "https://github.com/facebook/react.git",
      baseBranch: "main",
      baselineCommit: "7fd1a60b01f91b314f59955a4e4d4e80d8edf11d"
    },
    task: {
      title: "Add TypeScript strict mode",
      description: "Enable strict mode in tsconfig.json and fix type errors",
      acceptance: [
        "tsconfig.json has strict: true",
        "All TypeScript files compile without errors"
      ]
    },
    scope: {
      readPaths: ["src/", "tsconfig.json"],
      fileGlobs: ["**/*.ts", "**/*.tsx"],
      disallowReformatting: false
    },
    outputContract: ["DIFF", "TEST_PLAN", "NOTES"],
    execution: {
      preferredModel: "gpt-4",
      sandbox: "read-only",
      askPolicy: "untrusted",
      priority: "P1",
      ttlS: 1800
    },
    idempotencyKey: "react-strict-mode-v1"
  }
});
```

**Idempotency**:

If a job with the same `idempotencyKey` already exists and is not in a terminal state (`SUCCEEDED`, `FAILED`, `CANCELED`, `EXPIRED`), the existing `jobId` is returned instead of creating a new job.

---

### `jobs_get`

Retrieve detailed information about a specific job.

**Input Schema**:

```typescript
{
  jobId: string
}
```

**Response**:

```typescript
{
  id: string
  state: JobState
  summary: string | null
  lastUpdate: number      // Unix timestamp (ms)
  attempt: number
  pr?: {
    url: string
    number: number
    status: string
  }
}
```

**JobState Values**:

- `QUEUED`: Waiting for execution
- `RUNNING`: Currently executing
- `SUCCEEDED`: Completed successfully
- `FAILED`: Execution failed (check `reasonCode`)
- `CANCELED`: Canceled by user
- `EXPIRED`: Exceeded TTL
- `STALE`: Lost heartbeat (worker crashed)

**Example**:

```typescript
const job = await mcp.callTool("jobs_get", {
  jobId: "job_abc123xyz"
});

console.log(`Job ${job.id} is ${job.state}`);
if (job.state === "FAILED") {
  console.error(`Reason: ${job.summary}`);
}
```

---

### `jobs_list`

List jobs with optional filtering and pagination.

**Input Schema**:

```typescript
{
  state?: JobState  // Filter by state
  limit?: number    // Max 100, default 20
  offset?: number   // Pagination offset, default 0
}
```

**Response**:

```typescript
{
  items: JobSummary[]
  total: number      // Total matching jobs
  hasMore: boolean   // True if more pages exist
}
```

**Example**:

```typescript
// Get all running jobs
const running = await mcp.callTool("jobs_list", {
  state: "RUNNING",
  limit: 50
});

// Paginate through all jobs
let offset = 0;
while (true) {
  const page = await mcp.callTool("jobs_list", { limit: 20, offset });
  processJobs(page.items);
  if (!page.hasMore) break;
  offset += 20;
}
```

---

### `jobs_cancel`

Cancel a queued or running job.

**Input Schema**:

```typescript
{
  jobId: string
}
```

**Response**:

```typescript
{
  ok: boolean
  state: JobState  // New state after cancellation
}
```

**Behavior**:

- Jobs in terminal states cannot be canceled (`ok: false`)
- Cancellation is a soft signal—workers will exit gracefully
- State transitions to `CANCELED`

**Example**:

```typescript
const result = await mcp.callTool("jobs_cancel", {
  jobId: "job_abc123xyz"
});

if (result.ok) {
  console.log("Job canceled successfully");
} else {
  console.log(`Cannot cancel job in state: ${result.state}`);
}
```

---

## MCP Resources

### Job Status

**URI Pattern**: `mcp://jobs/{jobId}/status`

**Content Type**: `application/json`

**Schema**:

```typescript
{
  state: JobState
  stateVersion: number  // Increments on every state/artifact change
  createdAt: number     // Unix timestamp (ms)
  startedAt?: number
  finishedAt?: number
  durationMs?: number
  attempt: number
  reasonCode?: FailReason
  pr?: {
    url: string
    number: number
    status: string
  }
}
```

**FailReason Values**:

- `BAD_ARTIFACTS`: Output parsing failed
- `CONFLICT`: Patch doesn't apply cleanly
- `POLICY`: Security/policy violation
- `EXECUTOR_ERROR`: Executor crashed
- `TIMEOUT`: Exceeded time limit
- `INTERNAL_ERROR`: System error

**Example**:

```typescript
const status = await mcp.readResource("mcp://jobs/job_abc123/status");
const data = JSON.parse(status.contents[0].text);

console.log(`State: ${data.state} (v${data.stateVersion})`);
if (data.finishedAt) {
  console.log(`Duration: ${data.durationMs}ms`);
}
```

---

### Artifacts

**URI Patterns**:

- `mcp://jobs/{jobId}/artifacts/patch.diff`
- `mcp://jobs/{jobId}/artifacts/out.md`
- `mcp://jobs/{jobId}/artifacts/logs.txt`
- `mcp://jobs/{jobId}/artifacts/pr.json`

**Content Types**:

- `patch.diff`: `text/plain`
- `out.md`: `text/markdown`
- `logs.txt`: `text/plain`
- `pr.json`: `application/json`

**Example**:

```typescript
// Read patch
const patch = await mcp.readResource(
  "mcp://jobs/job_abc123/artifacts/patch.diff"
);
console.log(patch.contents[0].text);

// Read test plan and notes
const out = await mcp.readResource(
  "mcp://jobs/job_abc123/artifacts/out.md"
);
const markdown = out.contents[0].text;
```

---

## MCP Notifications

### Resource Updated

**Method**: `notifications/resources/updated`

**Payload**:

```typescript
{
  uri: string         // e.g., "mcp://jobs/job_abc/status"
  stateVersion: number
}
```

**When Sent**:

- Job state changes
- New artifacts are created
- Any resource content updates

**Example**:

```typescript
mcp.onNotification("notifications/resources/updated", (params) => {
  console.log(`Resource ${params.uri} updated to v${params.stateVersion}`);
  // Re-fetch resource to get latest data
});
```

---

### Job Finished

**Method**: `notifications/job/finished`

**Payload**:

```typescript
{
  jobId: string
  state: "SUCCEEDED"
  summary: string
  artifacts: {
    patch?: string  // URI
    out?: string
    logs?: string
    pr?: string
  }
  stateVersion: number
  startedAt?: number
  finishedAt?: number
  durationMs?: number
  attempt: number
}
```

**Example**:

```typescript
mcp.onNotification("notifications/job/finished", (params) => {
  console.log(`Job ${params.jobId} completed in ${params.durationMs}ms`);
  console.log(`Artifacts: ${Object.keys(params.artifacts).join(", ")}`);
});
```

---

### Job Failed

**Method**: `notifications/job/failed`

**Payload**:

```typescript
{
  jobId: string
  state: "FAILED" | "CANCELED" | "EXPIRED"
  summary: string
  reasonCode?: FailReason
  stateVersion: number
  attempt: number
}
```

**Example**:

```typescript
mcp.onNotification("notifications/job/failed", (params) => {
  console.error(`Job ${params.jobId} failed: ${params.summary}`);
  if (params.reasonCode === "CONFLICT") {
    console.error("Patch conflict detected - update baseline commit");
  }
});
```

---

## Error Codes

### Tool Call Errors

| Code | Description | Solution |
|------|-------------|----------|
| `INVALID_SPEC` | JobSpec validation failed | Check schema requirements |
| `JOB_NOT_FOUND` | Job ID doesn't exist | Verify jobId is correct |
| `ALREADY_TERMINAL` | Cannot cancel finished job | N/A |
| `RATE_LIMIT` | Too many concurrent jobs | Wait or increase concurrency |

### Resource Errors

| Code | Description | Solution |
|------|-------------|----------|
| `RESOURCE_NOT_FOUND` | Resource doesn't exist | Check job is finished |
| `ARTIFACT_MISSING` | Artifact not yet created | Wait for job completion |

---

## Rate Limits & Quotas

| Resource | Limit | Notes |
|----------|-------|-------|
| Concurrent jobs | Config: `MAX_CONCURRENCY` (default: 3) | Per server instance |
| Job TTL | Config: `ttlS` in JobSpec | Max recommended: 3600s |
| List page size | 100 jobs | Use pagination |
| Idempotency window | 24 hours | After terminal state |

---

## Best Practices

### 1. Use Descriptive Idempotency Keys

```typescript
// Good
idempotencyKey: `${repoName}-${taskType}-${hash(spec)}`

// Bad
idempotencyKey: Math.random().toString()
```

### 2. Subscribe Before Submitting

```typescript
// Subscribe first to avoid missing notifications
mcp.subscribeResource(`mcp://jobs/${futureJobId}/status`);
const { jobId } = await mcp.callTool("jobs_submit", { spec });
```

### 3. Handle Idempotent Returns

```typescript
const { jobId } = await submit(spec);
const existing = await mcp.callTool("jobs_get", { jobId });

if (existing.state !== "QUEUED") {
  console.log("Job was already submitted previously");
}
```

### 4. Use State Versions for Deduplication

```typescript
const seenVersions = new Set();

mcp.onNotification("notifications/resources/updated", (params) => {
  if (seenVersions.has(params.stateVersion)) return;
  seenVersions.add(params.stateVersion);
  // Process update
});
```

---

Continue to [**Executors**](executors.md) to configure AI backends.
