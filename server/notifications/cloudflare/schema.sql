PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  subscription TEXT NOT NULL,
  language TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS subscription_owner ON subscriptions(uid);
CREATE INDEX IF NOT EXISTS subscription_expiry ON subscriptions(updated_at);
CREATE TABLE IF NOT EXISTS notifications (
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  at INTEGER NOT NULL,
  payload TEXT NOT NULL,
  revision TEXT NOT NULL,
  retry_at INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  claim TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (subscription_id,tag)
);
CREATE INDEX IF NOT EXISTS notification_due ON notifications(at,retry_at);
CREATE TABLE IF NOT EXISTS sent (
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (subscription_id,tag)
);
CREATE INDEX IF NOT EXISTS sent_expiry ON sent(sent_at);
CREATE TABLE IF NOT EXISTS rate_limits (
  uid TEXT PRIMARY KEY,
  window INTEGER NOT NULL,
  count INTEGER NOT NULL
);
