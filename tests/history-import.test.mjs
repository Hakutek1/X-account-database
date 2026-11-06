import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { unzipSync } from "fflate";
import { threeHourExportBucket } from "../lib/export-buckets.ts";
import { availableImportCandidates, mergeImportedSnapshots, parseDailyHistoryWorkbook, parseSourceWorkbook } from "../lib/history-import.ts";
import { WORKBOOK_SHEETS } from "../lib/workbook-sheet-names.ts";
import { mergeIncrementalWorkbook, mergeTemplateWorkbook } from "../lib/xlsx-template.ts";

function excelSerial(year, month, day) {
  return (Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86400000;
}

function workbookWithRows() {
  const workbook = XLSX.utils.book_new();
  const add = (name, rows) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  add("フォロワー数 ", [["名称", excelSerial(2026, 7, 20), excelSerial(2026, 7, 22), excelSerial(2026, 7, 23)], ["表示名A", 10, 20, 30], ["表示名B", 1, 2, 3]]);
  add("フォロワー数", [["名称", excelSerial(2026, 7, 20)], ["表示名A", 999]]);
  add("フォロワー数 (2)", [["名称", excelSerial(2026, 7, 21)], ["表示名A", 9999]]);
  add("フォロー数", [["名称", excelSerial(2026, 7, 22), excelSerial(2026, 7, 23)], ["表示名A", 5, 6]]);
  add("ポスト数", [["名称", excelSerial(2026, 7, 22)], ["表示名A", 50]]);
  return workbook;
}

test("source workbook parser selects the richer follower sheet and applies the JST cutoff", () => {
  const preview = parseSourceWorkbook(workbookWithRows());
  assert.equal(preview.observations.length, 6);
  assert.deepEqual(preview.dateColumns, ["2026-07-20", "2026-07-22"]);
  assert.equal(preview.observations.some((item) => item.date === "2026-07-23"), false);
  assert.equal(preview.observations.some((item) => item.sourceSheet === "フォロワー数 "), true);
  assert.deepEqual(preview.excludedSheets, ["フォロワー数 (2)"]);
  assert.equal(preview.warnings.some((warning) => warning.includes("複数ある")), true);
});

test("daily history parser exposes Excel-only accounts and two-digit date headers", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["アカウントID", "ハンドル", "表示名", "26/07/20", "26/07/22"],
    ["excel-only", "@manual", "手動アカウント", 10, 20],
  ]), WORKBOOK_SHEETS.dailyFollowers);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["アカウントID", "ハンドル", "表示名", "26/07/20"],
    ["excel-only", "@manual", "手動アカウント", 3],
  ]), WORKBOOK_SHEETS.dailyFollowing);
  const rows = parseDailyHistoryWorkbook(workbook);
  assert.deepEqual(rows, [
    { fetched_at: "2026-07-19T15:00:00.001Z", account_id: "excel-only", handle: "manual", display_name: "手動アカウント", followers: 10, following: 3, posts: null },
    { fetched_at: "2026-07-21T15:00:00.001Z", account_id: "excel-only", handle: "manual", display_name: "手動アカウント", followers: 20, following: null, posts: null },
  ]);
});

test("three-hour export buckets use JST endpoints and keep the closest sample", () => {
  assert.equal(threeHourExportBucket("2026-07-23T10:07:00+09:00")?.label, "26/07/23 12:00");
  assert.equal(threeHourExportBucket("2026-07-23T12:00:00+09:00")?.label, "26/07/23 12:00");
  assert.equal(threeHourExportBucket("2026-07-23T12:00:00.001+09:00")?.label, "26/07/23 15:00");
  assert.equal(threeHourExportBucket("2026-07-23T21:00:00+09:00")?.label, "26/07/23 21:00");
  assert.equal(threeHourExportBucket("2026-07-23T21:00:00.001+09:00")?.label, "26/07/24 00:00");
  const earlier = threeHourExportBucket("2026-07-23T19:07:00+09:00");
  const later = threeHourExportBucket("2026-07-23T20:31:00+09:00");
  assert.equal(earlier?.key, later?.key);
  assert.ok((later?.distance ?? Infinity) < (earlier?.distance ?? -Infinity));
});

test("import merge keeps one account/date snapshot, gives source values precedence, and tracks metric sources independently", () => {
  const preview = parseSourceWorkbook(workbookWithRows());
  const merged = mergeImportedSnapshots(preview, [{ sourceName: "表示名A", sourceKey: "表示名a", accountId: "account-a", handle: "account_a", displayName: "表示名A" }], [{
    fetched_at: "2026-07-21T15:00:00.000Z",
    account_id: "account-a",
    handle: "account_a",
    display_name: "表示名A",
    followers: 11,
    following: null,
    posts: null,
  }]);
  assert.equal(merged.snapshots.length, 2);
  const july22 = merged.snapshots.find((snapshot) => snapshot.date === "2026-07-22");
  assert.deepEqual({ followers: july22?.followers, following: july22?.following, posts: july22?.posts }, { followers: 20, following: 5, posts: 50 });
  assert.equal(merged.issues.filter((issue) => issue.issueType === "source-duplicate").length, 0);
  assert.equal(merged.issues.some((issue) => issue.issueType === "conflict" && issue.date === "2026-07-22"), true);
});

test("import candidate options include every account and hide accounts selected for another source", () => {
  const item = { sourceName: "表示名A", sourceKey: "表示名a", observationCount: 1, firstDate: "2026-07-22", lastDate: "2026-07-22", candidates: [
    { accountId: "account-a", handle: "account_a", displayName: "表示名A" },
    { accountId: "account-b", handle: "account_b", displayName: "表示名B" },
    { accountId: "account-c", handle: "account_c", displayName: "表示名C" },
  ] };
  assert.deepEqual(availableImportCandidates(item, { "別の名称": "account-b" }).map((candidate) => candidate.accountId), ["account-a", "account-c"]);
  assert.deepEqual(availableImportCandidates(item, { "表示名a": "account-b", "別の名称": "account-b" }).map((candidate) => candidate.accountId), ["account-a", "account-b", "account-c"]);
});

test("template merge retains original sheets and appends generated sheets", () => {
  const template = XLSX.utils.book_new();
  const templateSheet = XLSX.utils.aoa_to_sheet([["分析", "=1+1"]]);
  templateSheet.B1 = { t: "n", f: "1+1", v: 2 };
  XLSX.utils.book_append_sheet(template, templateSheet, "分析シート");
  const generated = XLSX.utils.book_new();
  const generatedSheet = XLSX.utils.aoa_to_sheet([["表示名", "フォロワー数"], ["表示名A", 20]]);
  generatedSheet.C2 = { t: "s", v: "" };
  generatedSheet["!ref"] = "A1:C2";
  generatedSheet["!cols"] = [{ hidden: true }, { hidden: true }];
  XLSX.utils.book_append_sheet(generated, generatedSheet, "日次履歴_フォロワー");
  const mergedBytes = mergeTemplateWorkbook(XLSX.write(template, { bookType: "xlsx", type: "array" }), XLSX.write(generated, { bookType: "xlsx", type: "array" }));
  const merged = XLSX.read(mergedBytes, { type: "buffer", cellFormula: true });
  assert.deepEqual(merged.SheetNames, ["分析シート", "日次履歴_フォロワー"]);
  assert.equal(merged.Sheets["日次履歴_フォロワー"].A2.v, "表示名A");
  assert.equal(merged.Sheets["分析シート"].B1.f, "1+1");
  const mergedFiles = unzipSync(new Uint8Array(mergedBytes));
  const mergedSheetXml = new TextDecoder().decode(mergedFiles["xl/worksheets/sheet2.xml"]);
  const mergedStylesXml = new TextDecoder().decode(mergedFiles["xl/styles.xml"]);
  assert.equal(mergedSheetXml.includes('hidden="true"'), true);
  assert.equal(mergedSheetXml.includes(' s="'), true);
  assert.match(mergedSheetXml, /r="C2"[^>]*s="\d+"/);
  assert.equal(mergedStylesXml.includes('rgb="FFB8C4D3"'), true);
  assert.equal(mergedStylesXml.includes('name val="游ゴシック"'), true);
});

test("template merge replaces an existing export sheet so grid formatting is refreshed", () => {
  const template = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(template, XLSX.utils.aoa_to_sheet([["古い出力"]]), "日次履歴_フォロワー");
  const generated = XLSX.utils.book_new();
  const generatedSheet = XLSX.utils.aoa_to_sheet([["新しい出力", 100]]);
  XLSX.utils.book_append_sheet(generated, generatedSheet, "日次履歴_フォロワー");
  const mergedBytes = mergeTemplateWorkbook(XLSX.write(template, { bookType: "xlsx", type: "array" }), XLSX.write(generated, { bookType: "xlsx", type: "array" }));
  const merged = XLSX.read(mergedBytes, { type: "buffer" });
  assert.equal(merged.SheetNames.length, 1);
  assert.equal(merged.Sheets["日次履歴_フォロワー"].A1.v, "新しい出力");
  const mergedFiles = unzipSync(new Uint8Array(mergedBytes));
  const mergedSheetXml = new TextDecoder().decode(mergedFiles["xl/worksheets/sheet1.xml"]);
  assert.equal(mergedSheetXml.includes(' s="'), true);
});

function exportWorkbookWithHistory({ existing = false } = {}) {
  const workbook = XLSX.utils.book_new();
  const historyRows = existing
    ? [
        ["アカウントID", "ハンドル", "表示名", "26/07/22 12:00", "手動メモ", "26/07/23 12:00"],
        ["id-a", "@alpha", "手動名", 100, "保持", 200],
        ["id-dup", "@alpha", "重複", 101, "保持", 201],
        ["id-dup", "@alpha", "重複2", 102, "保持", 202],
        ["id-old", "@old", "過去アカウント", 55, "保持", null],
      ]
    : [["アカウントID", "ハンドル", "表示名", "26/07/23 12:00"], ["id-a", "@alpha", "Alpha", 300], ["id-b", "@beta", "Beta", 400]];
  const analysis = XLSX.utils.aoa_to_sheet([["分析", 2]]);
  analysis.B1 = { t: "n", f: "1+1", v: 2 };
  XLSX.utils.book_append_sheet(workbook, analysis, "分析シート");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["最新", 1], ["id-a", 1]]), "最新データ");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(historyRows), "全履歴_フォロワー");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(historyRows), "全履歴_フォロー");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(historyRows), "全履歴_投稿");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["アカウントID", "ハンドル", "表示名", "26/07/22"], ["id-old", "@old", "過去アカウント", 55]]), "日次履歴_フォロワー");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["アカウントID", "ハンドル", "表示名", "26/07/22"], ["id-old", "@old", "過去アカウント", 55]]), "日次履歴_フォロー");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["アカウントID", "ハンドル", "表示名", "26/07/22"], ["id-old", "@old", "過去アカウント", 55]]), "日次履歴_投稿");
  return XLSX.write(workbook, { bookType: "xlsx", type: "array", cellStyles: true });
}

function generatedHistoryWorkbook() {
  const workbook = XLSX.utils.book_new();
  const rows = [["アカウントID", "ハンドル", "表示名", "26/07/22 12:00", "26/07/23 12:00"], ["id-a", "@alpha", "Alpha", 999, 301], ["id-b", "@beta", "Beta", 888, 401], ["id-dup", "@alpha", "重複", 777, 778]];
  for (const name of ["全履歴_フォロワー", "全履歴_フォロー", "全履歴_投稿"]) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  for (const name of ["日次履歴_フォロワー", "日次履歴_フォロー", "日次履歴_投稿"]) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["アカウントID", "ハンドル", "表示名", "26/07/23"], ["id-a", "@alpha", "Alpha", 301], ["id-b", "@beta", "Beta", 401]]), name);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["取得日時", "アカウントID"], ["26/07/23 12:00", "id-a"]]), "最新データ");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["状態", "内容"], ["確認事項なし", "未照合・競合データはありません。"]]), "統合要確認");
  return XLSX.write(workbook, { bookType: "xlsx", type: "array", cellStyles: true });
}

function threeHourHistoryWorkbook() {
  const workbook = XLSX.utils.book_new();
  const sourceRows = [
    ["アカウントID", "ハンドル", "表示名", "26/07/22 19:07", "26/07/22 20:31", "26/07/23 19:07", "26/07/23 20:31"],
    ["id-a", "@alpha", "Alpha", 10, 20, 30, 40],
  ];
  const generatedRows = [
    ["アカウントID", "ハンドル", "表示名", "26/07/22 21:00", "26/07/23 21:00"],
    ["id-a", "@alpha", "Alpha", 99, 88],
  ];
  for (const name of [WORKBOOK_SHEETS.fullFollowers, WORKBOOK_SHEETS.fullFollowing, WORKBOOK_SHEETS.fullPosts]) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sourceRows), name);
  for (const name of [WORKBOOK_SHEETS.dailyFollowers, WORKBOOK_SHEETS.dailyFollowing, WORKBOOK_SHEETS.dailyPosts]) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["アカウントID", "ハンドル", "表示名"]]), name);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["取得日時", "アカウントID"]]), WORKBOOK_SHEETS.latest);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["状態"], ["確認事項なし"]]), "統合要確認");

  const generated = XLSX.utils.book_new();
  for (const name of [WORKBOOK_SHEETS.fullFollowers, WORKBOOK_SHEETS.fullFollowing, WORKBOOK_SHEETS.fullPosts]) XLSX.utils.book_append_sheet(generated, XLSX.utils.aoa_to_sheet(generatedRows), name);
  for (const name of [WORKBOOK_SHEETS.dailyFollowers, WORKBOOK_SHEETS.dailyFollowing, WORKBOOK_SHEETS.dailyPosts]) XLSX.utils.book_append_sheet(generated, XLSX.utils.aoa_to_sheet([["アカウントID", "ハンドル", "表示名"]]), name);
  XLSX.utils.book_append_sheet(generated, XLSX.utils.aoa_to_sheet([["取得日時", "アカウントID"], ["26/07/23 21:00", "id-a"]]), WORKBOOK_SHEETS.latest);
  XLSX.utils.book_append_sheet(generated, XLSX.utils.aoa_to_sheet([["状態"], ["確認事項なし"]]), "統合要確認");
  return { template: XLSX.write(workbook, { bookType: "xlsx", type: "array", cellStyles: true }), generated: XLSX.write(generated, { bookType: "xlsx", type: "array", cellStyles: true }) };
}

test("incremental full-history merge removes duplicate timestamp columns and keeps the closest value", () => {
  const { template, generated } = threeHourHistoryWorkbook();
  const result = mergeIncrementalWorkbook(template, generated);
  const merged = XLSX.read(result.bytes, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(merged.Sheets[WORKBOOK_SHEETS.fullFollowers], { header: 1, raw: true });
  assert.deepEqual(rows[0], ["アカウントID", "ハンドル", "表示名", "26/07/22 21:00", "26/07/23 21:00"]);
  assert.deepEqual(rows[1], ["id-a", "@alpha", "Alpha", 20, 88], "各3時間枠の終了時刻に近い値だけを残し、サイト優先日だけ更新する");
});

test("incremental workbook merge uses date headers instead of column positions and preserves manual history", () => {
  const result = mergeIncrementalWorkbook(exportWorkbookWithHistory({ existing: true }), generatedHistoryWorkbook());
  assert.deepEqual(new Set(result.updatedSheets), new Set([
    WORKBOOK_SHEETS.latest,
    WORKBOOK_SHEETS.fullFollowers,
    WORKBOOK_SHEETS.fullFollowing,
    WORKBOOK_SHEETS.fullPosts,
    WORKBOOK_SHEETS.dailyFollowers,
    WORKBOOK_SHEETS.dailyFollowing,
    WORKBOOK_SHEETS.dailyPosts,
  ]), "最新データ・全履歴3シート・日次履歴3シートをすべて更新する");
  const merged = XLSX.read(result.bytes, { type: "buffer", cellFormula: true });
  assert.equal(merged.Sheets["分析シート"].B1.f, "1+1");
  const followers = XLSX.utils.sheet_to_json(merged.Sheets["全履歴_フォロワー"], { header: 1, raw: true });
  assert.deepEqual(followers[0].slice(0, 6), ["アカウントID", "ハンドル", "表示名", "26/07/22 12:00", "手動メモ", "26/07/23 12:00"]);
  assert.equal(followers[1][3], 100, "2026/07/22以前は既存Excel値を優先");
  assert.equal(followers[1][5], 301, "2026/07/23以降はサイト値を優先");
  assert.equal(followers[2][0], "id-dup", "重複行は削除しない");
  assert.equal(followers[2][3], 101, "重複行でも境界日前の既存値は保持する");
  assert.equal(followers[2][5], 778, "重複行でも先頭行へ最新サイト値を反映する");
  assert.equal(followers[3][5], 202, "重複行の2行目は削除・改変しない");
  assert.equal(followers.some((row) => row[0] === "id-old"), true, "手動Excelだけのアカウントを保持する");
  assert.equal(result.issues.some((issue) => issue.issueType === "duplicate"), true);
  assert.equal(merged.Sheets["最新データ"].A1.v, "取得日時", "最新データも生成結果で更新する");
  const files = unzipSync(new Uint8Array(result.bytes));
  const sheetXml = new TextDecoder().decode(files["xl/worksheets/sheet3.xml"]);
  const stylesXml = new TextDecoder().decode(files["xl/styles.xml"]);
  assert.match(sheetXml, /s="\d+"/);
  assert.match(sheetXml, /r="A1"[^>]*s="\d+"/);
  assert.match(sheetXml, /r="A2"[^>]*s="\d+"/);
  assert.match(stylesXml, /rgb="FFB8C4D3"/);
});
