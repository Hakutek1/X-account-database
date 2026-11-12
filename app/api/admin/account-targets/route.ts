import { addHandleTargets, normalizeStoredHandleTargets, removeHandleTarget } from "../../../../lib/account-targets";
import { ensureSchema, getD1, getSharedSession, json, requireAdmin } from "../../_shared";

const MAX_TARGETS = 500;

type StoredTargets = {
  session_id: string;
  handles_json: string;
  revision: number;
  initialized: number;
  updated_at: string;
};

type TargetBody = {
  action?: unknown;
  expectedRevision?: unknown;
  handles?: unknown;
  handle?: unknown;
};

function serialize(row: StoredTargets | null, handles = row ? parseStored(row.handles_json) : []) {
  return {
    handles,
    revision: row?.revision ?? 0,
    initialized: Boolean(row?.initialized),
  };
}

function parseStored(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? normalizeStoredHandleTargets(parsed.filter((item): item is string => typeof item === "string").join("\n")).handles.slice(0, MAX_TARGETS)
      : [];
  } catch {
    return [];
  }
}

async function currentTargets(database: D1Database, sessionId: string) {
  return database.prepare("SELECT session_id, handles_json, revision, initialized, updated_at FROM xstats_account_targets WHERE session_id = ?").bind(sessionId).first<StoredTargets>();
}

function jsonNoStore(value: unknown, init?: ResponseInit) {
  const response = json(value, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    await ensureSchema();
    const row = await currentTargets(getD1(), getSharedSession().id);
    return jsonNoStore(serialize(row));
  } catch {
    return jsonNoStore({ error: "共有アカウント一覧を読み込めませんでした。" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const body = await request.json() as TargetBody;
    const action = body.action;
    if (action !== "initialize" && action !== "add" && action !== "merge" && action !== "remove") {
      return jsonNoStore({ error: "操作内容が正しくありません。" }, { status: 400 });
    }
    const expectedRevision = Number(body.expectedRevision);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      return jsonNoStore({ error: "一覧の版情報が正しくありません。" }, { status: 400 });
    }
    await ensureSchema();
    const db = getD1();
    const sessionId = getSharedSession().id;
    const current = await currentTargets(db, sessionId);
    const currentState = serialize(current);
    if (currentState.revision !== expectedRevision) {
      return jsonNoStore({ ...currentState, conflict: true, error: "別のブラウザーで一覧が更新されました。最新の一覧を読み込みました。内容を確認してもう一度操作してください。" }, { status: 409 });
    }

    let nextHandles: string[];
    if (action === "initialize") {
      if (currentState.initialized) {
        return jsonNoStore({ ...currentState, conflict: true, error: "共有一覧はすでに初期化されています。内容を確認してください。" }, { status: 409 });
      }
      if (!Array.isArray(body.handles) || body.handles.some((item) => typeof item !== "string") || body.handles.length > MAX_TARGETS) {
        return jsonNoStore({ error: `アカウントは${MAX_TARGETS}件まで指定できます。` }, { status: 413 });
      }
      const parsed = normalizeStoredHandleTargets((body.handles as string[]).join("\n"));
      if (parsed.errors.length) return jsonNoStore({ error: "形式が正しくないハンドルが含まれています。" }, { status: 400 });
      nextHandles = parsed.handles;
    } else if (action === "remove") {
      if (typeof body.handle !== "string") return jsonNoStore({ error: "削除するハンドルを指定してください。" }, { status: 400 });
      const parsed = normalizeStoredHandleTargets(body.handle);
      if (parsed.errors.length || parsed.handles.length !== 1) return jsonNoStore({ error: "ハンドル名を1件だけ指定してください。" }, { status: 400 });
      nextHandles = removeHandleTarget(currentState.handles, parsed.handles[0]);
    } else {
      if (!Array.isArray(body.handles) || body.handles.some((item) => typeof item !== "string") || body.handles.length > MAX_TARGETS) {
        return jsonNoStore({ error: `アカウントは${MAX_TARGETS}件まで指定できます。` }, { status: 413 });
      }
      const parsed = normalizeStoredHandleTargets((body.handles as string[]).join("\n"));
      if (parsed.errors.length) return jsonNoStore({ error: "形式が正しくないハンドルが含まれています。" }, { status: 400 });
      const added = addHandleTargets(currentState.handles, parsed.handles.join("\n"), MAX_TARGETS);
      if (added.overflow) return jsonNoStore({ error: `共有一覧は${MAX_TARGETS}件までです。追加分は保存されませんでした。` }, { status: 413 });
      nextHandles = added.handles;
    }

    const changed = !currentState.initialized || nextHandles.length !== currentState.handles.length
      || nextHandles.some((handle, index) => handle.toLowerCase() !== currentState.handles[index]?.toLowerCase());
    if (!changed) return jsonNoStore({ ...currentState, changed: false });

    const now = new Date().toISOString();
    let result: D1Result;
    if (!current) {
      if (action === "remove") return jsonNoStore({ ...currentState, changed: false });
      result = await db.prepare(`INSERT INTO xstats_account_targets (session_id, handles_json, revision, initialized, updated_at)
        SELECT ?, ?, 1, 1, ? WHERE NOT EXISTS (SELECT 1 FROM xstats_account_targets WHERE session_id = ?)`).bind(sessionId, JSON.stringify(nextHandles), now, sessionId).run();
    } else {
      result = await db.prepare(`UPDATE xstats_account_targets SET handles_json = ?, revision = revision + 1, initialized = 1, updated_at = ?
        WHERE session_id = ? AND revision = ?`).bind(JSON.stringify(nextHandles), now, sessionId, expectedRevision).run();
    }
    if (Number(result.meta?.changes ?? 0) !== 1) {
      const latest = await currentTargets(db, sessionId);
      return jsonNoStore({ ...serialize(latest), conflict: true, error: "別のブラウザーで一覧が更新されました。最新の一覧を読み込みました。内容を確認してもう一度操作してください。" }, { status: 409 });
    }
    const latest = await currentTargets(db, sessionId);
    return jsonNoStore({ ...serialize(latest), changed: true });
  } catch {
    return jsonNoStore({ error: "共有アカウント一覧を保存できませんでした。" }, { status: 500 });
  }
}
