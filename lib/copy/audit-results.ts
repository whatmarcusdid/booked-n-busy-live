import {
  scoreBand,
  type ScoreBandKey,
} from "@/lib/audit-workflow/rubric/bands";
import type { CheckOutcome } from "@/lib/audit-workflow/rubric/model";
import { CRITERIA_BY_PILLAR, type PillarKey } from "@/lib/audit-workflow/types";

/**
 * Customer-facing results copy and presentation order.
 *
 * Rubric names live in `lib/audit-workflow/types.ts` (`CRITERIA_BY_PILLAR`).
 * Those are catalog labels ("License and Insurance Visibility"), not the
 * pass-state sentences on this screen. Per-check pass copy and grade
 * summaries below come from the results Figma (nodes 10:3490, 10:3739,
 * 12:4084, 12:4131, 30:8650, 30:9302).
 *
 * Lead Conversion check order here is the M5 display order, which differs
 * from `CRITERIA_BY_PILLAR` (website_performance is first on this screen).
 */

/** PRD Section 7: per-pillar letters reuse the composite bands. B and D are unused. */
export type LetterGrade = "A" | "C" | "F";

export type GradeColor = "green" | "amber" | "red";

export const GRADE_COLORS: Record<LetterGrade, GradeColor> = {
  A: "green",
  C: "amber",
  F: "red",
};

const BAND_TO_LETTER: Record<ScoreBandKey, LetterGrade> = {
  strong_foundation: "A",
  needs_improvement: "C",
  critical_gaps: "F",
};

export const RESULTS_DESKTOP_MIN_WIDTH_PX = 1024;
export const RESULTS_TABLET_MIN_WIDTH_PX = 768;

export const SELECT_A_DAY_LABEL = "Select A Day";
export const SCHEDULE_CONSULTATION_LABEL = "Schedule consultation";
export const HOW_YOU_EARNED_HEADING = "How you earned this grade";
export const RECOMMENDED_IMPROVEMENTS_HEADING = "Recommended improvements";
export const OVERALL_NO_ISSUES_COPY =
  "Great work! No critical issues found. Your site meets all current audit standards.";

export interface ResultsCheckDefinition {
  key: string;
  passCopy: string;
}

export interface ResultsPillarDefinition {
  key: PillarKey;
  slug: string;
  name: string;
  checkNoun: string;
  checks: readonly ResultsCheckDefinition[];
  summaries: Record<LetterGrade, string>;
}

export const RESULTS_PILLARS: readonly ResultsPillarDefinition[] = [
  {
    key: "trust_signals",
    slug: "trust-signals",
    name: "Trust Signals",
    checkNoun: "trust checks",
    checks: [
      {
        key: "license_insurance",
        passCopy:
          "License and insurance information is easy for customers to find.",
      },
      {
        key: "service_area_clarity",
        passCopy:
          "Visitors can quickly confirm whether you serve their location.",
      },
      {
        key: "reviews_above_fold",
        passCopy:
          "Customers see reassuring social proof early in their visit.",
      },
      {
        key: "key_person_credibility",
        passCopy:
          "Visitors can see the people behind your business before scrolling.",
      },
    ],
    summaries: {
      A: "Customers can quickly verify your credibility and feel confident choosing your business.",
      C: "Some trust signals are present, but important gaps may create customer hesitation.",
      F: "Critical trust signals are missing, making your business difficult for customers to verify.",
    },
  },
  {
    key: "lead_conversion",
    slug: "lead-conversion",
    name: "Lead Conversion",
    checkNoun: "conversion checks",
    checks: [
      {
        key: "website_performance",
        passCopy:
          "Website loads quickly, helping visitors explore without unnecessary delays.",
      },
      {
        key: "phone_cta_visibility",
        passCopy:
          "Phone number is easy to find and use when visitors are ready to call.",
      },
      {
        key: "quote_booking_cta_visibility",
        passCopy:
          "Visitors can easily book an appointment or request service online.",
      },
      {
        key: "process_clarity",
        passCopy:
          "The process clearly explains what customers can expect next.",
      },
    ],
    summaries: {
      A: "Visitors can quickly call, book, or request a quote without unnecessary friction.",
      C: "Some conversion paths work, but noticeable friction may be limiting calls, bookings, or quotes.",
      F: "Critical contact paths are missing or difficult to use, making it hard for visitors to contact your business.",
    },
  },
  {
    key: "growth_infrastructure",
    slug: "growth-infrastructure",
    name: "Growth Infrastructure",
    checkNoun: "growth checks",
    checks: [
      {
        key: "seo_ai_search_readiness",
        passCopy:
          "Search engines and AI tools can clearly understand your services and content.",
      },
      {
        key: "security_health",
        passCopy:
          "Website provides visitors with a secure and reliable browsing experience.",
      },
      {
        key: "faq_common_concerns",
        passCopy:
          "Visitors can easily find answers to common questions and concerns.",
      },
      {
        key: "offer_differentiation",
        passCopy:
          "Bonuses, guarantees, or service bundles clearly communicate added value.",
      },
    ],
    summaries: {
      A: "Your website strongly supports visibility, reliability, and continued growth.",
      C: "The basics are in place, but key gaps are holding back growth.",
      F: "Critical issues are making your website difficult to find, trust, and grow.",
    },
  },
];

const PILLAR_BY_SLUG = new Map(
  RESULTS_PILLARS.map((pillar) => [pillar.slug, pillar]),
);

export function pillarDefinitionBySlug(
  slug: string,
): ResultsPillarDefinition | undefined {
  return PILLAR_BY_SLUG.get(slug);
}

export function pillarDefinitionByKey(
  key: string,
): ResultsPillarDefinition | undefined {
  return RESULTS_PILLARS.find((pillar) => pillar.key === key);
}

/**
 * Letter grade from a stored 0–1 pillar_results.score.
 *
 * PRD Section 7 (resolved 2026-09-09): reuse the composite bands in
 * `scoreBand` rather than a five-letter scale.
 *
 *   80–100  A  (Strong Foundation)
 *   50–79   C  (Needs Improvement)
 *   0–49    F  (Critical Gaps)
 *
 * B and D are not used. Unmeasured pillars (null) have no letter.
 */
export function letterFromPillarScore(
  score: number | null | undefined,
): LetterGrade | null {
  const band = scoreBand(score);
  return band ? BAND_TO_LETTER[band.key] : null;
}

export function gradeColor(letter: LetterGrade): GradeColor {
  return GRADE_COLORS[letter];
}

export function catalogCheckName(pillar: PillarKey, key: string): string {
  return (
    CRITERIA_BY_PILLAR[pillar].find((check) => check.key === key)?.name ?? key
  );
}

export function resultsLayout(widthPx: number): "hub" | "desktop" {
  return widthPx >= RESULTS_DESKTOP_MIN_WIDTH_PX ? "desktop" : "hub";
}

export function displayWebsiteHost(websiteUrl: string): string {
  try {
    const url = new URL(
      websiteUrl.includes("://") ? websiteUrl : `https://${websiteUrl}`,
    );
    return url.hostname.replace(/^www\./, "");
  } catch {
    return websiteUrl;
  }
}

export function resultsHeadline(firstName: string | null): string {
  if (firstName && firstName.trim()) {
    return `${firstName.trim()}, overall your site is looking good`;
  }
  return "Overall your site is looking good";
}

export function noIssuesCopy(pillarName: string): string {
  return `Great work! No critical issues found. Your ${pillarName.toLowerCase()} meets all current audit standards.`;
}

export function passedSummary(
  passed: number,
  total: number,
  checkNoun: string,
): string {
  return `${passed} of ${total} ${checkNoun} passed`;
}

export const KNOWN_CHECK_OUTCOMES: readonly CheckOutcome[] = [
  "pass",
  "fail",
  "partial",
  "needs_review",
  "not_assessed",
];

export function isKnownCheckOutcome(value: string): value is CheckOutcome {
  return (KNOWN_CHECK_OUTCOMES as readonly string[]).includes(value);
}

export interface ResultsCheckInput {
  key: string;
  pillar: string;
  outcome: CheckOutcome;
}

export interface ResultsRecommendationInput {
  title: string;
  description: string;
  pillar: string;
  priority: string;
  sortOrder: number;
}

export interface ResultsCheckView {
  key: string;
  name: string;
  outcome: CheckOutcome;
  passCopy: string | null;
}

export interface ResultsPillarView {
  key: PillarKey;
  slug: string;
  name: string;
  letter: LetterGrade | null;
  color: GradeColor | null;
  score: number | null;
  summary: string;
  checks: ResultsCheckView[];
  passedCount: number;
  totalCount: number;
  passedSummary: string;
  recommendations: ResultsRecommendationInput[];
  noIssuesCopy: string;
}

export interface ResultsView {
  firstName: string | null;
  websiteHost: string;
  headline: string;
  pillars: ResultsPillarView[];
  overallRecommendations: ResultsRecommendationInput[];
  overallNoIssuesCopy: string;
}

export function buildResultsView(input: {
  firstName: string | null;
  websiteUrl: string;
  pillars: Array<{ key: string; name: string; score: number | null }>;
  criteria: ResultsCheckInput[];
  recommendations: ResultsRecommendationInput[];
}): ResultsView {
  const criteriaByKey = new Map(input.criteria.map((row) => [row.key, row]));
  const recsByPillar = new Map<string, ResultsRecommendationInput[]>();
  for (const rec of [...input.recommendations].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  )) {
    const list = recsByPillar.get(rec.pillar) ?? [];
    list.push(rec);
    recsByPillar.set(rec.pillar, list);
  }

  const pillars = RESULTS_PILLARS.map((definition) => {
    const stored = input.pillars.find((row) => row.key === definition.key);
    const letter = letterFromPillarScore(stored?.score ?? null);
    const checks = definition.checks.map((check) => {
      const outcome = criteriaByKey.get(check.key)?.outcome ?? "not_assessed";
      return {
        key: check.key,
        name: catalogCheckName(definition.key, check.key),
        outcome,
        passCopy: outcome === "pass" ? check.passCopy : null,
      };
    });
    const passedCount = checks.filter((check) => check.outcome === "pass").length;
    return {
      key: definition.key,
      slug: definition.slug,
      name: stored?.name ?? definition.name,
      letter,
      color: letter ? gradeColor(letter) : null,
      score: stored?.score ?? null,
      summary: letter ? definition.summaries[letter] : "",
      checks,
      passedCount,
      totalCount: definition.checks.length,
      passedSummary: passedSummary(
        passedCount,
        definition.checks.length,
        definition.checkNoun,
      ),
      recommendations: recsByPillar.get(definition.key) ?? [],
      noIssuesCopy: noIssuesCopy(definition.name),
    };
  });

  return {
    firstName: input.firstName,
    websiteHost: displayWebsiteHost(input.websiteUrl),
    headline: resultsHeadline(input.firstName),
    pillars,
    overallRecommendations: [...input.recommendations].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    ),
    overallNoIssuesCopy: OVERALL_NO_ISSUES_COPY,
  };
}
