/**
 * PRD 18.19 — gates real scanning vs. mock workflow bodies.
 * Unset or any value other than "true" keeps the mock path.
 */
export function isRealScanEnabled(
  value: string | undefined = process.env.REAL_SCAN_ENABLED,
): boolean {
  return value === "true";
}

/**
 * Gates Claude narration. Unset or any value other than "true" keeps
 * the deterministic template copy from assembleReport().
 */
export function isAiNarrationEnabled(
  value: string | undefined = process.env.AI_NARRATION_ENABLED,
): boolean {
  return value === "true";
}

/**
 * Auto-publication is DISABLED FOR ALL OF RING 1, without exceptions
 * (PRD "Auto-publication threshold" / "Review model").
 *
 * This returns false unconditionally rather than reading an environment
 * variable, so no deploy-time configuration mistake can turn automatic
 * publication on. The eligibility evaluator still runs in shadow mode and
 * logs its verdict; turning automation on requires the post-pilot Selective
 * Automation Expansion decision AND a deliberate change to this function.
 */
export function isAutoPublishEnabled(): false {
  return false;
}
