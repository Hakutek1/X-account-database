import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const exists = (path) => existsSync(new URL(path, import.meta.url));

test("server-side scheduled collection has been fully removed", () => {
  for (const path of [
    "../app/api/schedule/route.ts",
    "../lib/automation.ts",
    "../lib/schedule.ts",
    "../lib/scheduled-runner.ts",
    "../tests/automation.test.mjs",
    "../tests/schedule-status-integration.test.mjs",
  ]) {
    assert.equal(exists(path), false, path + " should not be present");
  }

  const page = read("../app/page.tsx");
  const worker = read("../worker/index.ts");
  const vite = read("../vite.config.ts");
  const schema = read("../db/schema.ts");
  const database = read("../db/index.ts");
  const shared = read("../app/api/_shared.ts");

  assert.doesNotMatch(page, /自動取得|scheduleInput|saveSchedule|\/api\/schedule|ScheduleResponse/);
  assert.doesNotMatch(worker, /runScheduledCollections|async scheduled/);
  assert.doesNotMatch(vite, /crons:/);
  assert.doesNotMatch(schema, /xstats_(?:schedules|watchlist)/);
  assert.doesNotMatch(database, /xstats_(?:schedules|watchlist)/);
  assert.doesNotMatch(shared, /pruneAllSessionsHistory/);

  assert.match(page, /\/api\/collect/);
  assert.match(page, /グラフ表示/);
  assert.match(schema, /xstatsAccountStatuses/);
  assert.match(schema, /xstatsDailyHistory/);
});

test("migration 0013 removes exactly the two scheduled-collection tables", () => {
  const files = readdirSync(new URL("../drizzle/", import.meta.url));
  const migrations = files.filter((name) => /^0013_.*\.sql$/.test(name));
  assert.equal(migrations.length, 1);
  const sql = read("../drizzle/" + migrations[0]);
  const statements = sql
    .replaceAll("--> statement-breakpoint", "")
    .split(";")
    .map((statement) => statement.replaceAll(String.fromCharCode(96), "").replaceAll('"', "").replace(/\s+/g, " ").trim().toUpperCase())
    .filter(Boolean)
    .sort();
  assert.deepEqual(statements, ["DROP TABLE XSTATS_SCHEDULES", "DROP TABLE XSTATS_WATCHLIST"]);
});
