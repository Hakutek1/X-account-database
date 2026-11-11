import { json, requireAdmin } from "../../_shared";
import { isAdminRequest } from "../../../../lib/admin-access";
import { microsoftRuntimeConfig, requireMicrosoftConnection, withSessionCookie } from "../_shared";

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const admin = await isAdminRequest(request);
  const config = microsoftRuntimeConfig();
  if (!config) return json({ configured: false, connected: false });
  try {
    const connection = await requireMicrosoftConnection(request, { readOnly: true });
    const response = json({ configured: true, connected: !connection.error, refreshRequired: "refreshRequired" in connection ? Boolean(connection.refreshRequired) : false, user: admin ? connection.user ?? null : null, error: connection.error ?? null });
    return withSessionCookie(response, connection.session);
  } catch {
    return json({ configured: true, connected: false, error: "Microsoft接続状態を取得できませんでした。" }, { status: 500 });
  }
}
