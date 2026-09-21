import type { CanonicalContent, ModelReview } from "@/lib/schemas/review";

export const sensitiveTerms = [
  "治疗", "治愈", "根治", "包治", "药到病除",
  "无副作用", "绝无副作用", "无任何副作用",
  "零风险", "无风险", "风险为零",
  "稳赚", "保证稳赚", "保本稳赚", "只赚不赔",
] as const;

export function findSensitiveTerms(content: CanonicalContent): string[] {
  const combined = content.extractedTextSegments.map((segment) => segment.text).join("\n");
  return sensitiveTerms.filter((term) => combined.includes(term));
}

/** A-06 is a mandatory intercept: a model cannot downgrade a confirmed lexicon hit. */
export function enforceSensitiveTermIntercept(review: ModelReview, content: CanonicalContent): ModelReview {
  const matched = findSensitiveTerms(content);
  if (matched.length === 0) return review;

  return {
    ...review,
    ruleResults: review.ruleResults.map((result) => result.ruleId === "A-06"
      ? {
          ...result,
          status: "RISK" as const,
          evidence: matched,
          reason: "检测到需拦截的高敏感确定性表述，必须由人工复核。",
          suggestion: "删除或改写敏感表述；如涉及医疗、收益或安全承诺，请提交人工审核。",
          missingInformation: [],
        }
      : result),
  };
}
