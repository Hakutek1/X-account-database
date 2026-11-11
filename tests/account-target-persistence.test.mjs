import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  ACCOUNT_TARGETS_STORAGE_KEY,
  clearCachedDashboardAccountData,
  loadPersistedAccountTargets,
  savePersistedAccountTargets,
} from "../lib/account-target-persistence.ts";
import { copyTextToClipboard } from "../lib/copy-to-clipboard.ts";

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

function createDocument(copyResult) {
  const textarea = {
    value: "",
    style: {},
    attributes: {},
    selected: false,
    removed: false,
    setAttribute(name, value) { this.attributes[name] = value; },
    select() { this.selected = true; },
    remove() { this.removed = true; },
  };
  const document = {
    body: { appended: null, appendChild(node) { this.appended = node; } },
    createElement(tag) {
      assert.equal(tag, "textarea");
      return textarea;
    },
    execCommand(command) {
      assert.equal(command, "copy");
      return copyResult;
    },
  };
  return { document, textarea };
}

test("legacy combined dashboard setting is migrated to a dedicated handle list", () => {
  const storage = new MemoryStorage();
  storage.setItem("dashboard", JSON.stringify({ accountInput: "@alpha\nhttps://x.com/Beta", rows: [{ id: "cached" }] }));

  assert.deepEqual(loadPersistedAccountTargets(storage, "dashboard"), ["alpha", "Beta"]);
  assert.deepEqual(JSON.parse(storage.getItem(ACCOUNT_TARGETS_STORAGE_KEY)), ["alpha", "Beta"]);
});

test("account targets survive clearing cached statistics on admin logout", () => {
  const storage = new MemoryStorage();
  storage.setItem("dashboard", JSON.stringify({ accountInput: "@alpha\n@beta", rows: [{ id: "cached" }], selectedHandles: ["alpha"], theme: "dark" }));
  const targets = loadPersistedAccountTargets(storage, "dashboard");
  savePersistedAccountTargets(storage, targets);
  clearCachedDashboardAccountData(storage, "dashboard");

  assert.deepEqual(loadPersistedAccountTargets(storage, "dashboard"), ["alpha", "beta"]);
  assert.deepEqual(JSON.parse(storage.getItem("dashboard")), { theme: "dark" });
});

test("saving an empty target list is preserved as empty", () => {
  const storage = new MemoryStorage();
  savePersistedAccountTargets(storage, []);
  assert.deepEqual(loadPersistedAccountTargets(storage, "dashboard"), []);
});

test("clipboard helper uses the browser Clipboard API when it succeeds", async () => {
  let copied = "";
  const { document } = createDocument(false);
  await copyTextToClipboard("@alpha\n@beta", {
    clipboard: { writeText: async (value) => { copied = value; } },
    document,
  });
  assert.equal(copied, "@alpha\n@beta");
  assert.equal(document.body.appended, null);
});

test("clipboard helper falls back to a selected textarea when permission is denied", async () => {
  const { document, textarea } = createDocument(true);
  await copyTextToClipboard("@alpha\n@beta", {
    clipboard: { writeText: async () => { throw new Error("permission denied"); } },
    document,
  });

  assert.equal(document.body.appended, textarea);
  assert.equal(textarea.value, "@alpha\n@beta");
  assert.equal(textarea.selected, true);
  assert.equal(textarea.removed, true);
});

test("clipboard helper reports failure when the fallback cannot copy", async () => {
  const { document, textarea } = createDocument(false);
  await assert.rejects(
    copyTextToClipboard("@alpha", { clipboard: null, document }),
    /コピーできませんでした/,
  );
  assert.equal(textarea.removed, true);
});

test("dashboard wires target storage to login/logout and uses the clipboard fallback helper", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /loadPersistedAccountTargets\(window\.localStorage, DASHBOARD_STORAGE_KEY\)/);
  assert.ok(page.includes('setAccountInput(loadPersistedAccountTargets(window.localStorage, DASHBOARD_STORAGE_KEY).join("\\n"));'));
  assert.ok(page.includes("setIsAdmin(true);"));
  assert.match(page, /savePersistedAccountTargets\(window\.localStorage/);
  assert.match(page, /clearCachedDashboardAccountData\(window\.localStorage, DASHBOARD_STORAGE_KEY\)/);
  assert.match(page, /copyTextToClipboard\(formatHandleTargetsForClipboard\(accountTargetHandles\)\)/);
  assert.doesNotMatch(page, /navigator\.clipboard\.writeText/);
});
