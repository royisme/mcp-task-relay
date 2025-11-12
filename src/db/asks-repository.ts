/**
 * Asks repository - persistence for Ask/Answer protocol requests
 */

import type { Database } from 'better-sqlite3';
import {
  AskRecordSchema,
  type AskRecord,
  type AskStatus,
  type AskType,
} from '../models/index.js';
import { Result, Ok, Err } from '../models/index.js';

interface AskRow {
  ask_id: string;
  job_id: string;
  step_id: string;
  ask_type: string;
  prompt: string;
  context_hash: string;
  constraints_json: string | null;
  role_id: string | null;
  meta_json: string | null;
  created_at: number;
  status: string;
}

function rowToRecord(row: AskRow): Result<AskRecord, string> {
  try {
    const record: AskRecord = {
      askId: row.ask_id,
      jobId: row.job_id,
      stepId: row.step_id,
      askType: row.ask_type as AskType,
      prompt: row.prompt,
      contextHash: row.context_hash,
      constraints: row.constraints_json
        ? (JSON.parse(row.constraints_json) as AskRecord['constraints'])
        : undefined,
      roleId: row.role_id ?? undefined,
      meta: row.meta_json ? (JSON.parse(row.meta_json) as Record<string, unknown>) : undefined,
      createdAt: row.created_at,
      status: row.status as AskStatus,
    };

    const parsed = AskRecordSchema.safeParse(record);
    if (!parsed.success) {
      return Err(`Invalid ask record: ${parsed.error.message}`);
    }

    return Ok(parsed.data);
  } catch (error) {
    return Err(`Failed to parse ask row: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface CreateAskParams {
  askId: string;
  jobId: string;
  stepId: string;
  askType: AskType;
  prompt: string;
  contextHash: string;
  constraints?: AskRecord['constraints'];
  roleId?: string;
  meta?: AskRecord['meta'];
}

export class AsksRepository {
  constructor(private readonly db: Database) {}

  create(params: CreateAskParams): Result<AskRecord, string> {
    const now = Date.now();

    try {
      const stmt = this.db.prepare(`
        INSERT INTO asks (
          ask_id,
          job_id,
          step_id,
          ask_type,
          prompt,
          context_hash,
          constraints_json,
          role_id,
          meta_json,
          created_at,
          status
        ) VALUES (
          @askId,
          @jobId,
          @stepId,
          @askType,
          @prompt,
          @contextHash,
          @constraintsJson,
          @roleId,
          @metaJson,
          @createdAt,
          'PENDING'
        )
      `);

      stmt.run({
        askId: params.askId,
        jobId: params.jobId,
        stepId: params.stepId,
        askType: params.askType,
        prompt: params.prompt,
        contextHash: params.contextHash,
        constraintsJson:
          params.constraints !== undefined ? JSON.stringify(params.constraints) : null,
        roleId: params.roleId ?? null,
        metaJson: params.meta !== undefined ? JSON.stringify(params.meta) : null,
        createdAt: now,
      });

      return this.getById(params.askId);
    } catch (error) {
      return Err(`Failed to create ask: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getById(askId: string): Result<AskRecord, string> {
    const row = this.db
      .prepare('SELECT * FROM asks WHERE ask_id = ?')
      .get(askId) as AskRow | undefined;

    if (!row) {
      return Err(`Ask not found: ${askId}`);
    }

    return rowToRecord(row);
  }

  listByJob(jobId: string): Result<AskRecord[], string> {
    const rows = this.db
      .prepare('SELECT * FROM asks WHERE job_id = ? ORDER BY created_at ASC')
      .all(jobId) as AskRow[];

    const records: AskRecord[] = [];
    for (const row of rows) {
      const parsed = rowToRecord(row);
      if (!parsed.ok) {
        return Err(parsed.error);
      }
      records.push(parsed.value);
    }

    return Ok(records);
  }

  updateStatus(askId: string, status: AskStatus): Result<void, string> {
    try {
      const stmt = this.db.prepare(
        'UPDATE asks SET status = @status WHERE ask_id = @askId'
      );
      const result = stmt.run({ askId, status });
      if (result.changes === 0) {
        return Err(`Ask not found: ${askId}`);
      }
      return Ok(undefined);
    } catch (error) {
      return Err(`Failed to update ask status: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
