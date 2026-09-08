import { assembleReport } from "@/lib/reports/assemble";
import { assembledReportSchema } from "@/lib/reports/schema";
import { GOOD_SHAPE_EXECUTIVE_SUMMARY } from "@/lib/audit-workflow/recommendations";
import { selectRecommendations } from "@/lib/audit-workflow/recommendations";
import { loadGoldenFixtures, runGoldenFixture } from "../audit-workflow/goldens/runner";

describe("assembleReport", () => {
  it("marks a zero-assessed pillar as not_measured, never 0", () => {
    const report = assembleReport({
      websiteUrl: "https://blocked-host.example.test",
      criteria: [
        {
          criterion_key: "phone_cta_visibility",
          criterion_name: "Phone",
          pillar: "lead_conversion",
          score: 0,
          weight: 0.25,
          findings: { assessed: false, outcome: "not_assessed", mock: false },
        },
      ],
      pillars: [
        {
          pillar_key: "lead_conversion",
          pillar_name: "Lead Conversion",
          score: null,
          criteria_count: 0,
          summary: "none",
        },
      ],
      recommendations: [],
    });

    const lead = report.pillars.find((row) => row.key === "lead_conversion");
    expect(lead).toMatchObject({
      score: null,
      measured: false,
      display: "not_measured",
    });
    expect(report.overallScore).toBeNull();
    expect(report.noMajorIssues).toBe(true);
    expect(report.executiveSummary).toBe(GOOD_SHAPE_EXECUTIVE_SUMMARY);
    expect(assembledReportSchema.safeParse(report).success).toBe(true);
  });

  it("builds a well-formed report from a complete golden audit", async () => {
    const fixture = loadGoldenFixtures().find(
      (row) => row.name === "weak-godaddy-roofer",
    );
    if (!fixture) throw new Error("missing fixture");
    const actual = await runGoldenFixture(fixture);
    const assembled = assembleReport({
      websiteUrl: fixture.input.websiteUrl,
      criteria: actual.store.criteria.filter(
        (row) => row.auditId === fixture.input.auditId,
      ),
      pillars: actual.store.pillars.filter(
        (row) => row.auditId === fixture.input.auditId,
      ),
      recommendations: selectRecommendations(
        actual.store.criteria.filter(
          (row) => row.auditId === fixture.input.auditId,
        ),
      ),
    });

    expect(assembled.noMajorIssues).toBe(false);
    expect(assembled.recommendations).toHaveLength(3);
    expect(assembled.pillars.every((pillar) => pillar.measured)).toBe(true);
    expect(assembled.overallScore).not.toBeNull();
    expect(assembledReportSchema.safeParse(assembled).success).toBe(true);
    expect(actual.store.reports[0]?.metadata).toMatchObject({
      assembled: { noMajorIssues: false },
    });
  });

  it("reflects not-assessed coverage on a performance-timeout / partial-like audit", async () => {
    const fixture = loadGoldenFixtures().find(
      (row) => row.name === "performance-timeout",
    );
    if (!fixture) throw new Error("missing fixture");
    const actual = await runGoldenFixture(fixture);
    const assembled = assembleReport({
      websiteUrl: fixture.input.websiteUrl,
      criteria: actual.store.criteria.filter(
        (row) => row.auditId === fixture.input.auditId,
      ),
      pillars: actual.store.pillars.filter(
        (row) => row.auditId === fixture.input.auditId,
      ),
      recommendations: selectRecommendations(
        actual.store.criteria.filter(
          (row) => row.auditId === fixture.input.auditId,
        ),
      ),
    });

    const lead = assembled.pillars.find((row) => row.key === "lead_conversion");
    expect(lead?.assessedCount).toBe(3);
    expect(lead?.notAssessedCount).toBe(1);
    expect(lead?.display).toBe("score");
    expect(
      lead?.checks.find((row) => row.key === "website_performance")?.outcome,
    ).toBe("not_assessed");
  });

  it("produces a no-major-issues report when every check passes", async () => {
    const fixture = loadGoldenFixtures().find(
      (row) => row.name === "strong-wordpress-plumber",
    );
    if (!fixture) throw new Error("missing fixture");
    const actual = await runGoldenFixture(fixture);
    const metadata = actual.store.reports[0]?.metadata as {
      assembled?: { noMajorIssues?: boolean; recommendations?: unknown[] };
    };
    expect(metadata.assembled?.noMajorIssues).toBe(true);
    expect(metadata.assembled?.recommendations).toEqual([]);
    expect(actual.store.reports[0]?.executive_summary).toBe(
      GOOD_SHAPE_EXECUTIVE_SUMMARY,
    );
  });
});
