import assert from "node:assert/strict";

const base = process.env.APP_URL ?? "http://127.0.0.1:4173";
const mode = process.argv[2] ?? "private";
const prepareOnly = process.argv[3] === "prepare";
assert.ok(mode === "private" || mode === "public", "mode must be private or public");

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.cookie) headers.set("Cookie", options.cookie);
  if (options.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(new URL(path, base), {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : typeof options.body === "string" ? options.body : JSON.stringify(options.body),
    redirect: "manual",
  });
  const type = response.headers.get("content-type") ?? "";
  const body = type.includes("json") ? await response.json() : await response.text();
  return { response, body };
}

async function adminCookie() {
  const { response, body } = await request("/api/admin/login", { method: "POST", body: { key: "preview-only-key" } });
  assert.equal(response.status, 200, `admin login failed: ${JSON.stringify(body)}`);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie?.startsWith("xstats_admin="), "login should issue the admin session cookie");
  return cookie;
}

if (prepareOnly) {
  const cookie = await adminCookie();
  const { response, body } = await request("/api/admin/historical-data", { method: "POST", cookie });
  assert.equal(response.status, 200, `admin preparation failed: ${JSON.stringify(body)}`);
  assert.equal(body.prepared, true);
  console.log("admin-only history preparation passed");
  process.exit(0);
}

const status = await request("/api/admin/status");
assert.equal(status.response.status, 200);
assert.equal(status.body.readMode, mode);
assert.equal(status.body.isAdmin, false);
assert.equal(status.body.configured, true);
assert.equal((await request("/api/site-version")).response.status, 200);

const reads = [
  { path: "/api/history", publicStatus: 200 },
  { path: "/api/avatar?accountId=missing-read-test", publicStatus: 404 },
  { path: "/api/import/mappings", publicStatus: 200, adminOnly: true },
  { path: "/api/admin/historical-data?metric=followers", publicStatus: 200, adminOnly: true },
  { path: "/api/admin/nflf-duplicate", publicStatus: 200, adminOnly: true },
  { path: "/api/microsoft/status", publicStatus: 200, adminOnly: true },
  { path: "/api/microsoft/files", publicStatus: 503, adminOnly: true },
];

for (const item of reads) {
  const { response, body } = await request(item.path);
  const expected = mode === "private" || item.adminOnly ? 403 : item.publicStatus;
  assert.equal(response.status, expected, `${mode} anonymous GET ${item.path}: ${JSON.stringify(body)}`);
  if (response.status !== 403) {
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /access_token|refresh_token|client_secret|XSTATS_ADMIN_KEY/i, `${item.path} must not expose credentials`);
    assert.doesNotMatch(serialized, /excel:parodys\.l\.a/i, `${item.path} must not expose a legacy account ID`);
    if (item.path === "/api/history") {
      assert.equal("deletedAccountIds" in body, false);
      assert.equal("importIssues" in body, false);
      assert.ok(body.runs?.every((run) => !("source_summary" in run)), "history must not expose internal import metadata");
    }
    if (item.path === "/api/microsoft/status" && mode === "public") {
      assert.equal(body.configured, true);
      assert.equal(body.connected, false);
      assert.equal(body.user, null);
    }
  }
}

const protectedWrites = [
  { path: "/api/collect", method: "POST", body: { handles: [] } },
  { path: "/api/import/history", method: "POST", body: {} },
  { path: "/api/excel/daily-sync", method: "POST", body: { rows: [] } },
  { path: "/api/avatar-sync", method: "POST", body: { rows: [] } },
  { path: "/api/admin/avatar", method: "POST", body: {} },
  { path: "/api/admin/avatar", method: "DELETE", body: {} },
  { path: "/api/admin/historical-data", method: "POST", body: {} },
  { path: "/api/admin/historical-data", method: "PUT", body: {} },
  { path: "/api/admin/nflf-duplicate", method: "POST", body: {} },
  { path: "/api/microsoft/file", method: "POST", body: {} },
  { path: "/api/microsoft/file", method: "PUT", body: {} },
  { path: "/api/microsoft/logout", method: "POST", body: {} },
];
for (const item of protectedWrites) {
  const { response, body } = await request(item.path, item);
  assert.ok(response.status === 401 || response.status === 403, `${mode} anonymous mutation ${item.method} ${item.path} unexpectedly returned ${response.status}: ${JSON.stringify(body)}`);
}
const microsoftLogin = await request("/api/microsoft/login");
assert.equal(microsoftLogin.response.status, 403, "OAuth initiation remains administrator-only");
const anonymousCallback = await request("/api/microsoft/callback?code=must-not-be-used&state=must-not-be-used");
assert.equal(anonymousCallback.response.status, 302, "OAuth callback requires an administrator session");
const anonymousCallbackUrl = new URL(anonymousCallback.response.headers.get("location"), base);
assert.equal(anonymousCallbackUrl.searchParams.get("message"), "管理者のみMicrosoft連携を利用できます。");

const cookie = await adminCookie();
const invalidCallback = await request("/api/microsoft/callback?code=must-not-be-used&state=must-not-be-used", { cookie });
assert.equal(invalidCallback.response.status, 302, "OAuth callback must validate state before exchanging a code");
const invalidCallbackUrl = new URL(invalidCallback.response.headers.get("location"), base);
assert.equal(invalidCallbackUrl.searchParams.get("message"), "Microsoft認証の確認に失敗しました。もう一度接続してください。");
for (const item of reads) {
  const { response, body } = await request(item.path, { cookie });
  assert.equal(response.status, item.publicStatus, `authenticated GET ${item.path}: ${JSON.stringify(body)}`);
}
const collect = await request("/api/collect", { method: "POST", cookie, body: { handles: [] } });
assert.equal(collect.response.status, 400, "an authenticated request should pass the admin gate before input validation");
console.log(`${mode} read/API access checks passed`);
