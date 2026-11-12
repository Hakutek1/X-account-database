import assert from "node:assert/strict";
import test from "node:test";
import {
  filterChartPickerAccounts,
  getNextChartMarkIndex,
  getRovingTabIndex,
  groupChartPickerAccounts,
  updateChartSelection,
} from "../lib/chart-accessibility.ts";

const accounts = [
  { handle: "alpha", displayName: "アルファ", accountStatus: "active" },
  { handle: "beta", displayName: "ベータ", accountStatus: "suspended" },
  { handle: "gamma", displayName: "Gamma", accountStatus: "ended" },
  { handle: "delta", displayName: "Delta", accountStatus: "non_alt" },
];

test("chart picker searches display names and handles by partial match", () => {
  assert.deepEqual(filterChartPickerAccounts(accounts, { query: "ルファ", selectedOnly: false, selectedHandles: [] }).map((row) => row.handle), ["alpha"]);
  assert.deepEqual(filterChartPickerAccounts(accounts, { query: "@BET", selectedOnly: false, selectedHandles: [] }).map((row) => row.handle), ["beta"]);
});

test("chart picker selected-only filter does not change the saved selection", () => {
  assert.deepEqual(filterChartPickerAccounts(accounts, { query: "", selectedOnly: true, selectedHandles: ["gamma"] }).map((row) => row.handle), ["gamma"]);
});

test("chart picker groups retain the account-status order", () => {
  const groups = groupChartPickerAccounts(accounts);
  assert.deepEqual(groups.map((group) => group.status), ["active", "ended", "suspended", "non_alt"]);
  assert.deepEqual(groups[2].rows.map((row) => row.handle), ["beta"]);
});

test("bulk selection changes filtered accounts while preserving hidden selections", () => {
  const filtered = [accounts[0], accounts[1]];
  assert.deepEqual(updateChartSelection(["outside", "alpha"], filtered, true), ["outside", "alpha", "beta"]);
  assert.deepEqual(updateChartSelection(["outside", "alpha", "beta"], filtered, false), ["outside"]);
});

test("tabs follow the WAI roving-focus keys", () => {
  assert.equal(getRovingTabIndex(0, "ArrowRight", 3), 1);
  assert.equal(getRovingTabIndex(0, "ArrowLeft", 3), 2);
  assert.equal(getRovingTabIndex(1, "Home", 3), 0);
  assert.equal(getRovingTabIndex(1, "End", 3), 2);
  assert.equal(getRovingTabIndex(0, "ArrowDown", 3), null);
});

test("chart marks move in draw order with arrow keys", () => {
  assert.equal(getNextChartMarkIndex(0, "ArrowRight", 3), 1);
  assert.equal(getNextChartMarkIndex(1, "ArrowDown", 3), 2);
  assert.equal(getNextChartMarkIndex(0, "ArrowLeft", 3), 2);
  assert.equal(getNextChartMarkIndex(1, "Home", 3), 0);
  assert.equal(getNextChartMarkIndex(1, "End", 3), 2);
});
