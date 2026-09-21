"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AssetDropzone, type UploadAsset } from "@/components/asset-dropzone";
import { ReviewResultView } from "@/components/review-result";
import { saveAsset } from "@/lib/asset-store";
import { createStoredTask, loadStoredTasks, saveStoredTasks, type ReviewPresentation, type ReviewTaskKind, type StoredReviewTask } from "@/lib/review-task-store";

type Page = "tasks" | "new" | "batch" | "human" | "review";
type QueueItem = UploadAsset & { state: "waiting" | "reviewing" | "done" | "failed"; result?: ReviewPresentation; task?: StoredReviewTask; error?: string };

const navigation: { id: Exclude<Page, "review">; label: string }[] = [
  { id: "tasks", label: "审核任务" },
  { id: "new", label: "新建审核" },
  { id: "batch", label: "批量审核" },
  { id: "human", label: "待人工复核" },
];

async function requestReview(text: string, images: File[] = []): Promise<ReviewPresentation> {
  const body = new FormData();
  if (text.trim()) body.set("text", text.trim());
  images.forEach((image) => body.append("images", image));
  const response = await fetch("/api/review", { method: "POST", body });
  const payload = await response.json();
  if (!response.ok || !payload.presentation?.review?.ok) throw new Error(payload.error?.message ?? "审核失败，请稍后重试。");
  return { ...payload.presentation.review, canonical: payload.presentation.canonical } as ReviewPresentation;
}

function taskKind(text: string, assets: UploadAsset[]): ReviewTaskKind {
  return text.trim() && assets.length ? "TEXT_AND_IMAGE" : assets.length ? "IMAGE" : "TEXT";
}

function taskKindLabel(kind: ReviewTaskKind) { return kind === "TEXT" ? "文案" : kind === "IMAGE" ? "图片" : "文案 + 图片"; }
function statusLabel(review: ReviewPresentation) { return review.overallStatus === "RISK" ? "建议修改" : review.overallStatus === "PASS" ? "未发现明确风险" : "待补充材料"; }
function issueCount(review: ReviewPresentation) { return new Set(review.ruleResults.filter((item) => item.status === "RISK").flatMap((item) => item.evidence)).size; }
function dateLabel(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }

export function ReviewWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [page, setPage] = useState<Page>("tasks");
  const [tasks, setTasks] = useState<StoredReviewTask[]>([]);
  const [taskName, setTaskName] = useState("");
  const [copy, setCopy] = useState("");
  const [singleAssets, setSingleAssets] = useState<UploadAsset[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isReviewing, setIsReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<StoredReviewTask | null>(null);
  const [sessionImages, setSessionImages] = useState<{ url: string; name: string }[]>([]);

  useEffect(() => { setTasks(loadStoredTasks()); }, []);
  useEffect(() => {
    const requested = searchParams.get("page");
    if (requested === "new" || requested === "batch" || requested === "human") setPage(requested);
    else setPage("tasks");
  }, [searchParams]);
  useEffect(() => () => sessionImages.forEach((image) => URL.revokeObjectURL(image.url)), [sessionImages]);

  const pendingHuman = useMemo(() => tasks.filter((task) => task.humanReviewState === "PENDING"), [tasks]);
  const canReview = Boolean(copy.trim() || singleAssets.length);

  function go(next: Exclude<Page, "review">) {
    setError(null);
    setActiveTask(null);
    setPage(next);
    router.replace(next === "tasks" ? "/" : `/?page=${next}`);
  }

  function updateTasks(updater: (current: StoredReviewTask[]) => StoredReviewTask[]) {
    setTasks((current) => {
      const next = updater(current);
      saveStoredTasks(next);
      return next;
    });
  }

  async function persistAssets(assets: UploadAsset[]) {
    const stored = await Promise.all(assets.map(async (asset, order) => {
      const assetId = crypto.randomUUID();
      try {
        await saveAsset(assetId, asset.file);
        return { assetId, originalFileName: asset.originalFileName, displayName: asset.displayName.trim() || asset.originalFileName, order };
      } catch { return null; }
    }));
    return stored.filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));
  }

  function recordTask(input: Parameters<typeof createStoredTask>[0]) {
    const stored = createStoredTask(input);
    updateTasks((current) => [stored, ...current]);
    return stored;
  }

  function showTask(task: StoredReviewTask, assets: UploadAsset[] = [], sessionOnly = false) {
    if (!sessionOnly) { router.push(`/tasks/${task.id}`); return; }
    setActiveTask(task);
    setSessionImages(assets.map((asset) => ({ url: URL.createObjectURL(asset.file), name: asset.displayName })));
    setPage("review");
  }

  async function submitSingle() {
    if (!canReview || isReviewing) return;
    setError(null); setIsReviewing(true);
    try {
      const review = await requestReview(copy, singleAssets.map((asset) => asset.file));
      const assets = await persistAssets(singleAssets);
      const task = recordTask({
        name: taskName.trim() || singleAssets[0]?.displayName.trim() || "未命名审核",
        kind: taskKind(copy, singleAssets),
        materialCount: Math.max(1, singleAssets.length),
        materialLabel: singleAssets.length ? singleAssets.map((asset) => asset.displayName.trim() || asset.originalFileName).join("、") : "广告文案",
        assets,
        review,
      });
      showTask(task, singleAssets, assets.length !== singleAssets.length);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "审核失败，请稍后重试。"); }
    finally { setIsReviewing(false); }
  }

  async function submitBatch() {
    if (!queue.length || queue.some((item) => item.state === "reviewing")) return;
    setError(null);
    const pending = queue.map((_, index) => index);
    const worker = async () => {
      while (pending.length) {
        const index = pending.shift(); if (index === undefined) return;
        const item = queue[index];
        setQueue((current) => current.map((entry, row) => row === index ? { ...entry, state: "reviewing" } : entry));
        try {
          const review = await requestReview("", [item.file]);
          const assets = await persistAssets([item]);
          const task = recordTask({ name: item.displayName.trim() || item.originalFileName, kind: "IMAGE", materialCount: 1, materialLabel: item.originalFileName, assets, review });
          setQueue((current) => current.map((entry, row) => row === index ? { ...entry, state: "done", task, result: review } : entry));
        } catch (caught) {
          setQueue((current) => current.map((entry, row) => row === index ? { ...entry, state: "failed", error: caught instanceof Error ? caught.message : "审核失败" } : entry));
        }
      }
    };
    await Promise.all([worker(), worker()]);
  }

  function setBatchAssets(nextAssets: UploadAsset[]) {
    setQueue((current) => nextAssets.map((asset) => {
      const before = current.find((item) => item.id === asset.id);
      return before ? { ...before, ...asset } : { ...asset, state: "waiting" };
    }));
  }

  function markHumanResolved(task: StoredReviewTask) {
    updateTasks((current) => current.map((item) => item.id === task.id ? { ...item, humanReviewState: "RESOLVED", updatedAt: new Date().toISOString() } : item));
  }

  return <main className="min-h-screen bg-[var(--bg)] text-[var(--text-primary)] lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
    <aside className="border-b border-[var(--border)] bg-[var(--sidebar-bg)] px-4 py-5 lg:min-h-screen lg:border-b-0 lg:border-r lg:px-3"><div className="px-2"><p className="text-xs font-semibold tracking-[.14em] text-[var(--accent)]">ADGUARD</p><h1 className="mt-1 text-lg font-semibold">广告审核工作台</h1></div><nav className="mt-6 flex gap-1 overflow-x-auto lg:block lg:space-y-1">{navigation.map((item) => <button key={item.id} type="button" onClick={() => go(item.id)} className={`min-w-max rounded-md px-3 py-2.5 text-left text-sm transition lg:block lg:w-full ${page === item.id ? "bg-[var(--active-bg)] font-semibold text-[var(--primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"}`}>{item.label}{item.id === "human" && pendingHuman.length > 0 && <span className="ml-2 rounded-full bg-[#e8f0ff] px-1.5 py-0.5 text-xs text-[var(--primary)]">{pendingHuman.length}</span>}</button>)}</nav></aside>
    <div className="min-w-0"><header className="flex min-h-16 items-center justify-between border-b border-[var(--border)] bg-white px-5 sm:px-7"><p className="text-sm font-semibold">{page === "review" ? activeTask?.name : navigation.find((item) => item.id === page)?.label}</p>{page !== "new" && <button type="button" onClick={() => go("new")} className="rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-hover)]">新建审核</button>}</header>
      <div className="mx-auto max-w-[1500px] p-5 sm:p-7">
        {page === "tasks" && <TaskTable tasks={tasks} onOpen={(task) => showTask(task)} onCreate={() => go("new")} />}
        {page === "new" && <section className="rounded-lg border border-[var(--border)] bg-white"><div className="border-b border-[var(--border)] px-5 py-5 sm:px-6"><h2 className="text-lg font-semibold">新建审核</h2><p className="mt-1 text-sm text-[var(--text-secondary)]">一段文案和多张配图会作为同一审核单元整体理解。</p></div><div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(340px,.8fr)] sm:p-6"><div><label className="text-sm font-semibold" htmlFor="task-name">任务名称 <span className="font-normal text-[var(--text-tertiary)]">（可选）</span></label><input id="task-name" value={taskName} onChange={(event) => setTaskName(event.target.value)} placeholder="例如：会员日朋友圈" className="mt-2 w-full rounded-md border border-[var(--border)] px-3 py-2.5 text-sm outline-none focus:border-[var(--primary)] focus:ring-4 focus:ring-[#e8f0ff]" /><label className="mt-5 block text-sm font-semibold" htmlFor="ad-copy">广告文案 <span className="font-normal text-[var(--text-tertiary)]">（可选）</span></label><textarea id="ad-copy" value={copy} onChange={(event) => setCopy(event.target.value)} placeholder="输入朋友圈文案、活动说明等" className="mt-2 min-h-64 w-full resize-y rounded-md border border-[var(--border)] bg-[#fbfcfe] p-4 text-sm leading-7 outline-none focus:border-[var(--primary)] focus:ring-4 focus:ring-[#e8f0ff]" /></div><AssetDropzone assets={singleAssets} onChange={setSingleAssets} maxFiles={5} title="配套图片（可选，最多 5 张）" emptyLabel="拖入广告图片，或点击选择" description="PNG、JPG、WEBP；上传后可重命名和拖拽排序" /></div>{error && <p className="mx-5 rounded-md bg-[#fff1f0] px-4 py-3 text-sm text-[var(--danger)] sm:mx-6">{error}</p>}<div className="mt-6 flex justify-end border-t border-[var(--border)] px-5 py-4 sm:px-6"><button type="button" disabled={!canReview || isReviewing} onClick={() => void submitSingle()} className="rounded-md bg-[var(--primary)] px-5 py-3 text-sm font-semibold text-white hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:bg-[#aebedc]">{isReviewing ? "正在审核…" : "开始审核"}</button></div></section>}
        {page === "batch" && <BatchReview queue={queue} error={error} onChange={setBatchAssets} onSubmit={() => void submitBatch()} onOpen={(task) => showTask(task)} />}
        {page === "human" && <HumanReviewList tasks={pendingHuman} onOpen={(task) => showTask(task)} onResolve={markHumanResolved} onCreate={() => go("new")} />}
        {page === "review" && activeTask && <ReviewResultView review={activeTask.review} images={sessionImages} onBackToTasks={() => go("tasks")} />}
      </div>
    </div>
  </main>;
}

function StatusPill({ review }: { review: ReviewPresentation }) {
  const style = review.overallStatus === "RISK" ? "bg-[#fff0ed] text-[#b83b34]" : review.overallStatus === "PASS" ? "bg-[#ecf8ef] text-[#237a4d]" : "bg-[#fff7e6] text-[#a55f00]";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${style}`}>{statusLabel(review)}</span>;
}

function TaskTable({ tasks, onOpen, onCreate }: { tasks: StoredReviewTask[]; onOpen: (task: StoredReviewTask) => void; onCreate: () => void }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"ALL" | "RISK" | "PASS" | "UNCERTAIN">("ALL");
  const filtered = tasks.filter((task) => (status === "ALL" || task.review.overallStatus === status) && `${task.name} ${task.materialLabel}`.toLowerCase().includes(query.toLowerCase()));
  if (!tasks.length) return <section className="rounded-lg border border-[var(--border)] bg-white p-10 text-center"><p className="text-sm font-semibold">还没有审核任务</p><button type="button" onClick={onCreate} className="mt-5 rounded-md bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white">新建审核</button></section>;
  return <section className="rounded-lg border border-[var(--border)] bg-white"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4 sm:px-6"><h2 className="text-lg font-semibold">审核任务</h2><span className="text-sm text-[var(--text-secondary)]">{filtered.length} 项</span></div><div className="flex flex-wrap gap-3 border-b border-[var(--border)] bg-[#fafbfc] px-5 py-3 sm:px-6"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务或文件名" className="min-w-52 rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--primary)]" /><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text-secondary)]"><option value="ALL">全部状态</option><option value="RISK">建议修改</option><option value="PASS">未发现明确风险</option><option value="UNCERTAIN">待补充材料</option></select></div><div className="overflow-x-auto"><table className="min-w-[820px] w-full text-left text-sm"><thead className="bg-[#fafbfc] text-xs text-[var(--text-tertiary)]"><tr><th className="px-5 py-3 font-medium">任务名称</th><th className="px-4 py-3 font-medium">内容类型</th><th className="px-4 py-3 font-medium">素材数量</th><th className="px-4 py-3 font-medium">审核状态</th><th className="px-4 py-3 font-medium">风险数量</th><th className="px-4 py-3 font-medium">人工复核</th><th className="px-5 py-3 font-medium">更新时间</th></tr></thead><tbody>{filtered.map((task) => <tr key={task.id} onClick={() => onOpen(task)} className="cursor-pointer border-t border-[var(--border)] hover:bg-[var(--hover-bg)]"><td className="px-5 py-4 font-medium">{task.name}<p className="mt-1 max-w-52 truncate text-xs font-normal text-[var(--text-tertiary)]">{task.materialLabel}</p></td><td className="px-4 py-4 text-[var(--text-secondary)]">{taskKindLabel(task.kind)}</td><td className="px-4 py-4 text-[var(--text-secondary)]">{task.materialCount}</td><td className="px-4 py-4"><StatusPill review={task.review} /></td><td className="px-4 py-4 text-[var(--text-secondary)]">{issueCount(task.review)} 处</td><td className="px-4 py-4 text-[var(--text-secondary)]">{task.humanReviewState === "PENDING" ? "待复核" : task.humanReviewState === "RESOLVED" ? "已处理" : "—"}</td><td className="px-5 py-4 text-[var(--text-tertiary)]">{dateLabel(task.updatedAt)}</td></tr>)}{!filtered.length && <tr><td colSpan={7} className="px-5 py-10 text-center text-[var(--text-secondary)]">没有匹配的任务</td></tr>}</tbody></table></div></section>;
}

function BatchReview({ queue, error, onChange, onSubmit, onOpen }: { queue: QueueItem[]; error: string | null; onChange: (assets: UploadAsset[]) => void; onSubmit: () => void; onOpen: (task: StoredReviewTask) => void }) {
  const [prefix, setPrefix] = useState("");
  const running = queue.some((item) => item.state === "reviewing");
  const assets = queue.map(({ id, file, displayName, originalFileName }) => ({ id, file, displayName, originalFileName }));
  function applyPrefix() { if (!prefix.trim()) return; onChange(assets.map((asset, index) => ({ ...asset, displayName: `${prefix.trim()}-${String(index + 1).padStart(2, "0")}` }))); }
  return <section className="rounded-lg border border-[var(--border)] bg-white"><div className="border-b border-[var(--border)] px-5 py-5 sm:px-6"><h2 className="text-lg font-semibold">批量审核</h2><p className="mt-1 text-sm text-[var(--text-secondary)]">每张图片会建立为一项独立审核任务。</p></div><div className="p-5 sm:p-6"><AssetDropzone assets={assets} onChange={onChange} maxFiles={10} title="广告图片（最多 10 张）" emptyLabel="拖入多张广告图片，或点击选择" description="审核前可删除、重命名或拖拽排序" />{queue.length > 0 && <><div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[#fafbfc] p-3"><label htmlFor="batch-prefix" className="text-sm font-medium">批量命名前缀</label><input id="batch-prefix" value={prefix} onChange={(event) => setPrefix(event.target.value)} placeholder="例如：会员日活动" className="w-52 rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--primary)]" /><button type="button" disabled={!prefix.trim()} onClick={applyPrefix} className="rounded-md border border-[#b8ccff] bg-white px-3 py-2 text-sm font-medium text-[var(--primary)] disabled:border-[var(--border)] disabled:text-[var(--text-tertiary)]">应用前缀</button></div><div className="mt-5 overflow-x-auto"><table className="min-w-[640px] w-full text-left text-sm"><thead className="border-b border-[var(--border)] text-xs text-[var(--text-tertiary)]"><tr><th className="py-3 font-medium">任务名称</th><th className="py-3 font-medium">原文件</th><th className="py-3 font-medium">状态</th><th className="py-3 font-medium">结果</th></tr></thead><tbody>{queue.map((item) => <tr key={item.id} onClick={() => item.task && onOpen(item.task)} className={`border-b border-[var(--border)] ${item.task ? "cursor-pointer hover:bg-[var(--hover-bg)]" : ""}`}><td className="py-3 pr-4 font-medium">{item.displayName || item.originalFileName}</td><td className="py-3 pr-4 text-xs text-[var(--text-tertiary)]">{item.originalFileName}</td><td className="py-3 text-[var(--text-secondary)]">{item.state === "waiting" ? "等待审核" : item.state === "reviewing" ? "审核中" : item.state === "done" ? "已完成" : "审核失败"}</td><td className="py-3">{item.task ? <button type="button" onClick={(event) => { event.stopPropagation(); onOpen(item.task!); }} className="font-medium text-[var(--primary)] hover:underline">{statusLabel(item.result!)} · 查看报告</button> : <span className="text-[var(--text-secondary)]">{item.error ?? "—"}</span>}</td></tr>)}</tbody></table></div></>}{error && <p className="mt-5 rounded-md bg-[#fff1f0] px-4 py-3 text-sm text-[var(--danger)]">{error}</p>}</div><div className="flex justify-end border-t border-[var(--border)] px-5 py-4 sm:px-6"><button type="button" disabled={!queue.length || running} onClick={onSubmit} className="rounded-md bg-[var(--primary)] px-5 py-3 text-sm font-semibold text-white hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:bg-[#aebedc]">{running ? "正在批量审核…" : "开始批量审核"}</button></div></section>;
}

function HumanReviewList({ tasks, onOpen, onResolve, onCreate }: { tasks: StoredReviewTask[]; onOpen: (task: StoredReviewTask) => void; onResolve: (task: StoredReviewTask) => void; onCreate: () => void }) {
  if (!tasks.length) return <section className="rounded-lg border border-[var(--border)] bg-white p-10 text-center"><p className="text-sm font-semibold">暂无待人工复核任务</p><button type="button" onClick={onCreate} className="mt-5 rounded-md border border-[#b8ccff] px-4 py-2 text-sm font-semibold text-[var(--primary)]">新建审核</button></section>;
  return <section className="rounded-lg border border-[var(--border)] bg-white"><div className="border-b border-[var(--border)] px-5 py-4 sm:px-6"><h2 className="text-lg font-semibold">待人工复核</h2></div><div className="divide-y divide-[var(--border)]">{tasks.map((task) => <article key={task.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-6"><div><p className="font-semibold">{task.name}</p><p className="mt-1 text-sm text-[var(--text-secondary)]">{task.review.ruleResults.filter((item) => item.needHumanReview).map((item) => item.ruleName).join("、")}</p></div><div className="flex gap-2"><button type="button" onClick={() => onOpen(task)} className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-secondary)]">查看报告</button><button type="button" onClick={() => onResolve(task)} className="rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white">标记已处理</button></div></article>)}</div></section>;
}
