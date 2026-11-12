import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { schemaSql } from "./schema";
import * as schema from "./schema";

export function getD1(): D1Database {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return env.DB;
}

/** Compatibility helper for the starter's D1 example routes. */
export function getDb() {
  return drizzle(getD1(), { schema });
}

export async function ensureSchema(database: D1Database = getD1()) {
  const db = database;
  await db.batch([
    db.prepare(schemaSql.accountTargets),
    db.prepare(schemaSql.sessions),
    db.prepare(schemaSql.runs),
    db.prepare(schemaSql.snapshots),
    db.prepare(schemaSql.runIndex),
    db.prepare(schemaSql.snapshotIndex),
    db.prepare(schemaSql.dailyHistory),
    db.prepare(schemaSql.dailyHistorySessionDateIndex),
    db.prepare(schemaSql.dailyHistorySessionAccountIndex),
    db.prepare(schemaSql.dailyHistoryUnique),
    db.prepare(schemaSql.dailyHistoryMeta),
    db.prepare(schemaSql.historicalAccountExclusions),
    db.prepare(schemaSql.accountAssets),
    db.prepare(schemaSql.accountAssetsSessionAccountIndex),
    db.prepare(schemaSql.accountAssetsUnique),
    db.prepare(schemaSql.importMappings),
    db.prepare(schemaSql.importMappingsIndex),
    db.prepare(schemaSql.importMappingsUnique),
    db.prepare(schemaSql.importIssues),
    db.prepare(schemaSql.importIssuesIndex),
    db.prepare(schemaSql.microsoftTokens),
  ]);
  // Existing production databases were created before avatar_url existed.
  // D1 has no portable IF NOT EXISTS form for ADD COLUMN, so treat the
  // already-migrated case as a no-op.
  try {
    await db.prepare("ALTER TABLE xstats_snapshots ADD COLUMN avatar_url TEXT").run();
  } catch {
    // Column already exists.
  }
  try {
    await db.prepare("ALTER TABLE xstats_account_assets ADD COLUMN avatar_data TEXT").run();
  } catch {
    // Column already exists.
  }
  try {
    await db.prepare("ALTER TABLE xstats_account_statuses ADD COLUMN joined_at TEXT").run();
  } catch {
    // Column already exists.
  }
}

export function getSessionFromRequest(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const current = cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith("xstats_session="))
    ?.slice("xstats_session=".length);

  const valid = Boolean(current && /^[0-9a-f-]{36}$/i.test(current));
  return { id: valid ? current! : crypto.randomUUID(), isNew: !valid };
}

export function sessionCookie(id: string) {
  return `xstats_session=${id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure`;
}

/**
 * The public dashboard uses one shared D1 session. Keeping this identifier in
 * one place prevents a public visitor's cookie from creating a private fork of
 * the data that everyone else cannot see.
 */
export const SHARED_SESSION_ID = "xstats-public-shared";

export function getSharedSession() {
  return { id: SHARED_SESSION_ID, isNew: false } as const;
}

/**
 * Purge accounts explicitly recorded in the exclusion table from shared data
 * before an administrator writes a migrated session.
 */
async function purgeExcludedHistoricalAccounts(database: D1Database) {
  const excluded = await database.prepare("SELECT account_id FROM xstats_historical_account_exclusions WHERE session_id = ?").bind(SHARED_SESSION_ID).all<{ account_id: string }>();
  if (!excluded.results.length) return;
  const placeholders = excluded.results.map(() => "?").join(", ");
  const accountIds = excluded.results.map((row) => row.account_id);
  const statements: D1PreparedStatement[] = [];
  for (const table of ["xstats_snapshots", "xstats_daily_history", "xstats_import_mappings", "xstats_import_issues", "xstats_account_assets", "xstats_account_statuses"]) {
    statements.push(database.prepare(`DELETE FROM ${table} WHERE session_id = ? AND account_id IN (${placeholders})`).bind(SHARED_SESSION_ID, ...accountIds));
  }
  for (let index = 0; index < statements.length; index += 80) await database.batch(statements.slice(index, index + 80));
}

/**
 * Move data created while the site was anonymous/private into the public
 * session. The source rows remain untouched, while INSERT OR IGNORE makes the
 * migration safe to run on every request and avoids duplicate history rows.
 */
export async function ensureSharedSession(database: D1Database = getD1()) {
  const now = new Date().toISOString();
  const existing = await database.prepare("SELECT id FROM xstats_sessions WHERE id = ? LIMIT 1").bind(SHARED_SESSION_ID).first<{ id: string }>();
  await database.prepare("INSERT INTO xstats_sessions (id, created_at, last_seen_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at").bind(SHARED_SESSION_ID, now, now).run();
  // The one-time copy is deliberately keyed by the shared session itself.
  if (existing) {
    await purgeExcludedHistoricalAccounts(database);
    return getSharedSession();
  }


  const statements: D1PreparedStatement[] = [
    database.prepare("INSERT OR IGNORE INTO xstats_runs (id, session_id, fetched_at, source_summary, success_count, error_count) SELECT id, ?, fetched_at, source_summary, success_count, error_count FROM xstats_runs WHERE session_id <> ?").bind(SHARED_SESSION_ID, SHARED_SESSION_ID),
    database.prepare("INSERT OR IGNORE INTO xstats_snapshots (id, run_id, session_id, account_id, handle, display_name, followers, following, posts, avatar_url, fetched_at) SELECT id, run_id, ?, account_id, handle, display_name, followers, following, posts, avatar_url, fetched_at FROM xstats_snapshots WHERE session_id <> ?").bind(SHARED_SESSION_ID, SHARED_SESSION_ID),
    database.prepare("INSERT OR IGNORE INTO xstats_daily_history (id, session_id, date, account_id, handle, display_name, followers, following, posts, fetched_at, origin, updated_at) SELECT id, ?, date, account_id, handle, display_name, followers, following, posts, fetched_at, origin, updated_at FROM xstats_daily_history WHERE session_id <> ?").bind(SHARED_SESSION_ID, SHARED_SESSION_ID),
    database.prepare("INSERT OR IGNORE INTO xstats_daily_history_meta (session_id, revision, backfilled, updated_at) SELECT ?, revision, backfilled, updated_at FROM xstats_daily_history_meta WHERE session_id <> ?").bind(SHARED_SESSION_ID, SHARED_SESSION_ID),
    database.prepare("INSERT OR IGNORE INTO xstats_historical_account_exclusions (session_id, account_id, updated_at) SELECT ?, account_id, updated_at FROM xstats_historical_account_exclusions WHERE session_id <> ?").bind(SHARED_SESSION_ID, SHARED_SESSION_ID),
    database.prepare("INSERT OR IGNORE INTO xstats_account_assets (id, session_id, account_id, avatar_key, avatar_url, avatar_data, content_type, updated_at) SELECT id, ?, account_id, avatar_key, avatar_url, avatar_data, content_type, updated_at FROM xstats_account_assets WHERE session_id <> ?").bind(SHARED_SESSION_ID, SHARED_SESSION_ID),
    database.prepare("INSERT OR IGNORE INTO xstats_account_statuses (session_id, account_id, status, joined_at, updated_at) SELECT ?, account_id, status, joined_at, updated_at FROM xstats_account_statuses WHERE session_id <> ?").bind(SHARED_SESSION_ID, SHARED_SESSION_ID),
    database.prepare("INSERT OR IGNORE INTO xstats_import_mappings (id, session_id, source_name, source_key, account_id, handle, display_name, updated_at) SELECT id, ?, source_name, source_key, account_id, handle, display_name, updated_at FROM xstats_import_mappings WHERE session_id <> ?").bind(SHARED_SESSION_ID, SHARED_SESSION_ID),
    database.prepare("INSERT OR IGNORE INTO xstats_import_issues (id, session_id, import_id, issue_type, source_sheet, source_name, account_id, handle, display_name, date, metric, source_value, site_value, details, created_at) SELECT id, ?, import_id, issue_type, source_sheet, source_name, account_id, handle, display_name, date, metric, source_value, site_value, details, created_at FROM xstats_import_issues WHERE session_id <> ?").bind(SHARED_SESSION_ID, SHARED_SESSION_ID),
  ];
  await database.batch(statements);
  await purgeExcludedHistoricalAccounts(database);
  return getSharedSession();
}
