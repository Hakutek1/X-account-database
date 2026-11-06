import assert from "node:assert/strict";
import test from "node:test";
import { parseReadMode } from "../lib/read-mode.ts";

test("XSTATS_READ_MODE enables public reads only for the explicit public value", () => {
  assert.equal(parseReadMode("public"), "public");
  assert.equal(parseReadMode(" public "), "public");
  for (const value of [undefined, null, "", "private", "PUBLIC", "enabled", 1]) {
    assert.equal(parseReadMode(value), "private", `unexpected read mode for ${String(value)}`);
  }
});
