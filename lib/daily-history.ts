import { DAILY_HISTORY_SHEET_METRICS } from "./workbook-sheet-names.ts";
import { loadAccountFreezeDateMap, type AccountStatus } from "./account-status.ts";

export type DailyHistoryMetric = "followers" | "following" | "posts";

export type DailyHistoryRow = {
  id: string;
  session_id: string;
  date: string;
  account_id: string;
  handle: string;
  display_name: string;
  followers: number | null;
  following: number | null;
  posts: number | null;
  fetched_at: string;
  origin: string;
  updated_at: string;
};

export type EffectiveHistoryRow = {
  id: string;
  run_id: string;
  fetched_at: string;
  account_id: string;
  handle: string;
  display_name: string;
  followers: number | null;
  following: number | null;
  posts: number | null;
  avatar_url: string | null;
  account_status: AccountStatus;
  joined: string | null;
  freeze_date: string | null;
};

export type DailyHistoryUpsertRow = {
  date: string;
  accountId: string;
  handle: string;
  displayName: string;
  followers?: number | null;
  following?: number | null;
  posts?: number | null;
};

export const DAILY_HISTORY_CUTOFF = "2026-07-22";
export const DAILY_HISTORY_METRICS = DAILY_HISTORY_SHEET_METRICS.map(([, metric]) => metric) as DailyHistoryMetric[];

const JST_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Tokyo",
});

function dateParts(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  const parts = Object.fromEntries(JST_DATE_FORMATTER.formatToParts(parsed).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function jstCalendarDate(value: string) {
  return dateParts(value);
}

/** Map a JST acquisition timestamp to the daily record that closes next. */
export function dailyRecordDate(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  const local = new Date(parsed.getTime() + 9 * 60 * 60 * 1000);
  const hour = local.getUTCHours();
  const minute = local.getUTCMinutes();
  const date = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  if (hour !== 0 || minute !== 0) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function canonicalDailyFetchedAt(date: string) {
  return new Date(`${date}T00:00:00.001+09:00`).toISOString();
}

export function stableDailyHistoryId(accountId: string, date: string) {
  return `daily-history:${encodeURIComponent(accountId)}:${date}`;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function addCalendarDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

type SnapshotForBackfill = {
  id: string;
  fetched_at: string;
  account_id: string;
  handle: string;
  display_name: string;
  followers: number | null;
  following: number | null;
  posts: number | null;
};

type DailyHistoryBackfillAggregate = {
  date: string;
  accountId: string;
  handle: string;
  displayName: string;
  fetchedAt: string;
  latestFetchedAt: number;
  followers: number | null;
  following: number | null;
  posts: number | null;
  followerAt: number;
  followingAt: number;
  postsAt: number;
};

async function migrateLegacyDailyBuckets(database: D1Database, sessionId: string, updatedAt: string) {
  const [legacy, freezeDateByAccount] = await Promise.all([
    database.prepare(`SELECT id, session_id, date, account_id, handle, display_name, followers, following, posts
      FROM xstats_daily_history WHERE session_id = ? AND origin = 'migration' ORDER BY date ASC`).bind(sessionId).all<DailyHistoryRow>(),
    loadAccountFreezeDateMap(database, sessionId),
  ]);
  const statements: D1PreparedStatement[] = [];
  for (const row of legacy.results) {
    const date = addCalendarDays(row.date, 1);
    const freezeDate = freezeDateByAccount.get(row.account_id);
    // Keep the existing legacy row intact when its migration would carry it
    // beyond the account's freeze date.
    if (freezeDate && date > freezeDate) continue;
    statements.push(database.prepare(`INSERT INTO xstats_daily_history
      (id, session_id, date, account_id, handle, display_name, followers, following, posts, fetched_at, origin, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'migration', ?)
      ON CONFLICT(session_id, account_id, date) DO UPDATE SET
        handle = excluded.handle,
        display_name = excluded.display_name,
        followers = COALESCE(xstats_daily_history.followers, excluded.followers),
        following = COALESCE(xstats_daily_history.following, excluded.following),
        posts = COALESCE(xstats_daily_history.posts, excluded.posts),
        updated_at = excluded.updated_at`).bind(stableDailyHistoryId(row.account_id, date), sessionId, date, row.account_id, row.handle, row.display_name, row.followers, row.following, row.posts, canonicalDailyFetchedAt(date), updatedAt));
    // The legacy date-shift is retained for databases interrupted during the
    // previous migration. Delete the source only after the merged target write
    // in the same D1 batch, so conflicting rows cannot silently lose values.
    statements.push(database.prepare("DELETE FROM xstats_daily_history WHERE session_id = ? AND id = ?").bind(sessionId, row.id));
  }
  for (const statementChunk of chunk(statements, 80)) if (statementChunk.length) await database.batch(statementChunk);
}

export async function ensureDailyHistory(database: D1Database, sessionId: string) {
  const now = new Date().toISOString();
  await database.prepare("INSERT INTO xstats_daily_history_meta (session_id, revision, backfilled, updated_at) VALUES (?, 0, 0, ?) ON CONFLICT(session_id) DO NOTHING").bind(sessionId, now).run();
  let meta = await database.prepare("SELECT revision, backfilled FROM xstats_daily_history_meta WHERE session_id = ?").bind(sessionId).first<{ revision: number; backfilled: number }>();
  if (meta?.backfilled === 1) {
    await migrateLegacyDailyBuckets(database, sessionId, now);
    await database.prepare("UPDATE xstats_daily_history_meta SET backfilled = 2, updated_at = ? WHERE session_id = ?").bind(now, sessionId).run();
    meta = { ...meta, backfilled: 2 };
  }
  if ((meta?.backfilled ?? 0) >= 3) return meta;

  // The old system only copied snapshots through a fixed cutoff. Backfill the
  // entire retained archive, filling missing daily values without replacing
  // manual rows or deleting any legacy snapshot.
  const grouped = new Map<string, DailyHistoryBackfillAggregate>();
  const pageSize = 500;
  let offset = 0;
  while (true) {
    const source = await database.prepare(`SELECT id, fetched_at, account_id, handle, display_name, followers, following, posts
      FROM xstats_snapshots WHERE session_id = ? ORDER BY fetched_at ASC, id ASC LIMIT ? OFFSET ?`).bind(sessionId, pageSize, offset).all<SnapshotForBackfill>();
    if (!source.results.length) break;
    for (const row of source.results) {
      const date = dailyRecordDate(row.fetched_at);
      const fetchedAt = new Date(row.fetched_at).getTime();
      if (!date || !Number.isFinite(fetchedAt)) continue;
      const key = `${row.account_id}|${date}`;
      const current = grouped.get(key) ?? {
        date,
        accountId: row.account_id,
        handle: row.handle,
        displayName: row.display_name,
        fetchedAt: canonicalDailyFetchedAt(date),
        latestFetchedAt: -Infinity,
        followers: null,
        following: null,
        posts: null,
        followerAt: -Infinity,
        followingAt: -Infinity,
        postsAt: -Infinity,
      };
      if (row.followers !== null && fetchedAt >= current.followerAt) {
        current.followers = row.followers;
        current.followerAt = fetchedAt;
      }
      if (row.following !== null && fetchedAt >= current.followingAt) {
        current.following = row.following;
        current.followingAt = fetchedAt;
      }
      if (row.posts !== null && fetchedAt >= current.postsAt) {
        current.posts = row.posts;
        current.postsAt = fetchedAt;
      }
      if (fetchedAt >= current.latestFetchedAt) {
        current.handle = row.handle;
        current.displayName = row.display_name;
        current.latestFetchedAt = fetchedAt;
      }
      grouped.set(key, current);
    }
    offset += source.results.length;
    if (source.results.length < pageSize) break;
  }

  const statements = [...grouped.values()]
    .filter((row) => row.followers !== null || row.following !== null || row.posts !== null)
    .map((row) => database.prepare(`INSERT INTO xstats_daily_history
      (id, session_id, date, account_id, handle, display_name, followers, following, posts, fetched_at, origin, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'snapshot-backfill', ?)
      ON CONFLICT(session_id, account_id, date) DO UPDATE SET
        handle = excluded.handle,
        display_name = excluded.display_name,
        followers = CASE WHEN xstats_daily_history.origin = 'manual' THEN xstats_daily_history.followers
          WHEN xstats_daily_history.origin IN ('carry-forward', 'opening-date', 'migration') THEN COALESCE(excluded.followers, xstats_daily_history.followers)
          ELSE COALESCE(xstats_daily_history.followers, excluded.followers) END,
        following = CASE WHEN xstats_daily_history.origin = 'manual' THEN xstats_daily_history.following
          WHEN xstats_daily_history.origin IN ('carry-forward', 'opening-date', 'migration') THEN COALESCE(excluded.following, xstats_daily_history.following)
          ELSE COALESCE(xstats_daily_history.following, excluded.following) END,
        posts = CASE WHEN xstats_daily_history.origin = 'manual' THEN xstats_daily_history.posts
          WHEN xstats_daily_history.origin IN ('carry-forward', 'opening-date', 'migration') THEN COALESCE(excluded.posts, xstats_daily_history.posts)
          ELSE COALESCE(xstats_daily_history.posts, excluded.posts) END,
        fetched_at = excluded.fetched_at,
        updated_at = excluded.updated_at,
        origin = CASE WHEN xstats_daily_history.origin IN ('manual', 'imported') THEN xstats_daily_history.origin
          WHEN xstats_daily_history.origin IN ('carry-forward', 'opening-date', 'migration') THEN 'snapshot-backfill'
          ELSE xstats_daily_history.origin END`)
      .bind(stableDailyHistoryId(row.accountId, row.date), sessionId, row.date, row.accountId, row.handle, row.displayName, row.followers, row.following, row.posts, row.fetchedAt, now));
  for (const statementChunk of chunk(statements, 80)) if (statementChunk.length) await database.batch(statementChunk);
  await database.prepare("UPDATE xstats_daily_history_meta SET backfilled = 3, revision = revision + ?, updated_at = ? WHERE session_id = ?").bind(statements.length ? 1 : 0, now, sessionId).run();
  return { revision: (meta?.revision ?? 0) + (statements.length ? 1 : 0), backfilled: 3 };
}

type LatestPostRecord = {
  date: string;
  accountId: string;
  handle: string;
  displayName: string;
  posts: number;
  fetchedAt: string;
};

type ExistingPostRecord = {
  account_id: string;
  date: string;
  posts: number | null;
  origin: string;
};

/**
 * Keep the post-count daily series continuous through the current JST date.
 * A missing acquisition is represented by the last known post count, while
 * existing non-null values (including administrator edits) remain untouched.
 */
export async function ensureDailyPostsThroughToday(database: D1Database, sessionId: string, today = dateParts(new Date().toISOString())) {
  if (!today) return;
  const [daily, openingDates, existing, freezeDateByAccount, suspendedAccounts] = await Promise.all([
    database.prepare("SELECT date, account_id, handle, display_name, posts, fetched_at, origin FROM xstats_daily_history WHERE session_id = ? AND posts IS NOT NULL AND date <= ?").bind(sessionId, today).all<{ date: string; account_id: string; handle: string; display_name: string; posts: number; fetched_at: string; origin: string }>(),
    database.prepare("SELECT account_id, joined_at FROM xstats_account_statuses WHERE session_id = ? AND joined_at IS NOT NULL").bind(sessionId).all<{ account_id: string; joined_at: string }>(),
    database.prepare("SELECT account_id, date, posts, origin FROM xstats_daily_history WHERE session_id = ? AND date <= ?").bind(sessionId, today).all<ExistingPostRecord>(),
    loadAccountFreezeDateMap(database, sessionId),
    database.prepare("SELECT account_id FROM xstats_account_statuses WHERE session_id = ? AND status = 'suspended'").bind(sessionId).all<{account_id:string}>(),
  ]);
  const suspendedIds = new Set(suspendedAccounts.results.map(row => row.account_id));
  const latestByAccount = new Map<string, LatestPostRecord>();
  const recordedPostsByAccount = new Map<string, LatestPostRecord[]>();
  const consider = (candidate: LatestPostRecord) => {
    const freezeDate = freezeDateByAccount.get(candidate.accountId);
    if (candidate.date > today || (freezeDate && candidate.date > freezeDate)) return;
    const current = latestByAccount.get(candidate.accountId);
    if (!current || candidate.date > current.date || (candidate.date === current.date && candidate.fetchedAt >= current.fetchedAt)) latestByAccount.set(candidate.accountId, candidate);
    const records = recordedPostsByAccount.get(candidate.accountId) ?? [];
    records.push(candidate);
    recordedPostsByAccount.set(candidate.accountId, records);
  };
  // Opening-date and carry-forward rows are derived values, not measurements.
  // In particular, the opening-date zero must not create a zero series before
  // the account's first real measurement.
  for (const row of daily.results) {
    if (row.origin === "opening-date" || row.origin === "carry-forward") continue;
    consider({ date: row.date, accountId: row.account_id, handle: row.handle, displayName: row.display_name, posts: row.posts, fetchedAt: row.fetched_at });
  }
  const openingDateByAccount = new Map(openingDates.results.map((row) => [row.account_id, jstCalendarDate(row.joined_at)] as const));
  const staleCarryForwardKeys = new Set<string>();
  for (const row of existing.results) {
    if (row.origin !== "carry-forward" || suspendedIds.has(row.account_id) || freezeDateByAccount.get(row.account_id)) continue;
    const openingDate = openingDateByAccount.get(row.account_id);
    if (!openingDate || row.date <= openingDate) continue;
    const expected = (recordedPostsByAccount.get(row.account_id) ?? [])
      .filter((candidate) => candidate.date <= row.date)
      .sort((left, right) => left.date.localeCompare(right.date) || left.fetchedAt.localeCompare(right.fetchedAt))
      .at(-1);
    if (!expected || row.posts !== expected.posts) staleCarryForwardKeys.add(`${row.account_id}|${row.date}`);
  }
  const cleanupStatements = [...staleCarryForwardKeys].map((value) => {
    const separator = value.lastIndexOf("|");
    const accountId = value.slice(0, separator);
    const date = value.slice(separator + 1);
    return database.prepare("DELETE FROM xstats_daily_history WHERE session_id = ? AND account_id = ? AND date = ? AND origin = 'carry-forward'").bind(sessionId, accountId, date);
  });
  const existingByKey = new Map(existing.results.filter((row) => !staleCarryForwardKeys.has(row.account_id + "|" + row.date) && row.posts !== null).map((row) => [row.account_id + "|" + row.date, row.posts] as const));
  const statements: D1PreparedStatement[] = [];
  const now = new Date().toISOString();
  for (const source of latestByAccount.values()) {
    if (suspendedIds.has(source.accountId)) continue;
    const freezeDate = freezeDateByAccount.get(source.accountId);
    const lastCarryForwardDate = freezeDate && freezeDate < today ? freezeDate : today;
    for (let date = addCalendarDays(source.date, 1); date <= lastCarryForwardDate; date = addCalendarDays(date, 1)) {
      const key = source.accountId + "|" + date;
      if (existingByKey.has(key) && existingByKey.get(key) !== null) continue;
      statements.push(database.prepare("INSERT INTO xstats_daily_history (id, session_id, date, account_id, handle, display_name, followers, following, posts, fetched_at, origin, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, 'carry-forward', ?) ON CONFLICT(session_id, account_id, date) DO UPDATE SET posts = COALESCE(xstats_daily_history.posts, excluded.posts), handle = excluded.handle, display_name = excluded.display_name, updated_at = excluded.updated_at").bind(stableDailyHistoryId(source.accountId, date), sessionId, date, source.accountId, source.handle, source.displayName, source.posts, canonicalDailyFetchedAt(date), now));
      existingByKey.set(key, source.posts);
    }
  }
  const allStatements = [...cleanupStatements, ...statements];
  if (!allStatements.length) return;
  for (const statementChunk of chunk(allStatements, 80)) if (statementChunk.length) await database.batch(statementChunk);
  await database.prepare("UPDATE xstats_daily_history_meta SET revision = revision + 1, updated_at = ? WHERE session_id = ?").bind(now, sessionId).run();
}

type OpeningDateAccount = {
  account_id: string;
  joined_at: string;
  freeze_date?: string | null;
};

type OpeningDateIdentity = {
  account_id: string;
  handle: string;
  display_name: string;
};

type OpeningDateDaily = OpeningDateIdentity & {
  date: string;
  followers: number | null;
  following: number | null;
  posts: number | null;
};

/** Create a zero opening-day record only when the account has no recorded values for that day. */
export async function ensureOpeningDateHistory(database: D1Database, sessionId: string, today = dateParts(new Date().toISOString())) {
  if (!today) return 0;
  const [openingDates, identities, dailyRows] = await Promise.all([
    database.prepare("SELECT account_id, joined_at, freeze_date FROM xstats_account_statuses WHERE session_id = ? AND joined_at IS NOT NULL").bind(sessionId).all<OpeningDateAccount>(),
    database.prepare("SELECT account_id, handle, display_name FROM xstats_daily_history WHERE session_id = ? GROUP BY account_id").bind(sessionId).all<OpeningDateIdentity>(),
    database.prepare("SELECT account_id, date, handle, display_name, followers, following, posts FROM xstats_daily_history WHERE session_id = ?").bind(sessionId).all<OpeningDateDaily>(),
  ]);

  const identityByAccount = new Map(identities.results.map((row) => [row.account_id, row] as const));
  const dailyByKey = new Map(dailyRows.results.map((row) => [`${row.account_id}|${row.date}`, row] as const));
  const statements: D1PreparedStatement[] = [];
  let changed = 0;
  for (const account of openingDates.results) {
    const openingDate = jstCalendarDate(account.joined_at);
    if (!openingDate || openingDate > today) continue;
    if (account.freeze_date && openingDate > account.freeze_date) continue;
    const key = `${account.account_id}|${openingDate}`;
    const existing = dailyByKey.get(key);
    const raw = existing;
    const identity = existing ?? identityByAccount.get(account.account_id);
    if (!identity) continue;
    if (existing) {
      const nextFollowers = existing.followers ?? raw?.followers ?? 0;
      const nextFollowing = existing.following ?? raw?.following ?? 0;
      const nextPosts = existing.posts ?? raw?.posts ?? 0;
      if (existing.followers === nextFollowers && existing.following === nextFollowing && existing.posts === nextPosts) continue;
      statements.push(database.prepare(`UPDATE xstats_daily_history SET followers = ?, following = ?, posts = ?, updated_at = ?
        WHERE session_id = ? AND account_id = ? AND date = ?`).bind(nextFollowers, nextFollowing, nextPosts, new Date().toISOString(), sessionId, account.account_id, openingDate));
      changed += 1;
      continue;
    }

    const now = new Date().toISOString();
    statements.push(database.prepare(`INSERT OR IGNORE INTO xstats_daily_history
      (id, session_id, date, account_id, handle, display_name, followers, following, posts, fetched_at, origin, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'opening-date', ?)`).bind(stableDailyHistoryId(account.account_id, openingDate), sessionId, openingDate, account.account_id, identity.handle, identity.display_name, raw?.followers ?? 0, raw?.following ?? 0, raw?.posts ?? 0, canonicalDailyFetchedAt(openingDate), now));
    changed += 1;
  }
  for (const statementChunk of chunk(statements, 80)) if (statementChunk.length) await database.batch(statementChunk);
  if (changed) await database.prepare("UPDATE xstats_daily_history_meta SET revision = revision + 1, updated_at = ? WHERE session_id = ?").bind(new Date().toISOString(), sessionId).run();
  return changed;
}

export async function loadDailyHistory(database: D1Database, sessionId: string) {
  const result = await database.prepare(`SELECT id, session_id, date, account_id, handle, display_name, followers, following, posts, fetched_at, origin, updated_at
    FROM xstats_daily_history WHERE session_id = ? ORDER BY date ASC, handle ASC, account_id ASC`).bind(sessionId).all<DailyHistoryRow>();
  return result.results;
}

export async function loadDailyHistoryMeta(database: D1Database, sessionId: string) {
  const result = await database.prepare("SELECT revision, backfilled, updated_at FROM xstats_daily_history_meta WHERE session_id = ?").bind(sessionId).first<{ revision: number; backfilled: number; updated_at: string }>();
  return result ?? { revision: 0, backfilled: 0, updated_at: "" };
}

export async function bumpDailyHistoryRevision(database: D1Database, sessionId: string, expectedRevision: number, updatedAt: string) {
  const result = await database.prepare("UPDATE xstats_daily_history_meta SET revision = revision + 1, updated_at = ? WHERE session_id = ? AND revision = ?").bind(updatedAt, sessionId, expectedRevision).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

async function upsertDailyHistoryRows(database: D1Database, sessionId: string, rows: DailyHistoryUpsertRow[], origin: "acquired" | "imported", updatedAt: string) {
  const grouped = new Map<string, DailyHistoryUpsertRow>();
  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !row.accountId || !row.handle || !row.displayName) continue;
    const key = `${row.accountId}|${row.date}`;
    const current = grouped.get(key) ?? { ...row };
    current.handle = row.handle;
    current.displayName = row.displayName;
    if (row.followers !== undefined && row.followers !== null) current.followers = row.followers;
    if (row.following !== undefined && row.following !== null) current.following = row.following;
    if (row.posts !== undefined && row.posts !== null) current.posts = row.posts;
    grouped.set(key, current);
  }
  const groupedRows = [...grouped.values()];
  if (!groupedRows.length) return;
  const accountIds = [...new Set(groupedRows.map((row) => row.accountId))];
  const dates = [...new Set(groupedRows.map((row) => row.date))];
  const existingRows: DailyHistoryRow[] = [];
  // Collection touches one or two dates across at most 500 accounts. Query
  // only the affected account/date blocks instead of loading the full history
  // table on every run. Keep each statement below SQLite's bind-variable cap.
  if (dates.length <= 3) {
    const datePlaceholders = dates.map(() => "?").join(", ");
    const existing = await database.prepare(`SELECT id, session_id, date, account_id, handle, display_name, followers, following, posts, fetched_at, origin, updated_at
      FROM xstats_daily_history WHERE session_id = ? AND date IN (${datePlaceholders})`)
      .bind(sessionId, ...dates).all<DailyHistoryRow>();
    existingRows.push(...existing.results);
  } else {
    for (let accountIndex = 0; accountIndex < accountIds.length; accountIndex += 40) {
      const accountChunk = accountIds.slice(accountIndex, accountIndex + 40);
      for (let dateIndex = 0; dateIndex < dates.length; dateIndex += 30) {
        const accountPlaceholders = accountChunk.map(() => "?").join(", ");
        const dateChunk = dates.slice(dateIndex, dateIndex + 30);
        const datePlaceholders = dateChunk.map(() => "?").join(", ");
        const existing = await database.prepare(`SELECT id, session_id, date, account_id, handle, display_name, followers, following, posts, fetched_at, origin, updated_at
          FROM xstats_daily_history WHERE session_id = ? AND account_id IN (${accountPlaceholders}) AND date IN (${datePlaceholders})`)
          .bind(sessionId, ...accountChunk, ...dateChunk).all<DailyHistoryRow>();
        existingRows.push(...existing.results);
      }
    }
  }
  const existingByKey = new Map(existingRows.map((row) => [`${row.account_id}|${row.date}`, row]));
  const changedRows: DailyHistoryUpsertRow[] = [];
  for (const row of groupedRows) {
    const previous = existingByKey.get(`${row.accountId}|${row.date}`);
    const nextOrigin = previous?.origin === "manual" ? "manual" : origin;
    const nextFollowers = previous?.origin === "manual" ? previous.followers : row.followers ?? previous?.followers ?? null;
    const nextFollowing = previous?.origin === "manual" ? previous.following : row.following ?? previous?.following ?? null;
    const nextPosts = previous?.origin === "manual" ? previous.posts : row.posts ?? previous?.posts ?? null;
    if (!previous || previous.handle !== row.handle || previous.display_name !== row.displayName || previous.followers !== nextFollowers || previous.following !== nextFollowing || previous.posts !== nextPosts || previous.fetched_at !== canonicalDailyFetchedAt(row.date) || previous.origin !== nextOrigin) changedRows.push(row);
  }
  if (!changedRows.length) return;
  const statements = changedRows.map((row) => database.prepare(`INSERT INTO xstats_daily_history
    (id, session_id, date, account_id, handle, display_name, followers, following, posts, fetched_at, origin, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, account_id, date) DO UPDATE SET
      handle = excluded.handle,
      display_name = excluded.display_name,
      followers = CASE WHEN xstats_daily_history.origin = 'manual' THEN xstats_daily_history.followers ELSE COALESCE(excluded.followers, xstats_daily_history.followers) END,
      following = CASE WHEN xstats_daily_history.origin = 'manual' THEN xstats_daily_history.following ELSE COALESCE(excluded.following, xstats_daily_history.following) END,
      posts = CASE WHEN xstats_daily_history.origin = 'manual' THEN xstats_daily_history.posts ELSE COALESCE(excluded.posts, xstats_daily_history.posts) END,
      fetched_at = excluded.fetched_at,
      updated_at = excluded.updated_at,
      origin = CASE WHEN xstats_daily_history.origin = 'manual' THEN xstats_daily_history.origin ELSE excluded.origin END`)
    .bind(stableDailyHistoryId(row.accountId, row.date), sessionId, row.date, row.accountId, row.handle, row.displayName, row.followers ?? null, row.following ?? null, row.posts ?? null, canonicalDailyFetchedAt(row.date), origin, updatedAt));
  for (const statementChunk of chunk(statements, 80)) if (statementChunk.length) await database.batch(statementChunk);
  await database.prepare("UPDATE xstats_daily_history_meta SET revision = revision + 1, updated_at = ? WHERE session_id = ?").bind(updatedAt, sessionId).run();
}

export async function upsertImportedDailyHistory(database: D1Database, sessionId: string, rows: DailyHistoryUpsertRow[], updatedAt = new Date().toISOString()) {
  return upsertDailyHistoryRows(database, sessionId, rows, "imported", updatedAt);
}

export type AcquiredDailyHistoryInput = Omit<DailyHistoryUpsertRow, "date"> & { fetchedAt: string };

/** Save only valid metrics from a successful profile response into its daily bucket. */
export async function upsertAcquiredDailyHistory(database: D1Database, sessionId: string, rows: AcquiredDailyHistoryInput[], updatedAt = new Date().toISOString()) {
  const grouped = new Map<string, DailyHistoryUpsertRow & { metricAt: Record<DailyHistoryMetric, number>; latestIdentityAt: number }>();
  for (const row of rows) {
    const date = dailyRecordDate(row.fetchedAt);
    if (!date || !row.accountId || !row.handle || !row.displayName) continue;
    const key = `${row.accountId}|${date}`;
    const fetchedAt = new Date(row.fetchedAt).getTime();
    const current = grouped.get(key) ?? {
      date,
      accountId: row.accountId,
      handle: row.handle,
      displayName: row.displayName,
      followers: null,
      following: null,
      posts: null,
      metricAt: { followers: -Infinity, following: -Infinity, posts: -Infinity },
      latestIdentityAt: -Infinity,
    };
    for (const metric of DAILY_HISTORY_METRICS) {
      const value = row[metric];
      if (value !== null && value !== undefined && Number.isFinite(fetchedAt) && fetchedAt >= current.metricAt[metric]) {
        current[metric] = value;
        current.metricAt[metric] = fetchedAt;
      }
    }
    if (Number.isFinite(fetchedAt) && fetchedAt >= current.latestIdentityAt) {
      current.handle = row.handle;
      current.displayName = row.displayName;
      current.latestIdentityAt = fetchedAt;
    }
    if (current.followers !== null || current.following !== null || current.posts !== null) grouped.set(key, current);
  }
  return upsertDailyHistoryRows(database, sessionId, [...grouped.values()], "acquired", updatedAt);
}

type RawSnapshot = {
  id: string;
  run_id: string;
  fetched_at: string;
  account_id: string;
  handle: string;
  display_name: string;
  followers: number | null;
  following: number | null;
  posts: number | null;
  avatar_url: string | null;
  account_status: AccountStatus;
  joined: string | null;
  freeze_date: string | null;
};

export async function loadEffectiveHistory(database: D1Database, sessionId: string) {
  // Some databases created before migration 0014 already gained this column
  // through ensureSchema, while fresh databases add it on their first write.
  // Inspect the schema so this read-only API can work safely in both states.
  const snapshotColumns = await database.prepare('PRAGMA table_info("xstats_snapshots")').all<{ name: string }>();
  const hasSnapshotAvatarUrl = snapshotColumns.results.some((column) => column.name === "avatar_url");
  const snapshotAvatarUrl = hasSnapshotAvatarUrl ? "snapshots.avatar_url" : "NULL";
  const statusColumns = await database.prepare('PRAGMA table_info("xstats_account_statuses")').all<{ name: string }>();
  const freezeDateColumn = statusColumns.results.some((column) => column.name === "freeze_date") ? "statuses.freeze_date" : "NULL";

  const meta = await database.prepare("SELECT backfilled FROM xstats_daily_history_meta WHERE session_id = ?").bind(sessionId).first<{ backfilled: number }>();
  const [raw, daily] = await Promise.all([
    (meta?.backfilled ?? 0) >= 3 ? Promise.resolve({ results: [] as RawSnapshot[] }) : database.prepare(`SELECT snapshots.id, snapshots.run_id, snapshots.fetched_at, snapshots.account_id, snapshots.handle, snapshots.display_name,
      snapshots.followers, snapshots.following, snapshots.posts, COALESCE(assets.avatar_url, ${snapshotAvatarUrl}) AS avatar_url,
      COALESCE(statuses.status, 'active') AS account_status, statuses.joined_at AS joined, ${freezeDateColumn} AS freeze_date
      FROM xstats_snapshots AS snapshots LEFT JOIN xstats_account_assets AS assets
      ON assets.session_id = snapshots.session_id AND assets.account_id = snapshots.account_id
      LEFT JOIN xstats_account_statuses AS statuses
      ON statuses.session_id = snapshots.session_id AND statuses.account_id = snapshots.account_id
      WHERE snapshots.session_id = ? ORDER BY snapshots.fetched_at ASC, snapshots.handle ASC`).bind(sessionId).all<RawSnapshot>(),
    database.prepare(`SELECT daily.id, daily.date, daily.account_id, daily.handle, daily.display_name, daily.followers, daily.following, daily.posts,
      daily.fetched_at, assets.avatar_url AS avatar_url, COALESCE(statuses.status, 'active') AS account_status, statuses.joined_at AS joined, ${freezeDateColumn} AS freeze_date
      FROM xstats_daily_history AS daily LEFT JOIN xstats_account_assets AS assets
      ON assets.session_id = daily.session_id AND assets.account_id = daily.account_id
      LEFT JOIN xstats_account_statuses AS statuses
      ON statuses.session_id = daily.session_id AND statuses.account_id = daily.account_id
      WHERE daily.session_id = ? ORDER BY daily.date ASC, daily.handle ASC`).bind(sessionId).all<Pick<DailyHistoryRow, "id" | "date" | "account_id" | "handle" | "display_name" | "followers" | "following" | "posts" | "fetched_at"> & { avatar_url: string | null; account_status: AccountStatus; joined: string | null; freeze_date: string | null }>(),
  ]);
  const rawAfterCutoff = raw.results.filter((row) => (dailyRecordDate(row.fetched_at) ?? "") > DAILY_HISTORY_CUTOFF);
  const rawAfterCutoffKeys = new Set(rawAfterCutoff.map((row) => `${row.account_id}|${dailyRecordDate(row.fetched_at)}`));
  const dailyRows: EffectiveHistoryRow[] = daily.results
    .filter((row) => row.date <= DAILY_HISTORY_CUTOFF || !rawAfterCutoffKeys.has(`${row.account_id}|${row.date}`))
    .map((row) => ({
      id: row.id,
      run_id: `daily-history:${row.date}`,
      fetched_at: row.fetched_at,
      account_id: row.account_id,
      handle: row.handle,
      display_name: row.display_name,
      followers: row.followers,
      following: row.following,
      posts: row.posts,
      avatar_url: row.avatar_url ?? null,
      account_status: row.account_status,
      joined: row.joined ?? null,
      freeze_date: row.freeze_date ?? null,
    }));
  return [...rawAfterCutoff, ...dailyRows].sort((left, right) => new Date(left.fetched_at).getTime() - new Date(right.fetched_at).getTime() || left.handle.localeCompare(right.handle, "ja"));
}
export function metricLabel(metric: DailyHistoryMetric) {
  return metric === "followers" ? "フォロワー数" : metric === "following" ? "フォロー数" : "投稿数";
}
