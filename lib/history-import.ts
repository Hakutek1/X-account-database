import * as XLSX from "xlsx";
import { DAILY_HISTORY_SHEET_METRICS, workbookSheetCandidates } from "./workbook-sheet-names.ts";

export const IMPORT_CUTOFF = "2026-07-22";

export type ImportMetric = "followers" | "following" | "posts";

export type SourceObservation = {
  sourceName: string;
  sourceKey: string;
  sourceSheet: string;
  metric: ImportMetric;
  date: string;
  value: number;
};

export type SourceImportPreview = {
  observations: SourceObservation[];
  sourceNames: string[];
  dateColumns: string[];
  warnings: string[];
  excludedSheets: string[];
};

export type ImportAccountCandidate = {
  accountId: string;
  handle: string;
  displayName: string;
};

export type ImportReviewItem = {
  sourceName: string;
  sourceKey: string;
  observationCount: number;
  firstDate: string;
  lastDate: string;
  candidates: ImportAccountCandidate[];
};

export type ApprovedImportMapping = {
  sourceName: string;
  sourceKey: string;
  accountId: string;
  handle: string;
  displayName: string;
};

export type ImportSnapshot = {
  date: string;
  fetchedAt: string;
  accountId: string;
  handle: string;
  displayName: string;
  followers: number | null;
  following: number | null;
  posts: number | null;
  sourceNames: string[];
  sourceSheets: string[];
};

export type ImportIssue = {
  issueType: "unmatched" | "conflict" | "source-duplicate";
  sourceSheet: string;
  sourceName: string;
  accountId: string | null;
  handle: string | null;
  displayName: string | null;
  date: string | null;
  metric: ImportMetric | null;
  sourceValue: number | null;
  siteValue: number | null;
  details: string;
};

export type ExistingHistoryForImport = {
  fetched_at: string;
  account_id: string;
  handle: string;
  display_name: string;
  followers: number | null;
  following: number | null;
  posts: number | null;
};

const SHEET_METRICS: Array<[string, ImportMetric]> = [
  ["フォロワー数", "followers"],
  ["フォロー数", "following"],
  ["ポスト数", "posts"],
];

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function normalizeSourceName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, "").toLocaleLowerCase("ja-JP");
}

function excelSerialToDate(serial: number) {
  const timestamp = Date.UTC(1899, 11, 30) + serial * 86400000;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function sourceDate(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return excelSerialToDate(value);
  if (value instanceof Date && Number.isFinite(value.getTime())) return new Date(value.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
  if (typeof value !== "string") return null;
  const isoMatch = value.trim().match(/^\d{4}-\d{2}-\d{2}(?:T|\s)/);
  if (isoMatch) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return new Date(parsed.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
  }
  const normalized = value.trim().replaceAll(".", "/").replaceAll("-", "/");
  const match = normalized.match(/^(\d{2}|\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;
  const year = match[1].length === 2 ? `20${match[1]}` : match[1];
  const date = `${year}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

function sheetRows(workbook: XLSX.WorkBook, name: string) {
  const sheet = workbook.Sheets[name];
  if (!sheet) return [] as unknown[][];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }) as unknown[][];
}

export function parseSourceWorkbook(workbook: XLSX.WorkBook): SourceImportPreview {
  const observations: SourceObservation[] = [];
  const names = new Set<string>();
  const dates = new Set<string>();
  const warnings: string[] = [];
  const excludedSheets = workbook.SheetNames.filter((name) => name.trim() === "フォロワー数 (2)");

  for (const [sheetName, metric] of SHEET_METRICS) {
    const candidates = workbook.SheetNames.filter((name) => name.trim() === sheetName && name.trim() !== "フォロワー数 (2)");
    const selectedSheet = candidates
      .map((name) => ({ name, score: sheetRows(workbook, name).slice(1).reduce((total, row) => total + row.slice(1).filter((value) => typeof value === "number" && Number.isFinite(value)).length, 0) }))
      .sort((left, right) => right.score - left.score || (left.name === sheetName ? -1 : 1))[0]?.name;
    if (!selectedSheet) {
      warnings.push(`必須シート「${sheetName}」が見つかりません。`);
      continue;
    }

    if (candidates.length > 1) {
      const ignored = candidates.filter((name) => name !== selectedSheet);
      warnings.push(`「${sheetName}」に相当するシートが複数あるため、数値データが多い「${selectedSheet}」を採用しました。${ignored.join("、")}は統合対象から除外しました。`);
    }

    const rows = sheetRows(workbook, selectedSheet);
    const header = rows[0] ?? [];
    const dateColumns = header.map((value, index) => ({ index, date: sourceDate(value) })).filter((item): item is { index: number; date: string } => Boolean(item.date) && item.date <= IMPORT_CUTOFF);
    for (const column of dateColumns) {
      dates.add(column.date);
      for (const row of rows.slice(1)) {
        const sourceName = typeof row[0] === "string" ? row[0].trim() : "";
        const value = row[column.index];
        if (!sourceName || typeof value !== "number" || !Number.isFinite(value)) continue;
        const sourceKey = normalizeSourceName(sourceName);
        names.add(sourceName);
        observations.push({ sourceName, sourceKey, sourceSheet: selectedSheet, metric, date: column.date, value });
      }
    }
  }

  if (excludedSheets.length) warnings.push("「フォロワー数 (2)」は重複シートとして統合対象から除外しました。");
  if (!observations.length) warnings.push(`2026/7/22以前の数値データが見つかりませんでした。`);

  return {
    observations,
    sourceNames: [...names].sort((left, right) => left.localeCompare(right, "ja")),
    dateColumns: [...dates].sort(),
    warnings,
    excludedSheets,
  };
}

/** Read the three daily-history sheets so historical-only Excel accounts can be charted. */
export function parseDailyHistoryWorkbook(workbook: XLSX.WorkBook): ExistingHistoryForImport[] {
  const grouped = new Map<string, ExistingHistoryForImport>();
  const dailySheets = DAILY_HISTORY_SHEET_METRICS;

  for (const [canonicalSheetName, metric] of dailySheets) {
    const sheetName = workbookSheetCandidates(canonicalSheetName).find((candidate) => Boolean(workbook.Sheets[candidate]));
    if (!sheetName) continue;
    const rows = sheetRows(workbook, sheetName);
    const header = rows[0] ?? [];
    const dateColumns = header.map((value, index) => ({ index, date: sourceDate(value) })).filter((item): item is { index: number; date: string } => Boolean(item.date));
    for (const row of rows.slice(1)) {
      const rawAccountId = typeof row[0] === "string" ? row[0].trim() : "";
      const rawHandle = typeof row[1] === "string" ? row[1].trim().replace(/^@/, "") : "";
      const displayName = typeof row[2] === "string" ? row[2].trim() : "";
      const identity = rawAccountId || rawHandle || displayName;
      if (!identity) continue;
      const accountId = rawAccountId || `excel:${normalizeSourceName(identity)}`;
      const handle = rawHandle || normalizeSourceName(displayName);
      for (const column of dateColumns) {
        const value = row[column.index];
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        const key = `${accountId}|${column.date}`;
        const current = grouped.get(key) ?? {
          fetched_at: importedTimestamp(column.date),
          account_id: accountId,
          handle,
          display_name: displayName || handle,
          followers: null,
          following: null,
          posts: null,
        };
        current[metric] = value;
        grouped.set(key, current);
      }
    }
  }

  return [...grouped.values()].sort((left, right) => left.fetched_at.localeCompare(right.fetched_at) || left.handle.localeCompare(right.handle, "ja"));
}

function candidateScore(sourceKey: string, candidate: ImportAccountCandidate) {
  const displayKey = normalizeSourceName(candidate.displayName);
  const handleKey = normalizeSourceName(candidate.handle);
  if (sourceKey === displayKey || sourceKey === handleKey) return 100;
  if (displayKey.includes(sourceKey) || handleKey.includes(sourceKey)) return 85;
  if (sourceKey.includes(displayKey) || sourceKey.includes(handleKey)) return 80;
  return 0;
}

export function buildImportReview(preview: SourceImportPreview, candidates: ImportAccountCandidate[]) {
  return preview.sourceNames.map((sourceName): ImportReviewItem => {
    const sourceKey = normalizeSourceName(sourceName);
    const observations = preview.observations.filter((observation) => observation.sourceKey === sourceKey);
    const ranked = candidates
      .map((candidate) => ({ candidate, score: candidateScore(sourceKey, candidate) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.candidate.handle.localeCompare(right.candidate.handle, "ja"))
      .map((item) => item.candidate);
    const rest = candidates.filter((candidate) => !ranked.some((item) => item.accountId === candidate.accountId)).sort((left, right) => left.handle.localeCompare(right.handle, "ja"));
    return {
      sourceName,
      sourceKey,
      observationCount: observations.length,
      firstDate: observations.map((item) => item.date).sort()[0] ?? "",
      lastDate: observations.map((item) => item.date).sort().at(-1) ?? "",
      candidates: [...ranked, ...rest],
    };
  });
}

/** Keep the currently selected account visible while hiding accounts assigned to another source name. */
export function availableImportCandidates(item: ImportReviewItem, mappings: Readonly<Record<string, string>>) {
  const selectedAccountId = mappings[item.sourceKey] ?? "";
  const selectedElsewhere = new Set(
    Object.entries(mappings)
      .filter(([sourceKey, accountId]) => sourceKey !== item.sourceKey && accountId)
      .map(([, accountId]) => accountId),
  );
  return item.candidates.filter((candidate) => candidate.accountId === selectedAccountId || !selectedElsewhere.has(candidate.accountId));
}

function jstCalendarDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Tokyo" }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function importedTimestamp(date: string) {
  return new Date(`${date}T00:00:00.001+09:00`).toISOString();
}

export function mergeImportedSnapshots(preview: SourceImportPreview, mappings: ApprovedImportMapping[], existingRows: ExistingHistoryForImport[]) {
  const mappingBySource = new Map(mappings.map((mapping) => [mapping.sourceKey, mapping]));
  const grouped = new Map<string, ImportSnapshot>();
  const issues: ImportIssue[] = [];

  for (const sourceName of preview.sourceNames) {
    const sourceKey = normalizeSourceName(sourceName);
    const mapping = mappingBySource.get(sourceKey);
    const sourceObservations = preview.observations.filter((observation) => observation.sourceKey === sourceKey);
    if (!mapping) {
      const byDate = new Map<string, SourceObservation[]>();
      for (const observation of sourceObservations) byDate.set(observation.date, [...(byDate.get(observation.date) ?? []), observation]);
      for (const [date, observations] of byDate) {
        issues.push({ issueType: "unmatched", sourceSheet: [...new Set(observations.map((item) => item.sourceSheet))].join(", "), sourceName, accountId: null, handle: null, displayName: null, date, metric: null, sourceValue: null, siteValue: null, details: "サイトのアカウントとの対応が確認されていません。" });
      }
      continue;
    }

    for (const observation of sourceObservations) {
      const key = `${mapping.accountId}|${observation.date}`;
      const current = grouped.get(key) ?? (() => {
        const sameDay = existingRows.filter((row) => row.account_id === mapping.accountId && jstCalendarDate(row.fetched_at) === observation.date).sort((left, right) => new Date(right.fetched_at).getTime() - new Date(left.fetched_at).getTime())[0];
        return {
          date: observation.date,
          fetchedAt: importedTimestamp(observation.date),
          accountId: mapping.accountId,
          handle: mapping.handle,
          displayName: mapping.displayName,
          followers: sameDay?.followers ?? null,
          following: sameDay?.following ?? null,
          posts: sameDay?.posts ?? null,
          sourceNames: [],
          sourceSheets: [],
          sourceMetrics: new Set<string>(),
        };
      })();
      const metricBefore = current[observation.metric];
      const sourceMetricKey = `${observation.sourceName}|${observation.metric}`;
      const hasSourceMetric = current.sourceMetrics.has(sourceMetricKey);
      if (metricBefore !== null && metricBefore !== observation.value && !hasSourceMetric) {
        const sameDaySite = existingRows.find((row) => row.account_id === mapping.accountId && jstCalendarDate(row.fetched_at) === observation.date);
        issues.push({ issueType: "conflict", sourceSheet: observation.sourceSheet, sourceName: observation.sourceName, accountId: mapping.accountId, handle: mapping.handle, displayName: mapping.displayName, date: observation.date, metric: observation.metric, sourceValue: observation.value, siteValue: metricBefore, details: "同じアカウント・同じ日付のため、元Excelの値を採用しました。" });
        if (!sameDaySite) issues.pop();
      }
      if (metricBefore !== null && metricBefore !== observation.value && hasSourceMetric) {
        issues.push({ issueType: "source-duplicate", sourceSheet: observation.sourceSheet, sourceName: observation.sourceName, accountId: mapping.accountId, handle: mapping.handle, displayName: mapping.displayName, date: observation.date, metric: observation.metric, sourceValue: observation.value, siteValue: metricBefore, details: "元Excel内で同じ名称・日付・指標が重複したため、後の値を採用しました。" });
      }
      current[observation.metric] = observation.value;
      current.sourceMetrics.add(sourceMetricKey);
      if (!current.sourceNames.includes(observation.sourceName)) current.sourceNames.push(observation.sourceName);
      if (!current.sourceSheets.includes(observation.sourceSheet)) current.sourceSheets.push(observation.sourceSheet);
      grouped.set(key, current);
    }
  }

  return {
    snapshots: [...grouped.values()]
      .map((item) => {
        const { sourceMetrics, ...snapshot } = item;
        void sourceMetrics;
        return snapshot;
      })
      .sort((left, right) => left.date.localeCompare(right.date) || left.handle.localeCompare(right.handle, "ja")),
    issues,
  };
}
