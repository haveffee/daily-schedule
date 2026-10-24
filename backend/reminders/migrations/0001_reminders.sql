PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  uid TEXT PRIMARY KEY,
  plan_json TEXT NOT NULL DEFAULT '[]',
  revision TEXT NOT NULL,
  device_revision INTEGER NOT NULL DEFAULT 0,
  materialized_revision TEXT NOT NULL DEFAULT '',
  materialized_device_revision INTEGER NOT NULL DEFAULT -1,
  materialized_day TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL REFERENCES accounts(uid) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  last_test INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS devices_uid ON devices(uid);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL REFERENCES accounts(uid) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  revision TEXT NOT NULL,
  task_id TEXT NOT NULL,
  task_date TEXT NOT NULL,
  task_time TEXT NOT NULL,
  title TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','claimed','sent','dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt INTEGER NOT NULL,
  lock_until INTEGER NOT NULL DEFAULT 0,
  claim_token TEXT NOT NULL DEFAULT '',
  sent_at INTEGER
);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(state, next_attempt, due_at, expires_at);
CREATE INDEX IF NOT EXISTS jobs_uid ON jobs(uid, state);
CREATE INDEX IF NOT EXISTS jobs_device ON jobs(device_id);
CREATE INDEX IF NOT EXISTS jobs_expiry ON jobs(expires_at);
