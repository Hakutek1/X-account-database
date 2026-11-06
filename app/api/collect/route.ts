import { ensureSchema, ensureSharedSession, getD1, getSharedSession, json, pruneSessionHistory, requireAdmin } from "../_shared";
import { MAX_ACCOUNTS, parseInputs } from "../../../lib/x-stats";
import { collectForSession } from "../../../lib/collection";
import { ensureAccountStatuses, loadAccountJoinedMap, loadAccountStatusMap } from "../../../lib/account-status";
import { ensureDailyHistory, ensureDailyPostsThroughToday, ensureOpeningDateHistory } from "../../../lib/daily-history";

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const session = getSharedSession();
  try {
    const body = (await request.json()) as { handles?: unknown };
    const values = Array.isArray(body.handles) ? body.handles.map(String) : [];
    const parsed = parseInputs(values);
    const handles = parsed.handles;

    if (!handles.length) {
      const response = json({ error: parsed.errors.join(" ") || "アカウントを入力してください" }, { status: 400 });
      return response;
    }

    const limitedHandles = handles.slice(0, MAX_ACCOUNTS);
    await ensureSchema();
    const db = getD1();
    await ensureSharedSession(db);
    const fetchedAt = new Date().toISOString();
    const { runId, results, errors } = await collectForSession({
      db,
      sessionId: session.id,
      handles: limitedHandles,
      fetchedAt,
      extraErrorCount: parsed.errors.length,
      sourceSummary: { manualCount: parsed.handles.length, truncated: handles.length > MAX_ACCOUNTS },
    });
    await ensureDailyHistory(db, session.id);
    const accountIds = await db.prepare(`SELECT account_id FROM xstats_snapshots WHERE session_id = ?
      UNION SELECT account_id FROM xstats_daily_history WHERE session_id = ?`).bind(session.id, session.id).all<{ account_id: string }>();
    await ensureAccountStatuses(db, session.id, accountIds.results.map((row) => row.account_id));
    await ensureDailyPostsThroughToday(db, session.id);
    await ensureOpeningDateHistory(db, session.id);
    await pruneSessionHistory(db, session.id);
    const statusById = await loadAccountStatusMap(db, session.id);
    const joinedById = await loadAccountJoinedMap(db, session.id);

    const response = json({
      runId,
      fetchedAt,
      rows: [
        ...results.map((result) => ({ ...result, joined: joinedById.get(result.id) ?? result.joined, accountStatus: statusById.get(result.id) ?? "active", status: "ok" as const })),
        ...errors.map((error) => ({ id: `error:${error.handle}`, handle: error.handle, displayName: "取得失敗", avatarUrl: null, followers: null, following: null, posts: null, joined: null, fetchedAt: error.fetchedAt, accountStatus: "active" as const, status: "error" as const, error: error.error })),
      ],
      warnings: [
        ...(handles.length > MAX_ACCOUNTS ? [`${handles.length}件中、先頭${MAX_ACCOUNTS}件のみ取得しました`] : []),
        ...parsed.errors,
      ],
    });
    return response;
  } catch (error) {
    const response = json({ error: error instanceof Error ? error.message : "データ取得に失敗しました" }, { status: 500 });
    return response;
  }
}
