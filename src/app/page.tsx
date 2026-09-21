import { ReviewWorkspace } from "@/components/review-workspace";
import { Suspense } from "react";

export default function HomePage() {
  return <Suspense fallback={<main className="min-h-screen bg-[var(--bg)] p-6 text-sm text-[var(--text-secondary)]">正在加载审核工作台…</main>}><ReviewWorkspace /></Suspense>;
}
