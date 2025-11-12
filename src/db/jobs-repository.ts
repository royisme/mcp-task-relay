/**
 * Jobs repository - Type-safe database operations
 */

import type { Database } from 'better-sqlite3';
import type {
  JobRecord,
  JobSpec,
  JobState,
  Priority,
  FailReason,
} from '../models/index.js';
import { JobRecordSchema } from '../models/index.js';
import { asJobId, type JobId, type LeaseOwner } from '../models/index.js';
import { Result, Ok, Err } from '../models/index.js';

export interface JobRow {
  id: string;
  idempotency_key: string;
  state: string;
  state_version: number;
  priority: string;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  ttl_s: number;
  heartbeat_at: number | null;
  lease_owner: string | null;
  lease_expires_at: number | null;
  repo_json: string;
  task_json: string;
  scope_json: string;
  context_json: string | null;
  execution_json: string;
  notify_json: string | null;
  summary: string | null;
  reason_code: string | null;
}

function rowToRecord(row: JobRow): Result<JobRecord, string> {
  try {
    const spec: JobSpec = {
      repo: JSON.parse(row.repo_json) as JobSpec['repo'],
      task: JSON.parse(row.task_json) as JobSpec['task'],
      scope: JSON.parse(row.scope_json) as JobSpec['scope'],
      context: row.context_json ? (JSON.parse(row.context_json) as JobSpec['context']) : undefined,
      outputContract: ['DIFF', 'TEST_PLAN', 'NOTES'],
      execution: JSON.parse(row.execution_json) as JobSpec['execution'],
      idempotencyKey: row.idempotency_key,
      notify: row.notify_json ? (JSON.parse(row.notify_json) as JobSpec['notify']) : undefined,
    };

    const record: JobRecord = {
      id: row.id,
      idempotencyKey: row.idempotency_key,
      state: row.state as JobState,
      stateVersion: row.state_version,
      priority: row.priority as Priority,
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      ttlS: row.ttl_s,
      heartbeatAt: row.heartbeat_at,
      leaseOwner: row.lease_owner,
      leaseExpiresAt: row.lease_expires_at,
      spec,
      summary: row.summary,
      reasonCode: row.reason_code as FailReason | null,
    };

    const parsed = JobRecordSchema.safeParse(record);
    if (!parsed.success) {
      return Err(`Invalid job record: ${parsed.error.message}`);
    }

    return Ok(parsed.data);
  } catch (error) {
    return Err(`Failed to parse job row: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface CreateJobParams {
  id: JobId;
  spec: JobSpec;
  priority: Priority;
  ttlS: number;
}

export interface UpdateJobStateParams {
  id: JobId;
  state: JobState;
  reasonCode?: FailReason;
  summary?: string;
}

export interface AcquireLeaseParams {
  owner: LeaseOwner;
  leaseTtlMs: number;
}

export class JobsRepository {
  constructor(private readonly db: Database) {}

  create(params: CreateJobParams): Result<JobRecord, string> {
    const now = Date.now();

    try {
      const stmt = this.db.prepare(`
        INSERT INTO jobs (
          id, idempotency_key, state, state_version, priority,
          created_at, ttl_s,
          repo_json, task_json, scope_json, context_json,
          execution_json, notify_json
        ) VALUES (
          @id, @idempotencyKey, @state, 0, @priority,
          @createdAt, @ttlS,
          @repoJson, @taskJson, @scopeJson, @contextJson,
          @executionJson, @notifyJson
        )
      `);

      stmt.run({
        id: params.id,
        idempotencyKey: params.spec.idempotencyKey,
        state: 'QUEUED',
        priority: params.priority,
        createdAt: now,
        ttlS: params.ttlS,
        repoJson: JSON.stringify(params.spec.repo),
        taskJson: JSON.stringify(params.spec.task),
        scopeJson: JSON.stringify(params.spec.scope),
        contextJson: params.spec.context ? JSON.stringify(params.spec.context) : null,
        executionJson: JSON.stringify(params.spec.execution),
        notifyJson: params.spec.notify ? JSON.stringify(params.spec.notify) : null,
      });

      return this.getById(params.id);
    } catch (error) {
      return Err(`Failed to create job: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getById(id: JobId): Result<JobRecord, string> {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;

    if (!row) {
      return Err(`Job not found: ${id}`);
    }

    return rowToRecord(row);
  }

  getByIdempotencyKey(key: string): Result<JobRecord | null, string> {
    const row = this.db.prepare('SELECT * FROM jobs WHERE idempotency_key = ?').get(key) as JobRow | undefined;

    if (!row) {
      return Ok(null);
    }

    return rowToRecord(row);
  }

  list(filters: { state?: JobState; limit: number; offset: number }): Result<JobRecord[], string> {
    let query = 'SELECT * FROM jobs';
    const params: unknown[] = [];

    if (filters.state) {
      query += ' WHERE state = ?';
      params.push(filters.state);
    }

    query += ' ORDER BY priority ASC, created_at ASC LIMIT ? OFFSET ?';
    params.push(filters.limit, filters.offset);

    const rows = this.db.prepare(query).all(...params) as JobRow[];

    const records: JobRecord[] = [];
    for (const row of rows) {
      const result = rowToRecord(row);
      if (result.ok) {
        records.push(result.value);
      } else {
        return Err(result.error);
      }
    }

    return Ok(records);
  }

  count(state?: JobState): number {
    if (state) {
      const result = this.db.prepare('SELECT COUNT(*) as count FROM jobs WHERE state = ?').get(state) as { count: number };
      return result.count;
    }
    const result = this.db.prepare('SELECT COUNT(*) as count FROM jobs').get() as { count: number };
    return result.count;
  }

  updateState(params: UpdateJobStateParams): Result<void, string> {
    try {
      const stmt = this.db.prepare(`
        UPDATE jobs
        SET state = @state,
            state_version = state_version + 1,
            summary = COALESCE(@summary, summary),
            reason_code = @reasonCode,
            finished_at = CASE
              WHEN @state IN ('SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED')
              THEN @now
              ELSE finished_at
            END
        WHERE id = @id
      `);

      const result = stmt.run({
        id: params.id,
        state: params.state,
        summary: params.summary ?? null,
        reasonCode: params.reasonCode ?? null,
        now: Date.now(),
      });

      if (result.changes === 0) {
        return Err(`Job not found: ${params.id}`);
      }

      return Ok(undefined);
    } catch (error) {
      return Err(`Failed to update job state: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  acquireLease(params: AcquireLeaseParams): Result<JobId | null, string> {
    const now = Date.now();
    const leaseExpiry = now + params.leaseTtlMs;

    try {
      // Use transaction for atomic acquire
      const acquired = this.db.transaction(() => {
        // Find available job
        const row = this.db.prepare(`
          SELECT id FROM jobs
          WHERE state = 'QUEUED'
            AND (lease_expires_at IS NULL OR lease_expires_at < @now)
          ORDER BY priority ASC, created_at ASC
          LIMIT 1
        `).get({ now }) as { id: string } | undefined;

        if (!row) {
          return null;
        }

        // Acquire lease
        const stmt = this.db.prepare(`
          UPDATE jobs
          SET state = 'RUNNING',
              state_version = state_version + 1,
              lease_owner = @owner,
              lease_expires_at = @expiresAt,
              started_at = @now,
              heartbeat_at = @now
          WHERE id = @id AND state = 'QUEUED'
        `);

        const result = stmt.run({
          id: row.id,
          owner: params.owner,
          expiresAt: leaseExpiry,
          now,
        });

        return result.changes > 0 ? asJobId(row.id) : null;
      })();

      return Ok(acquired);
    } catch (error) {
      return Err(`Failed to acquire lease: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  renewLease(id: JobId, owner: LeaseOwner, leaseTtlMs: number): Result<boolean, string> {
    const now = Date.now();
    const leaseExpiry = now + leaseTtlMs;

    try {
      const stmt = this.db.prepare(`
        UPDATE jobs
        SET lease_expires_at = @expiresAt,
            heartbeat_at = @now
        WHERE id = @id
          AND lease_owner = @owner
          AND state = 'RUNNING'
      `);

      const result = stmt.run({
        id,
        owner,
        expiresAt: leaseExpiry,
        now,
      });

      return Ok(result.changes > 0);
    } catch (error) {
      return Err(`Failed to renew lease: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  releaseLease(id: JobId, owner: LeaseOwner): Result<void, string> {
    try {
      const stmt = this.db.prepare(`
        UPDATE jobs
        SET lease_owner = NULL,
            lease_expires_at = NULL
        WHERE id = @id AND lease_owner = @owner
      `);

      stmt.run({ id, owner });
      return Ok(undefined);
    } catch (error) {
      return Err(`Failed to release lease: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  incrementStateVersion(id: JobId): Result<number, string> {
    try {
      const stmt = this.db.prepare(`
        UPDATE jobs
        SET state_version = state_version + 1
        WHERE id = @id
        RETURNING state_version
      `);

      const result = stmt.get({ id }) as { state_version: number } | undefined;

      if (!result) {
        return Err(`Job not found: ${id}`);
      }

      return Ok(result.state_version);
    } catch (error) {
      return Err(`Failed to increment state version: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
