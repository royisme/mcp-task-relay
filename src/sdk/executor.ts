import { randomUUID } from 'crypto';
import type { AskType, AnswerStatus, ContextEnvelope, Attestation } from '../models/schemas.js';
import { AskAnswerErrors } from '../models/states.js';
import { stableHashContext } from '../utils/hash.js';

type AskOptions = {
  timeout_s?: number;
  allowed_tools?: string[];
  role_id?: string;
  prompt_overrides?: {
    system_append?: string;
    output_schema?: unknown;
  };
};

type AskResult<T> = { text?: string; json?: T };

type AskConstraints = {
  timeout_s?: number;
  max_tokens?: number;
  allowed_tools?: string[];
  tool_caps?: Record<string, unknown>;
};

type AskPayload = {
  type: 'Ask';
  ask_id: string;
  job_id: string;
  step_id: string;
  ask_type: AskType;
  prompt: string;
  context_hash: string;
  context_envelope: ContextEnvelope;
  constraints?: AskConstraints;
  role_id?: string;
  meta?: Record<string, unknown>;
};

type AskRecord = {
  askId: string;
};

type AnswerRecord<T> = {
  askId: string;
  jobId: string;
  stepId: string;
  status: AnswerStatus;
  answerText?: string;
  answerJson?: T;
  attestation?: Attestation;
  error?: string;
};

const DEFAULT_ORIGIN = 'http://localhost:3415';
const DEFAULT_WAIT_SECONDS = 25;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function buildContextEnvelope(
  jobId: string,
  stepId: string,
  role: string,
  options?: AskOptions
): ContextEnvelope {
  // Extract repo info from environment or use defaults
  const repo = process.env['TASK_RELAY_REPO'] ?? 'unknown';
  const commitSha = process.env['TASK_RELAY_COMMIT_SHA'] ?? 'unknown';
  const envProfile = process.env['TASK_RELAY_PROFILE'] ?? 'dev';
  const policyVersion = process.env['TASK_RELAY_POLICY_VERSION'] ?? '1.0';

  // Build facts from environment
  const facts: Record<string, unknown> = {
    job_id: jobId,
    step_id: stepId,
  };

  // Add any additional facts from environment variables prefixed with TASK_RELAY_FACT_
  for (const key in process.env) {
    if (key.startsWith('TASK_RELAY_FACT_')) {
      const factKey = key.replace('TASK_RELAY_FACT_', '').toLowerCase();
      facts[factKey] = process.env[key];
    }
  }

  // Build tool capabilities from options
  const toolCaps: Record<string, { timeout_ms?: number; read_only?: boolean }> = {};
  if (options?.allowed_tools) {
    for (const tool of options.allowed_tools) {
      const caps: { timeout_ms?: number; read_only?: boolean } = {
        read_only: true, // Default to read-only for safety
      };
      if (options.timeout_s) {
        caps.timeout_ms = options.timeout_s * 1000;
      }
      toolCaps[tool] = caps;
    }
  }

  return {
    job_snapshot: {
      repo,
      commit_sha: commitSha,
      env_profile: envProfile,
      policy_version: policyVersion,
    },
    facts,
    tool_caps: Object.keys(toolCaps).length > 0 ? toolCaps : undefined,
    role,
  };
}

function buildConstraints(options?: AskOptions): AskConstraints | undefined {
  if (!options) {
    return undefined;
  }

  const constraints: AskConstraints = {};

  if (options.timeout_s !== undefined) {
    constraints.timeout_s = options.timeout_s;
  }

  if (options.allowed_tools && options.allowed_tools.length > 0) {
    constraints.allowed_tools = options.allowed_tools;
  }

  return Object.keys(constraints).length > 0 ? constraints : undefined;
}

function buildMeta(options?: AskOptions): Record<string, unknown> | undefined {
  if (!options?.prompt_overrides) {
    return undefined;
  }

  return { prompt_overrides: options.prompt_overrides };
}

function getOrigin(): string {
  return process.env['ASK_ANSWER_ORIGIN'] ?? DEFAULT_ORIGIN;
}

function getWaitSeconds(): number {
  const configured = process.env['ASK_ANSWER_WAIT_SECONDS'];
  if (!configured) {
    return DEFAULT_WAIT_SECONDS;
  }

  const parsed = Number.parseInt(configured, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return DEFAULT_WAIT_SECONDS;
  }
  return parsed;
}

export async function ask<T = unknown>(
  type: AskType,
  prompt: string,
  options?: AskOptions
): Promise<AskResult<T>> {
  const jobId = requiredEnv('TASK_RELAY_JOB_ID');
  const stepId = requiredEnv('TASK_RELAY_STEP_ID');

  const constraints = buildConstraints(options);
  const meta = buildMeta(options);

  // Build context envelope with role
  const role = options?.role_id ?? 'default';
  const contextEnvelope = buildContextEnvelope(jobId, stepId, role, options);

  // Compute context hash from envelope
  const contextHash = stableHashContext(contextEnvelope);

  const payload = {
    type: 'Ask' as const,
    ask_id: randomUUID(),
    job_id: jobId,
    step_id: stepId,
    ask_type: type,
    prompt,
    context_hash: contextHash,
    context_envelope: contextEnvelope,
    ...(constraints ? { constraints } : {}),
    ...(options?.role_id ? { role_id: options.role_id } : {}),
    ...(meta ? { meta } : {}),
  } satisfies AskPayload;

  const origin = getOrigin();
  const askResponse = await fetch(new URL('/asks', origin), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!askResponse.ok) {
    const body = await safeReadBody(askResponse);
    throw new Error(`Failed to create Ask (${askResponse.status}): ${body}`);
  }

  const record = (await askResponse.json()) as AskRecord;
  const askId = record.askId;
  const waitSeconds = getWaitSeconds();

  while (true) {
    const answerUrl = new URL(`/asks/${askId}/answer?wait=${waitSeconds}s`, origin);
    const answerResponse = await fetch(answerUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (answerResponse.status === 204) {
      continue;
    }

    if (!answerResponse.ok) {
      const body = await safeReadBody(answerResponse);
      throw new Error(`Failed to fetch Answer (${answerResponse.status}): ${body}`);
    }

    const answer = (await answerResponse.json()) as AnswerRecord<T>;

    // Verify attestation if present
    if (answer.attestation) {
      if (answer.attestation.context_hash !== contextHash) {
        throw new Error(
          `${AskAnswerErrors.E_CONTEXT_MISMATCH}: Answer attestation context hash mismatch. ` +
          `Expected ${contextHash}, got ${answer.attestation.context_hash}`
        );
      }
    }

    switch (answer.status) {
      case 'ANSWERED':
        return {
          ...(answer.answerText !== undefined ? { text: answer.answerText } : {}),
          ...(answer.answerJson !== undefined ? { json: answer.answerJson } : {}),
        } satisfies AskResult<T>;
      case 'REJECTED':
        throw new Error(answer.error ?? answer.answerText ?? 'Ask rejected');
      case 'TIMEOUT':
        throw new Error(answer.error ?? 'Ask timed out waiting for scheduler response');
      case 'ERROR':
        throw new Error(answer.error ?? 'Scheduler failed to answer Ask');
      default:
        throw new Error(`Unknown answer status: ${answer.status}`);
    }
  }
}

interface TextReadableResponse {
  text(): Promise<string>;
}

async function safeReadBody(response: TextReadableResponse): Promise<string> {
  try {
    const text = await response.text();
    return text.length > 0 ? text : '<empty>';
  } catch (error) {
    return `<unreadable: ${error instanceof Error ? error.message : String(error)}>`;
  }
}
