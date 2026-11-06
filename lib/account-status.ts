export const ACCOUNT_STATUSES = ["active", "ended", "suspended", "non_alt"] as const;
export type AccountStatus = typeof ACCOUNT_STATUSES[number];

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  active: "活動中",
  ended: "活動終了",
  suspended: "凍結",
  non_alt: "非複垢",
};

export function isAccountStatus(value: unknown): value is AccountStatus {
  return typeof value === "string" && (ACCOUNT_STATUSES as readonly string[]).includes(value);
}

export async function ensureAccountStatuses(database: D1Database, sessionId: string, accountIds: string[], updatedAt = new Date().toISOString()) {
  const ids = [...new Set(accountIds.filter(Boolean))];
  for (let index = 0; index < ids.length; index += 80) {
    const statements = ids.slice(index, index + 80).map((accountId) => database.prepare(`INSERT INTO xstats_account_statuses
      (session_id, account_id, status, updated_at)
      VALUES (?, ?, 'active', ?)
      ON CONFLICT(session_id, account_id) DO NOTHING`).bind(sessionId, accountId, updatedAt));
    if (statements.length) await database.batch(statements);
  }
}

function normalizeJoinedAt(value: string | null | undefined) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00+09:00`).toISOString();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

/** Store the profile opening date once; later profile responses cannot overwrite it. */
export async function ensureAccountJoinedDates(database: D1Database, sessionId: string, rows: Array<{ accountId: string; joined: string | null | undefined }>, updatedAt = new Date().toISOString()) {
  const statements = rows
    .map((row) => ({ accountId: row.accountId, joinedAt: normalizeJoinedAt(row.joined) }))
    .filter((row): row is { accountId: string; joinedAt: string } => Boolean(row.accountId && row.joinedAt))
    .map((row) => database.prepare("UPDATE xstats_account_statuses SET joined_at = ?, updated_at = ? WHERE session_id = ? AND account_id = ? AND joined_at IS NULL").bind(row.joinedAt, updatedAt, sessionId, row.accountId));
  for (let index = 0; index < statements.length; index += 80) {
    const batch = statements.slice(index, index + 80);
    if (batch.length) await database.batch(batch);
  }
}

export async function loadAccountStatusMap(database: D1Database, sessionId: string) {
  const result = await database.prepare("SELECT account_id, status FROM xstats_account_statuses WHERE session_id = ?").bind(sessionId).all<{ account_id: string; status: string }>();
  return new Map(result.results.map((row) => [row.account_id, isAccountStatus(row.status) ? row.status : "active"] as const));
}

export async function loadAccountJoinedMap(database: D1Database, sessionId: string) {
  const result = await database.prepare("SELECT account_id, joined_at FROM xstats_account_statuses WHERE session_id = ?").bind(sessionId).all<{ account_id: string; joined_at: string | null }>();
  return new Map(result.results.map((row) => [row.account_id, row.joined_at] as const));
}
