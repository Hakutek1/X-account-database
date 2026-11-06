import { ensureSchema, ensureSharedSession, getD1, getSharedSession, json, requireAdmin, requireReadAccess } from "../../_shared";

const TARGET_HANDLE = "nflf";
const TARGET_DATE = "2026-07-25";
const JST_DAY_START_UTC = "2026-07-24T15:00:00.000Z";
const NEXT_JST_DAY_START_UTC = "2026-07-25T15:00:00.000Z";

type Candidate = { account_id: string; handle: string; display_name: string; snapshot_count: number; target_date_count: number; latest_fetched_at: string | null };

async function findCandidates(db: D1Database = getD1(), session = getSharedSession()) {
  const result = await db.prepare(`
    SELECT account_id, MAX(handle) AS handle, MAX(display_name) AS display_name,
      COUNT(*) AS snapshot_count,
      SUM(CASE WHEN fetched_at >= ? AND fetched_at < ? THEN 1 ELSE 0 END) AS target_date_count,
      MAX(fetched_at) AS latest_fetched_at
    FROM xstats_snapshots
    WHERE session_id = ? AND (lower(handle) LIKE ? OR lower(display_name) = ?)
    GROUP BY account_id ORDER BY account_id ASC
  `).bind(JST_DAY_START_UTC, NEXT_JST_DAY_START_UTC, session.id, `%${TARGET_HANDLE}%`, TARGET_HANDLE).all<Candidate>();
  return { db, session, rows: result.results };
}

export async function GET(request: Request) {
  const denied = await requireReadAccess(request);
  if (denied) return denied;
  try { return json({ handle: TARGET_HANDLE, targetDate: TARGET_DATE, candidates: (await findCandidates()).rows }); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "NFLFの重複データを確認できませんでした。" }, { status: 500 }); }
}

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const body = await request.json() as { removeAccountId?: unknown; keepAccountId?: unknown };
    const removeAccountId = String(body.removeAccountId ?? "").trim();
    const keepAccountId = String(body.keepAccountId ?? "").trim();
    if (!removeAccountId || !keepAccountId || removeAccountId === keepAccountId) return json({ error: "削除対象と保持対象のアカウントIDを別々に指定してください。" }, { status: 400 });
    await ensureSchema();
    const db = getD1();
    const session = getSharedSession();
    await ensureSharedSession(db);
    const { rows } = await findCandidates(db, session);
    const remove = rows.find((row) => row.account_id === removeAccountId);
    const keep = rows.find((row) => row.account_id === keepAccountId);
    if (!remove || !keep) return json({ error: "指定された2つのIDがNFLFの重複候補として確認できません。", candidates: rows }, { status: 409 });
    if (Number(remove.target_date_count) !== 0 || Number(keep.target_date_count) < 1) return json({ error: "7/25データの有無が指定条件と一致しないため、安全のため削除しませんでした。", remove, keep }, { status: 409 });
    const deleted = await db.prepare("DELETE FROM xstats_snapshots WHERE session_id = ? AND account_id = ?").bind(session.id, removeAccountId).run();
    await db.prepare("DELETE FROM xstats_runs WHERE session_id = ? AND id NOT IN (SELECT DISTINCT run_id FROM xstats_snapshots WHERE session_id = ?)").bind(session.id, session.id).run();
    return json({ removed: true, removedAccountId: removeAccountId, keptAccountId: keepAccountId, deletedSnapshots: deleted.meta.changes ?? 0, targetDate: TARGET_DATE });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "NFLFの重複データを削除できませんでした。" }, { status: 500 }); }
}
