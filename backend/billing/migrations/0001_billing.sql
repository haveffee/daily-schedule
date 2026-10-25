PRAGMA foreign_keys = ON;

-- Isolated from reminder jobs and personal planning/finance data.
CREATE TABLE IF NOT EXISTS billing_orders (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  plan_id TEXT NOT NULL CHECK (plan_id IN ('monthly', 'yearly')),
  amount INTEGER NOT NULL CHECK ((plan_id = 'monthly' AND amount = 800) OR (plan_id = 'yearly' AND amount = 7200)),
  currency TEXT NOT NULL CHECK (currency = 'BYN'),
  provider_plan_id TEXT NOT NULL,
  provider_id TEXT UNIQUE,
  checkout_url TEXT,
  state TEXT NOT NULL CHECK (state IN ('creating', 'pending', 'active', 'canceled', 'failed', 'expired')),
  provider_state TEXT,
  paid_until INTEGER NOT NULL DEFAULT 0,
  renew_at INTEGER NOT NULL DEFAULT 0,
  canceled INTEGER NOT NULL DEFAULT 0 CHECK (canceled IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- One unresolved/renewing subscription per account, including simultaneous clicks.
CREATE UNIQUE INDEX IF NOT EXISTS billing_open_account
  ON billing_orders(uid) WHERE state IN ('creating', 'pending', 'active');
CREATE INDEX IF NOT EXISTS billing_account_history ON billing_orders(uid, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES billing_orders(id),
  provider_id TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
