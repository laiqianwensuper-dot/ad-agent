import type { CanonicalContent } from "@/lib/schemas/review";

export function normalizeEvidence(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\s\r\n]+/g, "")
    .replace(/[，。；：、“”‘’（）【】]/g, "")
    .toLowerCase();
}

export function findEvidenceSegment(quote: string, content: CanonicalContent) {
  const normalizedQuote = normalizeEvidence(quote);
  if (!normalizedQuote) return null;

  return content.extractedTextSegments.find((segment) =>
    normalizeEvidence(segment.text).includes(normalizedQuote),
  ) ?? null;
}

export function validateEvidence(quote: string, content: CanonicalContent): string | null {
  if (!quote.trim()) return "风险结论缺少证据原文。";
  if (!findEvidenceSegment(quote, content)) {
    return `证据“${quote}”无法在提交素材中定位。`;
  }
  return null;
}
