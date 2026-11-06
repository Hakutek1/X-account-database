export type XstatsReadMode = "private" | "public";

/** Only an explicit "public" setting enables unauthenticated data reads. */
export function parseReadMode(value: unknown): XstatsReadMode {
  return typeof value === "string" && value.trim() === "public" ? "public" : "private";
}
