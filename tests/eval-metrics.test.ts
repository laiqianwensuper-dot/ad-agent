import { describe, expect, it } from "vitest";
import { calculateEvalMetrics } from "../src/lib/eval/metrics";

describe("eval metrics", () => {
  it("does not claim image-model accuracy when no actual review was provided", () => {
    const metrics = calculateEvalMetrics([{
      expected: { expectedRiskRules: ["A-01"], expectedUncertainRules: [], expectedOverall: "RISK", expectedHumanReview: false },
      schemaValid: false,
    }]);
    expect(metrics.riskRecall).toBeNull();
    expect(metrics.schemaPassRate).toBe(0);
  });
});
