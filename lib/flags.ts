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
