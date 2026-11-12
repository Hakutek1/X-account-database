import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const origin = process.env.PREVIEW_URL ?? "http://127.0.0.1:4173";
const outputDirectory = process.env.SCREENSHOT_DIR ?? "/tmp/xstats-preview";
await mkdir(outputDirectory, { recursive: true });

const latestRunId = "fixture-run-2026-10-28";
const historyRows = [
  { id: "a-2026-10-27", run_id: "fixture-run-2026-10-27", fetched_at: "2026-10-27T03:00:00.000Z", account_id: "account-a", handle: "account_a", display_name: "アカウント A", followers: 1200, following: 210, posts: 320, avatar_url: null, account_status: "active", joined: "2020-01-01" },
  { id: "b-2026-10-27", run_id: "fixture-run-2026-10-27", fetched_at: "2026-10-27T03:00:00.000Z", account_id: "account-b", handle: "account_b", display_name: "アカウント B", followers: 840, following: 150, posts: 280, avatar_url: null, account_status: "suspended", joined: "2021-04-12" },
  { id: "a-2026-10-28", run_id: latestRunId, fetched_at: "2026-10-28T03:00:00.000Z", account_id: "account-a", handle: "account_a", display_name: "アカウント A", followers: 1250, following: 215, posts: 328, avatar_url: null, account_status: "active", joined: "2020-01-01" },
  { id: "b-2026-10-28", run_id: latestRunId, fetched_at: "2026-10-28T03:00:00.000Z", account_id: "account-b", handle: "account_b", display_name: "アカウント B", followers: 825, following: 151, posts: 284, avatar_url: null, account_status: "suspended", joined: "2021-04-12" },
];

const historyResponse = {
  runs: [
    { id: latestRunId, fetched_at: "2026-10-28T03:00:00.000Z", success_count: 2, error_count: 1 },
  ],
  rows: historyRows,
  latestCollection: { fetched_at: "2026-10-28T03:00:00.000Z", success_count: 2, error_count: 1 },
  deletedAccountIds: [],
};

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });

async function assertTabRelations(page) {
  for (const tab of await page.locator('[role="tab"]').all()) {
    const controls = await tab.getAttribute("aria-controls");
    assert.ok(controls, "each tab should declare its controlled panel");
    assert.equal(await page.locator("#" + controls).count(), 1, "each tab should reference one existing panel");
  }
  for (const tablist of await page.locator('[role="tablist"]').all()) {
    const selected = tablist.locator('[role="tab"][aria-selected="true"]');
    assert.equal(await selected.count(), 1, "each visible tablist should have one selected tab");
    assert.equal(await selected.getAttribute("tabindex"), "0", "the selected tab should be the tab stop");
    assert.equal(await tablist.locator('[role="tab"][aria-selected="false"][tabindex="0"]').count(), 0, "unselected tabs should leave the tab order");
  }
}

try {
  let desktopBrandFontSize = 0;
  let desktopHistoricalInputFontSize = 0;
  for (const viewport of [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
    await page.addInitScript(() => {
      const rows = [
        { id: "account-a", handle: "account_a", displayName: "アカウント A", avatarUrl: null, followers: 1250, following: 215, posts: 328, joined: "2020-01-01", fetchedAt: "2026-10-28T03:00:00.000Z", status: "ok", accountStatus: "active" },
        { id: "account-b", handle: "account_b", displayName: "アカウント B", avatarUrl: null, followers: 825, following: 151, posts: 284, joined: "2021-04-12", fetchedAt: "2026-10-28T03:00:00.000Z", status: "ok", accountStatus: "suspended" },
      ];
      localStorage.setItem("x-account-stats-dashboard-v2", JSON.stringify({ rows, selectedHandles: ["account_a", "account_b"] }));
    });
    await page.route("**/api/history", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(historyResponse) }));
    await page.route("**/api/admin/status", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ configured: true, isAdmin: true, readMode: "public" }) }));
    await page.route("**/api/admin/account-targets", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ handles: [], revision: 0, initialized: true }) }));
    await page.route("**/api/admin/historical-data**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      metric: "followers",
      revision: 1,
      accounts: [
        { accountId: "account-a", handle: "account_a", displayName: "アカウント A", status: "active", avatarUrl: null },
        { accountId: "account-b", handle: "account_b", displayName: "アカウント B", status: "suspended", avatarUrl: null },
      ],
      dates: ["2026-10-27", "2026-10-28"],
      values: { "account-a": { "2026-10-27": 1200, "2026-10-28": 1250 }, "account-b": { "2026-10-27": 840, "2026-10-28": 825 } },
    }) }));
    await page.goto(origin, { waitUntil: "networkidle", timeout: 30000 });
    await assertTabRelations(page);
    const brandFontSize = Number.parseFloat(await page.locator(".editorial-brand .brand-name").evaluate((element) => getComputedStyle(element).fontSize));
    const themeButton = page.locator(".editorial-theme-toggle");
    assert.ok(await themeButton.getAttribute("aria-label"), "theme icon-only control must remain accessible");
    assert.ok(await themeButton.locator(".theme-toggle-icon").isVisible(), "theme icon should always be visible");
    if (viewport.name === "desktop") {
      desktopBrandFontSize = brandFontSize;
      assert.ok(await themeButton.locator(".theme-toggle-label").isVisible(), "desktop theme control should keep its text label");
    } else {
      assert.ok(brandFontSize >= 17, "mobile brand title should remain comfortably readable after enlargement");
      assert.equal(await themeButton.locator(".theme-toggle-label").evaluate((element) => getComputedStyle(element).display), "none", "mobile theme control should display only its icon");
    }
    const resultStatus = page.locator(".results-date-status");
    await resultStatus.waitFor();
    const resultStatusText = await resultStatus.innerText();
    assert.match(resultStatusText, /表示日: 2026-10-28/, "the displayed data date should be labeled near the collection status");
    assert.match(resultStatusText, /取得元: fxTwitter/);
    assert.match(resultStatusText, /最終取得: 2026\/10\/28 12:00 · 成功 2件 \/ 失敗 1件/);
    assert.doesNotMatch(resultStatusText, /JST/);
    assert.equal(await page.locator(".topbar .collection-status-meta").count(), 0, "collection status should no longer be in the global header");
    assert.equal(await page.getByText("調べたいアカウントを追加", { exact: true }).count(), 0);
    assert.equal(await page.locator(".hero-section .input-card .section-heading").count(), 0, "top account prompt and limit badge should be removed");
    assert.equal(await page.locator(".hero-section .input-count").innerText(), "2件登録");
    const editButton = page.getByRole("button", { name: "登録アカウントを編集", exact: true });
    const collectButton = page.getByRole("button", { name: /データを取得する/ });
    const editBox = await editButton.boundingBox();
    const collectBox = await collectButton.boundingBox();
    assert.ok(editBox && collectBox);
    assert.ok(Math.abs(editBox.width - collectBox.width) < 1 && Math.abs(editBox.height - collectBox.height) < 1, "account edit and collection buttons should have equal dimensions");
    await editButton.click();
    await page.getByRole("heading", { name: "登録アカウントを編集" }).waitFor();
    assert.match(await page.locator(".account-editor-content").innerText(), /500 件登録済み/);
    await page.keyboard.press("Escape");
    await page.locator(".account-editor-dialog[open]").waitFor({ state: "hidden" });
    assert.equal(await page.locator(".chart-data-table").count(), 0, "the chart data table should be removed from the rendered page");
    if (viewport.name === "desktop") {
      await page.screenshot({ path: join(outputDirectory, "results-desktop.png"), fullPage: true });
    }
    if (viewport.name === "mobile") {
      assert.equal(await page.locator(".table-scroll-hint").isVisible(), false, "mobile cards should not show a table scroll hint");
      await page.getByRole("button", { name: "活動終了", exact: true }).click();
      await page.locator(".results-mobile-cards").waitFor({ state: "visible" });
      assert.equal(await page.locator(".results-mobile-cards [role='listitem']").count(), 2, "mobile results should render one card per account");
      assert.equal(await page.locator(".results-display > .table-shell").isVisible(), false, "the wide results table should be hidden on mobile");
      await page.screenshot({ path: join(outputDirectory, "results-mobile.png"), fullPage: true });
      await page.locator(".results-mobile-sort select").selectOption("handle");
      assert.match(await page.locator(".results-mobile-card").first().innerText(), /@account_b/, "mobile cards should follow the selected sort");
      await page.getByRole("button", { name: "昇順で並べ替え" }).click();
      assert.match(await page.locator(".results-mobile-card").first().innerText(), /@account_a/, "mobile direction control should reverse the order");
      const mobileName = page.locator(".results-mobile-card").filter({ hasText: "@account_a" }).getByLabel("account_aの表示名");
      await mobileName.fill("編集テスト");
      assert.equal(await mobileName.inputValue(), "編集テスト", "display-name editing should remain available in cards");
      await mobileName.fill("アカウント A");
      await page.getByRole("tab", { name: "過去データ追加" }).click();
      await page.locator(".historical-grid-wrap").waitFor({ state: "visible" });
      assert.ok(await page.locator(".historical-scroll-hint").isVisible(), "mobile historical grid should explain horizontal scrolling");
      assert.equal(await page.locator(".historical-grid th:nth-child(2)").evaluate((element) => getComputedStyle(element).left), "auto", "the handle column should not be horizontally pinned");
      assert.equal(await page.locator(".historical-grid th:nth-child(3)").evaluate((element) => getComputedStyle(element).left), "0px", "the display-name column should remain horizontally pinned");
      const mobileHistoricalInputFontSize = Number.parseFloat(await page.locator(".historical-number-input").first().evaluate((element) => getComputedStyle(element).fontSize));
      assert.ok(mobileHistoricalInputFontSize < desktopHistoricalInputFontSize, "mobile historical cells should use smaller text than desktop");
      assert.ok(brandFontSize < desktopBrandFontSize, "responsive title should fit the mobile header while remaining enlarged");
      await assertTabRelations(page);
      await page.screenshot({ path: join(outputDirectory, "historical-mobile.png"), fullPage: true });
    } else {
      const resultsTab = page.getByRole("tab", { name: "取得データ" });
      await resultsTab.focus();
      await page.keyboard.press("ArrowRight");
      assert.equal(await page.getByRole("tab", { name: "グラフ表示" }).getAttribute("aria-selected"), "true", "workspace tab arrows should select the next tab");
      await page.keyboard.press("ArrowLeft");
      assert.equal(await page.getByRole("tab", { name: "取得データ" }).getAttribute("aria-selected"), "true", "workspace tab arrows should wrap to the previous tab");
      const normalTab = page.getByRole("tab", { name: "通常" });
      await normalTab.focus();
      await page.keyboard.press("ArrowRight");
      assert.equal(await page.getByRole("tab", { name: "コンパクト" }).getAttribute("aria-selected"), "true", "result tabs should support arrow navigation");
      await page.keyboard.press("ArrowLeft");
      assert.equal(await page.getByRole("tab", { name: "通常" }).getAttribute("aria-selected"), "true");
      const adminTab = page.getByRole("tab", { name: "過去データ追加" });
      await resultsTab.focus();
      await page.keyboard.press("End");
      assert.equal(await adminTab.getAttribute("aria-selected"), "true", "End should select the last workspace tab");
      await adminTab.focus();
      await page.keyboard.press("Home");
      assert.equal(await resultsTab.getAttribute("aria-selected"), "true", "Home should select the first workspace tab");
      await page.keyboard.press("End");
      assert.equal(await adminTab.getAttribute("aria-selected"), "true");
      await adminTab.click();
      await page.getByRole("heading", { name: "過去データ追加" }).waitFor();
      await page.locator(".historical-grid-wrap").waitFor({ state: "visible" });
      assert.equal(await page.locator(".historical-grid th:nth-child(2)").evaluate((element) => getComputedStyle(element).left), "auto", "the handle column should not be horizontally pinned");
      assert.equal(await page.locator(".historical-grid th:nth-child(3)").evaluate((element) => getComputedStyle(element).left), "0px", "the display-name column should remain horizontally pinned");
      desktopHistoricalInputFontSize = Number.parseFloat(await page.locator(".historical-number-input").first().evaluate((element) => getComputedStyle(element).fontSize));
      assert.ok(desktopHistoricalInputFontSize > 0, "desktop historical input should have a measurable font size");
      await page.screenshot({ path: join(outputDirectory, "historical-desktop.png"), fullPage: true });
      await assertTabRelations(page);
      const followersTab = page.getByRole("tab", { name: "フォロワー数" });
      await followersTab.focus();
      await page.keyboard.press("ArrowRight");
      assert.equal(await page.getByRole("tab", { name: "フォロー数" }).getAttribute("aria-selected"), "true", "historical metric tabs should support arrows");
      await page.getByRole("tab", { name: "取得データ" }).click();
      const rankingTab = page.getByRole("tab", { name: "ランキング" });
      await rankingTab.click();
      await assertTabRelations(page);
      const rankingMetricTab = page.getByRole("tab", { name: "フォロワー数" });
      await rankingMetricTab.focus();
      await page.keyboard.press("ArrowRight");
      assert.equal(await page.getByRole("tab", { name: "フォロワー増減数" }).getAttribute("aria-selected"), "true", "ranking metric tabs should support arrows");
      await page.getByRole("tab", { name: "取得データ" }).click();
    }
    await page.getByRole("tab", { name: "グラフ表示" }).click();
    await page.getByRole("heading", { name: "グラフ表示" }).waitFor();
    await page.locator("svg.data-chart").waitFor();
    assert.ok(await page.locator("svg.data-chart rect.chart-bar").count() > 0, "the fixture graph should render bars");
    await assertTabRelations(page);
    const accountDisclosure = page.getByRole("button", { name: "表示アカウントを開く" });
    if (await accountDisclosure.isVisible()) await accountDisclosure.click();
    assert.ok(await page.getByRole("heading", { name: /活動中/ }).count() > 0, "accounts should be grouped by activity status");
    assert.ok(await page.getByRole("heading", { name: /凍結/ }).count() > 0, "suspended accounts should remain visible in their status group");
    const search = page.getByLabel("グラフ表示アカウントを検索");
    const accountCheckbox = (handle) => page.locator(".account-check").filter({ has: page.locator('input[aria-label="' + handle + 'のグラフ色"]') }).locator('input[type="checkbox"]');
    await search.fill("アカウント A");
    assert.equal(await page.locator(".account-check").count(), 1, "search should match a display-name substring");
    await page.locator(".selection-actions").getByRole("button", { name: "絞り込み中のアカウントを全てOFF" }).click();
    assert.equal(await accountCheckbox("account_a").isChecked(), false, "bulk off should change the matching account");
    await search.fill("");
    assert.equal(await accountCheckbox("account_b").isChecked(), true, "bulk off should preserve an account outside the filter");
    await page.getByRole("button", { name: "選択済みのみ" }).click();
    assert.equal(await page.locator(".account-check").count(), 1, "selected-only should show only checked accounts");
    assert.equal(await accountCheckbox("account_b").count(), 1, "selected-only should retain the selected account");
    await page.getByRole("button", { name: "選択済みのみ" }).click();
    await search.fill("@account_a");
    assert.equal(await page.locator(".account-check").count(), 1, "search should accept an @-prefixed handle");
    await page.locator(".selection-actions").getByRole("button", { name: "絞り込み中のアカウントを全てON" }).click();
    await search.fill("account_b");
    const suspendedFilter = page.getByRole("button", { name: /凍結/ });
    await suspendedFilter.click();
    assert.equal(await page.locator(".account-check").count(), 0, "turning the frozen status off should hide matching accounts");
    await suspendedFilter.click();
    assert.equal(await page.locator(".account-check").count(), 1, "turning the frozen status on should restore matching accounts");
    await search.fill("");
    await page.locator(".selection-actions").getByRole("button", { name: "絞り込み中のアカウントを全てON" }).click();
    assert.equal(await page.locator("svg.data-chart rect.chart-bar").count(), 2, "filtered bulk selection should enable both accounts");
    assert.equal(await page.locator(".chart-data-table").count(), 0, "graph data-table markup should not be present");
    const firstBar = page.locator("svg.data-chart rect.chart-bar").first();
    await firstBar.focus();
    assert.equal(await firstBar.getAttribute("tabindex"), "0", "one graph mark should be a tab stop");
    assert.equal(await page.locator("svg.data-chart [data-chart-mark-index][tabindex=\"0\"]").count(), 1, "the graph should have exactly one mark in the tab order");
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-chart-mark-index")), "1", "arrow keys should move focus in draw order");
    assert.ok(await page.locator(".chart-tooltip").isVisible(), "keyboard focus should show the graph value tooltip");
    await page.getByRole("tab", { name: "推移" }).click();
    const firstPoint = page.locator("svg.data-chart circle.chart-point").first();
    assert.ok(await page.locator("svg.data-chart circle.chart-point").count() >= 2, "the trend fixture should contain multiple points");
    await firstPoint.focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-chart-mark-index")), "1", "trend points should follow the same arrow navigation");
    await page.getByRole("tab", { name: "比較" }).click();
    if (viewport.name === "mobile") assert.ok(await page.locator(".chart-scroll-hint").isVisible(), "mobile graph should explain horizontal scrolling");
    const chartSettings = page.locator(".chart-settings-grid");
    const settingColumns = await chartSettings.evaluate((element) => getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length);
    assert.equal(settingColumns, viewport.name === "desktop" ? 2 : 1, "graph customization sections should use two columns on desktop and one on mobile");
    const axisToggle = page.getByRole("button", { name: "数値軸の設定を開く" });
    assert.ok(await axisToggle.isVisible(), "graph settings should be collapsible on every screen size");
    assert.equal(await axisToggle.getAttribute("aria-expanded"), "false", "graph settings should start collapsed");
    await axisToggle.click();
    assert.equal(await axisToggle.getAttribute("aria-expanded"), "true", "graph settings should open on demand");
    const axisFields = page.locator(".chart-setting-disclosure .axis-settings").first();
    const fieldColumns = await axisFields.evaluate((element) => getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length);
    assert.equal(fieldColumns, viewport.name === "desktop" ? 2 : 1, "graph settings fields should adapt to screen width");
    await axisToggle.click();
    const accountDisclosureClose = page.getByRole("button", { name: "表示アカウントを閉じる" });
    if (await accountDisclosureClose.isVisible()) await accountDisclosureClose.click();

    const html = page.locator("html");
    if (await html.getAttribute("data-theme") !== "dark") await themeButton.click();
    await page.screenshot({ path: join(outputDirectory, "graph-" + viewport.name + "-dark.png"), fullPage: true });
    await themeButton.click();
    await page.screenshot({ path: join(outputDirectory, "graph-" + viewport.name + "-light.png"), fullPage: true });
    assert.equal(await page.getByText("fxTwitter接続", { exact: true }).count(), 0);
    await page.close();
  }
} finally {
  await browser.close();
}
