import assert from "node:assert/strict";
import test from "node:test";

import { ensureOpeningDateHistory } from "../lib/daily-history.ts";

function fakeDatabase({ openingDates = [], identities = [], dailyRows = [], snapshots = [] } = {}) {
  const executed = [];
  const batched = [];
  const statementFor = (sql) => {
    const statement = {
      bind(...args) {
        const bound = {
          bindArgs: args,
          all: async () => {
            if (sql.includes("joined_at") && sql.includes("FROM xstats_account_statuses")) return { results: openingDates };
            if (sql.includes("FROM xstats_snapshots WHERE session_id = ? GROUP BY account_id")) return { results: identities.filter((row) => row.source !== "daily") };
            if (sql.includes("FROM xstats_daily_history WHERE session_id = ? GROUP BY account_id")) return { results: identities.filter((row) => row.source === "daily") };
            if (sql.includes("SELECT account_id, date, handle, display_name")) return { results: dailyRows };
            if (sql.includes("SELECT account_id, handle, display_name, fetched_at")) return { results: snapshots };
            return { results: [] };
          },
          run: async () => {
            executed.push({ sql, args });
            return { meta: { changes: 1 } };
          },
        };
        return bound;
      },
    };
    return statement;
  };
  return {
    prepare(sql) {
      return statementFor(sql);
    },
    async batch(statements) {
      for (const statement of statements) {
        batched.push(statement);
      }
    },
    executed,
    batched,
  };
}

test("opening date history creates zero values when the opening date has no record", async () => {
  const database = fakeDatabase({
    openingDates: [{ account_id: "a", joined_at: "2026-07-01T00:00:00.000Z" }],
    identities: [{ account_id: "a", handle: "alpha", display_name: "Alpha", source: "snapshot" }],
  });

  const changed = await ensureOpeningDateHistory(database, "shared", "2026-07-02");

  assert.equal(changed, 1);
  assert.equal(database.batched.length, 1);
  const args = database.batched[0].bindArgs;
  assert.deepEqual(args.slice(0, 10), [
    "daily-history:a:2026-07-01",
    "shared",
    "2026-07-01",
    "a",
    "alpha",
    "Alpha",
    0,
    0,
    0,
    "2026-06-30T15:00:00.001Z",
  ]);
  assert.equal(typeof args[10], "string");
});

test("opening date history keeps existing numbers and fills only missing metrics", async () => {
  const database = fakeDatabase({
    openingDates: [{ account_id: "a", joined_at: "2026-07-01T00:00:00.000Z" }],
    identities: [{ account_id: "a", handle: "alpha", display_name: "Alpha", source: "snapshot" }],
    dailyRows: [{ account_id: "a", date: "2026-07-01", handle: "alpha", display_name: "Alpha", followers: 12, following: null, posts: 8 }],
  });

  const changed = await ensureOpeningDateHistory(database, "shared", "2026-07-02");

  assert.equal(changed, 1);
  assert.equal(database.batched.length, 1);
});

test("opening date history preserves a partial raw value and zeros missing metrics", async () => {
  const database = fakeDatabase({
    openingDates: [{ account_id: "a", joined_at: "2026-07-01T00:00:00.000Z" }],
    identities: [{ account_id: "a", handle: "alpha", display_name: "Alpha", source: "snapshot" }],
    snapshots: [{ account_id: "a", handle: "alpha", display_name: "Alpha", fetched_at: "2026-06-30T16:00:00.000Z", followers: 12, following: null, posts: null }],
  });

  const changed = await ensureOpeningDateHistory(database, "shared", "2026-07-02");

  assert.equal(changed, 1);
  assert.equal(database.batched.length, 1);
});
