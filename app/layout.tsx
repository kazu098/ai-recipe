import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Snapmeal",
  description: "冷蔵庫を撮るだけ。30秒で今夜の夕食が決まる。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="bg-surface min-h-screen">{children}</body>
    </html>
  );
}
