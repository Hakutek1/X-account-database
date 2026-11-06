import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formatSiteVersion, parseSiteSourceCommit, parseSiteVersion } from "../lib/site-version.ts";

test("Sites deployment numbers map to the matching footer label", () => {
  assert.equal(parseSiteVersion("104"), 104);
  assert.equal(formatSiteVersion(104), "Ver.1.04");
  assert.equal(formatSiteVersion(105), "Ver.1.05");
});

test("the version endpoint formats the current Sites runtime setting", () => {
  const route = readFileSync(new URL("../app/api/site-version/route.ts", import.meta.url), "utf8");
  assert.match(route, /SITE_VERSION_NUMBER/);
  assert.match(route, /formatSiteVersion\(version\)/);
  assert.match(route, /Cache-Control/);
});

test("source commit is exposed only when it is a full Git commit SHA", () => {
  const commit = "0123456789abcdef0123456789abcdef01234567";
  assert.equal(parseSiteSourceCommit(commit), commit);
  assert.equal(parseSiteSourceCommit(commit.toUpperCase()), commit);
  assert.equal(parseSiteSourceCommit("8f57c89"), null);
  assert.equal(parseSiteSourceCommit(undefined), null);

  const route = readFileSync(new URL("../app/api/site-version/route.ts", import.meta.url), "utf8");
  assert.match(route, /SITE_SOURCE_COMMIT/);
  assert.match(route, /sourceCommit/);
});
