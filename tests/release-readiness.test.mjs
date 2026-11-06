import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("license and release docs state the noncommercial attribution terms", async () => {
  const [license, readme] = await Promise.all([read("../LICENSE"), read("../README.md")]);
  assert.match(license, /PolyForm Noncommercial License 1\.0\.0/);
  assert.match(license, /^Required Notice: Copyright \(c\) 2026 Ko0rimizu$/m);
  assert.match(license, /https:\/\/polyformproject\.org\/licenses\/noncommercial\/1\.0\.0/);
  assert.match(readme, /非商用/);
  assert.match(readme, /OSI認定/);
  assert.match(readme, /Required Notice/);
  assert.match(readme, /\.dev\.vars\.example/);
  assert.doesNotMatch(readme, /\.env\.example/);
});

test("setup examples are tracked while per-installation configuration stays ignored", async () => {
  const [ignore, envExample, wranglerExample, packageText, lockText] = await Promise.all([
    read("../.gitignore"),
    read("../.dev.vars.example"),
    read("../wrangler.jsonc.example"),
    read("../package.json"),
    read("../package-lock.json"),
  ]);
  assert.match(ignore, /^\.dev\.vars\*$/m);
  assert.match(ignore, /^!\.dev\.vars\.example$/m);
  assert.match(ignore, /^\/wrangler\.jsonc$/m);
  assert.match(ignore, /^\/\.openai\/$/m);
  assert.doesNotMatch(envExample, /owner@example|client-secret-value|real-token/i);
  assert.equal(JSON.parse(wranglerExample).d1_databases[0].binding, "DB");
  assert.equal(JSON.parse(wranglerExample).d1_databases[0].migrations_dir, "./drizzle");
  assert.equal(JSON.parse(wranglerExample).images.binding, "IMAGES");
  assert.equal(JSON.parse(packageText).name, "x-account-database");
  assert.equal(JSON.parse(lockText).name, "x-account-database");
  assert.match(packageText, /"deploy": "npm run build && wrangler deploy"/);
});

test("README explains shared D1 data and access modes for both hosting paths", async () => {
  const [readme, workersGuide, sitesGuide] = await Promise.all([
    read("../README.md"),
    read("../docs/cloudflare-workers.md"),
    read("../docs/site-release.md"),
  ]);
  assert.match(readme, /同じ登録アカウントと履歴を参照/);
  assert.match(readme, /XSTATS_READ_MODE=public/);
  assert.match(readme, /OneDrive連携中はExcelファイル一覧/);
  assert.match(readme, /Cloudflare Workers＋D1/);
  assert.match(readme, /Codex Sites＋D1/);
  assert.match(workersGuide, /d1 migrations apply DB --remote/);
  assert.match(workersGuide, /wrangler secret put XSTATS_ADMIN_KEY/);
  assert.match(sitesGuide, /SITE_SOURCE_COMMIT/);
  assert.match(sitesGuide, /空のD1/);
});

test("the standalone Worker example uses only a neutral D1 placeholder", async () => {
  const config = JSON.parse(await read("../wrangler.jsonc.example"));
  assert.equal(config.name, "x-account-database");
  assert.equal(config.d1_databases[0].database_id, "00000000-0000-4000-8000-000000000001");
  assert.equal(config.vars.XSTATS_READ_MODE, "private");
});
