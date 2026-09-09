import {
  RESULTS_PILLARS,
  type ResultsRecommendationInput,
} from "@/lib/copy/audit-results";

/**
 * Customer-facing copy and dropdown options for the prepare-for-your-call
 * screen (Figma 10:3918 mobile, 31:9752 desktop).
 *
 * Q1 options are the audit's persisted Fix First recommendation titles —
 * the same list the results screen reads. Q2 and Q3 are static. Selected
 * values are stored as this same plain text.
 */

export const PRE_CALL_HEADLINE = "Help us prepare for your call";
export const PRE_CALL_SUBHEADING =
  "Optional: Answer three quick questions so we can focus on what matters most to your business.";
export const FINDING_QUESTION = "Which finding would you most like to discuss?";
export const RESULT_QUESTION = "What result matters most right now?";
export const TIMING_QUESTION = "How soon would you like to make improvements?";
export const SELECT_PLACEHOLDER = "Select one";
export const SUBMIT_ANSWERS_LABEL = "Submit Answers";
export const SKIP_FOR_NOW_LABEL = "Skip For Now";
export const CANCEL_LABEL = "Cancel";
export const SCHEDULE_PATH = "/schedule";
export const REPORT_PREPARE_PATH = "/report/prepare";
export const REPORT_BOOKING_SESSIONS_PATH = "/report/booking-sessions";

export const RESULT_OPTIONS = [
  "More phone calls",
  "More online bookings or quote requests",
  "More reviews and referrals",
  "Standing out from competitors",
  "Not sure yet",
] as const;

export const TIMING_OPTIONS = [
  "Right away",
  "Within the next month",
  "In the next few months",
  "Just exploring for now",
] as const;

const PILLAR_NAME_FALLBACK: readonly string[] = RESULTS_PILLARS.map(
  (pillar) => pillar.name,
);

/**
 * Q1 dropdown: persisted Fix First titles in sort order. When the audit
 * has none, the three pillar names.
 */
export function findingDiscussionOptions(
  recommendations: readonly Pick<ResultsRecommendationInput, "title">[],
): string[] {
  const titles = recommendations
    .map((row) => row.title.trim())
    .filter((title) => title.length > 0);
  return titles.length > 0 ? titles : [...PILLAR_NAME_FALLBACK];
}

export function isAllowedOption(
  value: string,
  options: readonly string[],
): boolean {
  return options.includes(value);
}
