-- An invalid future window must never block delivery for other accounts.
ALTER TABLE accounts ADD COLUMN materialize_retry_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN materialize_error TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS accounts_materialize_retry ON accounts(materialize_retry_at, materialized_day);
