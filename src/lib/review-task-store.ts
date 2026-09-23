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
export type ResolvedHumanDecision = Exclude<HumanDecision, "PENDING" | null>;
export type HumanReviewIssue = {
  issueKey: string;
  label: string;
  ruleIds: string[];
};
export type HumanIssueReview = {
  issueKey: string;
  decision: ResolvedHumanDecision;
  note: string | null;
  updatedAt: string;
};
export type HumanReview = {
  issueReviews: HumanIssueReview[];
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
  return review.needHumanReview;
}

export function humanReviewIssues(review: ReviewPresentation): HumanReviewIssue[] {
  const issues: HumanReviewIssue[] = [];
  const isSafeFallback =
    review.needHumanReview &&
    review.ruleResults.every(
      (result) => result.status === "UNCERTAIN" && result.evidence.length === 0,
    );
  if (isSafeFallback) {
    return [
      {
        issueKey: "human:system-fallback",
        label: "系统审核结果待人工确认",
        ruleIds: [],
      },
    ];
  }
  const sensitive = review.ruleResults.find(
    (result) => result.ruleId === "A-06" && result.status === "RISK",
  );
  if (sensitive) {
    issues.push({
      issueKey: "human:A-06",
      label: "A-06 敏感词需人工复核",
      ruleIds: ["A-06"],
    });
  }
  const endorsement = review.ruleResults.find(
    (result) => result.ruleId === "A-09" && result.status === "UNCERTAIN",
  );
  if (endorsement) {
    issues.push({
      issueKey: "human:A-09",
      label: "A-09 背书真实性或授权待确认",
      ruleIds: ["A-09"],
    });
  }

  // A failed validation/model retry does not map to one business rule, but it
  // must still have a visible, resolvable queue item.
  if (review.needHumanReview && issues.length === 0) {
    issues.push({
      issueKey: "human:system-fallback",
      label: "系统审核结果待人工确认",
      ruleIds: [],
    });
  }
  return issues;
}

export function isHumanIssueResolved(
  humanReview: HumanReview,
  issueKey: string,
) {
  return humanReview.issueReviews.some((item) => item.issueKey === issueKey);
}

function initialHumanReview(
  review: ReviewPresentation,
  legacyState?: LegacyStoredReviewTask["humanReviewState"],
): HumanReview {
  return {
    issueReviews:
      legacyState === "RESOLVED"
        ? humanReviewIssues(review).map((issue) => ({
            issueKey: issue.issueKey,
            decision: "CONFIRMED_NEEDS_CHANGES" as const,
            note: null,
            updatedAt: new Date().toISOString(),
          }))
        : [],
    issueFeedback: [],
    updatedAt: null,
  };
}

function normalizeHumanReview(
  review: ReviewPresentation,
  raw: unknown,
): HumanReview {
  if (!raw || typeof raw !== "object") return initialHumanReview(review);
  const candidate = raw as Partial<HumanReview> & {
    decision?: HumanDecision;
    note?: string | null;
  };
  const issueReviews = Array.isArray(candidate.issueReviews)
    ? candidate.issueReviews.filter(
        (item): item is HumanIssueReview =>
          Boolean(
            item &&
              typeof item === "object" &&
              "issueKey" in item &&
              "decision" in item,
          ),
      )
    : [];

  // v2 stored one decision for the entire material. Preserve it only when
  // there was exactly one human issue; otherwise do not silently resolve
  // unrelated issues.
  if (
    issueReviews.length === 0 &&
    candidate.decision &&
    candidate.decision !== "PENDING" &&
    humanReviewIssues(review).length === 1
  ) {
    const [issue] = humanReviewIssues(review);
    issueReviews.push({
      issueKey: issue.issueKey,
      decision: candidate.decision,
      note: candidate.note ?? null,
      updatedAt: candidate.updatedAt ?? new Date().toISOString(),
    });
  }
  return {
    issueReviews,
    issueFeedback: Array.isArray(candidate.issueFeedback)
      ? candidate.issueFeedback
      : [],
    updatedAt: candidate.updatedAt ?? null,
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
    if (Array.isArray(current) && current.every(isCurrentTask)) {
      const normalized = current.map((task) => ({
        ...task,
        contentItems: task.contentItems.map((item) => ({
          ...item,
          humanReview: normalizeHumanReview(item.review, item.humanReview),
        })),
      }));
      saveStoredTasks(normalized);
      return normalized;
    }
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
  return humanReviewIssues(item.review).some(
    (issue) => !isHumanIssueResolved(item.humanReview, issue.issueKey),
  );
}
