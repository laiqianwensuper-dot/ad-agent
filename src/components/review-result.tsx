"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { ReviewAssistantDrawer } from "@/components/review-assistant-drawer";
import type {
  FeedbackReason,
  HumanDecision,
  HumanReview,
  ReviewPresentation,
} from "@/lib/review-task-store";
import type { RuleResult } from "@/lib/schemas/review";

type ImageAsset = { url: string; name: string };
type Finding = {
  key: string;
  quote: string;
  results: RuleResult[];
  bbox: RuleResult["evidenceRefs"][number]["bbox"] | null;
  imageIndex: number | null;
  locationConfidence: "EXACT" | "APPROXIMATE" | null;
  marker: { x: number; y: number } | null;
};

const feedbackOptions: { id: FeedbackReason; label: string }[] = [
  { id: "NOT_A_RISK", label: "不构成风险" },
  { id: "WRONG_RULE", label: "风险类型不正确" },
  { id: "WRONG_SEVERITY", label: "风险等级不正确" },
  { id: "WRONG_LOCATION", label: "风险定位不正确" },
  { id: "SUGGESTION_NOT_USEFUL", label: "修改建议不合理" },
  { id: "OTHER", label: "其他" },
];

function statusCopy(
  status: ReviewPresentation["overallStatus"],
  issueCount: number,
  uncertainCount: number,
) {
  if (status === "PASS")
    return {
      title: "当前未发现明确风险",
      detail: "当前素材未发现题目规则定义的明确风险。",
      tone: "pass",
    };
  if (status === "UNCERTAIN")
    return {
      title: "待补充确认",
      detail: `有 ${uncertainCount} 项内容因素材信息不足无法确认。`,
      tone: "uncertain",
    };
  return {
    title: "建议修改后发布",
    detail: `发现 ${issueCount} 处需要修改的问题。完成修改后，请基于最终版本重新审核。`,
    tone: "risk",
  };
}

function groupFindings(results: RuleResult[]): Finding[] {
  const grouped = new Map<string, Omit<Finding, "marker">>();
  for (const result of results.filter((item) => item.status === "RISK")) {
    for (const quote of result.evidence) {
      const ref = result.evidenceRefs.find(
        (candidate) => candidate.quote === quote,
      );
      const segmentId = ref?.segmentId ?? "unlocated";
      const match = [...grouped.entries()].find(
        ([, finding]) =>
          finding.key.startsWith(`${segmentId}:`) &&
          (finding.quote.includes(quote) || quote.includes(finding.quote)),
      );
      if (match) {
        const [key, finding] = match;
        finding.results.push(result);
        if (quote.length > finding.quote.length) {
          grouped.delete(key);
          grouped.set(`${segmentId}:${quote}`, {
            ...finding,
            key: `${segmentId}:${quote}`,
            quote,
            bbox: ref?.bbox ?? finding.bbox,
            locationConfidence:
              ref?.locationConfidence ?? finding.locationConfidence,
          });
        }
      } else {
        const imageMatch = ref?.segmentId.match(/^image-(\d+):/);
        grouped.set(`${segmentId}:${quote}`, {
          key: `${segmentId}:${quote}`,
          quote,
          results: [result],
          bbox: ref?.bbox ?? null,
          imageIndex: imageMatch ? Number(imageMatch[1]) - 1 : null,
          locationConfidence: ref?.locationConfidence ?? null,
        });
      }
    }
  }

  const offsets = [
    { x: 0, y: 0 },
    { x: 0.035, y: 0.018 },
    { x: -0.035, y: 0.018 },
    { x: 0.035, y: -0.02 },
    { x: -0.035, y: -0.02 },
  ];
  const occupied = new Map<number, { x: number; y: number }[]>();
  return [...grouped.values()].map((finding) => {
    if (!finding.bbox || finding.imageIndex === null)
      return { ...finding, marker: null };
    const center = {
      x: finding.bbox.x + finding.bbox.width / 2,
      y: finding.bbox.y + finding.bbox.height / 2,
    };
    const used = occupied.get(finding.imageIndex) ?? [];
    const offset =
      offsets.find(
        (candidate) =>
          !used.some(
            (entry) =>
              Math.hypot(
                entry.x - (center.x + candidate.x),
                entry.y - (center.y + candidate.y),
              ) < 0.045,
          ),
      ) ?? offsets[0];
    const marker = {
      x: Math.max(0.025, Math.min(0.95, center.x + offset.x)),
      y: Math.max(0.025, Math.min(0.95, center.y + offset.y)),
    };
    used.push(marker);
    occupied.set(finding.imageIndex, used);
    return { ...finding, marker };
  });
}

function severityLabel(finding: Finding) {
  return finding.results.some((item) => item.severity === "HIGH")
    ? "高风险"
    : finding.results.some((item) => item.severity === "MEDIUM")
      ? "中风险"
      : "低风险";
}

// The structured result remains the source of the rule decision. This small
// presentation helper only makes repeated A-05 advice actionable when one
// rule result contains several separate phrases on the same material.
function contextualSuggestion(finding: Finding, fallback: string) {
  const rules = new Set(finding.results.map((item) => item.ruleId));
  if (!rules.has("A-05")) return fallback;
  if (/温和\s*有效/.test(finding.quote))
    return "“有效”属于明确效果主张；没有验证材料时可保留“温和”，改为“温和呵护肌肤”。";
  if (/(焕亮|水润|细腻|透光|光泽)/.test(finding.quote))
    return "没有对应测试或报告时，可改为偏感受或视觉风格的表达，例如“打造透亮光泽感”，避免承诺具体功效结果。";
  if (/(改善|修护|提亮|淡斑|祛痘|去痘)/.test(finding.quote))
    return "如无可识别的测试依据，删除确定性的改善或修护结果；如保留该主张，请补充当前素材内可识别的测试条件或报告信息。";
  return fallback;
}

function humanDecisionLabel(decision: HumanDecision) {
  if (decision === "APPROVED") return "审核通过";
  if (decision === "CONFIRMED_NEEDS_CHANGES") return "确认需修改";
  if (decision === "FALSE_POSITIVE") return "已标记误判";
  if (decision === "PENDING") return "待处理";
  return "未处理";
}

function requiresHumanReview(result: RuleResult) {
  return (
    (result.ruleId === "A-06" && result.status === "RISK") ||
    (result.ruleId === "A-09" && result.status === "UNCERTAIN")
  );
}

function ResultGroup({
  title,
  count,
  tone,
  defaultOpen = false,
  children,
}: {
  title: string;
  count: number;
  tone: "risk" | "supplement" | "human";
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const marker =
    tone === "risk"
      ? "bg-[#fff0ed] text-[#b83b34]"
      : tone === "supplement"
        ? "bg-[#fff7e6] text-[#a55f00]"
        : "bg-[#eef3ff] text-[var(--primary)]";
  return (
    <details
      open={defaultOpen}
      className="mt-4 overflow-hidden rounded-lg border border-[var(--border)] bg-white"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 hover:bg-[#fafbfc]">
        <span className="font-semibold">{title}</span>
        <span className={`rounded px-2 py-1 text-xs font-medium ${marker}`}>
          {count}
        </span>
      </summary>
      <div className="border-t border-[var(--border)]">{children}</div>
    </details>
  );
}

function FindingRow({
  finding,
  index,
  selected,
  onSelect,
  onFeedback,
  onCopy,
}: {
  finding: Finding;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onFeedback: () => void;
  onCopy: (text: string) => void;
}) {
  const names = [...new Set(finding.results.map((item) => item.ruleName))];
  const ids = [...new Set(finding.results.map((item) => item.ruleId))];
  const reason = [...new Set(finding.results.map((item) => item.reason))].join(
    "；",
  );
  const baseSuggestion = [
    ...new Set(
      finding.results
        .map((item) => item.suggestion)
        .filter((item): item is string => Boolean(item)),
    ),
  ].join("；");
  const suggestion = baseSuggestion
    ? contextualSuggestion(finding, baseSuggestion)
    : "";
  return (
    <article
      onClick={onSelect}
      className={`cursor-pointer px-4 py-4 transition ${selected ? "bg-[#f7faff]" : "hover:bg-[#fbfcfe]"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">
            {finding.marker ? `${index + 1}. ` : ""}“{finding.quote}”
          </p>
          <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
            {names.join(" · ")}{" "}
            <span className="ml-1 text-xs text-[var(--text-tertiary)]">
              {ids.join(" · ")}
            </span>
          </p>
        </div>
        <span className="shrink-0 rounded bg-[#fff0ed] px-2 py-1 text-xs font-semibold text-[#a13b31]">
          {severityLabel(finding)}
        </span>
      </div>
      {suggestion && (
        <div className="mt-3 border-l-2 border-[var(--accent)] pl-3 text-sm leading-6 text-[#1f5a53]">
          <span className="font-semibold">建议修改：</span>
          {suggestion}
        </div>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (suggestion) onCopy(suggestion);
          }}
          disabled={!suggestion}
          className="text-xs font-medium text-[var(--primary)] disabled:text-[var(--text-tertiary)]"
        >
          复制建议
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onFeedback();
          }}
          className="text-xs font-medium text-[var(--primary)]"
        >
          标记误判
        </button>
        <details
          onClick={(event) => event.stopPropagation()}
          className="text-xs text-[var(--text-tertiary)]"
        >
          <summary className="cursor-pointer">查看依据</summary>
          <p className="mt-2 max-w-2xl leading-5">{reason}</p>
        </details>
      </div>
    </article>
  );
}

export function ReviewResultView({
  review,
  images,
  humanReview,
  onHumanUpdate,
}: {
  review: ReviewPresentation;
  images: ImageAsset[];
  humanReview?: HumanReview;
  onHumanUpdate?: (input: {
    decision: HumanDecision;
    note?: string;
    feedback?: { findingKey: string; reason: FeedbackReason; note: string };
  }) => void;
}) {
  const findings = useMemo(
    () => groupFindings(review.ruleResults),
    [review.ruleResults],
  );
  const uncertain = review.ruleResults.filter(
    (item) => item.status === "UNCERTAIN",
  );
  const humanFindings = findings.filter((finding) =>
    finding.results.some(requiresHumanReview),
  );
  const modificationFindings = findings.filter(
    (finding) => !finding.results.some(requiresHumanReview),
  );
  const humanUncertain = uncertain.filter(requiresHumanReview);
  const supplementUncertain = uncertain.filter(
    (result) => !requiresHumanReview(result),
  );
  const summary = statusCopy(
    review.overallStatus,
    findings.length,
    uncertain.length,
  );
  const [selectedImage, setSelectedImage] = useState(0);
  const [selectedFinding, setSelectedFinding] = useState<number | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackReason, setFeedbackReason] =
    useState<FeedbackReason>("NOT_A_RISK");
  const [feedbackNote, setFeedbackNote] = useState("");
  const [revision, setRevision] = useState<{
    revisedCopy: string;
    placeholders: string[];
    note: string | null;
  } | null>(null);
  const [revisionState, setRevisionState] = useState<
    "idle" | "loading" | "failed"
  >("idle");
  const [revisionExpanded, setRevisionExpanded] = useState(false);
  const sourceText = useMemo(
    () =>
      review.canonical.extractedTextSegments
        .map((segment) => segment.text)
        .join("\n"),
    [review.canonical],
  );

  async function generateRevision() {
    if (!sourceText) return;
    setRevisionState("loading");
    try {
      const response = await fetch("/api/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceText,
          findings: review.ruleResults.filter((item) => item.status === "RISK"),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.revisedCopy) throw new Error("无法生成修改稿");
      setRevision(data);
      setRevisionState("idle");
    } catch {
      setRevisionState("failed");
    }
  }

  function selectFinding(finding: Finding, index: number) {
    setSelectedFinding(index);
    if (finding.imageIndex !== null) setSelectedImage(finding.imageIndex);
  }

  async function copyRevision() {
    if (revision) await navigator.clipboard.writeText(revision.revisedCopy);
  }
  function saveFalsePositive() {
    // An issue-level correction must not change the material-level outcome.
    onHumanUpdate?.({
      decision: humanReview?.decision ?? null,
      feedback: {
        findingKey:
          selectedFinding === null
            ? "material"
            : (findings[selectedFinding]?.key ?? "material"),
        reason: feedbackReason,
        note: feedbackNote.trim(),
      },
    });
    setFeedbackOpen(false);
    setFeedbackNote("");
  }

  async function copySuggestion(text: string) {
    await navigator.clipboard.writeText(text);
  }

  return (
    <>
      <div className="grid items-start xl:grid-cols-[minmax(360px,45fr)_minmax(420px,55fr)]">
        <section className="border-b border-[var(--border)] bg-[#f8fafc] p-5 xl:sticky xl:top-0 xl:max-h-screen xl:overflow-y-auto xl:border-b-0 xl:border-r sm:p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">素材预览</p>
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                定位可靠时显示问题编号
              </p>
            </div>
            {images.length > 1 && (
              <span className="text-xs text-[var(--text-secondary)]">
                {selectedImage + 1} / {images.length}
              </span>
            )}
          </div>
          {review.canonical.rawUserText && (
            <div className="mt-5">
              <p className="text-xs font-semibold text-[var(--text-secondary)]">
                广告文案
              </p>
              <p className="mt-2 whitespace-pre-wrap rounded-md border border-[var(--border)] bg-white p-3 text-sm leading-6">
                {review.canonical.rawUserText}
              </p>
            </div>
          )}
          {images.length > 0 ? (
            <div className="mt-5">
              {images.length > 1 && (
                <div className="mb-3 flex gap-2 overflow-x-auto">
                  {images.map((image, index) => (
                    <button
                      key={image.url}
                      type="button"
                      onClick={() => setSelectedImage(index)}
                      className={`h-12 w-12 shrink-0 overflow-hidden rounded border ${selectedImage === index ? "border-[var(--primary)] ring-2 ring-[#3370ff]/20" : "border-[var(--border)]"}`}
                    >
                      <Image
                        src={image.url}
                        alt={`图片 ${index + 1}`}
                        width={48}
                        height={48}
                        unoptimized
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
              <div className="relative flex min-h-72 items-center justify-center rounded-md border border-[var(--border)] bg-white p-2">
                <Image
                  src={images[selectedImage].url}
                  alt={images[selectedImage].name}
                  width={1400}
                  height={1600}
                  sizes="(min-width: 1280px) 34vw, 100vw"
                  unoptimized
                  className="max-h-[calc(100vh-190px)] w-full object-contain"
                />
                {findings.map((finding, index) =>
                  finding.marker && finding.imageIndex === selectedImage ? (
                    <button
                      key={finding.key}
                      type="button"
                      aria-label={`定位问题 ${index + 1}`}
                      onClick={() => setSelectedFinding(index)}
                      className={`absolute grid h-7 w-7 place-items-center rounded-full text-xs font-bold text-white shadow-sm ${finding.locationConfidence === "EXACT" ? "bg-[var(--danger)]" : "bg-[var(--warning)]"} ${selectedFinding === index ? "ring-4 ring-[#3370ff]/30" : ""}`}
                      style={{
                        left: `${finding.marker.x * 100}%`,
                        top: `${finding.marker.y * 100}%`,
                        transform: "translate(-50%, -50%)",
                      }}
                    >
                      {index + 1}
                    </button>
                  ) : null,
                )}
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-md border border-dashed border-[var(--border)] bg-white p-4 text-sm leading-6 text-[var(--text-secondary)]">
              此内容项没有图片；审核依据来自广告文案。
            </div>
          )}
        </section>

        <section className="min-w-0 bg-white p-5 sm:p-6">
          <div
            className={`border-l-4 px-4 py-3 ${summary.tone === "pass" ? "border-[#1d8c62] bg-[#eff9f3]" : summary.tone === "risk" ? "border-[#c55449] bg-[#fff4f1]" : "border-[#c5922b] bg-[#fff9e9]"}`}
          >
            <p className="font-semibold">预审结论：{summary.title}</p>
            <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
              {summary.detail}
            </p>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => setAssistantOpen(true)}
              className="rounded-md border border-[#b8ccff] px-3 py-2 text-sm font-medium text-[var(--primary)] hover:bg-[var(--active-bg)]"
            >
              询问审核助手
            </button>
          </div>
          {modificationFindings.length > 0 && (
            <ResultGroup
              title="需要修改"
              count={modificationFindings.length}
              tone="risk"
              defaultOpen={modificationFindings.length <= 3}
            >
              <div className="divide-y divide-[var(--border)]">
                {modificationFindings.map((finding) => {
                  const index = findings.indexOf(finding);
                  return (
                    <FindingRow
                      key={finding.key}
                      finding={finding}
                      index={index}
                      selected={selectedFinding === index}
                      onSelect={() => selectFinding(finding, index)}
                      onFeedback={() => {
                        setSelectedFinding(index);
                        setFeedbackOpen(true);
                      }}
                      onCopy={(suggestion) => void copySuggestion(suggestion)}
                    />
                  );
                })}
              </div>
            </ResultGroup>
          )}
          {supplementUncertain.length > 0 && (
            <ResultGroup
              title="需要补充确认"
              count={supplementUncertain.length}
              tone="supplement"
              defaultOpen={supplementUncertain.length <= 2}
            >
              <div className="divide-y divide-[var(--border)]">
                {supplementUncertain.map((item) => (
                  <article key={item.ruleId} className="px-4 py-4">
                    <p className="font-semibold">
                      {item.ruleName}{" "}
                      <span className="ml-1 text-xs font-normal text-[var(--text-tertiary)]">
                        {item.ruleId}
                      </span>
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                      {item.reason}
                    </p>
                    {item.missingInformation.length > 0 && (
                      <p className="mt-2 text-sm leading-6 text-[#815300]">
                        请补充：{item.missingInformation.join("、")}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </ResultGroup>
          )}
          {(humanFindings.length > 0 || humanUncertain.length > 0) && (
            <ResultGroup
              title="建议人工复核"
              count={humanFindings.length + humanUncertain.length}
              tone="human"
              defaultOpen
            >
              <div className="divide-y divide-[var(--border)]">
                {humanFindings.map((finding) => {
                  const index = findings.indexOf(finding);
                  return (
                    <FindingRow
                      key={finding.key}
                      finding={finding}
                      index={index}
                      selected={selectedFinding === index}
                      onSelect={() => selectFinding(finding, index)}
                      onFeedback={() => {
                        setSelectedFinding(index);
                        setFeedbackOpen(true);
                      }}
                      onCopy={(suggestion) => void copySuggestion(suggestion)}
                    />
                  );
                })}
                {humanUncertain.map((item) => (
                  <article key={item.ruleId} className="px-4 py-4">
                    <p className="font-semibold">
                      {item.ruleName}{" "}
                      <span className="ml-1 text-xs font-normal text-[var(--text-tertiary)]">
                        {item.ruleId}
                      </span>
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                      {item.reason}
                    </p>
                  </article>
                ))}
              </div>
            </ResultGroup>
          )}
          {review.overallStatus === "RISK" && (
            <section className="mt-5 rounded-lg border border-[#cce6e1] bg-[#f7fcfb] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">推荐修改稿</h2>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    仅调整已确认风险，不补造日期、数据或授权。
                  </p>
                </div>
                <div className="flex gap-2">
                  {revision && (
                    <button
                      type="button"
                      onClick={() => void copyRevision()}
                      className="rounded-md border border-[#9ad7cf] bg-white px-3 py-2 text-xs font-medium text-[#087d71]"
                    >
                      复制
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void generateRevision()}
                    disabled={revisionState === "loading"}
                    className="rounded-md border border-[var(--border)] bg-white px-3 py-2 text-xs text-[var(--text-secondary)]"
                  >
                    {revision ? "再生成一版" : "生成修改稿"}
                  </button>
                </div>
              </div>
              {revisionState === "loading" && (
                <p className="mt-3 text-sm text-[var(--text-secondary)]">
                  正在生成修改稿…
                </p>
              )}
              {revisionState === "failed" && (
                <p className="mt-3 text-sm text-[var(--danger)]">
                  暂时无法生成修改稿，请参考逐项建议。
                </p>
              )}
              {revision && (
                <>
                  <button
                    type="button"
                    onClick={() => setRevisionExpanded((current) => !current)}
                    className="mt-3 text-sm font-medium text-[var(--primary)]"
                  >
                    {revisionExpanded ? "收起全文" : "展开全文"}
                  </button>
                  {revisionExpanded && (
                    <p className="mt-3 whitespace-pre-wrap rounded-md border border-[var(--border)] bg-white p-3 text-sm leading-7">
                      {revision.revisedCopy}
                    </p>
                  )}
                </>
              )}
            </section>
          )}
          {(humanFindings.length > 0 ||
            humanUncertain.length > 0 ||
            humanReview?.decision) && (
            <section className="mt-5 rounded-lg border border-[#d9e5ff] bg-[#f7faff] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">人工处理</h2>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">
                    状态：
                    {humanDecisionLabel(humanReview?.decision ?? "PENDING")}
                  </p>
                </div>
                {onHumanUpdate && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onHumanUpdate({ decision: "APPROVED" })}
                      className="rounded-md border border-[#98d4b5] bg-white px-3 py-2 text-sm font-medium text-[#18794e]"
                    >
                      审核通过
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onHumanUpdate({ decision: "CONFIRMED_NEEDS_CHANGES" })
                      }
                      className="rounded-md border border-[#f5c4a8] bg-white px-3 py-2 text-sm font-medium text-[#b54708]"
                    >
                      确认需修改
                    </button>
                    <button
                      type="button"
                      onClick={() => setFeedbackOpen(true)}
                      className="rounded-md border border-[#b8ccff] bg-white px-3 py-2 text-sm font-medium text-[var(--primary)]"
                    >
                      标记误判
                    </button>
                  </div>
                )}
              </div>
              <p className="mt-3 text-xs leading-5 text-[var(--text-secondary)]">
                人工处理不会改写预审结论；“标记误判”仅记录反馈，不会把整条素材自动设为通过。
              </p>
            </section>
          )}
        </section>
      </div>
      <details className="border-t border-[var(--border)] bg-white px-5 py-4 sm:px-6">
        <summary className="cursor-pointer text-sm font-semibold">
          查看审核详情 / 技术详情
        </summary>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          内部状态：{review.overallStatus} · 已检查 {review.trace.rulesChecked}
          /10 条规则 · 自动修复 {review.trace.retryCount}/1 次 · 模型{" "}
          {review.trace.model}
        </p>
      </details>
      {feedbackOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="标记误判"
          className="fixed inset-0 z-50 grid place-items-center bg-[#1f2329]/35 p-4"
        >
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold">标记误判</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              这不会把整份素材自动设为通过，只会记录本次人工反馈。
            </p>
            <label
              className="mt-4 block text-sm font-medium"
              htmlFor="feedback-reason"
            >
              反馈原因
            </label>
            <select
              id="feedback-reason"
              value={feedbackReason}
              onChange={(event) =>
                setFeedbackReason(event.target.value as FeedbackReason)
              }
              className="mt-2 w-full rounded-md border border-[var(--border)] px-3 py-2 text-sm"
            >
              {feedbackOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <label
              className="mt-4 block text-sm font-medium"
              htmlFor="feedback-note"
            >
              补充说明（可选）
            </label>
            <textarea
              id="feedback-note"
              value={feedbackNote}
              onChange={(event) => setFeedbackNote(event.target.value)}
              className="mt-2 min-h-24 w-full rounded-md border border-[var(--border)] p-3 text-sm outline-none focus:border-[var(--primary)]"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setFeedbackOpen(false)}
                className="rounded-md border border-[var(--border)] px-3 py-2 text-sm"
              >
                取消
              </button>
              <button
                type="button"
                onClick={saveFalsePositive}
                className="rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-medium text-white"
              >
                保存反馈
              </button>
            </div>
          </div>
        </div>
      )}
      {assistantOpen && (
        <ReviewAssistantDrawer
          review={review}
          onClose={() => setAssistantOpen(false)}
        />
      )}
    </>
  );
}
