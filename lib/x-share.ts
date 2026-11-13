export type ImageShareAction = "save" | "x";

export function buildXPostText(siteUrl: string) {
  const siteOrigin = new URL(siteUrl).origin;
  return `#複垢データベース\n${siteOrigin}/`;
}

export function buildXPostIntentUrl(siteUrl: string) {
  const intent = new URL("https://x.com/intent/post");
  intent.searchParams.set("text", buildXPostText(siteUrl));
  return intent.toString();
}

export function canOpenXPostComposer(action: ImageShareAction, downloadSucceeded: boolean) {
  return action === "x" && downloadSucceeded;
}

export type XPostComposerOutcome = "navigate" | "fallback" | "none";

export function resolveXPostComposerOutcome(
  action: ImageShareAction,
  downloadSucceeded: boolean,
  reservedTabAvailable: boolean,
): XPostComposerOutcome {
  if (!canOpenXPostComposer(action, downloadSucceeded)) return "none";
  return reservedTabAvailable ? "navigate" : "fallback";
}
