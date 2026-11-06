import { clearAdminCookie } from "../../../../lib/admin-access";
import { json } from "../../_shared";

export async function POST() {
  const response = json({ isAdmin: false });
  response.headers.set("Set-Cookie", clearAdminCookie());
  return response;
}
