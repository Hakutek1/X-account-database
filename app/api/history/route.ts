import { getD1, getSharedSession, json } from "../_shared";
import { loadEffectiveHistory } from "../../../lib/daily-history";
import { buildPublicHistoryResponse, type ReadOnlyHistoryDatabase } from "../../../lib/public-history";

export async function GET() {
  const session = getSharedSession();
  try {
    const db = getD1();
    const payload = await buildPublicHistoryResponse(db as unknown as ReadOnlyHistoryDatabase, session.id, () => loadEffectiveHistory(db, session.id));
    return json(payload);
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "履歴を読み込めませんでした",
      runs: [],
      rows: [],
      latestCollection: null,
    }, { status: 500 });
  }
}
