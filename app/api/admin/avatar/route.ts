import { accountAssetId, accountAssetKey, accountAssetUrl, AVATAR_CONTENT_TYPES, bytesToBase64, getAssetBucket, loadAccountAsset, MAX_AVATAR_BYTES } from "../../../../lib/account-assets";
import { ensureSchema, ensureSharedSession, getD1, getSharedSession, json, requireAdmin } from "../../_shared";

function cleanAccountId(value: FormDataEntryValue | null) {
  const accountId = typeof value === "string" ? value.trim() : "";
  return accountId && accountId.length <= 200 ? accountId : null;
}

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const form = await request.formData();
    const accountId = cleanAccountId(form.get("accountId"));
    const file = form.get("file");
    if (!accountId || !(file instanceof File)) return json({ error: "アカウントと画像ファイルを指定してください。" }, { status: 400 });
    if (!AVATAR_CONTENT_TYPES.has(file.type)) return json({ error: "JPEG・PNG・WebP・GIF画像のみアップロードできます。" }, { status: 400 });
    if (file.size <= 0 || file.size > MAX_AVATAR_BYTES) return json({ error: "画像は512KB以下にしてください。" }, { status: 413 });

    await ensureSchema();
    const db = getD1();
    const session = getSharedSession();
    await ensureSharedSession(db);
    const now = new Date().toISOString();
    const key = accountAssetKey(session.id, accountId);
    const previous = await loadAccountAsset(db, session.id, accountId);
    const fileBytes = await file.arrayBuffer();
    let avatarData: string | null = null;
    let storedKey = key;
    let bucket: ReturnType<typeof getAssetBucket> | null = null;
    try {
      bucket = getAssetBucket();
      await bucket.put(key, fileBytes, {
        httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000, immutable" },
      });
    } catch {
      // Some Sites deployments expose the logical R2 object as an RPC proxy
      // without put(). Small avatars are kept in D1 as a durable fallback.
      avatarData = bytesToBase64(fileBytes);
      storedKey = `d1:${crypto.randomUUID()}`;
    }
    const avatarUrl = accountAssetUrl(accountId, now);
    await db.prepare(`INSERT INTO xstats_account_assets
      (id, session_id, account_id, avatar_key, avatar_url, avatar_data, content_type, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, account_id) DO UPDATE SET
        id = excluded.id,
        avatar_key = excluded.avatar_key,
        avatar_url = excluded.avatar_url,
        avatar_data = excluded.avatar_data,
        content_type = excluded.content_type,
        updated_at = excluded.updated_at`).bind(accountAssetId(session.id, accountId), session.id, accountId, storedKey, avatarUrl, avatarData, file.type, now).run();
    if (previous?.avatar_key && previous.avatar_key !== storedKey && !previous.avatar_key.startsWith("d1:") && bucket) await bucket.delete(previous.avatar_key);
    return json({ saved: true, accountId, avatarUrl, updatedAt: now, storage: avatarData ? "d1" : "r2" });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "アイコンを保存できませんでした。" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const body = await request.json() as { accountId?: unknown };
    const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
    if (!accountId || accountId.length > 200) return json({ error: "アカウントIDを指定してください。" }, { status: 400 });
    await ensureSchema();
    const db = getD1();
    const session = getSharedSession();
    await ensureSharedSession(db);
    const previous = await loadAccountAsset(db, session.id, accountId);
    if (!previous) return json({ removed: true, accountId });
    await db.prepare("DELETE FROM xstats_account_assets WHERE session_id = ? AND account_id = ?").bind(session.id, accountId).run();
    if (!previous.avatar_key.startsWith("d1:")) {
      try { await getAssetBucket().delete(previous.avatar_key); } catch { /* R2 may be unavailable for a D1 fallback asset. */ }
    }
    return json({ removed: true, accountId });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "アイコンを削除できませんでした。" }, { status: 500 });
  }
}
