import { ensureAccountTargetsSchema, ensureSchema, ensureSharedSession, getD1, getSessionFromRequest, getSharedSession, sessionCookie } from "../../db";
import { isAdminRequest, isReadAllowed } from "../../lib/admin-access";

export { ensureAccountTargetsSchema, ensureSchema, ensureSharedSession, getD1, getSessionFromRequest, getSharedSession, sessionCookie };

export async function requireReadAccess(request: Request) {
  if (await isReadAllowed(request)) return null;
  return json({ error: "閲覧には管理者ログインが必要です。" }, { status: 403, headers: { "Cache-Control": "no-store" } });
}

export async function requireAdmin(request: Request) {
  if (await isAdminRequest(request)) return null;
  return json({ error: "この操作は管理者のみ実行できます。" }, { status: 403 });
}

export function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...(init?.headers ?? {}) },
  });
}
