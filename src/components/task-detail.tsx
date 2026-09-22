"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BookOpenCheck,
  CircleHelp,
  ClipboardList,
  Plus,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { ReviewResultView } from "@/components/review-result";
import { loadAsset } from "@/lib/asset-store";
import {
  contentItemStatusLabel,
  loadStoredTasks,
  needsHumanHandling,
  saveStoredTasks,
  type FeedbackReason,
  type HumanDecision,
  type StoredContentItem,
  type StoredReviewTask,
} from "@/lib/review-task-store";

function DetailSidebar({ onHome }: { onHome: () => void }) {
  const router = useRouter();
  return (
    <aside className="border-b border-[var(--border)] bg-white px-3 py-4 lg:min-h-screen lg:border-b-0 lg:border-r">
      <div className="flex items-center gap-2 px-2 py-1">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--primary)] text-white shadow-sm">
          <ShieldCheck size={22} strokeWidth={2.4} />
        </span>
        <div>
          <p className="text-lg font-bold tracking-tight text-[#14244d]">
            ADGUARD
          </p>
          <p className="text-xs text-[var(--text-secondary)]">广告审核工作台</p>
        </div>
      </div>
      <nav className="mt-7 flex gap-1 overflow-x-auto lg:block lg:space-y-1">
        <button
          type="button"
          onClick={() => router.push("/?page=new")}
          className="min-w-max rounded-md px-3 py-3 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] lg:flex lg:w-full lg:items-center lg:gap-3"
        >
          <Plus size={19} strokeWidth={2.8} />
          新建审核
        </button>
        <button
          type="button"
          onClick={onHome}
          className="min-w-max rounded-md bg-[var(--active-bg)] px-3 py-3 text-left text-sm font-semibold text-[var(--primary)] lg:flex lg:w-full lg:items-center lg:gap-3"
        >
          <ClipboardList size={19} />
          审核任务
        </button>
        <button
          type="button"
          onClick={() => router.push("/?page=human")}
          className="min-w-max rounded-md px-3 py-3 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] lg:flex lg:w-full lg:items-center lg:gap-3"
        >
          <UserRound size={19} />
          待人工复核
        </button>
        <button
          type="button"
          onClick={() => router.push("/?page=rules")}
          className="min-w-max rounded-md px-3 py-3 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] lg:flex lg:w-full lg:items-center lg:gap-3"
        >
          <BookOpenCheck size={19} />
          规则库
        </button>
      </nav>
    </aside>
  );
}

function statusStyle(item: StoredContentItem) {
  if (item.review.overallStatus === "RISK")
    return "bg-[#fff0ed] text-[#b83b34]";
  if (item.review.overallStatus === "UNCERTAIN")
    return "bg-[#fff7e6] text-[#a55f00]";
  return "bg-[#ecf8ef] text-[#237a4d]";
}

export function TaskDetail({ taskId }: { taskId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [task, setTask] = useState<StoredReviewTask | null | undefined>(
    undefined,
  );
  const [images, setImages] = useState<{ url: string; name: string }[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const selectedItemId = searchParams.get("item");
  const selectedItem = useMemo(
    () =>
      task?.contentItems.find((item) => item.id === selectedItemId) ??
      task?.contentItems[0] ??
      null,
    [selectedItemId, task],
  );
  const selectedIndex =
    task && selectedItem
      ? task.contentItems.findIndex((item) => item.id === selectedItem.id)
      : -1;

  useEffect(() => {
    queueMicrotask(() =>
      setTask(loadStoredTasks().find((item) => item.id === taskId) ?? null),
    );
  }, [taskId]);
  useEffect(() => {
    if (!selectedItem?.assets.length) {
      queueMicrotask(() => setImages([]));
      return undefined;
    }
    let active = true;
    const urls: string[] = [];
    void Promise.all(
      [...selectedItem.assets]
        .sort((a, b) => a.order - b.order)
        .map(async (asset) => {
          const blob = await loadAsset(asset.assetId);
          if (!blob) return null;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          return { url, name: asset.displayName };
        }),
    ).then((assets) => {
      if (active)
        setImages(
          assets.filter((item): item is { url: string; name: string } =>
            Boolean(item),
          ),
        );
    });
    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [selectedItem?.id, selectedItem?.assets]);

  function selectItem(item: StoredContentItem) {
    router.replace(`/tasks/${taskId}?item=${item.id}`, { scroll: false });
  }
  function updateHuman(input: {
    decision: HumanDecision;
    note?: string;
    feedback?: { findingKey: string; reason: FeedbackReason; note: string };
  }) {
    if (!selectedItem) return;
    const now = new Date().toISOString();
    setTask((current) => {
      if (!current) return current;
      const next: StoredReviewTask = {
        ...current,
        updatedAt: now,
        contentItems: current.contentItems.map((item) =>
          item.id !== selectedItem.id
            ? item
            : {
                ...item,
                humanReview: {
                  decision: input.decision,
                  note: input.note ?? item.humanReview.note,
                  updatedAt: now,
                  issueFeedback: input.feedback
                    ? [
                        ...item.humanReview.issueFeedback,
                        { ...input.feedback, createdAt: now },
                      ]
                    : item.humanReview.issueFeedback,
                },
              },
        ),
      };
      saveStoredTasks(
        loadStoredTasks().map((item) => (item.id === next.id ? next : item)),
      );
      return next;
    });
  }

  return (
    <main className="min-h-screen bg-[var(--app-bg)] text-[var(--text-primary)] lg:grid lg:grid-cols-[228px_minmax(0,1fr)]">
      <DetailSidebar onHome={() => router.push("/")} />
      <div className="min-w-0">
        <header className="flex min-h-14 items-center justify-between border-b border-[var(--border)] bg-white px-5 sm:px-7">
          <p className="truncate text-sm text-[var(--text-secondary)]">
            审核任务 <span className="mx-2 text-[var(--text-tertiary)]">/</span>{" "}
            <span className="font-medium text-[var(--text-primary)]">
              {task?.name ?? "审核详情"}
            </span>
          </p>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"
          >
            <CircleHelp size={18} />
            使用说明
          </button>
        </header>
        <div className="p-5 sm:p-7">
          {task === undefined && (
            <p className="text-sm text-[var(--text-secondary)]">
              正在读取审核任务…
            </p>
          )}
          {task === null && (
            <section className="rounded-lg border border-[var(--border)] bg-white p-8">
              <p className="font-medium">未找到此浏览器中的审核任务。</p>
              <button
                type="button"
                className="mt-4 text-sm font-medium text-[var(--primary)]"
                onClick={() => router.push("/")}
              >
                返回审核任务
              </button>
            </section>
          )}
          {task && selectedItem && (
            <>
              <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-[22px] font-semibold tracking-tight">
                      {task.name}
                    </h1>
                    <span
                      className={`rounded px-2 py-1 text-xs font-medium ${statusStyle(selectedItem)}`}
                    >
                      {contentItemStatusLabel(selectedItem)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">
                    内容项 {String(selectedIndex + 1).padStart(2, "0")} ·{" "}
                    {selectedItem.materialCount} 个素材
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={selectedIndex <= 0}
                    onClick={() =>
                      selectItem(task.contentItems[selectedIndex - 1])
                    }
                    className="rounded-md border border-[var(--border)] px-3 py-2 text-sm disabled:cursor-not-allowed disabled:text-[var(--text-tertiary)]"
                  >
                    上一项
                  </button>
                  <button
                    type="button"
                    disabled={selectedIndex >= task.contentItems.length - 1}
                    onClick={() =>
                      selectItem(task.contentItems[selectedIndex + 1])
                    }
                    className="rounded-md border border-[var(--border)] px-3 py-2 text-sm disabled:cursor-not-allowed disabled:text-[var(--text-tertiary)]"
                  >
                    下一项
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push("/")}
                    className="rounded-md border border-[#b8ccff] px-3 py-2 text-sm font-medium text-[var(--primary)]"
                  >
                    返回任务
                  </button>
                </div>
              </div>
              <div className="grid items-start rounded-lg border border-[var(--border)] bg-white xl:grid-cols-[238px_minmax(0,1fr)]">
                <aside className="border-b border-[var(--border)] bg-[#fbfcfe] p-4 xl:sticky xl:top-0 xl:max-h-screen xl:overflow-y-auto xl:border-b-0 xl:border-r">
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold">本任务内容</h2>
                    <span className="rounded-full bg-[#eef3ff] px-2 py-0.5 text-xs text-[var(--primary)]">
                      {task.contentItems.length}
                    </span>
                  </div>
                  <div className="mt-4 space-y-1">
                    {task.contentItems.map((item, index) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => selectItem(item)}
                        className={`w-full rounded-md px-3 py-3 text-left transition ${item.id === selectedItem.id ? "bg-[var(--active-bg)] text-[var(--primary)]" : "hover:bg-[var(--hover-bg)]"}`}
                      >
                        <p className="truncate text-sm font-medium">
                          {String(index + 1).padStart(2, "0")} {item.name}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-xs text-[var(--text-tertiary)]">
                            {item.kind === "TEXT_AND_IMAGE"
                              ? "图文"
                              : item.kind === "IMAGE"
                                ? "图片"
                                : "文案"}
                          </span>
                          {needsHumanHandling(item) && (
                            <span className="text-xs text-[#b54708]">
                              待人工复核
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </aside>
                <ReviewResultView
                  review={selectedItem.review}
                  images={images}
                  humanReview={selectedItem.humanReview}
                  onHumanUpdate={updateHuman}
                />
              </div>
            </>
          )}
        </div>
        {helpOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="使用说明"
            className="fixed inset-0 z-50 grid place-items-center bg-[#1f2329]/30 p-4"
          >
            <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">使用说明</h2>
                <button
                  type="button"
                  onClick={() => setHelpOpen(false)}
                  aria-label="关闭"
                >
                  <X size={18} />
                </button>
              </div>
              <ul className="mt-4 space-y-2 text-sm leading-6 text-[var(--text-secondary)]">
                <li>• 点击左侧内容项切换审核素材。</li>
                <li>• “补充确认”优先补原图或完整页面后重新审核。</li>
                <li>• “人工复核”仅用于题目要求人工确认的敏感词与背书情形。</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
