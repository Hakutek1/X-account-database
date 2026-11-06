import { json } from "../../_shared";
import { graphFile, graphRequest } from "../../../../lib/microsoft-onedrive";
import { requireMicrosoftConnection, withSessionCookie } from "../_shared";

const EXCEL_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function requestBody(request: Request) {
  try {
    const body = await request.json() as { fileId?: unknown; eTag?: unknown };
    return { fileId: typeof body.fileId === "string" ? body.fileId.trim() : "", eTag: typeof body.eTag === "string" ? body.eTag : "" };
  } catch {
    return { fileId: "", eTag: "" };
  }
}

async function currentGraphFile(accessToken: string, fileId: string) {
  const response = await graphRequest(accessToken, `/me/drive/items/${encodeURIComponent(fileId)}?$select=id,name,eTag,size,lastModifiedDateTime,webUrl,file`);
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { response, payload, file: response.ok ? graphFile(payload) : null };
}

export async function POST(request: Request) {
  try {
    const connection = await requireMicrosoftConnection(request);
    if (connection.error || !connection.accessToken) return withSessionCookie(json({ error: connection.error }, { status: 401 }), connection.session);
    const { fileId } = await requestBody(request);
    if (!fileId || fileId.length > 500) return withSessionCookie(json({ error: "OneDriveファイルが指定されていません。" }, { status: 400 }), connection.session);
    const metadata = await currentGraphFile(connection.accessToken, fileId);
    if (!metadata.response.ok || !metadata.file) return withSessionCookie(json({ error: "OneDriveの対象Excelを取得できませんでした。" }, { status: 404 }), connection.session);
    const contentResponse = await graphRequest(connection.accessToken, `/me/drive/items/${encodeURIComponent(fileId)}/content`, { headers: { Accept: EXCEL_CONTENT_TYPE } });
    if (!contentResponse.ok || !contentResponse.body) return withSessionCookie(json({ error: "OneDriveのExcel内容を取得できませんでした。" }, { status: 502 }), connection.session);
    const response = new Response(contentResponse.body, { status: 200, headers: { "Content-Type": EXCEL_CONTENT_TYPE, "Cache-Control": "no-store", "X-File-Id": metadata.file.id, "X-File-Name": encodeURIComponent(metadata.file.name), "X-File-ETag": metadata.file.eTag ?? "" } });
    return withSessionCookie(response, connection.session);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "OneDriveのExcelを読み込めませんでした。" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const connection = await requireMicrosoftConnection(request);
    if (connection.error || !connection.accessToken) return withSessionCookie(json({ error: connection.error }, { status: 401 }), connection.session);
    const fileId = request.headers.get("x-file-id")?.trim() ?? "";
    const expectedETag = request.headers.get("x-file-etag") ?? "";
    if (!fileId || fileId.length > 500 || !expectedETag) return withSessionCookie(json({ error: "OneDriveファイルの版情報が不足しています。先にExcelを再読み込みしてください。" }, { status: 400 }), connection.session);
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > 250 * 1024 * 1024) return withSessionCookie(json({ error: "保存するExcelのサイズが上限を超えています。" }, { status: 413 }), connection.session);
    const metadata = await currentGraphFile(connection.accessToken, fileId);
    if (!metadata.response.ok || !metadata.file) return withSessionCookie(json({ error: "OneDriveの対象Excelを確認できませんでした。" }, { status: 404 }), connection.session);
    if (metadata.file.eTag !== expectedETag) return withSessionCookie(json({ error: "OneDrive上のExcelが別の場所で更新されています。再読み込みしてから保存してください。", conflict: true, file: metadata.file }, { status: 409 }), connection.session);
    const upload = await graphRequest(connection.accessToken, `/me/drive/items/${encodeURIComponent(fileId)}/content`, { method: "PUT", headers: { "Content-Type": EXCEL_CONTENT_TYPE, "If-Match": expectedETag }, body: bytes });
    const payload = await upload.json().catch(() => ({})) as Record<string, unknown>;
    if (upload.status === 412) return withSessionCookie(json({ error: "保存中にOneDrive上のExcelが更新されました。再読み込みしてから保存してください。", conflict: true }, { status: 409 }), connection.session);
    if (!upload.ok) return withSessionCookie(json({ error: "OneDriveへのExcel保存に失敗しました。", details: payload }, { status: 502 }), connection.session);
    const file = graphFile(payload);
    return withSessionCookie(json({ saved: true, file }), connection.session);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "OneDriveへExcelを保存できませんでした。" }, { status: 500 });
  }
}
