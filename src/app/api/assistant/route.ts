import { z } from "zod";
import { askReviewAssistant } from "@/lib/agent/review-assistant";
import { canonicalContentSchema, reviewResultSchema } from "@/lib/schemas/review";

export const runtime = "nodejs";
export const maxDuration = 45;

const requestSchema = z.object({
  question: z.string().trim().min(1).max(1_500),
  review: reviewResultSchema,
  canonical: canonicalContentSchema,
});

function fallbackAnswer(input: z.infer<typeof requestSchema>) {
  const risks = input.review.ruleResults.filter((item) => item.status === "RISK");
  const question = input.question;
  if (/证明|依据|报告|授权/.test(question)) {
    return "如果你有证明材料，请将可识别的数据来源、报告编号、测试条件或授权信息补充到广告文案或图片中，再基于更新后的素材重新审核。当前系统只能判断素材中是否出现这些依据，不验证外部材料的真实性；本次审核结论不会被直接修改。";
  }
  if (/改|重写|营销|替换|文案/.test(question)) {
    const suggestions = [...new Set(risks.map((item) => item.suggestion).filter((item): item is string => Boolean(item)))];
    return suggestions.length > 0 ? `根据当前已确认问题，可优先这样处理：${suggestions.join("；")}。修改后请提交最终版本重新审核。` : "当前未发现可直接改写的已确认风险。若要调整营销表达，请修改素材后重新审核。";
  }
  if (risks.length > 0) {
    const details = risks.map((item) => `${item.ruleName}：${item.reason}`).join("；");
    return `当前审核发现的主要问题是：${details}。这是基于已验证审核结果给出的基础说明；修改素材后需要重新审核，不能直接改变本次结论。`;
  }
  return "当前结果没有发现明确风险。若你准备补充图片、活动条件或新的营销表述，请将更新后的完整素材重新提交审核。";
}

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    try {
      return Response.json(await askReviewAssistant(input));
    } catch {
      // The original review remains the source of truth. This fallback only
      // explains its existing outcome and keeps the post-review workflow usable
      // during a transient model outage.
      return Response.json({ answer: fallbackAnswer(input), fallback: true });
    }
  } catch {
    return Response.json({ ok: false, error: { code: "ASSISTANT_UNAVAILABLE", message: "暂时无法回答，请稍后重试。" } }, { status: 503 });
  }
}
