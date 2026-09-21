import type { CanonicalContent, ReviewResult } from "@/lib/schemas/review";

export type ReviewPresentation = ReviewResult & { canonical: CanonicalContent };
export type ReviewTaskKind = "TEXT" | "IMAGE" | "TEXT_AND_IMAGE";
export type TaskAsset = { assetId: string; originalFileName: string; displayName: string; order: number };

export type StoredReviewTask = {
  id: string;
  name: string;
  kind: ReviewTaskKind;
  materialCount: number;
  materialLabel: string;
  assets?: TaskAsset[];
  createdAt: string;
  updatedAt: string;
  review: ReviewPresentation;
  humanReviewState: "PENDING" | "RESOLVED" | null;
};

const storageKey = "adguard.review-tasks.v1";
const maxStoredTasks = 30;

function isBrowser() {
  return typeof window !== "undefined";
}

export function loadStoredTasks(): StoredReviewTask[] {
  if (!isBrowser()) return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(parsed) ? parsed as StoredReviewTask[] : [];
  } catch {
    return [];
  }
}

export function saveStoredTasks(tasks: StoredReviewTask[]) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(tasks.slice(0, maxStoredTasks)));
  } catch {
    // The review remains usable in memory even when browser storage is full.
  }
}

export function createStoredTask(input: Omit<StoredReviewTask, "id" | "createdAt" | "updatedAt" | "humanReviewState">): StoredReviewTask {
  const timestamp = new Date().toISOString();
  return {
    ...input,
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    createdAt: timestamp,
    updatedAt: timestamp,
    humanReviewState: input.review.needHumanReview ? "PENDING" : null,
  };
}
