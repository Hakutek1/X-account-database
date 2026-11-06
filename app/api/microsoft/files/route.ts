import { json, requireReadAccess } from "../../_shared";
import { graphFile, graphRequest } from "../../../../lib/microsoft-onedrive";
import { requireMicrosoftConnection, withSessionCookie } from "../_shared";

export async function GET(request: Request) {
  const denied = await requireReadAccess(request);
  if (denied) return denied;
  try {
    const connection = await requireMicrosoftConnection(request, { readOnly: true });
    if (connection.error || !connection.accessToken) return withSessionCookie(json({ error: connection.error }, { status: 503 }), connection.session);
    const files = [];
    let nextUrl = "/me/drive/root/search(q='.xlsx')?$select=id,name,eTag,size,lastModifiedDateTime,webUrl,file";
    for (let page = 0; page < 5 && nextUrl; page += 1) {
      const response = await graphRequest(connection.accessToken, nextUrl);
      const payload = await response.json() as { value?: Array<Record<string, unknown>>; [key: string]: unknown };
      if (!response.ok) return withSessionCookie(json({ error: "OneDriveのExcel一覧を取得できませんでした。" }, { status: 502 }), connection.session);
      for (const item of payload.value ?? []) {
        const file = graphFile(item);
        if (file && file.name.toLowerCase().endsWith(".xlsx")) files.push(file);
      }
      nextUrl = typeof payload["@odata.nextLink"] === "string" ? String(payload["@odata.nextLink"]).replace("https://graph.microsoft.com/v1.0", "") : "";
    }
    files.sort((left, right) => left.name.localeCompare(right.name, "ja"));
    return withSessionCookie(json({ files }), connection.session);
  } catch {
    return json({ error: "OneDriveのExcel一覧を取得できませんでした。" }, { status: 500 });
  }
}
