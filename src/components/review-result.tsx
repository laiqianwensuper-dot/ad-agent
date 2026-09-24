"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import type {
  FeedbackReason,
  HumanDecision,
  HumanReview,
  ReviewPresentation,
} from "@/lib/review-task-store";
import { getRule } from "@/lib/rules/registry";
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

function contextualSuggestion(
  ruleIds: string[],
  evidence: string[],
  fallback: string,
) {
  const rules = new Set(ruleIds);
  const quote = evidence.join("；");
  if (!rules.has("A-05")) return fallback;
  if (/温和\s*有效/.test(quote))
    return "“有效”属于明确效果主张；没有验证材料时可保留“温和”，改为“温和呵护肌肤”。";
  if (/(焕亮|水润|细腻|透光|光泽)/.test(quote))
    return "没有对应测试或报告时，可改为偏感受或视觉风格的表达，例如“打造透亮光泽感”，避免承诺具体功效结果。";
  if (/(改善|修护|提亮|淡斑|祛痘|去痘)/.test(quote))
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

function ruleNeedsHumanReview(result: RuleResult) {
  return (
    (result.ruleId === "A-06" && result.status === "RISK") ||
    (result.ruleId === "A-09" && result.status === "UNCERTAIN")
  );
}

type IssueTab = "MODIFY" | "SUPPLEMENT" | "HUMAN" | "HISTORY";
type IssueRow = {
  id: string;
  title: string;
  quote: string;
  evidence: string[];
  type: string;
  ruleIds: string[];
  severity: string | null;
  reason: string;
  suggestion: string | null;
  missingInformation: string[];
  finding: Finding | null;
  findingIndex: number | null;
  human: boolean;
  humanIssueKey?: string;
};

function severityLabel(results: RuleResult[]) {
  return results.some((item) => item.severity === "HIGH")
    ? "高风险"
    : results.some((item) => item.severity === "MEDIUM")
      ? "中风险"
      : "低风险";
}

function issueFromRiskRule(
  result: RuleResult,
  findings: Finding[],
): IssueRow {
  const evidence = [...new Set(result.evidence)];
  const findingIndex = findings.findIndex((finding) =>
    finding.results.some((candidate) => candidate.ruleId === result.ruleId),
  );
  const finding = findingIndex >= 0 ? findings[findingIndex] : null;
  const suggestion = [
    ...new Set(
      [result]
        .map((item) => item.suggestion)
        .filter((item): item is string => Boolean(item)),
    ),
  ].join("；");
  return {
    id: `risk:${result.ruleId}`,
    title: `${result.ruleName}${evidence.length > 1 ? `（${evidence.length}处）` : ""}`,
    quote: evidence.length === 1 ? evidence[0] : `${evidence[0] ?? result.ruleName} 等 ${evidence.length} 处`,
    evidence,
    type: result.ruleName,
    ruleIds: [result.ruleId],
    severity: severityLabel([result]),
    reason: result.reason,
    suggestion: suggestion
      ? contextualSuggestion([result.ruleId], evidence, suggestion)
      : null,
    missingInformation: [],
    finding,
    findingIndex: findingIndex >= 0 ? findingIndex : null,
    human: ruleNeedsHumanReview(result),
    humanIssueKey: result.ruleId === "A-06" ? "human:A-06" : undefined,
  };
}

function issueFromUncertain(result: RuleResult): IssueRow {
  const human = ruleNeedsHumanReview(result);
  return {
    id: `uncertain-${result.ruleId}`,
    title: result.ruleName,
    quote: result.evidence.join("；") || result.ruleName,
    evidence: result.evidence,
    type: result.ruleName,
    ruleIds: [result.ruleId],
    severity: null,
    reason: result.reason,
    suggestion: result.suggestion,
    missingInformation: result.missingInformation,
    finding: null,
    findingIndex: null,
    human,
    humanIssueKey: human ? "human:A-09" : undefined,
  };
}

function mergeSameEvidenceIssues(rows: IssueRow[]): IssueRow[] {
  const merged = new Map<string, IssueRow>();
  for (const row of rows) {
    const evidenceKey = [...row.evidence].sort().join("\u0001");
    const key = evidenceKey || row.id;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, row);
      continue;
    }
    existing.ruleIds = [...new Set([...existing.ruleIds, ...row.ruleIds])];
    existing.type = [...new Set([existing.type, row.type])].join(" · ");
    existing.title = existing.type;
    existing.severity =
      existing.severity === "高风险" || row.severity === "高风险"
        ? "高风险"
        : "中风险";
    existing.reason = [...new Set([existing.reason, row.reason])].join("；");
    existing.suggestion = [existing.suggestion, row.suggestion]
      .filter((item): item is string => Boolean(item))
      .join("；");
    // A shared evidence row may be both a normal modification and a human
    // review issue (for example A-05 plus A-06). Preserve the stricter route.
    existing.human = existing.human || row.human;
    existing.humanIssueKey ??= row.humanIssueKey;
  }
  return [...merged.values()];
}

function fallbackHumanIssue(): IssueRow {
  return {
    id: "human:system-fallback",
    title: "系统审核结果待人工确认",
    quote: "审核服务未能形成可验证结论",
    evidence: [],
    type: "系统结果确认",
    ruleIds: [],
    severity: null,
    reason: "模型服务或结果校验在重试后仍未完成，系统未将素材误判为通过，需人工确认后续处理。",
    suggestion: "请核对素材与审核服务状态；必要时重新发起审核。",
    missingInformation: ["可验证的审核结果"],
    finding: null,
    findingIndex: null,
    human: true,
    humanIssueKey: "human:system-fallback",
  };
}

function IssueTable({
  rows,
  onOpen,
}: {
  rows: IssueRow[];
  onOpen: (row: IssueRow) => void;
}) {
  if (!rows.length) {
    return (
      <div className="px-4 py-10 text-center text-sm text-[var(--text-secondary)]">
        当前没有此类问题。
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[620px] w-full text-left text-sm">
        <thead className="border-b border-[var(--border)] bg-[#fafbfc] text-xs text-[var(--text-tertiary)]">
          <tr>
            <th className="w-12 px-4 py-3 font-medium">#</th>
            <th className="min-w-44 px-3 py-3 font-medium">风险问题</th>
            <th className="px-3 py-3 font-medium">关联规则</th>
            <th className="px-3 py-3 font-medium">等级</th>
            <th className="min-w-52 px-4 py-3 font-medium">问题说明</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.id}
              onClick={() => onOpen(row)}
              className="cursor-pointer border-b border-[var(--border)] transition hover:bg-[#f7faff]"
            >
              <td className="px-4 py-3.5 text-[var(--text-tertiary)]">
                {index + 1}
              </td>
              <td className="max-w-56 truncate px-3 py-3.5 font-medium">
                {row.title}
                <p className="mt-1 truncate text-xs font-normal text-[var(--text-tertiary)]">
                  {row.quote}
                </p>
              </td>
              <td className="px-3 py-3.5 text-[var(--text-secondary)]">
                {row.ruleIds.join(" / ")}
              </td>
              <td className="px-3 py-3.5">
                {row.severity ? (
                  <span className="rounded bg-[#fff0ed] px-2 py-1 text-xs font-medium text-[#b83b34]">
                    {row.severity}
                  </span>
                ) : (
                  <span className="text-[var(--text-tertiary)]">—</span>
                )}
              </td>
              <td className="max-w-72 truncate px-4 py-3.5 text-[var(--text-secondary)]">
                {row.reason}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IssueDrawer({
  row,
  onClose,
  onFeedback,
  onCopy,
  onHumanUpdate,
}: {
  row: IssueRow;
  onClose: () => void;
  onFeedback: () => void;
  onCopy: (text: string) => void;
  onHumanUpdate?: (decision: HumanDecision) => void;
}) {
  const ruleDescription = row.ruleIds
    .map(
      (ruleId) =>
        `${ruleId} ${getRule(ruleId as RuleResult["ruleId"]).source_requirement}`,
    )
    .join("；");
  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-[#1f2329]/20"
      onClick={onClose}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="问题详情"
        onClick={(event) => event.stopPropagation()}
        className="h-full w-full max-w-[440px] overflow-y-auto border-l border-[var(--border)] bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-lg font-semibold">
            {row.human ? "人工复核" : "问题详情"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[var(--text-secondary)]"
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <div className="space-y-6 p-5">
          <div>
            <p className="text-base font-semibold leading-7">{row.title}</p>
            {row.evidence.length > 0 && (
              <div className="mt-3 rounded-md bg-[#f8fafc] p-3 text-sm leading-6 text-[var(--text-secondary)]">
                <p className="mb-1 text-xs font-medium text-[var(--text-tertiary)]">
                  涉及表述
                </p>
                {row.evidence.map((quote) => (
                  <p key={quote}>“{quote}”</p>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded bg-[#f3f5f8] px-2 py-1 text-[var(--text-secondary)]">
                {row.type}
              </span>
              <span className="rounded bg-[#f3f5f8] px-2 py-1 text-[var(--text-secondary)]">
                {row.ruleIds.join(" / ")}
              </span>
              {row.severity && (
                <span className="rounded bg-[#fff0ed] px-2 py-1 text-[#b83b34]">
                  {row.severity}
                </span>
              )}
            </div>
          </div>
          <section>
            <h3 className="text-sm font-semibold">
              {row.human ? "为什么需要人工确认" : "问题说明"}
            </h3>
            <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
              {row.reason}
            </p>
          </section>
          {row.missingInformation.length > 0 && (
            <section className="border-t border-[var(--border)] pt-5">
              <h3 className="text-sm font-semibold">建议补充</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                {row.missingInformation.join("、")}
              </p>
            </section>
          )}
          {row.suggestion && (
            <section className="border-t border-[var(--border)] pt-5">
              <h3 className="text-sm font-semibold">修改建议</h3>
              <p className="mt-2 rounded-md bg-[#f8fafc] p-3 text-sm leading-6 text-[var(--text-secondary)]">
                {row.suggestion}
              </p>
              <button
                type="button"
                onClick={() => onCopy(row.suggestion!)}
                className="mt-3 text-sm font-medium text-[var(--primary)]"
              >
                复制建议
              </button>
            </section>
          )}
          <section className="border-t border-[var(--border)] pt-5">
            <h3 className="text-sm font-semibold">审核依据</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
              {ruleDescription}
            </p>
          </section>
          {row.human && onHumanUpdate ? (
            <section className="border-t border-[var(--border)] pt-5">
              <h3 className="text-sm font-semibold">人工处理</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onHumanUpdate("CONFIRMED_NEEDS_CHANGES")}
                  className="rounded-md border border-[#f5c4a8] px-3 py-2 text-sm font-medium text-[#b54708]"
                >
                  确认需修改
                </button>
                <button
                  type="button"
                  onClick={() => onFeedback()}
                  className="rounded-md border border-[#b8ccff] px-3 py-2 text-sm font-medium text-[var(--primary)]"
                >
                  标记误判
                </button>
                <button
                  type="button"
                  onClick={() => onHumanUpdate("APPROVED")}
                  className="rounded-md border border-[#98d4b5] px-3 py-2 text-sm font-medium text-[#18794e]"
                >
                  审核通过
                </button>
              </div>
            </section>
          ) : (
            <button
              type="button"
              onClick={onFeedback}
              className="border-t border-[var(--border)] pt-5 text-sm font-medium text-[var(--primary)]"
            >
              标记误判
            </button>
          )}
        </div>
      </aside>
    </div>
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
    issueKey?: string;
    decision?: HumanDecision;
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
  const issueRows = mergeSameEvidenceIssues(
    review.ruleResults
      .filter((result) => result.status === "RISK")
      .map((result) => issueFromRiskRule(result, findings)),
  );
  const modificationRows = issueRows.filter((row) => !row.human);
  const ruleHumanRows = [
    ...issueRows.filter((row) => row.human),
    ...uncertain.filter(ruleNeedsHumanReview).map(issueFromUncertain),
  ];
  const pendingHumanRows = ruleHumanRows.filter(
    (row) =>
      !row.humanIssueKey ||
      !humanReview?.issueReviews.some(
        (item) => item.issueKey === row.humanIssueKey,
      ),
  );
  const humanRows =
    review.needHumanReview && pendingHumanRows.length === 0 && !humanReview?.issueReviews.length
      ? [fallbackHumanIssue()]
      : pendingHumanRows;
  const supplementRows = uncertain
    .filter((result) => !ruleNeedsHumanReview(result))
    .map(issueFromUncertain);
  const [selectedImage, setSelectedImage] = useState(0);
  const [selectedFinding, setSelectedFinding] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<IssueTab>("MODIFY");
  const [selectedIssue, setSelectedIssue] = useState<IssueRow | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackReason, setFeedbackReason] =
    useState<FeedbackReason>("NOT_A_RISK");
  const [feedbackNote, setFeedbackNote] = useState("");
  function selectFinding(finding: Finding, index: number) {
    setSelectedFinding(index);
    if (finding.imageIndex !== null) setSelectedImage(finding.imageIndex);
  }

  function saveFalsePositive() {
    // An issue-level correction must not change the material-level outcome.
    onHumanUpdate?.({
      issueKey: selectedIssue?.humanIssueKey,
      decision: selectedIssue?.human ? "FALSE_POSITIVE" : undefined,
      feedback: {
        findingKey:
          selectedIssue?.id ??
          (selectedFinding === null
            ? "material"
            : (findings[selectedFinding]?.key ?? "material")),
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

        <section className="min-w-0 bg-white">
          <div className="border-b border-[var(--border)] px-5 py-4 sm:px-6">
            <h2 className="font-semibold">审核结果</h2>
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span>
                系统预审{" "}
                <span
                  className={`ml-2 rounded px-2 py-1 text-xs font-medium ${review.overallStatus === "PASS" ? "bg-[#ecf8ef] text-[#237a4d]" : review.overallStatus === "RISK" ? "bg-[#fff0ed] text-[#b83b34]" : "bg-[#fff7e6] text-[#a55f00]"}`}
                >
                  {review.overallStatus === "RISK"
                    ? "建议修改"
                    : review.overallStatus === "UNCERTAIN"
                      ? "待补充确认"
                      : "已通过"}
                </span>
              </span>
              <span className="text-[var(--text-secondary)]">
                {modificationRows.length} 处问题
              </span>
              <span className="text-[var(--text-secondary)]">
                {humanRows.length} 项建议人工复核
              </span>
            </div>
          </div>
          <div className="flex overflow-x-auto border-b border-[var(--border)] px-3">
            {(
              [
                ["MODIFY", `需要修改（${modificationRows.length}）`],
                ["SUPPLEMENT", `需要补充确认（${supplementRows.length}）`],
                ["HUMAN", `建议人工复核（${humanRows.length}）`],
                ["HISTORY", "处理记录"],
              ] as const
            ).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`shrink-0 border-b-2 px-3 py-3 text-sm ${activeTab === tab ? "border-[var(--primary)] font-semibold text-[var(--primary)]" : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {activeTab === "MODIFY" && (
            <IssueTable
              rows={modificationRows}
              onOpen={(row) => {
                if (row.finding && row.findingIndex !== null)
                  selectFinding(row.finding, row.findingIndex);
                setSelectedIssue(row);
              }}
            />
          )}
          {activeTab === "SUPPLEMENT" && (
            <IssueTable rows={supplementRows} onOpen={setSelectedIssue} />
          )}
          {activeTab === "HUMAN" && (
            <IssueTable
              rows={humanRows}
              onOpen={(row) => {
                if (row.finding && row.findingIndex !== null)
                  selectFinding(row.finding, row.findingIndex);
                setSelectedIssue(row);
              }}
            />
          )}
          {activeTab === "HISTORY" && (
            <div className="space-y-4 px-5 py-6 text-sm text-[var(--text-secondary)]">
              <div className="border-l-2 border-[var(--primary)] pl-3">
                系统完成首次预审，结果：
                {review.overallStatus === "RISK"
                  ? "建议修改"
                  : review.overallStatus === "UNCERTAIN"
                    ? "待补充确认"
                    : "已通过"}
                。
              </div>
              {humanReview?.issueFeedback.map((feedback) => (
                <div
                  key={feedback.createdAt}
                  className="border-l-2 border-[#d9e2f0] pl-3"
                >
                  问题被标记为误判：{feedback.reason}
                </div>
              ))}
              {humanReview?.issueReviews.map((item) => (
                <div key={item.issueKey} className="border-l-2 border-[#d9e2f0] pl-3">
                  人工处理结果：{humanDecisionLabel(item.decision)}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <details className="border-t border-[var(--border)] bg-white px-5 py-4 sm:px-6">
        <summary className="cursor-pointer text-sm font-semibold">
          查看审核范围与处理说明
        </summary>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          已按 A-01 至 A-10
          完成预审。明确风险进入“需要修改”，素材信息不完整进入“需要补充确认”，仅敏感词与背书真实性情形进入“建议人工复核”。
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
      {selectedIssue && (
        <IssueDrawer
          row={selectedIssue}
          onClose={() => setSelectedIssue(null)}
          onFeedback={() => setFeedbackOpen(true)}
          onCopy={(suggestion) => void copySuggestion(suggestion)}
          onHumanUpdate={
            onHumanUpdate
              ? (decision) =>
                  onHumanUpdate({
                    issueKey: selectedIssue.humanIssueKey ?? selectedIssue.id,
                    decision,
                  })
              : undefined
          }
        />
      )}
    </>
  );
}
