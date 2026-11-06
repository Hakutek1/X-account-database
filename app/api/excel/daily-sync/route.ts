import { ensureSchema, ensureSharedSession, getD1, getSharedSession, json, pruneSessionHistory, requireAdmin } from "../../_shared";
import { ensureDailyHistory, upsertImportedDailyHistory } from "../../../../lib/daily-history";

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
const JST_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Tokyo" });

function integerOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function jstDate(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  const parts = Object.fromEntries(JST_DATE_FORMATTER.formatToParts(parsed).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function canonicalFetchedAt(date: string) {
  return new Date(`${date}T00:00:00.001+09:00`).toISOString();
}

function stableSnapshotId(accountId: string, date: string) {
  return `excel-daily:${encodeURIComponent(accountId)}:${date}`;
}

function chunk<T>(items: T[], size: number) {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

function cleanRows(input: unknown[]) {
  const grouped = new Map<string, DailyRow>();
  for (const value of input) {
    if (!value || typeof value !== "object") continue;
    const row = value as DailyRowInput;
    const fetchedAt = typeof row.fetched_at === "string" ? row.fetched_at : "";
    const accountId = String(row.account_id ?? "").trim();
    const handle = String(row.handle ?? "").trim().replace(/^@/, "").toLowerCase();
    const displayName = String(row.display_name ?? "").trim();
    const date = jstDate(fetchedAt);
    if (!date || !accountId || !handle || !displayName) continue;
    const key = `${accountId}|${date}`;
    const current = grouped.get(key) ?? { fetchedAt: canonicalFetchedAt(date), date, accountId, handle, displayName, followers: null, following: null, posts: null };
    current.handle = handle;
    current.displayName = displayName;
    if (row.followers !== null && row.followers !== undefined) current.followers = integerOrNull(row.followers);
    if (row.following !== null && row.following !== undefined) current.following = integerOrNull(row.following);
    if (row.posts !== null && row.posts !== undefined) current.posts = integerOrNull(row.posts);
    grouped.set(key, current);
  }
  return [...grouped.values()].filter((row) => row.followers !== null || row.following !== null || row.posts !== null);
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
    const byDate = new Map<string, DailyRow[]>();
    for (const row of rows) byDate.set(row.date, [...(byDate.get(row.date) ?? []), row]);
    const statements: D1PreparedStatement[] = [];
    for (const [date, dateRows] of byDate) {
      const runId = `excel-daily-run:${date}`;
      statements.push(db.prepare("INSERT INTO xstats_runs (id, session_id, fetched_at, source_summary, success_count, error_count) VALUES (?, ?, ?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET session_id = excluded.session_id, fetched_at = excluded.fetched_at, source_summary = excluded.source_summary, success_count = excluded.success_count, error_count = 0").bind(runId, session.id, dateRows[0].fetchedAt, JSON.stringify({ excelDailySync: true, sourceFileName: String(body.sourceFileName ?? "") }), dateRows.length));
      for (const row of dateRows) {
        statements.push(db.prepare("INSERT INTO xstats_snapshots (id, run_id, session_id, account_id, handle, display_name, followers, following, posts, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET run_id = excluded.run_id, session_id = excluded.session_id, account_id = excluded.account_id, handle = excluded.handle, display_name = excluded.display_name, followers = excluded.followers, following = excluded.following, posts = excluded.posts, fetched_at = excluded.fetched_at").bind(stableSnapshotId(row.accountId, date), runId, session.id, row.accountId, row.handle, row.displayName, row.followers, row.following, row.posts, row.fetchedAt));
      }
    }
    for (const batch of chunk(statements, 80)) await db.batch(batch);
    await upsertImportedDailyHistory(db, session.id, rows.map((row) => ({
      date: row.date,
      accountId: row.accountId,
      handle: row.handle,
      displayName: row.displayName,
      followers: row.followers,
      following: row.following,
      posts: row.posts,
    })));
    await pruneSessionHistory(db, session.id);
    return json({ syncedRows: rows.length, syncedDates: byDate.size });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Excel日次履歴を共有データへ同期できませんでした。" }, { status: 500 });
  }
}
