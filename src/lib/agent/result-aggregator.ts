import { getRule, getSeverity } from "@/lib/rules/registry";
import type {
  CanonicalContent,
  ModelReview,
  ReviewResult,
  RuleResult,
} from "@/lib/schemas/review";
import { findEvidenceSegment } from "@/lib/validation/evidence";

function humanReviewRequired(
  ruleId: RuleResult["ruleId"],
  status: RuleResult["status"],
): boolean {
  return (
    (ruleId === "A-06" && status === "RISK") ||
    // Authenticity and authorization for endorsements cannot be established
    // from an ad asset alone. A-10, by contrast, asks for clearer material
    // first and therefore belongs in the supplement-confirmation flow.
    (ruleId === "A-09" && status === "UNCERTAIN")
  );
}

export function aggregateReview(
  modelReview: ModelReview,
  canonical: CanonicalContent,
  trace: ReviewResult["trace"],
): ReviewResult {
  const ruleResults: RuleResult[] = modelReview.ruleResults.map((item) => {
    const rule = getRule(item.ruleId);
    return {
      ruleId: item.ruleId,
      ruleName: rule.rule_name,
      status: item.status,
      evidence: item.evidence,
      evidenceRefs: item.evidence.flatMap((quote) => {
        const segment = findEvidenceSegment(quote, canonical);
        return segment
          ? [
              {
                quote,
                segmentId: segment.id,
                source: segment.source,
                bbox: segment.bbox ?? null,
                // Vision coordinates are only shown as user-facing markers when the
                // parser explicitly assigns high extraction confidence. Lower
                // confidence evidence remains text-only rather than a misleading box.
                locationConfidence: segment.bbox
                  ? (segment.confidence ?? 0) >= 0.9
                    ? ("EXACT" as const)
                    : ("APPROXIMATE" as const)
                  : null,
              },
            ]
          : [];
      }),
      reason: item.reason,
      severity: getSeverity(item.ruleId, item.status, item.evidence),
      suggestion: item.suggestion ?? null,
      missingInformation: item.missingInformation,
      needHumanReview: humanReviewRequired(item.ruleId, item.status),
    };
  });

  const hasRisk = ruleResults.some((result) => result.status === "RISK");
  const uncertainResults = ruleResults.filter(
    (result) => result.status === "UNCERTAIN",
  );
  const overallStatus = hasRisk
    ? "RISK"
    : uncertainResults.length > 0
      ? "UNCERTAIN"
      : "PASS";

  return {
    ok: true,
    overallStatus,
    ruleResults,
    needHumanReview: ruleResults.some((result) => result.needHumanReview),
    uncertainReasons: uncertainResults.map((result) => result.reason),
    trace,
  };
}

export function safeFallback(
  trace: ReviewResult["trace"],
  message: string,
): ReviewResult {
  const modelReview: ModelReview = {
    ruleResults: [
      "A-01",
      "A-02",
      "A-03",
      "A-04",
      "A-05",
      "A-06",
      "A-07",
      "A-08",
      "A-09",
      "A-10",
    ].map((ruleId) => ({
      ruleId: ruleId as RuleResult["ruleId"],
      status: "UNCERTAIN" as const,
      evidence: [],
      reason: message,
      suggestion: "请补充完整、清晰的原始广告材料，并由人工复核。",
      missingInformation: ["可验证的审核结果"],
    })),
  };
  const result = aggregateReview(
    modelReview,
    {
      inputType: "text",
      rawUserText: null,
      extractedTextSegments: [],
      visualContext: null,
      imageQuality: null,
      unclearRegions: [],
      isMaterialComplete: null,
    },
    trace,
  );
  return { ...result, needHumanReview: true };
}
