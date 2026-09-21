import type { ReviewResult, RuleResult } from "@/lib/schemas/review";

export type EvalExpectation = {
  expectedRiskRules: RuleResult["ruleId"][];
  expectedUncertainRules: RuleResult["ruleId"][];
  expectedOverall: "PASS" | "RISK" | "UNCERTAIN";
  expectedHumanReview: boolean;
};

export type EvalMetrics = {
  riskRecall: number | null;
  ruleAccuracy: number;
  evidenceAccuracy: number;
  falsePositiveRate: number | null;
  abstentionAccuracy: number;
  schemaPassRate: number;
};

export function calculateEvalMetrics(cases: Array<{ expected: EvalExpectation; actual?: ReviewResult; schemaValid: boolean }>): EvalMetrics {
  let expectedRisks = 0;
  let recalledRisks = 0;
  let correctRules = 0;
  let checkedRules = 0;
  let evidencedRisks = 0;
  let actualRisks = 0;
  let cleanCases = 0;
  let falsePositiveCases = 0;
  let abstentionCorrect = 0;
  let schemaPasses = 0;

  for (const testCase of cases) {
    if (testCase.schemaValid) schemaPasses += 1;
    if (!testCase.actual) continue;
    const actualRiskIds = new Set(testCase.actual.ruleResults.filter((item) => item.status === "RISK").map((item) => item.ruleId));
    const expectedRiskIds = new Set(testCase.expected.expectedRiskRules);
    const expectedUncertainIds = new Set(testCase.expected.expectedUncertainRules);

    expectedRisks += expectedRiskIds.size;
    recalledRisks += [...expectedRiskIds].filter((ruleId) => actualRiskIds.has(ruleId)).length;
    actualRisks += actualRiskIds.size;
    evidencedRisks += testCase.actual.ruleResults.filter((item) => item.status === "RISK" && item.evidenceRefs.length > 0).length;
    for (const result of testCase.actual.ruleResults) {
      const expectedStatus = expectedRiskIds.has(result.ruleId) ? "RISK" : expectedUncertainIds.has(result.ruleId) ? "UNCERTAIN" : "PASS";
      if (result.status === expectedStatus) correctRules += 1;
      checkedRules += 1;
    }
    if (expectedRiskIds.size === 0 && expectedUncertainIds.size === 0) {
      cleanCases += 1;
      if (actualRiskIds.size > 0) falsePositiveCases += 1;
    }
    if (expectedUncertainIds.size > 0 && testCase.actual.overallStatus === "UNCERTAIN") abstentionCorrect += 1;
  }

  return {
    riskRecall: expectedRisks ? recalledRisks / expectedRisks : null,
    ruleAccuracy: checkedRules ? correctRules / checkedRules : 0,
    evidenceAccuracy: actualRisks ? evidencedRisks / actualRisks : 1,
    falsePositiveRate: cleanCases ? falsePositiveCases / cleanCases : null,
    abstentionAccuracy: cases.filter((item) => item.expected.expectedUncertainRules.length > 0).length
      ? abstentionCorrect / cases.filter((item) => item.expected.expectedUncertainRules.length > 0).length : 1,
    schemaPassRate: cases.length ? schemaPasses / cases.length : 0,
  };
}
