import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AdGuard Agent｜广告宣传材料合规检查助手",
  description: "发布前的广告宣传材料智能预审工具",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
