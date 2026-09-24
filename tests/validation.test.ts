import { describe, expect, it } from "vitest";
import { canonicalizeText } from "../src/lib/agent/canonical-content";
import { aggregateReview, safeFallback } from "../src/lib/agent/result-aggregator";
import { enforceSensitiveTermIntercept } from "../src/lib/rules/sensitive-lexicon";
import { enforceRulePolicy } from "../src/lib/rules/policy-intercept";
import { getRule, getSeverity } from "../src/lib/rules/registry";
import type { ModelReview } from "../src/lib/schemas/review";
import { validateModelReview } from "../src/lib/validation/result-validator";
import { humanReviewIssues } from "../src/lib/review-task-store";

const ruleIds = [
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
] as const;

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

const trace = {
  requestId: "test",
  model: "test",
  retryCount: 0,
  rulesChecked: 10,
  validationErrors: [],
  durationMs: 1,
};

describe("review validator", () => {
  it("requires A-01 to A-10 exactly once", () => {
    const review = passingReview();
    review.ruleResults[9] = { ...review.ruleResults[9], ruleId: "A-09" };
    expect(validateModelReview(review, canonicalizeText("新品上市"))).toEqual(
      expect.arrayContaining([
        expect.stringContaining("重复"),
        expect.stringContaining("A-10"),
      ]),
    );
  });

  it("rejects hallucinated evidence", () => {
    const review = passingReview();
    review.ruleResults[0] = {
      ...review.ruleResults[0],
      status: "RISK",
      evidence: ["不存在的绝对化说法"],
    };
    expect(validateModelReview(review, canonicalizeText("全网第一"))).toEqual(
      expect.arrayContaining([expect.stringContaining("无法在提交素材中定位")]),
    );
  });

  it("forces A-06 to risk and human review when an approved sensitive term is present", () => {
    const content = canonicalizeText("7天治愈痘痘，无副作用。");
    const review = enforceSensitiveTermIntercept(passingReview(), content);
    const result = aggregateReview(review, content, trace);
    const sensitive = result.ruleResults.find((item) => item.ruleId === "A-06");
    expect(sensitive).toMatchObject({
      status: "RISK",
      severity: "HIGH",
      needHumanReview: true,
    });
    expect(result.overallStatus).toBe("RISK");
  });

  it("does not turn a free claim without a fee clue into A-08 uncertainty", () => {
    const content = canonicalizeText("0元领取，点击即得。");
    const result = aggregateReview(passingReview(), content, trace);
    expect(
      result.ruleResults.find((item) => item.ruleId === "A-08")?.status,
    ).toBe("PASS");
    expect(result.overallStatus).toBe("PASS");
  });

  it("does not force A-08 to PASS merely because a fee amount is visible", () => {
    const content = canonicalizeText(
      "0元试用，需支付39元运费，到期自动续费每月59元，可随时取消。",
    );
    const review = passingReview();
    review.ruleResults[7] = {
      ...review.ruleResults[7],
      status: "RISK",
      evidence: ["0元试用"],
      reason: "错误的默认风险。",
      suggestion: "补充费用。",
    };
    const corrected = enforceRulePolicy(review, content);
    expect(
      corrected.ruleResults.find((item) => item.ruleId === "A-08"),
    ).toMatchObject({ status: "RISK" });
  });

  it("only clears A-02 when source, scope and time are all present", () => {
    const content = canonicalizeText(
      "销量突破10万件。数据来源：品牌订单系统；统计口径：已支付订单件数。",
    );
    const review = passingReview();
    review.ruleResults[1] = {
      ...review.ruleResults[1],
      status: "RISK",
      evidence: ["销量突破10万件"],
      reason: "缺少时间范围。",
      suggestion: "补充统计时间。",
    };
    expect(
      enforceRulePolicy(review, content).ruleResults.find(
        (item) => item.ruleId === "A-02",
      )?.status,
    ).toBe("RISK");
  });

  it("does not treat an endorsement claim as verified from page wording alone", () => {
    const content = canonicalizeText("专家王教授推荐本产品；广告页展示已获授权。");
    const review = passingReview();
    review.ruleResults[8] = {
      ...review.ruleResults[8],
      status: "UNCERTAIN",
      reason: "真实性与授权无法从当前素材验证。",
      suggestion: "补充授权材料。",
      missingInformation: ["授权证明"],
    };
    expect(
      enforceRulePolicy(review, content).ruleResults.find(
        (item) => item.ruleId === "A-09",
      )?.status,
    ).toBe("UNCERTAIN");
  });

  it("does not clear A-10 from completeness alone when image quality is unclear", () => {
    const content = {
      ...canonicalizeText("活动规则"),
      inputType: "image" as const,
      isMaterialComplete: true,
      imageQuality: "PARTIAL" as const,
      unclearRegions: ["底部小字"],
    };
    const review = passingReview();
    review.ruleResults[9] = {
      ...review.ruleResults[9],
      status: "UNCERTAIN",
      reason: "底部小字不清晰。",
      suggestion: "上传清晰原图。",
      missingInformation: ["清晰原图"],
    };
    expect(
      enforceRulePolicy(review, content).ruleResults.find(
        (item) => item.ruleId === "A-10",
      )?.status,
    ).toBe("UNCERTAIN");
  });

  it("normalizes an A-10 material-defect risk into supplementation uncertainty", () => {
    const review = passingReview();
    review.ruleResults[9] = {
      ...review.ruleResults[9],
      status: "RISK",
      reason: "图片文字模糊。",
      suggestion: "删除图片。",
      missingInformation: [],
    };
    const corrected = enforceRulePolicy(review, canonicalizeText("活动页截图"));
    expect(corrected.ruleResults[9]).toMatchObject({
      status: "UNCERTAIN",
      evidence: [],
      missingInformation: ["原文件或完整页面"],
    });
  });

  it("uses deterministic A-05 escalation rather than a fixed high-risk rule", () => {
    expect(getSeverity("A-05", "RISK", ["焕亮肤色"])).toBe("MEDIUM");
    expect(getSeverity("A-05", "RISK", ["7天保证见效"])).toBe("HIGH");
    expect(getSeverity("A-05", "RISK", ["28天淡纹"])).toBe("HIGH");
    expect(getSeverity("A-05", "RISK", ["两周改善暗沉"])).toBe("HIGH");
    expect(getSeverity("A-05", "RISK", ["保证改善暗沉"])).toBe("HIGH");
    expect(getSeverity("A-05", "RISK", ["提升50%"])).toBe("HIGH");
    expect(getSeverity("A-05", "RISK", ["100%有效"])).toBe("HIGH");
    expect(getSeverity("A-09", "UNCERTAIN", ["专家推荐"])).toBeNull();
    expect(getSeverity("A-10", "RISK", ["图片文字模糊"])).toBeNull();
  });

  it("does not overwrite model-supported A-05 or A-07 risks with a narrow keyword allowlist", () => {
    const review = passingReview();
    review.ruleResults[4] = {
      ...review.ruleResults[4],
      status: "RISK",
      evidence: ["抗老紧致"],
      reason: "这是需要依据支持的美容效果主张。",
      suggestion: "补充可识别依据或改为非确定性表述。",
    };
    review.ruleResults[6] = {
      ...review.ruleResults[6],
      status: "RISK",
      evidence: ["碾压所有品牌"],
      reason: "这是无法证明的全面优越比较。",
      suggestion: "删除全面优越比较。",
    };
    const corrected = enforceRulePolicy(
      review,
      canonicalizeText("抗老紧致，碾压所有品牌。"),
    );
    expect(corrected.ruleResults[4].status).toBe("RISK");
    expect(corrected.ruleResults[6].status).toBe("RISK");
  });

  it("treats 100%有效 as absolute/effect claims rather than a statistical A-02 claim", () => {
    const content = canonicalizeText("本产品100%有效。");
    const corrected = enforceRulePolicy(passingReview(), content);
    expect(
      corrected.ruleResults.find((item) => item.ruleId === "A-01")?.status,
    ).toBe("RISK");
    expect(
      corrected.ruleResults.find((item) => item.ruleId === "A-05")?.status,
    ).toBe("RISK");
    expect(
      corrected.ruleResults.find((item) => item.ruleId === "A-02")?.status,
    ).toBe("PASS");
  });

  it("keeps actual percentage statistics within A-02", () => {
    const content = canonicalizeText("98%的用户更喜欢本产品。");
    const review = passingReview();
    review.ruleResults[1] = {
      ...review.ruleResults[1],
      status: "RISK",
      evidence: ["98%的用户"],
      reason: "缺少来源。",
      suggestion: "补充来源。",
    };
    expect(
      enforceRulePolicy(review, content).ruleResults.find(
        (item) => item.ruleId === "A-02",
      )?.status,
    ).toBe("RISK");
  });

  it("keeps A-05 effect-claim handling in the rule registry rather than a positive-word allowlist", () => {
    const a05 = getRule("A-05");
    expect(a05.effect_claim_policy).toMatchObject({
      scope: expect.arrayContaining([
        "health",
        "beauty",
        "performance",
        "income",
      ]),
      not_effect_claim: expect.arrayContaining(["抽象 slogan"]),
    });
    expect(a05.decision_policy.RISK).toContain("未发现可识别的验证依据");
  });

  it("keeps confirmed risks visible when another rule is uncertain", () => {
    const review = passingReview();
    review.ruleResults[0] = {
      ...review.ruleResults[0],
      status: "RISK",
      evidence: ["全网第一"],
      reason: "绝对化主张缺少可识别依据。",
      suggestion: "删除绝对化表述。",
    };
    review.ruleResults[9] = {
      ...review.ruleResults[9],
      status: "UNCERTAIN",
      reason: "页面底部被裁切。",
      suggestion: "补充完整页面。",
      missingInformation: ["完整页面"],
    };
    const result = aggregateReview(review, canonicalizeText("全网第一"), trace);
    expect(result.overallStatus).toBe("RISK");
    expect(result.uncertainReasons).toContain("页面底部被裁切。");
  });

  it("prevents a complete PASS when A-10 is uncertain", () => {
    const review = passingReview();
    review.ruleResults[9] = {
      ...review.ruleResults[9],
      status: "UNCERTAIN",
      reason: "图片文字模糊。",
      suggestion: "上传清晰原图。",
      missingInformation: ["清晰文字"],
    };
    expect(
      aggregateReview(review, canonicalizeText("活动信息"), trace)
        .overallStatus,
    ).toBe("UNCERTAIN");
  });

  it("routes A-10 material incompleteness to supplementation instead of the human-review queue", () => {
    const review = passingReview();
    review.ruleResults[9] = {
      ...review.ruleResults[9],
      status: "UNCERTAIN",
      reason: "底部活动规则模糊。",
      suggestion: "上传清晰原图。",
      missingInformation: ["清晰原图"],
    };
    const result = aggregateReview(review, canonicalizeText("活动信息"), trace);
    expect(
      result.ruleResults.find((item) => item.ruleId === "A-10"),
    ).toMatchObject({
      status: "UNCERTAIN",
      needHumanReview: false,
    });
    expect(result.needHumanReview).toBe(false);
  });

  it("creates a visible human queue issue for a safe fallback", () => {
    const result = safeFallback(trace, "审核服务未返回可验证结果。");
    expect(result.needHumanReview).toBe(true);
    expect(
      humanReviewIssues({ ...result, canonical: canonicalizeText("素材") }),
    ).toMatchObject([
      { issueKey: "human:system-fallback" },
    ]);
  });
});
