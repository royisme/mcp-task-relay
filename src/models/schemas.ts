/**
 * Zod schemas for all data models
 * Single source of truth for validation
 */

import { z } from 'zod';
import { JobStates, FailReasons, Priorities } from './states.js';

// ============================================================================
// Repository & Context Schemas
// ============================================================================

export const RepoSchema = z.object({
  type: z.enum(['local', 'git']),
  path: z.string().optional(),
  url: z.string().url().optional(),
  baseBranch: z.string(),
  baselineCommit: z.string().regex(/^[0-9a-f]{40}$/i),
});

export const CodeSnippetSchema = z.object({
  path: z.string(),
  from: z.number().int().min(1),
  to: z.number().int().min(1),
});

export const ContextSchema = z.object({
  dirTreeDigest: z.string().optional(),
  keySignatures: z.array(z.string()).optional(),
  codeSnippets: z.array(CodeSnippetSchema).optional(),
});

export const ScopeSchema = z.object({
  readPaths: z.array(z.string()),
  fileGlobs: z.array(z.string()).optional(),
  disallowReformatting: z.boolean().default(false),
});

export const TaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(10000),
  acceptance: z.array(z.string()),
});

// ============================================================================
// Execution & Output Schemas
// ============================================================================

export const OutputContractSchema = z.tuple([
  z.literal('DIFF'),
  z.literal('TEST_PLAN'),
  z.literal('NOTES'),
]);

export const ExecutionSchema = z.object({
  preferredModel: z.string().default('gpt-4'),
  sandbox: z.literal('read-only'),
  askPolicy: z.literal('untrusted'),
  timeoutS: z.number().int().positive().optional(),
  priority: z.enum([Priorities.P0, Priorities.P1, Priorities.P2]).default(Priorities.P1),
  ttlS: z.number().int().positive().default(3600), // 1 hour default
});

export const NotifySchema = z.object({
  enablePr: z.boolean().default(false),
  webhook: z.string().url().optional(),
});

// ============================================================================
// JobSpec - The complete job specification
// ============================================================================

export const JobSpecSchema = z.object({
  repo: RepoSchema,
  task: TaskSchema,
  scope: ScopeSchema,
  context: ContextSchema.optional(),
  outputContract: OutputContractSchema,
  execution: ExecutionSchema,
  idempotencyKey: z.string().min(1),
  notify: NotifySchema.optional(),
});

export type JobSpec = z.infer<typeof JobSpecSchema>;
export type Repo = z.infer<typeof RepoSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Scope = z.infer<typeof ScopeSchema>;
export type Context = z.infer<typeof ContextSchema>;
export type Execution = z.infer<typeof ExecutionSchema>;
export type Notify = z.infer<typeof NotifySchema>;
export type CodeSnippet = z.infer<typeof CodeSnippetSchema>;

// ============================================================================
// Job Status & Summary
// ============================================================================

export const JobStatusSchema = z.object({
  state: z.enum([
    JobStates.QUEUED,
    JobStates.RUNNING,
    JobStates.SUCCEEDED,
    JobStates.FAILED,
    JobStates.CANCELED,
    JobStates.EXPIRED,
    JobStates.STALE,
  ]),
  stateVersion: z.number().int().min(0),
  createdAt: z.number().int().positive(),
  startedAt: z.number().int().positive().optional(),
  finishedAt: z.number().int().positive().optional(),
  durationMs: z.number().int().min(0).optional(),
  attempt: z.number().int().min(0).default(0),
  reasonCode: z.enum([
    FailReasons.BAD_ARTIFACTS,
    FailReasons.CONFLICT,
    FailReasons.POLICY,
    FailReasons.EXECUTOR_ERROR,
    FailReasons.TIMEOUT,
    FailReasons.INTERNAL_ERROR,
  ]).optional(),
  pr: z.object({
    url: z.string().url(),
    number: z.number().int().positive(),
    status: z.string(),
  }).optional(),
});

export type JobStatus = z.infer<typeof JobStatusSchema>;

// ============================================================================
// Job - Full job record (internal)
// ============================================================================

export const JobRecordSchema = z.object({
  id: z.string(),
  idempotencyKey: z.string(),
  state: JobStatusSchema.shape.state,
  stateVersion: z.number().int().min(0),
  priority: z.enum([Priorities.P0, Priorities.P1, Priorities.P2]),
  createdAt: z.number().int().positive(),
  startedAt: z.number().int().positive().nullable(),
  finishedAt: z.number().int().positive().nullable(),
  ttlS: z.number().int().positive(),
  heartbeatAt: z.number().int().positive().nullable(),
  leaseOwner: z.string().nullable(),
  leaseExpiresAt: z.number().int().positive().nullable(),
  spec: JobSpecSchema,
  summary: z.string().nullable(),
  reasonCode: JobStatusSchema.shape.reasonCode.nullable(),
});

export type JobRecord = z.infer<typeof JobRecordSchema>;

// ============================================================================
// Artifact Metadata
// ============================================================================

export const ArtifactKindSchema = z.enum(['patch.diff', 'out.md', 'logs.txt', 'pr.json']);

export const ArtifactMetaSchema = z.object({
  jobId: z.string(),
  kind: ArtifactKindSchema,
  uri: z.string(),
  digest: z.string(),
  size: z.number().int().min(0),
  createdAt: z.number().int().positive(),
});

export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;
export type ArtifactMeta = z.infer<typeof ArtifactMetaSchema>;

// ============================================================================
// Attempt Record
// ============================================================================

export const AttemptRecordSchema = z.object({
  jobId: z.string(),
  attemptNo: z.number().int().min(0),
  leaseOwner: z.string(),
  startedAt: z.number().int().positive(),
  finishedAt: z.number().int().positive().nullable(),
  resultCode: z.string().nullable(),
  reason: z.string().nullable(),
});

export type AttemptRecord = z.infer<typeof AttemptRecordSchema>;

// ============================================================================
// Event Record
// ============================================================================

export const EventRecordSchema = z.object({
  id: z.number().int().positive().optional(),
  jobId: z.string(),
  ts: z.number().int().positive(),
  type: z.string(),
  payload: z.record(z.unknown()),
});

export type EventRecord = z.infer<typeof EventRecordSchema>;

// ============================================================================
// MCP Tool Requests & Responses
// ============================================================================

export const SubmitRequestSchema = z.object({
  spec: JobSpecSchema,
});

export const SubmitResponseSchema = z.object({
  jobId: z.string(),
});

export const GetRequestSchema = z.object({
  jobId: z.string(),
});

export const GetResponseSchema = z.object({
  id: z.string(),
  state: JobStatusSchema.shape.state,
  summary: z.string().nullable(),
  lastUpdate: z.number().int().positive(),
  attempt: z.number().int().min(0),
  pr: JobStatusSchema.shape.pr.optional(),
});

export const ListRequestSchema = z.object({
  state: JobStatusSchema.shape.state.optional(),
  limit: z.number().int().positive().max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

export const ListResponseSchema = z.object({
  items: z.array(GetResponseSchema),
  total: z.number().int().min(0),
  hasMore: z.boolean(),
});

export const CancelRequestSchema = z.object({
  jobId: z.string(),
});

export const CancelResponseSchema = z.object({
  ok: z.boolean(),
  state: JobStatusSchema.shape.state,
});

export type SubmitRequest = z.infer<typeof SubmitRequestSchema>;
export type SubmitResponse = z.infer<typeof SubmitResponseSchema>;
export type GetRequest = z.infer<typeof GetRequestSchema>;
export type GetResponse = z.infer<typeof GetResponseSchema>;
export type ListRequest = z.infer<typeof ListRequestSchema>;
export type ListResponse = z.infer<typeof ListResponseSchema>;
export type CancelRequest = z.infer<typeof CancelRequestSchema>;
export type CancelResponse = z.infer<typeof CancelResponseSchema>;

// ============================================================================
// Notification Payloads
// ============================================================================

export const ResourceUpdatedNotificationSchema = z.object({
  uri: z.string(),
  stateVersion: z.number().int().min(0),
});

export const JobFinishedNotificationSchema = z.object({
  jobId: z.string(),
  state: z.enum([
    JobStates.SUCCEEDED,
    JobStates.FAILED,
    JobStates.CANCELED,
    JobStates.EXPIRED,
  ]),
  summary: z.string(),
  artifacts: z.object({
    patch: z.string().optional(),
    out: z.string().optional(),
    logs: z.string().optional(),
    pr: z.string().optional(),
  }),
  stateVersion: z.number().int().min(0),
  reasonCode: JobStatusSchema.shape.reasonCode.optional(),
  startedAt: z.number().int().positive().optional(),
  finishedAt: z.number().int().positive().optional(),
  durationMs: z.number().int().min(0).optional(),
  attempt: z.number().int().min(0),
});

export type ResourceUpdatedNotification = z.infer<typeof ResourceUpdatedNotificationSchema>;
export type JobFinishedNotification = z.infer<typeof JobFinishedNotificationSchema>;
