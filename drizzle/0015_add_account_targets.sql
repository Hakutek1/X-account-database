CREATE TABLE IF NOT EXISTS xstats_account_targets (
  session_id TEXT PRIMARY KEY,
  handles_json TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 0,
  initialized INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
