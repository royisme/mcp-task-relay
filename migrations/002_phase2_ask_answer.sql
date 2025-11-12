BEGIN TRANSACTION;

-- Rebuild jobs table to add WAITING_ON_ANSWER state
ALTER TABLE jobs RENAME TO jobs_old;

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('QUEUED', 'RUNNING', 'WAITING_ON_ANSWER', 'SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED', 'STALE')),
  state_version INTEGER NOT NULL DEFAULT 0,
  priority TEXT NOT NULL CHECK(priority IN ('P0', 'P1', 'P2')),
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  ttl_s INTEGER NOT NULL,
  heartbeat_at INTEGER,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  repo_json TEXT NOT NULL,
  task_json TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  context_json TEXT,
  execution_json TEXT NOT NULL,
  notify_json TEXT,
  summary TEXT,
  reason_code TEXT CHECK(reason_code IN ('BAD_ARTIFACTS', 'CONFLICT', 'POLICY', 'EXECUTOR_ERROR', 'TIMEOUT', 'INTERNAL_ERROR'))
);

INSERT INTO jobs (
  id,
  idempotency_key,
  state,
  state_version,
  priority,
  created_at,
  started_at,
  finished_at,
  ttl_s,
  heartbeat_at,
  lease_owner,
  lease_expires_at,
  repo_json,
  task_json,
  scope_json,
  context_json,
  execution_json,
  notify_json,
  summary,
  reason_code
)
SELECT
  id,
  idempotency_key,
  CASE
    WHEN state NOT IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED', 'STALE')
      THEN 'RUNNING'
    ELSE state
  END AS state,
  state_version,
  priority,
  created_at,
  started_at,
  finished_at,
  ttl_s,
  heartbeat_at,
  lease_owner,
  lease_expires_at,
  repo_json,
  task_json,
  scope_json,
  context_json,
  execution_json,
  notify_json,
  summary,
  reason_code
FROM jobs_old;

DROP TABLE jobs_old;

CREATE INDEX idx_jobs_state_priority_created
  ON jobs(state, priority, created_at);

CREATE INDEX idx_jobs_idempotency
  ON jobs(idempotency_key);

CREATE INDEX idx_jobs_lease
  ON jobs(lease_expires_at)
  WHERE lease_expires_at IS NOT NULL;

CREATE INDEX idx_jobs_heartbeat
  ON jobs(heartbeat_at)
  WHERE heartbeat_at IS NOT NULL AND state IN ('RUNNING', 'WAITING_ON_ANSWER');

-- Ask/Answer tables
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
  status TEXT NOT NULL CHECK(status IN ('PENDING', 'ANSWERED', 'REJECTED', 'TIMEOUT', 'ERROR')),
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX idx_asks_job
  ON asks(job_id);

CREATE TABLE IF NOT EXISTS answers (
  ask_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ANSWERED', 'REJECTED', 'TIMEOUT', 'ERROR')),
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

CREATE INDEX idx_answers_job
  ON answers(job_id);

CREATE TABLE IF NOT EXISTS decision_cache (
  decision_key TEXT PRIMARY KEY,
  answer_json TEXT,
  answer_text TEXT,
  policy_trace_json TEXT,
  created_at INTEGER NOT NULL,
  ttl_seconds INTEGER NOT NULL
);

INSERT INTO schema_version (version, applied_at) VALUES (2, strftime('%s', 'now') * 1000);

COMMIT;
