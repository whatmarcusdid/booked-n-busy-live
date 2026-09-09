/**
 * Emission of the check-level `needs_review` outcome.
 *
 * `needs_review` means the scanner COLLECTED evidence but cannot resolve which
 * outcome that evidence supports. It is distinct from its neighbours:
 *
 *   fail          resolved — the thing is definitively absent or broken
 *   partial       resolved — the thing is definitively half-present
 *   not_assessed  never reached the evidence at all
 *   needs_review  reached the evidence and could not interpret it
 *
 * Three triggers, each anchored to something the project already locked
 * rather than to a new threshold invented here:
 *
 *   1. LOW_CONFIDENCE_POSITIVE — a `pass` or `partial` asserted below PRD
 *      Section 7's `low` confidence boundary. Section 7 already defines `low`
 *      as "automated detection is uncertain", and an uncertain POSITIVE claim
 *      is the one that must not reach a customer unchecked. Negative outcomes
 *      are untouched (see below).
 *
 *   2. CONTRADICTORY_SIGNALS — the check states one fact two ways. These are
 *      decision #12's contradiction classes, applied at emission instead of
 *      only being noticed downstream by `findContradictions()`, where the
 *      contradictory value has already been scored and shown.
 *
 *   3. AMBIGUOUS_CONTACT_PATH — the contact-path checks found competing or
 *      unverifiable candidates. This trigger is why decision #12's condition
 *      (b) is satisfiable at all: severity tier 1 is set only on a `fail`
 *      (`apply.ts` gates `active_misconfiguration` on it), so tier 2 —
 *      `phone_cta_visibility` and `quote_booking_cta_visibility` — is the
 *      only high-severity tier a `needs_review` can ever occupy.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: it never escalates a `fail`. Absence of
 * signal resolves to `fail` at confidence 1.0 by design, and `fix-first.ts`
 * depends on that — Fix First eligibility requires `fail` + `high`, so
 * converting absence-based fails here would silently shrink the paid
 * recommendation set. It also never escalates `not_assessed`, which already
 * models unreachable evidence correctly.
 */
import { MEDIUM_CONFIDENCE_THRESHOLD } from "./confidence";
import type { CheckOutcome } from "./model";

export const NEEDS_REVIEW_REASON_CODES = [
  "LOW_CONFIDENCE_POSITIVE",
  "CONTRADICTORY_SIGNALS",
  "AMBIGUOUS_CONTACT_PATH",
] as const;

export type NeedsReviewReasonCode = (typeof NEEDS_REVIEW_REASON_CODES)[number];

/**
 * Below this, PRD Section 7 calls detection "uncertain" (`low`). Imported
 * rather than restated so the trigger moves if the label boundary ever does.
 */
export const LOW_CONFIDENCE_CEILING = MEDIUM_CONFIDENCE_THRESHOLD;

export interface NeedsReviewVerdict {
  reasonCode: NeedsReviewReasonCode;
  /** Human-readable specifics, shown to the reviewer beside the check. */
  detail: string;
}

export interface NeedsReviewRecord extends NeedsReviewVerdict {
  /** What the rubric would have concluded, kept for later analysis. */
  preReviewOutcome: CheckOutcome;
  preReviewConfidence: number;
}

/**
 * Decision #12's domain contradictions, evaluated for a single check.
 *
 * Only the two that are about the world rather than about internal
 * bookkeeping: a `pass` alongside a hard failure signal. The score-vs-outcome
 * and assessed-vs-outcome classes in `findContradictions()` cannot be
 * violated at emission — `criterionRow` derives both from the same outcome —
 * so checking them here would be checking that addition still works.
 *
 * Today the rubric cannot produce either case (`seoOutcomeFromSignal` returns
 * `fail` on noindex before it can reach `pass`, and `assessSecurityHealth`
 * fails plain HTTP). This is therefore a standing guard: if a future rubric
 * change lets one through, it surfaces as a human review rather than as a
 * confident claim contradicted by its own evidence.
 */
export function contradictionDetail(
  criterionKey: string,
  outcome: CheckOutcome,
  findings: Record<string, unknown>,
): string | null {
  if (outcome !== "pass") return null;

  if (criterionKey === "seo_ai_search_readiness" && findings.noindex === true) {
    return "pass outcome alongside a noindex directive";
  }
  if (criterionKey === "security_health" && findings.protocol === "http:") {
    return "pass outcome alongside an insecure resolved protocol";
  }
  return null;
}

export function needsReviewVerdict(input: {
  criterionKey: string;
  outcome: CheckOutcome;
  /** Confidence the check would carry if it were not escalated. */
  confidenceScore: number;
  findings?: Record<string, unknown>;
  /** Set by the contact-path checks when their candidates do not resolve. */
  signalAmbiguity?: string | null;
}): NeedsReviewVerdict | null {
  // Never escalate a resolved negative or an unreached check.
  if (input.outcome === "fail" || input.outcome === "not_assessed") return null;
  if (input.outcome === "needs_review") return null;

  // Most specific first: an unresolvable signal is a stronger statement than
  // a merely uncertain one, and should be reported as such.
  if (input.signalAmbiguity) {
    return {
      reasonCode: "AMBIGUOUS_CONTACT_PATH",
      detail: input.signalAmbiguity,
    };
  }

  const contradiction = contradictionDetail(
    input.criterionKey,
    input.outcome,
    input.findings ?? {},
  );
  if (contradiction) {
    return { reasonCode: "CONTRADICTORY_SIGNALS", detail: contradiction };
  }

  if (input.confidenceScore < LOW_CONFIDENCE_CEILING) {
    return {
      reasonCode: "LOW_CONFIDENCE_POSITIVE",
      detail: `${input.outcome} asserted at confidence ${input.confidenceScore}`,
    };
  }

  return null;
}

/**
 * Findings recorded on an escalated check.
 *
 * The pre-escalation outcome and confidence are kept rather than discarded:
 * they are what the Selective Automation Expansion decision will need in
 * order to ask "how often was the machine's suppressed answer right?".
 */
export function needsReviewFindings(
  record: NeedsReviewRecord,
): Record<string, unknown> {
  return {
    reason_code: record.reasonCode,
    needs_review_reason: record.detail,
    pre_review_outcome: record.preReviewOutcome,
    pre_review_confidence: record.preReviewConfidence,
  };
}
