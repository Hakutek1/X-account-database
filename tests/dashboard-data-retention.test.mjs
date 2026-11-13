import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("dashboard startup never deletes legacy browser Excel data", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /indexedDB\??\.deleteDatabase/);
  assert.doesNotMatch(page, /deleteDatabase\s*\(/);
});
