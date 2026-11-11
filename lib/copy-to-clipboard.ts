type ClipboardEnvironment = {
  clipboard?: Pick<Clipboard, "writeText"> | null;
  document?: (Pick<Document, "createElement" | "execCommand"> & Pick<Document, "body">) | null;
};

export async function copyTextToClipboard(text: string, environment: ClipboardEnvironment = {}) {
  const clipboard = Object.prototype.hasOwnProperty.call(environment, "clipboard")
    ? environment.clipboard
    : typeof navigator !== "undefined" ? navigator.clipboard : undefined;

  if (clipboard && typeof clipboard.writeText === "function") {
    try {
      await clipboard.writeText(text);
      return;
    } catch {
      // Some embedded browsers deny clipboard permission; try the selection-based fallback.
    }
  }

  const currentDocument = Object.prototype.hasOwnProperty.call(environment, "document")
    ? environment.document
    : typeof document !== "undefined" ? document : undefined;
  if (!currentDocument || typeof currentDocument.execCommand !== "function") {
    throw new Error("このブラウザーではクリップボードを利用できません。");
  }

  const textarea = currentDocument.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "0";
  textarea.style.top = "0";
  textarea.style.opacity = "0";
  currentDocument.body.appendChild(textarea);
  textarea.select();
  try {
    if (!currentDocument.execCommand("copy")) {
      throw new Error("クリップボードへコピーできませんでした。");
    }
  } finally {
    textarea.remove();
  }
}
