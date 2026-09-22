import type { CanonicalContent, ReviewResult } from "@/lib/schemas/review";

export type ReviewPresentation = ReviewResult & { canonical: CanonicalContent };
export type ReviewTaskKind = "TEXT" | "IMAGE" | "TEXT_AND_IMAGE";
export type TaskAsset = {
  assetId: string;
  originalFileName: string;
  displayName: string;
  order: number;
};

export type FeedbackReason =
  | "NOT_A_RISK"
  | "WRONG_RULE"
  | "WRONG_SEVERITY"
  | "WRONG_LOCATION"
  | "SUGGESTION_NOT_USEFUL"
  | "OTHER";
export type IssueFeedback = {
  findingKey: string;
  reason: FeedbackReason;
  note: string;
  createdAt: string;
};
export type HumanDecision =
  "PENDING" | "APPROVED" | "CONFIRMED_NEEDS_CHANGES" | "FALSE_POSITIVE" | null;
export type HumanReview = {
  decision: HumanDecision;
  note: string | null;
  issueFeedback: IssueFeedback[];
  updatedAt: string | null;
};

/** A single publishable material: copy, image, or their combination. */
export type StoredContentItem = {
  id: string;
  name: string;
  kind: ReviewTaskKind;
  materialCount: number;
  materialLabel: string;
  assets: TaskAsset[];
  review: ReviewPresentation;
  humanReview: HumanReview;
};

/** A review task groups one or more independently reviewable content items. */
export type StoredReviewTask = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  contentItems: StoredContentItem[];
};

type LegacyStoredReviewTask = {
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

const storageKey = "adguard.review-tasks.v2";
const legacyStorageKey = "adguard.review-tasks.v1";
const maxStoredTasks = 30;

function isBrowser() {
  return typeof window !== "undefined";
}
function createId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

export function requiresHumanReview(review: ReviewPresentation) {
  return review.ruleResults.some(
    (result) =>
      (result.ruleId === "A-06" && result.status === "RISK") ||
      (result.ruleId === "A-09" && result.status === "UNCERTAIN"),
  );
}

function initialHumanReview(
  review: ReviewPresentation,
  legacyState?: LegacyStoredReviewTask["humanReviewState"],
): HumanReview {
  return {
    decision:
      legacyState === "RESOLVED"
        ? "CONFIRMED_NEEDS_CHANGES"
        : requiresHumanReview(review)
          ? "PENDING"
          : null,
    note: null,
    issueFeedback: [],
    updatedAt: null,
  };
}

function migrateLegacyTask(task: LegacyStoredReviewTask): StoredReviewTask {
  return {
    id: task.id,
    name: task.name,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    contentItems: [
      {
        id: `${task.id}-item-1`,
        name: task.name,
        kind: task.kind,
        materialCount: task.materialCount,
        materialLabel: task.materialLabel,
        assets: task.assets ?? [],
        review: task.review,
        humanReview: initialHumanReview(task.review, task.humanReviewState),
      },
    ],
  };
}

function isCurrentTask(value: unknown): value is StoredReviewTask {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as StoredReviewTask).contentItems)
  );
}

export function loadStoredTasks(): StoredReviewTask[] {
  if (!isBrowser()) return [];
  try {
    const current: unknown = JSON.parse(
      window.localStorage.getItem(storageKey) ?? "[]",
    );
    if (Array.isArray(current) && current.every(isCurrentTask)) return current;
    const legacy: unknown = JSON.parse(
      window.localStorage.getItem(legacyStorageKey) ?? "[]",
    );
    const migrated = Array.isArray(legacy)
      ? legacy.map((task) => migrateLegacyTask(task as LegacyStoredReviewTask))
      : [];
    if (migrated.length) saveStoredTasks(migrated);
    return migrated;
  } catch {
    return [];
  }
}

export function saveStoredTasks(tasks: StoredReviewTask[]) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify(tasks.slice(0, maxStoredTasks)),
    );
  } catch {
    /* usable in memory */
  }
}

export function createContentItem(
  input: Omit<StoredContentItem, "id" | "humanReview">,
): StoredContentItem {
  return {
    ...input,
    id: createId(),
    humanReview: initialHumanReview(input.review),
  };
}

export function createStoredTask(
  input: Omit<StoredReviewTask, "id" | "createdAt" | "updatedAt">,
): StoredReviewTask {
  const timestamp = new Date().toISOString();
  return {
    ...input,
    id: createId(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function contentItemStatusLabel(item: StoredContentItem) {
  if (item.review.overallStatus === "RISK") return "建议修改";
  if (item.review.overallStatus === "UNCERTAIN") return "待补充确认";
  return "已通过";
}

export function needsHumanHandling(item: StoredContentItem) {
  // A recorded human outcome closes the queue item without rewriting the
  // immutable AI pre-review result.
  if (item.humanReview.decision && item.humanReview.decision !== "PENDING") {
    return false;
  }
  return requiresHumanReview(item.review);
}
