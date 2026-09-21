import type { CanonicalContent, ReviewResult } from "@/lib/schemas/review";

/**
 * The assignment's snake_case ReviewResult remains the machine-facing contract.
 * `presentation` is deliberately separate: it carries UI-only evidence refs and
 * canonical content without weakening the Validator/Eval contract.
 */
export function toReviewApiResponse(review: ReviewResult, canonical: CanonicalContent) {
  const riskResults = review.ruleResults.filter((item) => item.status === "RISK");
  return {
    review: {
      ok: true as const,
      overall_status: review.overallStatus,
      summary: {
        risk_count: riskResults.length,
        high: riskResults.filter((item) => item.severity === "HIGH").length,
        medium: riskResults.filter((item) => item.severity === "MEDIUM").length,
        low: riskResults.filter((item) => item.severity === "LOW").length,
        uncertain_count: review.ruleResults.filter((item) => item.status === "UNCERTAIN").length,
      },
      rule_results: review.ruleResults.map((item) => ({
        rule_id: item.ruleId,
        rule_name: item.ruleName,
        status: item.status,
        evidence: item.evidence,
        reason: item.reason,
        severity: item.severity,
        suggestion: item.suggestion,
        need_human_review: item.needHumanReview,
      })),
      need_human_review: review.needHumanReview,
      uncertain_reasons: review.uncertainReasons,
      trace: {
        request_id: review.trace.requestId,
        model: review.trace.model,
        retry_count: review.trace.retryCount,
        rules_checked: review.trace.rulesChecked,
        validation_errors: review.trace.validationErrors,
        duration_ms: review.trace.durationMs,
      },
    },
    presentation: { review, canonical },
  };
}
