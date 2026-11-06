import { ensureSchema, ensureSharedSession, getD1, getSharedSession, json } from "../../_shared";

export async function GET() {
  const session = getSharedSession();
  try {
    await ensureSchema();
    const db = getD1();
    await ensureSharedSession(db);
    const rows = await db.prepare("SELECT source_name, source_key, account_id, handle, display_name, updated_at FROM xstats_import_mappings WHERE session_id = ? ORDER BY source_name ASC").bind(session.id).all();
    const response = json({ mappings: rows.results });
    return response;
  } catch (error) {
    const response = json({ error: error instanceof Error ? error.message : "保存済みの照合情報を読み込めませんでした", mappings: [] }, { status: 500 });
    return response;
  }
}
