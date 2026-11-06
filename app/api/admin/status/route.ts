import { adminIsConfigured, getReadMode, isAdminRequest } from "../../../../lib/admin-access";
import { json } from "../../_shared";

export async function GET(request: Request) {
  return json({ configured: adminIsConfigured(), isAdmin: await isAdminRequest(request), readMode: getReadMode() });
}
