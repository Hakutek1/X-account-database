const PREVIEW_ACCOUNTS = [
  { id: "preview-account-01", handle: "sora_note", displayName: "そらの記録", status: "active", followers: 1840, following: 522, posts: 3921, joined: "2021-04-12", freezeDate: null },
  { id: "preview-account-02", handle: "ao_data_lab", displayName: "青データ室", status: "active", followers: 1260, following: 880, posts: 2165, joined: "2020-11-03", freezeDate: null },
  { id: "preview-account-03", handle: "kometa_log", displayName: "こめたログ", status: "ended", followers: 940, following: 311, posts: 5730, joined: "2019-07-21", freezeDate: null },
  { id: "preview-account-04", handle: "midori_watch", displayName: "みどり観測", status: "suspended", followers: 710, following: 440, posts: 1644, joined: "2022-02-18", freezeDate: "2026-11-10" },
  { id: "preview-account-05", handle: "tsuki_stats", displayName: "月次統計", status: "active", followers: 530, following: 276, posts: 1072, joined: "2023-05-02", freezeDate: null },
  { id: "preview-account-06", handle: "nami_archive", displayName: "なみアーカイブ", status: "non_alt", followers: 408, following: 620, posts: 3054, joined: "2018-12-09", freezeDate: null },
  { id: "preview-account-07", handle: "hibiki_daily", displayName: "ひびき日誌", status: "active", followers: 302, following: 190, posts: 886, joined: "2024-01-14", freezeDate: null },
  { id: "preview-account-08", handle: "taka_sample", displayName: "たかサンプル", status: "ended", followers: 176, following: 95, posts: 412, joined: "2020-09-30", freezeDate: null },
] as const;

const PREVIEW_DATES = Array.from({ length: 14 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 10, index + 3));
  return date.toISOString().slice(0, 10);
});

type PreviewMetric = "followers" | "following" | "posts";

function metricValue(accountIndex: number, dateIndex: number, metric: PreviewMetric) {
  const account = PREVIEW_ACCOUNTS[accountIndex];
  const seed = account[metric];
  if (dateIndex === 5 && accountIndex === 4) return null;
  const dailyChange = metric === "followers" ? accountIndex + 2 : metric === "following" ? accountIndex % 3 : accountIndex + 3;
  return Math.max(0, seed + dailyChange * dateIndex);
}

const PREVIEW_HISTORY_ROWS = PREVIEW_DATES.flatMap((date, dateIndex) => PREVIEW_ACCOUNTS.map((account, accountIndex) => ({
  id: `${account.id}-${date}`,
  run_id: `preview-run-${date}`,
  fetched_at: `${date}T12:00:00.000Z`,
  account_id: account.id,
  handle: account.handle,
  display_name: account.displayName,
  followers: metricValue(accountIndex, dateIndex, "followers"),
  following: metricValue(accountIndex, dateIndex, "following"),
  posts: metricValue(accountIndex, dateIndex, "posts"),
  avatar_url: null,
  account_status: account.status,
  joined: account.joined,
  freeze_date: account.freezeDate,
})));

const PREVIEW_RUNS = PREVIEW_DATES.map((date) => ({ id: `preview-run-${date}`, fetched_at: `${date}T12:00:00.000Z` }));

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function forbidden() {
  return json({ error: "このプレビューでは取得・保存・削除はできません。", preview: true }, 403);
}

function historicalData(metric: PreviewMetric) {
  const values = Object.fromEntries(PREVIEW_ACCOUNTS.map((account, accountIndex) => [
    account.id,
    Object.fromEntries(PREVIEW_DATES.map((date, dateIndex) => [date, metricValue(accountIndex, dateIndex, metric)])),
  ]));

  return {
    metric,
    revision: 1,
    accounts: PREVIEW_ACCOUNTS.map((account) => ({
      accountId: account.id,
      handle: account.handle,
      displayName: account.displayName,
      status: account.status,
      freezeDate: account.freezeDate,
      avatarUrl: null,
    })),
    dates: PREVIEW_DATES,
    values,
  };
}

/** Return fixture responses for the Vercel preview without loading Cloudflare bindings. */
export function handleVercelPreviewRequest(request: Request): Response | null {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return null;

  const method = request.method.toUpperCase();
  const path = url.pathname;

  if (method === "GET" && path === "/api/history") {
    const latest = PREVIEW_RUNS.at(-1);
    return json({
      runs: PREVIEW_RUNS,
      rows: PREVIEW_HISTORY_ROWS,
      registeredAccountCount: PREVIEW_ACCOUNTS.length,
      latestCollection: latest ? { fetched_at: latest.fetched_at, success_count: PREVIEW_ACCOUNTS.length, error_count: 0 } : null,
    });
  }

  if (method === "GET" && path === "/api/admin/status") {
    return json({ configured: true, isAdmin: true, readMode: "public" });
  }

  if (method === "GET" && path === "/api/admin/account-targets") {
    return json({ handles: PREVIEW_ACCOUNTS.map((account) => account.handle), revision: 1, initialized: true });
  }

  if (path === "/api/admin/historical-data") {
    if (method === "POST") return json({ prepared: true, preview: true });
    if (method === "GET") {
      const metric = url.searchParams.get("metric");
      if (metric === "followers" || metric === "following" || metric === "posts") return json(historicalData(metric));
      return json({ error: "指標を指定してください。" }, 400);
    }
    return forbidden();
  }

  if (method === "GET" && path === "/api/site-version") {
    return json({ version: 129, label: "Vercel Preview (合成データ)" });
  }

  // These endpoints can be invoked automatically by the UI, but are no-ops in the preview.
  if (method === "POST" && path === "/api/avatar-sync") return json({ synced: false, preview: true });
  if (method === "POST" && path === "/api/admin/login") return json({ configured: true, isAdmin: true, readMode: "public" });
  if (method === "POST" && path === "/api/admin/logout") return json({ ok: true, preview: true });

  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") return forbidden();
  return json({ error: "このAPIはプレビューでは利用できません。", preview: true }, 404);
}
