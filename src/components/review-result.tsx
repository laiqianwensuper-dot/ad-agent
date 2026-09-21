"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { ReviewAssistantDrawer } from "@/components/review-assistant-drawer";
import type { ReviewPresentation } from "@/lib/review-task-store";
import type { RuleResult } from "@/lib/schemas/review";

type Finding = { quote: string; results: RuleResult[]; bbox: RuleResult["evidenceRefs"][number]["bbox"] | null; imageIndex: number | null; locationConfidence: "EXACT" | "APPROXIMATE" | null };
type ImageAsset = { url: string; name: string };

function statusCopy(status: ReviewPresentation["overallStatus"], issueCount: number, uncertainCount: number) {
  if (status === "PASS") return { title: "当前未发现明确风险", detail: "当前素材可进入下一发布流程，建议仍按实际发布版本留存审核记录。", tone: "pass" };
  if (status === "UNCERTAIN") return { title: "暂时无法完成审核", detail: `有 ${uncertainCount} 项内容因素材信息不足无法确认，请补充材料后重新审核。`, tone: "uncertain" };
  return { title: "建议修改后发布", detail: `发现 ${issueCount} 处需要修改的问题。完成修改后，请基于最终版本重新审核。`, tone: "risk" };
}

function groupFindings(results: RuleResult[]): Finding[] {
  const grouped = new Map<string, Finding>();
  for (const result of results.filter((item) => item.status === "RISK")) {
    for (const quote of result.evidence) {
      const ref = result.evidenceRefs.find((candidate) => candidate.quote === quote);
      const segmentId = ref?.segmentId ?? "unlocated";
      const currentEntry = [...grouped.entries()].find(([key, finding]) => key.startsWith(`${segmentId}:`) && (finding.quote.includes(quote) || quote.includes(finding.quote)));
      if (currentEntry) {
        const [key, current] = currentEntry;
        current.results.push(result);
        if (quote.length > current.quote.length) {
          grouped.delete(key);
          grouped.set(`${segmentId}:${quote}`, { ...current, quote, bbox: ref?.bbox ?? current.bbox, locationConfidence: ref?.locationConfidence ?? current.locationConfidence });
        }
      } else {
        const match = ref?.segmentId.match(/^image-(\d+):/);
        grouped.set(`${segmentId}:${quote}`, { quote, results: [result], bbox: ref?.bbox ?? null, imageIndex: match ? Number(match[1]) - 1 : null, locationConfidence: ref?.locationConfidence ?? null });
      }
    }
  }
  return [...grouped.values()];
}

export function ReviewResultView({ review, images, onBackToTasks }: { review: ReviewPresentation; images: ImageAsset[]; onBackToTasks?: () => void }) {
  const findings = useMemo(() => groupFindings(review.ruleResults), [review.ruleResults]);
  const uncertain = review.ruleResults.filter((item) => item.status === "UNCERTAIN");
  const summary = statusCopy(review.overallStatus, findings.length, uncertain.length);
  const [revision, setRevision] = useState<{ revisedCopy: string; placeholders: string[]; note: string | null } | null>(null);
  const [revisionState, setRevisionState] = useState<"idle" | "loading" | "failed">("idle");
  const [revisionExpanded, setRevisionExpanded] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState(0);
  const [selectedFinding, setSelectedFinding] = useState<number | null>(null);
  const sourceText = useMemo(() => review.canonical.extractedTextSegments.map((segment) => segment.text).join("\n"), [review.canonical]);
  const hasSourceCopy = Boolean(review.canonical.rawUserText?.trim());

  async function generateRevision() {
    if (!sourceText) return;
    setRevisionState("loading");
    try {
      const response = await fetch("/api/rewrite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceText, findings: review.ruleResults.filter((item) => item.status === "RISK") }) });
      const data = await response.json();
      if (!response.ok || !data.revisedCopy) throw new Error(data.error?.message ?? "无法生成修改稿");
      setRevision(data);
      setRevisionState("idle");
    } catch {
      setRevisionState("failed");
    }
  }

  useEffect(() => {
    if (review.overallStatus !== "RISK" || !sourceText) return undefined;
    // Defer the non-urgent optional rewrite so the review report can paint first.
    const timer = window.setTimeout(() => { void generateRevision(); }, 0);
    return () => window.clearTimeout(timer);
    // This deliberately runs once per immutable review result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review.trace.requestId]);

  async function copyRevision() {
    if (revision) await navigator.clipboard.writeText(revision.revisedCopy);
  }

  return <>
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] px-5 py-4 sm:px-6"><div><p className="text-xs font-semibold tracking-[.12em] text-[var(--accent)]">审核报告</p><h1 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">{summary.title}</h1></div><div className="flex gap-2"><button type="button" onClick={() => setAssistantOpen(true)} className="rounded-md border border-[#b8ccff] px-3 py-2 text-sm font-semibold text-[var(--primary)] hover:bg-[var(--active-bg)]">询问审核助手</button>{onBackToTasks && <button type="button" onClick={onBackToTasks} className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]">返回任务</button>}</div></div>
      <div className="grid items-start lg:grid-cols-[minmax(0,45fr)_minmax(0,55fr)]">
        <aside className="border-b border-[var(--border)] bg-[#f7f9fc] p-5 lg:sticky lg:top-5 lg:self-start lg:max-h-[calc(100vh-40px)] lg:overflow-y-auto lg:border-b-0 lg:border-r sm:p-6"><h2 className="text-sm font-semibold text-[var(--text-primary)]">原始素材</h2>{review.canonical.rawUserText && <div className="mt-4"><p className="text-xs font-semibold tracking-[.08em] text-[var(--text-secondary)]">广告文案</p><p className="mt-2 whitespace-pre-wrap rounded-md border border-[var(--border)] bg-white p-4 text-sm leading-7 text-[var(--text-primary)]">{review.canonical.rawUserText}</p></div>}{images.length > 0 ? <div className="mt-5"><div className="flex items-baseline justify-between gap-3"><p className="text-xs font-semibold tracking-[.08em] text-[var(--text-secondary)]">广告图片</p><p className="text-xs text-[var(--text-tertiary)]">定位可靠时显示编号</p></div>{images.length > 1 && <div className="mt-2 flex gap-2 overflow-x-auto">{images.map((image, index) => <button key={image.url} type="button" onClick={() => setSelectedImage(index)} className={`max-w-32 truncate rounded-md border px-2.5 py-1.5 text-xs ${selectedImage === index ? "border-[var(--primary)] bg-[var(--active-bg)] text-[var(--primary)]" : "border-[var(--border)] bg-white text-[var(--text-secondary)]"}`}>图片 {index + 1}</button>)}</div>}<div className="relative mt-2 flex min-h-56 items-center justify-center overflow-hidden rounded-md border border-[var(--border)] bg-white"><Image src={images[selectedImage].url} alt={images[selectedImage].name} width={1400} height={900} sizes="(min-width: 1024px) 42vw, 100vw" unoptimized className="max-h-[calc(100vh-230px)] w-full object-contain" />{findings.map((finding, index) => finding.bbox && finding.imageIndex === selectedImage ? <button key={`${finding.quote}-${index}`} type="button" aria-label={`定位问题 ${index + 1}`} onClick={() => setSelectedFinding(index)} className={`absolute grid h-7 w-7 place-items-center rounded-full text-xs font-bold text-white ${finding.locationConfidence === "EXACT" ? "bg-[#f54a45]" : "bg-[#ff8800]"} ${selectedFinding === index ? "ring-4 ring-[#3370ff]/30" : ""}`} style={{ left: `${finding.bbox.x * 100}%`, top: `${finding.bbox.y * 100}%` }}>{index + 1}</button> : null)}</div></div> : <p className="mt-4 rounded-md border border-dashed border-[var(--border)] bg-white p-4 text-sm leading-6 text-[var(--text-secondary)]">此任务没有可恢复的原图。旧任务或浏览器存储空间不足时可能无法找回；重新上传审核后的新任务会保存原图。</p>}</aside>

        <div className="p-5 sm:p-6"><div className={`border-l-4 px-4 py-3 ${summary.tone === "pass" ? "border-[#1d8c62] bg-[#eff9f3]" : summary.tone === "risk" ? "border-[#c55449] bg-[#fff4f1]" : "border-[#c5922b] bg-[#fff9e9]"}`}><p className="text-sm font-semibold text-[#183b32]">{summary.title}</p><p className="mt-1 text-sm leading-6 text-[#53656b]">{summary.detail}</p></div>
          {findings.length > 0 && <section className="mt-6"><div className="flex items-baseline justify-between"><h2 className="font-semibold text-[#152d39]">需要修改的问题</h2><span className="text-sm text-[#66767b]">{findings.length} 处</span></div><div className="mt-3 space-y-3">{findings.map((finding, index) => { const labels = [...new Set(finding.results.map((item) => item.ruleName))]; const ruleIds = [...new Set(finding.results.map((item) => item.ruleId))]; const topSeverity = finding.results.some((item) => item.severity === "HIGH") ? "高风险" : finding.results.some((item) => item.severity === "MEDIUM") ? "中风险" : "低风险"; const reasons = [...new Set(finding.results.map((item) => item.reason))].join("；"); const suggestions = [...new Set(finding.results.map((item) => item.suggestion).filter((item): item is string => Boolean(item)))].join("；"); const needsReview = finding.results.some((item) => item.needHumanReview); return <article key={`${finding.quote}-${index}`} onClick={() => { setSelectedFinding(index); if (finding.imageIndex !== null) setSelectedImage(finding.imageIndex); }} className={`cursor-pointer border bg-[#fffefd] p-4 transition ${selectedFinding === index ? "border-[#3370ff] ring-2 ring-[#3370ff]/15" : "border-[#eaded9] hover:border-[#f0c8c1]"}`}><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-[#1d3037]">{finding.bbox ? `${index + 1}. ` : ""}“{finding.quote}”</p><p className="mt-2 text-sm font-medium text-[#41545a]">{labels.join(" · ")}</p></div><span className="shrink-0 rounded-full bg-[#fff0ed] px-2.5 py-1 text-xs font-semibold text-[#a13b31]">{topSeverity}</span></div><p className="mt-3 text-sm leading-6 text-[#56686d]">{reasons}</p><div className="mt-3 border-l-2 border-[#79ad90] bg-[#f4faf6] px-3 py-2 text-sm leading-6 text-[#284a3c]"><span className="font-semibold">建议怎么改：</span>{suggestions}</div>{needsReview && <p className="mt-3 text-xs font-medium text-[#9e3029]">建议人工复核</p>}<details onClick={(event) => event.stopPropagation()} className="mt-3 text-xs text-[#708087]"><summary className="cursor-pointer">查看审核依据</summary><p className="mt-2">对应规则：{ruleIds.join(" / ")}</p></details></article>; })}</div></section>}

          {review.overallStatus === "RISK" && <section className="mt-6 rounded-lg border border-[#cce6e1] bg-[#f7fcfb] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-[var(--text-primary)]">{hasSourceCopy ? "推荐修改稿" : "建议替换文案"}</h2><p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">仅调整已确认风险；不会补造缺失的日期、数据或授权。</p></div><div className="flex gap-2">{revision && <button type="button" onClick={copyRevision} className="rounded-md border border-[#9ad7cf] bg-white px-3 py-2 text-xs font-semibold text-[#087d71]">复制</button>}<button type="button" onClick={() => void generateRevision()} disabled={revisionState === "loading"} className="rounded-md border border-[var(--border)] bg-white px-3 py-2 text-xs text-[var(--text-secondary)] disabled:text-[var(--text-tertiary)]">再生成一版</button></div></div>{revisionState === "loading" && <p className="mt-4 text-sm text-[var(--text-secondary)]">正在生成修改建议…</p>}{revisionState === "failed" && <p className="mt-4 text-sm text-[var(--danger)]">暂时无法生成完整修改稿；请参考上方逐项建议。</p>}{revision && <><div className="mt-4 flex items-center justify-between gap-3"><p className="text-sm text-[var(--text-secondary)]">{revisionExpanded ? "完整修改稿" : "已生成一版整体修改建议"}</p><button type="button" onClick={() => setRevisionExpanded((current) => !current)} className="text-sm font-medium text-[var(--primary)]">{revisionExpanded ? "收起全文" : "展开全文"}</button></div>{revisionExpanded && <p className="mt-3 whitespace-pre-wrap rounded-md border border-[var(--border)] bg-white p-4 text-sm leading-7 text-[var(--text-primary)]">{revision.revisedCopy}</p>}{revisionExpanded && revision.placeholders.length > 0 && <p className="mt-3 text-xs text-[var(--text-secondary)]">仍需补充：{revision.placeholders.join("、")}</p>}</>}</section>}

          {uncertain.length > 0 && <section className="mt-6 border border-[#efd899] bg-[#fffbed] p-4"><h2 className="font-semibold text-[#704f00]">需要补充确认</h2><p className="mt-1 text-sm leading-6 text-[#6c613d]">以下是素材信息不足导致的无法确认，不代表系统故障。</p><div className="mt-3 space-y-2">{uncertain.map((item) => <div key={item.ruleId} className="bg-white/70 p-3"><p className="text-sm font-medium text-[#4f431e]">{item.ruleName}</p><p className="mt-1 text-sm leading-6 text-[#6c613d]">{item.reason}</p>{item.missingInformation.length > 0 && <p className="mt-2 text-xs text-[#6c613d]">建议补充：{item.missingInformation.join("、")}</p>}</div>)}</div></section>}
          {review.needHumanReview && <section className="mt-6 border border-[#f0c8c1] bg-[#fff6f4] p-4"><h2 className="font-semibold text-[#8e2e27]">建议人工复核</h2><p className="mt-1 text-sm leading-6 text-[#8e4b45]">涉及敏感表述、背书真实性/授权或材料完整性问题，请交由合规人员进一步确认。</p></section>}
        </div>
      </div>
      <details className="border-t border-[#e5e9e7] px-5 py-4 sm:px-6"><summary className="cursor-pointer text-sm font-semibold text-[#29434b]">查看审核详情 / 技术详情</summary><p className="mt-3 text-sm text-[#5e7076]">内部状态：{review.overallStatus} · 已检查 {review.trace.rulesChecked}/10 条规则 · 自动修复 {review.trace.retryCount}/1 次 · 模型 {review.trace.model}</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{review.ruleResults.map((item) => <div key={item.ruleId} className="flex justify-between border-b border-[#edf0ee] py-2 text-xs text-[#53666b]"><span>{item.ruleId} · {item.ruleName}</span><span className="font-semibold">{item.status}</span></div>)}</div></details>
    </section>
    {assistantOpen && <ReviewAssistantDrawer review={review} onClose={() => setAssistantOpen(false)} />}
  </>;
}
