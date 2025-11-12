/**
 * SQLite database connection with WAL mode
 */

import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';

export interface DbConnection {
  db: DatabaseType;
  close: () => void;
}

export type StorageMode = 'memory' | 'sqlite';

export interface ConnectionOptions {
  mode: StorageMode;
}

export function createConnection(dbPath: string, options: ConnectionOptions): DbConnection {
  const db = new Database(dbPath, {
    verbose: process.env['NODE_ENV'] === 'development' ? console.log : undefined,
  });

  if (options.mode === 'sqlite') {
    // Enable WAL mode for better concurrency when using on-disk SQLite
    db.pragma('journal_mode = WAL');

    // Other performance optimizations
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -64000'); // 64MB cache
    db.pragma('temp_store = MEMORY');
    db.pragma('mmap_size = 30000000000'); // 30GB mmap
  }

  // Foreign key constraints apply to both storage modes
  db.pragma('foreign_keys = ON');

  return {
    db,
    close: () => db.close(),
  };
}

export function runMigrations(db: DatabaseType): void {
  // Inline schema creation - no external migration files needed during development
  const schema = `
    -- Schema version tracking
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );

    -- Jobs table
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL,
      state_version INTEGER NOT NULL DEFAULT 0,
      priority TEXT NOT NULL DEFAULT 'P1',
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      ttl_s INTEGER NOT NULL DEFAULT 3600,
      heartbeat_at INTEGER,
      lease_owner TEXT,
      lease_expires_at INTEGER,
      spec_json TEXT NOT NULL,
      summary TEXT,
      reason_code TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state, priority, created_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_lease ON jobs(lease_owner, lease_expires_at);

    -- Artifacts table
    CREATE TABLE IF NOT EXISTS artifacts (
      job_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      uri TEXT NOT NULL,
      digest TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (job_id, kind),
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    -- Events table
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_events_job ON events(job_id, ts);

    -- Phase 2: Ask/Answer tables
    CREATE TABLE IF NOT EXISTS asks (
      ask_id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      ask_type TEXT NOT NULL,
      prompt TEXT NOT NULL,
      context_hash TEXT NOT NULL,
      constraints_json TEXT,
      role_id TEXT,
      meta_json TEXT,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_asks_job ON asks(job_id);

    CREATE TABLE IF NOT EXISTS answers (
      ask_id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      status TEXT NOT NULL,
      answer_text TEXT,
      answer_json TEXT,
      artifacts_json TEXT,
      policy_trace_json TEXT,
      cacheable INTEGER DEFAULT 1,
      ask_back TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (ask_id) REFERENCES asks(ask_id) ON DELETE CASCADE,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_answers_job ON answers(job_id);

    CREATE TABLE IF NOT EXISTS decision_cache (
      decision_key TEXT PRIMARY KEY,
      answer_json TEXT,
      answer_text TEXT,
      policy_trace_json TEXT,
      created_at INTEGER NOT NULL,
      ttl_seconds INTEGER NOT NULL
    );

    -- Mark schema as initialized
    INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (2, ${Date.now()});
  `;

  db.exec(schema);
}
