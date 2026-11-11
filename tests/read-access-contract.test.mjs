import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

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
  const writes = /\b(?:ensureSchema|ensureSharedSession|ensureDailyHistory|ensureDailyPostsThroughToday|ensureOpeningDateHistory|ensureAccountStatuses|pruneSessionHistory|prepareEditorContext)\s*\(/;
  for (const [path, method, gate] of routes) {
    const body = methodBody(await source(path), method);
    assert.ok(body.includes(gate), `${path} must apply ${gate}`);
    assert.doesNotMatch(body, writes, `${path} must not perform maintenance during GET`);
  }
});

test("management and integration read routes remain administrator-only", async () => {
  const routes = [
    ["app/api/import/mappings/route.ts", "GET"],
    ["app/api/admin/historical-data/route.ts", "GET"],
    ["app/api/admin/nflf-duplicate/route.ts", "GET"],
    ["app/api/microsoft/files/route.ts", "GET"],
    ["app/api/microsoft/status/route.ts", "GET"],
  ];
  for (const [path, method] of routes) {
    assert.ok(methodBody(await source(path), method).includes("requireAdmin"), `${path} must stay administrator-only`);
  }
});

test("Microsoft read endpoints never refresh and persist tokens during GET", async () => {
  const shared = await source("app/api/microsoft/_shared.ts");
  assert.match(shared, /options: \{ readOnly\?: boolean \} = \{\}/);
  assert.match(shared, /if \(readOnly\) return \{ session, config, error:[^\n]+refreshRequired: true \}/);
  const status = await source("app/api/microsoft/status/route.ts");
  const files = await source("app/api/microsoft/files/route.ts");
  assert.match(methodBody(status, "GET"), /readOnly: true/);
  assert.match(methodBody(files, "GET"), /readOnly: true/);
  assert.doesNotMatch(methodBody(files, "GET"), /details:\s*payload/);
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
    ["app/api/admin/nflf-duplicate/route.ts", "POST"],
    ["app/api/microsoft/file/route.ts", "POST"],
    ["app/api/microsoft/file/route.ts", "PUT"],
  ];
  for (const [path, method] of routes) {
    const body = methodBody(await source(path), method);
    assert.ok(body.includes("requireAdmin") || body.includes("requireMicrosoftConnection"), `${path} ${method} must stay protected`);
  }
});

test("Microsoft OAuth callback checks the administrator before exchanging or saving tokens", async () => {
  const callback = await source("app/api/microsoft/callback/route.ts");
  const body = methodBody(callback, "GET");
  const adminCheck = body.indexOf("isAdminRequest(request)");
  assert.notEqual(adminCheck, -1, "OAuth callback must require the administrator cookie");
  assert.ok(body.indexOf("exchangeAuthorizationCode") > adminCheck, "callback must authenticate before exchanging an authorization code");
  assert.ok(body.indexOf("saveMicrosoftConnection") > adminCheck, "callback must authenticate before saving tokens");
});
