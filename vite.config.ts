import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import vinext from "vinext";
import { defineConfig } from "vite";
import { sites } from "./build/sites-vite-plugin";

const LOCAL_D1_PLACEHOLDER_ID = "00000000-0000-4000-8000-000000000001";
const WRANGLER_CONFIG_FILES = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"];

function loadSitesHostingConfig(): { d1?: string; r2?: string } | null {
  try {
    return JSON.parse(readFileSync(resolve(process.cwd(), ".openai/hosting.json"), "utf8")) as {
      d1?: string;
      r2?: string;
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return null;
  }
}

function hasWranglerConfig() {
  return WRANGLER_CONFIG_FILES.some((file) => existsSync(resolve(process.cwd(), file)));
}

function sitesBindingConfig(hosting: { d1?: string; r2?: string }) {
  return {
    main: "./worker/index.ts",
    compatibility_flags: ["nodejs_compat"],
    d1_databases: hosting.d1
      ? [
          {
            binding: hosting.d1,
            database_name: "site-creator-d1",
            database_id: LOCAL_D1_PLACEHOLDER_ID,
            migrations_dir: "./drizzle",
          },
        ]
      : [],
    r2_buckets: hosting.r2
      ? [
          {
            binding: hosting.r2,
            bucket_name: "site-creator-r2",
          },
        ]
      : [],
  };
}

const sitesHostingConfig = loadSitesHostingConfig();
const hasUserWranglerConfig = hasWranglerConfig();
const localFallbackConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: [
    {
      binding: "DB",
      database_name: "x-account-database-local",
      database_id: LOCAL_D1_PLACEHOLDER_ID,
      migrations_dir: "./drizzle",
    },
  ],
};

// Use per-Site metadata in Sites builds. For normal Workers deployments, let
// the Cloudflare Vite plugin read the user's Wrangler file without overriding
// its D1 ID. The placeholder is only for bare local builds and tests.
const cloudflareConfig = sitesHostingConfig
  ? { config: sitesBindingConfig(sitesHostingConfig) }
  : hasUserWranglerConfig
    ? {}
    : { config: localFallbackConfig };

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. Application environment
  // values belong in ignored `.dev.vars` or `.env` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        ...cloudflareConfig,
      }),
    ],
  };
});
