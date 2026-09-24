import { canonicalizeText } from "@/lib/agent/canonical-content";
import { parseImage, ReviewServiceError } from "@/lib/agent/openai-reviewer";
import { runReviewWorkflow } from "@/lib/agent/workflow";
import { toReviewApiResponse } from "@/lib/api-contract";
import type { CanonicalContent, ErrorResult } from "@/lib/schemas/review";
import {
  MAX_REVIEW_IMAGE_BYTES,
  MAX_REVIEW_IMAGE_LABEL,
  imageBytes,
} from "@/lib/upload-policy";

export const runtime = "nodejs";
// Image parsing plus one validation repair can require two model calls.
export const maxDuration = 120;

const MAX_TEXT_LENGTH = 12_000;
const MAX_IMAGES_PER_TASK = 5;
const supportedMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

function isSupportedImage(buffer: Uint8Array): string | null {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 12 && String.fromCharCode(...buffer.slice(0, 4)) === "RIFF" && String.fromCharCode(...buffer.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

function error(code: string, message: string, status = 400) {
  const body: ErrorResult = { ok: false, error: { code, message } };
  return Response.json(body, { status });
}

function combineImageCanonicals(images: CanonicalContent[], text: string): CanonicalContent {
  const qualityRank = { POOR: 0, PARTIAL: 1, GOOD: 2 } as const;
  const imageQuality = [...images.map((item) => item.imageQuality).filter((item): item is "GOOD" | "PARTIAL" | "POOR" => Boolean(item))]
    .sort((left, right) => qualityRank[left] - qualityRank[right])[0] ?? null;
  return {
    inputType: text ? "image_and_text" : "image",
    rawUserText: text || null,
    extractedTextSegments: [
      ...images.flatMap((canonical, imageIndex) => canonical.extractedTextSegments.map((segment) => ({
        ...segment,
        id: `image-${imageIndex + 1}:${segment.id}`,
      }))),
      ...(text ? [{ id: "user-text-1", text, source: "user_text" as const, confidence: 1 }] : []),
    ],
    visualContext: images.map((item, index) => item.visualContext ? `图片 ${index + 1}：${item.visualContext}` : null).filter(Boolean).join("\n") || null,
    imageQuality,
    unclearRegions: images.flatMap((item, index) => item.unclearRegions.map((region) => `图片 ${index + 1}：${region}`)),
    isMaterialComplete: images.every((item) => item.isMaterialComplete === true) ? true : images.some((item) => item.isMaterialComplete === false) ? false : null,
  };
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const text = String(formData.get("text") ?? "").trim();
    const candidates = formData.getAll("images").filter((item): item is File => item instanceof File);
    const legacyCandidate = formData.get("image");
    const images = candidates.length > 0 ? candidates : legacyCandidate instanceof File ? [legacyCandidate] : [];

    if (!text && images.length === 0) return error("EMPTY_INPUT", "请填写广告文案或上传至少一张图片。");
    if (text.length > MAX_TEXT_LENGTH) return error("TEXT_TOO_LONG", `文案不能超过 ${MAX_TEXT_LENGTH} 个字符。`);
    if (images.length > MAX_IMAGES_PER_TASK) return error("TOO_MANY_IMAGES", `单个审核任务最多上传 ${MAX_IMAGES_PER_TASK} 张图片。`);
    if (imageBytes(images) > MAX_REVIEW_IMAGE_BYTES)
      return error(
        "PAYLOAD_TOO_LARGE",
        `单个内容项的配图总大小不能超过 ${MAX_REVIEW_IMAGE_LABEL}。`,
      );
    if (images.some((image) => !supportedMimeTypes.has(image.type))) return error("UNSUPPORTED_FILE_TYPE", "仅支持 PNG、JPG/JPEG、WEBP 图片。");

    let canonical: CanonicalContent;
    if (images.length === 0) {
      canonical = canonicalizeText(text);
    } else {
      const parsedImages = await Promise.all(images.map(async (image) => {
        const bytes = new Uint8Array(await image.arrayBuffer());
        const verifiedMime = isSupportedImage(bytes);
        if (!verifiedMime) throw new ReviewServiceError("INVALID_IMAGE", "文件内容不是有效的 PNG、JPG/JPEG 或 WEBP 图片。");
        const dataUrl = `data:${verifiedMime};base64,${Buffer.from(bytes).toString("base64")}`;
        return parseImage({ dataUrl, mediaType: verifiedMime });
      }));
      canonical = combineImageCanonicals(parsedImages, text);
    }

    const result = await runReviewWorkflow(canonical);
    return Response.json(toReviewApiResponse(result, canonical));
  } catch (caught) {
    if (caught instanceof ReviewServiceError) return error(caught.code, caught.message, 503);
    return error("REVIEW_UNAVAILABLE", "审核服务暂时不可用，请稍后重试。", 503);
  }
}
