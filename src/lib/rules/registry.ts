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

export function getRule(ruleId: RuleId): RegisteredRule {
  const rule = ruleById.get(ruleId);
  if (!rule) throw new Error(`Unknown rule ID: ${ruleId}`);
  return rule;
}
