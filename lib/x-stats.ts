import { env } from "cloudflare:workers";

export const MAX_ACCOUNTS = 500;
const FXTWITTER_TIMEOUT_MS = 15_000;
const FXTWITTER_MAX_ATTEMPTS = 3;
const FXTWITTER_RETRY_BASE_DELAY_MS = 500;
const FXTWITTER_RETRY_MAX_DELAY_MS = 5_000;
const FXTWITTER_CONCURRENCY = 3;
const RETRYABLE_FXTWITTER_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

export type InputParseResult = {
  handles: string[];
  errors: string[];
};

export type ProfileResult = {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  followers: number | null;
  following: number | null;
  posts: number | null;
  joined: string | null;
  fetchedAt: string;
};

export type ProfileError = {
  handle: string;
  error: string;
  fetchedAt: string;
};

function addUnique(target: string[], value: string) {
  const normalized = value.replace(/^@/, "").trim().toLowerCase();
  if (normalized && !target.includes(normalized)) target.push(normalized);
}

export function parseInputs(values: string[]): InputParseResult {
  const handles: string[] = [];
  const errors: string[] = [];

  for (const rawValue of values.flatMap((value) => value.split(/[\n,\s]+/))) {
    const value = rawValue.trim();
    if (!value) continue;

    if (/^@?[A-Za-z0-9_]{1,15}$/.test(value)) {
      addUnique(handles, value);
      continue;
    }

    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      if (!/(^|\.)((x|twitter)\.com)$/.test(host)) {
        errors.push(`XのURLではありません: ${value}`);
        continue;
      }

      const firstSegment = url.pathname.split("/").filter(Boolean)[0];
      if (firstSegment && /^@?[A-Za-z0-9_]{1,15}$/.test(firstSegment)) {
        addUnique(handles, firstSegment);
      } else {
        errors.push(`プロフィールを判別できません: ${value}`);
      }
    } catch {
      errors.push(`入力を判別できません: ${value}`);
    }
  }

  return { handles, errors };
}

function fxTwitterBaseUrl() {
  return (env as unknown as Record<string, string | undefined>).FXTWITTER_BASE_URL ?? "https://api.fxtwitter.com";
}

class FxTwitterRequestError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly retryAfterMs: number | null = null) {
    super(message);
    this.name = "FxTwitterRequestError";
  }
}

function retryAfterMilliseconds(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1_000));
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : null;
}

function retryDelayMilliseconds(attempt: number, retryAfterMs: number | null) {
  const exponentialDelay = Math.min(FXTWITTER_RETRY_MAX_DELAY_MS, FXTWITTER_RETRY_BASE_DELAY_MS * 2 ** attempt);
  const requestedDelay = Math.max(exponentialDelay, retryAfterMs ?? 0);
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(FXTWITTER_RETRY_MAX_DELAY_MS, requestedDelay + jitter);
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchProfileOnce(handle: string): Promise<ProfileResult> {
  const fetchedAt = new Date().toISOString();
  const url = `${fxTwitterBaseUrl().replace(/\/$/, "")}/2/profile/${encodeURIComponent(handle)}?about_account=1`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FXTWITTER_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "X-Account-Stats/1.0 (+https://x-account-stats.hakutek1.chatgpt.site)",
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) throw new FxTwitterRequestError("fxTwitterの応答がタイムアウトしました", true);
    throw new FxTwitterRequestError(error instanceof Error ? error.message : "fxTwitter APIへの接続に失敗しました", true);
  } finally {
    clearTimeout(timeout);
  }
  const payload = (await response.json().catch(() => ({}))) as {
    user?: Record<string, unknown>;
    message?: string;
    error?: string;
  };

  if (!response.ok || !payload.user) {
    const retryable = response.ok || RETRYABLE_FXTWITTER_STATUS_CODES.has(response.status);
    throw new FxTwitterRequestError(
      payload.message ?? payload.error ?? `プロフィールを取得できませんでした (${response.status})`,
      retryable,
      retryable ? retryAfterMilliseconds(response.headers.get("retry-after")) : null,
    );
  }

  const user = payload.user;
  const numeric = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

  return {
    id: String(user.id ?? handle),
    handle: String(user.screen_name ?? handle),
    displayName: String(user.name ?? handle),
    avatarUrl: typeof user.avatar_url === "string" ? user.avatar_url : null,
    followers: numeric(user.followers),
    following: numeric(user.following),
    posts: numeric(user.statuses ?? user.tweets),
    joined: typeof user.joined === "string" ? user.joined : null,
    fetchedAt,
  };
}

export async function fetchProfile(handle: string): Promise<ProfileResult> {
  let lastError: unknown;

  for (let attempt = 0; attempt < FXTWITTER_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fetchProfileOnce(handle);
    } catch (error) {
      lastError = error;
      if (!(error instanceof FxTwitterRequestError) || !error.retryable || attempt === FXTWITTER_MAX_ATTEMPTS - 1) throw error;
      await wait(retryDelayMilliseconds(attempt, error.retryAfterMs));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("プロフィール取得に失敗しました");
}

export async function fetchProfiles(handles: string[]) {
  const results: ProfileResult[] = [];
  const errors: ProfileError[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < handles.length) {
      const handle = handles[cursor++];
      try {
        results.push(await fetchProfile(handle));
      } catch (error) {
        errors.push({
          handle,
          error: error instanceof Error ? error.message : "プロフィール取得に失敗しました",
          fetchedAt: new Date().toISOString(),
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(FXTWITTER_CONCURRENCY, handles.length) }, () => worker()));
  return { results: results.sort((a, b) => a.handle.localeCompare(b.handle)), errors };
}
