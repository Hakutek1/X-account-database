import assert from "node:assert/strict";
import test from "node:test";

import { buildFrozenMetricIndex, frozenProjectionDate, isValidFreezeDate, shouldUnfreezeAfterCollection } from "../lib/freeze-date.ts";

test("freeze dates require a real YYYY-MM-DD calendar date", () => {
  assert.equal(isValidFreezeDate("2026-11-13"), true);
  assert.equal(isValidFreezeDate("2026-02-29"), false);
  assert.equal(isValidFreezeDate("2026-11-3"), false);
  assert.equal(isValidFreezeDate(null), false);
});

test("projection keeps dates before the freeze date and pins later dates to it", () => {
  assert.equal(frozenProjectionDate("2026-11-12", "2026-11-13"), "2026-11-12");
  assert.equal(frozenProjectionDate("2026-11-13", "2026-11-13"), "2026-11-13");
  assert.equal(frozenProjectionDate("2026-11-14", "2026-11-13"), "2026-11-13");
  assert.equal(frozenProjectionDate("2026-11-14", null), "2026-11-14");
});

test("a successful collection only unfreezes after the recorded JST calendar date", () => {
  assert.equal(shouldUnfreezeAfterCollection("2026-11-13", "2026-11-12"), false);
  assert.equal(shouldUnfreezeAfterCollection("2026-11-13", "2026-11-13"), false);
  assert.equal(shouldUnfreezeAfterCollection("2026-11-13", "2026-11-14"), true);
  assert.equal(shouldUnfreezeAfterCollection("2026-02-30", "2026-11-14"), false);
  assert.equal(shouldUnfreezeAfterCollection(null, "2026-11-14"), false);
});

test("metric projection uses the latest value at or before freeze and prior distinct measurement", () => {
  const rows = [
    { account_id: "a", account_status: "suspended", freeze_date: "2026-11-13", fetched_at: "2026-11-10T01:00:00.000Z", followers: 90, following: 40, posts: 9, display_name: "Old", handle: "alpha" },
    { account_id: "a", account_status: "suspended", freeze_date: "2026-11-13", fetched_at: "2026-11-12T02:00:00.000Z", followers: 100, following: null, posts: 10, display_name: "Alpha", handle: "alpha" },
    { account_id: "a", account_status: "suspended", freeze_date: "2026-11-13", fetched_at: "2026-11-12T18:00:00.000Z", followers: 105, following: 42, posts: null, display_name: "Alpha", handle: "alpha" },
    { account_id: "a", account_status: "suspended", freeze_date: "2026-11-13", fetched_at: "2026-11-14T02:00:00.000Z", followers: 999, following: 999, posts: 999, display_name: "Future", handle: "alpha" },
  ];
  const index = buildFrozenMetricIndex(rows, (row) => row.fetched_at.slice(0, 10));
  const projected = index.get("a");
  assert.ok(projected);
  assert.equal(projected.atFreeze.followers?.value, 105);
  assert.equal(projected.beforeFreeze.followers?.value, 90);
  assert.equal(projected.atFreeze.following?.value, 42);
  assert.equal(projected.beforeFreeze.following?.value, 40);
  assert.equal(projected.atFreeze.posts?.value, 10);
  assert.equal(projected.beforeFreeze.posts?.value, 9);
  assert.equal(projected.latestRow?.display_name, "Alpha");
});
