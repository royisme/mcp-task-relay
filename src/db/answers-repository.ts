/**
 * Answers repository - persistence for Ask/Answer protocol responses
 */

import type { Database } from 'better-sqlite3';
import {
  AnswerRecordSchema,
  type AnswerRecord,
  type AnswerStatus,
  type Attestation,
} from '../models/index.js';
import { Result, Ok, Err } from '../models/index.js';

interface AnswerRow {
  ask_id: string;
  job_id: string;
  step_id: string;
  status: string;
  answer_text: string | null;
  answer_json: string | null;
  attestation_json: string | null;
  artifacts_json: string | null;
  policy_trace_json: string | null;
  cacheable: number | null;
  ask_back: string | null;
  error: string | null;
  created_at: number;
}

function rowToRecord(row: AnswerRow): Result<AnswerRecord, string> {
  try {
    const record: AnswerRecord = {
      askId: row.ask_id,
      jobId: row.job_id,
      stepId: row.step_id,
      status: row.status as AnswerStatus,
      answerText: row.answer_text ?? undefined,
      answerJson: row.answer_json ? (JSON.parse(row.answer_json) as unknown) : undefined,
      attestation: row.attestation_json
        ? (JSON.parse(row.attestation_json) as Attestation)
        : undefined,
      artifacts: row.artifacts_json
        ? (JSON.parse(row.artifacts_json) as string[])
        : undefined,
      policyTrace: row.policy_trace_json
        ? (JSON.parse(row.policy_trace_json) as unknown)
        : undefined,
      cacheable: row.cacheable !== null ? row.cacheable === 1 : true,
      askBack: row.ask_back ?? undefined,
      error: row.error ?? undefined,
      createdAt: row.created_at,
    };

    const parsed = AnswerRecordSchema.safeParse(record);
    if (!parsed.success) {
      return Err(`Invalid answer record: ${parsed.error.message}`);
    }

    return Ok(parsed.data);
  } catch (error) {
    return Err(`Failed to parse answer row: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface CreateAnswerParams {
  askId: string;
  jobId: string;
  stepId: string;
  status: AnswerStatus;
  answerText?: string;
  answerJson?: unknown;
  attestation?: Attestation;
  artifacts?: string[];
  policyTrace?: unknown;
  cacheable?: boolean;
  askBack?: string;
  error?: string;
}

export class AnswersRepository {
  constructor(private readonly db: Database) {}

  create(params: CreateAnswerParams): Result<AnswerRecord, string> {
    const now = Date.now();

    try {
      const stmt = this.db.prepare(`
        INSERT INTO answers (
          ask_id,
          job_id,
          step_id,
          status,
          answer_text,
          answer_json,
          attestation_json,
          artifacts_json,
          policy_trace_json,
          cacheable,
          ask_back,
          error,
          created_at
        ) VALUES (
          @askId,
          @jobId,
          @stepId,
          @status,
          @answerText,
          @answerJson,
          @attestationJson,
          @artifactsJson,
          @policyTraceJson,
          @cacheable,
          @askBack,
          @error,
          @createdAt
        )
        ON CONFLICT(ask_id) DO UPDATE SET
          status = excluded.status,
          answer_text = excluded.answer_text,
          answer_json = excluded.answer_json,
          attestation_json = excluded.attestation_json,
          artifacts_json = excluded.artifacts_json,
          policy_trace_json = excluded.policy_trace_json,
          cacheable = excluded.cacheable,
          ask_back = excluded.ask_back,
          error = excluded.error,
          created_at = excluded.created_at
      `);

      stmt.run({
        askId: params.askId,
        jobId: params.jobId,
        stepId: params.stepId,
        status: params.status,
        answerText: params.answerText ?? null,
        answerJson: params.answerJson !== undefined ? JSON.stringify(params.answerJson) : null,
        attestationJson: params.attestation ? JSON.stringify(params.attestation) : null,
        artifactsJson: params.artifacts ? JSON.stringify(params.artifacts) : null,
        policyTraceJson: params.policyTrace ? JSON.stringify(params.policyTrace) : null,
        cacheable: params.cacheable === undefined ? 1 : params.cacheable ? 1 : 0,
        askBack: params.askBack ?? null,
        error: params.error ?? null,
        createdAt: now,
      });

      const lookup = this.getByAskId(params.askId);
      if (!lookup.ok) {
        return lookup;
      }
      if (lookup.value === null) {
        return Err(`Answer not found after insert: ${params.askId}`);
      }
      return Ok(lookup.value);
    } catch (error) {
      return Err(`Failed to create answer: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getByAskId(askId: string): Result<AnswerRecord | null, string> {
    const row = this.db
      .prepare('SELECT * FROM answers WHERE ask_id = ?')
      .get(askId) as AnswerRow | undefined;

    if (!row) {
      return Ok(null);
    }

    return rowToRecord(row);
  }
}
