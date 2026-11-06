import { adminCookieForKey } from "../../../../lib/admin-access";
import { json } from "../../_shared";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { key?: unknown };
    const cookie = await adminCookieForKey(body.key);
    if (!cookie) return json({ error: "管理者キーが正しくありません。" }, { status: 401 });
    const response = json({ isAdmin: true });
    response.headers.set("Set-Cookie", cookie);
    return response;
  } catch {
    return json({ error: "管理者ログインを確認できませんでした。" }, { status: 400 });
  }
}
