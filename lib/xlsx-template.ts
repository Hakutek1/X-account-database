import { unzipSync, zipSync } from "fflate";
import { threeHourExportBucket, type ThreeHourExportBucket } from "./export-buckets.ts";
import { LEGACY_WORKBOOK_SHEET_ALIASES, MANAGED_WORKBOOK_SHEETS, WORKBOOK_SHEETS, workbookSheetCandidates } from "./workbook-sheet-names.ts";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function decode(bytes: Uint8Array) {
  return textDecoder.decode(bytes);
}
function encode(value: string) {
  return textEncoder.encode(value);
}

function xmlEscape(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function xmlUnescape(value: string) {
  return value.replaceAll("&apos;", "'").replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&");
}

function maxNumber(values: string[], fallback: number) {
  const numbers = values.map((value) => Number(value)).filter(Number.isFinite);
  return numbers.length ? Math.max(...numbers) : fallback;
}

function relationshipTarget(xml: string, relationshipId: string) {
  const escapedId = relationshipId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<Relationship\\b[^>]*Id=["']${escapedId}["'][^>]*Target=["']([^"']+)["'][^>]*/?>`));
  if (!match) return null;
  const target = match[1].replace(/^\//, "");
  return target.startsWith("xl/") ? target : `xl/${target}`;
}

function extractSharedStrings(xml: string | null) {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => [...match[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((item) => xmlUnescape(item[1])).join(""));
}

function addCellStyle(attributes: string, styleIndex: number | null) {
  return styleIndex === null ? attributes : `${attributes} s="${styleIndex}"`;
}

function normalizeWorksheetXml(xml: string, sharedStrings: string[], styleIndex: number | null) {
  const normalized = xml.replace(/<c\b([^>]*)>([\s\S]*?)<\/c>/g, (_cell, attributes: string, body: string) => {
    const styleFreeAttributes = attributes.replace(/\s+s=["'][^"']*["']/g, "");
    const sharedIndex = attributes.match(/\bt=["']s["']/) ? body.match(/<v>(\d+)<\/v>/)?.[1] : null;
    if (sharedIndex !== null && sharedIndex !== undefined) {
      const value = sharedStrings[Number(sharedIndex)] ?? "";
      const inlineAttributes = addCellStyle(styleFreeAttributes.replace(/\s+t=["']s["']/, ' t="inlineStr"'), styleIndex);
      return `<c${inlineAttributes}><is><t>${xmlEscape(value)}</t></is></c>`;
    }
    return `<c${addCellStyle(styleFreeAttributes, styleIndex)}>${body}</c>`;
  });
  return normalized.replace(/<c\b([^>]*)\/>/g, (_cell, attributes: string) => {
    const styleFreeAttributes = attributes.replace(/\s+s=["'][^"']*["']/g, "");
    return `<c${addCellStyle(styleFreeAttributes, styleIndex)}/>`;
  });
}

function generatedSheets(generatedFiles: Record<string, Uint8Array>, styleIndex: number | null) {
  const workbookXml = decode(generatedFiles["xl/workbook.xml"]);
  const relationshipsXml = decode(generatedFiles["xl/_rels/workbook.xml.rels"]);
  const sharedStrings = extractSharedStrings(generatedFiles["xl/sharedStrings.xml"] ? decode(generatedFiles["xl/sharedStrings.xml"]) : null);
  const items: Array<{ name: string; path: string; xml: string }> = [];
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const attributes = match[1];
    const name = attributes.match(/\bname=["']([^"']+)["']/)?.[1];
    const relationshipId = attributes.match(/\br:id=["']([^"']+)["']/)?.[1];
    if (!name || !relationshipId) continue;
    const path = relationshipTarget(relationshipsXml, relationshipId);
    if (!path || !generatedFiles[path]) continue;
    items.push({ name: xmlUnescape(name), path, xml: normalizeWorksheetXml(decode(generatedFiles[path]), sharedStrings, styleIndex) });
  }
  return items;
}

function addGridCellStyle(stylesXml: string) {
  const fontsMatch = stylesXml.match(/<fonts\b([^>]*)>([\s\S]*?)<\/fonts>/);
  const bordersMatch = stylesXml.match(/<borders\b([^>]*)>([\s\S]*?)<\/borders>/);
  const cellXfsMatch = stylesXml.match(/<cellXfs\b([^>]*)>([\s\S]*?)<\/cellXfs>/);
  if (!fontsMatch || !bordersMatch || !cellXfsMatch) return { xml: stylesXml, styleIndex: null as number | null };

  const fontCount = Number(fontsMatch[1].match(/\bcount=["'](\d+)["']/)?.[1] ?? 0);
  const borderCount = Number(bordersMatch[1].match(/\bcount=["'](\d+)["']/)?.[1] ?? 0);
  const cellXfsCount = Number(cellXfsMatch[1].match(/\bcount=["'](\d+)["']/)?.[1] ?? 0);
  const exportFont = `<font><sz val="12"/><name val="游ゴシック"/><family val="2"/></font>`;
  const gridColor = "FFB8C4D3";
  const gridBorder = `<border><left style="thin"><color rgb="${gridColor}"/></left><right style="thin"><color rgb="${gridColor}"/></right><top style="thin"><color rgb="${gridColor}"/></top><bottom style="thin"><color rgb="${gridColor}"/></bottom><diagonal/></border>`;
  const gridXf = `<xf numFmtId="0" fontId="${fontCount}" fillId="0" borderId="${borderCount}" xfId="0" applyFont="1" applyBorder="1"/>`;
  const updatedFonts = `<fonts${fontsMatch[1].replace(/\bcount=["']\d+["']/, `count="${fontCount + 1}"`)}>${fontsMatch[2]}${exportFont}</fonts>`;
  const updatedBorders = `<borders${bordersMatch[1].replace(/\bcount=["']\d+["']/, `count="${borderCount + 1}"`)}>${bordersMatch[2]}${gridBorder}</borders>`;
  const updatedCellXfs = `<cellXfs${cellXfsMatch[1].replace(/\bcount=["']\d+["']/, `count="${cellXfsCount + 1}"`)}>${cellXfsMatch[2]}${gridXf}</cellXfs>`;
  return { xml: stylesXml.replace(fontsMatch[0], updatedFonts).replace(bordersMatch[0], updatedBorders).replace(cellXfsMatch[0], updatedCellXfs), styleIndex: cellXfsCount };
}

type MergeIssue = {
  issueType: "conflict" | "duplicate" | "unmatched";
  sheet: string;
  accountId?: string;
  handle?: string;
  date?: string;
  metric?: string;
  existingValue?: string | number | null;
  siteValue?: string | number | null;
  details: string;
};

type IncrementalMergeResult = {
  bytes: Uint8Array;
  issues: MergeIssue[];
  updatedSheets: string[];
};

const LATEST_SHEET = WORKBOOK_SHEETS.latest;
const HISTORY_SHEETS = new Set(MANAGED_WORKBOOK_SHEETS.slice(1));
const MANAGED_SHEETS = new Set(MANAGED_WORKBOOK_SHEETS);
const SITE_PRIORITY_CUTOFF = "2026-07-23";

function normalizeIdentity(value: unknown) {
  return String(value ?? "").trim().replace(/^@/, "").toLowerCase();
}

function xmlCellValue(cellXml: string, sharedStrings: string[]) {
  const type = cellXml.match(/\bt=["']([^"']+)["']/)?.[1];
  const value = cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1];
  if (type === "inlineStr") return xmlUnescape(cellXml.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/)?.[1] ?? "");
  if (type === "s" && value !== undefined) return xmlUnescape(sharedStrings[Number(value)] ?? "");
  if (type === "str") return xmlUnescape(value ?? "");
  if (value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : xmlUnescape(value);
}

function cellMapFromWorksheet(xml: string) {
  const cells = new Map<string, string>();
  for (const match of xml.matchAll(/<c\b([^>]*)(?:\/>|>[\s\S]*?<\/c>)/g)) {
    const address = match[1].match(/\br=["']([^"']+)["']/)?.[1];
    if (address) cells.set(address, match[0]);
  }
  return cells;
}

function rowNumber(address: string) {
  return Number(address.match(/\d+$/)?.[0] ?? 0);
}

function columnNumber(address: string) {
  const letters = address.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? "A";
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return result;
}

function addressFor(column: number, row: number) {
  let value = column;
  let letters = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return `${letters}${row}`;
}

function excelSerialDate(serial: number, includeTime = false) {
  if (!Number.isFinite(serial) || serial < 1) return null;
  const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
  if (Number.isNaN(date.getTime())) return null;
  const datePart = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  if (!includeTime) return datePart;
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  return `${datePart} ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function canonicalDateHeader(value: string | number | null, fullHistory: boolean) {
  if (typeof value === "number") {
    const date = excelSerialDate(value);
    return date ? (fullHistory ? excelSerialDate(value, true)! : date) : null;
  }
  if (value === null || value === "") return null;
  const normalized = String(value).normalize("NFKC").trim().replace(/[.\-]/g, "/").replace(/\s+/g, " ");
  const match = normalized.match(/^(\d{2}|\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?)?$/);
  if (!match) return null;
  const year = match[1].length === 2 ? `20${match[1]}` : match[1];
  const date = `${year}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  if (!fullHistory) return date;
  return `${date} ${match[4]?.padStart(2, "0") ?? "00"}:${match[5] ?? "00"}`;
}

function dateHeaderInfo(value: string | number | null, fullHistory: boolean) {
  const canonical = canonicalDateHeader(value, fullHistory);
  if (!canonical) return null;
  if (!fullHistory) return { key: canonical, label: String(value) };
  const date = new Date(`${canonical.replace(" ", "T")}:00+09:00`);
  const bucket = threeHourExportBucket(date);
  return bucket ? { key: bucket.key, label: bucket.label, bucket } : null;
}

function cellXml(address: string, value: string | number, existingXml: string | undefined, styleIndex: number | null) {
  const style = existingXml?.match(/\bs=["']([^"']+)["']/)?.[1] ?? (styleIndex === null ? null : String(styleIndex));
  const styleAttribute = style === null ? "" : ` s="${style}"`;
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${address}"${styleAttribute}><v>${value}</v></c>`;
  const text = xmlEscape(String(value));
  return `<c r="${address}"${styleAttribute} t="inlineStr"><is><t>${text}</t></is></c>`;
}

function replaceStyle(cell: string, styleIndex: number | null) {
  if (styleIndex === null) return cell;
  const attributes = cell.match(/^<c\b([^>]*)>/)?.[1] ?? "";
  const withoutStyle = attributes.replace(/\s+s=["'][^"']*["']/g, "");
  return cell.replace(/^<c\b[^>]*>/, `<c${withoutStyle} s="${styleIndex}">`);
}

function updateWorksheetCells(xml: string, updates: Map<string, string>, styleIndex: number | null) {
  const cells = cellMapFromWorksheet(xml);
  for (const [address, value] of updates) cells.set(address, replaceStyle(value, styleIndex));
  const rows = new Map<number, string[]>();
  for (const [address, cell] of cells) {
    const row = rowNumber(address);
    if (!row) continue;
    rows.set(row, [...(rows.get(row) ?? []), styleIndex === null ? cell : replaceStyle(cell, styleIndex)]);
  }
  const rowXml = [...rows.entries()].sort((left, right) => left[0] - right[0]).map(([row, rowCells]) => {
    const existingRow = xml.match(new RegExp(`<row\\b[^>]*\\br=["']${row}["'][^>]*>[\\s\\S]*?<\\/row>`))?.[0];
    const opening = existingRow?.match(/^<row\b[^>]*>/)?.[0] ?? `<row r="${row}">`;
    const sortedCells = rowCells.sort((left, right) => columnNumber(left.match(/\br=["']([^"']+)["']/)?.[1] ?? "A1") - columnNumber(right.match(/\br=["']([^"']+)["']/)?.[1] ?? "A1"));
    return `${opening}${sortedCells.join("")}</row>`;
  }).join("");
  const updated = xml.replace(/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/, `<sheetData>${rowXml}</sheetData>`);
  const maxRow = Math.max(...[...cells.keys()].map(rowNumber), 1);
  const maxColumn = Math.max(...[...cells.keys()].map(columnNumber), 1);
  const dimension = `A1:${addressFor(maxColumn, maxRow)}`;
  return updated.replace(/<dimension\b[^>]*\/>/, `<dimension ref="${dimension}"/>`);
}

function removeWorksheetColumns(xml: string, columnsToRemove: Set<number>) {
  if (!columnsToRemove.size) return xml;
  const removed = [...columnsToRemove].sort((left, right) => left - right);
  const shiftedColumn = (column: number) => column - removed.filter((removedColumn) => removedColumn < column).length;
  const sheetDataMatch = xml.match(/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/);
  if (!sheetDataMatch) return xml;
  const rows = [...sheetDataMatch[0].matchAll(/<row\b[^>]*>[\s\S]*?<\/row>/g)].map((match) => match[0]);
  const rebuiltRows = rows.map((rowXml) => {
    const opening = rowXml.match(/^<row\b[^>]*>/)?.[0] ?? "<row>";
    const cells = [...rowXml.matchAll(/<c\b([^>]*)(?:\/>|>[\s\S]*?<\/c>)/g)].map((match) => match[0]);
    const rebuiltCells = cells.flatMap((cell) => {
      const address = cell.match(/\br=["']([A-Z]+\d+)["']/)?.[1];
      if (!address) return [cell];
      const column = columnNumber(address);
      if (columnsToRemove.has(column)) return [];
      const nextAddress = addressFor(shiftedColumn(column), rowNumber(address));
      return [cell.replace(/\br=["'][A-Z]+\d+["']/, `r="${nextAddress}"`)];
    }).sort((left, right) => columnNumber(left.match(/\br=["']([A-Z]+\d+)["']/)?.[1] ?? "A1") - columnNumber(right.match(/\br=["']([A-Z]+\d+)["']/)?.[1] ?? "A1"));
    return `${opening}${rebuiltCells.join("")}</row>`;
  });
  const updated = xml.replace(sheetDataMatch[0], `<sheetData>${rebuiltRows.join("")}</sheetData>`);
  const addresses = [...updated.matchAll(/\br=["']([A-Z]+\d+)["']/g)].map((match) => match[1]);
  const maxRow = Math.max(...addresses.map(rowNumber), 1);
  const maxColumn = Math.max(...addresses.map(columnNumber), 1);
  return updated.replace(/<dimension\b[^>]*\/>/, `<dimension ref="A1:${addressFor(maxColumn, maxRow)}"/>`);
}

function ensureHiddenIdentityColumns(xml: string) {
  const hidden = `<col min="1" max="2" hidden="1"/>`;
  if (xml.includes("<cols>")) return xml.replace(/<cols>([\s\S]*?)<\/cols>/, (_match, body: string) => `<cols>${body}${hidden}</cols>`);
  return xml.replace(/(<sheetFormatPr\b[^>]*\/>)/, `$1<cols>${hidden}</cols>`);
}

function rowValues(xml: string, sharedStrings: string[]) {
  const rows = new Map<number, Map<number, { address: string; xml: string; value: string | number | null }>>();
  for (const [address, cell] of cellMapFromWorksheet(xml)) {
    const row = rowNumber(address);
    const column = columnNumber(address);
    const values = rows.get(row) ?? new Map();
    values.set(column, { address, xml: cell, value: xmlCellValue(cell, sharedStrings) });
    rows.set(row, values);
  }
  return rows;
}

function mergeHistoryWorksheet(sourceXml: string, generatedXml: string, sheetName: string, sourceStrings: string[], generatedStrings: string[], styleIndex: number | null, issues: MergeIssue[]) {
  const fullHistory = sheetName === WORKBOOK_SHEETS.fullFollowers || sheetName === WORKBOOK_SHEETS.fullFollowing || sheetName === WORKBOOK_SHEETS.fullPosts;
  const sourceRows = rowValues(sourceXml, sourceStrings);
  const generatedRows = rowValues(generatedXml, generatedStrings);
  const updates = new Map<string, string>();
  const sourceHeader = sourceRows.get(1) ?? new Map();
  const generatedHeader = generatedRows.get(1) ?? new Map();
  const sourceDates = new Map<string, number>();
  const generatedDates = new Map<string, number>();
  const sourceDateInfo = new Map<number, { key: string; label: string; bucket?: ThreeHourExportBucket }>();
  const sourceBucketColumns = new Map<string, Array<{ column: number; bucket: ThreeHourExportBucket }>>();
  const duplicateSourceColumns = new Set<number>();
  for (const [column, cell] of sourceHeader) {
    if (column < 4) continue;
    const info = dateHeaderInfo(cell.value, fullHistory);
    if (!info) continue;
    sourceDateInfo.set(column, info);
    if (info.bucket) {
      const columns = sourceBucketColumns.get(info.key) ?? [];
      columns.push({ column, bucket: info.bucket });
      sourceBucketColumns.set(info.key, columns);
    }
    if (!sourceDates.has(info.key)) sourceDates.set(info.key, column);
    else if (fullHistory) duplicateSourceColumns.add(column);
    if (fullHistory && info.bucket && String(cell.value ?? "") !== info.bucket.label) {
      updates.set(addressFor(column, 1), cellXml(addressFor(column, 1), info.bucket.label, cell.xml, styleIndex));
    }
  }

  // Existing exports may contain several timestamp columns in one three-hour
  // slot. Collapse those columns before applying the new site values, keeping
  // the value closest to the slot's JST endpoint for each account.
  const collapsedSourceValues = new Map<string, string | number | null>();
  for (const [key, candidates] of sourceBucketColumns) {
    const targetColumn = sourceDates.get(key);
    if (!targetColumn || candidates.length < 2) continue;
    for (const [row, cells] of sourceRows) {
      if (row === 1) continue;
      const populated = candidates
        .map((candidate) => ({ candidate, cell: cells.get(candidate.column) }))
        .filter((item) => item.cell?.value !== null && item.cell?.value !== undefined && item.cell?.value !== "")
        .sort((left, right) => left.candidate.bucket.distance - right.candidate.bucket.distance || right.candidate.bucket.fetchedAt - left.candidate.bucket.fetchedAt);
      const winner = populated[0]?.cell;
      if (!winner) continue;
      collapsedSourceValues.set(`${row}:${targetColumn}`, winner.value);
      const targetCell = cells.get(targetColumn);
      if (targetCell?.value !== winner.value || !targetCell) {
        updates.set(addressFor(targetColumn, row), cellXml(addressFor(targetColumn, row), winner.value!, targetCell?.xml ?? winner.xml, styleIndex));
      }
    }
  }
  let maxColumn = Math.max(...[...sourceRows.values()].flatMap((row) => [...row.keys()]), 3);
  for (const [column, cell] of generatedHeader) {
    if (column < 4) continue;
    const info = dateHeaderInfo(cell.value, fullHistory);
    if (!info) continue;
    const key = info.key;
    let targetColumn = sourceDates.get(key);
    if (!targetColumn) {
      targetColumn = ++maxColumn;
      sourceDates.set(key, targetColumn);
      updates.set(addressFor(targetColumn, 1), cellXml(addressFor(targetColumn, 1), info.bucket?.label ?? info.label, undefined, styleIndex));
    }
    generatedDates.set(key, targetColumn);
  }

  const identityRows = new Map<string, number[]>();
  for (const [row, cells] of sourceRows) {
    if (row === 1) continue;
    const id = normalizeIdentity(cells.get(1)?.value);
    const handle = normalizeIdentity(cells.get(2)?.value);
    if (id) identityRows.set(`id:${id}`, [...(identityRows.get(`id:${id}`) ?? []), row]);
    if (handle) identityRows.set(`handle:${handle}`, [...(identityRows.get(`handle:${handle}`) ?? []), row]);
  }
  let maxRow = Math.max(...sourceRows.keys(), 1);
  const metric = sheetName.endsWith("フォロワー") ? "followers" : sheetName.endsWith("フォロー") ? "following" : "posts";
  for (const [generatedRowNumber, generatedCells] of generatedRows) {
    if (generatedRowNumber === 1) continue;
    const accountId = normalizeIdentity(generatedCells.get(1)?.value);
    const handle = normalizeIdentity(generatedCells.get(2)?.value);
    if (!accountId && !handle) continue;
    const idMatches = accountId ? (identityRows.get(`id:${accountId}`) ?? []) : [];
    const handleMatches = handle ? (identityRows.get(`handle:${handle}`) ?? []) : [];
    const matches = idMatches.length ? idMatches : handleMatches;
    if (matches.length > 1) {
      issues.push({ issueType: "duplicate", sheet: sheetName, accountId, handle, details: "同じアカウントの既存行が複数あるため、先頭の既存行だけを更新し、他の行は保持しました。" });
    }
    const targetRow = matches[0] ?? ++maxRow;
    if (!matches.length) {
      identityRows.set(`id:${accountId}`, [targetRow]);
      if (handle) identityRows.set(`handle:${handle}`, [targetRow]);
    }
    for (const identityColumn of [1, 2, 3]) {
      const sourceCell = sourceRows.get(targetRow)?.get(identityColumn);
      const generatedCell = generatedCells.get(identityColumn);
      if (!generatedCell || sourceCell?.value !== null && sourceCell?.value !== "" && sourceCell?.value !== undefined) continue;
      updates.set(addressFor(identityColumn, targetRow), cellXml(addressFor(identityColumn, targetRow), generatedCell.value ?? "", sourceCell?.xml, styleIndex));
    }
    for (const [generatedColumn, generatedCell] of generatedCells) {
      const generatedHeaderValue = generatedHeader.get(generatedColumn)?.value;
      const info = dateHeaderInfo(generatedHeaderValue ?? null, fullHistory);
      const key = info?.key;
      const targetColumn = key ? generatedDates.get(key) : undefined;
      if (!targetColumn || generatedColumn < 4 || generatedCell.value === null || generatedCell.value === "") continue;
      const targetAddress = addressFor(targetColumn, targetRow);
      const sourceCell = sourceRows.get(targetRow)?.get(targetColumn);
      const existingValue = fullHistory && sourceDateInfo.has(targetColumn)
        ? (collapsedSourceValues.get(`${targetRow}:${targetColumn}`) ?? sourceCell?.value)
        : sourceCell?.value;
      if (existingValue === null || existingValue === "" || existingValue === undefined) {
        updates.set(targetAddress, cellXml(targetAddress, generatedCell.value, sourceCell?.xml, styleIndex));
        continue;
      }
      if (String(existingValue) === String(generatedCell.value)) continue;
      const datePart = key.slice(0, 10);
      const priorityToSite = datePart >= SITE_PRIORITY_CUTOFF;
      issues.push({ issueType: "conflict", sheet: sheetName, accountId, handle, date: key, metric, existingValue, siteValue: generatedCell.value, details: priorityToSite ? "2026/07/23以降のためサイト値で更新しました。" : "2026/07/22以前のため既存Excel値を保持しました。" });
      if (priorityToSite) updates.set(targetAddress, cellXml(targetAddress, generatedCell.value, sourceCell?.xml, styleIndex));
    }
  }
  const updated = updateWorksheetCells(sourceXml, updates, styleIndex);
  return ensureHiddenIdentityColumns(removeWorksheetColumns(updated, duplicateSourceColumns));
}

function appendAuditRows(sourceXml: string, generatedXml: string, sourceStrings: string[], generatedStrings: string[], styleIndex: number | null) {
  const generatedRows = rowValues(generatedXml, generatedStrings);
  const updates = new Map<string, string>();
  let maxRow = Math.max(...rowValues(sourceXml, sourceStrings).keys(), 1);
  for (const [row, cells] of generatedRows) {
    if (row === 1) continue;
    const hasPlaceholder = cells.get(1)?.value === "確認事項なし";
    if (hasPlaceholder) continue;
    maxRow += 1;
    for (const [column, cell] of cells) updates.set(addressFor(column, maxRow), cellXml(addressFor(column, maxRow), cell.value ?? "", undefined, styleIndex));
  }
  return updateWorksheetCells(sourceXml, updates, styleIndex);
}

function appendMergeIssueRows(sourceXml: string, issues: MergeIssue[], styleIndex: number | null) {
  if (!issues.length) return sourceXml;
  const existingRows = rowValues(sourceXml, []);
  let maxRow = Math.max(...existingRows.keys(), 1);
  const updates = new Map<string, string>();
  for (const issue of issues) {
    maxRow += 1;
    const values = [
      issue.issueType === "conflict" ? "競合" : issue.issueType === "duplicate" ? "重複" : "未照合",
      issue.sheet,
      issue.accountId ?? "",
      issue.handle ? `@${issue.handle}` : "",
      issue.date ?? "",
      issue.metric ?? "",
      issue.existingValue ?? "",
      issue.siteValue ?? "",
      issue.details,
    ];
    values.forEach((value, index) => updates.set(addressFor(index + 1, maxRow), cellXml(addressFor(index + 1, maxRow), value, undefined, styleIndex)));
  }
  return updateWorksheetCells(sourceXml, updates, styleIndex);
}

/**
 * Merge only the app-managed sheets into an existing workbook. Non-managed
 * sheets remain byte-for-byte intact so formulas, charts, and manual edits
 * outside the managed ranges survive the export.
 */
export function mergeIncrementalWorkbook(template: ArrayBuffer | Uint8Array, generated: ArrayBuffer | Uint8Array): IncrementalMergeResult {
  const sourceFiles = unzipSync(template instanceof Uint8Array ? template : new Uint8Array(template));
  const generatedFiles = unzipSync(generated instanceof Uint8Array ? generated : new Uint8Array(generated));
  const sourceWorkbookXml = decode(sourceFiles["xl/workbook.xml"]);
  const sourceRelationshipsPath = "xl/_rels/workbook.xml.rels";
  const sourceRelationshipsXml = decode(sourceFiles[sourceRelationshipsPath]);
  const contentTypesPath = "[Content_Types].xml";
  const contentTypesXml = decode(sourceFiles[contentTypesPath]);
  const sourceStrings = extractSharedStrings(sourceFiles["xl/sharedStrings.xml"] ? decode(sourceFiles["xl/sharedStrings.xml"]) : null);
  const generatedStrings = extractSharedStrings(generatedFiles["xl/sharedStrings.xml"] ? decode(generatedFiles["xl/sharedStrings.xml"]) : null);
  const existingSheetNumbers = Object.keys(sourceFiles).map((path) => path.match(/^xl\/worksheets\/sheet(\d+)\.xml$/)?.[1]).filter((value): value is string => Boolean(value));
  const existingRelationshipNumbers = [...sourceRelationshipsXml.matchAll(/\bId=["']rId(\d+)["']/g)].map((match) => match[1]);
  const existingSheetIds = [...sourceWorkbookXml.matchAll(/\bsheetId=["'](\d+)["']/g)].map((match) => match[1]);
  const rawStylesXml = sourceFiles["xl/styles.xml"] ? decode(sourceFiles["xl/styles.xml"]) : null;
  const gridStyle = rawStylesXml ? addGridCellStyle(rawStylesXml) : { xml: null, styleIndex: null as number | null };
  const existingSheetPathsByName = new Map<string, string>();
  for (const match of sourceWorkbookXml.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const attributes = match[1];
    const name = attributes.match(/\bname=["']([^"']+)["']/)?.[1];
    const relationshipId = attributes.match(/\br:id=["']([^"']+)["']/)?.[1];
    if (!name || !relationshipId) continue;
    const path = relationshipTarget(sourceRelationshipsXml, relationshipId);
    if (path) existingSheetPathsByName.set(xmlUnescape(name), path);
  }
  const generatedSheetItems = generatedSheets(generatedFiles, gridStyle.styleIndex);
  const canonicalSheetName = (name: string) => Object.entries(LEGACY_WORKBOOK_SHEET_ALIASES).find(([, legacyName]) => legacyName === name)?.[0] ?? name;
  const existingPathFor = (name: string) => {
    const canonicalName = canonicalSheetName(name);
    return workbookSheetCandidates(canonicalName).map((candidate) => existingSheetPathsByName.get(candidate)).find((path): path is string => Boolean(path));
  };
  const output = { ...sourceFiles };
  const issues: MergeIssue[] = [];
  const updatedSheets = new Set<string>();
  const sheetsToAppend = generatedSheetItems.filter((item) => !existingPathFor(item.name));
  let nextSheetNumber = maxNumber(existingSheetNumbers, 0) + 1;
  let nextRelationshipNumber = maxNumber(existingRelationshipNumbers, 0) + 1;
  let nextSheetId = maxNumber(existingSheetIds, 0) + 1;
  let workbookAdditions = "";
  let relationshipAdditions = "";
  let contentTypeAdditions = "";

  let existingAuditPath: string | undefined;
  let generatedAuditItem: { xml: string } | undefined;
  for (const item of generatedSheetItems) {
    const canonicalName = canonicalSheetName(item.name);
    const target = item.name === "統合要確認" ? existingSheetPathsByName.get(item.name) : existingPathFor(item.name);
    if (!target) continue;
    if (canonicalName === LATEST_SHEET) {
      output[target] = encode(item.xml);
      updatedSheets.add(canonicalName);
    } else if (HISTORY_SHEETS.has(canonicalName)) {
      output[target] = encode(mergeHistoryWorksheet(decode(sourceFiles[target]), item.xml, canonicalName, sourceStrings, generatedStrings, gridStyle.styleIndex, issues));
      updatedSheets.add(canonicalName);
    } else if (item.name === "統合要確認") {
      existingAuditPath = target;
      generatedAuditItem = item;
    }
  }

  if (existingAuditPath && generatedAuditItem) {
    let auditXml = appendAuditRows(decode(sourceFiles[existingAuditPath]), generatedAuditItem.xml, sourceStrings, generatedStrings, gridStyle.styleIndex);
    auditXml = appendMergeIssueRows(auditXml, issues, gridStyle.styleIndex);
    output[existingAuditPath] = encode(auditXml);
  }

  for (const item of sheetsToAppend) {
    const target = `xl/worksheets/sheet${nextSheetNumber}.xml`;
    const relationshipId = `rId${nextRelationshipNumber}`;
    output[target] = encode(item.name === "統合要確認" ? appendMergeIssueRows(item.xml, issues, gridStyle.styleIndex) : item.xml);
    workbookAdditions += `<sheet name="${xmlEscape(item.name)}" sheetId="${nextSheetId}" r:id="${relationshipId}"/>`;
    relationshipAdditions += `<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${nextSheetNumber}.xml"/>`;
    contentTypeAdditions += `<Override PartName="/${target}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
    nextSheetNumber += 1;
    nextRelationshipNumber += 1;
    nextSheetId += 1;
    if (MANAGED_SHEETS.has(canonicalSheetName(item.name))) updatedSheets.add(canonicalSheetName(item.name));
  }
  const missingManagedSheets = [...MANAGED_SHEETS].filter((sheetName) => !updatedSheets.has(sheetName));
  if (missingManagedSheets.length) throw new Error(`生成されたExcelに必要な7シートがありません: ${missingManagedSheets.join("、")}`);
  if (gridStyle.xml) output["xl/styles.xml"] = encode(gridStyle.xml);
  if (workbookAdditions) {
    output["xl/workbook.xml"] = encode(sourceWorkbookXml.replace("</sheets>", `${workbookAdditions}</sheets>`));
    output[sourceRelationshipsPath] = encode(sourceRelationshipsXml.replace("</Relationships>", `${relationshipAdditions}</Relationships>`));
    output[contentTypesPath] = encode(contentTypesXml.replace("</Types>", `${contentTypeAdditions}</Types>`));
  }
  return { bytes: zipSync(output, { level: 6 }), issues, updatedSheets: [...updatedSheets] };
}

export function mergeTemplateWorkbook(template: ArrayBuffer | Uint8Array, generated: ArrayBuffer | Uint8Array) {
  const sourceFiles = unzipSync(template instanceof Uint8Array ? template : new Uint8Array(template));
  const generatedFiles = unzipSync(generated instanceof Uint8Array ? generated : new Uint8Array(generated));
  const sourceWorkbookXml = decode(sourceFiles["xl/workbook.xml"]);
  const sourceRelationshipsPath = "xl/_rels/workbook.xml.rels";
  const sourceRelationshipsXml = decode(sourceFiles[sourceRelationshipsPath]);
  const contentTypesPath = "[Content_Types].xml";
  const contentTypesXml = decode(sourceFiles[contentTypesPath]);
  const existingSheetNumbers = Object.keys(sourceFiles).map((path) => path.match(/^xl\/worksheets\/sheet(\d+)\.xml$/)?.[1]).filter((value): value is string => Boolean(value));
  const existingRelationshipNumbers = [...sourceRelationshipsXml.matchAll(/\bId=["']rId(\d+)["']/g)].map((match) => match[1]);
  const existingSheetIds = [...sourceWorkbookXml.matchAll(/\bsheetId=["'](\d+)["']/g)].map((match) => match[1]);
  const rawStylesXml = sourceFiles["xl/styles.xml"] ? decode(sourceFiles["xl/styles.xml"]) : null;
  const gridStyle = rawStylesXml ? addGridCellStyle(rawStylesXml) : { xml: null, styleIndex: null as number | null };
  const existingSheetPathsByName = new Map<string, string>();
  for (const match of sourceWorkbookXml.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const attributes = match[1];
    const name = attributes.match(/\bname=["']([^"']+)["']/)?.[1];
    const relationshipId = attributes.match(/\br:id=["']([^"']+)["']/)?.[1];
    if (!name || !relationshipId) continue;
    const path = relationshipTarget(sourceRelationshipsXml, relationshipId);
    if (path) existingSheetPathsByName.set(xmlUnescape(name), path);
  }
  const generatedSheetItems = generatedSheets(generatedFiles, gridStyle.styleIndex);
  const sheetsToReplace = generatedSheetItems.filter((item) => existingSheetPathsByName.has(item.name));
  const sheetsToAppend = generatedSheetItems.filter((item) => !existingSheetPathsByName.has(item.name));
  const output = { ...sourceFiles };
  let nextSheetNumber = maxNumber(existingSheetNumbers, 0) + 1;
  let nextRelationshipNumber = maxNumber(existingRelationshipNumbers, 0) + 1;
  let nextSheetId = maxNumber(existingSheetIds, 0) + 1;
  let workbookAdditions = "";
  let relationshipAdditions = "";
  let contentTypeAdditions = "";

  for (const item of sheetsToReplace) {
    const target = existingSheetPathsByName.get(item.name);
    if (target) output[target] = encode(item.xml);
  }

  for (const item of sheetsToAppend) {
    const target = `xl/worksheets/sheet${nextSheetNumber}.xml`;
    const relationshipId = `rId${nextRelationshipNumber}`;
    output[target] = encode(item.xml);
    workbookAdditions += `<sheet name="${xmlEscape(item.name)}" sheetId="${nextSheetId}" r:id="${relationshipId}"/>`;
    relationshipAdditions += `<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${nextSheetNumber}.xml"/>`;
    contentTypeAdditions += `<Override PartName="/${target}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
    nextSheetNumber += 1;
    nextRelationshipNumber += 1;
    nextSheetId += 1;
  }

  if (workbookAdditions || sheetsToReplace.length) {
    if (gridStyle.xml) output["xl/styles.xml"] = encode(gridStyle.xml);
    if (workbookAdditions) {
      output["xl/workbook.xml"] = encode(sourceWorkbookXml.replace("</sheets>", `${workbookAdditions}</sheets>`));
      output[sourceRelationshipsPath] = encode(sourceRelationshipsXml.replace("</Relationships>", `${relationshipAdditions}</Relationships>`));
      output[contentTypesPath] = encode(contentTypesXml.replace("</Types>", `${contentTypeAdditions}</Types>`));
    }
  }

  return zipSync(output, { level: 6 });
}
