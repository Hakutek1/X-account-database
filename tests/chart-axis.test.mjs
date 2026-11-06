import assert from "node:assert/strict";
import test from "node:test";
import { resolveLinearAxisDomain } from "../lib/chart-axis.ts";

test("an explicit minimum overrides the zero baseline", () => {
  assert.deepEqual(
    resolveLinearAxisDomain({ baseline: 0, values: [1200, 1800], min: 1000, max: null }),
    { lower: 1000, upper: 1800 },
  );
});

test("an explicit maximum overrides the automatic upper bound", () => {
  assert.deepEqual(
    resolveLinearAxisDomain({ baseline: 0, values: [1200, 1800], min: null, max: 1500 }),
    { lower: 0, upper: 1500 },
  );
});

test("an invalid collapsed range stays drawable", () => {
  const domain = resolveLinearAxisDomain({ baseline: 0, values: [10], min: 10, max: 10 });
  assert.equal(domain.lower, 10);
  assert.ok(domain.upper > domain.lower);
});
