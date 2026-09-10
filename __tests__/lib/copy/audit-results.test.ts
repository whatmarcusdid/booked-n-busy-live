import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BOOK_FINDINGS_CALL_LABEL } from "@/app/book-findings-call";
import { CRITERIA_BY_PILLAR } from "@/lib/audit-workflow/types";
import {
  buildResultsView,
  GRADE_COLORS,
  gradeColor,
  letterFromPillarScore,
  OVERALL_NO_ISSUES_COPY,
  pillarDefinitionBySlug,
  RESULTS_DESKTOP_MIN_WIDTH_PX,
  RESULTS_PILLARS,
  RESULTS_TABLET_MIN_WIDTH_PX,
  resultsLayout,
} from "@/lib/copy/audit-results";
import type { CheckOutcome } from "@/lib/audit-workflow/rubric/model";

const PAGE = join(process.cwd(), "app/audit/results/[token]/page.tsx");
const PILLAR_PAGE = join(
  process.cwd(),
  "app/audit/results/[token]/[pillar]/page.tsx",
);
const SCREEN = join(
  process.cwd(),
  "app/audit/results/[token]/results-screen.tsx",
);
const CSS = join(
  process.cwd(),
  "app/audit/results/[token]/audit-results.css",
);
const SERVICE = join(
  process.cwd(),
  "lib/services/audit-results-service.ts",
);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const ALL_PASS: CheckOutcome = "pass";

function allPassCriteria() {
  return RESULTS_PILLARS.flatMap((pillar) =>
    pillar.checks.map((check) => ({
      key: check.key,
      pillar: pillar.key,
      outcome: ALL_PASS,
    })),
  );
}

function pillarsFromScores(scores: [number | null, number | null, number | null]) {
  return RESULTS_PILLARS.map((pillar, index) => ({
    key: pillar.key,
    name: pillar.name,
    score: scores[index],
  }));
}

describe("results pillar and check ordering", () => {
  it("lists pillars Trust Signals, Lead Conversion, Growth Infrastructure", () => {
    expect(RESULTS_PILLARS.map((pillar) => pillar.key)).toEqual([
      "trust_signals",
      "lead_conversion",
      "growth_infrastructure",
    ]);
  });

  it("uses the M5 display order for Lead Conversion checks", () => {
    const lead = RESULTS_PILLARS.find((pillar) => pillar.key === "lead_conversion");
    expect(lead?.checks.map((check) => check.key)).toEqual([
      "website_performance",
      "phone_cta_visibility",
      "quote_booking_cta_visibility",
      "process_clarity",
    ]);
    expect(CRITERIA_BY_PILLAR.lead_conversion.map((check) => check.key)).toEqual([
      "phone_cta_visibility",
      "quote_booking_cta_visibility",
      "website_performance",
      "process_clarity",
    ]);
  });

  it("keeps that order when assembling a view from unsorted inputs", () => {
    const view = buildResultsView({
      firstName: "John",
      websiteUrl: "https://bookednbusy.app",
      pillars: [
        { key: "growth_infrastructure", name: "Growth Infrastructure", score: 1 },
        { key: "trust_signals", name: "Trust Signals", score: 1 },
        { key: "lead_conversion", name: "Lead Conversion", score: 1 },
      ],
      criteria: [...allPassCriteria()].reverse(),
      recommendations: [],
    });

    expect(view.pillars.map((pillar) => pillar.key)).toEqual([
      "trust_signals",
      "lead_conversion",
      "growth_infrastructure",
    ]);
    expect(view.pillars[0].checks.map((check) => check.key)).toEqual([
      "license_insurance",
      "service_area_clarity",
      "reviews_above_fold",
      "key_person_credibility",
    ]);
    expect(view.pillars[1].checks.map((check) => check.key)).toEqual([
      "website_performance",
      "phone_cta_visibility",
      "quote_booking_cta_visibility",
      "process_clarity",
    ]);
    expect(view.pillars[2].checks.map((check) => check.key)).toEqual([
      "seo_ai_search_readiness",
      "security_health",
      "faq_common_concerns",
      "offer_differentiation",
    ]);
  });
});

describe("grade rendering from pillar_results scores", () => {
  it("maps 0–1 scores onto A/C/F at the locked band boundaries", () => {
    expect(letterFromPillarScore(0.8)).toBe("A");
    expect(letterFromPillarScore(0.79)).toBe("C");
    expect(letterFromPillarScore(0.5)).toBe("C");
    expect(letterFromPillarScore(0.49)).toBe("F");
    expect(letterFromPillarScore(1)).toBe("A");
    expect(letterFromPillarScore(0)).toBe("F");
    expect(letterFromPillarScore(null)).toBeNull();
    expect(letterFromPillarScore(undefined)).toBeNull();
  });

  it("does not use B or D", () => {
    for (const score of [1, 0.8, 0.79, 0.5, 0.49, 0]) {
      const letter = letterFromPillarScore(score);
      expect(letter === "A" || letter === "C" || letter === "F").toBe(true);
    }
    expect(Object.keys(GRADE_COLORS)).toEqual(["A", "C", "F"]);
  });

  it("colors A green, C amber, and F red", () => {
    expect(gradeColor("A")).toBe("green");
    expect(gradeColor("C")).toBe("amber");
    expect(gradeColor("F")).toBe("red");
    const css = readFileSync(CSS, "utf8");
    expect(css).toContain("--ar-grade-a: #16a34a");
    expect(css).toContain("--ar-grade-c: #d97706");
    expect(css).toContain("--ar-grade-f: #b42318");
    expect(css).toMatch(/data-letter="A"[\s\S]*var\(--ar-grade-a\)/);
    expect(css).toMatch(/data-letter="C"[\s\S]*var\(--ar-grade-c\)/);
    expect(css).toMatch(/data-letter="F"[\s\S]*var\(--ar-grade-f\)/);
  });

  it("puts those letters and colors on the view from pillar_results", () => {
    const view = buildResultsView({
      firstName: "Alex",
      websiteUrl: "https://example.com",
      pillars: pillarsFromScores([1, 0.75, 0.4]),
      criteria: allPassCriteria().map((row) =>
        row.pillar === "lead_conversion"
          ? { ...row, outcome: row.key === "website_performance" ? "fail" : "pass" }
          : row.pillar === "growth_infrastructure"
            ? { ...row, outcome: "fail" }
            : row,
      ),
      recommendations: [],
    });

    expect(view.pillars.map((pillar) => pillar.letter)).toEqual(["A", "C", "F"]);
    expect(view.pillars.map((pillar) => pillar.color)).toEqual([
      "green",
      "amber",
      "red",
    ]);
    expect(view.pillars[0].passedCount).toBe(4);
    expect(view.pillars[1].passedCount).toBe(3);
    expect(view.pillars[2].passedCount).toBe(0);
    expect(view.headline).toContain("Alex");
  });

  it("only carries A/C/F pillar-summary copy", () => {
    for (const pillar of RESULTS_PILLARS) {
      expect(Object.keys(pillar.summaries).sort()).toEqual(["A", "C", "F"]);
    }
  });
});

describe("check rows render every criterion in locked order", () => {
  it("keeps all four Trust Signals rows for a mix of pass/fail/partial", () => {
    const view = buildResultsView({
      firstName: "John",
      websiteUrl: "https://example.com",
      pillars: pillarsFromScores([0.75, 1, 1]),
      criteria: allPassCriteria().map((row) =>
        row.key === "reviews_above_fold"
          ? { ...row, outcome: "fail" }
          : row.key === "key_person_credibility"
            ? { ...row, outcome: "partial" }
            : row.key === "service_area_clarity"
              ? { ...row, outcome: "needs_review" }
              : row,
      ),
      recommendations: [],
    });

    const trust = view.pillars[0];
    expect(trust.letter).toBe("C");
    expect(trust.checks).toHaveLength(4);
    expect(trust.checks.map((check) => check.key)).toEqual([
      "license_insurance",
      "service_area_clarity",
      "reviews_above_fold",
      "key_person_credibility",
    ]);
    expect(trust.checks.map((check) => check.outcome)).toEqual([
      "pass",
      "needs_review",
      "fail",
      "partial",
    ]);
    expect(trust.checks[0].passCopy).toBe(
      "License and insurance information is easy for customers to find.",
    );
    expect(trust.checks[1].passCopy).toBeNull();
    expect(trust.checks[1].name).toBe("Service-Area Clarity");
    expect(trust.checks[2].name).toBe("Reviews Above the Fold");
    expect(trust.checks[3].name).toBe("Key-Person / Local Credibility");
    expect(trust.passedCount).toBe(1);
    expect(trust.passedSummary).toBe("1 of 4 trust checks passed");
  });
});

describe("Fix First recommendations", () => {
  it("surfaces ranked stored recommendations when findings exist", () => {
    const view = buildResultsView({
      firstName: "John",
      websiteUrl: "https://example.com",
      pillars: pillarsFromScores([0.5, 1, 1]),
      criteria: allPassCriteria(),
      recommendations: [
        {
          title: "Add a phone number in the header",
          description: "Callers cannot find you.",
          pillar: "lead_conversion",
          priority: "fix_first",
          sortOrder: 1,
        },
        {
          title: "Add a quote request path",
          description: "Booking is buried.",
          pillar: "lead_conversion",
          priority: "fix_next",
          sortOrder: 2,
        },
      ],
    });

    expect(view.overallRecommendations.map((row) => row.priority)).toEqual([
      "fix_first",
      "fix_next",
    ]);
    expect(view.overallRecommendations[0].title).toBe(
      "Add a phone number in the header",
    );
    expect(view.pillars[1].recommendations).toHaveLength(2);
    expect(view.pillars[0].recommendations).toHaveLength(0);
    expect(view.overallNoIssuesCopy).toBe(OVERALL_NO_ISSUES_COPY);
  });

  it("keeps the Figma empty-state copy only when there are zero recommendations", () => {
    const view = buildResultsView({
      firstName: "John",
      websiteUrl: "https://example.com",
      pillars: pillarsFromScores([1, 1, 1]),
      criteria: allPassCriteria(),
      recommendations: [],
    });

    expect(view.overallRecommendations).toEqual([]);
    expect(view.overallNoIssuesCopy).toBe(
      "Great work! No critical issues found. Your site meets all current audit standards.",
    );
    expect(view.pillars[0].noIssuesCopy).toContain("trust signals");
    const screen = readFileSync(SCREEN, "utf8");
    expect(screen).toContain('data-rec-state={items.length === 0 ? "empty" : "findings"}');
  });
});

describe("breakpoint behavior", () => {
  it("is hub+drill-down on mobile and tablet, flattened on desktop", () => {
    expect(resultsLayout(402)).toBe("hub");
    expect(resultsLayout(RESULTS_TABLET_MIN_WIDTH_PX)).toBe("hub");
    expect(resultsLayout(834)).toBe("hub");
    expect(resultsLayout(RESULTS_DESKTOP_MIN_WIDTH_PX - 1)).toBe("hub");
    expect(resultsLayout(RESULTS_DESKTOP_MIN_WIDTH_PX)).toBe("desktop");
    expect(resultsLayout(1440)).toBe("desktop");
  });

  it("renders hub cards as drill-down links and a separate flattened desktop tree", () => {
    const screen = readFileSync(SCREEN, "utf8");
    expect(screen).toContain('data-layout="hub"');
    expect(screen).toContain('data-layout="desktop"');
    expect(screen).toContain('data-layout="detail"');
    expect(screen).toContain("`/audit/results/${token}/${pillar.slug}`");
    const column = screen.slice(
      screen.indexOf("function DesktopColumn"),
      screen.indexOf("export function ResultsScreen"),
    );
    expect(column).toContain("audit-results-column");
    expect(column).not.toContain("Link");
    expect(screen).toContain("chevron-forward.svg");
  });

  it("keeps desktop as a single page: Cancel in nav, no Go Back, no pillar routing", () => {
    const css = readFileSync(CSS, "utf8");
    const screen = readFileSync(SCREEN, "utf8");
    const desktop = css.slice(css.indexOf("@media (min-width: 1024px)"));
    expect(desktop).toContain(".audit-results-hub");
    expect(desktop).toContain(".audit-results-detail");
    expect(desktop).toContain(".audit-results-go-back");
    expect(desktop).toMatch(/display:\s*none/);
    expect(desktop).toMatch(/\.audit-results-desktop \{\s*display:\s*flex;/);
    expect(desktop).toMatch(/\.audit-results-cancel \{\s*display:\s*flex;/);
    expect(screen).toContain("Go Back");
    expect(screen).toContain("Cancel");
    expect(screen).toContain("audit-results-columns");
  });

  it("does not put a consultation sheet on the tablet hub", () => {
    const css = readFileSync(CSS, "utf8");
    const tablet = css.slice(
      css.indexOf("@media (min-width: 768px) and (max-width: 1023px)"),
      css.indexOf("@media (min-width: 1024px)"),
    );
    expect(css).toContain("@media (max-width: 767px)");
    expect(css).toContain(
      '.audit-results[data-mode="hub"] .audit-results-sheet',
    );
    expect(tablet).not.toContain("results-sheet");
  });
});

describe("data path and routes", () => {
  it("loads the live session through getAuditStatus, with no mock fallback", () => {
    const service = readFileSync(SERVICE, "utf8");
    expect(service).toContain("getAuditStatus");
    expect(service).toContain("criterion_results");
    expect(service).toContain("selectRecommendations");
    expect(service).toContain("selectFixFirst");
    expect(
      readFileSync(
        join(process.cwd(), "lib/services/audit-status-service.ts"),
        "utf8",
      ),
    ).toContain("pillar_results");
    expect(stripComments(service)).not.toMatch(/mockData|MOCK_|fakeReport|hardcodedA/);
    const page = readFileSync(PAGE, "utf8");
    expect(page).toContain("loadAuditResults");
    expect(page).toContain("<BookFindingsCall");
  });

  it("renders Book your findings call as the Complete CTA, not Select A Day", () => {
    const page = readFileSync(PAGE, "utf8");
    const cta = readFileSync(
      join(process.cwd(), "app/book-findings-call.tsx"),
      "utf8",
    );
    expect(page).toContain("<BookFindingsCall");
    expect(page).not.toContain("label=");
    expect(page).not.toContain("Select A Day");
    expect(cta).toContain("label = BOOK_FINDINGS_CALL_LABEL");
    expect(BOOK_FINDINGS_CALL_LABEL).toBe("Book your findings call");
  });

  it("exposes the three pillar detail slugs", () => {
    expect(pillarDefinitionBySlug("trust-signals")?.key).toBe("trust_signals");
    expect(pillarDefinitionBySlug("lead-conversion")?.key).toBe("lead_conversion");
    expect(pillarDefinitionBySlug("growth-infrastructure")?.key).toBe(
      "growth_infrastructure",
    );
    expect(pillarDefinitionBySlug("unknown")).toBeUndefined();
    const pillarPage = readFileSync(PILLAR_PAGE, "utf8");
    expect(pillarPage).toContain("pillarDefinitionBySlug");
    expect(pillarPage).toContain('mode="detail"');
  });

  it("paints pass rows with the Figma check and non-pass rows as CheckRowProvisional", () => {
    const screen = readFileSync(SCREEN, "utf8");
    expect(screen).toContain("function CheckRowPass");
    expect(screen).toContain("function CheckRowProvisional");
    expect(screen).toContain("audit-results-check-provisional");
    expect(screen).toContain("/audit/check-circle.svg");
    expect(screen).toContain("pillar.checks.map");
    expect(screen).not.toMatch(/fail-icon|needs-review-icon|partial-icon/);
  });
});
