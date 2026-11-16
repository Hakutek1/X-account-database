"use client";

export default function PreviewBanner() {
  if (import.meta.env.MODE !== "vercel-preview") return null;

  return (
    <aside
      role="status"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 1000,
        padding: "0.55rem 1rem",
        borderBottom: "1px solid #57b8b2",
        background: "#102d3b",
        color: "#e9f6f5",
        fontSize: "0.9rem",
        textAlign: "center",
      }}
    >
      Vercel確認用プレビュー：合成データを表示中。データ取得・保存・削除は無効です。
    </aside>
  );
}
