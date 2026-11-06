import { json } from "../../_shared";
import { deleteMicrosoftConnection, withSessionCookie } from "../_shared";
import { isAdminRequest } from "../../../../lib/admin-access";

export async function POST(request: Request) {
  try {
    if (!(await isAdminRequest(request))) return json({ error: "Microsoft連携は管理者のみ利用できます。" }, { status: 403 });
    const session = await deleteMicrosoftConnection(request);
    return withSessionCookie(json({ connected: false }), session);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Microsoft接続を解除できませんでした。" }, { status: 500 });
  }
}
