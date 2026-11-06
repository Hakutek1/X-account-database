import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildPublicHistoryResponse } from "../lib/public-history.ts";

function makeDatabase({ runs = [], exclusions = [] } = {}) {
  const queries = [];
  return {
    queries,
    database: {
      prepare(query) {
        queries.push(query);
        return {
          bind() { return this; },
          async all() {
            if (query.includes("FROM xstats_runs")) return { results: runs };
            if (query.includes("FROM xstats_historical_account_exclusions")) return { results: exclusions };
            throw new Error(`Unexpected query: ${query}`);
          },
        };
      },
    },
  };
}

test("public history returns collection freshness and performs only reads", async () => {
  const runs = [
    { id: "imported-latest", fetched_at: "2026-10-31T03:00:00.000Z", success_count: 99, error_count: 0, source_summary: JSON.stringify({ imported: true }) },
    { id: "actual-run", fetched_at: "2026-10-30T03:00:00.000Z", success_count: 2, error_count: 1, source_summary: JSON.stringify({ manualCount: 2 }) },
  ];
  const rows = [
    { run_id: "actual-run", fetched_at: "2026-10-30T03:00:00.000Z", account_id: "a1" },
    { run_id: "imported-run", fetched_at: "2020-01-01T03:00:00.000Z", account_id: "a1" },
  ];
  const { database, queries } = makeDatabase({ runs });
  const response = await buildPublicHistoryResponse(database, "shared", async () => rows);

  assert.deepEqual(response.latestCollection, {
    fetched_at: "2026-10-30T03:00:00.000Z",
    success_count: 2,
    error_count: 1,
  });
  assert.deepEqual(response.rows, rows);
  assert.equal(response.runs[0].id, "imported-latest");
  assert.ok(response.runs.some((run) => run.id === "imported-run"));
  assert.ok(response.runs.every((run) => !("source_summary" in run)), "internal import metadata must not be returned");
  assert.equal("deletedAccountIds" in response, false);
  assert.equal("importIssues" in response, false);
  assert.equal(queries.length, 1);
  assert.ok(queries.every((query) => /^\s*SELECT\b/i.test(query)));
  assert.ok(queries.every((query) => !/xstats_import_issues/i.test(query)));
});

test("public history reports the no-collection state without inventing a run", async () => {
  const { database } = makeDatabase();
  const response = await buildPublicHistoryResponse(database, "shared", async () => []);
  assert.equal(response.latestCollection, null);
  assert.deepEqual(response.runs, []);
  assert.deepEqual(response.rows, []);
});

test("the public history route does not call maintenance or retention writers", async () => {
  const route = await readFile(new URL("../app/api/history/route.ts", import.meta.url), "utf8");
  assert.match(route, /buildPublicHistoryResponse/);
  assert.doesNotMatch(route, /ensureSchema|ensureSharedSession|ensureDailyHistory|ensureDailyPostsThroughToday|ensureAccountStatuses|ensureOpeningDateHistory|pruneSessionHistory/);
  assert.doesNotMatch(route, /importIssues|xstats_import_issues/);
});
