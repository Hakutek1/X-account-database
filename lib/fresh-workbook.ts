import * as XLSX from "xlsx";
import { dailyRecordDate } from "./daily-history.ts";
import { ACCOUNT_STATUS_LABELS, type AccountStatus } from "./account-status.ts";
import { WORKBOOK_SHEETS } from "./workbook-sheet-names.ts";

export type FreshExportRow = {
  fetchedAt: string;
  accountId: string;
  handle: string;
  displayName: string;
  accountStatus?: AccountStatus;
  followers: number | null;
  following: number | null;
  posts: number | null;
};

export const ANALYSIS_WORKBOOK_SHEETS = [
  "フォロー&フォロワー増減数",
  "フォロワー増減率(週)",
  "フォロワー増減率(月)",
  "フォロワー比率",
  "ポスト増減数",
  "一次ツイート率",
  "投稿数÷フォロワー数",
  "凍結回数",
] as const;

export const FRESH_WORKBOOK_SHEETS = [
  WORKBOOK_SHEETS.latest,
  WORKBOOK_SHEETS.dailyFollowers,
  WORKBOOK_SHEETS.dailyFollowing,
  WORKBOOK_SHEETS.dailyPosts,
] as const;

type MetricKey = "followers" | "following" | "posts";
type SheetRow = Record<string, string | number | null>;

function dailyExportBucket(value: string) {
  return dailyRecordDate(value);
}

function pivotDailyMetricSheet(source: FreshExportRow[], metric: MetricKey): SheetRow[] {
  type Value = { fetchedAt: number; value: number | null };
  type Account = { accountId: string; handle: string; displayName: string; accountStatus: AccountStatus; latestFetchedAt: number; values: Map<string, Value> };
  const accounts = new Map<string, Account>();
  const columns = new Map<string, { order: number; label: string }>();

  for (const row of source) {
    const bucket = dailyExportBucket(row.fetchedAt);
    if (!bucket) continue;
    const order = new Date(row.fetchedAt).getTime();
    const label = `${bucket.slice(2, 4)}/${bucket.slice(5, 7)}/${bucket.slice(8, 10)}`;
    const columnOrder = new Date(`${bucket}T00:00:00+09:00`).getTime();
    const currentColumn = columns.get(bucket);
    if (!currentColumn || columnOrder < currentColumn.order) columns.set(bucket, { order: columnOrder, label });

    const account = accounts.get(row.accountId) ?? {
      accountId: row.accountId, handle: row.handle, displayName: row.displayName, accountStatus: row.accountStatus ?? "active",
      latestFetchedAt: -Infinity, values: new Map<string, Value>(),
    };
    const current = account.values.get(bucket);
    if (!current || order >= current.fetchedAt) account.values.set(bucket, { fetchedAt: order, value: row[metric] });
    if (order >= account.latestFetchedAt) {
      account.handle = row.handle;
      account.displayName = row.displayName;
      account.accountStatus = row.accountStatus ?? "active";
      account.latestFetchedAt = order;
    }
    accounts.set(row.accountId, account);
  }

  const orderedColumns = [...columns.entries()].sort((left, right) => left[1].order - right[1].order);
  return [...accounts.values()]
    .sort((left, right) => left.handle.localeCompare(right.handle, "ja"))
    .map((account) => {
      const output: SheetRow = { アカウントID: account.accountId, ハンドル: `@${account.handle}`, 表示名: account.displayName, 活動状態: ACCOUNT_STATUS_LABELS[account.accountStatus] };
      for (const [key, column] of orderedColumns) output[column.label] = account.values.get(key)?.value ?? null;
      return output;
    });
}

export function buildFreshWorkbook({
  latestRows,
  historyRows,
}: {
  latestRows: FreshExportRow[];
  historyRows: FreshExportRow[];
}) {
  const workbook = XLSX.utils.book_new();
  const latest = latestRows.map((row) => ({ 取得日時: row.fetchedAt, アカウントID: row.accountId, ハンドル: `@${row.handle}`, 表示名: row.displayName, 活動状態: ACCOUNT_STATUS_LABELS[row.accountStatus ?? "active"], フォロワー数: row.followers, フォロー数: row.following, 投稿数: row.posts }));
  const append = (name: string, rows: SheetRow[]) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), name);

  append(WORKBOOK_SHEETS.latest, latest);
  append(WORKBOOK_SHEETS.dailyFollowers, pivotDailyMetricSheet(historyRows, "followers"));
  append(WORKBOOK_SHEETS.dailyFollowing, pivotDailyMetricSheet(historyRows, "following"));
  append(WORKBOOK_SHEETS.dailyPosts, pivotDailyMetricSheet(historyRows, "posts"));

  return {
    bytes: XLSX.write(workbook, { bookType: "xlsx", type: "array", cellStyles: true }),
    sheetNames: workbook.SheetNames,
    rowCounts: Object.fromEntries(workbook.SheetNames.map((name) => [name, XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1 }).length])),
  };
}
