import { getD1, getSharedSession, json, requireReadAccess } from "../_shared";
import { loadEffectiveHistory } from "../../../lib/daily-history";
import { buildPublicHistoryResponse, type ReadOnlyHistoryDatabase } from "../../../lib/public-history";

export async function GET(request: Request) {
  const denied = await requireReadAccess(request);
  if (denied) return denied;
  const session = getSharedSession();
  try {
    const db = getD1();
    const payload = await buildPublicHistoryResponse(db as unknown as ReadOnlyHistoryDatabase, session.id, () => loadEffectiveHistory(db, session.id));
    return json(payload);
  } catch (error) {
    console.error("履歴の読み込みに失敗しました", error);
    return json({
      error: "履歴を読み込めませんでした",
      runs: [],
      rows: [],
      latestCollection: null,
    }, { status: 500 });
  }
}
