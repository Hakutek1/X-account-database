import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { buildFreshWorkbook, FRESH_WORKBOOK_SHEETS } from "../lib/fresh-workbook.ts";

const rows = [
  {
    fetchedAt: "2026-07-22T11:00:00+09:00",
    accountId: "account-a",
    handle: "account_a",
    displayName: "アカウントA",
    followers: 100,
    following: 10,
    posts: 1000,
  },
  {
    fetchedAt: "2026-07-23T19:07:00+09:00",
    accountId: "account-a",
    handle: "account_a",
    displayName: "アカウントA",
    followers: 105,
    following: 11,
    posts: 1005,
  },
  {
    fetchedAt: "2026-07-23T20:31:00+09:00",
    accountId: "account-a",
    handle: "account_a",
    displayName: "アカウントA",
    followers: 110,
    following: 12,
    posts: 1010,
  },
  {
    fetchedAt: "2026-07-23T20:31:00+09:00",
    accountId: "account-b",
    handle: "account_b",
    displayName: "アカウントB",
    followers: 200,
    following: 20,
    posts: 2000,
  },
  {
    fetchedAt: "2026-07-24T20:31:00+09:00",
    accountId: "account-a",
    handle: "account_a",
    displayName: "アカウントA",
    followers: 120,
    following: 13,
    posts: 1020,
  },
];

function rowsOf(workbook, sheetName) {
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null });
}

test("fresh export creates only the latest and daily sheets while keeping available history", () => {
  const generated = buildFreshWorkbook({
    latestRows: [rows.at(-1)],
    historyRows: rows,
    reviewRows: [{ 状態: "確認事項なし", 内容: "テスト" }],
  });
  assert.deepEqual(generated.sheetNames, [...FRESH_WORKBOOK_SHEETS]);
  assert.equal(generated.sheetNames.length, 4);

  const workbook = XLSX.read(generated.bytes, { type: "buffer", cellStyles: true });
  assert.deepEqual(workbook.SheetNames, [...FRESH_WORKBOOK_SHEETS]);
  assert.equal(rowsOf(workbook, "最新データ")[0].アカウントID, "account-a");
  assert.equal(rowsOf(workbook, "最新データ")[0].活動状態, "活動中");

  const dailyFollowers = rowsOf(workbook, "フォロワー（日次履歴）");
  assert.equal(dailyFollowers.length, 2);
  assert.ok(Object.keys(dailyFollowers[0]).some((key) => key.endsWith("07/23")));
  assert.ok(Object.keys(dailyFollowers[0]).some((key) => key.endsWith("07/24")));
  assert.equal(rowsOf(workbook, "フォロー（日次履歴）").length, 2);
  assert.equal(rowsOf(workbook, "投稿（日次履歴）").length, 2);
  assert.equal(rowsOf(workbook, "フォロワー（日次履歴）")[0].活動状態, "活動中");

  for (const removedSheet of [
    "フォロワー（全履歴）",
    "フォロー（全履歴）",
    "投稿（全履歴）",
    "フォロワー数",
    "フォロー数",
    "ポスト数",
    "フォロー&フォロワー増減数",
    "フォロワー増減率(週)",
    "フォロワー増減率(月)",
    "フォロワー比率",
    "ポスト増減数",
    "一次ツイート率",
    "投稿数÷フォロワー数",
    "凍結回数",
    "統合要確認",
  ]) assert.equal(workbook.SheetNames.includes(removedSheet), false, `${removedSheet}は出力しない`);
});

test("fresh export writes the independent non-alt account status", () => {
  const generated = buildFreshWorkbook({
    latestRows: [{ ...rows[0], accountStatus: "non_alt" }],
    historyRows: [{ ...rows[0], accountStatus: "non_alt" }],
  });
  const workbook = XLSX.read(generated.bytes, { type: "buffer" });
  assert.equal(rowsOf(workbook, "最新データ")[0].活動状態, "非複垢");
  assert.equal(rowsOf(workbook, "フォロワー（日次履歴）")[0].活動状態, "非複垢");
});

test("fresh export includes pre-cutoff values in all three daily history sheets", () => {
  const generated = buildFreshWorkbook({
    latestRows: [],
    historyRows: [{
      fetchedAt: "2026-07-22T00:00:00.001+09:00",
      accountId: "manual-account",
      handle: "manual_account",
      displayName: "手動追加アカウント",
      followers: 123,
      following: 45,
      posts: 678,
    }],
  });
  const workbook = XLSX.read(generated.bytes, { type: "buffer" });
  for (const sheetName of ["フォロワー（日次履歴）", "フォロー（日次履歴）", "投稿（日次履歴）"]) {
    const rows = rowsOf(workbook, sheetName);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].アカウントID, "manual-account");
    assert.equal(rows[0]["26/07/22"], sheetName.includes("フォロワー") ? 123 : sheetName.includes("フォロー") ? 45 : 678);
  }
});

test("daily export assigns acquisitions to the next record date and keeps the closest-to-end sample", () => {
  const generated = buildFreshWorkbook({
    latestRows: [],
    historyRows: [
      {
        fetchedAt: "2026-07-25T15:00:00+09:00",
        accountId: "daily-account",
        handle: "daily_account",
        displayName: "日次確認アカウント",
        followers: 150,
        following: 15,
        posts: 1500,
      },
      {
        fetchedAt: "2026-07-25T18:00:00+09:00",
        accountId: "daily-account",
        handle: "daily_account",
        displayName: "日次確認アカウント",
        followers: 180,
        following: 18,
        posts: 1800,
      },
      {
        fetchedAt: "2026-07-26T15:00:00+09:00",
        accountId: "daily-account",
        handle: "daily_account",
        displayName: "日次確認アカウント",
        followers: 260,
        following: 26,
        posts: 2600,
      },
      {
        fetchedAt: "2026-07-26T18:00:00+09:00",
        accountId: "daily-account",
        handle: "daily_account",
        displayName: "日次確認アカウント",
        followers: 280,
        following: 28,
        posts: 2800,
      },
    ],
  });
  const workbook = XLSX.read(generated.bytes, { type: "buffer" });
  assert.equal(rowsOf(workbook, "フォロワー（日次履歴）")[0]["26/07/26"], 180);
  assert.equal(rowsOf(workbook, "フォロワー（日次履歴）")[0]["26/07/27"], 280);
  assert.equal(rowsOf(workbook, "フォロー（日次履歴）")[0]["26/07/26"], 18);
  assert.equal(rowsOf(workbook, "投稿（日次履歴）")[0]["26/07/27"], 2800);
});
