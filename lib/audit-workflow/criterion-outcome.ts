import type { CheckOutcome } from "./rubric/model";
import type { CriterionInput } from "./store";
import { CRITERIA_BY_PILLAR, PILLARS, type PillarKey } from "./types";

/**
 * Reading a stored criterion's outcome and catalog position.
 *
 * Lives in its own module because both `recommendations.ts` and
 * `fix-first.ts` need it, and Fix First selection is itself consumed by
 * `recommendations.ts` — importing in both directions would be a cycle.
 */

/**
 * Maps a continuous mock score onto the same pass / partial / fail bands
 * the real checks use. Does not change the numeric score stored on the
 * criterion row (pillar math still uses the continuous value).
 *
 *   >= 0.70  pass     (matches existing `passed: score >= 0.7`)
 *   >= 0.50  partial  (same floor as real-check partial)
 *   else     fail
 */
export function outcomeFromMockScore(score: number): CheckOutcome {
  if (score >= 0.7) return "pass";
  if (score >= 0.5) return "partial";
  return "fail";
}

export function criterionOutcome(
  row: CriterionInput,
): CheckOutcome | undefined {
  const raw = row.findings.outcome;
  if (
    raw === "pass" ||
    raw === "partial" ||
    raw === "fail" ||
    raw === "not_assessed" ||
    raw === "needs_review"
  ) {
    return raw;
  }
  if (row.findings.mock === true && typeof row.score === "number") {
    return outcomeFromMockScore(row.score);
  }
  return undefined;
}

/**
 * Stable position of a check in the PRD catalog, flattened across pillars in
 * report presentation order (Trust Signals, Lead Conversion, Growth
 * Infrastructure).
 *
 * A single global order is required because the Fix First severity classes
 * span pillars — a tie inside one class can involve two checks from two
 * different pillars, so a per-pillar index could not order them.
 */
const STABLE_CATALOG_ORDER: string[] = PILLARS.flatMap((pillar) =>
  (CRITERIA_BY_PILLAR[pillar.key as PillarKey] ?? []).map(
    (criterion) => criterion.key,
  ),
);

export function stableCatalogIndex(criterionKey: string): number {
  const index = STABLE_CATALOG_ORDER.indexOf(criterionKey);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}
