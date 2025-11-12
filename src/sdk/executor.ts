import { createHash, randomUUID } from 'crypto';
import type { AskType, AnswerStatus } from '../models/schemas.js';

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

function buildContextHash(jobId: string, stepId: string, prompt: string): string {
  const preset = process.env['TASK_RELAY_CONTEXT_HASH'];
  if (preset && preset.length > 0) {
    return preset;
  }

  return createHash('sha256').update(`${jobId}:${stepId}:${prompt}`).digest('hex');
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

  const payload = {
    type: 'Ask' as const,
    ask_id: randomUUID(),
    job_id: jobId,
    step_id: stepId,
    ask_type: type,
    prompt,
    context_hash: buildContextHash(jobId, stepId, prompt),
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
