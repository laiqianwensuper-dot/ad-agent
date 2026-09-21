"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ReviewResultView } from "@/components/review-result";
import { loadAsset } from "@/lib/asset-store";
import { loadStoredTasks, type StoredReviewTask } from "@/lib/review-task-store";

function DetailSidebar() {
  const router = useRouter();
  return <aside className="border-b border-[var(--border)] bg-[var(--sidebar-bg)] px-4 py-5 lg:min-h-screen lg:border-b-0 lg:border-r lg:px-3">
    <div className="px-2"><p className="text-xs font-semibold tracking-[.14em] text-[var(--accent)]">ADGUARD</p><p className="mt-1 text-lg font-semibold text-[var(--text-primary)]">广告审核工作台</p></div>
    <nav className="mt-6 flex gap-1 overflow-x-auto lg:block lg:space-y-1">
      <button type="button" onClick={() => router.push("/")} className="min-w-max rounded-md bg-[var(--active-bg)] px-3 py-2.5 text-left text-sm font-semibold text-[var(--primary)] lg:block lg:w-full">审核任务</button>
      <button type="button" onClick={() => router.push("/?page=new")} className="min-w-max rounded-md px-3 py-2.5 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] lg:block lg:w-full">新建审核</button>
      <button type="button" onClick={() => router.push("/?page=batch")} className="min-w-max rounded-md px-3 py-2.5 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] lg:block lg:w-full">批量审核</button>
      <button type="button" onClick={() => router.push("/?page=human")} className="min-w-max rounded-md px-3 py-2.5 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] lg:block lg:w-full">待人工复核</button>
    </nav>
  </aside>;
}

export function TaskDetail({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [task, setTask] = useState<StoredReviewTask | null | undefined>(undefined);
  const [images, setImages] = useState<{ url: string; name: string }[]>([]);

  useEffect(() => {
    const found = loadStoredTasks().find((item) => item.id === taskId) ?? null;
    queueMicrotask(() => setTask(found));
    if (!found?.assets?.length) return undefined;
    let active = true;
    const urls: string[] = [];
    void Promise.all([...found.assets].sort((a, b) => a.order - b.order).map(async (asset) => {
      const blob = await loadAsset(asset.assetId);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      urls.push(url);
      return { url, name: asset.displayName };
    })).then((assets) => { if (active) setImages(assets.filter((item): item is { url: string; name: string } => Boolean(item))); });
    return () => { active = false; urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [taskId]);

  return <main className="min-h-screen bg-[var(--bg)] text-[var(--text-primary)] lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
    <DetailSidebar />
    <div className="min-w-0"><header className="flex min-h-16 items-center justify-between border-b border-[var(--border)] bg-white px-5 sm:px-7"><div><p className="text-sm font-semibold">审核任务</p><p className="mt-0.5 text-xs text-[var(--text-tertiary)]">{task?.name ?? "审核报告"}</p></div><button type="button" onClick={() => router.push("/?page=new")} className="rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-hover)]">新建审核</button></header>
      <div className="p-5 sm:p-7">
        {task === undefined && <p className="text-sm text-[var(--text-secondary)]">正在读取审核任务…</p>}
        {task === null && <section className="rounded-lg border border-[var(--border)] bg-white p-8"><p className="text-sm text-[var(--text-primary)]">未找到此浏览器中的审核任务。</p><button className="mt-4 text-sm font-medium text-[var(--primary)]" onClick={() => router.push("/")}>返回审核任务</button></section>}
        {task && <ReviewResultView review={task.review} images={images} onBackToTasks={() => router.push("/")} />}
      </div>
    </div>
  </main>;
}
