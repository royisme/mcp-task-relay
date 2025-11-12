/**
 * Model and Schema tests
 */

import { describe, test, expect } from 'bun:test';
import {
  JobSpecSchema,
  JobStatusSchema,
  SubmitRequestSchema,
  ArtifactMetaSchema,
  AskPayloadSchema,
  AnswerPayloadSchema,
} from '../src/models/schemas.js';
import { asJobId, asCommitHash, isJobId } from '../src/models/brands.js';
import { canTransition, priorityToNumber } from '../src/models/states.js';

describe('Zod Schemas', () => {
  test('JobSpecSchema validates valid job spec', () => {
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
      scope: {
        readPaths: ['src/'],
        disallowReformatting: false,
      },
      outputContract: ['DIFF', 'TEST_PLAN', 'NOTES'] as const,
      execution: {
        preferredModel: 'gpt-4',
        sandbox: 'read-only' as const,
        askPolicy: 'untrusted' as const,
        priority: 'P1' as const,
        ttlS: 3600,
      },
      idempotencyKey: 'test-key-123',
    };

    const result = JobSpecSchema.safeParse(validSpec);
    expect(result.success).toBe(true);
  });

  test('JobSpecSchema rejects invalid spec', () => {
    const invalidSpec = {
      repo: {
        type: 'invalid',
      },
    };

    const result = JobSpecSchema.safeParse(invalidSpec);
    expect(result.success).toBe(false);
  });

  test('JobStatusSchema validates status', () => {
    const validStatus = {
      state: 'RUNNING',
      stateVersion: 5,
      createdAt: Date.now(),
      attempt: 0,
    };

    const result = JobStatusSchema.safeParse(validStatus);
    expect(result.success).toBe(true);
  });

  test('ArtifactMetaSchema validates artifact metadata', () => {
    const validMeta = {
      jobId: 'job_123',
      kind: 'patch.diff',
      uri: 'mcp://jobs/job_123/artifacts/patch.diff',
      digest: 'a'.repeat(64),
      size: 1024,
      createdAt: Date.now(),
    };

    const result = ArtifactMetaSchema.safeParse(validMeta);
    expect(result.success).toBe(true);
  });

  test('AskPayloadSchema validates ask payload', () => {
    const payload = {
      type: 'Ask' as const,
      ask_id: '123e4567-e89b-12d3-a456-426614174000',
      job_id: 'job_123',
      step_id: 'step-1',
      ask_type: 'CLARIFICATION' as const,
      prompt: 'Need more info',
      context_hash: 'ctx-abc',
      context_envelope: {
        job_snapshot: {
          repo: 'github.com/test/repo',
          env_profile: 'prod',
        },
        role: 'default',
      },
      constraints: { timeout_s: 30, allowed_tools: ['repo.read'] },
    };

    const result = AskPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  test('AnswerPayloadSchema validates answer payload', () => {
    const payload = {
      type: 'Answer' as const,
      ask_id: '123e4567-e89b-12d3-a456-426614174000',
      job_id: 'job_123',
      step_id: 'step-1',
      status: 'ANSWERED' as const,
      answer_text: 'All good',
      answer_json: { ok: true },
    };

    const result = AnswerPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });
});

describe('Branded Types', () => {
  test('isJobId validates job ID format', () => {
    expect(isJobId('job_123')).toBe(true);
    expect(isJobId('')).toBe(false);
    expect(isJobId(null)).toBe(false);
  });

  test('asJobId creates branded JobId', () => {
    const jobId = asJobId('job_abc123');
    expect(jobId).toBe('job_abc123');
  });

  test('asCommitHash validates commit hash', () => {
    const validHash = 'a'.repeat(40);
    expect(() => asCommitHash(validHash)).not.toThrow();

    const invalidHash = 'invalid';
    expect(() => asCommitHash(invalidHash)).toThrow();
  });
});

describe('State Machine', () => {
  test('canTransition validates state transitions', () => {
    expect(canTransition('QUEUED', 'RUNNING')).toBe(true);
    expect(canTransition('RUNNING', 'SUCCEEDED')).toBe(true);
    expect(canTransition('RUNNING', 'FAILED')).toBe(true);
    expect(canTransition('RUNNING', 'WAITING_ON_ANSWER')).toBe(true);
    expect(canTransition('WAITING_ON_ANSWER', 'RUNNING')).toBe(true);
    expect(canTransition('WAITING_ON_ANSWER', 'SUCCEEDED')).toBe(false);
    expect(canTransition('SUCCEEDED', 'RUNNING')).toBe(false); // Terminal state
  });

  test('priorityToNumber converts priorities', () => {
    expect(priorityToNumber('P0')).toBe(0);
    expect(priorityToNumber('P1')).toBe(1);
    expect(priorityToNumber('P2')).toBe(2);
  });
});
