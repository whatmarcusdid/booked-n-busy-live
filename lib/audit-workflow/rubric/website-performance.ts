import type { CheckOutcome } from "./model";

/**
 * Lighthouse / Browserless performance scores are 0–1.
 * Bands match Google's published Lighthouse color thresholds:
 *   ≥ 0.90 green / good  → pass
 *   0.50–0.89 orange / needs improvement → partial
 *   < 0.50 red / poor → fail
 */
export const PERFORMANCE_PASS_MIN = 0.9;
export const PERFORMANCE_PARTIAL_MIN = 0.5;

export interface PerformanceSignal {
  available: boolean;
  score?: number;
  lcp_ms?: number;
  tbt_ms?: number;
  cls?: number;
  reason_code?: string;
  rejected_hop?: number;
  rejected_url?: string;
}

export interface WebsitePerformanceResult {
  outcome: CheckOutcome;
  signal?: PerformanceSignal;
}

/**
 * pass / partial / fail only when a numeric 0–1 score was collected.
 * not_assessed: home fetch failed, or the /performance call timed out/errored
 * (does not fail the audit).
 */
export function assessWebsitePerformance(input: {
  homeAssessed: boolean;
  signal?: PerformanceSignal | null;
}): WebsitePerformanceResult {
  if (!input.homeAssessed) {
    return { outcome: "not_assessed" };
  }
  const signal = input.signal;
  if (!signal?.available || typeof signal.score !== "number") {
    return { outcome: "not_assessed", signal: signal ?? undefined };
  }
  const score = signal.score;
  if (score >= PERFORMANCE_PASS_MIN) {
    return { outcome: "pass", signal };
  }
  if (score >= PERFORMANCE_PARTIAL_MIN) {
    return { outcome: "partial", signal };
  }
  return { outcome: "fail", signal };
}