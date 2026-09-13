import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FindingsCallBooked } from "@/app/findings-call-booked";
import { ResultsScreen } from "@/app/audit/results/[token]/results-screen";
import { BOOK_FINDINGS_CALL_LABEL } from "@/app/book-findings-call";
import {
  FINDINGS_CALL_BOOKED_CHANGE_HINT,
  FINDINGS_CALL_BOOKED_CHANGE_LEAD,
  FINDINGS_CALL_BOOKED_PILL,
  FINDINGS_CALL_BOOKED_PREP_HEADLINE,
  formatFindingsCallWhen,
  resolveFindingsCallTimeZone,
} from "@/lib/copy/findings-call-booked";
import {
  FINDING_QUESTION,
  RESULT_QUESTION,
  TIMING_QUESTION,
} from "@/lib/copy/pre-call";
import {
  buildResultsView,
  RESULTS_PILLARS,
} from "@/lib/copy/audit-results";

const COMPONENT = join(process.cwd(), "app/findings-call-booked.tsx");
const PAGE = join(process.cwd(), "app/audit/results/[token]/page.tsx");
const REPORT_PAGE = join(process.cwd(), "app/report/page.tsx");
const LOOKUP = join(process.cwd(), "lib/booking/findings-call-booked.ts");

function sampleView(prepAnswers: { question: string; answer: string }[] | null) {
  return {
    scheduledStart: "2026-09-18T18:00:00.000Z",
    scheduledEnd: "2026-09-18T18:30:00.000Z",
    prepAnswers,
  };
}

function resultsView() {
  return buildResultsView({
    firstName: "Alex",
    websiteUrl: "https://bookednbusy.app",
    pillars: RESULTS_PILLARS.map((pillar) => ({
      key: pillar.key,
      name: pillar.name,
      score: 0.8,
    })),
    criteria: [],
    recommendations: [
      {
        title: "Make the phone number obvious",
        description: "Put it above the fold.",
        pillar: "lead_conversion",
        priority: "fix_first",
        sortOrder: 0,
      },
    ],
  });
}

describe("formatFindingsCallWhen", () => {
  const start = "2026-09-18T18:00:00.000Z";
  const end = "2026-09-18T18:30:00.000Z";

  it("converts the same UTC instant to Eastern and Pacific with matching labels", () => {
    const eastern = formatFindingsCallWhen(start, end, "America/New_York");
    const pacific = formatFindingsCallWhen(start, end, "America/Los_Angeles");

    expect(eastern).toBe("Friday, Sept 18 · 2:00–2:30 PM EDT");
    expect(pacific).toBe("Friday, Sept 18 · 11:00–11:30 AM PDT");
    expect(eastern).not.toBe(pacific);
    expect(eastern).not.toContain("PDT");
    expect(pacific).not.toContain("EDT");
    expect(pacific).not.toContain("America/New_York");
  });

  it("keeps both meridiems when the call crosses noon in that zone", () => {
    expect(
      formatFindingsCallWhen(
        "2026-09-18T15:30:00.000Z",
        "2026-09-18T16:00:00.000Z",
        "America/New_York",
      ),
    ).toBe("Friday, Sept 18 · 11:30 AM–12:00 PM EDT");
    expect(
      formatFindingsCallWhen(
        "2026-09-18T15:30:00.000Z",
        "2026-09-18T16:00:00.000Z",
        "America/Los_Angeles",
      ),
    ).toBe("Friday, Sept 18 · 8:30–9:00 AM PDT");
  });
});

describe("resolveFindingsCallTimeZone", () => {
  it("accepts IANA zones and rejects junk", () => {
    expect(resolveFindingsCallTimeZone("America/New_York")).toBe(
      "America/New_York",
    );
    expect(resolveFindingsCallTimeZone("America/Los_Angeles")).toBe(
      "America/Los_Angeles",
    );
    expect(resolveFindingsCallTimeZone("Not/AZone")).toBeNull();
    expect(resolveFindingsCallTimeZone("")).toBeNull();
  });
});

describe("FindingsCallBooked", () => {
  it("renders the full module when prep answers are present", () => {
    const html = renderToStaticMarkup(
      createElement(FindingsCallBooked, {
        timeZone: "America/Los_Angeles",
        view: sampleView([
          { question: FINDING_QUESTION, answer: "Make the phone number obvious" },
          { question: RESULT_QUESTION, answer: "More phone calls" },
          { question: TIMING_QUESTION, answer: "Right away" },
        ]),
      }),
    );
    expect(html).toContain(FINDINGS_CALL_BOOKED_PILL);
    expect(html).toContain("Friday, Sept 18 · 11:00–11:30 AM PDT");
    expect(html).not.toContain("EDT");
    expect(html).toContain(FINDINGS_CALL_BOOKED_CHANGE_LEAD.trim());
    expect(html).toContain(FINDINGS_CALL_BOOKED_CHANGE_HINT);
    expect(html).toContain(FINDINGS_CALL_BOOKED_PREP_HEADLINE);
    expect(html).toContain("Make the phone number obvious");
    expect(html).toContain("More phone calls");
    expect(html).toContain("Right away");
    expect(html).not.toContain("Add To Calendar");
    expect(html).not.toContain("Book your findings call");
    expect(html).not.toContain("Submit Answers");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("md-filled-button");
  });

  it("omits add-to-calendar and the prep callout when those are absent", () => {
    const html = renderToStaticMarkup(
      createElement(FindingsCallBooked, {
        timeZone: "America/New_York",
        view: sampleView(null),
      }),
    );
    expect(html).toContain(FINDINGS_CALL_BOOKED_PILL);
    expect(html).toContain(FINDINGS_CALL_BOOKED_CHANGE_HINT);
    expect(html).not.toContain(FINDINGS_CALL_BOOKED_PREP_HEADLINE);
    expect(html).not.toContain("findings-call-booked-prep");
    expect(html).not.toContain("Add To Calendar");
    expect(html).not.toContain("Select one");
  });
});

describe("results screen booked vs unbooked CTA", () => {
  it("keeps the existing Book your findings call CTA when no meeting is passed", () => {
    const html = renderToStaticMarkup(
      createElement(ResultsScreen, {
        token: "status-token",
        mode: "hub",
        view: resultsView(),
        cta: createElement("button", { type: "button" }, BOOK_FINDINGS_CALL_LABEL),
      }),
    );
    expect(html).toContain(BOOK_FINDINGS_CALL_LABEL);
    expect(html).toContain("results-sheet");
    expect(html).not.toContain("findings-call-booked");
    expect(html).toContain("Make the phone number obvious");
    expect(html).not.toContain('data-booked="true"');
  });

  it("renders the booked module and hides the booking CTA", () => {
    const html = renderToStaticMarkup(
      createElement(ResultsScreen, {
        token: "status-token",
        mode: "hub",
        view: resultsView(),
        booked: createElement(FindingsCallBooked, {
          timeZone: "America/New_York",
          view: sampleView(null),
        }),
      }),
    );
    expect(html).toContain("findings-call-booked");
    expect(html).toContain(FINDINGS_CALL_BOOKED_PILL);
    expect(html).not.toContain(BOOK_FINDINGS_CALL_LABEL);
    expect(html).not.toContain("results-sheet");
    expect(html).toContain('data-booked="true"');
    expect(html).toContain("Make the phone number obvious");
    expect(html).toContain("Recommended improvements");
  });
});

describe("booked-state wiring", () => {
  it("loads the meeting from the results page and does not invent calendar-add", () => {
    const page = readFileSync(PAGE, "utf8");
    const report = readFileSync(REPORT_PAGE, "utf8");
    const component = readFileSync(COMPONENT, "utf8");
    const lookup = readFileSync(LOOKUP, "utf8");
    expect(page).toContain("loadFindingsCallBooked");
    expect(page).toContain("<FindingsCallBooked");
    expect(page).toContain("<BookFindingsCall");
    expect(report).toContain("loadFindingsCallBooked");
    expect(component).not.toContain("Add To Calendar");
    expect(lookup).not.toContain("htmlLink");
    expect(lookup).not.toContain(".ics");
    expect(lookup).not.toContain("formatFindingsCallWhen");
    expect(lookup).toContain('from("meetings")');
    expect(lookup).toContain('from("pre_call_answers")');
    const copy = readFileSync(
      join(process.cwd(), "lib/copy/findings-call-booked.ts"),
      "utf8",
    );
    expect(copy).not.toContain("America/New_York");
    expect(copy).not.toContain("FINDINGS_CALL_TIME_ZONE");
    expect(
      readFileSync(join(process.cwd(), "app/findings-call-when.tsx"), "utf8"),
    ).not.toContain("America/New_York");
  });
});
