import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildResultsView, RESULTS_PILLARS } from "@/lib/copy/audit-results";
import {
  CANCEL_LABEL,
  findingDiscussionOptions,
  PRE_CALL_HEADLINE,
  PRE_CALL_SUBHEADING,
  RESULT_OPTIONS,
  REPORT_SCHEDULE_PATH,
  SCHEDULE_PATH,
  scheduleHandoffPath,
  SKIP_FOR_NOW_LABEL,
  SUBMIT_ANSWERS_LABEL,
  TIMING_OPTIONS,
} from "@/lib/copy/pre-call";

const PAGE = join(process.cwd(), "app/audit/prepare/[token]/page.tsx");
const SCREEN = join(
  process.cwd(),
  "app/audit/prepare/[token]/prepare-screen.tsx",
);
const FORM = join(process.cwd(), "app/audit/prepare/[token]/prepare-form.tsx");
const CSS = join(process.cwd(), "app/audit/prepare/[token]/pre-call.css");
const SERVICE = join(process.cwd(), "lib/services/audit-results-service.ts");

function viewWithRecommendations(titles: string[]) {
  return buildResultsView({
    firstName: "Alex",
    websiteUrl: "https://bookednbusy.app",
    pillars: RESULTS_PILLARS.map((pillar) => ({
      key: pillar.key,
      name: pillar.name,
      score: 0.8,
    })),
    criteria: [],
    recommendations: titles.map((title, index) => ({
      title,
      description: "Show this first.",
      pillar: "lead_conversion",
      priority: "fix_first",
      sortOrder: index,
    })),
  });
}

describe("prepare-screen Q1 options", () => {
  it("uses the audit's persisted Fix First titles from the results view", () => {
    const view = viewWithRecommendations([
      "Make the phone number obvious above the fold",
      "Clarify which areas you actually serve",
    ]);

    expect(findingDiscussionOptions(view.overallRecommendations)).toEqual([
      "Make the phone number obvious above the fold",
      "Clarify which areas you actually serve",
    ]);
  });

  it("falls back to the three pillar names when the audit has no recommendations", () => {
    const view = viewWithRecommendations([]);

    expect(view.overallRecommendations).toEqual([]);
    expect(findingDiscussionOptions(view.overallRecommendations)).toEqual([
      "Trust Signals",
      "Lead Conversion",
      "Growth Infrastructure",
    ]);
  });

  it("reads those titles through loadAuditResults, not a second ranking pass", () => {
    const page = readFileSync(PAGE, "utf8");
    const service = readFileSync(SERVICE, "utf8");
    expect(page).toContain("loadAuditResults");
    expect(page).toContain("findingDiscussionOptions");
    expect(page).toContain("overallRecommendations");
    expect(page).not.toContain("selectFixFirst");
    expect(page).not.toContain("selectRecommendations");
    expect(service).toContain("selectFixFirst");
  });
});

describe("prepare-screen copy and layout", () => {
  it("uses the Figma headline, optional framing, and static Q2/Q3 options", () => {
    expect(PRE_CALL_HEADLINE).toBe("Help us prepare for your call");
    expect(PRE_CALL_SUBHEADING).toMatch(/^Optional:/);
    expect([...RESULT_OPTIONS]).toEqual([
      "More phone calls",
      "More online bookings or quote requests",
      "More reviews and referrals",
      "Standing out from competitors",
      "Not sure yet",
    ]);
    expect([...TIMING_OPTIONS]).toEqual([
      "Right away",
      "Within the next month",
      "In the next few months",
      "Just exploring for now",
    ]);
    expect(SUBMIT_ANSWERS_LABEL).toBe("Submit Answers");
    expect(SKIP_FOR_NOW_LABEL).toBe("Skip For Now");
    expect(CANCEL_LABEL).toBe("Cancel");
  });

  it("does not require any dropdown to submit", () => {
    const form = readFileSync(FORM, "utf8");
    expect(form).toContain("noValidate");
    expect(form).not.toMatch(/required/);
    expect(form).toContain("findingAnswer || null");
    expect(form).toContain("resultAnswer || null");
    expect(form).toContain("timingAnswer || null");
  });

  it("shows Skip For Now on mobile and Cancel on desktop, both to the Calendar handoff", () => {
    const screen = readFileSync(SCREEN, "utf8");
    const css = readFileSync(CSS, "utf8");
    expect(screen).toContain("SKIP_FOR_NOW_LABEL");
    expect(screen).toContain("CANCEL_LABEL");
    expect(screen).toContain("href={scheduleTo}");
    expect(screen).toContain("scheduleHandoffPath(token)");
    expect(screen).toContain("REPORT_SCHEDULE_PATH");
    expect(scheduleHandoffPath("status-token")).toBe("/schedule/status-token");
    expect(REPORT_SCHEDULE_PATH).toBe("/report/schedule");
    expect(SCHEDULE_PATH).toBe("/schedule");
    expect(css).toContain(".pre-call-cancel");
    expect(css).toContain("display: none");
    const desktop = css.slice(css.indexOf("@media (min-width: 1024px)"));
    expect(desktop).toContain(".pre-call-skip");
    expect(desktop).toContain(".pre-call-cancel");
    expect(desktop).toMatch(/display:\s*none/);
    expect(desktop).toMatch(/display:\s*flex/);
  });

  it("reuses the results logo assets and the filled submit button", () => {
    const screen = readFileSync(SCREEN, "utf8");
    const form = readFileSync(FORM, "utf8");
    expect(screen).toContain("/audit/logo-mark.svg");
    expect(screen).toContain("/audit/wordmark.svg");
    expect(form).toContain("MdFilledButton");
    expect(form).toContain("/audit/keyboard-arrow-down.svg");
  });
});
