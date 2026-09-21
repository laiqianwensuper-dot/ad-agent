import { z } from "zod";
import OpenAI from "openai";
import type { RuleResult } from "@/lib/schemas/review";

const copyRevisionSchema = z.object({
  revisedCopy: z.string().min(1),
  placeholders: z.array(z.string()),
  note: z.string().nullable(),
});

export type CopyRevision = z.infer<typeof copyRevisionSchema>;

const revisionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["revisedCopy", "placeholders", "note"],
  properties: {
    revisedCopy: { type: "string" },
    placeholders: { type: "array", items: { type: "string" } },
    note: { type: ["string", "null"] },
  },
} as const;

export async function generateCopyRevision(sourceText: string, findings: RuleResult[]): Promise<CopyRevision> {
  if (!process.env.OPENAI_API_KEY) throw new Error("审核服务尚未配置 API Key。");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL || undefined, timeout: 30_000, maxRetries: 0 });
  const instructions = [
    "你是广告文案编辑，只根据已确认的审核问题改写广告文案。",
    "绝不编造日期、优惠条件、数据来源、授权、效果或产品事实。缺失信息用方括号占位，例如 [请填写活动起止日期]。",
    "保留未被指出有风险的核心信息；不要输出解释过程。",
  ].join("\n");
  if (process.env.OPENAI_WIRE_API === "chat_completions") {
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-5.6-terra",
      messages: [
        { role: "system", content: `${instructions}\n只输出一个 JSON 对象，不要 Markdown 或额外字段。Schema：${JSON.stringify(revisionJsonSchema)}` },
        { role: "user", content: JSON.stringify({ sourceText, findings }) },
      ],
      response_format: { type: "json_object" },
    });
    return copyRevisionSchema.parse(JSON.parse(response.choices[0]?.message?.content ?? ""));
  }
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5.6-terra",
    store: false,
    instructions,
    input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify({ sourceText, findings }) }] }],
    text: { format: { type: "json_schema", name: "adguard_copy_revision", strict: true, schema: revisionJsonSchema } },
  });
  return copyRevisionSchema.parse(JSON.parse(response.output_text));
}
