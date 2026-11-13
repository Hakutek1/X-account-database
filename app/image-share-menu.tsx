"use client";

import { useEffect, useRef, useState } from "react";
import { buildXPostIntentUrl, resolveXPostComposerOutcome, type ImageShareAction } from "../lib/x-share";

type ImageShareMenuProps = {
  buttonClassName: string;
  containerClassName?: string;
  disabled?: boolean;
  onDownload: () => Promise<boolean>;
};

export default function ImageShareMenu({ buttonClassName, containerClassName = "", disabled = false, onDownload }: ImageShareMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [showXFallback, setShowXFallback] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [intentUrl, setIntentUrl] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const handleAction = async (action: ImageShareAction) => {
    setMenuOpen(false);
    setShowXFallback(false);
    setFeedback("");
    setPreparing(true);

    let reservedXWindow: Window | null = null;
    if (action === "x") {
      try {
        // Reserve a tab while the X menu click still has browser user activation.
        reservedXWindow = window.open("about:blank", "_blank");
        if (reservedXWindow) {
          reservedXWindow.document.title = "画像を準備しています";
          reservedXWindow.document.body.textContent = "画像を準備しています。ダウンロード開始後にX投稿画面を開きます。";
        }
      } catch {
        try { reservedXWindow?.close(); } catch {}
        reservedXWindow = null;
      }
      setFeedback("画像を準備しています…");
    }

    let downloadSucceeded = false;
    try {
      downloadSucceeded = await onDownload();
    } catch {
      downloadSucceeded = false;
    } finally {
      setPreparing(false);
    }

    const outcome = resolveXPostComposerOutcome(
      action,
      downloadSucceeded,
      Boolean(reservedXWindow && !reservedXWindow.closed),
    );
    if (outcome === "navigate" && reservedXWindow) {
      const nextIntentUrl = buildXPostIntentUrl(window.location.origin);
      try {
        reservedXWindow.opener = null;
        reservedXWindow.location.replace(nextIntentUrl);
        setFeedback("画像のダウンロードを開始し、Xの投稿画面を別タブで開きました。画像は添付されていません。");
      } catch {
        try { reservedXWindow.close(); } catch {}
        setIntentUrl(nextIntentUrl);
        setShowXFallback(true);
        setFeedback("画像のダウンロードを開始しました。Xを自動で開けなかったため、下のボタンから開いてください。画像は添付されません。");
      }
      return;
    }

    if (reservedXWindow && !reservedXWindow.closed) {
      try { reservedXWindow.close(); } catch {}
    }

    if (outcome === "fallback") {
      setIntentUrl(buildXPostIntentUrl(window.location.origin));
      setShowXFallback(true);
      setFeedback("画像のダウンロードを開始しました。ポップアップがブロックされたため、下のボタンからX投稿画面を開いてください。画像は添付されません。");
    } else if (!downloadSucceeded) {
      setFeedback("画像を作成できませんでした。条件を確認して、もう一度お試しください。");
    }
  };

  return (
    <div className={`image-share-menu ${containerClassName}`} ref={rootRef}>
      <button
        type="button"
        className={`${buttonClassName} image-share-trigger`}
        onClick={() => setMenuOpen((open) => !open)}
        aria-expanded={menuOpen}
        aria-haspopup="true"
        disabled={disabled || preparing}
      >
        画像を共有 <span aria-hidden="true">▾</span>
      </button>
      {menuOpen && <div className="image-share-popover">
        <button type="button" className="image-share-option" onClick={() => void handleAction("x")} disabled={disabled || preparing}>
          Xに投稿
        </button>
        <button type="button" className="image-share-option" onClick={() => void handleAction("save")} disabled={disabled || preparing}>
          画像を保存
        </button>
      </div>}
      {feedback && <div className="image-share-feedback" role="status" aria-live="polite">
        <span>{feedback}</span>
        {showXFallback && intentUrl && <a className="image-share-open-x" href={intentUrl} target="_blank" rel="noopener noreferrer">
          X投稿画面を開く
        </a>}
      </div>}
    </div>
  );
}
