import { z } from "zod";

export const ruleIdSchema = z.enum([
  "A-01", "A-02", "A-03", "A-04", "A-05",
  "A-06", "A-07", "A-08", "A-09", "A-10",
]);
export const ruleStatusSchema = z.enum(["PASS", "RISK", "UNCERTAIN"]);
export const severitySchema = z.enum(["HIGH", "MEDIUM", "LOW"]);

export const textSegmentSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  source: z.enum(["user_text", "image"]),
  confidence: z.number().min(0).max(1).nullable().optional(),
  bbox: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1),
    height: z.number().min(0).max(1),
  }).nullable().optional(),
});

export const canonicalContentSchema = z.object({
  inputType: z.enum(["text", "image", "image_and_text"]),
  rawUserText: z.string().nullable().optional(),
  extractedTextSegments: z.array(textSegmentSchema),
  visualContext: z.string().nullable().optional(),
  imageQuality: z.enum(["GOOD", "PARTIAL", "POOR"]).nullable(),
  unclearRegions: z.array(z.string()),
  isMaterialComplete: z.boolean().nullable(),
});

export const modelRuleResultSchema = z.object({
  ruleId: ruleIdSchema,
  status: ruleStatusSchema,
  evidence: z.array(z.string()).default([]),
  reason: z.string().min(1),
  suggestion: z.string().nullable().optional(),
  missingInformation: z.array(z.string()).default([]),
});

export const modelReviewSchema = z.object({
  ruleResults: z.array(modelRuleResultSchema).length(10),
});

export const evidenceRefSchema = z.object({
  quote: z.string().min(1),
  segmentId: z.string().min(1),
  source: z.enum(["user_text", "image"]),
  bbox: textSegmentSchema.shape.bbox,
  locationConfidence: z.enum(["EXACT", "APPROXIMATE"]).nullable(),
});

export const ruleResultSchema = z.object({
  ruleId: ruleIdSchema,
  ruleName: z.string().min(1),
  status: ruleStatusSchema,
  evidence: z.array(z.string()),
  evidenceRefs: z.array(evidenceRefSchema),
  reason: z.string().min(1),
  severity: severitySchema.nullable(),
  suggestion: z.string().nullable(),
  missingInformation: z.array(z.string()),
  needHumanReview: z.boolean(),
});

export const reviewTraceSchema = z.object({
  requestId: z.string().min(1),
  model: z.string().min(1),
  retryCount: z.number().int().min(0).max(1),
  rulesChecked: z.number().int().min(0).max(10),
  validationErrors: z.array(z.string()),
  durationMs: z.number().int().min(0),
});

export const reviewResultSchema = z.object({
  ok: z.literal(true),
  overallStatus: ruleStatusSchema,
  ruleResults: z.array(ruleResultSchema).length(10),
  needHumanReview: z.boolean(),
  uncertainReasons: z.array(z.string()),
  trace: reviewTraceSchema,
});

export const errorResultSchema = z.object({
  ok: z.literal(false),
  error: z.object({ code: z.string(), message: z.string() }),
});

export type CanonicalContent = z.infer<typeof canonicalContentSchema>;
export type ModelRuleResult = z.infer<typeof modelRuleResultSchema>;
export type ModelReview = z.infer<typeof modelReviewSchema>;
export type RuleResult = z.infer<typeof ruleResultSchema>;
export type ReviewResult = z.infer<typeof reviewResultSchema>;
export type ErrorResult = z.infer<typeof errorResultSchema>;
