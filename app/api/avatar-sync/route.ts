import { ensureSchema, ensureSharedSession, getD1, getSharedSession, json, requireAdmin } from "../_shared";
import { accountAssetId } from "../../../lib/account-assets";

type AvatarInput = { accountId?: unknown; handle?: unknown; avatarUrl?: unknown };

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const body = await request.json() as { rows?: unknown };
    const input = Array.isArray(body.rows) ? body.rows as AvatarInput[] : [];
    if (input.length > 500) return json({ error: "アイコン情報の件数が上限を超えています。" }, { status: 413 });
    const rows = input.map((row) => ({
      accountId: String(row.accountId ?? "").trim(),
      handle: String(row.handle ?? "").trim().replace(/^@/, "").toLowerCase(),
      avatarUrl: typeof row.avatarUrl === "string" && row.avatarUrl.trim() ? row.avatarUrl.trim() : null,
    })).filter((row) => (row.accountId || row.handle) && row.avatarUrl);
    if (!rows.length) return json({ synced: 0 });
    await ensureSchema();
    const db = getD1();
    const session = getSharedSession();
    await ensureSharedSession(db);
    const resolved = [];
    for (const row of rows) {
      const accountId = row.accountId || (await db.prepare("SELECT account_id FROM xstats_daily_history WHERE session_id = ? AND lower(handle) = ? ORDER BY date DESC LIMIT 1").bind(session.id, row.handle).first<{ account_id: string }>())?.account_id;
      if (!accountId) continue;
      resolved.push({ ...row, accountId });
    }
    const now = new Date().toISOString();
    const statements = resolved.map((row) => db.prepare(`INSERT INTO xstats_account_assets
      (id, session_id, account_id, avatar_key, avatar_url, avatar_data, content_type, updated_at)
      VALUES (?, ?, ?, ?, ?, NULL, 'image/remote', ?)
      ON CONFLICT(session_id, account_id) DO UPDATE SET
        avatar_key = excluded.avatar_key,
        avatar_url = excluded.avatar_url,
        avatar_data = NULL,
        content_type = excluded.content_type,
        updated_at = excluded.updated_at
      WHERE xstats_account_assets.avatar_key LIKE 'remote:%'`)
      .bind(accountAssetId(session.id, row.accountId), session.id, row.accountId, `remote:${row.accountId}`, row.avatarUrl, now));
    if (statements.length) await db.batch(statements);
    return json({ synced: resolved.length });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "アイコン情報を共有データへ同期できませんでした。" }, { status: 500 });
  }
}
