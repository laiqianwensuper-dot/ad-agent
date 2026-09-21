import type { CanonicalContent } from "@/lib/schemas/review";

export function canonicalizeText(text: string): CanonicalContent {
  const trimmedText = text.trim();
  return {
    inputType: "text",
    rawUserText: trimmedText,
    extractedTextSegments: trimmedText
      ? [{ id: "user-text-1", text: trimmedText, source: "user_text", confidence: 1 }]
      : [],
    visualContext: null,
    imageQuality: null,
    unclearRegions: [],
    isMaterialComplete: true,
  };
}

export function canonicalText(canonical: CanonicalContent): string {
  return canonical.extractedTextSegments.map((segment) => segment.text).join("\n");
}
