import { ensureSchema, ensureSharedSession, getD1, getSessionFromRequest, getSharedSession, sessionCookie } from "../../db";
import { isAdminRequest, isReadAllowed } from "../../lib/admin-access";

export { ensureSchema, ensureSharedSession, getD1, getSessionFromRequest, getSharedSession, sessionCookie };

export async function requireReadAccess(request: Request) {
  if (await isReadAllowed(request)) return null;
  return json({ error: "閲覧には管理者ログインが必要です。" }, { status: 403, headers: { "Cache-Control": "no-store" } });
}

export async function requireAdmin(request: Request) {
  if (await isAdminRequest(request)) return null;
  return json({ error: "この操作は管理者のみ実行できます。" }, { status: 403 });
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const THREE_HOUR_MS = 3 * HOUR_MS;
const MINUTE_MS = 60 * 1000;

type RetentionRun = { id: string; fetched_at: string };

function retentionSlot(value: string) {
  const fetchedAt = new Date(value).getTime();
  if (!Number.isFinite(fetchedAt)) return null;

  const minuteTimestamp = Math.floor((fetchedAt + JST_OFFSET_MS) / MINUTE_MS) * MINUTE_MS;
  const localBlockStart = Math.floor(minuteTimestamp / THREE_HOUR_MS) * THREE_HOUR_MS;
  const minuteInBlock = minuteTimestamp - localBlockStart;
  // The retention interval is (N:00, N+3:00], so an exact boundary belongs
  // to the block ending at that boundary.
  const localBoundary = minuteInBlock === 0 ? minuteTimestamp : localBlockStart + THREE_HOUR_MS;
  const boundaryTimestamp = localBoundary - JST_OFFSET_MS;
  return { key: String(boundaryTimestamp), distance: boundaryTimestamp - minuteTimestamp, fetchedAt };
}

/** Keep only the run closest to each JST 3-hour boundary (N:01 through N+3:00). */
export async function pruneSessionHistory(db: D1Database, sessionId: string) {
  const runs = await db.prepare("SELECT id, fetched_at FROM xstats_runs WHERE session_id = ? ORDER BY fetched_at ASC").bind(sessionId).all<RetentionRun>();
  const winners = new Map<string, RetentionRun & { distance: number; fetchedAt: number }>();
  const obsoleteRunIds: string[] = [];

  for (const run of runs.results) {
    const slot = retentionSlot(run.fetched_at);
    if (!slot) continue;
    const candidate = { ...run, ...slot };
    const current = winners.get(slot.key);
    if (!current || candidate.distance < current.distance || (candidate.distance === current.distance && candidate.fetchedAt >= current.fetchedAt)) {
      if (current) obsoleteRunIds.push(current.id);
      winners.set(slot.key, candidate);
    } else {
      obsoleteRunIds.push(run.id);
    }
  }

  if (!obsoleteRunIds.length) return 0;

  const statements: D1PreparedStatement[] = [];
  for (let index = 0; index < obsoleteRunIds.length; index += 40) {
    const chunk = obsoleteRunIds.slice(index, index + 40);
    const placeholders = chunk.map(() => "?").join(", ");
    statements.push(db.prepare(`DELETE FROM xstats_snapshots WHERE session_id = ? AND run_id IN (${placeholders})`).bind(sessionId, ...chunk));
    statements.push(db.prepare(`DELETE FROM xstats_runs WHERE session_id = ? AND id IN (${placeholders})`).bind(sessionId, ...chunk));
  }
  await db.batch(statements);
  return obsoleteRunIds.length;
}

export function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...(init?.headers ?? {}) },
  });
}
