import { MAX_ACCOUNTS, fetchProfiles } from "./x-stats";
import { pruneSessionHistory } from "../app/api/_shared";
import { ensureAccountJoinedDates, ensureAccountStatuses, loadAccountStatusMap, loadAccountFreezeDateMap } from "./account-status";
import { shouldUnfreezeAfterCollection } from "./freeze-date.ts";
import { jstCalendarDate, ensureDailyPostsThroughToday, ensureOpeningDateHistory } from "./daily-history";

export type CollectionResult = Awaited<ReturnType<typeof collectForSession>>;

function sessionStatement(db: D1Database, sessionId: string, now: string) {
  return db.prepare("INSERT INTO xstats_sessions (id, created_at, last_seen_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at").bind(sessionId, now, now);
}

/** Save one administrator-triggered collection without changing the account list. */
export async function collectForSession({ db, sessionId, handles, sourceSummary, extraErrorCount = 0, fetchedAt = new Date().toISOString() }: { db: D1Database; sessionId: string; handles: string[]; sourceSummary: Record<string, unknown>; extraErrorCount?: number; fetchedAt?: string }) {
  const limitedHandles = handles.slice(0, MAX_ACCOUNTS);
  const { results, errors } = await fetchProfiles(limitedHandles);
  const runId = crypto.randomUUID();
  const statements = [
    sessionStatement(db, sessionId, fetchedAt),
    db.prepare("INSERT INTO xstats_runs (id, session_id, fetched_at, source_summary, success_count, error_count) VALUES (?, ?, ?, ?, ?, ?)").bind(runId, sessionId, fetchedAt, JSON.stringify(sourceSummary), results.length, errors.length + extraErrorCount),
    ...results.map((result) => db.prepare("INSERT INTO xstats_snapshots (id, run_id, session_id, account_id, handle, display_name, followers, following, posts, avatar_url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), runId, sessionId, result.id, result.handle, result.displayName, result.followers, result.following, result.posts, result.avatarUrl, result.fetchedAt)),
  ];
  await db.batch(statements);
  await ensureAccountStatuses(db, sessionId, results.map((result) => result.id), fetchedAt);
  await ensureAccountJoinedDates(db, sessionId, results.map((result) => ({ accountId: result.id, joined: result.joined })), fetchedAt);
  const collectionDate = jstCalendarDate(fetchedAt);
  const [freezeDates, statuses] = await Promise.all([loadAccountFreezeDateMap(db, sessionId), loadAccountStatusMap(db, sessionId)]);
  const unfrozenAccounts = results.filter((result) => shouldUnfreezeAfterCollection(freezeDates.get(result.id), collectionDate, statuses.get(result.id)));
  if (unfrozenAccounts.length) {
    const now = new Date().toISOString();
    await db.batch(unfrozenAccounts.map((account) => db.prepare("UPDATE xstats_account_statuses SET status = 'active', freeze_date = NULL, updated_at = ? WHERE session_id = ? AND account_id = ? AND freeze_date IS NOT NULL AND status = 'suspended'").bind(now, sessionId, account.id)));
  }
  await ensureOpeningDateHistory(db, sessionId);
  await ensureDailyPostsThroughToday(db, sessionId);
  await pruneSessionHistory(db, sessionId);
  return { runId, fetchedAt, results, errors, unfrozenAccounts: unfrozenAccounts.map(({ id, handle, displayName }) => ({ id, handle, displayName })) };
}
