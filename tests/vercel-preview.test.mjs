import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { handleVercelPreviewRequest } from "../lib/vercel-preview.ts";

async function request(path, method = "GET") {
  const response = handleVercelPreviewRequest(new Request(`https://preview.example${path}`, { method }));
  assert.ok(response, `expected preview handler to respond to ${method} ${path}`);
  return { response, body: await response.json() };
}

test("history and admin preview APIs return invented fixture data", async () => {
  const history = await request("/api/history");
  assert.equal(history.response.status, 200);
  assert.equal(history.body.registeredAccountCount, 8);
  assert.equal(history.body.rows.length, 112);
  assert.ok(history.body.rows.every((row) => row.account_id.startsWith("preview-account-")));
  assert.ok(history.body.rows.every((row) => row.avatar_url === null));

  const status = await request("/api/admin/status");
  assert.deepEqual(status.body, { configured: true, isAdmin: true, readMode: "public" });

  const accounts = await request("/api/admin/account-targets");
  assert.equal(accounts.body.handles.length, 8);
  assert.ok(accounts.body.handles.every((handle) => handle.endsWith("_note") || handle.includes("_")));

  for (const metric of ["followers", "following", "posts"]) {
    const data = await request(`/api/admin/historical-data?metric=${metric}`);
    assert.equal(data.response.status, 200);
    assert.equal(data.body.metric, metric);
    assert.equal(data.body.accounts.length, 8);
    assert.equal(data.body.dates.length, 14);
    assert.equal(Object.keys(data.body.values).length, 8);
  }
});

test("historical-data preparation is a no-op and all data writes are rejected", async () => {
  const prepared = await request("/api/admin/historical-data", "POST");
  assert.equal(prepared.response.status, 200);
  assert.equal(prepared.body.preview, true);

  for (const [path, method] of [
    ["/api/update-stats", "POST"],
    ["/api/admin/account-targets", "PUT"],
    ["/api/admin/historical-data", "PUT"],
    ["/api/admin/avatar", "POST"],
    ["/api/admin/avatar", "DELETE"],
    ["/api/import/history", "POST"],
    ["/api/excel/daily-sync", "POST"],
  ]) {
    const blocked = await request(path, method);
    assert.equal(blocked.response.status, 403, `${method} ${path} should be blocked`);
    assert.equal(blocked.body.preview, true);
  }
});

test("unimplemented API reads never fall through to production handlers", async () => {
  const unknown = await request("/api/microsoft/status");
  assert.equal(unknown.response.status, 404);
  assert.equal(unknown.body.preview, true);
});

test("production Vercel builds are rejected before bundling synthetic fixtures", () => {
  const result = spawnSync(process.execPath, ["scripts/build-vercel-preview.mjs"], {
    encoding: "utf8",
    env: { ...process.env, VERCEL_ENV: "production" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /preview-only/);
});
