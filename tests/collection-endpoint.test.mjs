import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("data collection uses the non-analytics endpoint while preserving the protected legacy route", () => {
  const page = read("../app/page.tsx");
  const currentRoute = read("../app/api/update-stats/route.ts");
  const legacyRoute = read("../app/api/collect/route.ts");

  assert.match(page, /\/api\/update-stats/);
  assert.doesNotMatch(page, /\/api\/collect/);
  assert.match(currentRoute, /export \{ POST \} from "\.\.\/collect\/route"/);
  assert.match(legacyRoute, /requireAdmin\(request\)/);
  assert.match(legacyRoute, /collectForSession\(/);
});
