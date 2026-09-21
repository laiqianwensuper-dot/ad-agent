import { ruleIds, type RuleId } from "@/lib/rules/registry";
import type { CanonicalContent, ModelReview } from "@/lib/schemas/review";
import { validateEvidence } from "@/lib/validation/evidence";

export function validateRuleCoverage(review: ModelReview): string[] {
  const errors: string[] = [];
  const ids = review.ruleResults.map((result) => result.ruleId);
  const uniqueIds = new Set(ids);

  if (ids.length !== ruleIds.length) errors.push(`规则结果应为 ${ruleIds.length} 条，实际为 ${ids.length} 条。`);
  if (uniqueIds.size !== ids.length) errors.push("规则结果存在重复 Rule ID。");

  for (const ruleId of ruleIds) {
    if (!uniqueIds.has(ruleId)) errors.push(`缺少规则 ${ruleId}。`);
  }
  for (const ruleId of uniqueIds) {
    if (!ruleIds.includes(ruleId as RuleId)) errors.push(`存在未知规则 ${ruleId}。`);
  }
  return errors;
}

export function validateModelReview(review: ModelReview, content: CanonicalContent): string[] {
  const errors = validateRuleCoverage(review);
  for (const result of review.ruleResults) {
    if (result.status !== "RISK") continue;
    if (result.ruleId === "A-10") continue;
    if (result.evidence.length === 0) {
      errors.push(`${result.ruleId} 为 RISK 但没有风险原文。`);
      continue;
    }
    for (const quote of result.evidence) {
      const evidenceError = validateEvidence(quote, content);
      if (evidenceError) errors.push(`${result.ruleId}：${evidenceError}`);
    }
  }
  return errors;
}
