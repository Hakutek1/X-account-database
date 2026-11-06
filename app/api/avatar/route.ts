import { ensureSchema, ensureSharedSession, getD1, getSharedSession } from "../_shared";
import { base64ToBytes, getAssetBucket, loadAccountAsset } from "../../../lib/account-assets";

export async function GET(request: Request) {
  const accountId = new URL(request.url).searchParams.get("accountId")?.trim();
  if (!accountId || accountId.length > 200) return new Response("Not found", { status: 404 });
  try {
    await ensureSchema();
    const db = getD1();
    const session = getSharedSession();
    await ensureSharedSession(db);
    const asset = await loadAccountAsset(db, session.id, accountId);
    if (!asset) return new Response("Not found", { status: 404 });
    if (asset.avatar_data) {
      return new Response(base64ToBytes(asset.avatar_data), {
        headers: {
          "Content-Type": asset.content_type,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }
    const object = await getAssetBucket().get(asset.avatar_key);
    if (!object) return new Response("Not found", { status: 404 });
    return new Response(object.body, {
      headers: {
        "Content-Type": asset.content_type,
        "Cache-Control": "public, max-age=31536000, immutable",
        ETag: object.httpEtag,
      },
    });
  } catch {
    return new Response("Avatar unavailable", { status: 503 });
  }
}
