import { ensureSchema, ensureSharedSession, getD1, getSharedSession, json, requireAdmin } from "../../_shared";
import { canonicalDailyFetchedAt, dailyRecordDate, ensureDailyHistory, upsertImportedDailyHistory } from "../../../../lib/daily-history";

type DailyRowInput = {
  fetched_at?: unknown;
  account_id?: unknown;
  handle?: unknown;
  display_name?: unknown;
  followers?: unknown;
  following?: unknown;
  posts?: unknown;
};

type DailyRow = {
  fetchedAt: string;
  date: string;
  accountId: string;
  handle: string;
  displayName: string;
  followers: number | null;
  following: number | null;
  posts: number | null;
};

const MAX_ROWS = 100000;

function integerOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function cleanRows(input: unknown[]) {
  const grouped = new Map<string, DailyRow & { metricAt: Record<"followers" | "following" | "posts", number>; identityAt: number }>();
  const candidates: Array<{ timestamp: number; date: string; accountId: string; handle: string; displayName: string; followers: number | null; following: number | null; posts: number | null }> = [];
  for (const value of input) {
    if (!value || typeof value !== "object") continue;
    const row = value as DailyRowInput;
    const sourceFetchedAt = typeof row.fetched_at === "string" ? row.fetched_at : "";
    const timestamp = new Date(sourceFetchedAt).getTime();
    const accountId = String(row.account_id ?? "").trim();
    const handle = String(row.handle ?? "").trim().replace(/^@/, "").toLowerCase();
    const displayName = String(row.display_name ?? "").trim();
    const date = dailyRecordDate(sourceFetchedAt);
    if (!date || !Number.isFinite(timestamp) || !accountId || !handle || !displayName) continue;
    candidates.push({ timestamp, date, accountId, handle, displayName, followers: integerOrNull(row.followers), following: integerOrNull(row.following), posts: integerOrNull(row.posts) });
  }
  candidates.sort((left, right) => left.timestamp - right.timestamp);
  for (const row of candidates) {
    const { timestamp, date, accountId, handle, displayName } = row;
    const key = `${accountId}|${date}`;
    const current = grouped.get(key) ?? { fetchedAt: canonicalDailyFetchedAt(date), date, accountId, handle, displayName, followers: null, following: null, posts: null, metricAt: { followers: -Infinity, following: -Infinity, posts: -Infinity }, identityAt: -Infinity };
    for (const metric of ["followers", "following", "posts"] as const) {
      if (row[metric] !== null && timestamp >= current.metricAt[metric]) {
        current[metric] = row[metric];
        current.metricAt[metric] = timestamp;
      }
    }
    if (timestamp >= current.identityAt) {
      current.handle = handle;
      current.displayName = displayName;
      current.identityAt = timestamp;
    }
    grouped.set(key, current);
  }
  return [...grouped.values()]
    .filter((row) => row.followers !== null || row.following !== null || row.posts !== null)
    .map((row) => ({
      fetchedAt: row.fetchedAt,
      date: row.date,
      accountId: row.accountId,
      handle: row.handle,
      displayName: row.displayName,
      followers: row.followers,
      following: row.following,
      posts: row.posts,
    }));
}

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const body = await request.json() as { sourceFileName?: unknown; rows?: unknown };
    const input = Array.isArray(body.rows) ? body.rows : [];
    if (input.length > MAX_ROWS) return json({ error: "Excel日次履歴の件数が上限を超えています。" }, { status: 413 });
    const rows = cleanRows(input);
    if (!rows.length) return json({ syncedRows: 0, syncedDates: 0 });

    await ensureSchema();
    const db = getD1();
    const session = getSharedSession();
    await ensureSharedSession(db);
    await ensureDailyHistory(db, session.id);
    await upsertImportedDailyHistory(db, session.id, rows.map((row) => ({
      date: row.date,
      accountId: row.accountId,
      handle: row.handle,
      displayName: row.displayName,
      followers: row.followers,
      following: row.following,
      posts: row.posts,
    })));
    return json({ syncedRows: rows.length, syncedDates: new Set(rows.map((row) => row.date)).size });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Excel日次履歴を共有データへ同期できませんでした。" }, { status: 500 });
  }
}
