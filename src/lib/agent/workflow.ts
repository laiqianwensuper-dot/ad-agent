import { randomUUID } from "node:crypto";
import { aggregateReview, safeFallback } from "@/lib/agent/result-aggregator";
import { configuredModelName, ReviewServiceError, reviewCanonicalContent } from "@/lib/agent/openai-reviewer";
import { enforceSensitiveTermIntercept } from "@/lib/rules/sensitive-lexicon";
import { enforceRulePolicy } from "@/lib/rules/policy-intercept";
import type { CanonicalContent, ReviewResult } from "@/lib/schemas/review";
import { validateModelReview } from "@/lib/validation/result-validator";

export async function runReviewWorkflow(canonical: CanonicalContent): Promise<ReviewResult> {
  const startedAt = Date.now();
  const requestId = randomUUID();
  let validationErrors: string[] = [];

  for (let attempt = 0; attempt <= 1; attempt += 1) {
    try {
      const modelReview = enforceRulePolicy(enforceSensitiveTermIntercept(
        await reviewCanonicalContent(canonical, attempt === 1 ? validationErrors : undefined),
        canonical,
      ), canonical);
      validationErrors = validateModelReview(modelReview, canonical);
      if (validationErrors.length === 0) {
        return aggregateReview(modelReview, canonical, {
          requestId,
          model: configuredModelName(),
          retryCount: attempt,
          rulesChecked: 10,
          validationErrors: [],
          durationMs: Date.now() - startedAt,
        });
      }
    } catch (error) {
      if (error instanceof ReviewServiceError) throw error;
      validationErrors = [error instanceof Error ? error.message : "审核服务发生未知错误。"];
      if (attempt === 0) continue;
    }
  }

  return safeFallback({
    requestId,
    model: configuredModelName(),
    retryCount: 1,
    rulesChecked: 0,
    validationErrors,
    durationMs: Date.now() - startedAt,
  }, "系统无法生成可验证的审核结论。");
}
