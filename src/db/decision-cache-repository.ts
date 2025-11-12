/**
 * Decision cache repository - stores reusable policy and answer decisions
 */

import type { Database } from 'better-sqlite3';
import {
  DecisionCacheRecordSchema,
  type DecisionCacheRecord,
} from '../models/index.js';
import { Result, Ok, Err } from '../models/index.js';

interface DecisionCacheRow {
  decision_key: string;
  answer_json: string | null;
  answer_text: string | null;
  policy_trace_json: string | null;
  created_at: number;
  ttl_seconds: number;
}

function rowToRecord(row: DecisionCacheRow): Result<DecisionCacheRecord, string> {
  try {
    const record: DecisionCacheRecord = {
      decisionKey: row.decision_key,
      answerJson: row.answer_json ? (JSON.parse(row.answer_json) as unknown) : undefined,
      answerText: row.answer_text ?? undefined,
      policyTrace: row.policy_trace_json
        ? (JSON.parse(row.policy_trace_json) as unknown)
        : undefined,
      createdAt: row.created_at,
      ttlSeconds: row.ttl_seconds,
    };

    const parsed = DecisionCacheRecordSchema.safeParse(record);
    if (!parsed.success) {
      return Err(`Invalid cache record: ${parsed.error.message}`);
    }

    return Ok(parsed.data);
  } catch (error) {
    return Err(
      `Failed to parse decision cache row: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export interface UpsertDecisionParams {
  decisionKey: string;
  answerJson?: unknown;
  answerText?: string;
  policyTrace?: unknown;
  ttlSeconds: number;
}

export class DecisionCacheRepository {
  constructor(private readonly db: Database) {}

  get(decisionKey: string): Result<DecisionCacheRecord | null, string> {
    const row = this.db
      .prepare('SELECT * FROM decision_cache WHERE decision_key = ?')
      .get(decisionKey) as DecisionCacheRow | undefined;

    if (!row) {
      return Ok(null);
    }

    return rowToRecord(row);
  }

  upsert(params: UpsertDecisionParams): Result<DecisionCacheRecord, string> {
    const now = Date.now();

    try {
      const stmt = this.db.prepare(`
        INSERT INTO decision_cache (
          decision_key,
          answer_json,
          answer_text,
          policy_trace_json,
          created_at,
          ttl_seconds
        ) VALUES (
          @decisionKey,
          @answerJson,
          @answerText,
          @policyTraceJson,
          @createdAt,
          @ttlSeconds
        )
        ON CONFLICT(decision_key) DO UPDATE SET
          answer_json = excluded.answer_json,
          answer_text = excluded.answer_text,
          policy_trace_json = excluded.policy_trace_json,
          created_at = excluded.created_at,
          ttl_seconds = excluded.ttl_seconds
      `);

      stmt.run({
        decisionKey: params.decisionKey,
        answerJson: params.answerJson !== undefined ? JSON.stringify(params.answerJson) : null,
        answerText: params.answerText ?? null,
        policyTraceJson: params.policyTrace ? JSON.stringify(params.policyTrace) : null,
        createdAt: now,
        ttlSeconds: params.ttlSeconds,
      });

      const fetched = this.get(params.decisionKey);
      if (!fetched.ok) {
        return fetched;
      }

      if (!fetched.value) {
        return Err('Decision cache entry not found after upsert');
      }

      return Ok(fetched.value);
    } catch (error) {
      return Err(
        `Failed to upsert decision cache: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  purgeExpired(now: number = Date.now()): Result<number, string> {
    try {
      const stmt = this.db.prepare(
        'DELETE FROM decision_cache WHERE created_at + (ttl_seconds * 1000) < @now'
      );
      const result = stmt.run({ now });
      return Ok(result.changes ?? 0);
    } catch (error) {
      return Err(
        `Failed to purge decision cache: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
