/**
 * Human decision history for one audit.
 *
 * The admin detail endpoint returns `events`, and an `admin_review` event
 * carries the decision and reviewer hash — but not the note. The note is
 * where an override's reason lives, and the console has to show it: an
 * override that cannot be read back is not preserved for analysis in any
 * useful sense. So the review rows are read directly here.
 *
 * `admin_reviews` has no update path anywhere in the codebase, which is what
 * makes the original machine result safe: a decision is a new row beside the
 * automated output, never a mutation of it.
 */
import { createAdminClient } from "../supabase/admin";
import { emailFromHash } from "./guard";

/**
 * The existing `admin_reviews.decision` CHECK constraint allows only these
 * three values, so the console's Publish / Hold / Override actions map onto
 * them rather than introducing a fourth.
 */
export const REVIEW_DECISION_BY_ACTION = {
  publish: "approve",
  hold: "needs_changes",
  override: "reject",
} as const;

export type ReviewAction = keyof typeof REVIEW_DECISION_BY_ACTION;

/** Only an override is required to carry a reason. */
export const ACTIONS_REQUIRING_REASON: readonly ReviewAction[] = ["override"];

/**
 * Stated once and used by both the reviews endpoint and the console, so the
 * rule a reviewer reads is the rule the API enforces.
 */
export const OVERRIDE_REASON_REQUIRED_ERROR =
  "An override needs a reason before it can be recorded.";

export function requiresReason(action: ReviewAction): boolean {
  return ACTIONS_REQUIRING_REASON.includes(action);
}

export function isReasonAcceptable(reason: string | undefined): boolean {
  return typeof reason === "string" && reason.trim().length > 0;
}

export interface ReviewRecord {
  id: string;
  decision: string;
  note: string | null;
  reviewer: string;
  createdAt: string;
  /** True when this row records a decision against the automated verdict. */
  isOverride: boolean;
}

export function toReviewRecord(row: {
  id: string;
  decision: string;
  note: string | null;
  reviewer_email_hash: string;
  created_at: string;
}): ReviewRecord {
  return {
    id: row.id,
    decision: row.decision,
    note: row.note,
    // Reviewers are a short allow-list, so the hash resolves back to the
    // address without storing it. Falls back to the hash if it ever cannot.
    reviewer: emailFromHash(row.reviewer_email_hash) ?? row.reviewer_email_hash,
    createdAt: row.created_at,
    isOverride: row.decision === REVIEW_DECISION_BY_ACTION.override,
  };
}

export async function loadReviewHistory(
  auditId: string,
): Promise<ReviewRecord[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("admin_reviews")
    .select("id, decision, note, reviewer_email_hash, created_at")
    .eq("audit_id", auditId)
    .order("created_at", { ascending: false });

  return (data ?? []).map(toReviewRecord);
}
