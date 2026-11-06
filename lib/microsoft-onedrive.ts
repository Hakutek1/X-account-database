const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

export type MicrosoftConfig = {
  clientId: string;
  clientSecret: string;
  tenant: string;
  ownerEmail: string;
  ownerId: string;
  redirectUri?: string;
  tokenEncryptionKey: string;
};

export type MicrosoftProfile = {
  id: string;
  displayName: string | null;
  mail: string | null;
  userPrincipalName: string | null;
};

export type GraphFile = {
  id: string;
  name: string;
  eTag: string | null;
  size: number | null;
  lastModifiedDateTime: string | null;
  webUrl: string | null;
};

type TokenSet = { accessToken: string; refreshToken: string; expiresAt: number };

function envString(runtimeEnv: Record<string, unknown>, key: string) {
  const value = runtimeEnv[key];
  return typeof value === "string" ? value.trim() : "";
}

export function getMicrosoftConfig(runtimeEnv: Record<string, unknown>): MicrosoftConfig | null {
  const clientId = envString(runtimeEnv, "MICROSOFT_CLIENT_ID");
  const clientSecret = envString(runtimeEnv, "MICROSOFT_CLIENT_SECRET");
  const ownerEmail = envString(runtimeEnv, "MICROSOFT_OWNER_EMAIL").toLowerCase();
  const ownerId = envString(runtimeEnv, "MICROSOFT_OWNER_ID");
  const tokenEncryptionKey = envString(runtimeEnv, "MICROSOFT_TOKEN_ENCRYPTION_KEY") || clientSecret;
  if (!clientId || !clientSecret || (!ownerEmail && !ownerId) || !tokenEncryptionKey) return null;
  return {
    clientId,
    clientSecret,
    tenant: envString(runtimeEnv, "MICROSOFT_TENANT_ID") || "consumers",
    ownerEmail,
    ownerId,
    redirectUri: envString(runtimeEnv, "MICROSOFT_REDIRECT_URI") || undefined,
    tokenEncryptionKey,
  };
}

export function redirectUri(request: Request, config: MicrosoftConfig) {
  return config.redirectUri || `${new URL(request.url).origin}/api/microsoft/callback`;
}

export function authorizationUrl(request: Request, config: MicrosoftConfig, state: string) {
  const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri(request, config));
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", "openid profile email offline_access User.Read Files.ReadWrite");
  url.searchParams.set("state", state);
  return url.toString();
}

function base64Encode(bytes: Uint8Array) {
  let output = "";
  for (let index = 0; index < bytes.length; index += 0x8000) output += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(output);
}

function base64Decode(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(value: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(secret), new TextEncoder().encode(value));
  const payload = new Uint8Array(iv.length + encrypted.byteLength);
  payload.set(iv);
  payload.set(new Uint8Array(encrypted), iv.length);
  return base64Encode(payload);
}

export async function decryptToken(value: string, secret: string) {
  const payload = base64Decode(value);
  if (payload.length <= 12) throw new Error("Microsoft認証情報を復号できません。");
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: payload.slice(0, 12) }, await encryptionKey(secret), payload.slice(12));
  return new TextDecoder().decode(decrypted);
}

export function isMicrosoftOwner(profile: MicrosoftProfile, config: MicrosoftConfig) {
  const email = (profile.mail || profile.userPrincipalName || "").toLowerCase();
  return Boolean((config.ownerId && profile.id === config.ownerId) || (config.ownerEmail && email === config.ownerEmail));
}

export async function exchangeAuthorizationCode(request: Request, config: MicrosoftConfig, code: string): Promise<TokenSet> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: redirectUri(request, config),
    grant_type: "authorization_code",
    scope: "openid profile email offline_access User.Read Files.ReadWrite",
  });
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const payload = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !payload.access_token || !payload.refresh_token) throw new Error(payload.error_description || "Microsoft認証トークンを取得できませんでした。");
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token, expiresAt: Date.now() + Math.max(60, Number(payload.expires_in ?? 3600)) * 1000 };
}

export async function refreshAccessToken(config: MicrosoftConfig, refreshToken: string): Promise<TokenSet> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: "openid profile email offline_access User.Read Files.ReadWrite",
  });
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const payload = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !payload.access_token) throw new Error(payload.error_description || "Microsoftの認証を更新できませんでした。もう一度接続してください。");
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token || refreshToken, expiresAt: Date.now() + Math.max(60, Number(payload.expires_in ?? 3600)) * 1000 };
}

export async function graphRequest(accessToken: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("Accept", "application/json");
  return fetch(`${GRAPH_BASE_URL}${path}`, { ...init, headers });
}

export function graphFile(value: Record<string, unknown>): GraphFile | null {
  const id = typeof value.id === "string" ? value.id : "";
  const name = typeof value.name === "string" ? value.name : "";
  if (!id || !name) return null;
  return {
    id,
    name,
    eTag: typeof value.eTag === "string" ? value.eTag : null,
    size: typeof value.size === "number" ? value.size : null,
    lastModifiedDateTime: typeof value.lastModifiedDateTime === "string" ? value.lastModifiedDateTime : null,
    webUrl: typeof value.webUrl === "string" ? value.webUrl : null,
  };
}

export type { TokenSet };
