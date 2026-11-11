import { getD1, getSharedSession, json, requireAdmin } from "../../_shared";

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const session = getSharedSession();
  try {
    const db = getD1();
    const rows = await db.prepare("SELECT source_name, source_key, account_id, handle, display_name, updated_at FROM xstats_import_mappings WHERE session_id = ? ORDER BY source_name ASC").bind(session.id).all();
    const response = json({ mappings: rows.results });
    return response;
  } catch (error) {
    const response = json({ error: "保存済みの照合情報を読み込めませんでした", mappings: [] }, { status: 500 });
    return response;
  }
}
