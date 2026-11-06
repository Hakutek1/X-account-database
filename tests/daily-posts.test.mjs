import assert from "node:assert/strict";
import test from "node:test";

import { ensureDailyPostsThroughToday } from "../lib/daily-history.ts";

function fakeDatabase({ openingDates = [], dailyRows = [], snapshots = [], existingRows = [] } = {}) {
  const batched = [];
  const executed = [];
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async all() {
              if (sql.includes("origin FROM xstats_daily_history") && sql.includes("posts IS NOT NULL")) return { results: dailyRows };
              if (sql.includes("FROM xstats_snapshots WHERE session_id = ? AND posts IS NOT NULL")) return { results: snapshots };
              if (sql.includes("joined_at FROM xstats_account_statuses")) return { results: openingDates };
              if (sql.includes("SELECT account_id, date, posts, origin")) return { results: existingRows };
              return { results: [] };
            },
            async run() {
              executed.push({ sql, args });
              return { meta: { changes: 1 } };
            },
            bindArgs: args,
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
