export const FALLBACK_SITE_VERSION_NUMBER = 98;

export function formatSiteVersion(version: number) {
  const safeVersion = Number.isFinite(version) && version >= 0 ? Math.floor(version) : FALLBACK_SITE_VERSION_NUMBER;
  return `Ver.${(safeVersion / 100).toFixed(2)}`;
}

export function parseSiteVersion(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : FALLBACK_SITE_VERSION_NUMBER;
}

export function parseSiteSourceCommit(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const commit = value.trim();
  return /^[0-9a-f]{40}$/i.test(commit) ? commit.toLowerCase() : null;
}
