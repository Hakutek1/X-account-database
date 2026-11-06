import { env } from "cloudflare:workers";
import { ensureSchema, getD1, getSharedSession, sessionCookie } from "../../../db";
import { isAdminRequest } from "../../../lib/admin-access";
import { decryptToken, encryptToken, getMicrosoftConfig, refreshAccessToken, type MicrosoftConfig, type TokenSet } from "../../../lib/microsoft-onedrive";

export function microsoftRuntimeConfig() {
  return getMicrosoftConfig(env as unknown as Record<string, unknown>);
}

export function withSessionCookie(response: Response, session: ReturnType<typeof getSharedSession>) {
  if (session.isNew) response.headers.append("Set-Cookie", sessionCookie(session.id));
  return response;
}

export async function saveMicrosoftConnection(sessionId: string, config: MicrosoftConfig, profile: { id: string; email: string; displayName: string }, tokens: TokenSet) {
  await ensureSchema();
  const db = getD1();
  const now = new Date().toISOString();
  const [accessToken, refreshToken] = await Promise.all([encryptToken(tokens.accessToken, config.tokenEncryptionKey), encryptToken(tokens.refreshToken, config.tokenEncryptionKey)]);
  await db.prepare(`INSERT INTO xstats_sessions (id, created_at, last_seen_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at`).bind(sessionId, now, now).run();
  await db.prepare(`INSERT INTO xstats_microsoft_tokens (session_id, microsoft_user_id, email, display_name, access_token, refresh_token, expires_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET microsoft_user_id = excluded.microsoft_user_id, email = excluded.email, display_name = excluded.display_name, access_token = excluded.access_token, refresh_token = excluded.refresh_token, expires_at = excluded.expires_at, updated_at = excluded.updated_at`).bind(sessionId, profile.id, profile.email, profile.displayName, accessToken, refreshToken, tokens.expiresAt, now).run();
}

export async function requireMicrosoftConnection(request: Request) {
  const session = getSharedSession();
  const config = microsoftRuntimeConfig();
  if (!(await isAdminRequest(request))) return { session, config, error: "Microsoft連携は管理者のみ利用できます。" } as const;
  if (!config) return { session, config: null, error: "Microsoft連携の環境設定が未完了です。管理者がClient ID・Secret・所有者情報を設定してください。" } as const;
  await ensureSchema();
  const db = getD1();
  const result = await db.prepare("SELECT microsoft_user_id, email, display_name, access_token, refresh_token, expires_at FROM xstats_microsoft_tokens WHERE session_id = ?").bind(session.id).first<{ microsoft_user_id: string; email: string; display_name: string; access_token: string; refresh_token: string; expires_at: number }>();
  if (!result) return { session, config, error: "Microsoftアカウントが接続されていません。" } as const;
  let accessToken = await decryptToken(result.access_token, config.tokenEncryptionKey);
  const refreshToken = await decryptToken(result.refresh_token, config.tokenEncryptionKey);
  if (result.expires_at <= Date.now() + 120_000) {
    const refreshed = await refreshAccessToken(config, refreshToken);
    accessToken = refreshed.accessToken;
    const encryptedAccessToken = await encryptToken(refreshed.accessToken, config.tokenEncryptionKey);
    const encryptedRefreshToken = await encryptToken(refreshed.refreshToken, config.tokenEncryptionKey);
    await db.prepare("UPDATE xstats_microsoft_tokens SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = ? WHERE session_id = ?").bind(encryptedAccessToken, encryptedRefreshToken, refreshed.expiresAt, new Date().toISOString(), session.id).run();
  }
  return { session, config, accessToken, user: { id: result.microsoft_user_id, email: result.email, displayName: result.display_name } } as const;
}

export async function deleteMicrosoftConnection(request: Request) {
  const session = getSharedSession();
  if (!(await isAdminRequest(request))) return session;
  await ensureSchema();
  await getD1().prepare("DELETE FROM xstats_microsoft_tokens WHERE session_id = ?").bind(session.id).run();
  return session;
}
