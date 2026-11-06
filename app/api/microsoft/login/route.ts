import { getSharedSession } from "../../../../db";
import { isAdminRequest } from "../../../../lib/admin-access";
import { authorizationUrl } from "../../../../lib/microsoft-onedrive";
import { microsoftRuntimeConfig } from "../_shared";

function stateCookie(value: string) {
  return `xstats_ms_state=${value}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax; Secure`;
}

export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) return new Response("管理者のみ利用できます。", { status: 403 });
  const config = microsoftRuntimeConfig();
  if (!config) return new Response("Microsoft連携の設定が未完了です。", { status: 503 });
  const session = getSharedSession();
  const state = `${session.id}.${crypto.randomUUID()}`;
  const response = Response.redirect(authorizationUrl(request, config, state), 302);
  response.headers.append("Set-Cookie", stateCookie(state));
  return response;
}
