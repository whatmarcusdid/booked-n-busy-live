import { confidenceFromFindings, type ConfidenceLabel } from "./rubric/confidence";
import { criterionOutcome } from "./recommendations";
import type { CriterionInput } from "./store";
import type { CheckOutcome } from "./rubric/model";

/**
 * Fix First eligibility (PRD "Scoring weights and thresholds" → Fix First
 * eligibility). A check enters the Fix First candidate set only when:
 *
 *   - its outcome is `fail` — `partial` is NOT eligible;
 *   - its confidence is `high`;
 *   - it is not `needs_review` or `not_assessed`.
 *
 * "This prevents uncertain evidence from leading a paid recommendation."
 *
 * The last clause is implied by the first two, but is asserted explicitly by
 * `isFixFirstEligible` so the invariant is testable rather than incidental.
 */
export function isFixFirstEligible(row: CriterionInput): boolean {
  const outcome = criterionOutcome(row);
  if (outcome !== "fail") return false;
  return confidenceFromFindings(row.findings) === "high";
}

export interface FixFirstCandidate {
  row: CriterionInput;
  outcome: CheckOutcome;
  confidence: ConfidenceLabel;
}

export function fixFirstCandidates(
  rows: CriterionInput[],
): FixFirstCandidate[] {
  return rows.filter(isFixFirstEligible).map((row) => ({
    row,
    outcome: "fail" as const,
    confidence: confidenceFromFindings(row.findings),
  }));
}

/**
 * Locked Fix First severity classes, highest severity first. This REPLACES
 * the old pillar-order ranking — pillar membership deliberately has no say in
 * Fix First order, because "an active-misconfiguration signal receives the
 * rank-1 override regardless of its pillar".
 *
 *   1. Active misconfiguration — the site actively configured something
 *      against itself, rather than merely omitting it. Detected from the
 *      check's own evidence (`active_misconfiguration` in findings), never
 *      from the check's name, so any check can enter this class.
 *   2. Direct contact path — the customer cannot reach the business.
 *   3. Trust establishment — the customer does not believe the business.
 *   4. Growth / discovery — the customer never finds the business.
 */
export const FIX_FIRST_SEVERITY_CLASSES = [
  { rank: 1, key: "active_misconfiguration", checks: [] as string[] },
  {
    rank: 2,
    key: "direct_contact_path",
    checks: ["phone_cta_visibility", "quote_booking_cta_visibility"],
  },
  {
    rank: 3,
    key: "trust_establishment",
    checks: [
      "license_insurance",
      "service_area_clarity",
      "reviews_above_fold",
      "key_person_credibility",
    ],
  },
  {
    rank: 4,
    key: "growth_discovery",
    checks: [
      "seo_ai_search_readiness",
      "website_performance",
      "process_clarity",
      "faq_common_concerns",
      "offer_differentiation",
    ],
  },
] as const;

export type FixFirstSeverityKey =
  (typeof FIX_FIRST_SEVERITY_CLASSES)[number]["key"];

const ACTIVE_MISCONFIGURATION_RANK = 1;
const RESIDUAL_RANK = 4;

function isActiveMisconfiguration(row: CriterionInput): boolean {
  return row.findings.active_misconfiguration === true;
}

/**
 * The severity class rank for one check.
 *
 * Classes 2 and 3 are closed enumerations. Class 4 doubles as the residual
 * class for any eligible check the decision does not name — today that is
 * only `security_health`, whose non-active "plain HTTPS absence" fail is
 * explicitly ranked BELOW active misconfiguration but is not assigned to a
 * class of its own. See the closing note in the Fix First tests.
 */
export function fixFirstSeverityRank(row: CriterionInput): number {
  if (isActiveMisconfiguration(row)) return ACTIVE_MISCONFIGURATION_RANK;
  const named = FIX_FIRST_SEVERITY_CLASSES.find((cls) =>
    (cls.checks as readonly string[]).includes(row.criterion_key),
  );
  return named?.rank ?? RESIDUAL_RANK;
}

/**
 * Highest severity tier that still counts as "high impact" for triage.
 * Tiers 1 and 2 are the ones where a wrong or unresolved answer costs the
 * business a customer outright: something actively misconfigured, or no way
 * to make contact.
 */
export const HIGH_SEVERITY_MAX_RANK = 2;

/**
 * Whether a check sits in severity tier 1 or 2.
 *
 * Used by the priority-review trigger, which is about IMPACT, not confidence
 * — a check we could not resolve on the contact path matters more than one we
 * could not resolve on FAQ coverage, whatever our confidence in either.
 * Deliberately independent of outcome, so it applies to `needs_review` rows,
 * which Fix First eligibility by definition never covers.
 */
export function isHighSeverityCheck(row: CriterionInput): boolean {
  return fixFirstSeverityRank(row) <= HIGH_SEVERITY_MAX_RANK;
}

export function fixFirstSeverityKey(row: CriterionInput): FixFirstSeverityKey {
  const rank = fixFirstSeverityRank(row);
  return (
    FIX_FIRST_SEVERITY_CLASSES.find((cls) => cls.rank === rank)?.key ??
    "growth_discovery"
  );
}

/**
 * Ranks the eligible checks and returns the ones to surface: exactly one
 * primary, plus at most one second and ONLY when a distinct eligible check
 * shares the primary's severity class. A second-best candidate one tier down
 * is deliberately dropped rather than promoted to fill the slot.
 *
 * `catalogRank` supplies the stable catalog position, used only to break ties
 * inside a single severity class.
 */
export function selectFixFirst(
  rows: CriterionInput[],
  catalogRank: (row: CriterionInput) => number,
): FixFirstCandidate[] {
  const ranked = fixFirstCandidates(rows).sort((a, b) => {
    const severity = fixFirstSeverityRank(a.row) - fixFirstSeverityRank(b.row);
    if (severity !== 0) return severity;
    return catalogRank(a.row) - catalogRank(b.row);
  });

  if (ranked.length === 0) return [];

  const topRank = fixFirstSeverityRank(ranked[0].row);
  const second = ranked[1];
  if (second && fixFirstSeverityRank(second.row) === topRank) {
    return [ranked[0], second];
  }
  return [ranked[0]];
}
