import { env } from "cloudflare:workers";
import { formatSiteVersion, parseSiteSourceCommit, parseSiteVersion } from "../../../lib/site-version";

export async function GET() {
  const runtime = env as unknown as Record<string, unknown>;
  const version = parseSiteVersion(runtime.SITE_VERSION_NUMBER);
  const sourceCommit = parseSiteSourceCommit(runtime.SITE_SOURCE_COMMIT);
  return new Response(JSON.stringify({ version, label: formatSiteVersion(version), sourceCommit }), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
