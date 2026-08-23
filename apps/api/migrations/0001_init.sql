-- cron402 initial schema
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  payer_address TEXT NOT NULL,
  schedule TEXT NOT NULL,
  target_url TEXT NOT NULL,
  target_method TEXT NOT NULL DEFAULT 'POST',
  target_headers TEXT,
  target_body TEXT,
  credits INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  next_run_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_payer ON jobs (payer_address);
CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs (status, next_run_at);

CREATE TABLE IF NOT EXISTS executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  run_at INTEGER NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0,
  status_code INTEGER,
  error TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_exec_job ON executions (job_id, run_at DESC);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT,
  payer_address TEXT,
  amount_usd TEXT NOT NULL,
  runs INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS job_nonces (
  job_id TEXT PRIMARY KEY,
  last_ts INTEGER NOT NULL DEFAULT 0
);
