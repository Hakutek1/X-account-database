export type StatusFilterCategory = "active" | "ended" | "suspended" | "nonAlt";

const categories = new Set<StatusFilterCategory>(["active", "ended", "suspended", "nonAlt"]);

/** Migrate v1's combined ended/frozen filter to both v2 categories. */
export function normalizeStoredStatusFilter(value: unknown, version: unknown): StatusFilterCategory[] | null {
  if (!Array.isArray(value)) return null;
  const selected = [...new Set(value.filter((item): item is StatusFilterCategory => typeof item === "string" && categories.has(item as StatusFilterCategory)))];
  if (version !== 2 && selected.includes("ended") && !selected.includes("suspended")) selected.push("suspended");
  return selected;
}
