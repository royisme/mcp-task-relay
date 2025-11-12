/**
 * Artifacts repository - Type-safe artifact metadata storage
 */

import type { Database } from 'better-sqlite3';
import type { ArtifactMeta, ArtifactKind } from '../models/index.js';
import { ArtifactMetaSchema } from '../models/index.js';
import type { JobId } from '../models/index.js';
import { Result, Ok, Err } from '../models/index.js';

export interface ArtifactRow {
  id: number;
  job_id: string;
  kind: string;
  uri: string;
  digest: string;
  size: number;
  created_at: number;
}

function rowToMeta(row: ArtifactRow): Result<ArtifactMeta, string> {
  try {
    const meta: ArtifactMeta = {
      jobId: row.job_id,
      kind: row.kind as ArtifactKind,
      uri: row.uri,
      digest: row.digest,
      size: row.size,
      createdAt: row.created_at,
    };

    const parsed = ArtifactMetaSchema.safeParse(meta);
    if (!parsed.success) {
      return Err(`Invalid artifact meta: ${parsed.error.message}`);
    }

    return Ok(parsed.data);
  } catch (error) {
    return Err(`Failed to parse artifact row: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface CreateArtifactParams {
  jobId: JobId;
  kind: ArtifactKind;
  uri: string;
  digest: string;
  size: number;
}

export class ArtifactsRepository {
  constructor(private readonly db: Database) {}

  create(params: CreateArtifactParams): Result<ArtifactMeta, string> {
    const now = Date.now();

    try {
      const stmt = this.db.prepare(`
        INSERT INTO artifacts (job_id, kind, uri, digest, size, created_at)
        VALUES (@jobId, @kind, @uri, @digest, @size, @createdAt)
      `);

      stmt.run({
        jobId: params.jobId,
        kind: params.kind,
        uri: params.uri,
        digest: params.digest,
        size: params.size,
        createdAt: now,
      });

      return this.getByJobAndKind(params.jobId, params.kind);
    } catch (error) {
      return Err(`Failed to create artifact: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getByJobAndKind(jobId: JobId, kind: ArtifactKind): Result<ArtifactMeta, string> {
    const row = this.db.prepare(`
      SELECT * FROM artifacts
      WHERE job_id = ? AND kind = ?
    `).get(jobId, kind) as ArtifactRow | undefined;

    if (!row) {
      return Err(`Artifact not found: ${jobId}/${kind}`);
    }

    return rowToMeta(row);
  }

  listByJob(jobId: JobId): Result<ArtifactMeta[], string> {
    const rows = this.db.prepare(`
      SELECT * FROM artifacts
      WHERE job_id = ?
      ORDER BY created_at ASC
    `).all(jobId) as ArtifactRow[];

    const metas: ArtifactMeta[] = [];
    for (const row of rows) {
      const result = rowToMeta(row);
      if (result.ok) {
        metas.push(result.value);
      } else {
        return Err(result.error);
      }
    }

    return Ok(metas);
  }

  exists(jobId: JobId, kind: ArtifactKind): boolean {
    const result = this.db.prepare(`
      SELECT COUNT(*) as count FROM artifacts
      WHERE job_id = ? AND kind = ?
    `).get(jobId, kind) as { count: number };

    return result.count > 0;
  }
}
