import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("the retired NFLF duplicate cleanup API is absent", async () => {
  await assert.rejects(access(new URL("../app/api/admin/nflf-duplicate/route.ts", import.meta.url)), { code: "ENOENT" });
});

function methodBody(contents, method) {
  const start = contents.indexOf(`export async function ${method}(`);
  assert.notEqual(start, -1, `missing ${method} handler`);
  const next = contents.indexOf("\nexport async function ", start + 1);
  return contents.slice(start, next === -1 ? contents.length : next);
}

test("all data read routes enforce the selected read mode and stay read-only", async () => {
  const routes = [
    ["app/api/history/route.ts", "GET", "requireReadAccess"],
    ["app/api/avatar/route.ts", "GET", "requireReadAccess"],
  ];
  const writes = /\b(?:ensureSchema|ensureSharedSession|ensureDailyHistory|ensureDailyPostsThroughToday|ensureOpeningDateHistory|ensureAccountStatuses|prepareEditorContext)\s*\(/;
  for (const [path, method, gate] of routes) {
    const body = methodBody(await source(path), method);
    assert.ok(body.includes(gate), `${path} must apply ${gate}`);
    assert.doesNotMatch(body, writes, `${path} must not perform maintenance during GET`);
  }
});

test("management read routes remain administrator-only", async () => {
  const routes = [
    ["app/api/import/mappings/route.ts", "GET"],
    ["app/api/admin/historical-data/route.ts", "GET"],
  ];
  for (const [path, method] of routes) {
    assert.ok(methodBody(await source(path), method).includes("requireAdmin"), `${path} must stay administrator-only`);
  }
});

test("Microsoft integration routes and token schema are retired by a scoped forward migration", async () => {
  for (const path of [
    "app/api/microsoft/_shared.ts",
    "app/api/microsoft/callback/route.ts",
    "app/api/microsoft/file/route.ts",
    "app/api/microsoft/files/route.ts",
    "app/api/microsoft/login/route.ts",
    "app/api/microsoft/logout/route.ts",
    "app/api/microsoft/status/route.ts",
    "lib/microsoft-onedrive.ts",
  ]) {
    await assert.rejects(access(new URL(`../${path}`, import.meta.url)), { code: "ENOENT" });
  }
  const [schema, db, migration] = await Promise.all([
    source("db/schema.ts"),
    source("db/index.ts"),
    source("drizzle/0017_remove_microsoft_tokens.sql"),
  ]);
  assert.doesNotMatch(schema, /xstats_microsoft_tokens|microsoftTokens|xstatsMicrosoftTokens/);
  assert.doesNotMatch(db, /xstats_microsoft_tokens|microsoftTokens/);
  assert.match(migration.trim(), /^DROP TABLE IF EXISTS xstats_microsoft_tokens;$/);
});

test("history removes unused identifiers and audit details from the public response", async () => {
  const history = await source("lib/public-history.ts");
  assert.doesNotMatch(history, /deletedAccountIds|importIssues|xstats_import_issues/);
  assert.match(history, /success_count: run\.success_count/);
  assert.doesNotMatch(history, /source_summary\s*:/);
  const db = await source("db/index.ts");
  assert.doesNotMatch(db, /VALUES\s*\(\s*\?\s*,\s*['"]excel:/);
});

test("private UI waits for read policy and never restores account rows directly from localStorage", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /if \(!isReadAccessReady\) return;/);
  assert.match(page, /payload\.readMode === "public"/);
  assert.doesNotMatch(page, /setRows\(parsed\.rows/);
  assert.match(page, /clearCachedAccountData/);
  assert.match(page, /await loadHistory\(\)/);
});

test("all mutation handlers keep their administrator gate", async () => {
  const routes = [
    ["app/api/collect/route.ts", "POST"],
    ["app/api/import/history/route.ts", "POST"],
    ["app/api/excel/daily-sync/route.ts", "POST"],
    ["app/api/avatar-sync/route.ts", "POST"],
    ["app/api/admin/avatar/route.ts", "POST"],
    ["app/api/admin/avatar/route.ts", "DELETE"],
    ["app/api/admin/historical-data/route.ts", "POST"],
    ["app/api/admin/historical-data/route.ts", "PUT"],
  ];
  for (const [path, method] of routes) {
    const body = methodBody(await source(path), method);
    assert.ok(body.includes("requireAdmin"), `${path} ${method} must stay protected`);
  }
});
