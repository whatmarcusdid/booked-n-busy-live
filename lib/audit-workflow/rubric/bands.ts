/**
 * Composite score bands (PRD "Scoring weights and thresholds" → Locked
 * provisional bands).
 *
 *   80–100  Strong Foundation
 *   50–79   Needs Improvement
 *   0–49    Critical Gaps
 *
 * Versioned SEPARATELY from the rubric version. The bands are explicitly
 * provisional pending the 30-audit validation distribution, while the rubric
 * (`RULE_VERSION`) changes for different reasons. Storing both with every
 * audit means recalibrating band boundaries cannot rewrite what a historical
 * report said, and lets pilot analysis group results by the boundaries that
 * were actually in force when the audit ran.
 */
export const SCORING_BAND_VERSION = "sb-v1";

export const SCORE_BANDS = [
  { key: "strong_foundation", label: "Strong Foundation", min: 80, max: 100 },
  { key: "needs_improvement", label: "Needs Improvement", min: 50, max: 79 },
  { key: "critical_gaps", label: "Critical Gaps", min: 0, max: 49 },
] as const;

export type ScoreBandKey = (typeof SCORE_BANDS)[number]["key"];
export type ScoreBandLabel = (typeof SCORE_BANDS)[number]["label"];

export interface ScoreBand {
  key: ScoreBandKey;
  label: ScoreBandLabel;
  version: string;
}

/** The 0–100 integer a customer sees for a stored 0–1 composite score. */
export function displayScore(compositeScore: number): number {
  return Math.round(compositeScore * 100);
}

/**
 * Maps a composite score to its band.
 *
 * Buckets the DISPLAYED integer, not the raw float, so the band can never
 * disagree with the number printed next to it. A null score (nothing measured)
 * has no band — it must not fall through to "Critical Gaps", which would
 * repeat the 0.00-vs-null conflation the pillar scores already avoid.
 */
export function scoreBand(
  compositeScore: number | null | undefined,
): ScoreBand | null {
  if (compositeScore == null || !Number.isFinite(compositeScore)) return null;

  const scaled = displayScore(compositeScore);
  const band = SCORE_BANDS.find(
    (candidate) => scaled >= candidate.min && scaled <= candidate.max,
  );
  if (!band) return null;

  return { key: band.key, label: band.label, version: SCORING_BAND_VERSION };
}
