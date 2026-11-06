import { ensureSchema, ensureSharedSession, getD1, getSharedSession, json, pruneSessionHistory, requireAdmin } from "../../_shared";
import { ensureDailyHistory, upsertImportedDailyHistory } from "../../../../lib/daily-history";

type MappingInput = { sourceName?: unknown; sourceKey?: unknown; accountId?: unknown; handle?: unknown; displayName?: unknown };
type SnapshotInput = { date?: unknown; fetchedAt?: unknown; accountId?: unknown; followers?: unknown; following?: unknown; posts?: unknown };
type IssueInput = { issueType?: unknown; sourceSheet?: unknown; sourceName?: unknown; accountId?: unknown; handle?: unknown; displayName?: unknown; date?: unknown; metric?: unknown; sourceValue?: unknown; siteValue?: unknown; details?: unknown };

const IMPORT_CUTOFF = "2026-07-22";

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function nullableInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const session = getSharedSession();
  try {
    const body = await request.json() as { importId?: unknown; sourceFileName?: unknown; mappings?: unknown; snapshots?: unknown; issues?: unknown };
    const mappings = Array.isArray(body.mappings) ? body.mappings as MappingInput[] : [];
    const snapshots = Array.isArray(body.snapshots) ? body.snapshots as SnapshotInput[] : [];
    const issues = Array.isArray(body.issues) ? body.issues as IssueInput[] : [];
    if (!mappings.length || !snapshots.length) {
      const response = json({ error: "照合済みのアカウントと取り込みデータが必要です。" }, { status: 400 });
      return response;
    }
    if (mappings.length > 500 || snapshots.length > 100000 || issues.length > 100000) {
      const response = json({ error: "取り込み可能なデータ量を超えています。" }, { status: 413 });
      return response;
    }

    await ensureSchema();
    const db = getD1();
    await ensureSharedSession(db);
    await ensureDailyHistory(db, session.id);
    const known = await db.prepare("SELECT account_id, handle, display_name FROM xstats_snapshots WHERE session_id = ? GROUP BY account_id").bind(session.id).all<{ account_id: string; handle: string; display_name: string }>();
    const knownById = new Map(known.results.map((row) => [row.account_id, row]));
    const cleanMappings = mappings.map((mapping) => ({
      sourceName: String(mapping.sourceName ?? "").trim(),
      sourceKey: String(mapping.sourceKey ?? "").trim(),
      accountId: String(mapping.accountId ?? "").trim(),
    })).filter((mapping) => mapping.sourceName && mapping.sourceKey && mapping.accountId);
    if (cleanMappings.some((mapping) => !knownById.has(mapping.accountId))) {
      const response = json({ error: "サイトの履歴に存在しないアカウントが照合されています。先にサイトで取得してください。" }, { status: 400 });
      return response;
    }
    const mappingBySource = new Map(cleanMappings.map((mapping) => [mapping.sourceKey, mapping]));
    const cleanSnapshots = snapshots.map((snapshot) => {
      const date = String(snapshot.date ?? "");
      const accountId = String(snapshot.accountId ?? "");
      const account = knownById.get(accountId);
      return { date, accountId, account, fetchedAt: String(snapshot.fetchedAt ?? ""), followers: nullableInteger(snapshot.followers), following: nullableInteger(snapshot.following), posts: nullableInteger(snapshot.posts) };
    }).filter((snapshot) => snapshot.account && /^\d{4}-\d{2}-\d{2}$/.test(snapshot.date) && snapshot.date <= IMPORT_CUTOFF && Number.isFinite(new Date(snapshot.fetchedAt).getTime()));
    if (!cleanSnapshots.length) {
      const response = json({ error: "有効な日付データがありません。" }, { status: 400 });
      return response;
    }

    const importId = typeof body.importId === "string" && /^[0-9a-z-]{8,80}$/i.test(body.importId) ? body.importId : crypto.randomUUID();
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      db.prepare("INSERT INTO xstats_sessions (id, created_at, last_seen_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at").bind(session.id, now, now),
      ...cleanMappings.map((mapping) => {
        const account = knownById.get(mapping.accountId)!;
        return db.prepare("INSERT INTO xstats_import_mappings (id, session_id, source_name, source_key, account_id, handle, display_name, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(session_id, source_key) DO UPDATE SET source_name = excluded.source_name, account_id = excluded.account_id, handle = excluded.handle, display_name = excluded.display_name, updated_at = excluded.updated_at").bind(crypto.randomUUID(), session.id, mapping.sourceName, mapping.sourceKey, mapping.accountId, account.handle, account.display_name, now);
      }),
    ];

    const byDate = new Map<string, typeof cleanSnapshots>();
    for (const snapshot of cleanSnapshots) byDate.set(snapshot.date, [...(byDate.get(snapshot.date) ?? []), snapshot]);
    for (const [, dateSnapshots] of byDate) {
      const runId = crypto.randomUUID();
      statements.push(db.prepare("INSERT INTO xstats_runs (id, session_id, fetched_at, source_summary, success_count, error_count) VALUES (?, ?, ?, ?, ?, 0)").bind(runId, session.id, dateSnapshots[0].fetchedAt, JSON.stringify({ imported: true, importId, sourceFileName: String(body.sourceFileName ?? "") }), dateSnapshots.length));
      for (const snapshot of dateSnapshots) {
        const account = snapshot.account!;
        statements.push(db.prepare("INSERT INTO xstats_snapshots (id, run_id, session_id, account_id, handle, display_name, followers, following, posts, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), runId, session.id, snapshot.accountId, account.handle, account.display_name, snapshot.followers, snapshot.following, snapshot.posts, snapshot.fetchedAt));
      }
    }

    const cleanIssues = issues.map((issue) => ({
      issueType: String(issue.issueType ?? "unmatched"),
      sourceSheet: String(issue.sourceSheet ?? ""),
      sourceName: String(issue.sourceName ?? ""),
      accountId: issue.accountId ? String(issue.accountId) : null,
      handle: issue.handle ? String(issue.handle) : null,
      displayName: issue.displayName ? String(issue.displayName) : null,
      date: issue.date ? String(issue.date) : null,
      metric: issue.metric ? String(issue.metric) : null,
      sourceValue: nullableInteger(issue.sourceValue),
      siteValue: nullableInteger(issue.siteValue),
      details: String(issue.details ?? "確認が必要です。"),
    })).filter((issue) => issue.sourceName);
    for (const issue of cleanIssues) {
      statements.push(db.prepare("INSERT INTO xstats_import_issues (id, session_id, import_id, issue_type, source_sheet, source_name, account_id, handle, display_name, date, metric, source_value, site_value, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), session.id, importId, issue.issueType, issue.sourceSheet, issue.sourceName, issue.accountId, issue.handle, issue.displayName, issue.date, issue.metric, issue.sourceValue, issue.siteValue, issue.details, now));
    }

    for (const statementChunk of chunk(statements, 80)) await db.batch(statementChunk);
    await upsertImportedDailyHistory(db, session.id, cleanSnapshots.map((snapshot) => ({
      date: snapshot.date,
      accountId: snapshot.accountId,
      handle: snapshot.account!.handle,
      displayName: snapshot.account!.display_name,
      followers: snapshot.followers,
      following: snapshot.following,
      posts: snapshot.posts,
    })), now);
    await pruneSessionHistory(db, session.id);
    const response = json({ importId, importedSnapshots: cleanSnapshots.length, savedMappings: mappingBySource.size, issues: cleanIssues.length });
    return response;
  } catch (error) {
    const response = json({ error: error instanceof Error ? error.message : "Excel履歴を統合できませんでした" }, { status: 500 });
    return response;
  }
}
