import { ensureSchema, ensureSharedSession, getD1, getSharedSession, json, requireAdmin } from "../_shared";

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
    const statements = rows.map((row) => db.prepare("UPDATE xstats_snapshots SET avatar_url = ? WHERE session_id = ? AND (account_id = ? OR lower(handle) = ?)").bind(row.avatarUrl, session.id, row.accountId, row.handle));
    await db.batch(statements);
    return json({ synced: rows.length });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "アイコン情報を共有データへ同期できませんでした。" }, { status: 500 });
  }
}
