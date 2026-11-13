import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.APP_URL ?? "http://127.0.0.1:4174";
const dashboardKey = "x-account-stats-dashboard-v2";
const targetKey = "x-account-stats-account-targets-v1";

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

const anonymousGet = await request("/api/admin/account-targets");
assert.equal(anonymousGet.response.status, 403, "shared target list must require admin login");
const anonymousPut = await request("/api/admin/account-targets", {
  method: "PUT",
  body: { action: "initialize", expectedRevision: 0, handles: ["unauthorized"] },
});
assert.equal(anonymousPut.response.status, 403, "shared target writes must require admin login");

const login = await request("/api/admin/login", { method: "POST", body: { key: "preview-only-key" } });
assert.equal(login.response.status, 200, "preview admin login must succeed");
const cookie = login.response.headers.get("set-cookie")?.split(";", 1)[0];
assert.ok(cookie?.startsWith("xstats_admin="), "login must issue admin cookie");
const cookieValue = cookie.slice(cookie.indexOf("=") + 1);

async function getTargets() {
  const result = await request("/api/admin/account-targets", { cookie });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  return result.body;
}

async function waitForRegisteredCount(page, expected) {
  const selector = ".account-editor-dialog[open] .input-count";
  await page.waitForFunction(({ selector, expected }) => {
    const count = document.querySelector(selector)?.textContent ?? "";
    return new RegExp("^" + expected + "\\s*/\\s*500").test(count);
  }, { selector, expected }, { timeout: 30000 });
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const contexts = [];
async function makeBrowserPage(handles) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  contexts.push(context);
  await context.addCookies([{ name: "xstats_admin", value: cookieValue, url: origin, httpOnly: true, sameSite: "Lax" }]);
  await context.addInitScript(({ dashboardKey, targetKey, handles }) => {
    localStorage.setItem(dashboardKey, JSON.stringify({}));
    localStorage.setItem(targetKey, JSON.stringify(handles));
  }, { dashboardKey, targetKey, handles });
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByRole("button", { name: "登録アカウントを編集" }).click();
  await page.locator(".account-editor-dialog[open] .input-count").waitFor({ state: "visible", timeout: 30000 });
  return page;
}

try {
  const first = await makeBrowserPage(["alpha", "beta"]);
  await waitForRegisteredCount(first, 2);
  await assert.doesNotReject(() => first.getByRole("list", { name: "取得対象アカウント" }).getByText("@alpha", { exact: true }).waitFor());
  let shared = await getTargets();
  assert.deepEqual(shared.handles, ["alpha", "beta"]);
  assert.equal(shared.initialized, true, "first login should initialize shared storage");

  const second = await makeBrowserPage(["alpha", "legacy"]);
  await waitForRegisteredCount(second, 2);
  await second.getByRole("status").filter({ hasText: "この端末だけに保存" }).waitFor({ timeout: 30000 });
  assert.deepEqual((await getTargets()).handles, ["alpha", "beta"], "legacy local-only target must not merge automatically");
  await second.getByRole("button", { name: "この端末の未共有アカウントを共有一覧に追加" }).click();
  await second.getByText("@legacy", { exact: true }).waitFor({ timeout: 30000 });
  shared = await getTargets();
  assert.deepEqual(shared.handles, ["alpha", "beta", "legacy"]);

  await second.getByLabel("追加するハンドル名").fill("@newuser");
  await second.getByRole("button", { name: "追加", exact: true }).click();
  await second.getByText("@newuser", { exact: true }).waitFor({ timeout: 30000 });
  shared = await getTargets();
  assert.ok(shared.handles.includes("newuser"), "new target should persist in D1");

  await first.reload({ waitUntil: "domcontentloaded" });
  await first.getByRole("button", { name: "登録アカウントを編集" }).click();
  await first.locator(".account-editor-dialog[open] .input-count").waitFor({ state: "visible", timeout: 30000 });
  await waitForRegisteredCount(first, 4);
  await first.getByRole("button", { name: "@newuserを取得対象から外す" }).click();
  await first.getByText("過去データは保持されています。").waitFor({ timeout: 30000 });
  shared = await getTargets();
  assert.equal(shared.handles.includes("newuser"), false, "remove should sync across browsers");
  assert.equal(shared.handles.length, 3);

  await second.reload({ waitUntil: "domcontentloaded" });
  await second.getByRole("button", { name: "登録アカウントを編集" }).click();
  await second.locator(".account-editor-dialog[open] .input-count").waitFor({ state: "visible", timeout: 30000 });
  await waitForRegisteredCount(second, 3);

  const raceBase = await getTargets();
  const raceResults = await Promise.all([
    request("/api/admin/account-targets", { cookie, method: "PUT", body: { action: "add", expectedRevision: raceBase.revision, handles: ["race_a"] } }),
    request("/api/admin/account-targets", { cookie, method: "PUT", body: { action: "add", expectedRevision: raceBase.revision, handles: ["race_b"] } }),
  ]);
  assert.deepEqual(raceResults.map((item) => item.response.status).sort(), [200, 409], "stale concurrent writes should conflict instead of overwriting");
  const afterRace = await getTargets();
  assert.equal(afterRace.handles.filter((handle) => handle === "race_a" || handle === "race_b").length, 1);

  const fillers = Array.from({ length: 500 - afterRace.handles.length }, (_, index) => "fill_" + index);
  const filled = await request("/api/admin/account-targets", { cookie, method: "PUT", body: { action: "merge", expectedRevision: afterRace.revision, handles: fillers } });
  assert.equal(filled.response.status, 200, JSON.stringify(filled.body));
  assert.equal(filled.body.handles.length, 500);
  const overflow = await request("/api/admin/account-targets", { cookie, method: "PUT", body: { action: "add", expectedRevision: filled.body.revision, handles: ["one_too_many"] } });
  assert.equal(overflow.response.status, 413, "the 501st account must be rejected before storage");
  assert.equal((await getTargets()).handles.length, 500, "overflow must leave the shared list unchanged");

  console.log("account-target sync passed: anonymous access denied; first browser initialized the list; second browser explicitly merged a device-only target; add/remove synchronized across two browser contexts; stale writes conflicted; 500-item cap preserved.");
} finally {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
}