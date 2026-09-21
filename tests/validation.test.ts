import { describe, expect, it } from "vitest";
import { canonicalizeText } from "../src/lib/agent/canonical-content";
import { aggregateReview } from "../src/lib/agent/result-aggregator";
import { enforceSensitiveTermIntercept } from "../src/lib/rules/sensitive-lexicon";
import { enforceRulePolicy } from "../src/lib/rules/policy-intercept";
import { getRule } from "../src/lib/rules/registry";
import type { ModelReview } from "../src/lib/schemas/review";
import { validateModelReview } from "../src/lib/validation/result-validator";

const ruleIds = ["A-01", "A-02", "A-03", "A-04", "A-05", "A-06", "A-07", "A-08", "A-09", "A-10"] as const;

function passingReview(): ModelReview {
  return {
    ruleResults: ruleIds.map((ruleId) => ({
      ruleId,
      status: "PASS" as const,
      evidence: [],
      reason: "当前材料未发现该规则的明确风险。",
      suggestion: null,
      missingInformation: [],
    })),
  };
}

const trace = { requestId: "test", model: "test", retryCount: 0, rulesChecked: 10, validationErrors: [], durationMs: 1 };

describe("review validator", () => {
  it("requires A-01 to A-10 exactly once", () => {
    const review = passingReview();
    review.ruleResults[9] = { ...review.ruleResults[9], ruleId: "A-09" };
    expect(validateModelReview(review, canonicalizeText("新品上市"))).toEqual(expect.arrayContaining([expect.stringContaining("重复"), expect.stringContaining("A-10")]));
  });

  it("rejects hallucinated evidence", () => {
    const review = passingReview();
    review.ruleResults[0] = { ...review.ruleResults[0], status: "RISK", evidence: ["不存在的绝对化说法"] };
    expect(validateModelReview(review, canonicalizeText("全网第一"))).toEqual(expect.arrayContaining([expect.stringContaining("无法在提交素材中定位")]));
  });

  it("forces A-06 to risk and human review when an approved sensitive term is present", () => {
    const content = canonicalizeText("7天治愈痘痘，无副作用。");
    const review = enforceSensitiveTermIntercept(passingReview(), content);
    const result = aggregateReview(review, content, trace);
    const sensitive = result.ruleResults.find((item) => item.ruleId === "A-06");
    expect(sensitive).toMatchObject({ status: "RISK", severity: "HIGH", needHumanReview: true });
    expect(result.overallStatus).toBe("RISK");
  });

  it("does not turn a free claim without a fee clue into A-08 uncertainty", () => {
    const content = canonicalizeText("0元领取，点击即得。");
    const result = aggregateReview(passingReview(), content, trace);
    expect(result.ruleResults.find((item) => item.ruleId === "A-08")?.status).toBe("PASS");
    expect(result.overallStatus).toBe("PASS");
  });

  it("treats 100%有效 as absolute/effect claims rather than a statistical A-02 claim", () => {
    const content = canonicalizeText("本产品100%有效。");
    const corrected = enforceRulePolicy(passingReview(), content);
    expect(corrected.ruleResults.find((item) => item.ruleId === "A-01")?.status).toBe("RISK");
    expect(corrected.ruleResults.find((item) => item.ruleId === "A-05")?.status).toBe("RISK");
    expect(corrected.ruleResults.find((item) => item.ruleId === "A-02")?.status).toBe("PASS");
  });

  it("keeps actual percentage statistics within A-02", () => {
    const content = canonicalizeText("98%的用户更喜欢本产品。");
    const review = passingReview();
    review.ruleResults[1] = { ...review.ruleResults[1], status: "RISK", evidence: ["98%的用户"], reason: "缺少来源。", suggestion: "补充来源。" };
    expect(enforceRulePolicy(review, content).ruleResults.find((item) => item.ruleId === "A-02")?.status).toBe("RISK");
  });

  it("keeps A-05 effect-claim handling in the rule registry rather than a positive-word allowlist", () => {
    const a05 = getRule("A-05");
    expect(a05.effect_claim_policy).toMatchObject({
      scope: expect.arrayContaining(["health", "beauty", "performance", "income"]),
      not_effect_claim: expect.arrayContaining(["抽象 slogan"]),
    });
    expect(a05.decision_policy.RISK).toContain("未发现可识别的验证依据");
  });

  it("keeps confirmed risks visible when another rule is uncertain", () => {
    const review = passingReview();
    review.ruleResults[0] = { ...review.ruleResults[0], status: "RISK", evidence: ["全网第一"], reason: "绝对化主张缺少可识别依据。", suggestion: "删除绝对化表述。" };
    review.ruleResults[9] = { ...review.ruleResults[9], status: "UNCERTAIN", reason: "页面底部被裁切。", suggestion: "补充完整页面。", missingInformation: ["完整页面"] };
    const result = aggregateReview(review, canonicalizeText("全网第一"), trace);
    expect(result.overallStatus).toBe("RISK");
    expect(result.uncertainReasons).toContain("页面底部被裁切。");
  });

  it("prevents a complete PASS when A-10 is uncertain", () => {
    const review = passingReview();
    review.ruleResults[9] = { ...review.ruleResults[9], status: "UNCERTAIN", reason: "图片文字模糊。", suggestion: "上传清晰原图。", missingInformation: ["清晰文字"] };
    expect(aggregateReview(review, canonicalizeText("活动信息"), trace).overallStatus).toBe("UNCERTAIN");
  });
});
