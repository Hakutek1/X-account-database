import { getD1, getSharedSession, requireReadAccess } from "../_shared";
import { getReadMode } from "../../../lib/admin-access";
import { base64ToBytes, getAssetBucket, loadAccountAsset } from "../../../lib/account-assets";

export async function GET(request: Request) {
  const denied = await requireReadAccess(request);
  if (denied) return denied;
  const accountId = new URL(request.url).searchParams.get("accountId")?.trim();
  if (!accountId || accountId.length > 200) return new Response("Not found", { status: 404 });
  try {
    const db = getD1();
    const session = getSharedSession();
    const asset = await loadAccountAsset(db, session.id, accountId);
    if (!asset) return new Response("Not found", { status: 404 });
    if (asset.avatar_data) {
      return new Response(base64ToBytes(asset.avatar_data), {
        headers: {
          "Content-Type": asset.content_type,
          "Cache-Control": getReadMode() === "public" ? "public, max-age=31536000, immutable" : "private, no-store",
        },
      });
    }
    const object = await getAssetBucket().get(asset.avatar_key);
    if (!object) return new Response("Not found", { status: 404 });
    return new Response(object.body, {
      headers: {
        "Content-Type": asset.content_type,
        "Cache-Control": getReadMode() === "public" ? "public, max-age=31536000, immutable" : "private, no-store",
        ETag: object.httpEtag,
      },
    });
  } catch {
    return new Response("Avatar unavailable", { status: 503 });
  }
}
