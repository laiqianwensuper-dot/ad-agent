"use client";

export default function GlobalSegmentError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="error-page">
      <p className="eyebrow">AdGuard Agent</p>
      <h1>页面暂时无法打开</h1>
      <p>请刷新页面或稍后重试。</p>
      <button type="button" onClick={reset}>重新加载</button>
    </main>
  );
}
