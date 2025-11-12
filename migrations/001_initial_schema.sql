-- Initial schema for JobHub
-- SQLite with WAL mode

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

-- Jobs table
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED', 'STALE')),
  state_version INTEGER NOT NULL DEFAULT 0,
  priority TEXT NOT NULL CHECK(priority IN ('P0', 'P1', 'P2')),
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  ttl_s INTEGER NOT NULL,
  heartbeat_at INTEGER,
  lease_owner TEXT,
  lease_expires_at INTEGER,

  -- JSON columns for complex data
  repo_json TEXT NOT NULL,
  task_json TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  context_json TEXT,
  execution_json TEXT NOT NULL,
  notify_json TEXT,

  -- Result fields
  summary TEXT,
  reason_code TEXT CHECK(reason_code IN ('BAD_ARTIFACTS', 'CONFLICT', 'POLICY', 'EXECUTOR_ERROR', 'TIMEOUT', 'INTERNAL_ERROR'))
);

-- Indexes for job queries
CREATE INDEX IF NOT EXISTS idx_jobs_state_priority_created
  ON jobs(state, priority, created_at);

CREATE INDEX IF NOT EXISTS idx_jobs_idempotency
  ON jobs(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_jobs_lease
  ON jobs(lease_expires_at)
  WHERE lease_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_heartbeat
  ON jobs(heartbeat_at)
  WHERE heartbeat_at IS NOT NULL AND state = 'RUNNING';

-- Attempts table
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL,
  lease_owner TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  result_code TEXT,
  reason TEXT,

  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  UNIQUE(job_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS idx_attempts_job_no
  ON attempts(job_id, attempt_no);

-- Artifacts table
CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('patch.diff', 'out.md', 'logs.txt', 'pr.json')),
  uri TEXT NOT NULL UNIQUE,
  digest TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,

  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_artifacts_job_kind
  ON artifacts(job_id, kind);

-- Events table (audit log)
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,

  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_events_job_ts
  ON events(job_id, ts);

CREATE INDEX IF NOT EXISTS idx_events_type
  ON events(type);

-- Record migration
INSERT INTO schema_version (version, applied_at) VALUES (1, strftime('%s', 'now') * 1000);
