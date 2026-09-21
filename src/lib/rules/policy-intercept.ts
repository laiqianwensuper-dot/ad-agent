import type { CanonicalContent, ModelReview, ModelRuleResult } from "@/lib/schemas/review";

const absoluteEffect = /(?:100\s*%|百分之百)\s*(?:有效|见效)/i;
const statisticalSignal = /(?:用户|销量|增长|提升|调研|样本|订单|购买|人数|件)/;

function findRule(review: ModelReview, ruleId: ModelRuleResult["ruleId"]) {
  return review.ruleResults.find((item) => item.ruleId === ruleId)!;
}

function setRisk(rule: ModelRuleResult, evidence: string, reason: string, suggestion: string) {
  rule.status = "RISK";
  rule.evidence = [...new Set([...rule.evidence, evidence])];
  rule.reason = reason;
  rule.suggestion = suggestion;
  rule.missingInformation = [];
}

/**
 * Small, auditable policy corrections for highly ambiguous surface forms. They
 * run after model reasoning and before Validator so the rule registry remains
 * the source of truth while common false positives stay deterministic.
 */
export function enforceRulePolicy(review: ModelReview, canonical: CanonicalContent): ModelReview {
  const text = canonical.extractedTextSegments.map((segment) => segment.text).join("\n");
  const normalized = text.match(absoluteEffect)?.[0];
  const result: ModelReview = { ruleResults: review.ruleResults.map((item) => ({ ...item, evidence: [...item.evidence], missingInformation: [...item.missingInformation] })) };

  if (normalized) {
    const a01 = findRule(result, "A-01");
    const a05 = findRule(result, "A-05");
    setRisk(a01, normalized, "“100%有效”属于无法由当前材料证明的绝对化效果表述。", "删除确定性承诺，或改为有明确依据支持的限定性表达。");
    setRisk(a05, normalized, "“100%有效”对使用效果作出了确定性保证，当前材料未提供可验证依据。", "避免保证所有用户获得相同效果，改为不作确定性承诺的表述。");

    const a02 = findRule(result, "A-02");
    const a02Evidence = a02.evidence.join(" ");
    if (!statisticalSignal.test(a02Evidence.replace(normalized, "")) && !statisticalSignal.test(text.replace(normalized, ""))) {
      a02.status = "PASS";
      a02.evidence = [];
      a02.reason = "“100%有效”是绝对化效果表述，不作为统计数据宣传处理。";
      a02.suggestion = null;
      a02.missingInformation = [];
    }
  }
  return result;
}
