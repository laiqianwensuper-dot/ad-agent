import { generateCopyRevision } from "@/lib/agent/copy-rewriter";
import { ruleResultSchema } from "@/lib/schemas/review";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 45;

const requestSchema = z.object({
  sourceText: z.string().min(1).max(12_000),
  findings: z.array(ruleResultSchema).min(1),
});

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    return Response.json(await generateCopyRevision(input.sourceText, input.findings));
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "无法生成推荐修改稿。";
    return Response.json({ ok: false, error: { code: "REWRITE_UNAVAILABLE", message } }, { status: 503 });
  }
}
