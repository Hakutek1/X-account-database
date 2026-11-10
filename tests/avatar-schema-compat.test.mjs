import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadEffectiveHistory } from "../lib/daily-history.ts";

function makeDatabase({ hasAvatarColumn, avatarUrl = null }) {
  const queries = [];
  return {
    queries,
    database: {
      prepare(query) {
        queries.push(query);
        return {
          bind() { return this; },
          async all() {
            if (query.startsWith('PRAGMA table_info("xstats_snapshots")')) {
              return { results: hasAvatarColumn ? [{ name: "avatar_url" }] : [] };
            }
            if (query.includes("FROM xstats_snapshots AS snapshots")) {
              return {
                results: [{
                  id: "snapshot-1",
                  run_id: "run-1",
                  fetched_at: "2026-11-09T03:00:00.000Z",
                  account_id: "account-1",
                  handle: "sample",
                  display_name: "Sample",
                  followers: 10,
                  following: 20,
                  posts: 30,
                  avatar_url: avatarUrl,
                  account_status: "active",
                  joined: null,
                }],
              };
            }
            if (query.includes("FROM xstats_daily_history AS daily")) return { results: [] };
            throw new Error(`Unexpected query: ${query}`);
          },
        };
      },
    },
  };
}

test("history reads tolerate an older snapshots table without avatar_url and remain read-only", async () => {
  const { database, queries } = makeDatabase({ hasAvatarColumn: false });
  const rows = await loadEffectiveHistory(database, "shared");

  assert.equal(rows.length, 1);
  assert.equal(rows[0].avatar_url, null);
  assert.ok(queries[0].startsWith('PRAGMA table_info("xstats_snapshots")'));
  assert.ok(queries.some((query) => /COALESCE\(assets\.avatar_url, NULL\) AS avatar_url/.test(query)));
  assert.ok(queries.every((query) => /^\s*(?:PRAGMA|SELECT)\b/i.test(query)));
});

test("history reads retain snapshot avatars when the column exists", async () => {
  const avatarUrl = "https://example.invalid/avatar.png";
  const { database, queries } = makeDatabase({ hasAvatarColumn: true, avatarUrl });
  const rows = await loadEffectiveHistory(database, "shared");

  assert.equal(rows.length, 1);
  assert.equal(rows[0].avatar_url, avatarUrl);
  assert.ok(queries.some((query) => /snapshots\.avatar_url/.test(query)));
});

test("the pending avatar migration cannot fail on a column already created by ensureSchema", async () => {
  const migration = await readFile(new URL("../drizzle/0014_add_avatar_fields.sql", import.meta.url), "utf8");
  assert.match(migration, /^\s*SELECT\s+1\s*;\s*$/i);
  assert.doesNotMatch(migration, /ALTER\s+TABLE/i);
});
