export const WORKBOOK_SHEETS = {
  latest: "最新データ",
  fullFollowers: "フォロワー（全履歴）",
  fullFollowing: "フォロー（全履歴）",
  fullPosts: "投稿（全履歴）",
  dailyFollowers: "フォロワー（日次履歴）",
  dailyFollowing: "フォロー（日次履歴）",
  dailyPosts: "投稿（日次履歴）",
} as const;

export const LEGACY_WORKBOOK_SHEET_ALIASES: Record<string, string> = {
  [WORKBOOK_SHEETS.fullFollowers]: "全履歴_フォロワー",
  [WORKBOOK_SHEETS.fullFollowing]: "全履歴_フォロー",
  [WORKBOOK_SHEETS.fullPosts]: "全履歴_投稿",
  [WORKBOOK_SHEETS.dailyFollowers]: "日次履歴_フォロワー",
  [WORKBOOK_SHEETS.dailyFollowing]: "日次履歴_フォロー",
  [WORKBOOK_SHEETS.dailyPosts]: "日次履歴_投稿",
};

export const MANAGED_WORKBOOK_SHEETS = [
  WORKBOOK_SHEETS.latest,
  WORKBOOK_SHEETS.fullFollowers,
  WORKBOOK_SHEETS.fullFollowing,
  WORKBOOK_SHEETS.fullPosts,
  WORKBOOK_SHEETS.dailyFollowers,
  WORKBOOK_SHEETS.dailyFollowing,
  WORKBOOK_SHEETS.dailyPosts,
] as const;

export const DAILY_HISTORY_SHEET_METRICS = [
  [WORKBOOK_SHEETS.dailyFollowers, "followers"],
  [WORKBOOK_SHEETS.dailyFollowing, "following"],
  [WORKBOOK_SHEETS.dailyPosts, "posts"],
] as const;

export function workbookSheetCandidates(canonicalName: string) {
  const legacyName = LEGACY_WORKBOOK_SHEET_ALIASES[canonicalName];
  return legacyName ? [canonicalName, legacyName] : [canonicalName];
}
