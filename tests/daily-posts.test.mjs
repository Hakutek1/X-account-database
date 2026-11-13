import assert from "node:assert/strict";
import test from "node:test";

import { ensureDailyHistory, ensureDailyPostsThroughToday } from "../lib/daily-history.ts";

function fakeDatabase({ openingDates = [], dailyRows = [], snapshots = [], existingRows = [], freezeDates = [] } = {}) {
  const batched = [];
  const executed = [];
  const all = async (sql) => {
    if (sql.includes('PRAGMA table_info("xstats_account_statuses")')) return { results: [{ name: "freeze_date" }] };
    if (sql.includes("SELECT account_id, freeze_date FROM xstats_account_statuses")) return { results: freezeDates };
    if (sql.includes("origin FROM xstats_daily_history") && sql.includes("posts IS NOT NULL")) return { results: dailyRows };
    if (sql.includes("FROM xstats_snapshots WHERE session_id = ? AND posts IS NOT NULL")) return { results: snapshots };
    if (sql.includes("joined_at FROM xstats_account_statuses")) return { results: openingDates };
    if (sql.includes("SELECT account_id, date, posts, origin")) return { results: existingRows };
    return { results: [] };
  };
  return {
    prepare(sql) {
      return {
        all: () => all(sql),
        bind(...args) {
          return {
            all: () => all(sql),
            async run() {
              executed.push({ sql, args });
              return { meta: { changes: 1 } };
            },
            bindArgs: args,
            sql,
          };
        },
      };
    },
    async batch(statements) {
      batched.push(...statements);
    },
    batched,
    executed,
  };
}

test("opening-date zero does not create post-count zeros before the first measurement", async () => {
  const database = fakeDatabase({
    openingDates: [{ account_id: "a", joined_at: "2026-08-01T00:00:00.000Z" }],
    dailyRows: [{ account_id: "a", date: "2026-08-01", handle: "alpha", display_name: "Alpha", posts: 0, fetched_at: "2026-07-31T15:00:00.001Z", origin: "opening-date" }],
    existingRows: [{ account_id: "a", date: "2026-08-01", posts: 0, origin: "opening-date" }],
  });

  await ensureDailyPostsThroughToday(database, "shared", "2026-08-03");

  assert.equal(database.batched.length, 0);
  assert.equal(database.executed.length, 0);
});

test("old zero carry-forward rows are removed and rebuilt from the first real measurement", async () => {
  const database = fakeDatabase({
    openingDates: [{ account_id: "a", joined_at: "2026-08-01T00:00:00.000Z" }],
    snapshots: [{ account_id: "a", handle: "alpha", display_name: "Alpha", posts: 12, fetched_at: "2026-08-03T14:00:00.000Z" }],
    existingRows: [
      { account_id: "a", date: "2026-08-01", posts: 0, origin: "opening-date" },
      { account_id: "a", date: "2026-08-02", posts: 0, origin: "carry-forward" },
      { account_id: "a", date: "2026-08-03", posts: 0, origin: "carry-forward" },
      { account_id: "a", date: "2026-08-04", posts: 0, origin: "carry-forward" },
      { account_id: "a", date: "2026-08-05", posts: 0, origin: "carry-forward" },
    ],
  });

  await ensureDailyPostsThroughToday(database, "shared", "2026-08-05");

  assert.equal(database.batched.length, 5);
  assert.equal(database.batched.filter((statement) => statement.bindArgs?.length === 3).length, 4);
  assert.equal(database.batched.filter((statement) => statement.bindArgs?.includes(12)).length, 1);
  assert.equal(database.executed.length, 1);
});

test("frozen accounts receive no carry-forward after the freeze date and existing history stays untouched", async () => {
  const database = fakeDatabase({
    freezeDates: [{ account_id: "a", freeze_date: "2026-08-03" }],
    openingDates: [{ account_id: "a", joined_at: "2026-08-01T00:00:00.000Z" }],
    snapshots: [
      { account_id: "a", handle: "alpha", display_name: "Alpha", posts: 12, fetched_at: "2026-08-01T14:00:00.000Z" },
      { account_id: "a", handle: "alpha", display_name: "Alpha", posts: 99, fetched_at: "2026-08-05T14:00:00.000Z" },
    ],
    existingRows: [
      { account_id: "a", date: "2026-08-04", posts: 77, origin: "manual" },
    ],
  });

  await ensureDailyPostsThroughToday(database, "shared", "2026-08-05");

  assert.equal(database.batched.length, 1);
  assert.equal(database.batched[0].bindArgs?.[2], "2026-08-03");
  assert.equal(database.batched[0].sql.includes("'carry-forward'"), true);
  assert.equal(database.executed.length, 1);
  assert.match(database.executed[0].sql, /UPDATE xstats_daily_history_meta/);
  assert.equal(database.batched.some((statement) => statement.sql.includes("DELETE FROM xstats_daily_history")), false);
});

test("a null freeze date does not disable existing stale carry-forward cleanup", async () => {
  const database = fakeDatabase({
    freezeDates: [{ account_id: "a", freeze_date: null }],
    openingDates: [{ account_id: "a", joined_at: "2026-08-01T00:00:00.000Z" }],
    snapshots: [{ account_id: "a", handle: "alpha", display_name: "Alpha", posts: 12, fetched_at: "2026-08-03T14:00:00.000Z" }],
    existingRows: [
      { account_id: "a", date: "2026-08-01", posts: 0, origin: "opening-date" },
      { account_id: "a", date: "2026-08-02", posts: 0, origin: "carry-forward" },
    ],
  });

  await ensureDailyPostsThroughToday(database, "shared", "2026-08-03");

  assert.equal(database.batched.some((statement) => statement.sql.includes("DELETE FROM xstats_daily_history")), true);
});

test("legacy bucket migration does not move a row past its freeze date", async () => {
  const batches = [];
  const writes = [];
  const database = {
    prepare(sql) {
      const all = async () => {
        if (sql.includes('PRAGMA table_info("xstats_account_statuses")')) return { results: [{ name: "freeze_date" }] };
        if (sql.includes("SELECT account_id, freeze_date FROM xstats_account_statuses")) return { results: [{ account_id: "a", freeze_date: "2026-08-03" }] };
        if (sql.includes("origin = 'migration'")) return { results: [{ id: "legacy-a", session_id: "shared", date: "2026-08-03", account_id: "a", handle: "alpha", display_name: "Alpha", followers: 10, following: 5, posts: 2 }] };
        return { results: [] };
      };
      return {
        all,
        bind(...args) {
          return {
            all,
            async first() {
              if (sql.includes("SELECT revision, backfilled FROM xstats_daily_history_meta")) return { revision: 7, backfilled: 1 };
              return null;
            },
            async run() { writes.push({ sql, args }); return { meta: { changes: 1 } }; },
            bindArgs: args,
            sql,
          };
        },
      };
    },
    async batch(statements) { batches.push(...statements); },
  };

  const result = await ensureDailyHistory(database, "shared");

  assert.equal(result.backfilled, 2);
  assert.equal(batches.length, 0, "legacy data must not be deleted or shifted beyond the freeze date");
  assert.equal(writes.some(({ sql }) => sql.includes("UPDATE xstats_daily_history_meta SET backfilled = 2")), true);
  assert.equal(writes.some(({ sql }) => /\bxstats_daily_history\b/.test(sql)), false);
});
