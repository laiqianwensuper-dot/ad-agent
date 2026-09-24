import ruleRegistry from "../../../rules.json";
import severityPolicy from "../../../severity_policy.json";
import type { z } from "zod";
import { ruleIdSchema } from "@/lib/schemas/review";

export type RuleId = z.infer<typeof ruleIdSchema>;

export type RegisteredRule = {
  rule_id: RuleId;
  rule_name: string;
  source_requirement: string;
  detection_focus: string[];
  required_information: string[];
  decision_policy: Record<"RISK" | "PASS" | "UNCERTAIN", string>;
  effect_claim_policy?: {
    scope: string[];
    not_effect_claim: string[];
    evidence_scope: string;
  };
  human_review_policy: string;
};

export const rules = ruleRegistry.rules as RegisteredRule[];
export const ruleIds = ruleRegistry.meta.allowed_rule_ids as RuleId[];
export const ruleById = new Map(rules.map((rule) => [rule.rule_id, rule]));
export const severityByRule = severityPolicy.default_by_rule as Record<RuleId, "HIGH" | "MEDIUM" | "LOW" | null>;

/**
 * Severity is a prototype triage policy, not a model judgement. `status`
 * answers whether a problem is confirmed; this function only prioritises a
 * confirmed problem. UNCERTAIN results deliberately have no severity.
 */
export function getSeverity(
  ruleId: RuleId,
  status: "RISK" | "PASS" | "UNCERTAIN",
  evidence: string[],
): "HIGH" | "MEDIUM" | "LOW" | null {
  if (status !== "RISK") return null;
  // A-10 describes insufficient material rather than a confirmed violation.
  // It may be retained as RISK by an upstream integration, but it must not
  // receive a triage severity intended for actionable compliance issues.
  if (ruleId === "A-10") return null;
  if (ruleId === "A-06") return "HIGH";

  if (ruleId === "A-05") {
    const text = evidence.join(" ");
    const isStrongEffectClaim =
      /(?:保证|必然|确保).{0,12}(?:见效|有效|改善|提亮|焕亮|淡斑|淡纹|祛痘)|(?:\d+|[一二三四五六七八九十两]+)\s*(?:天|日|周|星期).{0,12}(?:见效|有效|改善|提亮|焕亮|淡斑|淡纹|祛痘)|(?:提升|减少|降低|改善)\s*\d+(?:\.\d+)?\s*%|100\s*%\s*(?:有效|见效)/i.test(
        text,
      );
    return isStrongEffectClaim ? "HIGH" : "MEDIUM";
  }

  return severityByRule[ruleId] ?? "MEDIUM";
}

export function getRule(ruleId: RuleId): RegisteredRule {
  const rule = ruleById.get(ruleId);
  if (!rule) throw new Error(`Unknown rule ID: ${ruleId}`);
  return rule;
}
