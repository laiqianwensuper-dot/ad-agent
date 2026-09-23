"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BookOpenCheck,
  CircleHelp,
  ClipboardList,
  ListChecks,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import {
  AssetDropzone,
  filesToUploadAssets,
  type UploadAsset,
} from "@/components/asset-dropzone";
import { saveAsset } from "@/lib/asset-store";
import {
  MAX_REVIEW_IMAGE_BYTES,
  MAX_REVIEW_IMAGE_LABEL,
  imageBytes,
} from "@/lib/upload-policy";
import {
  createContentItem,
  createStoredTask,
  humanReviewIssues,
  isHumanIssueResolved,
  loadStoredTasks,
  saveStoredTasks,
  type ReviewPresentation,
  type ReviewTaskKind,
  type StoredContentItem,
  type StoredReviewTask,
  type TaskAsset,
} from "@/lib/review-task-store";
import {
  rules,
  severityByRule,
  type RegisteredRule,
} from "@/lib/rules/registry";

type Page = "tasks" | "new" | "human" | "rules";
type DraftItem = {
  id: string;
  name: string;
  copy: string;
  assets: UploadAsset[];
};
type ReviewApiPayload = {
  presentation?: { review?: Record<string, unknown>; canonical?: unknown };
  error?: { message?: string };
};

const navigation: { id: Page; label: string; Icon: typeof ClipboardList }[] = [
  { id: "new", label: "新建审核", Icon: Plus },
  { id: "tasks", label: "审核任务", Icon: ClipboardList },
  { id: "human", label: "待人工复核", Icon: UserRound },
  { id: "rules", label: "规则库", Icon: BookOpenCheck },
];

function newDraftItem(name = ""): DraftItem {
  return { id: crypto.randomUUID(), name, copy: "", assets: [] };
}

async function requestReview(
  text: string,
  images: File[] = [],
): Promise<ReviewPresentation> {
  const body = new FormData();
  if (text.trim()) body.set("text", text.trim());
  images.forEach((image) => body.append("images", image));
  const response = await fetch("/api/review", { method: "POST", body });
  const raw = await response.text();
  let payload: ReviewApiPayload | null = null;
  try {
    payload = JSON.parse(raw) as ReviewApiPayload;
  } catch {
    /* Surface an actionable HTTP error below. */
  }
  if (!response.ok || !payload?.presentation?.review) {
    throw new Error(
      payload?.error?.message ?? `审核请求失败（HTTP ${response.status}）。`,
    );
  }
  return {
    ...payload.presentation.review,
    canonical: payload.presentation.canonical,
  } as ReviewPresentation;
}

function contentKind(copy: string, assets: UploadAsset[]): ReviewTaskKind {
  return copy.trim() && assets.length
    ? "TEXT_AND_IMAGE"
    : assets.length
      ? "IMAGE"
      : "TEXT";
}

function materialNameFromAsset(asset: UploadAsset) {
  const source = (asset.displayName || asset.originalFileName).trim();
  return source.replace(/\.[^./\\]+$/, "").trim() || "未命名素材";
}
function looksLikeGeneratedFileName(value: string) {
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}
function dateLabel(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
function aggregateStatus(items: StoredContentItem[]) {
  return items.some((item) => item.review.overallStatus === "RISK")
    ? "RISK"
    : items.some((item) => item.review.overallStatus === "UNCERTAIN")
      ? "UNCERTAIN"
      : "PASS";
}
function taskResultLabel(status: "RISK" | "PASS" | "UNCERTAIN") {
  return status === "RISK"
    ? "需修改"
    : status === "UNCERTAIN"
      ? "待复核"
      : "已通过";
}

function ResultTag({ status }: { status: "RISK" | "PASS" | "UNCERTAIN" }) {
  const style =
    status === "RISK"
      ? "bg-[#fff0ed] text-[#b83b34]"
      : status === "UNCERTAIN"
        ? "bg-[#fff7e6] text-[#a55f00]"
        : "bg-[#ecf8ef] text-[#237a4d]";
  return (
    <span className={`rounded px-2 py-1 text-xs font-medium ${style}`}>
      {taskResultLabel(status)}
    </span>
  );
}

function AppSidebar({
  page,
  pendingCount,
  onGo,
}: {
  page: Page;
  pendingCount: number;
  onGo: (page: Page) => void;
}) {
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
        {navigation.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onGo(id)}
            className={`min-w-max rounded-md px-3 py-3 text-left text-sm transition lg:flex lg:w-full lg:items-center lg:gap-3 ${page === id ? "bg-[var(--active-bg)] font-semibold text-[var(--primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"}`}
          >
            <Icon size={19} strokeWidth={id === "new" ? 2.8 : 2} />
            {label}
            {id === "human" && pendingCount > 0 && (
              <span className="ml-auto rounded-full bg-[#f54a45] px-1.5 py-0.5 text-xs font-semibold text-white">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </nav>
    </aside>
  );
}

function Topbar({ page }: { page: Page }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const label =
    page === "new"
      ? "新建审核"
      : page === "human"
        ? "待人工复核"
        : page === "rules"
          ? "规则库"
          : "审核任务";
  return (
    <>
      <header className="flex min-h-14 items-center justify-between border-b border-[var(--border)] bg-white px-5 sm:px-7">
        <p className="text-sm text-[var(--text-secondary)]">
          ADGUARD <span className="mx-2 text-[var(--text-tertiary)]">/</span>{" "}
          <span className="font-medium text-[var(--text-primary)]">
            {label}
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
              <li>• 同一内容项中的文案和配图会整体审核。</li>
              <li>• 批量导入会为每张独立图片生成内容项。</li>
              <li>• 图片、文案或图文组合均可提交。</li>
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

export function ReviewWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const batchInputRef = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState<Page>("tasks");
  const [tasks, setTasks] = useState<StoredReviewTask[]>([]);
  const [taskName, setTaskName] = useState("");
  const [draftItems, setDraftItems] = useState<DraftItem[]>(() => [
    newDraftItem(),
  ]);
  const [isReviewing, setIsReviewing] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => setTasks(loadStoredTasks()));
  }, []);
  useEffect(() => {
    const requested = searchParams.get("page");
    queueMicrotask(() =>
      setPage(
        requested === "new" || requested === "human" || requested === "rules"
          ? requested
          : "tasks",
      ),
    );
  }, [searchParams]);
  const pendingHuman = useMemo(
    () =>
      tasks.flatMap((task) =>
        task.contentItems.flatMap((item) =>
          humanReviewIssues(item.review)
            .filter(
              (issue) =>
                !isHumanIssueResolved(item.humanReview, issue.issueKey),
            )
            .map((issue) => ({ task, item, issue })),
        ),
      ),
    [tasks],
  );

  function go(next: Page) {
    setError(null);
    setPage(next);
    router.replace(next === "tasks" ? "/" : `/?page=${next}`);
  }
  function updateTasks(
    updater: (current: StoredReviewTask[]) => StoredReviewTask[],
  ) {
    setTasks((current) => {
      const next = updater(current);
      saveStoredTasks(next);
      return next;
    });
  }
  function openTask(task: StoredReviewTask, item?: StoredContentItem) {
    router.push(`/tasks/${task.id}${item ? `?item=${item.id}` : ""}`);
  }
  function patchDraft(id: string, patch: Partial<DraftItem>) {
    setDraftItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }
  function addContent() {
    setDraftItems((current) => [...current, newDraftItem()]);
  }
  function removeContent(id: string) {
    setDraftItems((current) =>
      current.length === 1 ? current : current.filter((item) => item.id !== id),
    );
  }

  function bulkImport(files: File[]) {
    const assets = filesToUploadAssets(files).slice(0, 10);
    if (!assets.length) return;
    setDraftItems((current) => {
      const replaceInitialBlank =
        current.length === 1 &&
        !current[0].name.trim() &&
        !current[0].copy.trim() &&
        current[0].assets.length === 0;
      const usedNames = new Set(
        (replaceInitialBlank ? [] : current)
          .map((item) => item.name.trim())
          .filter(Boolean),
      );
      const imported = assets.map((asset) => {
        const sourceName = materialNameFromAsset(asset);
        const generated = looksLikeGeneratedFileName(sourceName);
        const base = generated
          ? taskName.trim() || "未命名素材"
          : sourceName;
        let ordinal = 1;
        let name = generated ? `${base}-${String(ordinal).padStart(2, "0")}` : base;
        let suffix = 2;
        while (usedNames.has(name)) {
          if (generated) name = `${base}-${String(++ordinal).padStart(2, "0")}`;
          else name = `${base}-${suffix++}`;
        }
        usedNames.add(name);
        return { id: crypto.randomUUID(), name, copy: "", assets: [asset] };
      });
      return replaceInitialBlank ? imported : [...current, ...imported];
    });
  }

  async function persistAssets(assets: UploadAsset[]): Promise<TaskAsset[]> {
    const values = await Promise.all(
      assets.map(async (asset, order) => {
        const assetId = crypto.randomUUID();
        await saveAsset(assetId, asset.file);
        return {
          assetId,
          originalFileName: asset.originalFileName,
          displayName: asset.displayName.trim() || asset.originalFileName,
          order,
        };
      }),
    );
    return values;
  }

  async function submitTask() {
    const reviewable = draftItems.filter(
      (item) => item.copy.trim() || item.assets.length,
    );
    if (!reviewable.length || isReviewing) {
      setError("请至少填写一段文案或上传一张图片。");
      return;
    }
    const oversized = reviewable.find(
      (item) =>
        imageBytes(item.assets.map((asset) => asset.file)) >
        MAX_REVIEW_IMAGE_BYTES,
    );
    if (oversized) {
      setError(
        `“${oversized.name || "未命名素材"}”的配图总大小不能超过 ${MAX_REVIEW_IMAGE_LABEL}。`,
      );
      return;
    }
    setError(null);
    setIsReviewing(true);
    const completed: StoredContentItem[] = [];
    const failures: string[] = [];
    try {
      for (const [index, draft] of reviewable.entries()) {
        setProgress(`正在审核 ${index + 1} / ${reviewable.length}`);
        try {
          const review = await requestReview(
            draft.copy,
            draft.assets.map((asset) => asset.file),
          );
          const assets = await persistAssets(draft.assets);
          completed.push(
            createContentItem({
              name:
                draft.name.trim() ||
                `${taskName.trim() || "未命名素材"}-${String(index + 1).padStart(2, "0")}`,
              kind: contentKind(draft.copy, draft.assets),
              materialCount: Math.max(1, draft.assets.length),
              materialLabel: draft.assets.length
                ? draft.assets
                    .map((asset) => asset.displayName || asset.originalFileName)
                    .join("、")
                : "广告文案",
              assets,
              review,
            }),
          );
        } catch (caught) {
          const label = draft.name.trim() || `内容 ${index + 1}`;
          const reason = caught instanceof Error ? caught.message : "未知错误";
          failures.push(`${label}：${reason}`);
        }
      }
      if (!completed.length)
        throw new Error(`未能完成审核。${failures.join("；")}`);
      const resolvedName =
        taskName.trim() ||
        completed[0].name ||
        `未命名审核-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`;
      const task = createStoredTask({
        name: resolvedName,
        contentItems: completed,
      });
      updateTasks((current) => [task, ...current]);
      if (failures.length)
        setError(
          `${failures.join("、")} 未能审核，已保存其余 ${completed.length} 个内容项。`,
        );
      openTask(task, completed[0]);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "审核失败，请稍后重试。",
      );
    } finally {
      setIsReviewing(false);
      setProgress("");
    }
  }

  return (
    <main className="min-h-screen bg-[var(--app-bg)] text-[var(--text-primary)] lg:grid lg:grid-cols-[228px_minmax(0,1fr)]">
      <AppSidebar page={page} pendingCount={pendingHuman.length} onGo={go} />
      <div className="min-w-0">
        <Topbar page={page} />
        <div className="mx-auto max-w-[1540px] p-5 sm:p-7">
          {page === "new" && (
            <NewReviewPage
              taskName={taskName}
              items={draftItems}
              error={error}
              isReviewing={isReviewing}
              progress={progress}
              batchInputRef={batchInputRef}
              onName={setTaskName}
              onAdd={addContent}
              onBulk={bulkImport}
              onPatch={patchDraft}
              onRemove={removeContent}
              onSubmit={() => void submitTask()}
            />
          )}
          {page === "tasks" && (
            <TaskTable
              tasks={tasks}
              onCreate={() => go("new")}
              onOpen={openTask}
            />
          )}
          {page === "human" && (
            <HumanReviewList
              rows={pendingHuman}
              onOpen={openTask}
              onCreate={() => go("new")}
            />
          )}
          {page === "rules" && <RuleLibrary />}
        </div>
      </div>
    </main>
  );
}

function NewReviewPage({
  taskName,
  items,
  error,
  isReviewing,
  progress,
  batchInputRef,
  onName,
  onAdd,
  onBulk,
  onPatch,
  onRemove,
  onSubmit,
}: {
  taskName: string;
  items: DraftItem[];
  error: string | null;
  isReviewing: boolean;
  progress: string;
  batchInputRef: React.RefObject<HTMLInputElement | null>;
  onName: (value: string) => void;
  onAdd: () => void;
  onBulk: (files: File[]) => void;
  onPatch: (id: string, patch: Partial<DraftItem>) => void;
  onRemove: (id: string) => void;
  onSubmit: () => void;
}) {
  return (
    <section>
      <div className="mb-5">
        <h1 className="text-[26px] font-semibold tracking-tight">新建审核</h1>
      </div>
      <div className="rounded-lg border border-[var(--border)] bg-white">
        <div className="border-b border-[var(--border)] px-6 py-4">
          <label
            className="flex flex-col gap-2 sm:flex-row sm:items-center"
            htmlFor="task-name"
          >
            <span className="shrink-0 whitespace-nowrap text-sm font-semibold">
              任务名称{" "}
              <span className="font-normal text-[var(--text-tertiary)]">
                （可选）
              </span>
            </span>
            <input
              id="task-name"
              value={taskName}
              onChange={(event) => onName(event.target.value)}
              placeholder="例如：LUMORA-618 营销素材审核"
              maxLength={100}
              className="w-full rounded-md border border-[#d9e2f0] px-3 py-2.5 text-sm outline-none focus:border-[var(--primary)] focus:ring-4 focus:ring-[#e8f0ff]"
            />
          </label>
        </div>
        <div className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">审核内容</h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onAdd}
                className="rounded-md border border-[#cbd8ef] px-3 py-2 text-sm font-medium text-[var(--primary)] hover:bg-[var(--active-bg)]"
              >
                <Plus className="mr-1 inline" size={16} />
                添加内容
              </button>
              <button
                type="button"
                onClick={() => batchInputRef.current?.click()}
                className="rounded-md border border-[#cbd8ef] px-3 py-2 text-sm font-medium text-[var(--primary)] hover:bg-[var(--active-bg)]"
              >
                <Upload className="mr-1 inline" size={16} />
                批量导入图片
              </button>
              <input
                ref={batchInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="sr-only"
                onChange={(event) => {
                  onBulk(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
            </div>
          </div>
          <div className="mt-5 space-y-4">
            {items.map((item, index) => (
              <ContentEditor
                key={item.id}
                index={index}
                item={item}
                removable={items.length > 1}
                onPatch={(patch) => onPatch(item.id, patch)}
                onRemove={() => onRemove(item.id)}
              />
            ))}
          </div>
        </div>
        {error && (
          <p className="mx-6 mb-4 rounded-md bg-[#fff1f0] px-4 py-3 text-sm text-[var(--danger)]">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-3 border-t border-[var(--border)] px-6 py-4">
          {progress && (
            <span className="mr-auto text-sm text-[var(--text-secondary)]">
              {progress}
            </span>
          )}
          <button
            type="button"
            disabled={isReviewing}
            onClick={onSubmit}
            className="rounded-md bg-[var(--primary)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:bg-[#aebedc]"
          >
            {isReviewing ? "正在审核…" : "开始审核"}
          </button>
        </div>
      </div>
    </section>
  );
}

function ContentEditor({
  item,
  index,
  removable,
  onPatch,
  onRemove,
}: {
  item: DraftItem;
  index: number;
  removable: boolean;
  onPatch: (patch: Partial<DraftItem>) => void;
  onRemove: () => void;
}) {
  const [copyOpen, setCopyOpen] = useState(Boolean(item.copy));
  const showCopy = copyOpen || Boolean(item.copy) || item.assets.length === 0;
  return (
    <article className="overflow-hidden rounded-lg border border-[#e0e7f1]">
      <div className="flex items-center gap-3 border-b border-[#e8edf5] bg-[#fbfcfe] px-4 py-3">
        <span className="text-sm font-semibold text-[var(--text-primary)]">
          内容 {String(index + 1).padStart(2, "0")}
        </span>
        <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          <span className="shrink-0 text-xs font-medium text-[var(--text-secondary)]">
            素材名称
          </span>
          <input
            value={item.name}
            onChange={(event) => onPatch({ name: event.target.value })}
            aria-label="素材名称"
            className="min-w-0 flex-1 bg-transparent font-medium text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
            placeholder="例如：朋友圈预热"
          />
        </label>
        <span className="rounded bg-[#e8f3ff] px-2 py-1 text-xs font-medium text-[var(--primary)]">
          {item.copy.trim() && item.assets.length
            ? "图文"
            : item.assets.length
              ? "图片"
              : "文案"}
        </span>
        {removable && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded p-1.5 text-[var(--text-tertiary)] hover:bg-[#fff1f0] hover:text-[var(--danger)]"
            aria-label="删除内容"
          >
            <Trash2 size={17} />
          </button>
        )}
      </div>
      {showCopy ? (
        <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,.9fr)]">
          <div>
            <label
              className="text-sm font-semibold"
              htmlFor={`copy-${item.id}`}
            >
              广告文案{" "}
              <span className="font-normal text-[var(--text-tertiary)]">
                （可选）
              </span>
            </label>
            <textarea
              id={`copy-${item.id}`}
              value={item.copy}
              onChange={(event) => onPatch({ copy: event.target.value })}
              placeholder="输入朋友圈文案、活动说明等"
              className="mt-2 min-h-36 w-full resize-y rounded-md border border-[#dfe5ee] bg-[#fbfcfe] p-3 text-sm leading-6 outline-none focus:border-[var(--primary)] focus:ring-4 focus:ring-[#e8f0ff]"
            />
          </div>
          <div>
            <AssetDropzone
              assets={item.assets}
              onChange={(assets) => onPatch({ assets })}
              maxFiles={5}
              title="配套图片（最多 5 张）"
              emptyLabel="拖入图片，或点击上传"
              description={`PNG、JPG、WEBP · 合计不超过 ${MAX_REVIEW_IMAGE_LABEL}`}
              compact
            />
          </div>
        </div>
      ) : (
        <div className="p-4">
          <AssetDropzone
            assets={item.assets}
            onChange={(assets) => onPatch({ assets })}
            maxFiles={5}
            title="图片"
            emptyLabel="拖入图片，或点击上传"
            description={`PNG、JPG、WEBP · 合计不超过 ${MAX_REVIEW_IMAGE_LABEL}`}
            compact
          />
          <button
            type="button"
            onClick={() => setCopyOpen(true)}
            className="mt-3 text-sm font-medium text-[var(--primary)] hover:underline"
          >
            <Plus className="mr-1 inline" size={15} />
            补充广告文案
          </button>
        </div>
      )}
    </article>
  );
}

function handlingCopy(rule: RegisteredRule) {
  if (rule.rule_id === "A-06") return "命中时拦截并人工复核";
  if (rule.rule_id === "A-09") return "真实性或授权无法确认时人工复核";
  if (rule.rule_id === "A-10") return "素材不完整时补充确认";
  return "明确风险直接修改；信息不清补充确认";
}

function severityCopy(rule: RegisteredRule) {
  const severity = severityByRule[rule.rule_id];
  return severity === "HIGH"
    ? "高"
    : severity === "MEDIUM"
      ? "中"
      : severity === "LOW"
        ? "低"
        : "按情形";
}

function RuleLibrary() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId
    ? (rules.find((rule) => rule.rule_id === selectedId) ?? null)
    : null;
  return (
    <section>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[26px] font-semibold tracking-tight">规则库</h1>
        <span className="rounded bg-[#eef3ff] px-2.5 py-1 text-xs font-medium text-[var(--primary)]">
          受控配置 · 只读
        </span>
      </div>
      <div
        className={
          selected
            ? "grid gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]"
            : "grid gap-5"
        }
      >
        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-[700px] w-full text-left text-sm">
              <thead className="bg-[#fafbfc] text-xs text-[var(--text-tertiary)]">
                <tr>
                  <th className="px-5 py-3 font-medium">规则</th>
                  <th className="px-4 py-3 font-medium">规则说明</th>
                  <th className="px-4 py-3 font-medium">默认等级</th>
                  <th className="px-5 py-3 font-medium">处理方式</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr
                    key={rule.rule_id}
                    onClick={() => setSelectedId(rule.rule_id)}
                    className={`cursor-pointer border-t border-[var(--border)] transition hover:bg-[var(--hover-bg)] ${selected?.rule_id === rule.rule_id ? "bg-[#f4f8ff]" : ""}`}
                  >
                    <td className="px-5 py-3.5 font-medium">
                      <span className="mr-2 text-[var(--text-tertiary)]">
                        {rule.rule_id}
                      </span>
                      {rule.rule_name}
                    </td>
                    <td className="max-w-[380px] px-4 py-3.5 leading-6 text-[var(--text-secondary)]">
                      {rule.source_requirement}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="rounded bg-[#fff7e6] px-2 py-1 text-xs text-[#a55f00]">
                        {severityCopy(rule)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-[var(--text-secondary)]">
                      {handlingCopy(rule)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {selected && (
          <aside className="rounded-lg border border-[var(--border)] bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {selected.rule_id} {selected.rule_name}
              </h2>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="rounded p-1 text-[var(--text-tertiary)] hover:bg-[var(--hover-bg)]"
                aria-label="关闭规则详情"
              >
                <X size={17} />
              </button>
            </div>
            <div className="mt-5 space-y-5">
              <div>
                <p className="text-xs font-semibold text-[var(--text-tertiary)]">
                  规则要求
                </p>
                <p className="mt-2 text-sm leading-6">
                  {selected.source_requirement}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-[var(--text-tertiary)]">
                  关注内容
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selected.detection_focus.map((focus) => (
                    <span
                      key={focus}
                      className="rounded bg-[#f5f7fa] px-2 py-1 text-xs text-[var(--text-secondary)]"
                    >
                      {focus}
                    </span>
                  ))}
                </div>
              </div>
              {selected.required_information.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-[var(--text-tertiary)]">
                    需要识别的信息
                  </p>
                  <ul className="mt-2 space-y-1 text-sm leading-6 text-[var(--text-secondary)]">
                    {selected.required_information.map((item) => (
                      <li key={item}>• {item}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <p className="text-xs font-semibold text-[var(--text-tertiary)]">
                  当前处理方式
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                  {handlingCopy(selected)}
                </p>
              </div>
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}

function TaskTable({
  tasks,
  onCreate,
  onOpen,
}: {
  tasks: StoredReviewTask[];
  onCreate: () => void;
  onOpen: (task: StoredReviewTask, item?: StoredContentItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"ALL" | "RISK" | "PASS" | "UNCERTAIN">(
    "ALL",
  );
  const summary = {
    all: tasks.length,
    risk: tasks.filter((task) => aggregateStatus(task.contentItems) === "RISK")
      .length,
    uncertain: tasks.filter(
      (task) => aggregateStatus(task.contentItems) === "UNCERTAIN",
    ).length,
    pass: tasks.filter((task) => aggregateStatus(task.contentItems) === "PASS")
      .length,
  };
  const filtered = tasks.filter(
    (task) =>
      (status === "ALL" || aggregateStatus(task.contentItems) === status) &&
      `${task.name} ${task.contentItems.map((item) => item.name).join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  if (!tasks.length)
    return (
      <section>
        <div className="mb-5 flex items-center justify-between">
          <h1 className="text-[26px] font-semibold tracking-tight">审核任务</h1>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-white px-8 py-16 text-center">
          <ListChecks className="mx-auto text-[var(--primary)]" size={30} />
          <p className="mt-4 font-semibold">还没有审核任务</p>
          <button
            type="button"
            onClick={onCreate}
            className="mt-5 rounded-md bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white"
          >
            新建审核
          </button>
        </div>
      </section>
    );
  return (
    <section>
      <div className="mb-5">
        <h1 className="text-[26px] font-semibold tracking-tight">审核任务</h1>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-[var(--border)] pb-4 text-sm">
        <button
          type="button"
          onClick={() => setStatus("ALL")}
          className={
            status === "ALL"
              ? "font-semibold text-[var(--primary)]"
              : "text-[var(--text-secondary)]"
          }
        >
          全部 {summary.all}
        </button>
        <button
          type="button"
          onClick={() => setStatus("RISK")}
          className={
            status === "RISK"
              ? "font-semibold text-[var(--primary)]"
              : "text-[var(--text-secondary)]"
          }
        >
          需修改 {summary.risk}
        </button>
        <button
          type="button"
          onClick={() => setStatus("UNCERTAIN")}
          className={
            status === "UNCERTAIN"
              ? "font-semibold text-[var(--primary)]"
              : "text-[var(--text-secondary)]"
          }
        >
          待补充确认 {summary.uncertain}
        </button>
        <button
          type="button"
          onClick={() => setStatus("PASS")}
          className={
            status === "PASS"
              ? "font-semibold text-[var(--primary)]"
              : "text-[var(--text-secondary)]"
          }
        >
          已通过 {summary.pass}
        </button>
      </div>
      <div className="mt-4 overflow-hidden rounded-lg border border-[var(--border)] bg-white">
        <div className="flex flex-wrap gap-3 border-b border-[var(--border)] px-5 py-3">
          <label className="relative">
            <Search
              size={17}
              className="absolute left-3 top-2.5 text-[var(--text-tertiary)]"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索任务名称或内容项"
              className="min-w-60 rounded-md border border-[var(--border)] py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--primary)]"
            />
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[760px] w-full text-left text-sm">
            <thead className="bg-[#fafbfc] text-xs text-[var(--text-tertiary)]">
              <tr>
                <th className="px-5 py-3 font-medium">任务名称</th>
                <th className="px-4 py-3 font-medium">进度</th>
                <th className="px-4 py-3 font-medium">结果</th>
                <th className="px-4 py-3 font-medium">人工复核</th>
                <th className="px-5 py-3 font-medium">更新时间</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((task) => {
                const taskStatus = aggregateStatus(task.contentItems);
                const pending = task.contentItems.reduce(
                  (count, item) =>
                    count +
                    humanReviewIssues(item.review).filter(
                      (issue) =>
                        !isHumanIssueResolved(
                          item.humanReview,
                          issue.issueKey,
                        ),
                    ).length,
                  0,
                );
                return (
                  <tr
                    key={task.id}
                    onClick={() => onOpen(task)}
                    className="cursor-pointer border-t border-[var(--border)] transition hover:bg-[var(--hover-bg)]"
                  >
                    <td className="px-5 py-4 font-medium">
                      {task.name}
                      <p className="mt-1 text-xs font-normal text-[var(--text-tertiary)]">
                        {task.contentItems.map((item) => item.name).join("、")}
                      </p>
                    </td>
                    <td className="px-4 py-4 text-[var(--text-secondary)]">
                      {task.contentItems.length} / {task.contentItems.length}
                    </td>
                    <td className="px-4 py-4">
                      <ResultTag status={taskStatus} />
                    </td>
                    <td className="px-4 py-4 text-[var(--text-secondary)]">
                      {pending ? `待处理 ${pending}` : "不需要"}
                    </td>
                    <td className="px-5 py-4 text-[var(--text-tertiary)]">
                      {dateLabel(task.updatedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function HumanReviewList({
  rows,
  onOpen,
  onCreate,
}: {
  rows: {
    task: StoredReviewTask;
    item: StoredContentItem;
    issue: { issueKey: string; label: string };
  }[];
  onOpen: (task: StoredReviewTask, item?: StoredContentItem) => void;
  onCreate: () => void;
}) {
  if (!rows.length)
    return (
      <section>
        <div className="mb-5">
          <h1 className="text-[26px] font-semibold tracking-tight">
            待人工复核
          </h1>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-white px-8 py-16 text-center">
          <p className="font-semibold">暂无待人工复核内容</p>
          <button
            type="button"
            onClick={onCreate}
            className="mt-5 rounded-md border border-[#b8ccff] px-4 py-2 text-sm font-semibold text-[var(--primary)]"
          >
            新建审核
          </button>
        </div>
      </section>
    );
  return (
    <section>
      <div className="mb-5">
        <h1 className="text-[26px] font-semibold tracking-tight">待人工复核</h1>
      </div>
      <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-white">
        <table className="min-w-[760px] w-full text-left text-sm">
          <thead className="bg-[#fafbfc] text-xs text-[var(--text-tertiary)]">
            <tr>
              <th className="px-5 py-3 font-medium">所属任务</th>
              <th className="px-4 py-3 font-medium">内容项</th>
              <th className="px-4 py-3 font-medium">复核原因</th>
              <th className="px-4 py-3 font-medium">预审结论</th>
              <th className="px-5 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ task, item, issue }) => (
              <tr
                key={`${item.id}-${issue.issueKey}`}
                className="border-t border-[var(--border)] hover:bg-[var(--hover-bg)]"
              >
                <td className="px-5 py-4 font-medium">{task.name}</td>
                <td className="px-4 py-4 text-[var(--text-secondary)]">
                  {item.name}
                </td>
                <td className="px-4 py-4 text-[var(--text-secondary)]">
                  {issue.label}
                </td>
                <td className="px-4 py-4">
                  <ResultTag status={item.review.overallStatus} />
                </td>
                <td className="px-5 py-4">
                  <button
                    type="button"
                    onClick={() => onOpen(task, item)}
                    className="font-medium text-[var(--primary)] hover:underline"
                  >
                    进入复核
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
