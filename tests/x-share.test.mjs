import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildXPostIntentUrl, buildXPostText, canOpenXPostComposer, resolveXPostComposerOutcome } from "../lib/x-share.ts";

test("X post text contains the product hashtag and the current site root URL", () => {
  assert.equal(buildXPostText("https://stats.example.test/results?date=2026-11-13"), "#複垢データベース\nhttps://stats.example.test/");
});

test("X intent opens a composer with editable prefilled text", () => {
  const intent = new URL(buildXPostIntentUrl("https://stats.example.test/"));
  assert.equal(intent.origin, "https://x.com");
  assert.equal(intent.pathname, "/intent/post");
  assert.equal(intent.searchParams.get("text"), "#複垢データベース\nhttps://stats.example.test/");
});

test("the X composer is offered only after a successful X image download", () => {
  assert.equal(canOpenXPostComposer("x", true), true);
  assert.equal(canOpenXPostComposer("x", false), false);
  assert.equal(canOpenXPostComposer("save", true), false);
});

test("X composer auto-navigation waits for a successful X download and a reserved tab", () => {
  assert.equal(resolveXPostComposerOutcome("x", true, true), "navigate");
  assert.equal(resolveXPostComposerOutcome("x", true, false), "fallback");
  assert.equal(resolveXPostComposerOutcome("x", false, true), "none");
  assert.equal(resolveXPostComposerOutcome("save", true, true), "none");
});

test("both ranking and graph exports use the shared image menu", async () => {
  const [page, menu] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/image-share-menu.tsx", import.meta.url), "utf8"),
  ]);
  assert.equal((page.match(/<ImageShareMenu/g) ?? []).length, 2);
  assert.match(menu, /Xに投稿/);
  assert.match(menu, /画像を保存/);
  assert.match(menu, /X投稿画面を開く/);
  assert.match(menu, /window\.open\("about:blank", "_blank"\)/);
  assert.ok(menu.indexOf('window.open("about:blank", "_blank")') < menu.indexOf("await onDownload()"));
  assert.match(menu, /reservedXWindow\.location\.replace\(nextIntentUrl\)/);
  assert.match(menu, /reservedXWindow\.opener = null/);
  assert.match(menu, /ポップアップがブロックされたため/);
  assert.match(menu, /画像のダウンロードを開始し、Xの投稿画面を別タブで開きました。/);
  assert.match(menu, /target="_blank"/);
  assert.match(menu, /resolveXPostComposerOutcome\(\s*action,\s*downloadSucceeded,/);
  assert.doesNotMatch(menu, /完了後に下のボタンを押してください/);
});
