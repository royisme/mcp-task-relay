/**
 * Events repository - Audit log for all job state changes
 */

import type { Database } from 'better-sqlite3';
import type { EventRecord } from '../models/index.js';
import { EventRecordSchema } from '../models/index.js';
import type { JobId } from '../models/index.js';
import { Result, Ok, Err } from '../models/index.js';

export interface EventRow {
  id: number;
  job_id: string;
  ts: number;
  type: string;
  payload_json: string;
}

function rowToRecord(row: EventRow): Result<EventRecord, string> {
  try {
    const record: EventRecord = {
      id: row.id,
      jobId: row.job_id,
      ts: row.ts,
      type: row.type,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    };

    const parsed = EventRecordSchema.safeParse(record);
    if (!parsed.success) {
      return Err(`Invalid event record: ${parsed.error.message}`);
    }

    return Ok(parsed.data);
  } catch (error) {
    return Err(`Failed to parse event row: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface CreateEventParams {
  jobId: JobId;
  type: string;
  payload: Record<string, unknown>;
}

export class EventsRepository {
  constructor(private readonly db: Database) {}

  create(params: CreateEventParams): Result<EventRecord, string> {
    const now = Date.now();

    try {
      const stmt = this.db.prepare(`
        INSERT INTO events (job_id, ts, type, payload_json)
        VALUES (@jobId, @ts, @type, @payloadJson)
      `);

      const result = stmt.run({
        jobId: params.jobId,
        ts: now,
        type: params.type,
        payloadJson: JSON.stringify(params.payload),
      });

      const insertedId = result.lastInsertRowid;

      const row = this.db.prepare(`
        SELECT * FROM events WHERE id = ?
      `).get(insertedId) as EventRow | undefined;

      if (!row) {
        return Err('Failed to retrieve inserted event');
      }

      return rowToRecord(row);
    } catch (error) {
      return Err(`Failed to create event: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  listByJob(jobId: JobId, limit?: number): Result<EventRecord[], string> {
    let query = 'SELECT * FROM events WHERE job_id = ? ORDER BY ts DESC';
    const params: unknown[] = [jobId];

    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
    }

    const rows = this.db.prepare(query).all(...params) as EventRow[];

    const records: EventRecord[] = [];
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

  listByType(type: string, limit?: number): Result<EventRecord[], string> {
    let query = 'SELECT * FROM events WHERE type = ? ORDER BY ts DESC';
    const params: unknown[] = [type];

    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
    }

    const rows = this.db.prepare(query).all(...params) as EventRow[];

    const records: EventRecord[] = [];
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
}
