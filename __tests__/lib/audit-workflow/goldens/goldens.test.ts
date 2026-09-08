import { RULE_VERSION } from "@/lib/audit-workflow/rubric/model";
import { GOOD_SHAPE_EXECUTIVE_SUMMARY } from "@/lib/audit-workflow/recommendations";
import { validateReportForPublication } from "@/lib/reports/publication";
import type { AssembledReport } from "@/lib/reports/schema";
import { CATALOG_KEYS } from "./types";
import { loadGoldenFixtures, runGoldenFixture } from "./runner";

const fixtures = loadGoldenFixtures();

describe("M5 golden fixture suite", () => {
  it("loads all seven checked-in fixtures", () => {
    expect(fixtures.map((row) => row.name)).toEqual([
      "custom-electrical",
      "mixed-wix-hvac",
      "performance-timeout",
      "squarespace-landscaper",
      "strong-wordpress-plumber",
      "unsupported-access",
      "weak-godaddy-roofer",
    ]);
  });

  it.each(fixtures)(
    "$name matches the locked v2 manifest exactly",
    async (fixture) => {
      const { manifest } = fixture;
      expect(manifest.rubricVersion).toBe(RULE_VERSION);
      expect(manifest.publicationValidation).toBeDefined();
      expect(Object.keys(manifest.expectedCriterionOutcomes).sort()).toEqual(
        [...CATALOG_KEYS].sort(),
      );

      const actual = await runGoldenFixture(fixture);

      expect(actual.rubricVersion).toBe(manifest.rubricVersion);
      expect(actual.result).toBe(manifest.expectedAuditOutcome);
      expect(actual.humanReviewRequired).toBe(manifest.humanReviewRequired);
      expect(actual.outcomes).toEqual(manifest.expectedCriterionOutcomes);
      expect(actual.pillarScores).toEqual(manifest.expectedPillarScores);
      expect(actual.coverage).toEqual(manifest.expectedAssessmentCoverage);

      const recs = actual.recommendations.map((row) => ({
        criterion_key: row.criterion_key,
        priority: row.priority,
      }));
      expect(recs).toEqual(manifest.expectedRecommendations);

      const fixFirst = recs.filter((row) => row.priority === "fix_first");
      expect(fixFirst.length).toBeLessThanOrEqual(1);
      if (recs.length > 0) {
        expect(recs[0].priority).toBe("fix_first");
      }

      if (fixture.input.kind === "unsupported_access") {
        expect(actual.pillarScores.lead_conversion).toBeNull();
        expect(actual.pillarScores.growth_infrastructure).toBeNull();
        expect(actual.store.reports).toEqual([]);
        expect(actual.recommendations).toEqual([]);
        expect(
          Object.values(manifest.expectedCriterionOutcomes).every(
            (outcome) =>
              outcome === "not_assessed" ||
              outcome === "pass" ||
              outcome === "partial",
          ),
        ).toBe(true);
        expect(
          CATALOG_KEYS.filter(
            (key) =>
              key !== "reviews_above_fold" && key !== "key_person_credibility",
          ).every(
            (key) => manifest.expectedCriterionOutcomes[key] === "not_assessed",
          ),
        ).toBe(true);
      }

      if (fixture.input.kind === "performance_timeout") {
        expect(actual.outcomes.website_performance).toBe("not_assessed");
        expect(actual.coverage.lead_conversion).toEqual({
          assessed: 3,
          not_assessed: 1,
        });
        expect(actual.recommendations.length).toBeGreaterThan(0);
      }

      const assembled = actual.store.reports[0]?.metadata?.assembled as
        | AssembledReport
        | undefined;
      if (manifest.publicationValidation.eligible) {
        expect(validateReportForPublication(assembled).ok).toBe(true);
        expect(actual.store.reports[0]?.publication_status).toBe(
          "review_required",
        );
      } else {
        expect(assembled).toBeUndefined();
      }

      if (fixture.name === "strong-wordpress-plumber") {
        expect(actual.recommendations).toEqual([]);
        expect(actual.store.reports[0]?.executive_summary).toBe(
          GOOD_SHAPE_EXECUTIVE_SUMMARY,
        );
      }

      for (const rec of actual.recommendations) {
        const evidenceIds = rec.evidence_ids ?? [];
        const linked = actual.store.recommendationEvidence.filter(
          (row) => row.recommendationId === rec.id,
        );
        expect(linked.map((row) => row.evidenceId).sort()).toEqual(
          [...evidenceIds].sort(),
        );
      }
    },
  );
});
