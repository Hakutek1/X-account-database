import { env } from "cloudflare:workers";
import { parseReadMode, type XstatsReadMode } from "./read-mode.ts";

const ADMIN_COOKIE = "xstats_admin";
const ADMIN_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function getReadMode(): XstatsReadMode {
  const value = (env as unknown as Record<string, unknown>).XSTATS_READ_MODE;
  return parseReadMode(value);
}

export async function isReadAllowed(request: Request) {
  return getReadMode() === "public" || isAdminRequest(request);
}

function configuredKey() {
  const value = (env as unknown as Record<string, unknown>).XSTATS_ADMIN_KEY;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function cookieValue(request: Request) {
  return (request.headers.get("cookie") ?? "").split(";").map((item) => item.trim()).find((item) => item.startsWith(`${ADMIN_COOKIE}=`))?.slice(ADMIN_COOKIE.length + 1) ?? "";
}

export async function isAdminRequest(request: Request) {
  const secret = configuredKey();
  if (!secret) return false;
  const [timestamp, suppliedSignature] = cookieValue(request).split(".");
  const timestampNumber = Number(timestamp);
  if (!timestamp || !suppliedSignature || !Number.isFinite(timestampNumber) || Math.abs(Date.now() - timestampNumber) > ADMIN_COOKIE_MAX_AGE * 1000) return false;
  try {
    const expectedSignature = fromBase64Url(await sign(timestamp, secret));
    return equalBytes(expectedSignature, fromBase64Url(suppliedSignature));
  } catch {
    return false;
  }
}

export async function adminCookieForKey(value: unknown) {
  const secret = configuredKey();
  const supplied = typeof value === "string" ? value.trim() : "";
  if (!secret || !supplied || supplied !== secret) return null;
  const timestamp = String(Date.now());
  const signature = await sign(timestamp, secret);
  return `${ADMIN_COOKIE}=${timestamp}.${signature}; Path=/; Max-Age=${ADMIN_COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax; Secure`;
}

export function clearAdminCookie() {
  return `${ADMIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`;
}

export function adminIsConfigured() {
  return Boolean(configuredKey());
}
