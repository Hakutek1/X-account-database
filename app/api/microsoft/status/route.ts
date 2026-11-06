import { json } from "../../_shared";
import { microsoftRuntimeConfig, requireMicrosoftConnection, withSessionCookie } from "../_shared";

export async function GET(request: Request) {
  const config = microsoftRuntimeConfig();
  if (!config) return json({ configured: false, connected: false });
  try {
    const connection = await requireMicrosoftConnection(request);
    const response = json({ configured: true, connected: !connection.error, user: connection.user ?? null, error: connection.error ?? null });
    return withSessionCookie(response, connection.session);
  } catch (error) {
    return json({ configured: true, connected: false, error: error instanceof Error ? error.message : "Microsoft接続状態を取得できませんでした。" }, { status: 500 });
  }
}
