import type { Metadata } from "next";
import "./globals.css";
import PreviewBanner from "./preview-banner";

export const metadata: Metadata = {
  title: "複垢データベース | 複数アカウントの数字を追跡",
  description: "fxTwitterでXアカウントのフォロワー数、フォロー数、投稿数、開設日を取得して比較・記録するダッシュボード。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body><PreviewBanner />{children}</body></html>;
}
