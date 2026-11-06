import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const origin = process.env.APP_URL ?? "http://127.0.0.1:4173";
const outputDirectory = process.env.SCREENSHOT_DIR ?? "/tmp/xstats-read-access";
await mkdir(outputDirectory, { recursive: true });
const history = {
  runs: [{ id: "access-test-run", fetched_at: "2026-11-06T03:00:00.000Z", success_count: 1, error_count: 0 }],
  rows: [{
    run_id: "access-test-run",
    fetched_at: "2026-11-06T03:00:00.000Z",
    account_id: "private-browser-fixture",
    handle: "private_fixture",
    display_name: "保護されたアカウント",
    followers: 123,
    following: 45,
    posts: 67,
    avatar_url: null,
    account_status: "active",
    joined: null,
  }],
  latestCollection: { fetched_at: "2026-11-06T03:00:00.000Z", success_count: 1, error_count: 0 },
};

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const privatePage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let authenticated = false;
  let statusRelease;
  let statusSeen;
  const statusHeld = new Promise((resolve) => { statusRelease = resolve; });
  const statusRequested = new Promise((resolve) => { statusSeen = resolve; });

  await privatePage.addInitScript(() => {
    localStorage.setItem("x-account-stats-dashboard-v2", JSON.stringify({
      accountInput: "secret-handle-that-must-not-flash",
      rows: [{ id: "secret-row", handle: "secret_handle", displayName: "保存済みの秘密アカウント", followers: 999 }],
      selectedHandles: ["secret_handle"],
      displayNameOverrides: { secret_handle: "秘密の表示名" },
      theme: "dark",
    }));
  });
  await privatePage.route("**/api/admin/status", async (route) => {
    statusSeen();
    await statusHeld;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ configured: true, isAdmin: authenticated, readMode: "private" }) });
  });
  await privatePage.route("**/api/admin/login", async (route) => {
    authenticated = true;
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "set-cookie": "xstats_admin=preview; Path=/; HttpOnly; SameSite=Lax" }, body: JSON.stringify({ isAdmin: true }) });
  });
  await privatePage.route("**/api/admin/logout", async (route) => {
    authenticated = false;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ isAdmin: false }) });
  });
  await privatePage.route("**/api/history", async (route) => {
    if (!authenticated) return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "閲覧には管理者ログインが必要です。" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(history) });
  });
  await privatePage.route("**/api/site-version", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: 105, label: "Ver.1.05" }) }));
  await privatePage.goto(origin, { waitUntil: "domcontentloaded" });
  await statusRequested;
  await privatePage.waitForTimeout(100);
  const cachedPrivateValuesVisible = await privatePage.locator("input, textarea").evaluateAll((elements) => elements.some((element) => {
    const value = element.value ?? "";
    return value.includes("保存済みの秘密アカウント") || value.includes("secret-handle-that-must-not-flash") || value.includes("秘密の表示名");
  }));
  assert.equal(cachedPrivateValuesVisible, false, "cached account values must not render before auth status returns");
  await privatePage.screenshot({ path: join(outputDirectory, "private-auth-pending.png"), fullPage: true });

  statusRelease();
  await privatePage.getByRole("heading", { name: "閲覧には管理者ログインが必要です" }).waitFor();
  const privateRowsBeforeLogin = await privatePage.locator(".results-table input[aria-label=\"private_fixtureの表示名\"]").count();
  assert.equal(privateRowsBeforeLogin, 0, "private unauthenticated view must stay empty");
  const clearedStorage = await privatePage.evaluate(() => JSON.parse(localStorage.getItem("x-account-stats-dashboard-v2") ?? "{}"));
  assert.equal("rows" in clearedStorage, false, "cached rows should be removed after private mode is confirmed");
  assert.equal("accountInput" in clearedStorage, false, "cached account input should be removed after private mode is confirmed");
  await privatePage.screenshot({ path: join(outputDirectory, "private-locked.png"), fullPage: true });

  await privatePage.getByRole("button", { name: "管理者ログイン" }).click();
  await privatePage.getByLabel("管理者キー").fill("preview-only-key");
  await privatePage.getByRole("button", { name: "認証" }).click();
  const protectedName = privatePage.locator(".results-table input[aria-label=\"private_fixtureの表示名\"]");
  await protectedName.waitFor({ state: "visible" });
  assert.equal(await protectedName.inputValue(), "保護されたアカウント", "authenticated private view should show server history");
  const stalePrivateValuesVisible = await privatePage.locator("input, textarea").evaluateAll((elements) => elements.some((element) => (element.value ?? "").includes("秘密の表示名")));
  assert.equal(stalePrivateValuesVisible, false, "server history must replace stale local rows");
  await privatePage.getByRole("button", { name: "管理者ログアウト" }).click();
  await privatePage.getByText("閲覧には管理者ログインが必要です").waitFor();
  assert.equal(await privatePage.locator(".results-table input[aria-label=\"private_fixtureの表示名\"]").count(), 0, "logout must clear protected history from the screen");
  await privatePage.close();

  const publicPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await publicPage.route("**/api/admin/status", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ configured: true, isAdmin: false, readMode: "public" }) }));
  await publicPage.route("**/api/history", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(history) }));
  await publicPage.route("**/api/site-version", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: 105, label: "Ver.1.05" }) }));
  await publicPage.goto(origin, { waitUntil: "networkidle" });
  await publicPage.getByRole("heading", { name: "共有データを閲覧中" }).waitFor();
  const publicName = publicPage.locator(".results-table input[aria-label=\"private_fixtureの表示名\"]");
  await publicName.waitFor({ state: "visible" });
  assert.equal(await publicName.inputValue(), "保護されたアカウント", "public mode should render history without login");
  await publicPage.screenshot({ path: join(outputDirectory, "public-dashboard.png"), fullPage: true });
  assert.equal(await publicPage.getByRole("heading", { name: "調べたいアカウントを追加" }).count(), 0, "public visitors must not see administrator write controls");
  await publicPage.close();
  console.log("private/public browser access checks passed");
} finally {
  await browser.close();
}
