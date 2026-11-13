import assert from "node:assert/strict";
import { chromium } from "playwright";
import { performance } from "node:perf_hooks";

const origin = process.env.APP_URL ?? "http://127.0.0.1:4174";

async function request(path, { cookie, method = "GET", body } = {}) {
  const headers = new Headers();
  if (cookie) headers.set("Cookie", cookie);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(new URL(path, origin), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  return { response, body: await response.json().catch(() => ({})) };
}

const denied = await request("/api/admin/historical-data", { method: "PUT", body: {} });
assert.equal(denied.response.status, 403, "historical writes must require admin login");
const login = await request("/api/admin/login", { method: "POST", body: { key: "preview-only-key" } });
assert.equal(login.response.status, 200);
const cookie = login.response.headers.get("set-cookie")?.split(";", 1)[0];
assert.ok(cookie?.startsWith("xstats_admin="));

const prepared = await request("/api/admin/historical-data", { cookie, method: "POST" });
assert.equal(prepared.response.status, 200, JSON.stringify(prepared.body));
const loaded = await request("/api/admin/historical-data?metric=followers", { cookie });
assert.equal(loaded.response.status, 200, JSON.stringify(loaded.body));
assert.ok(loaded.body.accounts?.length, "the synthetic D1 must contain an editor account");
assert.ok(loaded.body.dates?.length >= 300, "the synthetic history must exercise a broad date range");
const account = loaded.body.accounts[0];
const accountPayload = loaded.body.accounts.map((item) => ({
  accountId: item.accountId,
  originalAccountId: item.accountId,
  handle: item.handle,
  displayName: item.displayName,
  status: item.status ?? "active",
}));
function makeValues(source) {
  return Object.fromEntries(loaded.body.accounts.map((item) => [item.accountId, { ...(source.values?.[item.accountId] ?? {}) }]));
}
function makeBody(revision, values) {
  return { metric: "followers", revision, accounts: accountPayload, dates: loaded.body.dates, values };
}
const baselineValues = makeValues(loaded.body);
const revisionBeforeNoop = loaded.body.revision;
const noopBody = makeBody(revisionBeforeNoop, baselineValues);
const noopStart = performance.now();
const noop = await request("/api/admin/historical-data", { cookie, method: "PUT", body: noopBody });
const noopMilliseconds = Math.round(performance.now() - noopStart);
assert.equal(noop.response.status, 200, JSON.stringify(noop.body));
assert.equal(noop.body.changedRows, 0, "identical save must not rewrite history rows");
assert.equal(noop.body.batchStatements, 0, "identical save must not open a write batch");
assert.equal(noop.body.revision, revisionBeforeNoop, "identical save must not advance the revision");

const dates = [...loaded.body.dates].sort();
const targetDate = dates.at(-1);
const oldValue = baselineValues[account.accountId][targetDate];
assert.equal(typeof oldValue, "number", "fixture date must contain a follower count");
const changedValues = makeValues(loaded.body);
changedValues[account.accountId][targetDate] = oldValue + 1;
const oneChangeStart = performance.now();
const oneChange = await request("/api/admin/historical-data", {
  cookie,
  method: "PUT",
  body: makeBody(revisionBeforeNoop, changedValues),
});
const oneChangeMilliseconds = Math.round(performance.now() - oneChangeStart);
assert.equal(oneChange.response.status, 200, JSON.stringify(oneChange.body));
assert.equal(oneChange.body.changedRows, 1, "one cell edit must write just its changed daily row");
assert.equal(oneChange.body.batchStatements, 2, "one-cell edit should use only revision CAS plus one row upsert");
assert.equal(oneChange.body.revision, revisionBeforeNoop + 1);

const stale = await request("/api/admin/historical-data", { cookie, method: "PUT", body: noopBody });
assert.equal(stale.response.status, 409, "old editor revisions must be rejected");

const beforeRace = await request("/api/admin/historical-data?metric=followers", { cookie });
const raceDate = [...beforeRace.body.dates].sort().at(-1);
const raceAccount = beforeRace.body.accounts[0];
const raceValuesA = makeValues(beforeRace.body);
const raceValuesB = makeValues(beforeRace.body);
const raceOldValue = raceValuesA[raceAccount.accountId][raceDate];
raceValuesA[raceAccount.accountId][raceDate] = raceOldValue + 11;
raceValuesB[raceAccount.accountId][raceDate] = raceOldValue + 22;
const raceResults = await Promise.all([
  request("/api/admin/historical-data", { cookie, method: "PUT", body: makeBody(beforeRace.body.revision, raceValuesA) }),
  request("/api/admin/historical-data", { cookie, method: "PUT", body: makeBody(beforeRace.body.revision, raceValuesB) }),
]);
assert.deepEqual(raceResults.map((item) => item.response.status).sort(), [200, 409], "concurrent writers must not overwrite the same revision");
const afterRace = await request("/api/admin/historical-data?metric=followers", { cookie });
assert.equal(afterRace.body.revision, beforeRace.body.revision + 1);
const acceptedValue = afterRace.body.values[raceAccount.accountId][raceDate];
assert.ok(acceptedValue === raceOldValue + 11 || acceptedValue === raceOldValue + 22, "exactly one concurrent value should be committed");

const failedValues = makeValues(afterRace.body);
const failedAccount = afterRace.body.accounts[0];
const failedDate = [...afterRace.body.dates].sort().at(-1);
const preservedValue = failedValues[failedAccount.accountId][failedDate];
failedValues[failedAccount.accountId][failedDate] = 777;
const failed = await request("/api/admin/historical-data", {
  cookie,
  method: "PUT",
  body: makeBody(afterRace.body.revision, failedValues),
});
assert.equal(failed.response.status, 500, "injected D1 failure must fail the whole save");
const afterFailure = await request("/api/admin/historical-data?metric=followers", { cookie });
assert.equal(afterFailure.body.revision, afterRace.body.revision, "D1 failure must roll back the revision increment");
assert.equal(afterFailure.body.values[failedAccount.accountId][failedDate], preservedValue, "D1 failure must roll back the row write");

const manyAccounts = Array.from({ length: 101 }, (_, index) => ({
  accountId: "limit_fixture_" + index,
  originalAccountId: "limit_fixture_" + index,
  handle: "limit_fixture_" + index,
  displayName: "Limit Fixture " + index,
  status: "active",
}));
const manyDates = Array.from({ length: 1000 }, (_, index) => {
  const date = new Date(Date.UTC(2000, 0, 1 + index));
  return date.toISOString().slice(0, 10);
});
const tooLargeValues = Object.fromEntries(manyAccounts.map((item) => [
  item.accountId,
  Object.fromEntries(manyDates.map((date) => [date, null])),
]));
const beforeLimit = await request("/api/admin/historical-data?metric=followers", { cookie });
const limitResult = await request("/api/admin/historical-data", {
  cookie,
  method: "PUT",
  body: { metric: "followers", revision: beforeLimit.body.revision, accounts: manyAccounts, dates: manyDates, values: tooLargeValues },
});
assert.equal(limitResult.response.status, 413, "an over-limit save must be rejected before D1 writes");
const afterLimit = await request("/api/admin/historical-data?metric=followers", { cookie });
assert.equal(afterLimit.body.revision, beforeLimit.body.revision, "limit rejection must not change the revision");

const payloadCapAccounts = Array.from({ length: 500 }, (_, index) => ({
  accountId: "payload_fixture_" + index,
  originalAccountId: "payload_fixture_" + index,
  handle: "payload_fixture_" + index,
  displayName: "Payload Fixture " + index,
  status: "active",
}));
const payloadCapDates = Array.from({ length: 200 }, (_, index) => new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10));
const payloadCapValues = Object.fromEntries(payloadCapAccounts.map((item) => [
  item.accountId,
  Object.fromEntries(payloadCapDates.map((date) => [date, 1000 + Number(item.accountId.split("_").at(-1))])),
]));
const beforePayloadCap = await request("/api/admin/historical-data?metric=followers", { cookie });
const payloadCapResult = await request("/api/admin/historical-data", {
  cookie,
  method: "PUT",
  body: { metric: "followers", revision: beforePayloadCap.body.revision, accounts: payloadCapAccounts, dates: payloadCapDates, values: payloadCapValues },
});
assert.equal(payloadCapResult.response.status, 413, "a batch exceeding the safe total D1 payload must be rejected before writing");
const afterPayloadCap = await request("/api/admin/historical-data?metric=followers", { cookie });
assert.equal(afterPayloadCap.body.revision, beforePayloadCap.body.revision, "payload-size rejection must preserve the revision");
assert.deepEqual(afterPayloadCap.body.values, beforePayloadCap.body.values, "payload-size rejection must preserve all saved history");


const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: "xstats_admin", value: cookie.slice(cookie.indexOf("=") + 1), url: origin, httpOnly: true, sameSite: "Lax" }]);
  await context.addInitScript(() => { window.confirm = () => true; });
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "全履歴編集" }).waitFor({ state: "visible", timeout: 30000 });
  await page.getByRole("tab", { name: "全履歴編集" }).click();
  await page.locator(".historical-grid-wrap").waitFor({ state: "visible", timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector(".historical-editor")?.getAttribute("aria-busy") || document.querySelector(".historical-editor")?.getAttribute("aria-busy") === "false", null, { timeout: 60000 });
  const editorRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/admin/historical-data")) editorRequests.push(request.method());
  });
  await page.getByRole("button", { name: "変更を保存" }).click();
  await page.getByText("最新の内容を維持しています。").waitFor({ timeout: 30000 });
  assert.deepEqual(editorRequests, ["PUT"], "a successful editor save must not repeat the expensive preparation POST and GET");
  await page.screenshot({ path: process.env.SCREENSHOT_DIR ? process.env.SCREENSHOT_DIR + "/historical-save-desktop.png" : "/tmp/historical-save-desktop.png", fullPage: true });
  await context.close();
} finally {
  await browser.close();
}

console.log("historical save passed: no-op writes 0 rows/statements without revision advance; one cell writes 1 row in a 2-statement atomic batch; stale and concurrent saves conflict; injected D1 failure and cell limit preserve data and revision.");
console.log("Synthetic response timings (same disposable dataset): no-op " + noopMilliseconds + " ms; one-cell save " + oneChangeMilliseconds + " ms. Original algorithm would submit all " + loaded.body.accounts.length * loaded.body.dates.length + " visible cells rather than the measured changed-row count of 1.");
