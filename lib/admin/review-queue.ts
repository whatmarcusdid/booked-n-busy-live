/**
 * Review queue construction for the admin console.
 *
 * Priority ordering consumes decision #12's `requiresPriorityReview()` rather
 * than reimplementing it, so the queue and the shadow auto-publication metrics
 * can never disagree about which audits need a human first.
 *
 * This lives beside the admin API rather than inside it: the queue endpoint
 * returns audit summaries only, and priority cannot be derived from those
 * fields — it needs each audit's check outcomes. Server components read this
 * module directly, the same way the existing admin page reads the store.
 */
import {
  evaluateAutoPublicationEligibility,
  requiresPriorityReview,
  type IneligibilityReason,
} from "../reports/auto-publication";
import { criterionOutcome } from "../audit-workflow/criterion-outcome";
import type { CriterionInput } from "../audit-workflow/store";
import { createAdminClient } from "../supabase/admin";

/** A report revision in this status cannot reach a customer without a human. */
export const PENDING_PUBLICATION_STATUS = "review_required";

/** The subset of ineligibility reasons that mean "jump the queue". */
export const PRIORITY_REASONS: readonly IneligibilityReason[] = [
  "needs_review_count",
  "high_severity_needs_review",
  "needs_review_with_partial",
];

export interface QueueAuditInput {
  id: string;
  businessName: string;
  websiteUrl: string;
  currentState: string;
  createdAt: string;
  revisionNumber: number | null;
  overallScore: number | null;
  criteria: CriterionInput[];
}

export interface QueueItem {
  id: string;
  businessName: string;
  websiteUrl: string;
  currentState: string;
  createdAt: string;
  revisionNumber: number | null;
  overallScore: number | null;
  /** True when decision #12 says a human should see this ahead of others. */
  priority: boolean;
  priorityReasons: IneligibilityReason[];
  needsReviewCount: number;
  highSeverityNeedsReviewKeys: string[];
  ageMs: number;
}

export interface QueueHealth {
  pendingCount: number;
  flaggedCount: number;
  /** Age of the longest-waiting pending item. Null when the queue is empty. */
  oldestPendingAgeMs: number | null;
  oldestPendingAt: string | null;
  oldestPendingBusinessName: string | null;
}

export function buildQueueItem(
  input: QueueAuditInput,
  now: number = Date.now(),
): QueueItem {
  const eligibility = evaluateAutoPublicationEligibility({
    criteria: input.criteria,
    auditState: input.currentState,
  });

  const priorityReasons = eligibility.reasons.filter((reason) =>
    PRIORITY_REASONS.includes(reason),
  );

  return {
    id: input.id,
    businessName: input.businessName,
    websiteUrl: input.websiteUrl,
    currentState: input.currentState,
    createdAt: input.createdAt,
    revisionNumber: input.revisionNumber,
    overallScore: input.overallScore,
    priority: requiresPriorityReview(eligibility),
    priorityReasons,
    needsReviewCount: eligibility.metrics.needsReviewCount,
    highSeverityNeedsReviewKeys:
      eligibility.metrics.highSeverityNeedsReviewKeys,
    ageMs: Math.max(0, now - new Date(input.createdAt).getTime()),
  };
}

/**
 * Flagged audits first, then oldest first within each group. Age is the
 * tie-breaker in both groups so nothing can sit behind a newer item forever.
 */
export function orderQueue(items: QueueItem[]): QueueItem[] {
  return [...items].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority ? -1 : 1;
    const ageDelta = b.ageMs - a.ageMs;
    if (ageDelta !== 0) return ageDelta;
    return a.id.localeCompare(b.id);
  });
}

export function summarizeQueue(items: QueueItem[]): QueueHealth {
  if (items.length === 0) {
    return {
      pendingCount: 0,
      flaggedCount: 0,
      oldestPendingAgeMs: null,
      oldestPendingAt: null,
      oldestPendingBusinessName: null,
    };
  }

  const oldest = items.reduce((worst, item) =>
    item.ageMs > worst.ageMs ? item : worst,
  );

  return {
    pendingCount: items.length,
    flaggedCount: items.filter((item) => item.priority).length,
    oldestPendingAgeMs: oldest.ageMs,
    oldestPendingAt: oldest.createdAt,
    oldestPendingBusinessName: oldest.businessName,
  };
}

/** Why this audit jumped the queue, in a reviewer's language. */
export const PRIORITY_REASON_LABELS: Record<IneligibilityReason, string> = {
  needs_review_count: "2 or more checks need review",
  high_severity_needs_review: "a high-severity check needs review",
  needs_review_with_partial: "needs review on a partial audit",
  insufficient_assessed_checks: "fewer than 8 checks assessed",
  contradictory_outcome: "contradictory check outcome",
};

/**
 * How long something has been waiting, as of now.
 *
 * Async because reading the clock is impure and must not happen while a
 * server component renders; awaiting it keeps the read in the data-loading
 * phase, where `loadReviewQueue` already does the same thing.
 */
export async function ageSince(
  timestamp: string | null | undefined,
): Promise<number | null> {
  if (!timestamp) return null;
  const started = new Date(timestamp).getTime();
  if (!Number.isFinite(started)) return null;
  return Math.max(0, Date.now() - started);
}

export function formatAge(ms: number | null): string {
  if (ms == null) return "—";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export interface ReviewQueue {
  items: QueueItem[];
  health: QueueHealth;
}

export function assembleReviewQueue(
  inputs: QueueAuditInput[],
  now: number = Date.now(),
): ReviewQueue {
  const items = orderQueue(inputs.map((input) => buildQueueItem(input, now)));
  return { items, health: summarizeQueue(items) };
}

/**
 * Reduce revision rows to the latest revision per audit. Pending status is
 * read from that latest revision only: an audit whose newest revision is
 * published is not pending just because an older one still says otherwise.
 */
export function latestRevisionPerAudit<
  T extends { audit_id: string; revision_number: number },
>(rows: T[]): Map<string, T> {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const held = latest.get(row.audit_id);
    if (!held || row.revision_number > held.revision_number) {
      latest.set(row.audit_id, row);
    }
  }
  return latest;
}

export function criteriaFromRows(rows: unknown[]): CriterionInput[] {
  return rows.map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      criterion_key: String(row.criterion_key),
      criterion_name: String(row.criterion_name),
      pillar: String(row.pillar),
      score: Number(row.score),
      weight: Number(row.weight),
      findings: (row.findings as Record<string, unknown>) ?? {},
    };
  });
}

/** Check outcome as stored, for display beside each criterion. */
export function outcomeOf(row: CriterionInput): string {
  return criterionOutcome(row) ?? "not_assessed";
}

/**
 * Ring 1 pilot volume, so revisions are reduced in memory rather than with a
 * window function PostgREST cannot express. Bounded so a runaway table cannot
 * turn the queue into an unbounded read.
 */
export const REVISION_SCAN_LIMIT = 500;

export async function loadReviewQueue(
  now: number = Date.now(),
): Promise<ReviewQueue> {
  const supabase = createAdminClient();

  const { data: revisions, error: revisionError } = await supabase
    .from("report_revisions")
    .select("audit_id, revision_number, publication_status, overall_score")
    .order("created_at", { ascending: false })
    .limit(REVISION_SCAN_LIMIT);

  if (revisionError) {
    throw new Error(`Failed to load revisions: ${revisionError.message}`);
  }

  const latest = latestRevisionPerAudit(revisions ?? []);
  const pending = [...latest.values()].filter(
    (row) => row.publication_status === PENDING_PUBLICATION_STATUS,
  );

  if (pending.length === 0) {
    return { items: [], health: summarizeQueue([]) };
  }

  const auditIds = pending.map((row) => row.audit_id);

  const [{ data: audits }, { data: criteria }] = await Promise.all([
    supabase
      .from("audits")
      .select("id, business_name, website_url, current_state, created_at")
      .in("id", auditIds),
    supabase
      .from("criterion_results")
      .select("audit_id, criterion_key, criterion_name, pillar, score, weight, findings")
      .in("audit_id", auditIds),
  ]);

  const criteriaByAudit = new Map<string, unknown[]>();
  for (const row of criteria ?? []) {
    const key = String((row as Record<string, unknown>).audit_id);
    const held = criteriaByAudit.get(key) ?? [];
    held.push(row);
    criteriaByAudit.set(key, held);
  }

  const inputs: QueueAuditInput[] = (audits ?? []).map((audit) => {
    const revision = latest.get(audit.id);
    return {
      id: audit.id,
      businessName: audit.business_name,
      websiteUrl: audit.website_url,
      currentState: audit.current_state,
      createdAt: audit.created_at,
      revisionNumber: revision?.revision_number ?? null,
      overallScore:
        revision?.overall_score == null ? null : Number(revision.overall_score),
      criteria: criteriaFromRows(criteriaByAudit.get(audit.id) ?? []),
    };
  });

  return assembleReviewQueue(inputs, now);
}
