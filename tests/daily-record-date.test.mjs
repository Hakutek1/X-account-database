import assert from "node:assert/strict";
import test from "node:test";

import { dailyRecordDate } from "../lib/daily-history.ts";

test("JST midnight minute is assigned to the same calendar day", () => {
  assert.equal(dailyRecordDate("2026-11-15T15:00:00.000Z"), "2026-11-16");
  assert.equal(dailyRecordDate("2026-11-15T15:00:59.999Z"), "2026-11-16");
});

test("any minute after JST midnight is assigned to the following day", () => {
  assert.equal(dailyRecordDate("2026-11-15T15:01:00.000Z"), "2026-11-17");
  assert.equal(dailyRecordDate("2026-11-16T14:59:00.000Z"), "2026-11-17");
});

test("daily assignment handles leap days and year boundaries", () => {
  assert.equal(dailyRecordDate("2024-02-28T15:00:00.000Z"), "2024-02-29");
  assert.equal(dailyRecordDate("2026-12-31T14:59:00.000Z"), "2027-01-01");
  assert.equal(dailyRecordDate("invalid"), null);
});
