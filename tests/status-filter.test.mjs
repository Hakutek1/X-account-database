import assert from "node:assert/strict";
import test from "node:test";

import { normalizeStoredStatusFilter } from "../lib/status-filter.ts";

test("legacy combined activity-ended filter migrates to include frozen accounts", () => {
  assert.deepEqual(normalizeStoredStatusFilter(["active", "ended"], 1), ["active", "ended", "suspended"]);
});

test("new filter settings can keep ended and frozen categories separate", () => {
  assert.deepEqual(normalizeStoredStatusFilter(["ended"], 2), ["ended"]);
  assert.deepEqual(normalizeStoredStatusFilter(["suspended"], 2), ["suspended"]);
});

test("invalid and duplicate saved categories are ignored", () => {
  assert.deepEqual(normalizeStoredStatusFilter(["ended", "ended", "unknown"], 2), ["ended"]);
  assert.equal(normalizeStoredStatusFilter(null, 2), null);
});
