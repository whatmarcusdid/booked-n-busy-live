/**
 * Confidence labels (PRD Section 7 "Confidence labels").
 *
 *   high         Direct technical or visual evidence supports the finding.
 *   medium       Evidence exists, but interpretation has some ambiguity.
 *   low          Automated detection is uncertain.
 *   not_assessed The scanner could not reach or interpret the evidence.
 *
 * The rubric already records a numeric confidence per check on its evidence
 * row. This maps that number onto the four locked labels so Fix First
 * eligibility ("outcome is `fail` AND confidence is `high`") can be evaluated
 * from the criterion itself.
 *
 * The 0.9 high threshold follows the values the rubric assigns: deterministic
 * TLS/HTTP facts, parsed `<head>` metadata, Lighthouse scores, `tel:` links,
 * booking-host matches, JSON-LD FAQ blocks, and explicit service radii all sit
 * at 0.9–1.0, while heuristic keyword matching sits at 0.6–0.85.
 */
export const CONFIDENCE_LABELS = [
  "high",
  "medium",
  "low",
  "not_assessed",
] as const;

export type ConfidenceLabel = (typeof CONFIDENCE_LABELS)[number];

export const HIGH_CONFIDENCE_THRESHOLD = 0.9;
export const MEDIUM_CONFIDENCE_THRESHOLD = 0.7;

export function confidenceLabelFromScore(
  value: number | null | undefined,
): ConfidenceLabel {
  if (value == null || value <= 0) return "not_assessed";
  if (value >= HIGH_CONFIDENCE_THRESHOLD) return "high";
  if (value >= MEDIUM_CONFIDENCE_THRESHOLD) return "medium";
  return "low";
}

export function isConfidenceLabel(value: unknown): value is ConfidenceLabel {
  return (
    typeof value === "string" &&
    (CONFIDENCE_LABELS as readonly string[]).includes(value)
  );
}

/**
 * Reads the confidence label off a stored criterion's findings.
 *
 * Mock-processor checks never carry real evidence, so they are deliberately
 * reported as `not_assessed` confidence. That keeps them out of Fix First,
 * matching the M6 evidence-integrity fix that excluded mock checks from
 * customer-facing claims.
 */
export function confidenceFromFindings(
  findings: Record<string, unknown> | undefined,
): ConfidenceLabel {
  if (!findings) return "not_assessed";
  if (findings.mock === true) return "not_assessed";
  if (isConfidenceLabel(findings.confidence)) return findings.confidence;
  if (typeof findings.confidence === "number") {
    return confidenceLabelFromScore(findings.confidence);
  }
  return "not_assessed";
}
