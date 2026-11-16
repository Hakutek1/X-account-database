import { spawnSync } from "node:child_process";

if (process.env.VERCEL_ENV !== "preview") {
  console.error("This Vercel project is preview-only. Production deployments must continue to use Cloudflare Sites.");
  process.exit(1);
}

const viteBin = process.platform === "win32" ? "node_modules/.bin/vite.cmd" : "node_modules/.bin/vite";
const result = spawnSync(viteBin, ["build", "--config", "vite.vercel.config.ts", "--mode", "vercel-preview"], {
  stdio: "inherit",
  env: { ...process.env, NITRO_PRESET: "vercel" },
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
