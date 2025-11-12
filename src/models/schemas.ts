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
    JobStates.WAITING_ON_ANSWER,
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
// Ask/Answer Protocol
// ============================================================================

export const AskTypeSchema = z.enum([
  'CLARIFICATION',
  'RESOURCE_FETCH',
  'POLICY_DECISION',
  'APPROVAL',
  'CHOICE',
]);

export const AskConstraintsSchema = z
  .object({
    timeout_s: z.number().int().positive().optional(),
    max_tokens: z.number().int().positive().optional(),
    allowed_tools: z.array(z.string()).optional(),
  })
  .optional();

export const ContextEnvelopeSchema = z.object({
  job_snapshot: z.object({
    repo: z.string().optional(), // Optional: default 'unknown'
    commit_sha: z.string().optional(), // Optional: default 'unknown'
    env_profile: z.string().optional(), // Optional: default 'dev'
    policy_version: z.string().optional(), // Optional: default '1.0'
  }),
  facts: z.record(z.unknown()).optional(), // Optional: skip if empty
  tool_caps: z.record(z.object({
    database: z.string().optional(),
    tables: z.array(z.string()).optional(),
    read_only: z.boolean().optional(),
    timeout_ms: z.number().optional(),
  })).optional(),
  role: z.string(),
});

export const AskPayloadSchema = z.object({
  type: z.literal('Ask'),
  ask_id: z.string().uuid(),
  job_id: z.string(),
  step_id: z.string(),
  ask_type: AskTypeSchema,
  prompt: z.string().min(1),
  context_hash: z.string().min(1),
  context_envelope: ContextEnvelopeSchema,
  constraints: AskConstraintsSchema,
  role_id: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
});

export const AskStatusSchema = z.enum([
  'PENDING',
  'ANSWERED',
  'REJECTED',
  'TIMEOUT',
  'ERROR',
]);

export const AskRecordSchema = z.object({
  askId: z.string().uuid(),
  jobId: z.string(),
  stepId: z.string(),
  askType: AskTypeSchema,
  prompt: z.string(),
  contextHash: z.string(),
  contextEnvelope: ContextEnvelopeSchema,
  constraints: AskConstraintsSchema,
  roleId: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
  createdAt: z.number().int().positive(),
  status: AskStatusSchema,
});

export const AnswerStatusSchema = z.enum([
  'ANSWERED',
  'REJECTED',
  'TIMEOUT',
  'ERROR',
]);

export const AttestationSchema = z.object({
  context_hash: z.string(),
  role_id: z.string(),
  role_version: z.string(),
  model: z.string(),
  prompt_fingerprint: z.string(),
  tools_used: z.array(z.string()),
  policy_version: z.string(),
});

export const AnswerPayloadSchema = z.object({
  type: z.literal('Answer'),
  ask_id: z.string().uuid(),
  job_id: z.string(),
  step_id: z.string(),
  status: AnswerStatusSchema,
  answer_text: z.string().optional(),
  answer_json: z.unknown().optional(),
  attestation: AttestationSchema.optional(),
  artifacts: z.array(z.string()).optional(),
  policy_trace: z.unknown().optional(),
  cacheable: z.boolean().optional(),
  ask_back: z.string().optional(),
  error: z.string().optional(),
});

export const AnswerRecordSchema = z.object({
  askId: z.string().uuid(),
  jobId: z.string(),
  stepId: z.string(),
  status: AnswerStatusSchema,
  answerText: z.string().optional(),
  answerJson: z.unknown().optional(),
  attestation: AttestationSchema.optional(),
  artifacts: z.array(z.string()).optional(),
  policyTrace: z.unknown().optional(),
  cacheable: z.boolean().default(true),
  askBack: z.string().optional(),
  error: z.string().optional(),
  createdAt: z.number().int().positive(),
});

export const DecisionCacheRecordSchema = z.object({
  decisionKey: z.string(),
  answerJson: z.unknown().optional(),
  answerText: z.string().optional(),
  policyTrace: z.unknown().optional(),
  createdAt: z.number().int().positive(),
  ttlSeconds: z.number().int().positive(),
});

export type AskType = z.infer<typeof AskTypeSchema>;
export type ContextEnvelope = z.infer<typeof ContextEnvelopeSchema>;
export type AskPayload = z.infer<typeof AskPayloadSchema>;
export type AskRecord = z.infer<typeof AskRecordSchema>;
export type AskStatus = z.infer<typeof AskStatusSchema>;
export type AnswerStatus = z.infer<typeof AnswerStatusSchema>;
export type Attestation = z.infer<typeof AttestationSchema>;
export type AnswerPayload = z.infer<typeof AnswerPayloadSchema>;
export type AnswerRecord = z.infer<typeof AnswerRecordSchema>;
export type DecisionCacheRecord = z.infer<typeof DecisionCacheRecordSchema>;

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
