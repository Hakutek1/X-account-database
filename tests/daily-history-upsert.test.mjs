import assert from "node:assert/strict";
import test from "node:test";

import { canonicalDailyFetchedAt, stableDailyHistoryId, upsertAcquiredDailyHistory } from "../lib/daily-history.ts";

function makeDatabase(initialRows = []) {
  const rows = new Map(initialRows.map((row) => [`${row.account_id}|${row.date}`, structuredClone(row)]));
  const batches = [];
  const executions = [];
  const queries = [];
  const database = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            sql,
            args,
            async all() {
              queries.push({ sql, args });
              if (!sql.includes("FROM xstats_daily_history")) throw new Error(`Unexpected query: ${sql}`);
              const dates = new Set(args.slice(1));
              return { results: [...rows.values()].filter((row) => row.session_id === args[0] && dates.has(row.date)) };
            },
            async run() {
              executions.push({ sql, args });
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
    async batch(statements) {
      batches.push(...statements);
      for (const statement of statements) {
        const [id, session_id, date, account_id, handle, display_name, followers, following, posts, fetched_at, origin, updated_at] = statement.args;
        const key = `${account_id}|${date}`;
        const current = rows.get(key);
        rows.set(key, current ? {
          ...current,
          handle,
          display_name,
          followers: current.origin === "manual" ? current.followers : followers ?? current.followers,
          following: current.origin === "manual" ? current.following : following ?? current.following,
          posts: current.origin === "manual" ? current.posts : posts ?? current.posts,
          fetched_at,
          updated_at,
          origin: current.origin === "manual" ? "manual" : origin,
        } : { id, session_id, date, account_id, handle, display_name, followers, following, posts, fetched_at, updated_at, origin });
      }
    },
  };
  return { database, rows, batches, executions, queries };
}

const dailyRow = ({ accountId = "a", date = "2026-11-16", origin = "acquired", followers = 100, following = 200, posts = 300 } = {}) => ({
  id: stableDailyHistoryId(accountId, date),
  session_id: "shared",
  date,
  account_id: accountId,
  handle: "alpha",
  display_name: "Alpha",
  followers,
  following,
  posts,
  fetched_at: canonicalDailyFetchedAt(date),
  origin,
  updated_at: "2026-11-15T00:00:00.000Z",
});

test("same-day acquisitions update valid metrics while later nulls keep prior values", async () => {
  const store = makeDatabase([dailyRow()]);
  await upsertAcquiredDailyHistory(store.database, "shared", [
    { fetchedAt: "2026-11-15T05:00:00.000Z", accountId: "a", handle: "alpha", displayName: "Alpha", followers: 110, following: 210, posts: 310 },
    { fetchedAt: "2026-11-15T06:00:00.000Z", accountId: "a", handle: "alpha", displayName: "Alpha", followers: 120, following: null, posts: 320 },
  ], "2026-11-15T06:01:00.000Z");

  assert.deepEqual(
    { followers: store.rows.get("a|2026-11-16").followers, following: store.rows.get("a|2026-11-16").following, posts: store.rows.get("a|2026-11-16").posts },
    { followers: 120, following: 210, posts: 320 },
  );
  assert.equal(store.batches.length, 1);
  assert.match(store.batches[0].sql, /COALESCE\(excluded\.followers, xstats_daily_history\.followers\)/);
  assert.match(store.batches[0].sql, /origin = 'manual'/);
  assert.equal(store.executions.length, 1, "revision advances once when daily values change");
});

test("a retry with no valid metrics and a failed account do not erase or write daily values", async () => {
  const store = makeDatabase([dailyRow()]);
  await upsertAcquiredDailyHistory(store.database, "shared", [
    { fetchedAt: "2026-11-15T06:00:00.000Z", accountId: "a", handle: "alpha", displayName: "Alpha", followers: null, following: null, posts: null },
  ]);
  await upsertAcquiredDailyHistory(store.database, "shared", []);

  assert.deepEqual(
    { followers: store.rows.get("a|2026-11-16").followers, following: store.rows.get("a|2026-11-16").following, posts: store.rows.get("a|2026-11-16").posts },
    { followers: 100, following: 200, posts: 300 },
  );
  assert.equal(store.queries.length, 0);
  assert.equal(store.batches.length, 0);
  assert.equal(store.executions.length, 0);
});

test("manual daily values remain unchanged by a successful later acquisition", async () => {
  const store = makeDatabase([dailyRow({ origin: "manual", followers: 7, following: 8, posts: 9 })]);
  await upsertAcquiredDailyHistory(store.database, "shared", [
    { fetchedAt: "2026-11-15T06:00:00.000Z", accountId: "a", handle: "alpha", displayName: "Alpha", followers: 120, following: 220, posts: 320 },
  ]);

  assert.deepEqual(
    { followers: store.rows.get("a|2026-11-16").followers, following: store.rows.get("a|2026-11-16").following, posts: store.rows.get("a|2026-11-16").posts, origin: store.rows.get("a|2026-11-16").origin },
    { followers: 7, following: 8, posts: 9, origin: "manual" },
  );
  assert.equal(store.batches.length, 0);
  assert.equal(store.executions.length, 0);
});

test("an acquisition in a new JST daily bucket creates a separate date row", async () => {
  const store = makeDatabase([dailyRow()]);
  await upsertAcquiredDailyHistory(store.database, "shared", [
    { fetchedAt: "2026-11-16T14:59:00.000Z", accountId: "a", handle: "alpha", displayName: "Alpha", followers: 130, following: 230, posts: 330 },
  ]);

  assert.equal(store.rows.get("a|2026-11-17").followers, 130);
  assert.equal(store.rows.get("a|2026-11-16").followers, 100);
});
