import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BOOK_FINDINGS_CALL_LABEL } from "@/app/book-findings-call";
import {
  buildResultsView,
  FAILED_HEADLINE,
  MANUAL_REVIEW_SENT_COPY,
  NOT_ASSESSED_CARD_TITLE,
  NOT_ASSESSED_GRADE,
  NOT_ASSESSED_PILLAR_SUBTITLE,
  PARTIAL_HEADLINE,
  RESULTS_PILLARS,
  SEND_REQUEST_LABEL,
  UNSUPPORTED_BODY,
  UNSUPPORTED_HEADLINE,
} from "@/lib/copy/audit-results";

const PAGE = join(process.cwd(), "app/audit/results/[token]/page.tsx");
const SCREEN = join(
  process.cwd(),
  "app/audit/results/[token]/results-screen.tsx",
);
const CTA = join(process.cwd(), "app/book-findings-call.tsx");

function criteriaFor(
  outcomes: Record<string, "pass" | "fail" | "not_assessed">,
) {
  return RESULTS_PILLARS.flatMap((pillar) =>
    pillar.checks.map((check) => ({
      key: check.key,
      pillar: pillar.key,
      outcome: outcomes[pillar.key] ?? "pass",
    })),
  );
}

describe("Partial results view", () => {
  it("uses the Partial headline and a dash Not assessed card for pillars with no assessed checks", () => {
    const view = buildResultsView({
      firstName: "Alex",
      websiteUrl: "https://bookednbusy.app",
      auditState: "partial",
      pillars: RESULTS_PILLARS.map((pillar, index) => ({
        key: pillar.key,
        name: pillar.name,
        score: index === 1 ? null : index === 0 ? 0.6 : 0.9,
      })),
      criteria: criteriaFor({
        trust_signals: "fail",
        lead_conversion: "not_assessed",
        growth_infrastructure: "pass",
      }),
      recommendations: [],
    });

    expect(view.headline).toBe(PARTIAL_HEADLINE);
    expect(view.headline).not.toContain("Alex");
    expect(view.pillars[1].unassessed).toBe(true);
    expect(view.pillars[1].letter).toBeNull();
    expect(view.pillars[1].summary).toBe(NOT_ASSESSED_PILLAR_SUBTITLE);
    expect(view.pillars[0].unassessed).toBe(false);
    expect(view.pillars[2].unassessed).toBe(false);

    const screen = readFileSync(SCREEN, "utf8");
    expect(screen).toContain("NOT_ASSESSED_CARD_TITLE");
    expect(screen).toContain("NOT_ASSESSED_GRADE");
    expect(NOT_ASSESSED_GRADE).toBe("–");
    expect(NOT_ASSESSED_CARD_TITLE).toBe("Not assessed");
  });

  it("reuses BookFindingsCall and the live booking-sessions POST, not Figma placeholder CTA copy", () => {
    const page = readFileSync(PAGE, "utf8");
    expect(page).toContain("<BookFindingsCall");
    expect(page).not.toContain("SELECT_A_DAY_LABEL");
    expect(page).not.toContain("Select A Day");
    expect(BOOK_FINDINGS_CALL_LABEL).toBe("Book your findings call");

    const cta = readFileSync(CTA, "utf8");
    expect(cta).toContain('"/api/v1/booking-sessions"');
    expect(cta).toContain("`/audit/prepare/${statusToken}`");
    expect(cta).toContain("BOOK_FINDINGS_CALL_LABEL");
  });
});

describe("Failed and Unsupported results views", () => {
  it("renders Failed with a single Not assessed card and the send-request action", () => {
    const view = buildResultsView({
      firstName: null,
      websiteUrl: "https://bookednbusy.app",
      auditState: "failed",
      pillars: [],
      criteria: [],
      recommendations: [],
    });
    expect(view.headline).toBe(FAILED_HEADLINE);

    const screen = readFileSync(SCREEN, "utf8");
    expect(screen).toContain("NotAssessedCard");
    expect(screen).toContain("results-terminal");
    const action = readFileSync(
      join(process.cwd(), "app/audit/results/[token]/request-manual-review.tsx"),
      "utf8",
    );
    expect(action).toContain("SEND_REQUEST_LABEL");
    expect(action).toContain("request-manual-review");
    expect(screen).not.toMatch(/try again|resubmit/i);

    const page = readFileSync(PAGE, "utf8");
    expect(page).toContain("RequestManualReview");
    expect(page).toContain('view.auditState === "failed"');
    expect(SEND_REQUEST_LABEL).toBe("Send request");
    expect(MANUAL_REVIEW_SENT_COPY).toMatch(/Request sent/);
  });

  it("renders Unsupported with no action button", () => {
    const view = buildResultsView({
      firstName: null,
      websiteUrl: "https://example.com",
      auditState: "unsupported",
      pillars: [],
      criteria: [],
      recommendations: [],
    });
    expect(view.headline).toBe(UNSUPPORTED_HEADLINE);
    expect(UNSUPPORTED_BODY).toMatch(/login|automated visitors|safely scanned/);

    const page = readFileSync(PAGE, "utf8");
    expect(page).toMatch(
      /view\.auditState === "unsupported" \|\| bookedView \? undefined/,
    );
    const screen = readFileSync(SCREEN, "utf8");
    expect(screen).toContain("UNSUPPORTED_BODY");
    expect(screen).toContain('variant === "unsupported"');
    expect(screen).not.toContain("RequestManualReview");
  });
});
