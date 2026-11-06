import { getSharedSession } from "../../../../db";
import { isAdminRequest } from "../../../../lib/admin-access";
import { exchangeAuthorizationCode, graphRequest, isMicrosoftOwner, type MicrosoftProfile } from "../../../../lib/microsoft-onedrive";
import { microsoftRuntimeConfig, saveMicrosoftConnection } from "../_shared";

function cookieValue(request: Request, name: string) {
  return (request.headers.get("cookie") ?? "").split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";
}

function redirectWithMessage(request: Request, message: string) {
  const url = new URL("/", request.url);
  url.searchParams.set("microsoft", "error");
  url.searchParams.set("message", message);
  const response = Response.redirect(url, 302);
  response.headers.set("Set-Cookie", "xstats_ms_state=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure");
  return response;
}

export async function GET(request: Request) {
  const config = microsoftRuntimeConfig();
  if (!config) return redirectWithMessage(request, "Microsoft連携の環境設定が未完了です。");
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const session = getSharedSession();
  if (!(await isAdminRequest(request))) return redirectWithMessage(request, "管理者のみMicrosoft連携を利用できます。");
  const expectedState = cookieValue(request, "xstats_ms_state");
  if (!code || !state || !expectedState || state !== expectedState || !state.startsWith(`${session.id}.`)) return redirectWithMessage(request, "Microsoft認証の確認に失敗しました。もう一度接続してください。");
  try {
    const tokens = await exchangeAuthorizationCode(request, config, code);
    const profileResponse = await graphRequest(tokens.accessToken, "/me?$select=id,displayName,mail,userPrincipalName");
    const profile = await profileResponse.json() as MicrosoftProfile;
    if (!profileResponse.ok || !profile.id) throw new Error("Microsoftアカウント情報を取得できませんでした。");
    if (!isMicrosoftOwner(profile, config)) throw new Error("このMicrosoftアカウントは所有者として登録されていません。");
    await saveMicrosoftConnection(session.id, config, { id: profile.id, email: (profile.mail || profile.userPrincipalName || "").toLowerCase(), displayName: profile.displayName || "Microsoftユーザー" }, tokens);
    const response = Response.redirect(new URL("/?microsoft=connected", request.url), 302);
    response.headers.set("Set-Cookie", "xstats_ms_state=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure");
    return response;
  } catch (error) {
    return redirectWithMessage(request, error instanceof Error ? error.message : "Microsoft接続に失敗しました。");
  }
}
