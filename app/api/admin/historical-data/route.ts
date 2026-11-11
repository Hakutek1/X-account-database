import { dailyRecordDate, ensureDailyHistory, ensureDailyPostsThroughToday, ensureOpeningDateHistory, loadDailyHistory, loadDailyHistoryMeta, type DailyHistoryMetric, type DailyHistoryRow } from "../../../../lib/daily-history";
import { loadAccountAssets } from "../../../../lib/account-assets";
import { ensureAccountStatuses, isAccountStatus, loadAccountJoinedMap, loadAccountStatusMap, type AccountStatus } from "../../../../lib/account-status";
import { ensureSchema, ensureSharedSession, getD1, getSharedSession, json, pruneSessionHistory, requireAdmin } from "../../_shared";

const METRICS = new Set<DailyHistoryMetric>(["followers", "following", "posts"]);
const MAX_ACCOUNTS = 500;
const MAX_DATES = 2000;
const MAX_CELLS = 100000;

type AccountInput = {
  accountId?: unknown;
  originalAccountId?: unknown;
  handle?: unknown;
  displayName?: unknown;
  status?: unknown;
};

type HistoricalBody = {
  metric?: unknown;
  revision?: unknown;
  accounts?: unknown;
  dates?: unknown;
  values?: unknown;
};

type Account = {
  accountId: string;
  originalAccountId: string;
  handle: string;
  displayName: string;
  status: AccountStatus;
};

type SnapshotIdentity = {
  account_id: string;
  handle: string;
  display_name: string;
};

type SnapshotForEditor = SnapshotIdentity & {
  fetched_at: string;
  followers: number | null;
  following: number | null;
  posts: number | null;
};

function isMetric(value: unknown): value is DailyHistoryMetric {
  return typeof value === "string" && METRICS.has(value as DailyHistoryMetric);
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function cleanAccount(value: AccountInput): Account | null {
  const accountId = String(value.accountId ?? "").trim();
  const originalAccountId = String(value.originalAccountId ?? accountId).trim() || accountId;
  const handle = String(value.handle ?? "").trim().replace(/^@/, "").toLowerCase();
  const displayName = String(value.displayName ?? "").trim();
  const status = value.status === undefined ? "active" : value.status;
  if (!isAccountStatus(status) || !accountId || !originalAccountId || !handle || !displayName || accountId.length > 200 || originalAccountId.length > 200 || handle.length > 200 || displayName.length > 300) return null;
  return { accountId, originalAccountId, handle, displayName, status };
}

function asNumberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return undefined;
  return value;
}

function key(accountId: string, date: string) {
  return `${accountId}|${date}`;
}

function rowHasAnyMetric(row: Pick<DailyHistoryRow, "followers" | "following" | "posts">) {
  return row.followers !== null || row.following !== null || row.posts !== null;
}

function identityMap(rows: SnapshotIdentity[], dailyRows: DailyHistoryRow[]) {
  const accounts = new Map<string, SnapshotIdentity>();
  for (const row of rows) accounts.set(row.account_id, row);
  for (const row of dailyRows) accounts.set(row.account_id, { account_id: row.account_id, handle: row.handle, display_name: row.display_name });
  return accounts;
}

async function prepareEditorContext() {
  await ensureSchema();
  const db = getD1();
  const session = getSharedSession();
  await ensureSharedSession(db);
  await ensureDailyHistory(db, session.id);
  const accountIds = await db.prepare(`SELECT account_id FROM xstats_snapshots WHERE session_id = ?
    UNION SELECT account_id FROM xstats_daily_history WHERE session_id = ?`).bind(session.id, session.id).all<{ account_id: string }>();
  await ensureAccountStatuses(db, session.id, accountIds.results.map((row) => row.account_id));
  await ensureDailyPostsThroughToday(db, session.id);
  await ensureOpeningDateHistory(db, session.id);
  await pruneSessionHistory(db, session.id);
  return { db, session };
}

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const metric = new URL(request.url).searchParams.get("metric");
  if (!isMetric(metric)) return json({ error: "指標が正しく指定されていません。" }, { status: 400 });
  try {
    const db = getD1();
    const session = getSharedSession();
    const [dailyRows, meta, snapshots, assets, exclusions] = await Promise.all([
      loadDailyHistory(db, session.id),
      loadDailyHistoryMeta(db, session.id),
      db.prepare("SELECT account_id, handle, display_name, fetched_at, followers, following, posts FROM xstats_snapshots WHERE session_id = ? ORDER BY fetched_at ASC").bind(session.id).all<SnapshotForEditor>(),
      loadAccountAssets(db, session.id),
      db.prepare("SELECT account_id FROM xstats_historical_account_exclusions WHERE session_id = ?").bind(session.id).all<{ account_id: string }>(),
    ]);
    const statusByAccount = await loadAccountStatusMap(db, session.id);
    const excludedIds = new Set(exclusions.results.map((row) => row.account_id));
    const visibleDailyRows = dailyRows.filter((row) => !excludedIds.has(row.account_id));
    const visibleSnapshots = snapshots.results.filter((row) => !excludedIds.has(row.account_id));
    const avatarByAccount = new Map(assets.map((asset) => [asset.account_id, asset.avatar_url]));
    const accounts = identityMap(visibleSnapshots, visibleDailyRows);
    const dates = new Set<string>();
    const values: Record<string, Record<string, number | null>> = {};
    for (const row of visibleDailyRows) {
      if (!accounts.has(row.account_id)) accounts.set(row.account_id, { account_id: row.account_id, handle: row.handle, display_name: row.display_name });
      const value = row[metric];
      if (value !== null) dates.add(row.date);
      values[row.account_id] ??= {};
      values[row.account_id][row.date] = value;
    }
    for (const snapshot of visibleSnapshots) {
      const date = dailyRecordDate(snapshot.fetched_at);
      if (!date || date <= "2026-07-22") continue;
      const value = snapshot[metric];
      if (value === null) continue;
      dates.add(date);
      values[snapshot.account_id] ??= {};
      values[snapshot.account_id][date] = value;
      accounts.set(snapshot.account_id, { account_id: snapshot.account_id, handle: snapshot.handle, display_name: snapshot.display_name });
    }
    return json({
      metric,
      revision: meta.revision,
      accounts: [...accounts.values()].map((row) => ({ accountId: row.account_id, handle: row.handle, displayName: row.display_name, status: statusByAccount.get(row.account_id) ?? "active", avatarUrl: avatarByAccount.get(row.account_id) ?? null })).sort((left, right) => left.displayName.localeCompare(right.displayName, "ja") || left.handle.localeCompare(right.handle, "ja") || left.accountId.localeCompare(right.accountId)),
      dates: [...dates].sort(),
      values,
    });
  } catch {
    return json({ error: "過去データを読み込めませんでした。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    await prepareEditorContext();
    return json({ prepared: true });
  } catch {
    return json({ error: "過去データを準備できませんでした。" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const body = await request.json() as HistoricalBody;
    if (!isMetric(body.metric)) return json({ error: "指標が正しく指定されていません。" }, { status: 400 });
    const expectedRevision = Number(body.revision);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return json({ error: "履歴の版情報が正しくありません。" }, { status: 400 });
    const rawAccounts = Array.isArray(body.accounts) ? body.accounts as AccountInput[] : [];
    const accounts = rawAccounts.map(cleanAccount);
    if (accounts.some((account): account is null => account === null)) return json({ error: "アカウント情報が不足しています。" }, { status: 400 });
    if (accounts.length > MAX_ACCOUNTS) return json({ error: `アカウントは${MAX_ACCOUNTS}件まで保存できます。` }, { status: 413 });
    const cleanAccounts = accounts as Account[];
    const accountIds = new Set<string>();
    const originalIds = new Set<string>();
    const handles = new Set<string>();
    for (const account of cleanAccounts) {
      if (accountIds.has(account.accountId)) return json({ error: `アカウントIDが重複しています: ${account.accountId}` }, { status: 400 });
      if (originalIds.has(account.originalAccountId)) return json({ error: `編集元のアカウントIDが重複しています: ${account.originalAccountId}` }, { status: 400 });
      if (handles.has(account.handle)) return json({ error: `ハンドル名が重複しています: @${account.handle}` }, { status: 400 });
      accountIds.add(account.accountId);
      originalIds.add(account.originalAccountId);
      handles.add(account.handle);
    }

    const rawDates = Array.isArray(body.dates) ? body.dates.map(String) : [];
    const dates = [...new Set(rawDates)];
    if (dates.length > MAX_DATES || dates.some((date) => !validDate(date))) return json({ error: "日付が正しくありません。YYYY-MM-DD形式で指定してください。" }, { status: 400 });
    const rawValues = body.values && typeof body.values === "object" ? body.values as Record<string, unknown> : {};
    const values: Record<string, Record<string, number | null>> = {};
    let cellCount = 0;
    let populatedCellCount = 0;
    for (const account of cleanAccounts) {
      const rowValues = rawValues[account.accountId] && typeof rawValues[account.accountId] === "object" ? rawValues[account.accountId] as Record<string, unknown> : {};
      values[account.accountId] = {};
      for (const date of dates) {
        const value = asNumberOrNull(rowValues[date]);
        if (value === undefined) return json({ error: `数値が正しくありません: ${account.accountId} / ${date}` }, { status: 400 });
        values[account.accountId][date] = value;
        cellCount += 1;
        if (value !== null) populatedCellCount += 1;
      }
    }
    if (cellCount > MAX_CELLS) return json({ error: "編集可能なセル数の上限を超えています。" }, { status: 413 });
    const { db, session } = await prepareEditorContext();
    const [dailyRows, snapshots, exclusions] = await Promise.all([
      loadDailyHistory(db, session.id),
      db.prepare("SELECT account_id, handle, display_name FROM xstats_snapshots WHERE session_id = ? GROUP BY account_id").bind(session.id).all<SnapshotIdentity>(),
      db.prepare("SELECT account_id FROM xstats_historical_account_exclusions WHERE session_id = ?").bind(session.id).all<{ account_id: string }>(),
    ]);
    const excludedIds = new Set(exclusions.results.map((row) => row.account_id));
    const knownIds = identityMap(snapshots.results, dailyRows);
    await ensureAccountStatuses(db, session.id, [...knownIds.keys()]);
    const statusByAccount = await loadAccountStatusMap(db, session.id);
    const joinedAtByAccount = await loadAccountJoinedMap(db, session.id);
    const knownAccountIds = new Set([...snapshots.results.map((row) => row.account_id), ...dailyRows.map((row) => row.account_id)]);
    const submittedOriginalIds = new Set(cleanAccounts.map((account) => account.originalAccountId));
    const removedAccountIds = new Set([...knownAccountIds].filter((accountId) => !submittedOriginalIds.has(accountId) && !accountIds.has(accountId)));
    const existingMetricDates = new Set(dailyRows.filter((row) => !excludedIds.has(row.account_id) && row[body.metric] !== null).map((row) => row.date));
    const metadataChanged = cleanAccounts.some((account) => {
      const known = knownIds.get(account.originalAccountId);
      return !known || known.handle !== account.handle || known.display_name !== account.displayName || (statusByAccount.get(account.originalAccountId) ?? "active") !== account.status;
    }) || removedAccountIds.size > 0;
    const newAccountWithoutValue = cleanAccounts.some((account) => !knownIds.has(account.originalAccountId) && !Object.values(values[account.accountId] ?? {}).some((value) => value !== null));
    if (newAccountWithoutValue) return json({ error: "新しいアカウントには少なくとも1つの数値を入力してください。" }, { status: 400 });
    if (!populatedCellCount && !existingMetricDates.size && !metadataChanged) return json({ error: "少なくとも1つの数値を入力してください。" }, { status: 400 });
    for (const date of dates) {
      if (!cleanAccounts.some((account) => values[account.accountId][date] !== null) && !existingMetricDates.has(date)) return json({ error: `${date} は空欄だけの日付なので保存できません。` }, { status: 400 });
    }
    for (const account of cleanAccounts) {
      if (account.originalAccountId !== account.accountId) {
        const conflicting = knownIds.has(account.accountId) && account.accountId !== account.originalAccountId;
        if (conflicting) return json({ error: `変更後のアカウントIDは既に存在します: ${account.accountId}` }, { status: 409 });
      }
    }

    const desired = new Map<string, DailyHistoryRow>();
    const accountByOriginal = new Map(cleanAccounts.map((account) => [account.originalAccountId, account]));
    const accountByCurrent = new Map(cleanAccounts.map((account) => [account.accountId, account]));
    for (const current of dailyRows) {
      const account = accountByOriginal.get(current.account_id) ?? accountByCurrent.get(current.account_id);
      if (!account) continue;
      const next: DailyHistoryRow = {
        ...current,
        id: `daily-history:${encodeURIComponent(account.accountId)}:${current.date}`,
        account_id: account.accountId,
        handle: account.handle,
        display_name: account.displayName,
        origin: "manual",
        updated_at: new Date().toISOString(),
      };
      if (dates.includes(current.date)) next[body.metric] = values[account.accountId][current.date];
      else next[body.metric] = null;
      if (rowHasAnyMetric(next)) desired.set(key(next.account_id, next.date), next);
    }
    for (const account of cleanAccounts) {
      for (const date of dates) {
        const value = values[account.accountId][date];
        if (value === null) continue;
        const rowKey = key(account.accountId, date);
        const current = desired.get(rowKey);
        desired.set(rowKey, current ?? {
          id: `daily-history:${encodeURIComponent(account.accountId)}:${date}`,
          session_id: session.id,
          date,
          account_id: account.accountId,
          handle: account.handle,
          display_name: account.displayName,
          followers: null,
          following: null,
          posts: null,
          fetched_at: new Date(`${date}T00:00:00.001+09:00`).toISOString(),
          origin: "manual",
          updated_at: new Date().toISOString(),
        });
        desired.get(rowKey)![body.metric] = value;
        desired.get(rowKey)!.handle = account.handle;
        desired.get(rowKey)!.display_name = account.displayName;
        desired.get(rowKey)!.origin = "manual";
      }
    }

    const now = new Date().toISOString();
    if (!(await (async () => {
      const result = await db.prepare("UPDATE xstats_daily_history_meta SET revision = revision + 1, updated_at = ? WHERE session_id = ? AND revision = ?").bind(now, session.id, expectedRevision).run();
      return Number(result.meta?.changes ?? 0) === 1;
    })())) return json({ error: "履歴が先に更新されました（別の管理者による保存、またはExcel日次履歴の同期）。再読み込みしてから保存してください。", conflict: true }, { status: 409 });

    const statements: D1PreparedStatement[] = [];
    for (const accountId of removedAccountIds) {
      statements.push(db.prepare("DELETE FROM xstats_snapshots WHERE session_id = ? AND account_id = ?").bind(session.id, accountId));
      statements.push(db.prepare("DELETE FROM xstats_daily_history WHERE session_id = ? AND account_id = ?").bind(session.id, accountId));
      statements.push(db.prepare("DELETE FROM xstats_import_mappings WHERE session_id = ? AND account_id = ?").bind(session.id, accountId));
      statements.push(db.prepare("DELETE FROM xstats_import_issues WHERE session_id = ? AND account_id = ?").bind(session.id, accountId));
      statements.push(db.prepare("DELETE FROM xstats_account_assets WHERE session_id = ? AND account_id = ?").bind(session.id, accountId));
      statements.push(db.prepare("DELETE FROM xstats_account_statuses WHERE session_id = ? AND account_id = ?").bind(session.id, accountId));
      statements.push(db.prepare("INSERT INTO xstats_historical_account_exclusions (session_id, account_id, updated_at) VALUES (?, ?, ?) ON CONFLICT(session_id, account_id) DO UPDATE SET updated_at = excluded.updated_at").bind(session.id, accountId, now));
    }
    for (const account of cleanAccounts) {
      statements.push(db.prepare("DELETE FROM xstats_historical_account_exclusions WHERE session_id = ? AND account_id IN (?, ?)").bind(session.id, account.originalAccountId, account.accountId));
    }
    const desiredKeys = new Set(desired.keys());
    for (const current of dailyRows) {
      const mappedAccount = accountByOriginal.get(current.account_id) ?? accountByCurrent.get(current.account_id);
      const currentKey = mappedAccount ? key(mappedAccount.accountId, current.date) : key(current.account_id, current.date);
      if (!desiredKeys.has(currentKey) || current.id !== desired.get(currentKey)?.id) statements.push(db.prepare("DELETE FROM xstats_daily_history WHERE session_id = ? AND id = ?").bind(session.id, current.id));
    }
    for (const row of desired.values()) {
      statements.push(db.prepare(`INSERT INTO xstats_daily_history
        (id, session_id, date, account_id, handle, display_name, followers, following, posts, fetched_at, origin, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)
        ON CONFLICT(session_id, account_id, date) DO UPDATE SET
          id = excluded.id,
          handle = excluded.handle,
          display_name = excluded.display_name,
          followers = excluded.followers,
          following = excluded.following,
          posts = excluded.posts,
          fetched_at = excluded.fetched_at,
          origin = 'manual',
          updated_at = excluded.updated_at`).bind(row.id, session.id, row.date, row.account_id, row.handle, row.display_name, row.followers, row.following, row.posts, row.fetched_at, now));
    }

    for (const account of cleanAccounts) {
      if (account.originalAccountId !== account.accountId) {
        statements.push(db.prepare("UPDATE xstats_snapshots SET account_id = ? WHERE session_id = ? AND account_id = ?").bind(account.accountId, session.id, account.originalAccountId));
        statements.push(db.prepare("UPDATE xstats_import_mappings SET account_id = ? WHERE session_id = ? AND account_id = ?").bind(account.accountId, session.id, account.originalAccountId));
        statements.push(db.prepare("UPDATE xstats_import_issues SET account_id = ? WHERE session_id = ? AND account_id = ?").bind(account.accountId, session.id, account.originalAccountId));
        statements.push(db.prepare("UPDATE xstats_account_assets SET account_id = ?, avatar_url = replace(avatar_url, 'accountId=' || ?, 'accountId=' || ?) WHERE session_id = ? AND account_id = ?").bind(account.accountId, encodeURIComponent(account.originalAccountId), encodeURIComponent(account.accountId), session.id, account.originalAccountId));
        statements.push(db.prepare("DELETE FROM xstats_account_statuses WHERE session_id = ? AND account_id = ?").bind(session.id, account.originalAccountId));
      }
      const joinedAt = joinedAtByAccount.get(account.originalAccountId) ?? joinedAtByAccount.get(account.accountId) ?? null;
      statements.push(db.prepare(`INSERT INTO xstats_account_statuses (session_id, account_id, status, joined_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(session_id, account_id) DO UPDATE SET status = excluded.status, joined_at = COALESCE(xstats_account_statuses.joined_at, excluded.joined_at), updated_at = excluded.updated_at`).bind(session.id, account.accountId, account.status, joinedAt, now));
      statements.push(db.prepare("UPDATE xstats_snapshots SET handle = ?, display_name = ? WHERE session_id = ? AND account_id = ?").bind(account.handle, account.displayName, session.id, account.accountId));
      statements.push(db.prepare("UPDATE xstats_import_mappings SET handle = ?, display_name = ? WHERE session_id = ? AND account_id = ?").bind(account.handle, account.displayName, session.id, account.accountId));
      statements.push(db.prepare("UPDATE xstats_import_issues SET handle = ?, display_name = ? WHERE session_id = ? AND account_id = ?").bind(account.handle, account.displayName, session.id, account.accountId));
    }
    for (const statementChunk of chunk(statements, 80)) if (statementChunk.length) await db.batch(statementChunk);
    return json({ saved: true, revision: expectedRevision + 1, accounts: cleanAccounts.length, dates: dates.length, cells: populatedCellCount });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "過去データを保存できませんでした。" }, { status: 500 });
  }
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}
