export const RULE_VERSION = "v2";

export const REAL_HOME_CHECKS = {
  license_insurance: {
    key: "license_insurance",
    name: "License and Insurance Visibility",
    pillar: "trust_signals",
    weight: 0.25,
  },
  service_area_clarity: {
    key: "service_area_clarity",
    name: "Service-Area Clarity",
    pillar: "trust_signals",
    weight: 0.25,
  },
  reviews_above_fold: {
    key: "reviews_above_fold",
    name: "Reviews Above the Fold",
    pillar: "trust_signals",
    weight: 0.25,
  },
  phone_cta_visibility: {
    key: "phone_cta_visibility",
    name: "Phone CTA Visibility",
    pillar: "lead_conversion",
    weight: 0.25,
  },
  quote_booking_cta_visibility: {
    key: "quote_booking_cta_visibility",
    name: "Quote/Booking CTA Visibility",
    pillar: "lead_conversion",
    weight: 0.25,
  },
  seo_ai_search_readiness: {
    key: "seo_ai_search_readiness",
    name: "SEO / AI Search Readiness",
    pillar: "growth_infrastructure",
    weight: 0.25,
  },
  security_health: {
    key: "security_health",
    name: "Security Health",
    pillar: "growth_infrastructure",
    weight: 0.25,
  },
  process_clarity: {
    key: "process_clarity",
    name: "Process Clarity",
    pillar: "lead_conversion",
    weight: 0.25,
  },
  faq_common_concerns: {
    key: "faq_common_concerns",
    name: "FAQ / Common Concerns",
    pillar: "growth_infrastructure",
    weight: 0.25,
  },
  offer_differentiation: {
    key: "offer_differentiation",
    name: "Offer Differentiation",
    pillar: "growth_infrastructure",
    weight: 0.25,
  },
  website_performance: {
    key: "website_performance",
    name: "Website Performance",
    pillar: "lead_conversion",
    weight: 0.25,
  },
} as const;

export type CheckOutcome =
  | "pass"
  | "partial"
  | "fail"
  | "not_assessed"
  | "needs_review";

export function pointsForOutcome(outcome: CheckOutcome): number | null {
  if (outcome === "not_assessed" || outcome === "needs_review") return null;
  if (outcome === "pass") return 1;
  if (outcome === "partial") return 0.5;
  return 0;
}

export function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Pillar score = (sum of assessed points) / (assessed count).
 * Stored 0–1 when at least one check was assessed.
 * A pillar with zero assessed checks has no score (null), never 0.00 —
 * 0.00 would misrepresent "no evidence" as "failed everything".
 */
export function scoreAssessedChecks(
  points: Array<number | null>,
): { score: number | null; assessedCount: number } {
  const assessed = points.filter((value): value is number => value !== null);
  if (assessed.length === 0) {
    return { score: null, assessedCount: 0 };
  }
  const sum = assessed.reduce((total, value) => total + value, 0);
  return {
    score: roundScore(sum / assessed.length),
    assessedCount: assessed.length,
  };
}

export function isRealHomeCheck(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(REAL_HOME_CHECKS, key);
}

export function pillarSummary(
  pillarName: string,
  assessedCount: number,
  ruleVersion: string = RULE_VERSION,
): string {
  return `rule_version=${ruleVersion}; ${assessedCount} assessed ${pillarName} checks`;
}
