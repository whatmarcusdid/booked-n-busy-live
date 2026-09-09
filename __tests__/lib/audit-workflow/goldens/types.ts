import type { CheckOutcome } from "@/lib/audit-workflow/rubric/model";
import type { WorkflowTerminalState } from "@/lib/audit-workflow/types";
import type { RecommendationPriority } from "@/lib/audit-workflow/recommendations";

export const CATALOG_KEYS = [
  "license_insurance",
  "service_area_clarity",
  "reviews_above_fold",
  "key_person_credibility",
  "phone_cta_visibility",
  "quote_booking_cta_visibility",
  "website_performance",
  "process_clarity",
  "seo_ai_search_readiness",
  "security_health",
  "faq_common_concerns",
  "offer_differentiation",
] as const;

export type CatalogKey = (typeof CATALOG_KEYS)[number];

export type FixtureKind = "html" | "unsupported_access" | "performance_timeout";

export interface GoldenInput {
  auditId: string;
  websiteUrl: string;
  kind: FixtureKind;
  /** Injected Lighthouse score 0–1. Ignored for adapter fixtures. */
  performanceScore?: number;
}

export interface ExpectedRecommendation {
  criterion_key: CatalogKey;
  priority: RecommendationPriority;
}

export interface AssessmentCoverage {
  assessed: number;
  not_assessed: number;
}

/**
 * Checked-in expectation for one golden fixture.
 */
export interface GoldenManifest {
  fixtureVersion: number;
  rubricVersion: string;
  /** Band boundaries in force when the expectations below were locked. */
  scoringBandVersion: string;
  /** Equal-weight composite over measured pillars, and its band. */
  expectedCompositeScore: number | null;
  expectedScoreBand:
    | "strong_foundation"
    | "needs_improvement"
    | "critical_gaps"
    | null;
  /**
   * Why `expectedRecommendations` changed when the locked Fix First
   * eligibility and severity classes replaced the old pillar-order ranking.
   * Absent when this fixture's recommendations were unaffected.
   */
  recommendationChangeNote?: string;
  expectedAuditOutcome: WorkflowTerminalState;
  expectedCriterionOutcomes: Record<CatalogKey, CheckOutcome>;
  expectedPillarScores: {
    trust_signals: number | null;
    lead_conversion: number | null;
    growth_infrastructure: number | null;
  };
  expectedAssessmentCoverage: {
    trust_signals: AssessmentCoverage;
    lead_conversion: AssessmentCoverage;
    growth_infrastructure: AssessmentCoverage;
  };
  expectedRecommendations: ExpectedRecommendation[];
  humanReviewRequired: boolean;
  /** Added in M6: validateReportForPublication() eligibility. */
  publicationValidation: {
    eligible: boolean;
    reason?: string;
  };
}

export interface LoadedFixture {
  name: string;
  input: GoldenInput;
  manifest: GoldenManifest;
  homeHtml?: string;
}
