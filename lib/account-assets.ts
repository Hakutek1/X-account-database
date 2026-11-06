import { env } from "cloudflare:workers";

export const MAX_AVATAR_BYTES = 512 * 1024;
export const AVATAR_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export type AccountAsset = {
  id: string;
  session_id: string;
  account_id: string;
  avatar_key: string;
  avatar_url: string;
  avatar_data: string | null;
  content_type: string;
  updated_at: string;
};

type AssetBucket = {
  put: (key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }) => Promise<unknown>;
  get: (key: string) => Promise<{ body: ReadableStream; httpEtag: string } | null>;
  delete: (key: string) => Promise<void>;
};

export function getAssetBucket() {
  const bucket = (env as unknown as { ASSETS?: AssetBucket }).ASSETS;
  if (!bucket) throw new Error("R2バケット `ASSETS` が利用できません。サイトのストレージ設定を確認してください。");
  return bucket;
}

export function accountAssetId(sessionId: string, accountId: string) {
  return `account-avatar:${sessionId}:${encodeURIComponent(accountId)}`;
}

export function accountAssetUrl(accountId: string, updatedAt: string) {
  return `/api/avatar?accountId=${encodeURIComponent(accountId)}&v=${encodeURIComponent(updatedAt)}`;
}

export function accountAssetKey(sessionId: string, accountId: string, token = crypto.randomUUID()) {
  return `avatars/${encodeURIComponent(sessionId)}/${encodeURIComponent(accountId)}/${token}`;
}

export function bytesToBase64(value: ArrayBuffer) {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function loadAccountAssets(database: D1Database, sessionId: string): Promise<AccountAsset[]> {
  const result = await database.prepare(`SELECT id, session_id, account_id, avatar_key, avatar_url, avatar_data, content_type, updated_at
    FROM xstats_account_assets WHERE session_id = ? ORDER BY account_id ASC`).bind(sessionId).all<AccountAsset>();
  return result.results;
}

export async function loadAccountAsset(database: D1Database, sessionId: string, accountId: string): Promise<AccountAsset | null> {
  return database.prepare(`SELECT id, session_id, account_id, avatar_key, avatar_url, avatar_data, content_type, updated_at
    FROM xstats_account_assets WHERE session_id = ? AND account_id = ? LIMIT 1`).bind(sessionId, accountId).first<AccountAsset>();
}
