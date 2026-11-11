import assert from "node:assert/strict";
import test from "node:test";
import {
  addHandleTargets,
  formatHandleTargetsForClipboard,
  normalizeStoredHandleTargets,
  parseHandleTargetInput,
  removeHandleTarget,
} from "../lib/account-targets.ts";

test("handle entry accepts bare names, optional @, separators, and X profile URLs", () => {
  assert.deepEqual(parseHandleTargetInput("@OpenAI, xdevelopers\nhttps://x.com/codex").handles, ["OpenAI", "xdevelopers", "codex"]);
});

test("handle entry rejects non-X URLs and invalid handle syntax", () => {
  const result = parseHandleTargetInput("https://example.com/user\n@two-name\nthis_handle_is_too_long");
  assert.deepEqual(result.handles, []);
  assert.equal(result.errors.length, 3);
});

test("stored profile URLs are normalized to handle-only targets", () => {
  assert.deepEqual(normalizeStoredHandleTargets("@alpha\nhttps://twitter.com/Beta/status/123"), { handles: ["alpha", "Beta"], errors: [] });
});

test("bulk adding removes duplicates case-insensitively and reports invalid or over-limit entries", () => {
  const result = addHandleTargets(["alpha"], "@ALPHA beta, gamma delta", 3);
  assert.deepEqual(result.handles, ["alpha", "beta", "gamma"]);
  assert.deepEqual(result.added, ["beta", "gamma"]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.overflow, 1);
});

test("removing a target is case-insensitive and does not mutate the source list", () => {
  const existing = ["alpha", "Beta", "gamma"];
  assert.deepEqual(removeHandleTarget(existing, "@BETA"), ["alpha", "gamma"]);
  assert.deepEqual(existing, ["alpha", "Beta", "gamma"]);
});

test("batch parsing returns malformed tokens while preserving valid handles", () => {
  const result = parseHandleTargetInput("good @bad-name https://not-x.example/a");
  assert.deepEqual(result.handles, ["good"]);
  assert.deepEqual(result.errors, ["@bad-name", "https://not-x.example/a"]);
});

test("clipboard text uses one @handle per line and removes duplicate targets", () => {
  assert.equal(formatHandleTargetsForClipboard(["alpha", "@Beta", "ALPHA"]), "@alpha\n@Beta");
});
