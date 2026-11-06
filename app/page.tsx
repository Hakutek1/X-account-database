"use client";

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import * as XLSX from "xlsx";
import { buildFreshWorkbook, FRESH_WORKBOOK_SHEETS } from "../lib/fresh-workbook";
import { WORKBOOK_SHEETS } from "../lib/workbook-sheet-names";
import { canonicalDailyFetchedAt, dailyRecordDate } from "../lib/daily-history";
import { ACCOUNT_STATUS_LABELS, ACCOUNT_STATUSES, isAccountStatus, type AccountStatus } from "../lib/account-status";
import HistoricalDataEditor from "./historical-data-editor";
import { resolveLinearAxisDomain } from "../lib/chart-axis";
import { FALLBACK_SITE_VERSION_NUMBER, formatSiteVersion } from "../lib/site-version";
import { CHART_DATA_PAGE_SIZE, filterChartPickerAccounts, getNextChartMarkIndex, getRovingTabIndex, groupChartPickerAccounts, paginateChartRows, updateChartSelection } from "../lib/chart-accessibility";

const MAX_ACCOUNTS = 500;
const numberFormatter = new Intl.NumberFormat("ja-JP");
const compactNumberFormatter = new Intl.NumberFormat("ja-JP", { notation: "compact", maximumFractionDigits: 1 });
const chartDatePartFormatter = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const chartDateLabelFormatters = {
  short: new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", timeZone: "UTC" }),
  month: new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "short", timeZone: "UTC" }),
  full: new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" }),
};

type MetricKey = "followers" | "following" | "posts";
type SortKey = "handle" | "displayName" | "followers" | "followersDelta" | "following" | "posts" | "postsDelta" | "joined";
type ChartMode = "compare" | "trend";
type CompareOrientation = "column" | "row";
type DashboardTab = "results" | "chart" | "historical";
type ResultsViewMode = "table" | "compact" | "top10";
type TopMetric = "followers" | "followersDelta" | "following" | "followingDelta" | "posts" | "postsDelta" | "postsPerFollower";
type ChartMetric = MetricKey | "followersDelta" | "followingDelta" | "postsDelta" | "postsPerFollower" | "followersCumulativeDelta";
type StatusCategory = "active" | "ended" | "nonAlt";
type Granularity = "day" | "week" | "month";
type Theme = "light" | "dark";

type AccountRow = {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  followers: number | null;
  following: number | null;
  posts: number | null;
  joined: string | null;
  fetchedAt: string;
  status: "ok" | "error";
  accountStatus: AccountStatus;
  error?: string;
};

type HistoryRow = {
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
};

type LatestCollection = { fetched_at: string; success_count: number; error_count: number };
type HistoryResponse = { runs?: { id: string; fetched_at: string }[]; rows?: HistoryRow[]; latestCollection?: LatestCollection | null; error?: string };
type CollectResponse = { rows?: AccountRow[]; warnings?: string[]; error?: string };
type AdminStatus = { configured?: boolean; isAdmin?: boolean; readMode?: "private" | "public"; error?: string };
type SiteVersionResponse = { version?: number; label?: string };
type ExportRow = {
  fetchedAt: string;
  accountId: string;
  handle: string;
  displayName: string;
  accountStatus: AccountStatus;
  followers: number | null;
  following: number | null;
  posts: number | null;
};
type PreviousMetrics = { followers: number | null; following: number | null; posts: number | null };
type PersistedDashboardState = { accountInput?: string; rows?: AccountRow[]; selectedHandles?: string[]; statusFilter?: StatusCategory[]; chartStatusFilter?: AccountStatus[]; theme?: Theme; displayNameOverrides?: Record<string, string>; legendColors?: Record<string, string>; barColor?: string; chartTitle?: string; chartTitleFontSize?: number; trendLineWidth?: number; markerSize?: number; markerOutlineWidth?: number; markerOutlineColor?: string; trendValueFontSize?: number; trendAxisFontSize?: number; trendDateFontSize?: number; trendValueLabelColor?: "series" | "black"; compareLabelFontSize?: number; showTrendLegend?: boolean; logScale?: boolean };

const NETWORK_RETRY_COUNT = 2;
const NETWORK_RETRY_DELAY_MS = 700;
const DASHBOARD_STORAGE_KEY = "x-account-stats-dashboard-v2";
const LEGACY_BROWSER_EXCEL_DB = "x-account-stats-imports";
const CHART_TITLE_TOP_PADDING = 20;
const CHART_TITLE_GAP = 14;

function avatarFingerprint(rows: AccountRow[]) {
  return rows.map((row) => `${row.id}|${row.handle}|${row.avatarUrl ?? ""}`).join("\n");
}

const topMetricLabels: Record<TopMetric, string> = {
  followers: "フォロワー数",
  followersDelta: "フォロワー増減数",
  following: "フォロー数",
  followingDelta: "フォロー増減数",
  posts: "投稿数",
  postsDelta: "投稿増減数",
  postsPerFollower: "一フォロワー当たりの投稿数",
};

const topMetricDownloadNames: Record<TopMetric, string> = {
  followers: "複垢フォロワー数TOP15",
  followersDelta: "複垢フォロワー増減数TOP15",
  following: "複垢フォロー数TOP15",
  followingDelta: "複垢フォロー増減数TOP15",
  posts: "複垢ポスト数TOP15",
  postsDelta: "複垢ポスト増減数TOP15",
  postsPerFollower: "複垢フォロワー/ポスト数TOP15",
};

const chartMetricLabels: Record<ChartMetric, string> = {
  followers: "フォロワー数",
  followersDelta: "フォロワー増減数",
  following: "フォロー数",
  followingDelta: "フォロー増減数",
  posts: "投稿数",
  postsDelta: "投稿増減数",
  postsPerFollower: "一フォロワー当たりの投稿数",
  followersCumulativeDelta: "累積フォロワー増加数",
};

const legendPalette = ["#168b88", "#d46c5a", "#6f75c9", "#b47a37", "#5a9b72", "#9b5d91", "#3e83b7", "#aa8b3d", "#4f9a97", "#c15b7a"];

function defaultLegendColor(index: number) {
  return legendPalette[index % legendPalette.length];
}

type TrendLegendEntry = { handle: string; displayName: string; color: string };
type TrendLegendLayout = { fontSize: number; rowHeight: number; height: number; items: Array<TrendLegendEntry & { x: number; row: number; label: string }> };

function layoutTrendLegend(entries: TrendLegendEntry[], availableWidth: number): TrendLegendLayout {
  if (!entries.length) return { fontSize: 11, rowHeight: 0, height: 0, items: [] };
  const maxHeight = 250;
  const minFontSize = 6;
  const maxFontSize = 11;
  const measure = (label: string, fontSize: number) => {
    const textWidth = [...label].reduce((width, character) => {
      const isWide = /[^\u0000-\u00ff]/.test(character);
      return width + fontSize * (isWide ? 1 : 0.62);
    }, 0);
    return 54 + Math.max(28, textWidth);
  };
  const layoutAt = (fontSize: number) => {
    const rowHeight = Math.max(14, fontSize + 8);
    const items: TrendLegendLayout["items"] = [];
    let x = 0;
    let row = 0;
    for (const entry of entries) {
      const label = entry.displayName.length > 30 ? `${entry.displayName.slice(0, 29)}…` : entry.displayName;
      const width = measure(label, fontSize);
      if (x > 0 && x + width > availableWidth) {
        row += 1;
        x = 0;
      }
      items.push({ ...entry, x, row, label });
      x += width;
    }
    return { fontSize, rowHeight, height: 18 + (row + 1) * rowHeight, items };
  };
  for (let fontSize = maxFontSize; fontSize >= minFontSize; fontSize -= 0.5) {
    const layout = layoutAt(fontSize);
    if (layout.height <= maxHeight) return layout;
  }
  const layout = layoutAt(minFontSize);
  return { ...layout, rowHeight: Math.max(8, (maxHeight - 18) / Math.max(1, new Set(layout.items.map((item) => item.row)).size)), height: maxHeight };
}

function resolvedDisplayName(row: Pick<AccountRow, "id" | "handle" | "displayName"> | Pick<HistoryRow, "account_id" | "handle" | "display_name">, overrides: Readonly<Record<string, string>>) {
  const accountId = "id" in row ? row.id : row.account_id;
  const original = "displayName" in row ? row.displayName : row.display_name;
  const handle = row.handle.toLowerCase();
  return overrides[accountId]?.trim() || overrides[handle]?.trim() || overrides[`@${handle}`]?.trim() || original;
}

function parseLines(value: string) {
  return value
    .split(/[\n,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueValues(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.replace(/^@/, "").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatNumber(value: number | null | undefined, compact = false) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (compact && Math.abs(value) >= 1000) return compactNumberFormatter.format(value);
  return numberFormatter.format(value);
}

function formatDate(value: string | null | undefined, includeTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", includeTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(date);
}

function handleTabListKeyDown<T extends string>(event: React.KeyboardEvent<HTMLDivElement>, values: readonly T[], onChange: (value: T) => void) {
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const currentIndex = tabs.findIndex((tab) => tab === document.activeElement);
  const nextIndex = getRovingTabIndex(currentIndex, event.key, tabs.length);
  if (nextIndex === null || !values[nextIndex] || !tabs[nextIndex]) return;
  event.preventDefault();
  onChange(values[nextIndex]);
  tabs[nextIndex].focus();
}

function formatWorkbookFileDate(value = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Tokyo",
  }).formatToParts(value).map((part) => [part.type, part.value]));
  // A normal slash is a path separator on macOS/Windows, so use its full-width
  // form while preserving the requested YY/MM/DD appearance in the filename.
  return `${parts.year.slice(-2)}／${parts.month}／${parts.day}`;
}

function compareSortValues(left: string | number | null | undefined, right: string | number | null | undefined, sortKey: SortKey) {
  if (left === right) return 0;
  if (left === null || left === undefined) return 1;
  if (right === null || right === undefined) return -1;
  if (sortKey === "joined") {
    const leftDate = Date.parse(String(left));
    const rightDate = Date.parse(String(right));
    if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) return leftDate - rightDate;
    if (Number.isFinite(leftDate)) return -1;
    if (Number.isFinite(rightDate)) return 1;
  }
  return typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), "ja");
}

function formatDelta(value: number | null | undefined) {
  if (value === null || value === undefined) return "初回";
  if (value === 0) return "±0";
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function formatRatio(posts: number | null | undefined, followers: number | null | undefined) {
  if (posts === null || posts === undefined || followers === null || followers === undefined || !Number.isFinite(posts) || !Number.isFinite(followers) || followers <= 0) return "-";
  return (posts / followers).toFixed(3);
}

function shortDateKey(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value ?? "";
  return `${value.slice(2, 4)}/${value.slice(5, 7)}/${value.slice(8, 10)}`;
}

function downloadDateKey(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "latest";
  return `${value.slice(2, 4)}${value.slice(5, 7)}${value.slice(8, 10)}`;
}

function accountStatusLabel(value: AccountStatus | undefined) {
  return ACCOUNT_STATUS_LABELS[value ?? "active"];
}

function statusCategory(value: AccountStatus | undefined): StatusCategory {
  if (value === "active") return "active";
  if (value === "non_alt") return "nonAlt";
  return "ended";
}

function matchesStatusFilter(value: AccountStatus | undefined, selected: readonly StatusCategory[]) {
  return selected.includes(statusCategory(value));
}

function StatusFilter({ selected, onChange }: { selected: readonly StatusCategory[]; onChange: (next: StatusCategory[]) => void }) {
  const toggle = (category: StatusCategory) => {
    const next = selected.includes(category) ? selected.filter((value) => value !== category) : [...selected, category];
    onChange(next);
  };
  return <div className="status-filter" role="group" aria-label="活動状態で絞り込み"><span>活動状態</span>{(["active", "ended", "nonAlt"] as StatusCategory[]).map((category) => <button key={category} type="button" className={selected.includes(category) ? "is-active" : ""} aria-pressed={selected.includes(category)} onClick={() => toggle(category)}>{category === "active" ? "活動中" : category === "nonAlt" ? "非複垢" : "活動終了"}</button>)}<button type="button" className={selected.length === 3 ? "is-active" : ""} aria-pressed={selected.length === 3} onClick={() => onChange(["active", "ended", "nonAlt"])}>全て</button></div>;
}

function ChartStatusFilter({ selected, onChange }: { selected: readonly AccountStatus[]; onChange: (next: AccountStatus[]) => void }) {
  const toggle = (status: AccountStatus) => {
    const next = selected.includes(status) ? selected.filter((value) => value !== status) : [...selected, status];
    onChange(next);
  };
  const allSelected = selected.length === ACCOUNT_STATUSES.length;
  return <div className="chart-status-filter" role="group" aria-label="グラフに表示する活動状態"><span className="chart-status-filter-label">活動状態</span>{ACCOUNT_STATUSES.map((status) => { const isSelected = selected.includes(status); return <button key={status} type="button" className={isSelected ? "is-active" : ""} aria-pressed={isSelected} onClick={() => toggle(status)}><span>{ACCOUNT_STATUS_LABELS[status]}</span><small>{isSelected ? "ON" : "OFF"}</small></button>; })}<button type="button" className={allSelected ? "is-active" : ""} aria-pressed={allSelected} onClick={() => onChange([...ACCOUNT_STATUSES])}>全てON</button></div>;
}

function ChartSettingDisclosure({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const contentId = useId();
  return <section className={`chart-setting-disclosure ${isOpen ? "is-open" : ""}`}>
    <button type="button" className="chart-setting-disclosure-toggle" aria-label={`${title}を${isOpen ? "閉じる" : "開く"}`} aria-expanded={isOpen} aria-controls={contentId} onClick={() => setIsOpen((current) => !current)}>
      <span>{title}</span><span className="chart-setting-disclosure-detail">{detail}</span><span className="chart-setting-disclosure-icon" aria-hidden="true">{isOpen ? "▲" : "▼"}</span>
    </button>
    <div id={contentId} className="chart-setting-disclosure-content">{children}</div>
  </section>;
}

function formatResultNumber(value: number | null | undefined) {
  return value === null || value === undefined ? "-" : formatNumber(value);
}

function formatNormalMetricNumber(value: number | null | undefined) {
  return formatNumber(value ?? 0);
}

function formatResultDelta(value: number | null | undefined) {
  return value === null || value === undefined ? "-" : formatDelta(value);
}

function hasNonZeroFollowers(row: Pick<AccountRow, "followers"> | Pick<HistoryRow, "followers">) {
  return row.followers !== 0;
}

function deltaClass(value: number | null | undefined) {
  if (value === null || value === undefined) return "metric-delta-first";
  if (value > 0) return "metric-delta-positive";
  if (value < 0) return "metric-delta-negative";
  return "metric-delta-neutral";
}

function isNetworkFetchError(error: unknown) {
  return error instanceof TypeError && /fetch|network/i.test(error.message);
}

async function requestCollect(handles: string[]): Promise<CollectResponse> {
  let lastError: unknown;

  for (let attempt = 0; attempt < NETWORK_RETRY_COUNT; attempt += 1) {
    try {
      const response = await fetch(`${window.location.origin}/api/collect`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ handles }),
      });
      const payload = (await response.json().catch(() => ({}))) as CollectResponse;
      if (!response.ok) throw new Error(payload.error ?? `データ取得に失敗しました (${response.status})`);
      return payload;
    } catch (error) {
      lastError = error;
      if (!isNetworkFetchError(error) || attempt === NETWORK_RETRY_COUNT - 1) break;
      await new Promise((resolve) => window.setTimeout(resolve, NETWORK_RETRY_DELAY_MS));
    }
  }

  if (isNetworkFetchError(lastError)) {
    throw new Error("サーバーとの通信に失敗しました。少し待ってからもう一度お試しください。");
  }
  throw lastError instanceof Error ? lastError : new Error("データ取得に失敗しました");
}

function applyExportSheetFormatting(sheet: XLSX.WorkSheet, hideIdentityColumns: boolean) {
  if (!sheet["!ref"]) return;
  if (hideIdentityColumns) {
    const columns = [...((sheet["!cols"] as Array<Record<string, unknown>> | undefined) ?? [])];
    columns[0] = { ...(columns[0] ?? {}), hidden: true };
    columns[1] = { ...(columns[1] ?? {}), hidden: true };
    sheet["!cols"] = columns;
  }
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const gridBorder = {
    top: { style: "thin", color: { rgb: "FFB8C4D3" } },
    bottom: { style: "thin", color: { rgb: "FFB8C4D3" } },
    left: { style: "thin", color: { rgb: "FFB8C4D3" } },
    right: { style: "thin", color: { rgb: "FFB8C4D3" } },
  };
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      const cell = (sheet[address] ?? { t: "s", v: "" }) as XLSX.CellObject & { s?: { font?: Record<string, string | number>; [key: string]: unknown } };
      cell.s = { ...(cell.s ?? {}), font: { ...(cell.s?.font ?? {}), name: "游ゴシック", sz: 12, bold: false, italic: false }, border: gridBorder };
      sheet[address] = cell;
    }
  }
}

function TableHeader({ label, sortKey, deltaSortKey, activeKey, direction, onSort }: { label: string; sortKey: SortKey; deltaSortKey?: SortKey; activeKey: SortKey; direction: "asc" | "desc"; onSort: (key: SortKey) => void }) {
  const active = sortKey === activeKey;
  const deltaActive = deltaSortKey === activeKey;
  const mark = (key: SortKey, isActive: boolean) => isActive ? (direction === "asc" ? "↑" : "↓") : "↕";
  return (
    <th scope="col" aria-sort={active || deltaActive ? (direction === "asc" ? "ascending" : "descending") : "none"}>
      <div className="table-header-actions">
        <button className="table-sort" type="button" onClick={() => onSort(sortKey)} aria-label={`${label}の現在値で並べ替え`}>
          <span>{label}</span>
          <span className={`sort-mark ${active ? "is-active" : ""}`} aria-hidden="true">{mark(sortKey, active)}</span>
        </button>
        {deltaSortKey && <button className={`table-delta-sort ${deltaActive ? "is-active" : ""}`} type="button" onClick={() => onSort(deltaSortKey)} aria-label={`${label}の前回比で並べ替え`}>
          <span>前回比</span>
          <span className="sort-mark" aria-hidden="true">{mark(deltaSortKey, deltaActive)}</span>
        </button>}
      </div>
    </th>
  );
}

function MetricCell({ value }: { value: number | null }) {
  return <td className="numeric-cell metric-cell"><span className="metric-main">{formatNormalMetricNumber(value)}</span></td>;
}

function DeltaCell({ value }: { value: number | null | undefined }) {
  return <td className={`numeric-cell metric-delta-cell ${deltaClass(value)}`}><span className="metric-delta">{formatResultDelta(value)}</span></td>;
}

function AccountStatusBadge({ status }: { status: AccountStatus | undefined }) {
  return <span className={`account-status-badge account-status-${status ?? "active"}`}>{accountStatusLabel(status)}</span>;
}

function ResultsTable({ rows, onSort, sortKey, direction, previousByAccount, displayNameOverrides, onDisplayNameChange }: { rows: AccountRow[]; onSort: (key: SortKey) => void; sortKey: SortKey; direction: "asc" | "desc"; previousByAccount: Map<string, PreviousMetrics>; displayNameOverrides: Readonly<Record<string, string>>; onDisplayNameChange: (row: AccountRow, value: string) => void }) {
  if (!rows.length) return <div className="empty-table">まだ取得データがありません。上のフォームからアカウントを追加してください。</div>;
  return (
    <div className="results-display">
      <div className="results-mobile-sort">
        <label><span>並び替え</span><select value={sortKey} onChange={(event) => onSort(event.target.value as SortKey)} aria-label="取得結果の並び替え">
          <option value="handle">アカウント</option><option value="displayName">表示名</option><option value="followers">フォロワー</option><option value="followersDelta">フォロワー前回比</option><option value="following">フォロー</option><option value="posts">投稿</option><option value="postsDelta">投稿前回比</option><option value="joined">開設日</option>
        </select></label>
        <button type="button" className="secondary-button" onClick={() => onSort(sortKey)} aria-label={direction === "desc" ? "昇順で並べ替え" : "降順で並べ替え"}>{direction === "desc" ? "降順 ↓" : "昇順 ↑"}</button>
      </div>
      <div className="table-shell">
        <table className="results-table">
          <thead><tr>
            <TableHeader label="アカウント" sortKey="handle" activeKey={sortKey} direction={direction} onSort={onSort} />
            <TableHeader label="表示名" sortKey="displayName" activeKey={sortKey} direction={direction} onSort={onSort} />
            <TableHeader label="フォロワー" sortKey="followers" activeKey={sortKey} direction={direction} onSort={onSort} />
            <TableHeader label="前回比" sortKey="followersDelta" activeKey={sortKey} direction={direction} onSort={onSort} />
            <TableHeader label="フォロー" sortKey="following" activeKey={sortKey} direction={direction} onSort={onSort} />
            <TableHeader label="投稿" sortKey="posts" activeKey={sortKey} direction={direction} onSort={onSort} />
            <TableHeader label="前回比" sortKey="postsDelta" activeKey={sortKey} direction={direction} onSort={onSort} />
            <TableHeader label="開設日" sortKey="joined" activeKey={sortKey} direction={direction} onSort={onSort} />
          </tr></thead>
          <tbody>{rows.map((row) => (
            <tr key={row.id + "-" + row.handle} className={row.status === "error" ? "is-error" : ""}>
              <td>
                {row.status === "ok" ? <a className="account-link" href={"https://x.com/" + encodeURIComponent(row.handle)} target="_blank" rel="noreferrer">
                  {row.avatarUrl ? <img className="account-avatar" src={row.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="account-avatar account-avatar-fallback" aria-hidden="true">{row.handle.slice(0, 1).toUpperCase()}</span>}
                  <span className="handle-cell">@{row.handle}</span>
                </a> : <span className="account-link account-link-disabled"><span className="account-avatar account-avatar-fallback" aria-hidden="true">?</span><span className="handle-cell">@{row.handle}</span></span>}
                {row.status === "error" && <span className="status-pill status-error">失敗</span>}
              </td>
              <td><div className="display-name-cell"><input className="display-name-input" value={resolvedDisplayName(row, displayNameOverrides)} onChange={(event) => onDisplayNameChange(row, event.target.value)} aria-label={row.handle + "の表示名"} /><small>元の表示名：{row.displayName}</small><AccountStatusBadge status={row.accountStatus} /></div></td>
              <MetricCell value={row.followers} />
              <DeltaCell value={previousByAccount.get(row.id)?.followers} />
              <td className="numeric-cell">{formatNormalMetricNumber(row.following)}</td>
              <MetricCell value={row.posts} />
              <DeltaCell value={previousByAccount.get(row.id)?.posts} />
              <td>{row.status === "ok" ? formatDate(row.joined) : row.error ?? "—"}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="results-mobile-cards" role="list" aria-label="取得結果">
        {rows.map((row) => {
          const followersDelta = previousByAccount.get(row.id)?.followers;
          const postsDelta = previousByAccount.get(row.id)?.posts;
          return <article className={"results-mobile-card " + (row.status === "error" ? "is-error" : "")} role="listitem" key={row.id + "-mobile-" + row.handle}>
            <div className="results-mobile-identity">
              <div className="results-mobile-account">
                {row.status === "ok" ? <a className="account-link" href={"https://x.com/" + encodeURIComponent(row.handle)} target="_blank" rel="noreferrer">
                  {row.avatarUrl ? <img className="account-avatar" src={row.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="account-avatar account-avatar-fallback" aria-hidden="true">{row.handle.slice(0, 1).toUpperCase()}</span>}
                  <span className="handle-cell">@{row.handle}</span>
                </a> : <span className="account-link account-link-disabled"><span className="account-avatar account-avatar-fallback" aria-hidden="true">?</span><span className="handle-cell">@{row.handle}</span></span>}
                <AccountStatusBadge status={row.accountStatus} />
              </div>
              {row.status === "error" && <span className="status-pill status-error">失敗</span>}
            </div>
            <label className="results-mobile-name"><span>表示名</span><input value={resolvedDisplayName(row, displayNameOverrides)} onChange={(event) => onDisplayNameChange(row, event.target.value)} aria-label={row.handle + "の表示名"} /><small>元の表示名：{row.displayName}</small></label>
            {row.status === "ok" ? <div className="results-mobile-metrics">
              <div className="results-mobile-metric"><span>フォロワー</span><strong>{formatResultNumber(row.followers)}</strong><small className={deltaClass(followersDelta)}>前回比 {formatResultDelta(followersDelta)}</small></div>
              <div className="results-mobile-metric"><span>フォロー</span><strong>{formatResultNumber(row.following)}</strong></div>
              <div className="results-mobile-metric"><span>投稿</span><strong>{formatResultNumber(row.posts)}</strong><small className={deltaClass(postsDelta)}>前回比 {formatResultDelta(postsDelta)}</small></div>
            </div> : <p className="results-mobile-error">{row.error ?? "取得できませんでした"}</p>}
            <div className="results-mobile-date"><span>開設日</span><strong>{row.status === "ok" ? formatDate(row.joined) : "—"}</strong></div>
          </article>;
        })}
      </div>
    </div>
  );
}

function CompactResults({ rows, previousByAccount, displayNameOverrides }: { rows: AccountRow[]; previousByAccount: Map<string, PreviousMetrics>; displayNameOverrides: Readonly<Record<string, string>> }) {
  if (!rows.length) return <div className="empty-table">まだ取得データがありません。上のフォームからアカウントを追加してください。</div>;
  return <div className="compact-results-grid">{rows.map((row) => {
    const displayName = resolvedDisplayName(row, displayNameOverrides);
    return <article className={`compact-result-card ${row.status === "error" ? "is-error" : ""}`} key={`${row.id}-${row.handle}`}>
      <div className="compact-account-cell"><a className="account-link" href={row.status === "ok" ? `https://x.com/${encodeURIComponent(row.handle)}` : undefined} target={row.status === "ok" ? "_blank" : undefined} rel={row.status === "ok" ? "noreferrer" : undefined}>
        {row.avatarUrl ? <img className="account-avatar" src={row.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="account-avatar account-avatar-fallback" aria-hidden="true">{row.handle.slice(0, 1).toUpperCase()}</span>}
        <span className="compact-account-copy"><strong className="handle-cell">{displayName}</strong><small>@{row.handle}</small><AccountStatusBadge status={row.accountStatus} /></span>
      </a></div>
      {row.status === "ok" ? <><div className="compact-value-cell"><small>フォロワー</small><strong>{formatResultNumber(row.followers)}</strong><em className={deltaClass(previousByAccount.get(row.id)?.followers)}>{formatResultDelta(previousByAccount.get(row.id)?.followers)}</em></div><div className="compact-value-cell"><small>フォロー</small><strong>{formatResultNumber(row.following)}</strong></div><div className="compact-value-cell"><small>投稿</small><strong>{formatResultNumber(row.posts)}</strong><em className={deltaClass(previousByAccount.get(row.id)?.posts)}>{formatResultDelta(previousByAccount.get(row.id)?.posts)}</em></div></> : <p className="compact-error-copy">{row.error ?? "取得できませんでした"}</p>}
    </article>;
  })}</div>;
}

function topMetricBase(metric: TopMetric): MetricKey {
  if (metric.includes("followers")) return "followers";
  if (metric.includes("following")) return "following";
  return "posts";
}

function isTopDeltaMetric(metric: TopMetric) {
  return metric.endsWith("Delta");
}

function topMetricValue(row: AccountRow, metric: TopMetric, previousByAccount: Map<string, PreviousMetrics>) {
  if (metric === "followersDelta") return previousByAccount.get(row.id)?.followers ?? null;
  if (metric === "followingDelta") return previousByAccount.get(row.id)?.following ?? null;
  if (metric === "postsDelta") return previousByAccount.get(row.id)?.posts ?? null;
  if (metric === "postsPerFollower") return row.posts !== null && row.posts !== undefined && row.posts > 0 && row.followers !== null && row.followers !== undefined && row.followers > 0 ? row.posts / row.followers : null;
  return row[topMetricBase(metric)];
}

function formatTopMetricValue(row: AccountRow, metric: TopMetric, previousByAccount: Map<string, PreviousMetrics>) {
  const value = topMetricValue(row, metric, previousByAccount);
  if (metric === "postsPerFollower") return formatRatio(row.posts, row.followers);
  return isTopDeltaMetric(metric) ? formatDelta(value) : formatNumber(value);
}

function rankTopRows(rows: AccountRow[], metric: TopMetric, previousByAccount: Map<string, PreviousMetrics>) {
  return rows
    .filter((row) => row.status === "ok" && topMetricValue(row, metric, previousByAccount) !== null && topMetricValue(row, metric, previousByAccount) !== undefined)
    .sort((left, right) => {
      const leftValue = topMetricValue(left, metric, previousByAccount) ?? (metric === "postsPerFollower" ? Infinity : -Infinity);
      const rightValue = topMetricValue(right, metric, previousByAccount) ?? (metric === "postsPerFollower" ? Infinity : -Infinity);
      return metric === "postsPerFollower" ? leftValue - rightValue : rightValue - leftValue;
    });
}

function DateCalendar({ availableDates, selectedDate, onDateChange, note = "黄緑色の日はデータあり", headingLabel = "表示日", size = "normal" }: { availableDates: string[]; selectedDate: string; onDateChange: (date: string) => void; note?: string; headingLabel?: string; size?: "normal" | "small" }) {
  const availableDateSet = new Set(availableDates);
  const pickerClass = size === "small" ? " top15-date-picker-small" : "";
  const [calendarMonth, setCalendarMonth] = useState(selectedDate ? selectedDate.slice(0, 7) : new Date().toISOString().slice(0, 7));
  const monthStart = new Date(`${calendarMonth}-01T00:00:00Z`);
  const firstWeekday = monthStart.getUTCDay();
  const daysInMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)).getUTCDate();
  const minDate = availableDates[0] ?? "";
  const maxDate = availableDates.at(-1) ?? "";
  const calendarLabel = calendarMonth.length === 7 ? `${calendarMonth.slice(0, 4)}年${calendarMonth.slice(5, 7)}月` : calendarMonth;
  const calendarCells = Array.from({ length: Math.ceil((firstWeekday + daysInMonth) / 7) * 7 }, (_, index) => {
    const day = index - firstWeekday + 1;
    if (day < 1 || day > daysInMonth) return null;
    return `${calendarMonth}-${String(day).padStart(2, "0")}`;
  });
  if (!availableDates.length) return null;
  return <div className={`top15-date-picker${pickerClass}`}><div className="top15-date-picker-heading"><strong>{headingLabel}：{selectedDate || "—"}</strong><span>{note}</span></div><div className="top15-calendar-nav"><button type="button" className="secondary-button" onClick={() => setCalendarMonth(shiftDateKey(`${calendarMonth}-01`, -1).slice(0, 7))} aria-label="前の月">‹</button><strong>{calendarLabel}</strong><button type="button" className="secondary-button" onClick={() => setCalendarMonth(shiftDateKey(`${calendarMonth}-01`, 32).slice(0, 7))} aria-label="次の月">›</button></div><div className="top15-calendar-weekdays">{["日", "月", "火", "水", "木", "金", "土"].map((day) => <span key={day}>{day}</span>)}</div><div className="top15-calendar-grid">{calendarCells.map((date, index) => date ? <button key={date} type="button" className={`top15-calendar-day ${availableDateSet.has(date) ? "has-data" : ""} ${selectedDate === date ? "is-selected" : ""}`} disabled={Boolean(minDate && maxDate && (date < minDate || date > maxDate))} onClick={() => onDateChange(date)} aria-label={`${date}${availableDateSet.has(date) ? " データあり" : " データなし"}`}>{Number(date.slice(-2))}</button> : <span key={`blank-${index}`} className="top15-calendar-blank" />)}</div></div>;
}

function TopResults({ rows, topMetric, onTopMetricChange, previousByAccount, displayNameOverrides, onDownloadImage, availableDates, selectedDate, onDateChange, comparisonTargetDate, onComparisonDateChange, expanded, onToggleExpanded }: { rows: AccountRow[]; topMetric: TopMetric; onTopMetricChange: (metric: TopMetric) => void; previousByAccount: Map<string, PreviousMetrics>; displayNameOverrides: Readonly<Record<string, string>>; onDownloadImage: () => void | Promise<void>; availableDates: string[]; selectedDate: string; onDateChange: (date: string) => void; comparisonTargetDate: string; onComparisonDateChange: (value: string) => void; expanded: boolean; onToggleExpanded: () => void }) {
  const hasRowsForDate = rows.some((row) => row.status === "ok");
  const rankedRows = rankTopRows(rows, topMetric, previousByAccount);
  const topRows = rankedRows.slice(0, 15);
  const extraRows = rankedRows.slice(15);
  const comparisonDates = availableDates.filter((date) => date < selectedDate);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const handleSelectedDateChange = (date: string) => {
    onDateChange(date);
    if (comparisonTargetDate > date) {
      const fallback = comparisonDates.filter((candidate) => candidate <= date).at(-1) ?? "";
      onComparisonDateChange(fallback);
    }
  };
  const renderCalendars = (closeAfterSelection: boolean) => {
    const afterSelection = (onSelect: (date: string) => void) => (date: string) => {
      onSelect(date);
      if (closeAfterSelection) setCalendarOpen(false);
    };
    return isTopDeltaMetric(topMetric)
      ? <div className="top15-calendar-pair"><DateCalendar key={`comparison-${comparisonTargetDate}`} headingLabel="開始日" size="small" availableDates={comparisonDates} selectedDate={comparisonTargetDate} onDateChange={afterSelection(onComparisonDateChange)} /><DateCalendar key={`selected-${selectedDate}`} headingLabel="終了日" size="small" availableDates={availableDates} selectedDate={selectedDate} onDateChange={afterSelection(handleSelectedDateChange)} /></div>
      : <DateCalendar key={selectedDate} size="small" availableDates={availableDates} selectedDate={selectedDate} onDateChange={afterSelection(onDateChange)} />;
  };
  const calendarSummary = isTopDeltaMetric(topMetric) ? `開始 ${comparisonTargetDate || "—"} ／ 終了 ${selectedDate || "—"}` : `表示日 ${selectedDate || "—"}`;
  return <div className="top15-panel">
    <div className="top15-toolbar results-ranking-toolbar"><div className="top15-metric-tabs ranking-metric-tabs" role="tablist" aria-label="ランキング指標" onKeyDown={(event) => handleTabListKeyDown(event, Object.keys(topMetricLabels) as TopMetric[], onTopMetricChange)}>{(Object.keys(topMetricLabels) as TopMetric[]).map((metric) => <button key={metric} id={"ranking-metric-tab-" + metric} type="button" role="tab" aria-selected={topMetric === metric} aria-controls={"ranking-metric-panel-" + metric} tabIndex={topMetric === metric ? 0 : -1} className={topMetric === metric ? "is-active" : ""} onClick={() => onTopMetricChange(metric)}>{topMetricLabels[metric]}</button>)}</div><button type="button" className="secondary-button ranking-export-button" onClick={() => void onDownloadImage()} disabled={!topRows.length}>画像を保存</button></div>
    <div className="ranking-metric-panel" id={"ranking-metric-panel-" + topMetric} role="tabpanel" aria-labelledby={"ranking-metric-tab-" + topMetric} tabIndex={0}>
    <div className={`top15-layout ${isTopDeltaMetric(topMetric) ? "top15-layout-delta" : "top15-layout-scalar"}`}>
      <div className="top15-date-column ranking-date-controls"><div className="top15-date-desktop">{renderCalendars(false)}</div><details className="top15-date-mobile" open={calendarOpen} onToggle={(event) => setCalendarOpen(event.currentTarget.open)}><summary><span>日付を選択</span><small>{calendarSummary}</small></summary><div className="top15-date-mobile-content">{renderCalendars(true)}</div></details></div>
    </div>
    {topRows.length ? <><div className="top15-grid">{topRows.map((row, index) => {
      const value = topMetricValue(row, topMetric, previousByAccount);
      const displayName = resolvedDisplayName(row, displayNameOverrides);
      return <article className={`top15-card top15-rank-${index + 1}`} key={row.id}><span className="top15-rank">{String(index + 1).padStart(2, "0")}</span><a href={`https://x.com/${encodeURIComponent(row.handle)}`} target="_blank" rel="noreferrer" className="top15-account" aria-label={`${displayName} @${row.handle}`}>{row.avatarUrl ? <img className="top15-avatar" src={row.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="top15-avatar top15-avatar-fallback">{row.handle.slice(0, 1).toUpperCase()}</span>}<span><strong>{displayName}</strong></span></a><strong className={`top15-value ${value !== null && value < 0 ? "is-negative" : ""}`}>{formatTopMetricValue(row, topMetric, previousByAccount)}</strong></article>;
    })}</div>{expanded && extraRows.length > 0 && <div className="top15-expanded-grid">{extraRows.map((row, extraIndex) => { const rank = extraIndex + 16; const displayName = resolvedDisplayName(row, displayNameOverrides); const value = topMetricValue(row, topMetric, previousByAccount); return <article className="top15-card" key={row.id}><span className="top15-rank">{String(rank).padStart(2, "0")}</span><a href={`https://x.com/${encodeURIComponent(row.handle)}`} target="_blank" rel="noreferrer" className="top15-account" aria-label={`${displayName} @${row.handle}`}>{row.avatarUrl ? <img className="top15-avatar" src={row.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="top15-avatar top15-avatar-fallback">{row.handle.slice(0, 1).toUpperCase()}</span>}<span><strong>{displayName}</strong></span></a><strong className={`top15-value ${value !== null && value < 0 ? "is-negative" : ""}`}>{formatTopMetricValue(row, topMetric, previousByAccount)}</strong></article>; })}</div>}{extraRows.length > 0 && <button type="button" className="secondary-button top15-expand-button" onClick={onToggleExpanded}>{expanded ? "16位以下を非表示" : "16位以下を表示"}</button>}</> : <div className="empty-table">{!hasRowsForDate ? (selectedDate ? `${selectedDate}はデータがないため表示できません。` : "ランキングを表示できる取得データがありません。") : isTopDeltaMetric(topMetric) ? `${selectedDate}は比較対象のデータがありません。` : `${selectedDate}は表示できる数値がありません。`}</div>}
    {(Object.keys(topMetricLabels) as TopMetric[]).filter((item) => item !== topMetric).map((item) => <div key={item} id={"ranking-metric-panel-" + item} role="tabpanel" aria-labelledby={"ranking-metric-tab-" + item} hidden />)}
    </div>
  </div>;
}

function bucketKey(value: string, granularity: Granularity) {
  const parts = chartDateParts(value);
  if (!parts) return value;
  const date = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
  if (granularity === "month") return `${parts.year}-${parts.month}-01`;
  if (granularity === "week") {
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - mondayOffset);
  }
  return date.toISOString().slice(0, 10);
}

function chartDateParts(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(chartDatePartFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  return { year: parts.year, month: parts.month, day: parts.day };
}

function buildDailyChartRows(rows: HistoryRow[]) {
  type Candidate = { fetchedAt: number; distance: number; value: number };
  type Aggregate = {
    date: string;
    accountId: string;
    handle: string;
    displayName: string;
    avatarUrl: string | null;
    accountStatus: AccountStatus;
    joined: string | null;
    latestFetchedAt: number;
    values: Record<MetricKey, Candidate | null>;
  };
  const aggregates = new Map<string, Aggregate>();
  for (const row of rows) {
    const date = dailyRecordDate(row.fetched_at);
    const fetchedAt = new Date(row.fetched_at).getTime();
    if (!date || !Number.isFinite(fetchedAt)) continue;
    const boundary = new Date(`${date}T00:00:00+09:00`).getTime();
    const distance = Math.max(0, boundary - fetchedAt);
    const key = `${row.account_id}|${date}`;
    const aggregate = aggregates.get(key) ?? {
      date,
      accountId: row.account_id,
      handle: row.handle,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      accountStatus: row.account_status,
      joined: row.joined,
      latestFetchedAt: -Infinity,
      values: { followers: null, following: null, posts: null },
    };
    for (const metric of ["followers", "following", "posts"] as const) {
      const value = row[metric];
      if (value === null || value === undefined) continue;
      const current = aggregate.values[metric];
      if (!current || distance < current.distance || (distance === current.distance && fetchedAt >= current.fetchedAt)) aggregate.values[metric] = { fetchedAt, distance, value };
    }
    if (fetchedAt >= aggregate.latestFetchedAt) {
      aggregate.handle = row.handle;
      aggregate.displayName = row.display_name;
      aggregate.avatarUrl = row.avatar_url;
      aggregate.accountStatus = row.account_status;
      aggregate.joined = row.joined;
      aggregate.latestFetchedAt = fetchedAt;
    }
    aggregates.set(key, aggregate);
  }
  return [...aggregates.values()]
    .filter((row) => Object.values(row.values).some((value) => value !== null))
    .map((row) => ({
      id: `daily-chart:${encodeURIComponent(row.accountId)}:${row.date}`,
      run_id: `daily-record:${row.date}`,
      fetched_at: canonicalDailyFetchedAt(row.date),
      account_id: row.accountId,
      handle: row.handle,
      display_name: row.displayName,
      followers: row.values.followers?.value ?? null,
      following: row.values.following?.value ?? null,
      posts: row.values.posts?.value ?? null,
      avatar_url: row.avatarUrl,
      account_status: row.accountStatus,
      joined: row.joined,
    }))
    .sort((left, right) => left.fetched_at.localeCompare(right.fetched_at) || left.handle.localeCompare(right.handle, "ja"));
}

function chartDateLabel(value: string, format: "short" | "month" | "full") {
  if (format === "month") {
    const parts = chartDateParts(`${value}T00:00:00Z`);
    return parts ? `${parts.year}/${Number(parts.month)}` : value;
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return chartDateLabelFormatters[format].format(date);
}

function shiftDateKey(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function availableHistoryDates(rows: HistoryRow[], metric: MetricKey | "any", selected: readonly StatusCategory[]) {
  return [...new Set(rows.filter((row) => matchesStatusFilter(row.account_status, selected) && (metric === "any" ? row.followers !== null || row.following !== null || row.posts !== null : row[metric] !== null && row[metric] !== undefined)).map((row) => chartDateParts(row.fetched_at)).filter((parts): parts is { year: string; month: string; day: string } => Boolean(parts)).map((parts) => `${parts.year}-${parts.month}-${parts.day}`))].sort();
}

function chartMetricBase(metric: ChartMetric): MetricKey {
  if (metric === "postsPerFollower") return "posts";
  if (metric === "followersCumulativeDelta") return "followers";
  return metric.replace("Delta", "") as MetricKey;
}

function isChartDeltaMetric(metric: ChartMetric) {
  return metric.endsWith("Delta") && metric !== "followersCumulativeDelta";
}

function chartMetricValue(row: Pick<HistoryRow, "followers" | "following" | "posts">, metric: ChartMetric) {
  if (metric === "postsPerFollower") {
    return row.posts !== null && row.posts !== undefined && row.followers !== null && row.followers !== undefined && row.posts > 0 && row.followers > 0 ? row.posts / row.followers : null;
  }
  if (metric === "followersCumulativeDelta") return null;
  const value = row[chartMetricBase(metric)];
  return value === null || value === undefined || !Number.isFinite(value) ? null : value;
}

function hasChartMetricValue(row: Pick<HistoryRow, "followers" | "following" | "posts">, metric: ChartMetric) {
  return chartMetricValue(row, metric) !== null;
}

function formatChartValue(value: number, metric: ChartMetric, compact = false) {
  return metric === "postsPerFollower" ? value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "") : formatNumber(value, compact);
}

type ChartPoint = { key: string; values: Record<string, number>; timestamps: Record<string, number>; timestamp: number };

function buildCumulativeFollowerPoints(historyRows: HistoryRow[], selectedHandles: readonly string[], startDate: string, endDate: string, granularity: Granularity): ChartPoint[] {
  const selected = new Set(selectedHandles);
  const dailyValues = new Map<string, Map<string, number>>();
  const availableDates: string[] = [];
  for (const row of historyRows) {
    const parts = chartDateParts(row.fetched_at);
    const handle = row.handle.toLowerCase();
    if (!parts || !selected.has(handle) || row.followers === null || row.followers === undefined || !Number.isFinite(row.followers)) continue;
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    availableDates.push(date);
    const byHandle = dailyValues.get(date) ?? new Map<string, number>();
    const current = byHandle.get(handle);
    if (current === undefined || new Date(row.fetched_at).getTime() >= new Date(`${date}T00:00:00+09:00`).getTime()) byHandle.set(handle, row.followers);
    dailyValues.set(date, byHandle);
  }
  const firstDate = startDate || [...new Set(availableDates)].sort()[0] || "";
  const lastDate = endDate || [...new Set(availableDates)].sort().at(-1) || firstDate;
  if (!firstDate || !lastDate || firstDate > lastDate) return [];
  const cumulative = new Map<string, number>(selectedHandles.map((handle) => [handle, 0]));
  const previous = new Map<string, number>();
  const dailyPoints: ChartPoint[] = [];
  let date = firstDate;
  let guard = 0;
  while (date <= lastDate && guard < 10000) {
    const byHandle = dailyValues.get(date);
    const values: Record<string, number> = {};
    for (const handle of selectedHandles) {
      const current = byHandle?.get(handle);
      let delta = 0;
      if (current !== undefined) {
        const previousValue = previous.get(handle);
        if (previousValue !== undefined) delta = current - previousValue;
        previous.set(handle, current);
      }
      const next = (cumulative.get(handle) ?? 0) + delta;
      cumulative.set(handle, next);
      values[handle] = next;
    }
    dailyPoints.push({ key: date, values, timestamps: {}, timestamp: new Date(`${date}T00:00:00Z`).getTime() });
    date = shiftDateKey(date, 1);
    guard += 1;
  }
  if (granularity === "day") return dailyPoints;
  const buckets = new Map<string, ChartPoint>();
  for (const point of dailyPoints) {
    const key = bucketKey(point.key, granularity);
    const bucket = buckets.get(key) ?? { key, values: {}, timestamps: {}, timestamp: point.timestamp };
    bucket.values = { ...point.values };
    bucket.timestamp = point.timestamp;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((left, right) => left.timestamp - right.timestamp);
}

const SimpleChart = memo(function SimpleChart({ mode, metric, chartTitle, chartTitleFontSize, currentRows, historyRows, selectedHandles, compareDate, comparisonDate, startDate, endDate, granularity, dateFormat, yMin, yMax, yStep, yMinorStep, compactNumbers, compareOrientation, displayNameOverrides, legendColors, barColor, trendLineWidth, markerSize, markerOutlineWidth, markerOutlineColor, trendValueFontSize, trendAxisFontSize, trendDateFontSize, trendValueLabelColor, compareLabelFontSize, theme, showTrendLegend, logScale, onLogScaleEligibilityChange, onExportReady }: { mode: ChartMode; metric: ChartMetric; chartTitle: string; chartTitleFontSize: number; currentRows: AccountRow[]; historyRows: HistoryRow[]; selectedHandles: string[]; compareDate: string; comparisonDate: string; startDate: string; endDate: string; granularity: Granularity; dateFormat: "short" | "month" | "full"; yMin: string; yMax: string; yStep: string; yMinorStep: string; compactNumbers: boolean; compareOrientation: CompareOrientation; displayNameOverrides: Readonly<Record<string, string>>; legendColors: Readonly<Record<string, string>>; barColor: string; trendLineWidth: number; markerSize: number; markerOutlineWidth: number; markerOutlineColor: string; trendValueFontSize: number; trendAxisFontSize: number; trendDateFontSize: number; trendValueLabelColor: "series" | "black"; compareLabelFontSize: number; theme: Theme; showTrendLegend: boolean; logScale: boolean; onLogScaleEligibilityChange: (eligible: boolean) => void; onExportReady: (handler: () => Promise<void>) => void }) {
  const valueMetric = metric === "followersCumulativeDelta" ? "followers" : metric;
  const goodRows = useMemo(() => currentRows.filter((row) => row.status === "ok" && hasChartMetricValue(row, valueMetric)), [currentRows, valueMetric]);
  const accountMeta = useMemo(() => {
    const accounts = new Map<string, AccountRow | HistoryRow>();
    for (const row of goodRows) accounts.set(row.handle.toLowerCase(), row);
    for (const row of historyRows) if (hasChartMetricValue(row, valueMetric) && !accounts.has(row.handle.toLowerCase())) accounts.set(row.handle.toLowerCase(), row);
    return accounts;
  }, [goodRows, historyRows, valueMetric]);
  const displayNameByHandle = useMemo(() => {
    const names = new Map<string, string>();
    for (const [handle, row] of accountMeta) names.set(handle, resolvedDisplayName(row, displayNameOverrides));
    return names;
  }, [accountMeta, displayNameOverrides]);
  const availableDates = useMemo(() => [...new Set(historyRows.map((row) => {
    const parts = chartDateParts(row.fetched_at);
    return parts ? `${parts.year}-${parts.month}-${parts.day}` : null;
  }).filter((value): value is string => Boolean(value)))].sort(), [historyRows]);
  const selectedCompareDate = compareDate || availableDates.at(-1) || "";

  const rowsForDate = useCallback((date: string) => {
    const output = new Map<string, HistoryRow>();
    if (!date) return output;
    const start = new Date(`${date}T00:00:00+09:00`).getTime();
    const end = new Date(`${date}T23:59:59.999+09:00`).getTime();
    const selected = new Set(selectedHandles);
    for (const row of historyRows) {
      const handle = row.handle.toLowerCase();
      const time = new Date(row.fetched_at).getTime();
      if (!selected.has(handle) || time < start || time > end || chartMetricValue(row, metric) === null) continue;
      const current = output.get(handle);
      if (!current || time > new Date(current.fetched_at).getTime()) output.set(handle, row);
    }
    return output;
  }, [historyRows, metric, selectedHandles]);
  const compareHistory = useMemo(() => rowsForDate(selectedCompareDate), [rowsForDate, selectedCompareDate]);
  const comparisonHistory = useMemo(() => isChartDeltaMetric(metric) ? rowsForDate(comparisonDate) : new Map<string, HistoryRow>(), [comparisonDate, metric, rowsForDate]);
  const filteredHistory = useMemo(() => {
    const selected = new Set(selectedHandles);
    const start = startDate ? new Date(`${startDate}T00:00:00+09:00`).getTime() : -Infinity;
    const end = endDate ? new Date(`${endDate}T23:59:59+09:00`).getTime() : Infinity;
    return historyRows.filter((row) => {
      if (!selected.has(row.handle.toLowerCase())) return false;
      const time = new Date(row.fetched_at).getTime();
      return time >= start && time <= end && chartMetricValue(row, metric) !== null;
    });
  }, [endDate, historyRows, metric, selectedHandles, startDate]);

  const points = useMemo(() => {
    if (metric === "followersCumulativeDelta") return buildCumulativeFollowerPoints(historyRows, selectedHandles, startDate, endDate, granularity);
    const map = new Map<string, ChartPoint>();
    for (const row of filteredHistory) {
      const key = bucketKey(row.fetched_at, granularity);
      const handle = row.handle.toLowerCase();
      const time = new Date(row.fetched_at).getTime();
      const item = map.get(key) ?? { key, values: {}, timestamps: {}, timestamp: time };
      const value = chartMetricValue(row, metric);
      if (value !== null && (item.timestamps[handle] === undefined || time >= item.timestamps[handle])) {
        item.values[handle] = value;
        item.timestamps[handle] = time;
      }
      item.timestamp = Math.max(item.timestamp, time);
      map.set(key, item);
    }
    return [...map.values()].sort((a, b) => a.timestamp - b.timestamp);
  }, [endDate, filteredHistory, granularity, historyRows, metric, selectedHandles, startDate]);

  const chartRows = useMemo(() => [...compareHistory.entries()].map(([handle, row]) => {
    const displayValue = chartMetricValue(row, metric);
    const comparisonValue = comparisonHistory.get(handle) ? chartMetricValue(comparisonHistory.get(handle)!, metric) : null;
    const value = isChartDeltaMetric(metric) && comparisonValue !== null && displayValue !== null ? displayValue - comparisonValue : isChartDeltaMetric(metric) ? null : displayValue;
    return { row, value };
  }).filter((entry): entry is { row: HistoryRow; value: number } => entry.value !== null && Number.isFinite(entry.value)).sort((a, b) => b.value - a.value), [comparisonHistory, compareHistory, metric]);
  const chartDataRows = useMemo(() => {
    if (mode === "compare") {
      return chartRows.map(({ row, value }) => ({
        key: "compare|" + row.account_id + "|" + row.fetched_at,
        date: isChartDeltaMetric(metric) ? (comparisonDate ? chartDateLabel(comparisonDate, "full") : "—") + " → " + (selectedCompareDate ? chartDateLabel(selectedCompareDate, "full") : "—") : selectedCompareDate ? chartDateLabel(selectedCompareDate, "full") : "—",
        displayName: displayNameByHandle.get(row.handle.toLowerCase()) ?? resolvedDisplayName(row, displayNameOverrides),
        handle: row.handle,
        value,
      }));
    }
    return points.flatMap((point) => selectedHandles.flatMap((handle) => {
      const value = point.values[handle];
      if (typeof value !== "number" || !Number.isFinite(value)) return [];
      return [{
        key: "trend|" + handle + "|" + point.key,
        date: chartDateLabel(point.key, "full"),
        displayName: displayNameByHandle.get(handle) ?? "@" + handle,
        handle,
        value,
      }];
    }));
  }, [chartRows, comparisonDate, displayNameByHandle, displayNameOverrides, metric, mode, points, selectedCompareDate, selectedHandles]);
  const values = mode === "compare" ? chartRows.map((entry) => entry.value) : points.flatMap((point) => Object.values(point.values));
  const finiteValues = values.filter((value) => Number.isFinite(value));
  const logScaleEligible = finiteValues.length > 0 && finiteValues.every((value) => value > 0);
  const effectiveLogScale = logScale && logScaleEligible;
  useEffect(() => {
    onLogScaleEligibilityChange(logScaleEligible);
  }, [logScaleEligible, onLogScaleEligibilityChange]);

  const baseline = metric === "postsPerFollower" ? 1 : 0;
  const parsedMin = yMin && Number.isFinite(Number(yMin)) ? Number(yMin) : null;
  const parsedMax = yMax && Number.isFinite(Number(yMax)) ? Number(yMax) : null;
  const { lower: linearLower, upper: linearUpper } = resolveLinearAxisDomain({ baseline, values: finiteValues, min: parsedMin, max: parsedMax });
  const positiveMin = finiteValues.length ? Math.min(...finiteValues.filter((value) => value > 0)) : 1;
  const lower = effectiveLogScale ? Math.max(1e-9, parsedMin ?? positiveMin) : linearLower;
  const upper = effectiveLogScale ? Math.max(lower * 10, parsedMax ?? Math.max(...finiteValues, lower)) : linearUpper;
  const transformValue = (value: number) => effectiveLogScale ? Math.log10(Math.max(value, 1e-9)) : value;
  const transformedLower = transformValue(lower);
  const transformedUpper = transformValue(upper);
  const normalize = (value: number) => (transformValue(value) - transformedLower) / Math.max(1e-9, transformedUpper - transformedLower);
  const makeLinearTicks = (stepValue: string, fallbackCount: number) => {
    const step = Number(stepValue);
    if (step > 0) {
      const output: number[] = [];
      for (let tick = Math.ceil(lower / step) * step; tick <= upper && output.length < 200; tick += step) output.push(Number(tick.toFixed(10)));
      if (!output.length || Math.abs(output.at(-1)! - upper) > Math.max(0.000001, step / 1000)) output.push(upper);
      return output.length ? output : [lower, upper];
    }
    return Array.from({ length: Math.max(2, fallbackCount) }, (_, index) => lower + ((upper - lower) * index) / (Math.max(2, fallbackCount) - 1));
  };
  const makeLogTicks = (minor: boolean) => {
    const output: number[] = [];
    const startExponent = Math.floor(Math.log10(lower));
    const endExponent = Math.ceil(Math.log10(upper));
    for (let exponent = startExponent; exponent <= endExponent && output.length < 200; exponent += 1) {
      for (const multiplier of minor ? [2, 3, 4, 5, 6, 7, 8, 9] : [1]) {
        const value = multiplier * (10 ** exponent);
        if (value > lower && value < upper) output.push(value);
      }
    }
    return [...new Set([lower, ...output, upper])].sort((left, right) => left - right);
  };
  const majorTicks = effectiveLogScale ? makeLogTicks(false) : makeLinearTicks(yStep, mode === "compare" ? 17 : 19);
  const minorTicks = effectiveLogScale ? makeLogTicks(true).filter((tick) => !majorTicks.some((major) => Math.abs(Math.log10(major) - Math.log10(tick)) < 0.000001)) : (() => {
    const defaultMinorStep = majorTicks.length > 1 ? (majorTicks[1] - majorTicks[0]) / 5 : (upper - lower) / 25;
    const minorStepValue = Number(yMinorStep) > 0 ? Number(yMinorStep) : defaultMinorStep;
    return makeLinearTicks(String(minorStepValue), Math.min(200, Math.max(2, Math.round((upper - lower) / minorStepValue) + 1))).filter((tick) => !majorTicks.some((major) => Math.abs(major - tick) < Math.max(0.000001, minorStepValue / 1000)));
  })();
  const width = 900;
  const denseRowChart = mode === "compare" && compareOrientation === "row" && chartRows.length > 10;
  const rowChartHeight = denseRowChart ? Math.min(500, Math.max(260, chartRows.length * 3 + 220)) : Math.max(500, chartRows.length * 24 + 70);
  const trendLegendEntries = mode === "trend" && showTrendLegend ? selectedHandles.filter((handle) => points.some((point) => typeof point.values[handle] === "number")).map((handle, index) => ({ handle, displayName: displayNameByHandle.get(handle) ?? `@${handle}`, color: legendColors[handle] ?? defaultLegendColor(index) })) : [];
  const trendLegendLayout = layoutTrendLegend(trendLegendEntries, 900 - 66 - 28);
  const trendLegendHeight = trendLegendLayout.height;
  const trendBaseHeight = 560;
  const height = mode === "trend" ? trendBaseHeight + trendLegendHeight : compareOrientation === "row" ? rowChartHeight : 590;
  const left = mode === "compare" && compareOrientation === "row" ? 164 : 66;
  const top = 24;
  const right = 28;
  const bottom = mode === "compare" && compareOrientation === "row" ? 34 : mode === "trend" ? 104 : 116;
  const plotWidth = width - left - right;
  const plotTop = top;
  const plotHeight = (mode === "trend" ? trendBaseHeight : height) - plotTop - bottom;
  const scaleY = (value: number) => plotTop + plotHeight - normalize(value) * plotHeight;
  const scaleX = (value: number) => left + normalize(value) * plotWidth;
  const trendPointTimes = points.map((point) => new Date(`${point.key}T00:00:00Z`).getTime());
  const trendStart = trendPointTimes[0] ?? 0;
  const trendEnd = trendPointTimes.at(-1) ?? trendStart;
  const trendRange = trendEnd - trendStart;
  const xPosition = (index: number) => mode === "trend" && trendRange > 0 ? left + ((trendPointTimes[index] - trendStart) / trendRange) * plotWidth : left + plotWidth / 2;
  const trendLabelIndexes = (() => {
    if (mode !== "trend") return [] as number[];
    if (dateFormat === "month") {
      const months = new Set<string>();
      return points.flatMap((point, index) => {
        const month = point.key.slice(0, 7);
        if (months.has(month)) return [];
        months.add(month);
        return [index];
      });
    }
    const minimumGap = Math.max(10, trendDateFontSize * (dateFormat === "full" ? 4.6 : 2.2) + 4);
    const indexes: number[] = [];
    let lastX = -Infinity;
    points.forEach((_, index) => {
      const x = xPosition(index);
      if (index === 0 || index === points.length - 1 || x - lastX >= minimumGap) {
        indexes.push(index);
        lastX = x;
      }
    });
    if (indexes.length > 1 && xPosition(indexes.at(-1)!) - xPosition(indexes.at(-2)!) < minimumGap) indexes.splice(indexes.length - 2, 1);
    return indexes;
  })();
  const trendLabelY = plotTop + plotHeight + 15;
  const trendLegendTop = dateFormat === "full" ? trendBaseHeight + 6 : trendLabelY + 32;
  const chartRef = useRef<HTMLDivElement>(null);
  const plotClipId = useId().replaceAll(":", "");
  const [tooltip, setTooltip] = useState<{ left: number; top: number; displayName: string; value: number; date?: string } | null>(null);
  const [chartDataPage, setChartDataPage] = useState(0);
  const [chartFocusedMark, setChartFocusedMark] = useState(0);
  const chartPage = paginateChartRows(chartDataRows, chartDataPage, CHART_DATA_PAGE_SIZE);
  const chartFocusedMarkIndex = Math.min(chartFocusedMark, Math.max(0, chartDataRows.length - 1));
  const chartMarkIndexByKey = useMemo(() => new Map(chartDataRows.map((row, index) => [row.key, index] as const)), [chartDataRows]);
  useEffect(() => setChartDataPage(0), [chartDataRows]);
  const showTooltipAt = (clientX: number, clientY: number, displayName: string, value: number, date?: string) => {
    const bounds = chartRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const tooltipWidth = 208;
    const tooltipHeight = date ? 72 : 54;
    const leftPosition = Math.min(Math.max(8, clientX - bounds.left + 14), Math.max(8, bounds.width - tooltipWidth - 8));
    const topPosition = Math.min(Math.max(8, clientY - bounds.top - tooltipHeight - 10), Math.max(8, bounds.height - tooltipHeight - 8));
    setTooltip({ left: leftPosition, top: topPosition, displayName, value, date });
  };
  const showTooltip = (event: React.MouseEvent<SVGElement>, displayName: string, value: number, date?: string) => showTooltipAt(event.clientX, event.clientY, displayName, value, date);
  const showTooltipForFocus = (event: React.FocusEvent<SVGElement>, displayName: string, value: number, date?: string) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    showTooltipAt(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2, displayName, value, date);
  };
  const handleChartMarkKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (!(event.target instanceof SVGElement)) return;
    const currentIndex = Number(event.target.getAttribute("data-chart-mark-index"));
    const nextIndex = getNextChartMarkIndex(currentIndex, event.key, chartDataRows.length);
    if (nextIndex === null) return;
    const nextMark = event.currentTarget.querySelector('[data-chart-mark-index="' + nextIndex + '"]') as (SVGElement & { focus?: () => void }) | null;
    if (!nextMark?.focus) return;
    event.preventDefault();
    nextMark.focus();
  };

  const downloadChartPng = useCallback(async () => {
    const svg = chartRef.current?.querySelector("svg");
    if (!svg) return;
    try {
      const viewBox = svg.viewBox.baseVal;
      const sourceElements = [svg, ...Array.from(svg.querySelectorAll("*"))];
      const clonedSvg = svg.cloneNode(true) as SVGSVGElement;
      const clonedElements = [clonedSvg, ...Array.from(clonedSvg.querySelectorAll("*"))];
      const styleProperties = ["fill", "stroke", "stroke-width", "font-size", "font-family", "font-weight", "opacity", "stroke-dasharray", "stroke-linecap", "stroke-linejoin"];
      sourceElements.forEach((element, index) => {
        const target = clonedElements[index];
        if (!target) return;
        const computed = getComputedStyle(element);
        target.setAttribute("style", styleProperties.map((property) => `${property}:${computed.getPropertyValue(property)}`).join(";"));
      });
      const baseChartWidth = viewBox.width || 900;
      const baseChartHeight = viewBox.height || 560;
      const exportTitleTopPadding = chartTitle.trim() ? CHART_TITLE_TOP_PADDING : 0;
      const chartWidth = baseChartWidth;
      const chartHeight = baseChartHeight + exportTitleTopPadding;
      const pixelRatio = 3;
      clonedSvg.setAttribute("width", String(chartWidth));
      clonedSvg.setAttribute("height", String(chartHeight));
      clonedSvg.setAttribute("viewBox", `${viewBox.x || 0} ${(viewBox.y || 0) - exportTitleTopPadding} ${chartWidth} ${chartHeight}`);
      clonedSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      const markup = new XMLSerializer().serializeToString(clonedSvg);
      const objectUrl = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("グラフ画像を作成できませんでした。"));
        image.src = objectUrl;
      });
      URL.revokeObjectURL(objectUrl);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(chartWidth * pixelRatio);
      canvas.height = Math.round(chartHeight * pixelRatio);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("画像用キャンバスを作成できませんでした。");
      context.fillStyle = theme === "dark" ? "#102235" : "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!png) throw new Error("PNG画像を作成できませんでした。");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(png);
      link.download = `x-account-stats-${mode}-${metric}.png`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {
      // Image export is best-effort and does not interrupt chart interaction.
    }
  }, [chartTitle, metric, mode, theme]);

  useEffect(() => {
    onExportReady(downloadChartPng);
    return () => onExportReady(async () => undefined);
  }, [downloadChartPng, onExportReady]);

  if (!(mode === "compare" ? chartRows.length : points.length)) return <div className="chart-empty">この条件で表示できるデータがありません。</div>;

  const axisLabel = (value: number) => formatChartValue(value, metric, compactNumbers);
  const renderGrid = (ticks: number[], className: string) => mode === "compare" && compareOrientation === "row"
    ? ticks.map((tick) => <line className={className} key={`${className}-${tick}`} x1={scaleX(tick)} x2={scaleX(tick)} y1={plotTop} y2={plotTop + plotHeight} />)
    : ticks.map((tick) => <line className={className} key={`${className}-${tick}`} x1={left} x2={width - right} y1={scaleY(tick)} y2={scaleY(tick)} />);
  // A logarithmic axis cannot contain zero, so use its lower positive bound as
  // the drawable baseline while preserving the requested zero baseline on a
  // linear axis.
  const drawableBaseline = Math.min(upper, Math.max(lower, baseline));
  const baselineX = scaleX(drawableBaseline);
  const baselineY = scaleY(drawableBaseline);

  return (
    <>
    <div className={`chart-wrap chart-wrap-${mode} ${chartTitle.trim() ? "has-chart-title" : ""} ${mode === "compare" && compareOrientation === "row" && chartRows.length > 10 ? "chart-wrap-dense" : ""}`} ref={chartRef}>
      {chartTitle.trim() && <div className="chart-site-title" style={{ fontSize: `${chartTitleFontSize}px` }} aria-hidden="true">{chartTitle.trim()}</div>}
      <div className="chart-scroll" style={{ width: "100%", overflowX: "auto" }}>
        <svg className="data-chart" style={{ width: "100%", height: denseRowChart ? `${height}px` : undefined, maxWidth: "none", overflow: "visible" }} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`${chartMetricLabels[metric]}の${mode === "compare" ? "比較" : "推移"}グラフ`} onKeyDown={handleChartMarkKeyDown}>
          {chartTitle.trim() && <text className="chart-title chart-title-svg" x={width / 2} y={top - CHART_TITLE_GAP} textAnchor="middle" style={{ fontSize: `${chartTitleFontSize}px` }}>{chartTitle.trim()}</text>}
          <defs><clipPath id={plotClipId}><rect x={left} y={plotTop} width={plotWidth} height={plotHeight} /></clipPath></defs>
          <g className="chart-grid">{renderGrid(minorTicks, "chart-minor-grid-line")}{renderGrid(majorTicks, "chart-major-grid-line")}</g>
          <g className="chart-axis-labels">
            {mode === "compare" && compareOrientation === "row" ? majorTicks.map((tick) => <text key={tick} x={scaleX(tick)} y={plotTop + plotHeight + 20} textAnchor="middle">{axisLabel(tick)}</text>) : majorTicks.map((tick) => <text key={tick} x={left - 12} y={scaleY(tick) + 4} textAnchor="end" style={{ fontSize: `${mode === "trend" ? trendAxisFontSize : 10}px` }}>{axisLabel(tick)}</text>)}
          </g>
          {mode === "compare" ? <g>
            {compareOrientation === "row" ? <line className="chart-baseline" x1={baselineX} x2={baselineX} y1={plotTop} y2={plotTop + plotHeight} /> : <line className="chart-baseline" x1={left} x2={width - right} y1={baselineY} y2={baselineY} />}
            {compareOrientation === "row" ? chartRows.map((entry, index) => {
              const row = entry.row;
              const slotHeight = plotHeight / Math.max(chartRows.length, 1);
              const barHeight = Math.max(chartRows.length > 30 ? 2 : chartRows.length > 10 ? 3 : 12, Math.min(18, slotHeight - 2));
              const y = top + index * slotHeight + (slotHeight - barHeight) / 2;
              const value = entry.value;
              const valueX = scaleX(value);
              const x = Math.min(baselineX, valueX);
              const barWidth = Math.max(2, Math.abs(valueX - baselineX));
              const iconX = left - barHeight - 42;
              const displayName = displayNameByHandle.get(row.handle.toLowerCase()) ?? resolvedDisplayName(row, displayNameOverrides);
              const labelX = value >= drawableBaseline ? valueX + 7 : valueX - 7;
              return <g key={`${row.account_id}-${row.fetched_at}`}><rect className="chart-bar" style={{ fill: barColor }} clipPath={`url(#${plotClipId})`} x={x} y={y} width={barWidth} height={barHeight} aria-label={`${displayName} ${chartMetricLabels[metric]} ${formatChartValue(value, metric)}`} data-chart-mark-index={chartMarkIndexByKey.get("compare|" + row.account_id + "|" + row.fetched_at) ?? -1} tabIndex={chartMarkIndexByKey.get("compare|" + row.account_id + "|" + row.fetched_at) === chartFocusedMarkIndex ? 0 : -1} role="img" onFocus={(event) => { const index = chartMarkIndexByKey.get("compare|" + row.account_id + "|" + row.fetched_at); if (index !== undefined) setChartFocusedMark(index); showTooltipForFocus(event, displayName, value, selectedCompareDate); }} onBlur={() => setTooltip(null)} onMouseEnter={(event) => showTooltip(event, displayName, value, selectedCompareDate)} onMouseLeave={() => setTooltip(null)} />{rowMetaAvatar(accountMeta.get(row.handle.toLowerCase()), iconX, y, barHeight, displayName)}<text className="chart-x-label chart-y-label chart-compare-label" x={left - 12} y={y + barHeight / 2 + 4} textAnchor="end">{displayName}</text><text className="chart-bar-value" x={labelX} y={y + barHeight / 2 + 4} textAnchor={value >= drawableBaseline ? "start" : "end"}>{formatChartValue(value, metric)}</text></g>;
            }) : chartRows.map((entry, index) => {
              const row = entry.row;
              const slot = plotWidth / Math.max(chartRows.length, 1);
              const gap = Math.min(8, Math.max(1, slot * 0.14));
              const x = left + index * slot + (index === 0 ? 2 : gap / 2);
              const barWidth = Math.max(2, slot - (index === 0 ? 2 : gap / 2) - (index === chartRows.length - 1 ? 0 : gap / 2));
              const value = entry.value;
              const valueY = scaleY(value);
              const barY = Math.min(baselineY, valueY);
              const barHeight = Math.max(2, Math.abs(valueY - baselineY));
              const labelY = top + plotHeight + 18;
              const displayName = displayNameByHandle.get(row.handle.toLowerCase()) ?? resolvedDisplayName(row, displayNameOverrides);
              const valueLabelY = value >= drawableBaseline ? Math.max(12, barY - 7) : Math.min(height - 8, barY + barHeight + 14);
              const valueFontSize = Math.max(6, Math.min(12, barWidth * 0.82));
              return <g key={`${row.account_id}-${row.fetched_at}`}><rect className="chart-bar" style={{ fill: barColor }} clipPath={`url(#${plotClipId})`} x={x} y={barY} width={barWidth} height={barHeight} aria-label={`${displayName} ${chartMetricLabels[metric]} ${formatChartValue(value, metric)}`} data-chart-mark-index={chartMarkIndexByKey.get("compare|" + row.account_id + "|" + row.fetched_at) ?? -1} tabIndex={chartMarkIndexByKey.get("compare|" + row.account_id + "|" + row.fetched_at) === chartFocusedMarkIndex ? 0 : -1} role="img" onFocus={(event) => { const index = chartMarkIndexByKey.get("compare|" + row.account_id + "|" + row.fetched_at); if (index !== undefined) setChartFocusedMark(index); showTooltipForFocus(event, displayName, value, selectedCompareDate); }} onBlur={() => setTooltip(null)} onMouseEnter={(event) => showTooltip(event, displayName, value, selectedCompareDate)} onMouseLeave={() => setTooltip(null)} /><text className="chart-bar-value" style={{ fontSize: `${valueFontSize}px` }} x={x + barWidth / 2} y={valueLabelY} textAnchor="middle" transform={`rotate(-90 ${x + barWidth / 2} ${valueLabelY})`}>{formatChartValue(value, metric)}</text><text className="chart-x-label chart-compare-label" style={{ fontSize: `${compareLabelFontSize}px` }} x={x + barWidth / 2} y={labelY} textAnchor="end" transform={`rotate(-70 ${x + barWidth / 2} ${labelY})`}>{displayName}</text></g>;
            })}
          </g> : <g>
            <g clipPath={`url(#${plotClipId})`}>{selectedHandles.map((handle, seriesIndex) => {
              const valuesForSeries = points.map((point) => point.values[handle]).filter((value): value is number => typeof value === "number");
              const linePoints = points.flatMap((point, pointIndex) => typeof point.values[handle] === "number" ? [`${xPosition(pointIndex)},${scaleY(point.values[handle])}`] : []);
              if (!valuesForSeries.length) return null;
              const displayName = displayNameByHandle.get(handle) ?? `@${handle}`;
              const seriesColor = legendColors[handle] ?? defaultLegendColor(seriesIndex);
              return <g key={handle}><polyline className="chart-line" style={{ stroke: seriesColor, strokeWidth: trendLineWidth }} points={linePoints.join(" ")} fill="none" />{points.map((point, pointIndex) => typeof point.values[handle] === "number" ? <circle key={`${handle}-${point.key}`} className="chart-point" style={{ fill: seriesColor, stroke: markerOutlineColor, strokeWidth: markerOutlineWidth }} cx={xPosition(pointIndex)} cy={scaleY(point.values[handle])} r={markerSize} onMouseEnter={(event) => showTooltip(event, displayName, point.values[handle], chartDateLabel(point.key, "full"))} onMouseLeave={() => setTooltip(null)} aria-label={`${displayName} ${chartDateLabel(point.key, "full")} ${chartMetricLabels[metric]} ${formatChartValue(point.values[handle], metric)}`} data-chart-mark-index={chartMarkIndexByKey.get("trend|" + handle + "|" + point.key) ?? -1} tabIndex={chartMarkIndexByKey.get("trend|" + handle + "|" + point.key) === chartFocusedMarkIndex ? 0 : -1} role="img" onFocus={(event) => { const index = chartMarkIndexByKey.get("trend|" + handle + "|" + point.key); if (index !== undefined) setChartFocusedMark(index); showTooltipForFocus(event, displayName, point.values[handle], chartDateLabel(point.key, "full")); }} onBlur={() => setTooltip(null)} /> : null)}</g>;
            })}</g>
            {trendValueFontSize > 0 && <g className="chart-value-labels">{selectedHandles.map((handle, seriesIndex) => { const seriesColor = legendColors[handle] ?? defaultLegendColor(seriesIndex); const valueLabelColor = trendValueLabelColor === "black" ? "#111111" : seriesColor; return points.map((point, pointIndex) => typeof point.values[handle] === "number" ? <text key={`${handle}-value-${point.key}`} className="chart-value-label" style={{ fill: valueLabelColor, fontSize: `${trendValueFontSize}px` }} x={xPosition(pointIndex)} y={scaleY(point.values[handle]) - Math.max(markerSize, 2) - 5} textAnchor="middle">{formatChartValue(point.values[handle], metric)}</text> : null); })}</g>}
            {trendLabelIndexes.map((index) => { const point = points[index]; const x = xPosition(index); return <text key={point.key} className="chart-x-label" style={{ fontSize: `${trendDateFontSize}px` }} x={x} y={trendLabelY} textAnchor="end" transform={`rotate(-60 ${x} ${trendLabelY})`}>{chartDateLabel(point.key, dateFormat)}</text>; })}
            {trendLegendLayout.items.length > 0 && <g className="chart-trend-legend" aria-label="グラフ内凡例">{trendLegendLayout.items.map((entry) => { const x = left + entry.x; const y = trendLegendTop + 9 + entry.row * trendLegendLayout.rowHeight; return <g key={entry.handle}><line x1={x} x2={x + 18} y1={y} y2={y} style={{ stroke: entry.color, strokeWidth: 3 }} /><text x={x + 24} y={y + trendLegendLayout.fontSize * 0.35} style={{ fontSize: `${trendLegendLayout.fontSize}px` }}>{entry.label}</text></g>; })}</g>}
          </g>}
          <line className="chart-axis" x1={left} x2={left} y1={plotTop} y2={plotTop + plotHeight} />
          <line className="chart-axis" x1={left} x2={width - right} y1={plotTop + plotHeight} y2={plotTop + plotHeight} />
        </svg>
      </div>
      <div className="chart-scroll-hint" role="note">グラフは左右にスクロールできます。</div>
      {tooltip && <div className="chart-tooltip" style={{ left: tooltip.left, top: tooltip.top }} role="status"><strong>{tooltip.displayName}</strong>{tooltip.date && <span>{tooltip.date}</span>}<span>{chartMetricLabels[metric]}：{formatChartValue(tooltip.value, metric)}</span></div>}
    </div>
    <details className="chart-data-table">
      <summary>グラフのデータ表（{chartDataRows.length}件）</summary>
      <div className="chart-data-table-content">
        <p>{chartMetricLabels[metric]}・{mode === "compare" ? "比較日 " + (selectedCompareDate || "—") : "推移データ"} / 全{chartPage.totalRows}件</p>
        <div className="chart-data-table-scroll">
          <table>
            <caption>{chartMetricLabels[metric]}の{mode === "compare" ? "比較" : "推移"}データ</caption>
            <thead><tr><th scope="col">日付</th><th scope="col">表示名</th><th scope="col">ハンドル</th><th scope="col">指標</th><th scope="col">値</th></tr></thead>
            <tbody>{chartPage.rows.length ? chartPage.rows.map((row) => <tr key={row.key}><td>{row.date || "—"}</td><td>{row.displayName}</td><td>@{row.handle}</td><td>{chartMetricLabels[metric]}</td><td>{formatChartValue(row.value, metric)}</td></tr>) : <tr><td colSpan={5}>条件に一致するデータがありません。</td></tr>}</tbody>
          </table>
        </div>
        <div className="chart-data-table-pagination"><button type="button" className="secondary-button" onClick={() => setChartDataPage((current) => Math.max(0, current - 1))} disabled={chartPage.page === 0}>前へ</button><span>{chartPage.page + 1} / {chartPage.totalPages}ページ</span><button type="button" className="secondary-button" onClick={() => setChartDataPage((current) => Math.min(chartPage.totalPages - 1, current + 1))} disabled={chartPage.page >= chartPage.totalPages - 1}>次へ</button></div>
      </div>
    </details>
    </>
  );
});

function rowMetaAvatar(row: AccountRow | HistoryRow | undefined, x: number, y: number, size: number, displayName: string) {
  const handle = row?.handle ?? "?";
  const avatarUrl = row && "avatarUrl" in row ? row.avatarUrl : null;
  if (avatarUrl) return <image className="chart-row-avatar" href={avatarUrl} x={x} y={y} width={size} height={size} preserveAspectRatio="xMidYMid slice" aria-label={`${displayName}のアイコン`} />;
  return <><rect className="chart-row-avatar chart-row-avatar-fallback" x={x} y={y} width={size} height={size} rx="2" /><text className="chart-row-avatar-letter" x={x + size / 2} y={y + size / 2 + 3} textAnchor="middle">{handle.slice(0, 1).toUpperCase()}</text></>;
}

function AppBadge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "accent" | "danger" }) {
  return <span className={`status-pill status-${tone}`}>{children}</span>;
}

export default function Home() {
  const [accountInput, setAccountInput] = useState("");
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [latestCollection, setLatestCollection] = useState<LatestCollection | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "success" | "error"; message: string } | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [readMode, setReadMode] = useState<"private" | "public">("private");
  const [isReadAccessReady, setIsReadAccessReady] = useState(false);
  const [adminLoginOpen, setAdminLoginOpen] = useState(false);
  const [adminKeyInput, setAdminKeyInput] = useState("");
  const [isAdminLoggingIn, setIsAdminLoggingIn] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("followers");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [activeTab, setActiveTab] = useState<DashboardTab>("results");
  const [resultsViewMode, setResultsViewMode] = useState<ResultsViewMode>("table");
  const [topMetric, setTopMetric] = useState<TopMetric>("followers");
  const [topDate, setTopDate] = useState("");
  const [topComparisonDate, setTopComparisonDate] = useState("");
  const [topExpanded, setTopExpanded] = useState(false);
  const [resultDate, setResultDate] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusCategory[]>(["active"]);
  const [chartMode, setChartMode] = useState<ChartMode>("compare");
  const [compareOrientation] = useState<CompareOrientation>("column");
  const [compareDate, setCompareDate] = useState("");
  const [chartComparisonDate, setChartComparisonDate] = useState("");
  const [metric, setMetric] = useState<ChartMetric>("followers");
  const [selectedHandles, setSelectedHandles] = useState<string[]>([]);
  const [chartStatusFilter, setChartStatusFilter] = useState<AccountStatus[]>([...ACCOUNT_STATUSES]);
  const [chartAccountQuery, setChartAccountQuery] = useState("");
  const [chartSelectedOnly, setChartSelectedOnly] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [dateFormat, setDateFormat] = useState<"short" | "month" | "full">("short");
  const [yMin, setYMin] = useState("");
  const [yMax, setYMax] = useState("");
  const [yStep, setYStep] = useState("");
  const [yMinorStep, setYMinorStep] = useState("");
  const [yMinInput, setYMinInput] = useState("");
  const [yMaxInput, setYMaxInput] = useState("");
  const [yStepInput, setYStepInput] = useState("");
  const [yMinorStepInput, setYMinorStepInput] = useState("");
  const [compactNumbers, setCompactNumbers] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  const [siteVersion, setSiteVersion] = useState(formatSiteVersion(FALLBACK_SITE_VERSION_NUMBER));
  const [isHydrated, setIsHydrated] = useState(false);
  const [displayNameOverrides, setDisplayNameOverrides] = useState<Record<string, string>>({});
  const [legendColors, setLegendColors] = useState<Record<string, string>>({});
  const [barColor, setBarColor] = useState<string | null>(null);
  const [chartTitle, setChartTitle] = useState("");
  const [chartTitleFontSize, setChartTitleFontSize] = useState(13);
  const [trendLineWidth, setTrendLineWidth] = useState(3);
  const [markerSize, setMarkerSize] = useState(3);
  const [markerOutlineWidth, setMarkerOutlineWidth] = useState(1.5);
  const [markerOutlineColor, setMarkerOutlineColor] = useState("#ffffff");
  const [trendValueFontSize, setTrendValueFontSize] = useState(0);
  const [trendAxisFontSize, setTrendAxisFontSize] = useState(10);
  const [trendDateFontSize, setTrendDateFontSize] = useState(9);
  const [trendValueLabelColor, setTrendValueLabelColor] = useState<"series" | "black">("series");
  const [compareLabelFontSize, setCompareLabelFontSize] = useState(7);
  const [showTrendLegend, setShowTrendLegend] = useState(true);
  const [logScale, setLogScale] = useState(false);
  const [logScaleEligible, setLogScaleEligible] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const collectInFlight = useRef(false);
  const exportInFlight = useRef(false);
  const chartSelectionInitialized = useRef(false);
  const avatarSyncFingerprint = useRef("");
  const chartExportRef = useRef<(() => Promise<void>) | null>(null);

  const clearCachedAccountData = () => {
    setRows([]);
    setHistoryRows([]);
    setLatestCollection(null);
    setAccountInput("");
    setSelectedHandles([]);
    setDisplayNameOverrides({});
    setLegendColors({});
    chartSelectionInitialized.current = false;
    try {
      const saved = window.localStorage.getItem(DASHBOARD_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, unknown>;
        for (const key of ["accountInput", "rows", "selectedHandles", "displayNameOverrides", "legendColors"]) delete parsed[key];
        window.localStorage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify(parsed));
      }
    } catch {
      window.localStorage.removeItem(DASHBOARD_STORAGE_KEY);
    }
  };

  const loadAdminStatus = async () => {
    try {
      const response = await fetch(`${window.location.origin}/api/admin/status`, { credentials: "same-origin", cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as AdminStatus;
      const mode = response.ok && payload.readMode === "public" ? "public" : "private";
      const authenticated = Boolean(response.ok && payload.isAdmin);
      setReadMode(mode);
      setIsAdmin(authenticated);
      if (!authenticated) setActiveTab("results");
      if (mode === "public" || authenticated) await loadHistory();
      else {
        clearCachedAccountData();
        setHistoryError(null);
      }
    } catch {
      setReadMode("private");
      setIsAdmin(false);
      setActiveTab("results");
      clearCachedAccountData();
    } finally {
      setIsReadAccessReady(true);
    }
  };

  const syncCurrentAvatars = async (accountRows: AccountRow[]) => {
    if (!isAdmin) return false;
    const rows = accountRows.filter((row) => row.status === "ok" && row.avatarUrl).map((row) => ({ accountId: row.id, handle: row.handle, avatarUrl: row.avatarUrl }));
    if (!rows.length) return false;
    const fingerprint = avatarFingerprint(accountRows);
    if (fingerprint === avatarSyncFingerprint.current) return true;
    const response = await fetch(`${window.location.origin}/api/avatar-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({ rows }),
    });
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "アイコン情報を共有データへ同期できませんでした。");
    avatarSyncFingerprint.current = fingerprint;
    return true;
  };

  const loginAdmin = async () => {
    if (!adminKeyInput.trim() || isAdminLoggingIn) return;
    setIsAdminLoggingIn(true);
    try {
      const response = await fetch(`${window.location.origin}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ key: adminKeyInput }) });
      const payload = (await response.json().catch(() => ({}))) as AdminStatus;
      if (!response.ok) throw new Error(payload.error ?? "管理者ログインに失敗しました。");
      setIsAdmin(true);
      setAdminKeyInput("");
      setAdminLoginOpen(false);
      setNotice({ tone: "success", message: "管理者モードに切り替えました。" });
      await loadHistory();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "管理者ログインに失敗しました。" });
    } finally {
      setIsAdminLoggingIn(false);
    }
  };

  const logoutAdmin = async () => {
    await fetch(`${window.location.origin}/api/admin/logout`, { method: "POST", credentials: "same-origin" }).catch(() => undefined);
    setIsAdmin(false);
    setActiveTab("results");
    setAdminLoginOpen(false);
    clearCachedAccountData();
    setNotice({ tone: "info", message: "管理者セッションを終了しました。" });
    if (readMode === "public") await loadHistory();
  };

  const loadHistory = async () => {
    try {
      const response = await fetch(`${window.location.origin}/api/history`, { credentials: "same-origin", cache: "no-store" });
      const payload = (await response.json()) as HistoryResponse;
      if (!response.ok) throw new Error(payload.error ?? "履歴を読み込めませんでした");
      setHistoryRows(payload.rows ?? []);
      setLatestCollection(payload.latestCollection ?? null);
      const latestRunId = payload.runs?.[0]?.id ?? (payload.rows ?? []).reduce((latest, row) => row.fetched_at > latest.fetched_at ? row : latest, { fetched_at: "", run_id: "" }).run_id;
      const latestHistoricalRows = (payload.rows ?? []).filter((row) => row.run_id === latestRunId);
      if (latestHistoricalRows.length) {
        setRows((current) => latestHistoricalRows.map((row) => {
            const previous = current.find((item) => item.id === row.account_id || item.handle.toLowerCase() === row.handle.toLowerCase());
            return { id: row.account_id, handle: row.handle, displayName: row.display_name, avatarUrl: row.avatar_url ?? previous?.avatarUrl ?? null, followers: row.followers, following: row.following, posts: row.posts, joined: row.joined ?? previous?.joined ?? null, fetchedAt: row.fetched_at, status: "ok" as const, accountStatus: row.account_status ?? previous?.accountStatus ?? "active" };
          }));
      } else {
        setRows([]);
      }
      const historicalHandles = uniqueValues((payload.rows ?? []).map((row) => row.handle.toLowerCase())).slice(0, 8);
      setSelectedHandles((current) => {
        if (chartSelectionInitialized.current) return current;
        const next = current.length ? current : historicalHandles;
        if (next.length) chartSelectionInitialized.current = true;
        return next;
      });
      setHistoryError(null);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "履歴を読み込めませんでした");
    }
  };

  /* eslint-disable react-hooks/set-state-in-effect -- wait for the server read policy before restoring account-specific preferences. */
  useEffect(() => {
    if (!isReadAccessReady) return;
    const canReadAccountData = readMode === "public" || isAdmin;
    try {
      const saved = window.localStorage.getItem(DASHBOARD_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as PersistedDashboardState;
        if (canReadAccountData && typeof parsed.accountInput === "string") setAccountInput(parsed.accountInput);
        if (canReadAccountData && Array.isArray(parsed.selectedHandles)) {
          chartSelectionInitialized.current = true;
          setSelectedHandles(parsed.selectedHandles.filter((handle): handle is string => typeof handle === "string").map((handle) => handle.toLowerCase()));
        }
        if (Array.isArray(parsed.chartStatusFilter)) setChartStatusFilter(parsed.chartStatusFilter.filter((value): value is AccountStatus => isAccountStatus(value)));
        if (Array.isArray(parsed.statusFilter)) setStatusFilter(parsed.statusFilter.filter((value): value is StatusCategory => value === "active" || value === "ended" || value === "nonAlt"));
        if (parsed.theme === "light" || parsed.theme === "dark") setTheme(parsed.theme);
        if (canReadAccountData && parsed.displayNameOverrides && typeof parsed.displayNameOverrides === "object") setDisplayNameOverrides(parsed.displayNameOverrides);
        if (canReadAccountData && parsed.legendColors && typeof parsed.legendColors === "object") setLegendColors(parsed.legendColors);
        if (typeof parsed.barColor === "string" && /^#[0-9a-f]{6}$/i.test(parsed.barColor)) setBarColor(parsed.barColor);
        if (typeof parsed.chartTitle === "string") setChartTitle(parsed.chartTitle);
        if (typeof parsed.chartTitleFontSize === "number" && parsed.chartTitleFontSize >= 6 && parsed.chartTitleFontSize <= 24) setChartTitleFontSize(parsed.chartTitleFontSize);
        if (typeof parsed.trendLineWidth === "number" && parsed.trendLineWidth >= 1 && parsed.trendLineWidth <= 8) setTrendLineWidth(parsed.trendLineWidth);
        if (typeof parsed.markerSize === "number" && parsed.markerSize >= 0 && parsed.markerSize <= 8) setMarkerSize(parsed.markerSize);
        if (typeof parsed.markerOutlineWidth === "number" && parsed.markerOutlineWidth >= 0 && parsed.markerOutlineWidth <= 5) setMarkerOutlineWidth(parsed.markerOutlineWidth);
        if (typeof parsed.markerOutlineColor === "string") setMarkerOutlineColor(parsed.markerOutlineColor);
        if (typeof parsed.trendValueFontSize === "number" && parsed.trendValueFontSize >= 0 && parsed.trendValueFontSize <= 24) setTrendValueFontSize(parsed.trendValueFontSize);
        if (typeof parsed.trendAxisFontSize === "number" && parsed.trendAxisFontSize >= 1 && parsed.trendAxisFontSize <= 24) setTrendAxisFontSize(parsed.trendAxisFontSize);
        if (typeof parsed.trendDateFontSize === "number" && parsed.trendDateFontSize >= 1 && parsed.trendDateFontSize <= 24) setTrendDateFontSize(parsed.trendDateFontSize);
        if (parsed.trendValueLabelColor === "series" || parsed.trendValueLabelColor === "black") setTrendValueLabelColor(parsed.trendValueLabelColor);
        if (typeof parsed.compareLabelFontSize === "number" && parsed.compareLabelFontSize >= 5 && parsed.compareLabelFontSize <= 16) setCompareLabelFontSize(parsed.compareLabelFontSize);
        if (typeof parsed.showTrendLegend === "boolean") setShowTrendLegend(parsed.showTrendLegend);
        if (typeof parsed.logScale === "boolean") setLogScale(parsed.logScale);
      }
    } catch {
      // Ignore malformed or unavailable local browser storage and use a clean state.
    } finally {
      setIsHydrated(true);
    }
  }, [isReadAccessReady, isAdmin, readMode]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    if (!isHydrated || !isReadAccessReady) return;
    const canReadAccountData = readMode === "public" || isAdmin;
    try {
      const state: PersistedDashboardState = { ...(canReadAccountData ? { accountInput, selectedHandles, displayNameOverrides, legendColors } : {}), statusFilter, chartStatusFilter, theme, barColor: barColor ?? undefined, chartTitle, chartTitleFontSize, trendLineWidth, markerSize, markerOutlineWidth, markerOutlineColor, trendValueFontSize, trendAxisFontSize, trendDateFontSize, trendValueLabelColor, compareLabelFontSize, showTrendLegend, logScale };
      window.localStorage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // A full or restricted localStorage should not block data collection.
    }
  }, [accountInput, barColor, chartStatusFilter, chartTitle, chartTitleFontSize, compareLabelFontSize, displayNameOverrides, isHydrated, isReadAccessReady, isAdmin, legendColors, logScale, markerOutlineColor, markerOutlineWidth, markerSize, readMode, selectedHandles, showTrendLegend, statusFilter, theme, trendAxisFontSize, trendDateFontSize, trendLineWidth, trendValueFontSize, trendValueLabelColor]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/site-version", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("site version unavailable");
        const payload = await response.json() as SiteVersionResponse;
        if (typeof payload.label === "string" && payload.label.startsWith("Ver.")) {
          setSiteVersion(payload.label);
        } else if (typeof payload.version === "number") {
          setSiteVersion(formatSiteVersion(payload.version));
        }
      })
      .catch(() => {
        // Keep the known fallback label when local preview or an older version has no endpoint.
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    // The former browser-only Excel supplement is no longer a data source.
    // Remove its IndexedDB store once so old workbook bytes cannot remain in
    // this browser after the D1 migration.
    try {
      window.indexedDB?.deleteDatabase(LEGACY_BROWSER_EXCEL_DB);
    } catch {
      // IndexedDB may be unavailable in private or restricted browser modes.
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadAdminStatus(); }, 0);
    return () => window.clearTimeout(timer);
    // The admin cookie is checked once when the public dashboard opens.
  }, []);

  useEffect(() => {
    if (!isAdmin || !rows.some((row) => row.status === "ok" && row.avatarUrl)) return;
    const timer = window.setTimeout(() => {
      void syncCurrentAvatars(rows).catch((error) => {
        setHistoryError(error instanceof Error ? error.message : "アイコン情報を公開データへ同期できませんでした。");
      });
    }, 0);
    return () => window.clearTimeout(timer);
    // The fingerprint inside syncCurrentAvatars prevents repeat writes when
    // other dashboard state changes trigger a render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, rows]);

  const successfulRows = useMemo(() => rows.filter((row) => row.status === "ok"), [rows]);
  const chartHistoryRows = useMemo(() => {
    return buildDailyChartRows(historyRows);
  }, [historyRows]);
  const topMetricField = topMetricBase(topMetric);
  const topAvailableDates = useMemo(() => {
    if (topMetric !== "postsPerFollower") return availableHistoryDates(chartHistoryRows, topMetricField, statusFilter);
    return [...new Set(chartHistoryRows.filter((row) => matchesStatusFilter(row.account_status, statusFilter) && row.followers !== null && row.followers > 0 && row.posts !== null && row.posts !== undefined && row.posts > 0).map((row) => chartDateParts(row.fetched_at)).filter((parts): parts is { year: string; month: string; day: string } => Boolean(parts)).map((parts) => `${parts.year}-${parts.month}-${parts.day}`))].sort();
  }, [chartHistoryRows, statusFilter, topMetric, topMetricField]);
  const topDateMin = topAvailableDates[0] ?? "";
  const topDateMax = topAvailableDates.at(-1) ?? "";
  const selectedTopDate = topDate && topDateMin && topDateMax && topDate >= topDateMin && topDate <= topDateMax ? topDate : topDateMax;
  const topDateRows = useMemo(() => {
    const latestByHandle = new Map<string, HistoryRow>();
    for (const row of chartHistoryRows) {
      const parts = chartDateParts(row.fetched_at);
      if (!parts || `${parts.year}-${parts.month}-${parts.day}` !== selectedTopDate) continue;
      const handle = row.handle.toLowerCase();
      const current = latestByHandle.get(handle);
      if (!current || new Date(row.fetched_at).getTime() > new Date(current.fetched_at).getTime()) latestByHandle.set(handle, row);
    }
    const currentMeta = new Map(successfulRows.map((row) => [row.handle.toLowerCase(), row]));
    return [...latestByHandle.values()].map((row) => {
      const current = currentMeta.get(row.handle.toLowerCase());
      return {
        id: row.account_id,
        handle: row.handle,
        displayName: row.display_name,
        avatarUrl: current?.avatarUrl ?? row.avatar_url ?? null,
        followers: row.followers,
        following: row.following,
        posts: row.posts,
        joined: current?.joined ?? null,
        fetchedAt: row.fetched_at,
        status: "ok" as const,
        accountStatus: row.account_status,
      };
    });
  }, [chartHistoryRows, selectedTopDate, successfulRows]);
  const topComparisonTargetDate = useMemo(() => {
    if (!selectedTopDate) return "";
    const candidates = topAvailableDates.filter((date) => date < selectedTopDate);
    return topComparisonDate && topComparisonDate < selectedTopDate ? topComparisonDate : candidates.at(-1) ?? shiftDateKey(selectedTopDate, -1);
  }, [selectedTopDate, topAvailableDates, topComparisonDate]);
  const topPreviousByAccount = useMemo(() => {
    const previousDate = topComparisonTargetDate;
    const previousByHandle = new Map<string, HistoryRow>();
    for (const row of chartHistoryRows) {
      const parts = chartDateParts(row.fetched_at);
      if (!parts || `${parts.year}-${parts.month}-${parts.day}` !== previousDate) continue;
      const handle = row.handle.toLowerCase();
      const current = previousByHandle.get(handle);
      if (!current || new Date(row.fetched_at).getTime() > new Date(current.fetched_at).getTime()) previousByHandle.set(handle, row);
    }
    const result = new Map<string, PreviousMetrics>();
    for (const row of topDateRows) {
      const previous = previousByHandle.get(row.handle.toLowerCase());
      result.set(row.id, {
        followers: row.followers !== null && previous?.followers !== null && previous?.followers !== undefined ? row.followers - previous.followers : null,
        following: row.following !== null && previous?.following !== null && previous?.following !== undefined ? row.following - previous.following : null,
        posts: row.posts !== null && previous?.posts !== null && previous?.posts !== undefined ? row.posts - previous.posts : null,
      });
    }
    return result;
  }, [chartHistoryRows, topComparisonTargetDate, topDateRows]);
  const resultAvailableDates = useMemo(() => availableHistoryDates(chartHistoryRows, "any", statusFilter), [chartHistoryRows, statusFilter]);
  const resultDateMin = resultAvailableDates[0] ?? "";
  const resultDateMax = resultAvailableDates.at(-1) ?? "";
  const selectedResultDate = resultDate && resultDateMin && resultDateMax && resultDate >= resultDateMin && resultDate <= resultDateMax ? resultDate : resultDateMax;
  const resultDateRows = useMemo(() => {
    if (!selectedResultDate) return successfulRows;
    const historyByAccount = new Map<string, HistoryRow>();
    for (const row of chartHistoryRows) {
      const parts = chartDateParts(row.fetched_at);
      if (!parts || `${parts.year}-${parts.month}-${parts.day}` !== selectedResultDate) continue;
      const current = historyByAccount.get(row.account_id) ?? historyByAccount.get(`handle:${row.handle.toLowerCase()}`);
      if (!current || row.fetched_at > current.fetched_at) {
        historyByAccount.set(row.account_id, row);
        historyByAccount.set(`handle:${row.handle.toLowerCase()}`, row);
      }
    }
    const accounts = new Map<string, AccountRow>();
    for (const row of successfulRows) accounts.set(row.id, { ...row, followers: null, following: null, posts: null, fetchedAt: canonicalDailyFetchedAt(selectedResultDate) });
    for (const row of chartHistoryRows) {
      if (!accounts.has(row.account_id)) accounts.set(row.account_id, { id: row.account_id, handle: row.handle, displayName: row.display_name, avatarUrl: row.avatar_url, followers: null, following: null, posts: null, joined: null, fetchedAt: canonicalDailyFetchedAt(selectedResultDate), status: "ok", accountStatus: row.account_status });
    }
    return [...accounts.values()].map((account) => {
      const history = historyByAccount.get(account.id) ?? historyByAccount.get(`handle:${account.handle.toLowerCase()}`);
      return history ? { ...account, handle: history.handle, displayName: history.display_name, avatarUrl: history.avatar_url ?? account.avatarUrl, followers: history.followers, following: history.following, posts: history.posts, fetchedAt: history.fetched_at, accountStatus: history.account_status } : account;
    });
  }, [chartHistoryRows, selectedResultDate, successfulRows]);
  const resultPreviousByAccount = useMemo(() => {
    const previousDate = selectedResultDate ? shiftDateKey(selectedResultDate, -1) : "";
    const previousByAccount = new Map<string, HistoryRow>();
    for (const row of chartHistoryRows) {
      const parts = chartDateParts(row.fetched_at);
      if (!parts || `${parts.year}-${parts.month}-${parts.day}` !== previousDate) continue;
      const current = previousByAccount.get(row.account_id);
      if (!current || row.fetched_at > current.fetched_at) previousByAccount.set(row.account_id, row);
    }
    const result = new Map<string, PreviousMetrics>();
    for (const row of resultDateRows) {
      const previous = previousByAccount.get(row.id);
      result.set(row.id, {
        followers: row.followers !== null && previous?.followers !== null && previous?.followers !== undefined ? row.followers - previous.followers : null,
        following: row.following !== null && previous?.following !== null && previous?.following !== undefined ? row.following - previous.following : null,
        posts: row.posts !== null && previous?.posts !== null && previous?.posts !== undefined ? row.posts - previous.posts : null,
      });
    }
    return result;
  }, [chartHistoryRows, resultDateRows, selectedResultDate]);
  const totals = useMemo(() => ({ followers: successfulRows.reduce((sum, row) => sum + (row.followers ?? 0), 0), following: successfulRows.reduce((sum, row) => sum + (row.following ?? 0), 0), posts: successfulRows.reduce((sum, row) => sum + (row.posts ?? 0), 0) }), [successfulRows]);
  const previousByAccount = useMemo(() => {
    const currentById = new Map(successfulRows.map((row) => [row.id, row]));
    const currentByHandle = new Map(successfulRows.map((row) => [row.handle.toLowerCase(), row]));
    const latestBefore = new Map<string, HistoryRow>();
    for (const history of chartHistoryRows) {
      const currentRow = currentById.get(history.account_id) ?? currentByHandle.get(history.handle.toLowerCase());
      const currentRecordDate = currentRow ? dailyRecordDate(currentRow.fetchedAt) : null;
      const historyRecordDate = dailyRecordDate(history.fetched_at);
      if (!currentRow || !currentRecordDate || !historyRecordDate || historyRecordDate >= currentRecordDate) continue;
      const currentTime = new Date(currentRow.fetchedAt).getTime();
      const historyTime = new Date(history.fetched_at).getTime();
      const current = latestBefore.get(currentRow.id);
      if (historyTime < currentTime && (!current || historyTime > new Date(current.fetched_at).getTime())) latestBefore.set(currentRow.id, history);
    }
    const result = new Map<string, PreviousMetrics>();
    for (const row of successfulRows) {
      const previous = latestBefore.get(row.id);
      result.set(row.id, {
        followers: row.followers !== null && previous?.followers !== null && previous?.followers !== undefined ? row.followers - previous.followers : null,
        following: row.following !== null && previous?.following !== null && previous?.following !== undefined ? row.following - previous.following : null,
        posts: row.posts !== null && previous?.posts !== null && previous?.posts !== undefined ? row.posts - previous.posts : null,
      });
    }
    return result;
  }, [chartHistoryRows, successfulRows]);

  const effectiveChartMetric: ChartMetric = chartMode === "trend" && (isChartDeltaMetric(metric) || metric === "postsPerFollower") ? (metric === "postsPerFollower" ? "posts" : chartMetricBase(metric)) : chartMode === "compare" && metric === "followersCumulativeDelta" ? "followers" : metric;
  const chartAccountMetric = effectiveChartMetric === "followersCumulativeDelta" ? "followers" : effectiveChartMetric;
  const chartAccountOptions = useMemo(() => {
    const accounts = new Map<string, { handle: string; displayName: string; id: string; avatarUrl: string | null; accountStatus: AccountStatus }>();
    for (const row of successfulRows) if (hasChartMetricValue(row, chartAccountMetric)) accounts.set(row.handle.toLowerCase(), { handle: row.handle, displayName: resolvedDisplayName(row, displayNameOverrides), id: row.id, avatarUrl: row.avatarUrl, accountStatus: row.accountStatus });
    for (const row of chartHistoryRows) if (hasChartMetricValue(row, chartAccountMetric) && !accounts.has(row.handle.toLowerCase())) accounts.set(row.handle.toLowerCase(), { handle: row.handle, displayName: resolvedDisplayName(row, displayNameOverrides), id: row.account_id, avatarUrl: row.avatar_url ?? null, accountStatus: row.account_status });
    return [...accounts.values()].sort((left, right) => left.displayName.localeCompare(right.displayName, "ja") || left.handle.localeCompare(right.handle, "ja"));
  }, [chartAccountMetric, chartHistoryRows, displayNameOverrides, successfulRows]);
  const chartMetricDates = useMemo(() => {
    const dates = new Set<string>();
    for (const row of chartHistoryRows) {
      const valueMetric = effectiveChartMetric === "followersCumulativeDelta" ? "followers" : effectiveChartMetric;
      if (!matchesStatusFilter(row.account_status, ["active", "ended", "nonAlt"]) || chartMetricValue(row, valueMetric) === null) continue;
      const parts = chartDateParts(row.fetched_at);
      if (parts) dates.add(`${parts.year}-${parts.month}-${parts.day}`);
    }
    return [...dates].sort();
  }, [chartHistoryRows, effectiveChartMetric]);
  const selectedCompareDate = compareDate && chartMetricDates.includes(compareDate) ? compareDate : chartMetricDates.at(-1) ?? "";
  const selectedChartComparisonDate = chartComparisonDate && chartMetricDates.includes(chartComparisonDate) && chartComparisonDate < selectedCompareDate ? chartComparisonDate : chartMetricDates.filter((date) => date < selectedCompareDate).at(-1) ?? shiftDateKey(selectedCompareDate, -1);
  const compareAvailableHandles = useMemo(() => new Set(chartHistoryRows.filter((row) => {
    const parts = chartDateParts(row.fetched_at);
    const date = parts ? `${parts.year}-${parts.month}-${parts.day}` : "";
    if (date !== selectedCompareDate || chartMetricValue(row, effectiveChartMetric) === null) return false;
    if (!isChartDeltaMetric(effectiveChartMetric)) return true;
    return chartHistoryRows.some((candidate) => {
      const candidateParts = chartDateParts(candidate.fetched_at);
      return candidate.handle.toLowerCase() === row.handle.toLowerCase() && candidateParts && `${candidateParts.year}-${candidateParts.month}-${candidateParts.day}` === selectedChartComparisonDate && chartMetricValue(candidate, effectiveChartMetric) !== null;
    });
  }).map((row) => row.handle.toLowerCase())), [chartHistoryRows, effectiveChartMetric, selectedChartComparisonDate, selectedCompareDate]);
  const chartAvailableAccountOptions = useMemo(() => chartMode === "compare" ? chartAccountOptions.filter((row) => compareAvailableHandles.has(row.handle.toLowerCase())) : chartAccountOptions, [chartAccountOptions, chartMode, compareAvailableHandles]);
  const visibleChartAccountOptions = useMemo(() => chartAvailableAccountOptions.filter((row) => chartStatusFilter.includes(row.accountStatus)), [chartAvailableAccountOptions, chartStatusFilter]);
  const chartPickerFilteredOptions = useMemo(() => filterChartPickerAccounts(visibleChartAccountOptions, { query: chartAccountQuery, selectedOnly: chartSelectedOnly, selectedHandles }), [chartAccountQuery, chartSelectedOnly, selectedHandles, visibleChartAccountOptions]);
  const chartPickerGroups = useMemo(() => groupChartPickerAccounts(chartPickerFilteredOptions), [chartPickerFilteredOptions]);
  const selectedChartHandles = useMemo(() => {
    const visibleHandles = new Set(visibleChartAccountOptions.map((row) => row.handle.toLowerCase()));
    return selectedHandles.filter((handle) => visibleHandles.has(handle));
  }, [selectedHandles, visibleChartAccountOptions]);
  const chartRenderKey = useMemo(() => [chartMode, effectiveChartMetric, selectedCompareDate, selectedChartComparisonDate, startDate, endDate, granularity, dateFormat, yMin, yMax, yStep, yMinorStep, compactNumbers, selectedChartHandles.join(",")].join("|"), [chartMode, compactNumbers, dateFormat, effectiveChartMetric, endDate, granularity, selectedChartComparisonDate, selectedChartHandles, selectedCompareDate, startDate, yMax, yMin, yMinorStep, yStep]);
  const summaryDeltas = useMemo(() => {
    const followerValues = successfulRows.map((row) => previousByAccount.get(row.id)?.followers).filter((value): value is number => value !== null && value !== undefined);
    const postValues = successfulRows.map((row) => previousByAccount.get(row.id)?.posts).filter((value): value is number => value !== null && value !== undefined);
    return {
      followers: followerValues.length ? followerValues.reduce((sum, value) => sum + value, 0) : null,
      posts: postValues.length ? postValues.reduce((sum, value) => sum + value, 0) : null,
    };
  }, [previousByAccount, successfulRows]);

  const sortedRows = useMemo(() => {
    const valueForSort = (row: AccountRow) => {
      if (sortKey === "followersDelta") return resultPreviousByAccount.get(row.id)?.followers;
      if (sortKey === "postsDelta") return resultPreviousByAccount.get(row.id)?.posts;
      return row[sortKey];
    };
    return [...resultDateRows].sort((a, b) => {
      const comparison = compareSortValues(valueForSort(a), valueForSort(b), sortKey);
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [resultDateRows, resultPreviousByAccount, sortDirection, sortKey]);
  const visibleResultRows = useMemo(() => sortedRows.filter((row) => matchesStatusFilter(row.accountStatus, statusFilter) && hasNonZeroFollowers(row)), [sortedRows, statusFilter]);
  const visibleTopDateRows = useMemo(() => topDateRows.filter((row) => matchesStatusFilter(row.accountStatus, statusFilter)), [statusFilter, topDateRows]);
  const rankingRows = useMemo(() => isTopDeltaMetric(topMetric) ? visibleTopDateRows : visibleTopDateRows.filter((row) => hasNonZeroFollowers(row)), [topMetric, visibleTopDateRows]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDirection((direction) => direction === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDirection("desc"); }
  };

  const updateDisplayName = (row: AccountRow, value: string) => {
    setDisplayNameOverrides((current) => {
      const next = { ...current };
      if (!value.trim() || value.trim() === row.displayName) delete next[row.id];
      else next[row.id] = value;
      return next;
    });
  };

  const updateLegendColor = (handle: string, color: string) => {
    setLegendColors((current) => ({ ...current, [handle.toLowerCase()]: color }));
  };

  const rankedTopRows = useMemo(() => rankTopRows(rankingRows, topMetric, topPreviousByAccount), [rankingRows, topMetric, topPreviousByAccount]);
  const topRows = useMemo(() => rankedTopRows.slice(0, 15), [rankedTopRows]);

  const downloadTop15Image = async () => {
    if (!topRows.length) return;
    setNotice({ tone: "info", message: "ランキング画像を準備しています…" });
    try {
      const width = 1600;
      const height = 900;
      const padding = 54;
      const panelHeaderHeight = 64;
      const gridTop = 102;
      const columnGap = 14;
      const rowGap = 12;
      const cardWidth = (width - padding * 2 - columnGap) / 2;
      const medalHeight = 90;
      const compactHeight = 62;
      const pixelRatio = 2;
      const canvas = document.createElement("canvas");
      canvas.width = width * pixelRatio;
      canvas.height = height * pixelRatio;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("画像用キャンバスを作成できませんでした");
      context.scale(pixelRatio, pixelRatio);
      const fontFamily = getComputedStyle(document.body).fontFamily || "Yu Gothic, Hiragino Sans, sans-serif";
      const background = theme === "dark" ? "#0d1726" : "#f5f4f0";
      const panelBackground = theme === "dark" ? "#14263a" : "#ffffff";
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
      context.fillStyle = panelBackground;
      context.fillRect(0, panelHeaderHeight - 1, width, height - panelHeaderHeight + 1);
      context.fillStyle = theme === "dark" ? "#e5edf6" : "#17212d";
      context.font = `800 26px ${fontFamily}`;
      const imageDateLabel = isTopDeltaMetric(topMetric) ? `${shortDateKey(topComparisonTargetDate)}〜${shortDateKey(selectedTopDate)}` : selectedTopDate;
      context.fillText(`ランキング / ${topMetricLabels[topMetric]} / ${imageDateLabel}`, padding, 48);

      const roundedPath = (x: number, y: number, boxWidth: number, boxHeight: number, radius: number) => {
        const r = Math.min(radius, boxWidth / 2, boxHeight / 2);
        context.beginPath();
        context.moveTo(x + r, y);
        context.arcTo(x + boxWidth, y, x + boxWidth, y + boxHeight, r);
        context.arcTo(x + boxWidth, y + boxHeight, x, y + boxHeight, r);
        context.arcTo(x, y + boxHeight, x, y, r);
        context.arcTo(x, y, x + boxWidth, y, r);
        context.closePath();
      };
      const fitText = (text: string, maxWidth: number, font: string) => {
        context.font = font;
        if (context.measureText(text).width <= maxWidth) return text;
        let shortened = text;
        while (shortened.length > 1 && context.measureText(`${shortened}…`).width > maxWidth) shortened = shortened.slice(0, -1);
        return `${shortened}…`;
      };
      const loadAvatar = async (url: string | null) => {
        if (!url) return null;
        try {
          const response = await fetch(url, { mode: "cors", cache: "force-cache" });
          if (!response.ok) return null;
          const objectUrl = URL.createObjectURL(await response.blob());
          const image = new Image();
          image.src = objectUrl;
          await new Promise<void>((resolve) => {
            image.onload = () => resolve();
            image.onerror = () => resolve();
          });
          URL.revokeObjectURL(objectUrl);
          return image.naturalWidth > 0 ? image : null;
        } catch {
          return null;
        }
      };
      const avatars = await Promise.all(topRows.map((row) => loadAvatar(row.avatarUrl)));
      topRows.forEach((row, index) => {
        const isMedal = index < 3;
        const relativeIndex = Math.max(0, index - 3);
        const rowIndex = isMedal ? index : Math.floor(relativeIndex / 2) + 3;
        const columnIndex = isMedal ? 0 : relativeIndex % 2;
        const cardHeight = isMedal ? medalHeight : compactHeight;
        const x = isMedal ? padding : padding + columnIndex * (cardWidth + columnGap);
        const cardY = isMedal ? gridTop + index * (medalHeight + rowGap) : gridTop + 3 * medalHeight + 3 * rowGap + (rowIndex - 3) * (compactHeight + rowGap);
        const cardX = x;
        const boxWidth = isMedal ? width - padding * 2 : cardWidth;
        const cardFill = theme === "dark" ? (index === 0 ? "#3f3821" : index === 1 ? "#28313a" : index === 2 ? "#3c2c22" : "#102235") : (index === 0 ? "#fff9dc" : index === 1 ? "#f7fafc" : index === 2 ? "#fff3e7" : "#f3f7f5");
        const cardBorder = index === 0 ? (theme === "dark" ? "#aa8b39" : "#d1ad47") : index === 1 ? (theme === "dark" ? "#758391" : "#aeb8c2") : index === 2 ? (theme === "dark" ? "#9b6741" : "#c48a5c") : (theme === "dark" ? "#31516b" : "#dfe4e7");
        roundedPath(cardX, cardY, boxWidth, cardHeight, 12);
        context.fillStyle = cardFill;
        context.fill();
        context.strokeStyle = cardBorder;
        context.lineWidth = 1;
        context.stroke();
        const rankColor = index === 0 ? (theme === "dark" ? "#e4c96c" : "#9a762c") : index === 1 ? (theme === "dark" ? "#c5d0da" : "#687783") : index === 2 ? (theme === "dark" ? "#e1a678" : "#8e552d") : (theme === "dark" ? "#9bafc2" : "#75818c");
        const textColor = theme === "dark" ? "#e5edf6" : "#17212d";
        const rankX = cardX + 22;
        const centerY = cardY + cardHeight / 2;
        context.fillStyle = rankColor;
        context.font = `${isMedal ? "800 23px" : "800 16px"} ${fontFamily}`;
        context.fillText(String(index + 1).padStart(2, "0"), rankX, centerY + (isMedal ? 8 : 5));
        const avatarSize = isMedal ? 56 : 42;
        const avatarX = cardX + (isMedal ? 82 : 64);
        const avatarY = centerY - avatarSize / 2;
        roundedPath(avatarX, avatarY, avatarSize, avatarSize, 7);
        context.save();
        context.clip();
        const image = avatars[index];
        if (image) context.drawImage(image, avatarX, avatarY, avatarSize, avatarSize);
        else {
          context.fillStyle = theme === "dark" ? "#1b454c" : "#dcefeb";
          context.fill();
          context.fillStyle = theme === "dark" ? "#77d0ca" : "#167d79";
          context.font = `${isMedal ? 22 : 16}px ${fontFamily}`;
          context.textAlign = "center";
          context.fillText(row.handle.slice(0, 1).toUpperCase(), avatarX + avatarSize / 2, centerY + (isMedal ? 8 : 6));
          context.textAlign = "left";
        }
        context.restore();
        const displayName = resolvedDisplayName(row, displayNameOverrides);
        const value = formatTopMetricValue(row, topMetric, topPreviousByAccount);
        const valueFont = `${isMedal ? "800 28px" : "800 20px"} ${fontFamily}`;
        context.font = valueFont;
        const valueX = cardX + boxWidth - 24;
        const textX = avatarX + avatarSize + (isMedal ? 16 : 12);
        const textRight = valueX - (isMedal ? 22 : 16);
        const availableTextWidth = Math.max(80, textRight - textX);
        if (isMedal) {
          const nameFont = `800 25px ${fontFamily}`;
          context.font = nameFont;
          const fittedName = fitText(displayName, availableTextWidth, nameFont);
          context.fillStyle = textColor;
          context.fillText(fittedName, textX, centerY + 9);
        } else {
          const nameFont = `800 19px ${fontFamily}`;
          context.font = nameFont;
          context.fillStyle = textColor;
          context.fillText(fitText(displayName, availableTextWidth, nameFont), textX, centerY + 7);
        }
        context.font = valueFont;
        context.fillStyle = value.startsWith("-") ? (theme === "dark" ? "#e6aa92" : "#eb7358") : (theme === "dark" ? "#9adbd6" : "#116a6a");
        context.textAlign = "right";
        context.fillText(value, valueX, centerY + (isMedal ? 10 : 7));
        context.textAlign = "left";
      });
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("PNG画像を作成できませんでした");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${topMetricDownloadNames[topMetric]}_${downloadDateKey(selectedTopDate)}.png`;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice({ tone: "success", message: "ランキング画像をPNG形式で保存しました。" });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "TOP15画像を保存できませんでした" });
    }
  };

  const handleAccountInputKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const target = event.currentTarget;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    setAccountInput(`${accountInput.slice(0, start)}\n${accountInput.slice(end)}`);
    window.requestAnimationFrame(() => {
      target.selectionStart = start + 1;
      target.selectionEnd = start + 1;
    });
  };

  const collect = async () => {
    if (!isAdmin || isLoading || collectInFlight.current) return;
    const handles = parseLines(accountInput);
    if (!handles.length) { setNotice({ tone: "error", message: "アカウントを入力してください。" }); return; }
    if (handles.length > MAX_ACCOUNTS && !window.confirm(`${handles.length}件の入力があります。先頭${MAX_ACCOUNTS}件だけ取得します。続けますか？`)) return;
    collectInFlight.current = true;
    setIsLoading(true);
    setNotice(null);
    try {
      const payload = await requestCollect(handles);
      const nextRows = payload.rows ?? [];
      setRows(nextRows);
      await syncCurrentAvatars(nextRows);
      setSelectedHandles((current) => {
        if (chartSelectionInitialized.current) return current;
        chartSelectionInitialized.current = true;
        return nextRows.filter((row) => row.status === "ok").slice(0, 8).map((row) => row.handle.toLowerCase());
      });
      await loadHistory();
      const warnings = payload.warnings?.length ? ` ${payload.warnings.join(" ")}` : "";
      setNotice({ tone: payload.rows?.some((row) => row.status === "error") ? "error" : "success", message: `${payload.rows?.filter((row) => row.status === "ok").length ?? 0}件のデータを取得しました。${warnings}` });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "データ取得に失敗しました" });
    } finally {
      collectInFlight.current = false;
      setIsLoading(false);
    }
  };

  const exportWorkbook = async () => {
    if (isExporting || exportInFlight.current || !isAdmin) return;
    exportInFlight.current = true;
    setIsExporting(true);
    setNotice({ tone: "info", message: `${FRESH_WORKBOOK_SHEETS.length}シートのExcelを準備しています…` });
    try {
      const latestRunId = historyRows.reduce((latest, row) => row.fetched_at > latest.fetched_at ? row : latest, historyRows[0] ?? { fetched_at: "", run_id: "" }).run_id;
      const latestHistoryRows = historyRows.filter((row) => row.run_id === latestRunId);
      const latestRowsForExport: ExportRow[] = latestHistoryRows.map((row) => ({ fetchedAt: row.fetched_at, accountId: row.account_id, handle: row.handle, displayName: resolvedDisplayName(row, displayNameOverrides), accountStatus: row.account_status, followers: row.followers, following: row.following, posts: row.posts }));
      const historyRowsForExport: ExportRow[] = historyRows.map((row) => ({ fetchedAt: row.fetched_at, accountId: row.account_id, handle: row.handle, displayName: resolvedDisplayName(row, displayNameOverrides), accountStatus: row.account_status, followers: row.followers, following: row.following, posts: row.posts }));
      const allHistoryRows = [...historyRowsForExport, ...latestRowsForExport];
      const generated = buildFreshWorkbook({ latestRows: latestRowsForExport, historyRows: allHistoryRows });
      if (generated.sheetNames.length !== FRESH_WORKBOOK_SHEETS.length) throw new Error(`Excelのシート数が${FRESH_WORKBOOK_SHEETS.length}ではありません（${generated.sheetNames.length}シート）。`);
      const outputWorkbook = XLSX.read(generated.bytes, { type: "array", cellStyles: true });
      const exportHistorySheets = new Set<string>([
        WORKBOOK_SHEETS.dailyFollowers, WORKBOOK_SHEETS.dailyFollowing, WORKBOOK_SHEETS.dailyPosts,
      ]);
      for (const sheetName of outputWorkbook.SheetNames) applyExportSheetFormatting(outputWorkbook.Sheets[sheetName], exportHistorySheets.has(sheetName));
      const outputBytes = XLSX.write(outputWorkbook, { bookType: "xlsx", type: "array", cellStyles: true });
      const verification = XLSX.read(outputBytes, { type: "array", cellStyles: true });
      if (verification.SheetNames.length !== FRESH_WORKBOOK_SHEETS.length || verification.SheetNames.some((name, index) => name !== generated.sheetNames[index])) throw new Error(`出力されたExcelの${FRESH_WORKBOOK_SHEETS.length}シート確認に失敗しました。`);
      const blob = new Blob([outputBytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `複垢データベース${formatWorkbookFileDate()}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice({ tone: "success", message: `Excelに${FRESH_WORKBOOK_SHEETS.length}シートを書き出しました。D1履歴データ${allHistoryRows.length ? `（${allHistoryRows.length}件）` : ""}を確認済みです。` });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "xlsxの作成に失敗しました。" });
    } finally {
      exportInFlight.current = false;
      setIsExporting(false);
    }
  };

  const toggleHandle = (handle: string) => {
    chartSelectionInitialized.current = true;
    setSelectedHandles((current) => current.includes(handle) ? current.filter((item) => item !== handle) : [...current, handle]);
  };
  const setAllHandles = (enabled: boolean) => {
    chartSelectionInitialized.current = true;
    setSelectedHandles((current) => updateChartSelection(current, chartPickerFilteredOptions, enabled));
  };
  const updateChartStatusFilter = (nextStatuses: AccountStatus[]) => {
    chartSelectionInitialized.current = true;
    const newlyEnabled = new Set(nextStatuses.filter((status) => !chartStatusFilter.includes(status)));
    const newlyDisabled = new Set(chartStatusFilter.filter((status) => !nextStatuses.includes(status)));
    const handlesToRemove = new Set(chartAccountOptions.filter((row) => newlyDisabled.has(row.accountStatus)).map((row) => row.handle.toLowerCase()));
    const handlesToAdd = chartAvailableAccountOptions.filter((row) => newlyEnabled.has(row.accountStatus)).map((row) => row.handle.toLowerCase());
    setSelectedHandles((current) => {
      const remaining = current.filter((handle) => !handlesToRemove.has(handle));
      const selected = new Set(remaining);
      for (const handle of handlesToAdd) selected.add(handle);
      return [...selected];
    });
    setChartStatusFilter(nextStatuses);
  };
  const toggleTheme = () => setTheme((current) => current === "dark" ? "light" : "dark");
  const effectiveBarColor = barColor ?? (theme === "dark" ? "#52b7b1" : "#249a94");
  const latestCollectionLabel = latestCollection
    ? `最終取得: ${new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(latestCollection.fetched_at))} JST · 成功 ${formatNumber(latestCollection.success_count)}件 / 失敗 ${formatNumber(latestCollection.error_count)}件`
    : "最終取得: 取得記録なし";

  return (
    <main className="site-shell">
      <header className="topbar editorial-topbar">
        <div className="brand editorial-brand"><div className="brand-mark editorial-brand-mark" role="img" aria-label="グラフマーク"><span className="brand-bar brand-bar-short" /><span className="brand-bar brand-bar-medium" /><span className="brand-bar brand-bar-tall" /></div><div className="editorial-brand-copy"><p className="eyebrow">ACCOUNT INTELLIGENCE</p><p className="brand-name">複垢データベース</p></div></div>
        <div className="topbar-meta editorial-topbar-meta"><div className="collection-status-meta"><span>取得元: fxTwitter</span><span>{latestCollectionLabel}</span></div><span className="topbar-divider" /><span>公開共有モード</span><button className="theme-toggle editorial-theme-toggle" type="button" onClick={toggleTheme} aria-pressed={theme === "dark"}>{theme === "dark" ? "☼ ライト" : "◐ ダーク"}</button></div>
      </header>

      <section className="hero-section">
        {isAdmin ? <section className="input-card panel-card">
          <div className="section-heading"><div><p className="eyebrow">INPUT SOURCES</p><h2>調べたいアカウントを追加</h2></div><AppBadge tone="accent">最大 {MAX_ACCOUNTS} 件</AppBadge></div>
          <div className="input-grid input-grid-single">
            <label className="field-group"><span className="field-label">アカウント</span><span className="field-help">@username またはプロフィールURLを改行区切りで入力</span><textarea value={accountInput} onChange={(event) => setAccountInput(event.target.value)} onKeyDown={handleAccountInputKeyDown} placeholder="@openai\n@xdevelopers\nhttps://x.com/username" rows={3} aria-label="調べたいアカウント" /></label>
          </div>
          <div className="input-footer"><span className="input-count">{uniqueValues(parseLines(accountInput)).length} / {MAX_ACCOUNTS} アカウント</span><button type="button" className="primary-button" onClick={collect} disabled={isLoading}>{isLoading ? <><span className="button-spinner" />取得中…</> : <>データを取得する <span aria-hidden="true">↗</span></>}</button></div>

          {notice && <div className={`notice notice-${notice.tone}`} role="status"><span>{notice.tone === "success" ? "✓" : notice.tone === "error" ? "!" : "i"}</span>{notice.message}</div>}
        </section> : readMode === "public" ? <section className="public-readonly-card panel-card"><p className="eyebrow">PUBLIC DASHBOARD</p><h2>共有データを閲覧中</h2><p>取得データとグラフは公開されています。アカウント追加とExcel操作は管理者のみ利用できます。</p></section> : <section className="public-readonly-card panel-card"><p className="eyebrow">PRIVATE DASHBOARD</p><h2>閲覧には管理者ログインが必要です</h2><p>このサイトは非公開モードです。管理者ログイン後にアカウントデータを表示します。</p></section>}
        {notice && !isAdmin && <div className={`notice notice-${notice.tone}`} role="status"><span>{notice.tone === "success" ? "✓" : notice.tone === "error" ? "!" : "i"}</span>{notice.message}</div>}
      </section>

      <section className="summary-grid editorial-summary-grid">
        <div className="summary-card summary-card--accounts panel-card"><span className="summary-label">取得済みアカウント</span><strong>{formatNumber(successfulRows.length)}</strong><span className="summary-detail">{rows.length ? `${rows.filter((row) => row.status === "error").length}件のエラー` : "取得データを待っています"}</span></div>
        <div className="summary-card summary-card--followers panel-card"><span className="summary-label">フォロワー合計</span><strong>{formatNumber(totals.followers)}</strong><span className={`summary-detail ${deltaClass(summaryDeltas.followers)}`}>前回比 {formatDelta(summaryDeltas.followers)}</span></div>
        <div className="summary-card summary-card--posts panel-card"><span className="summary-label">投稿数合計</span><strong>{formatNumber(totals.posts)}</strong><span className={`summary-detail ${deltaClass(summaryDeltas.posts)}`}>前回比 {formatDelta(summaryDeltas.posts)}</span></div>
        <div className="summary-card summary-card--snapshots panel-card"><span className="summary-label">保存スナップショット</span><strong>{formatNumber(new Set(historyRows.map((row) => row.run_id)).size)}</strong><span className="summary-detail">匿名セッション内</span></div>
        {isAdmin && <button className={`fresh-export-button summary-card--export panel-card ${isExporting ? "is-preparing" : ""}`} type="button" onClick={() => void exportWorkbook()} disabled={isExporting || (!historyRows.length && !successfulRows.length)}><span className="export-icon">{isExporting ? <span className="button-spinner export-spinner" aria-hidden="true" /> : "↓"}</span><span><span className="summary-label">{isExporting ? "Excelを準備中…" : "データ出力"}</span><strong>Excelにデータを書き出す</strong></span></button>}
      </section>

      <div className="workspace-tabs editorial-workspace-tabs" role="tablist" aria-label="表示切り替え" onKeyDown={(event) => handleTabListKeyDown(event, isAdmin ? (["results", "chart", "historical"] as const) : (["results", "chart"] as const), (value) => setActiveTab(value))}>
        <button id="dashboard-tab-results" type="button" role="tab" aria-selected={activeTab === "results"} aria-controls="dashboard-panel-results" tabIndex={activeTab === "results" ? 0 : -1} className={activeTab === "results" ? "is-active" : ""} onClick={() => setActiveTab("results")}>取得データ</button>
        <button id="dashboard-tab-chart" type="button" role="tab" aria-selected={activeTab === "chart"} aria-controls="dashboard-panel-chart" tabIndex={activeTab === "chart" ? 0 : -1} className={activeTab === "chart" ? "is-active" : ""} onClick={() => setActiveTab("chart")}>グラフ表示</button>
        {isAdmin && <button id="dashboard-tab-historical" type="button" role="tab" aria-selected={activeTab === "historical"} aria-controls="dashboard-panel-historical" tabIndex={activeTab === "historical" ? 0 : -1} className={activeTab === "historical" ? "is-active" : ""} onClick={() => setActiveTab("historical")}>過去データ追加</button>}
      </div>

      <section className="workspace-grid">
        {activeTab === "results" ? <div key={activeTab} className="table-panel panel-card analysis-workspace-panel" role="tabpanel" id="dashboard-panel-results" aria-labelledby="dashboard-tab-results" tabIndex={0}><div className="section-heading"><div><p className="eyebrow">SNAPSHOT DATA</p><h2>取得データ</h2></div><div className="results-heading-actions">{selectedResultDate && resultsViewMode !== "top10" && <AppBadge>{selectedResultDate}</AppBadge>}<StatusFilter selected={statusFilter} onChange={setStatusFilter} /><div className="results-view-tabs" role="tablist" aria-label="取得データの表示形式" onKeyDown={(event) => handleTabListKeyDown(event, ["table", "compact", "top10"] as const, (value) => setResultsViewMode(value))}><button id="results-view-tab-table" type="button" role="tab" aria-selected={resultsViewMode === "table"} aria-controls="results-view-panel-table" tabIndex={resultsViewMode === "table" ? 0 : -1} className={resultsViewMode === "table" ? "is-active" : ""} onClick={() => setResultsViewMode("table")}>通常</button><button id="results-view-tab-compact" type="button" role="tab" aria-selected={resultsViewMode === "compact"} aria-controls="results-view-panel-compact" tabIndex={resultsViewMode === "compact" ? 0 : -1} className={resultsViewMode === "compact" ? "is-active" : ""} onClick={() => setResultsViewMode("compact")}>コンパクト</button><button id="results-view-tab-top10" type="button" role="tab" aria-selected={resultsViewMode === "top10"} aria-controls="results-view-panel-top10" tabIndex={resultsViewMode === "top10" ? 0 : -1} className={resultsViewMode === "top10" ? "is-active" : ""} onClick={() => setResultsViewMode("top10")}>ランキング</button></div></div></div>{resultsViewMode !== "top10" && <DateCalendar key={selectedResultDate} availableDates={resultAvailableDates} selectedDate={selectedResultDate} onDateChange={setResultDate} />}{resultsViewMode === "table" && <div id="results-view-panel-table" role="tabpanel" aria-labelledby="results-view-tab-table" tabIndex={0}><ResultsTable rows={visibleResultRows} onSort={handleSort} sortKey={sortKey} direction={sortDirection} previousByAccount={resultPreviousByAccount} displayNameOverrides={displayNameOverrides} onDisplayNameChange={updateDisplayName} /></div>}{resultsViewMode !== "table" && <div id="results-view-panel-table" role="tabpanel" aria-labelledby="results-view-tab-table" hidden />}{resultsViewMode === "compact" && <div id="results-view-panel-compact" role="tabpanel" aria-labelledby="results-view-tab-compact" tabIndex={0}><CompactResults rows={visibleResultRows} previousByAccount={resultPreviousByAccount} displayNameOverrides={displayNameOverrides} /></div>}{resultsViewMode !== "compact" && <div id="results-view-panel-compact" role="tabpanel" aria-labelledby="results-view-tab-compact" hidden />}{resultsViewMode === "top10" && <div id="results-view-panel-top10" role="tabpanel" aria-labelledby="results-view-tab-top10" tabIndex={0}><TopResults rows={rankingRows} topMetric={topMetric} onTopMetricChange={setTopMetric} previousByAccount={topPreviousByAccount} displayNameOverrides={displayNameOverrides} onDownloadImage={downloadTop15Image} availableDates={topAvailableDates} selectedDate={selectedTopDate} onDateChange={setTopDate} comparisonTargetDate={topComparisonTargetDate} onComparisonDateChange={setTopComparisonDate} expanded={topExpanded} onToggleExpanded={() => setTopExpanded((current) => !current)} /></div>}{resultsViewMode !== "top10" && <div id="results-view-panel-top10" role="tabpanel" aria-labelledby="results-view-tab-top10" hidden />}</div> : activeTab === "chart" ? <div key={activeTab} className="chart-panel panel-card analysis-workspace-panel" role="tabpanel" id="dashboard-panel-chart" aria-labelledby="dashboard-tab-chart" tabIndex={0}><div className="section-heading"><div><p className="eyebrow">VISUAL ANALYSIS</p><h2>グラフ表示</h2></div><div className="mode-switch" role="tablist" aria-label="グラフモード" onKeyDown={(event) => handleTabListKeyDown(event, ["compare", "trend"] as const, (value) => setChartMode(value))}><button id="chart-mode-tab-compare" aria-controls="chart-mode-panel-compare" tabIndex={chartMode === "compare" ? 0 : -1} role="tab" aria-selected={chartMode === "compare"} className={chartMode === "compare" ? "is-active" : ""} type="button" onClick={() => setChartMode("compare")}>比較</button><button id="chart-mode-tab-trend" aria-controls="chart-mode-panel-trend" tabIndex={chartMode === "trend" ? 0 : -1} role="tab" aria-selected={chartMode === "trend"} className={chartMode === "trend" ? "is-active" : ""} type="button" onClick={() => setChartMode("trend")}>推移</button></div></div>
          <div className={`chart-controls chart-controls-primary ${chartMode === "trend" ? "chart-controls-unified" : ""}`}>
            <label className="chart-title-control"><span>グラフタイトル</span><input type="text" value={chartTitle} onChange={(event) => setChartTitle(event.target.value)} placeholder="任意のタイトル" /></label><label><span>タイトル文字サイズ（pt）</span><input type="number" min="6" max="24" step="0.5" value={chartTitleFontSize} onChange={(event) => setChartTitleFontSize(Math.min(24, Math.max(6, Number(event.target.value) || 6)))} /></label>
            <label><span>指標</span><select value={effectiveChartMetric} onChange={(event) => setMetric(event.target.value as ChartMetric)}>{Object.entries(chartMetricLabels).map(([key, label]) => <option key={key} value={key} disabled={(chartMode === "trend" && (isChartDeltaMetric(key as ChartMetric) || key === "postsPerFollower")) || (chartMode === "compare" && key === "followersCumulativeDelta")}>{label}</option>)}</select></label>
            {chartMode === "trend" && <><label><span>集計単位</span><select value={granularity} onChange={(event) => setGranularity(event.target.value as Granularity)}><option value="day">日次</option><option value="week">週次</option><option value="month">月次</option></select></label><label><span>日付表示</span><select value={dateFormat} onChange={(event) => setDateFormat(event.target.value as "short" | "month" | "full")}><option value="short">月日</option><option value="month">年月</option><option value="full">年月日</option></select></label><label><span>期間（開始）</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label><span>期間（終了）</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label><label><span>表示アカウント</span><span className="selection-count">{selectedHandles.length}件選択</span></label></>}
            <span className="chart-control-spacer" /><button type="button" className="secondary-button chart-export-button" onClick={() => void chartExportRef.current?.()}>画像を保存</button>
          </div>
          {chartMode === "compare" && <div className="chart-controls chart-controls-secondary"><div className="chart-date-pair">{isChartDeltaMetric(effectiveChartMetric) ? <><DateCalendar key={`chart-comparison-${selectedChartComparisonDate}`} headingLabel="比較日（引く数）" size="small" availableDates={chartMetricDates.filter((date) => date < selectedCompareDate)} selectedDate={selectedChartComparisonDate} onDateChange={setChartComparisonDate} /><DateCalendar key={`chart-display-${selectedCompareDate}`} headingLabel="表示日（引かれる数）" size="small" availableDates={chartMetricDates} selectedDate={selectedCompareDate} onDateChange={setCompareDate} /></> : <DateCalendar key={`chart-display-${selectedCompareDate}`} headingLabel="比較日（JST）" size="small" availableDates={chartMetricDates} selectedDate={selectedCompareDate} onDateChange={setCompareDate} />}</div><label><span>表示アカウント</span><span className="selection-count">{selectedHandles.length}件選択</span></label></div>}
          <ChartSettingDisclosure title="数値軸の設定" detail="Enterで反映">
            <div className="axis-settings"><div className="axis-title">数値軸の設定 <span className="axis-commit-help">Enterで反映</span></div><label><span>軸の種類</span><select value={logScale && logScaleEligible ? "log" : "linear"} disabled={!logScaleEligible} onChange={(event) => setLogScale(event.target.value === "log")}><option value="linear">線形軸</option><option value="log">対数軸</option></select></label>{!logScaleEligible && <span className="axis-commit-help">表示中の値がすべて正のとき利用できます</span>}<label><span>最小値</span><input inputMode="numeric" placeholder="自動" value={yMinInput} onChange={(event) => setYMinInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setYMin(event.currentTarget.value); } }} /></label><label><span>最大値</span><input inputMode="numeric" placeholder="自動" value={yMaxInput} onChange={(event) => setYMaxInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setYMax(event.currentTarget.value); } }} /></label><label><span>主目盛間隔</span><input inputMode="numeric" placeholder="自動" value={yStepInput} onChange={(event) => setYStepInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setYStep(event.currentTarget.value); } }} /></label><label><span>補助目盛間隔</span><input inputMode="numeric" placeholder="自動" value={yMinorStepInput} onChange={(event) => setYMinorStepInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setYMinorStep(event.currentTarget.value); } }} /></label><label className="toggle-field"><input type="checkbox" checked={compactNumbers} onChange={(event) => setCompactNumbers(event.target.checked)} /><span>省略表記</span></label></div>
          </ChartSettingDisclosure>
          {chartMode === "compare" && <ChartSettingDisclosure title="棒グラフの表示設定"><div className="axis-settings chart-style-settings"><div className="axis-title">棒グラフの表示設定</div><label><span>ハンドル名サイズ</span><input type="number" min="5" max="16" step="0.5" value={compareLabelFontSize} onChange={(event) => setCompareLabelFontSize(Math.min(16, Math.max(5, Number(event.target.value) || 5)))} /></label><label><span>棒グラフの色</span><input type="color" value={effectiveBarColor} onChange={(event) => setBarColor(event.target.value)} aria-label="棒グラフの色" /></label></div></ChartSettingDisclosure>}
          {chartMode === "trend" && <ChartSettingDisclosure title="折れ線の設定"><div className="axis-settings chart-style-settings"><div className="axis-title">折れ線の設定</div><label><span>線の太さ</span><input type="number" min="1" max="8" step="0.1" value={trendLineWidth} onChange={(event) => setTrendLineWidth(Math.min(8, Math.max(1, Number(event.target.value) || 1)))} /></label><label><span>マーカーの大きさ</span><input type="number" min="0" max="8" step="0.1" value={markerSize} onChange={(event) => setMarkerSize(Math.min(8, Math.max(0, Number(event.target.value) || 0)))} /></label><label><span>マーカー外枠の太さ</span><input type="number" min="0" max="5" step="0.1" value={markerOutlineWidth} onChange={(event) => setMarkerOutlineWidth(Math.min(5, Math.max(0, Number(event.target.value) || 0)))} /></label><label><span>数値データのサイズ</span><input type="number" min="0" max="24" step="0.1" value={trendValueFontSize} onChange={(event) => setTrendValueFontSize(Math.min(24, Math.max(0, Number(event.target.value) || 0)))} /></label><label><span>数値軸の文字サイズ</span><input type="number" min="1" max="24" step="0.1" value={trendAxisFontSize} onChange={(event) => setTrendAxisFontSize(Math.min(24, Math.max(1, Number(event.target.value) || 1)))} /></label><label><span>日付軸の文字サイズ</span><input type="number" min="1" max="24" step="0.1" value={trendDateFontSize} onChange={(event) => setTrendDateFontSize(Math.min(24, Math.max(1, Number(event.target.value) || 1)))} /></label><label><span>数値データの色</span><select value={trendValueLabelColor} onChange={(event) => setTrendValueLabelColor(event.target.value as "series" | "black")}><option value="series">アカウント色</option><option value="black">黒一色</option></select></label><label><span>マーカー外枠色</span><input type="color" value={markerOutlineColor} onChange={(event) => setMarkerOutlineColor(event.target.value)} /></label><label className="toggle-field"><input type="checkbox" checked={showTrendLegend} onChange={(event) => setShowTrendLegend(event.target.checked)} /><span>凡例を表示</span></label></div></ChartSettingDisclosure>}
          <div key={chartRenderKey} className="chart-result-frame" id={"chart-mode-panel-" + chartMode} role="tabpanel" aria-labelledby={"chart-mode-tab-" + chartMode} tabIndex={0} data-transition-key={chartRenderKey}><SimpleChart mode={chartMode} metric={effectiveChartMetric} chartTitle={chartTitle} chartTitleFontSize={chartTitleFontSize} currentRows={successfulRows} historyRows={chartHistoryRows} selectedHandles={selectedChartHandles} compareDate={selectedCompareDate} comparisonDate={selectedChartComparisonDate} startDate={startDate} endDate={endDate} granularity={granularity} dateFormat={dateFormat} yMin={yMin} yMax={yMax} yStep={yStep} yMinorStep={yMinorStep} compactNumbers={compactNumbers} compareOrientation={compareOrientation} displayNameOverrides={displayNameOverrides} legendColors={legendColors} barColor={effectiveBarColor} trendLineWidth={trendLineWidth} markerSize={markerSize} markerOutlineWidth={markerOutlineWidth} markerOutlineColor={markerOutlineColor} trendValueFontSize={trendValueFontSize} trendAxisFontSize={trendAxisFontSize} trendDateFontSize={trendDateFontSize} trendValueLabelColor={trendValueLabelColor} compareLabelFontSize={compareLabelFontSize} theme={theme} showTrendLegend={showTrendLegend} logScale={logScale} onLogScaleEligibilityChange={(eligible) => setLogScaleEligible((current) => current === eligible ? current : eligible)} onExportReady={(handler) => { chartExportRef.current = handler; }} /></div>{chartMode !== "compare" && <div id="chart-mode-panel-compare" role="tabpanel" aria-labelledby="chart-mode-tab-compare" hidden />}{chartMode !== "trend" && <div id="chart-mode-panel-trend" role="tabpanel" aria-labelledby="chart-mode-tab-trend" hidden />}
          <ChartSettingDisclosure title="表示アカウント" detail={selectedChartHandles.length + "件選択"}>
            <div className="account-picker">
              <div className="account-picker-toolbar">
                <div className="legend-heading">表示アカウント</div>
                <div className="selection-actions">
                  <button type="button" onClick={() => setAllHandles(true)} disabled={!chartPickerFilteredOptions.length} aria-label="絞り込み中のアカウントを全てON">全てON</button>
                  <button type="button" onClick={() => setAllHandles(false)} disabled={!chartPickerFilteredOptions.length} aria-label="絞り込み中のアカウントを全てOFF">全てOFF</button>
                </div>
                <span className="selection-count">{selectedChartHandles.length}件選択</span>
              </div>
              <ChartStatusFilter selected={chartStatusFilter} onChange={updateChartStatusFilter} />
              <div className="chart-account-picker-filters">
                <label className="chart-account-search"><span className="visually-hidden">表示名・ハンドルで検索</span><input type="search" value={chartAccountQuery} onChange={(event) => setChartAccountQuery(event.target.value)} placeholder="表示名・ハンドルで検索" aria-label="グラフ表示アカウントを検索" /></label>
                <button type="button" className={"selected-only-toggle " + (chartSelectedOnly ? "is-active" : "")} aria-pressed={chartSelectedOnly} onClick={() => setChartSelectedOnly((current) => !current)}>選択済みのみ</button>
                <span className="selection-count">{chartPickerFilteredOptions.length}件表示</span>
              </div>
              {chartPickerFilteredOptions.length ? <div className="chart-account-groups">{chartPickerGroups.map((group) => <section className="chart-account-group" key={group.status} aria-labelledby={"chart-account-group-" + group.status}>
                <h3 id={"chart-account-group-" + group.status}>{ACCOUNT_STATUS_LABELS[group.status]} <span>{group.rows.length}件</span></h3>
                <div className="chart-account-group-list">{group.rows.map((row) => {
                  const handle = row.handle.toLowerCase();
                  const color = legendColors[handle] ?? defaultLegendColor(visibleChartAccountOptions.indexOf(row));
                  return <label key={row.id} className="account-check">
                    <input type="checkbox" checked={selectedHandles.includes(handle)} onChange={() => toggleHandle(handle)} />
                    <input type="color" className="legend-color-input" value={color} onClick={(event) => event.stopPropagation()} onChange={(event) => updateLegendColor(handle, event.target.value)} aria-label={row.handle + "のグラフ色"} />
                    <span className="check-dot" style={{ background: color }} />
                    <span className="legend-label"><strong>{row.displayName}</strong><small>{ACCOUNT_STATUS_LABELS[row.accountStatus]}</small></span>
                  </label>;
                })}</div>
              </section>)}</div> : <span className="muted-copy">{visibleChartAccountOptions.length ? "検索条件に一致するアカウントがありません。" : chartMode === "compare" ? "この条件で表示できるアカウントがありません。" : "取得後に表示アカウントを選択できます。"}</span>}
            </div>
          </ChartSettingDisclosure>
          <div className="chart-footnote"><span className="legend-line" />{chartMetricLabels[effectiveChartMetric]} <span className="chart-footnote-divider" /> {chartMode === "compare" ? "最新取得値" : "保存済みスナップショット"}</div>
        </div> : <HistoricalDataEditor key={activeTab} onSaved={async () => { await loadHistory(); setNotice({ tone: "success", message: "過去データをサイト履歴へ反映しました。" }); }} />}

        {activeTab !== "results" && <div id="dashboard-panel-results" role="tabpanel" aria-labelledby="dashboard-tab-results" hidden />}
        {activeTab !== "chart" && <div id="dashboard-panel-chart" role="tabpanel" aria-labelledby="dashboard-tab-chart" hidden />}
        {isAdmin && activeTab !== "historical" && <div id="dashboard-panel-historical" role="tabpanel" aria-labelledby="dashboard-tab-historical" hidden />}
      </section>

      <footer className="site-footer"><span className="site-version">{siteVersion}</span>{historyError && <span>履歴: {historyError}</span>}<span className="admin-access-area">{isAdmin ? <button type="button" className="text-button" onClick={() => void logoutAdmin()}>管理者ログアウト</button> : <button type="button" className="text-button" onClick={() => setAdminLoginOpen((current) => !current)}>管理者ログイン</button>}{adminLoginOpen && !isAdmin && <span className="admin-login-box"><input type="password" value={adminKeyInput} onChange={(event) => { setAdminKeyInput(event.target.value); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void loginAdmin(); } }} placeholder="管理者キー" aria-label="管理者キー" /><button type="button" className="secondary-button" onClick={() => void loginAdmin()} disabled={isAdminLoggingIn}>{isAdminLoggingIn ? "確認中…" : "認証"}</button></span>}</span></footer>
    </main>
  );
}
