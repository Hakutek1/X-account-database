/**
 * D1 schema used by the anonymous, cookie-scoped history.
 * Account opening dates deliberately do not have a column here.
 */
import { integer, index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { ACCOUNT_STATUSES } from "../lib/account-status";

export const xstatsSessions = sqliteTable("xstats_sessions", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
});

export const xstatsRuns = sqliteTable("xstats_runs", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  fetchedAt: text("fetched_at").notNull(),
  sourceSummary: text("source_summary").notNull(),
  successCount: integer("success_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
}, (table) => ({ sessionIndex: index("xstats_runs_session_idx").on(table.sessionId, table.fetchedAt) }));

export const xstatsSnapshots = sqliteTable("xstats_snapshots", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  sessionId: text("session_id").notNull(),
  accountId: text("account_id").notNull(),
  handle: text("handle").notNull(),
  displayName: text("display_name").notNull(),
  followers: integer("followers"),
  following: integer("following"),
  posts: integer("posts"),
  avatarUrl: text("avatar_url"),
  fetchedAt: text("fetched_at").notNull(),
}, (table) => ({ sessionIndex: index("xstats_snapshots_session_idx").on(table.sessionId, table.fetchedAt) }));

/** Canonical one-account/one-JST-day history used by the administrator editor. */
export const xstatsAccountTargets = sqliteTable("xstats_account_targets", {
  sessionId: text("session_id").primaryKey(),
  handlesJson: text("handles_json").notNull().default("[]"),
  revision: integer("revision").notNull().default(0),
  initialized: integer("initialized").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

export const xstatsDailyHistory = sqliteTable("xstats_daily_history", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  date: text("date").notNull(),
  accountId: text("account_id").notNull(),
  handle: text("handle").notNull(),
  displayName: text("display_name").notNull(),
  followers: integer("followers"),
  following: integer("following"),
  posts: integer("posts"),
  fetchedAt: text("fetched_at").notNull(),
  origin: text("origin").notNull().default("migration"),
  updatedAt: text("updated_at").notNull(),
}, (table) => ({
  sessionDateIndex: index("xstats_daily_history_session_date_idx").on(table.sessionId, table.date),
  sessionAccountIndex: index("xstats_daily_history_session_account_idx").on(table.sessionId, table.accountId),
  sessionAccountDateUnique: uniqueIndex("xstats_daily_history_session_account_date_uq").on(table.sessionId, table.accountId, table.date),
}));

/** Monotonic revision for optimistic concurrency in the administrator editor. */
export const xstatsDailyHistoryMeta = sqliteTable("xstats_daily_history_meta", {
  sessionId: text("session_id").primaryKey(),
  revision: integer("revision").notNull().default(0),
  backfilled: integer("backfilled").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

/** Accounts deliberately removed from the administrator's historical editor. */
export const xstatsHistoricalAccountExclusions = sqliteTable("xstats_historical_account_exclusions", {
  sessionId: text("session_id").notNull(),
  accountId: text("account_id").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => ({
  sessionAccountUnique: uniqueIndex("xstats_historical_account_exclusions_session_account_uq").on(table.sessionId, table.accountId),
}));

/** Administrator-supplied avatar assets for accounts without a live profile image. */
export const xstatsAccountAssets = sqliteTable("xstats_account_assets", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  accountId: text("account_id").notNull(),
  avatarKey: text("avatar_key").notNull(),
  avatarUrl: text("avatar_url").notNull(),
  avatarData: text("avatar_data"),
  contentType: text("content_type").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => ({
  sessionAccountIndex: index("xstats_account_assets_session_account_idx").on(table.sessionId, table.accountId),
  sessionAccountUnique: uniqueIndex("xstats_account_assets_session_account_uq").on(table.sessionId, table.accountId),
}));

/** Account-level lifecycle classification and immutable profile metadata. */
export const xstatsAccountStatuses = sqliteTable("xstats_account_statuses", {
  sessionId: text("session_id").notNull(),
  accountId: text("account_id").notNull(),
  status: text("status", { enum: ACCOUNT_STATUSES }).notNull().default("active"),
  joinedAt: text("joined_at"),
  freezeDate: text("freeze_date"),
  updatedAt: text("updated_at").notNull(),
}, (table) => ({
  sessionAccountUnique: uniqueIndex("xstats_account_statuses_session_account_uq").on(table.sessionId, table.accountId),
  statusIndex: index("xstats_account_statuses_session_status_idx").on(table.sessionId, table.status),
}));

/** Source-name to site-account mappings confirmed during a workbook import. */
export const xstatsImportMappings = sqliteTable("xstats_import_mappings", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  sourceName: text("source_name").notNull(),
  sourceKey: text("source_key").notNull(),
  accountId: text("account_id").notNull(),
  handle: text("handle").notNull(),
  displayName: text("display_name").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => ({
  sessionIndex: index("xstats_import_mappings_session_idx").on(table.sessionId, table.updatedAt),
  sourceUnique: uniqueIndex("xstats_import_mappings_session_source_uq").on(table.sessionId, table.sourceKey),
}));

/** Audit rows that must remain visible when an import was not fully automatic. */
export const xstatsImportIssues = sqliteTable("xstats_import_issues", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  importId: text("import_id").notNull(),
  issueType: text("issue_type").notNull(),
  sourceSheet: text("source_sheet").notNull(),
  sourceName: text("source_name").notNull(),
  accountId: text("account_id"),
  handle: text("handle"),
  displayName: text("display_name"),
  date: text("date"),
  metric: text("metric"),
  sourceValue: integer("source_value"),
  siteValue: integer("site_value"),
  details: text("details").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  sessionIndex: index("xstats_import_issues_session_idx").on(table.sessionId, table.createdAt),
}));

/** Encrypted Microsoft OAuth tokens for the browser session that owns OneDrive editing. */
export const xstatsMicrosoftTokens = sqliteTable("xstats_microsoft_tokens", {
  sessionId: text("session_id").primaryKey(),
  microsoftUserId: text("microsoft_user_id").notNull(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: integer("expires_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const schemaSql = {
  accountTargets: `CREATE TABLE IF NOT EXISTS xstats_account_targets (
    session_id TEXT PRIMARY KEY,
    handles_json TEXT NOT NULL DEFAULT '[]',
    revision INTEGER NOT NULL DEFAULT 0,
    initialized INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`,
  sessions: `CREATE TABLE IF NOT EXISTS xstats_sessions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  )`,
  runs: `CREATE TABLE IF NOT EXISTS xstats_runs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    source_summary TEXT NOT NULL,
    success_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES xstats_sessions(id)
  )`,
  snapshots: `CREATE TABLE IF NOT EXISTS xstats_snapshots (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    handle TEXT NOT NULL,
    display_name TEXT NOT NULL,
    followers INTEGER,
    following INTEGER,
    posts INTEGER,
    avatar_url TEXT,
    fetched_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES xstats_runs(id),
    FOREIGN KEY (session_id) REFERENCES xstats_sessions(id)
  )`,
  dailyHistory: `CREATE TABLE IF NOT EXISTS xstats_daily_history (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    date TEXT NOT NULL,
    account_id TEXT NOT NULL,
    handle TEXT NOT NULL,
    display_name TEXT NOT NULL,
    followers INTEGER,
    following INTEGER,
    posts INTEGER,
    fetched_at TEXT NOT NULL,
    origin TEXT NOT NULL DEFAULT 'migration',
    updated_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES xstats_sessions(id)
  )`,
  dailyHistorySessionDateIndex: `CREATE INDEX IF NOT EXISTS xstats_daily_history_session_date_idx ON xstats_daily_history(session_id, date)`,
  dailyHistorySessionAccountIndex: `CREATE INDEX IF NOT EXISTS xstats_daily_history_session_account_idx ON xstats_daily_history(session_id, account_id)`,
  dailyHistoryUnique: `CREATE UNIQUE INDEX IF NOT EXISTS xstats_daily_history_session_account_date_uq ON xstats_daily_history(session_id, account_id, date)`,
  dailyHistoryMeta: `CREATE TABLE IF NOT EXISTS xstats_daily_history_meta (
    session_id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL DEFAULT 0,
    backfilled INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES xstats_sessions(id)
  )`,
  historicalAccountExclusions: `CREATE TABLE IF NOT EXISTS xstats_historical_account_exclusions (
    session_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (session_id, account_id),
    FOREIGN KEY (session_id) REFERENCES xstats_sessions(id)
  )`,
  accountAssets: `CREATE TABLE IF NOT EXISTS xstats_account_assets (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    avatar_key TEXT NOT NULL,
    avatar_url TEXT NOT NULL,
    avatar_data TEXT,
    content_type TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES xstats_sessions(id)
  )`,
  accountAssetsSessionAccountIndex: `CREATE INDEX IF NOT EXISTS xstats_account_assets_session_account_idx ON xstats_account_assets(session_id, account_id)`,
  accountAssetsUnique: `CREATE UNIQUE INDEX IF NOT EXISTS xstats_account_assets_session_account_uq ON xstats_account_assets(session_id, account_id)`,
  accountStatuses: `CREATE TABLE IF NOT EXISTS xstats_account_statuses (
    session_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'suspended', 'non_alt')),
    joined_at TEXT,
    freeze_date TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (session_id, account_id),
    FOREIGN KEY (session_id) REFERENCES xstats_sessions(id)
  )`,
  accountStatusesIndex: `CREATE INDEX IF NOT EXISTS xstats_account_statuses_session_status_idx ON xstats_account_statuses(session_id, status)`,
  runIndex: `CREATE INDEX IF NOT EXISTS xstats_runs_session_idx ON xstats_runs(session_id, fetched_at DESC)`,
  snapshotIndex: `CREATE INDEX IF NOT EXISTS xstats_snapshots_session_idx ON xstats_snapshots(session_id, fetched_at DESC)`,
  importMappings: `CREATE TABLE IF NOT EXISTS xstats_import_mappings (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_key TEXT NOT NULL,
    account_id TEXT NOT NULL,
    handle TEXT NOT NULL,
    display_name TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES xstats_sessions(id)
  )`,
  importMappingsIndex: `CREATE INDEX IF NOT EXISTS xstats_import_mappings_session_idx ON xstats_import_mappings(session_id, updated_at DESC)`,
  importMappingsUnique: `CREATE UNIQUE INDEX IF NOT EXISTS xstats_import_mappings_session_source_uq ON xstats_import_mappings(session_id, source_key)`,
  importIssues: `CREATE TABLE IF NOT EXISTS xstats_import_issues (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    import_id TEXT NOT NULL,
    issue_type TEXT NOT NULL,
    source_sheet TEXT NOT NULL,
    source_name TEXT NOT NULL,
    account_id TEXT,
    handle TEXT,
    display_name TEXT,
    date TEXT,
    metric TEXT,
    source_value INTEGER,
    site_value INTEGER,
    details TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES xstats_sessions(id)
  )`,
  importIssuesIndex: `CREATE INDEX IF NOT EXISTS xstats_import_issues_session_idx ON xstats_import_issues(session_id, created_at DESC)`,
  microsoftTokens: `CREATE TABLE IF NOT EXISTS xstats_microsoft_tokens (
    session_id TEXT PRIMARY KEY,
    microsoft_user_id TEXT NOT NULL,
    email TEXT NOT NULL,
    display_name TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES xstats_sessions(id)
  )`,
};
