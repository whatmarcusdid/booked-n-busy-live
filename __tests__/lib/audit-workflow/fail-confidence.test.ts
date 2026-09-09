import { isFixFirstEligible } from "@/lib/audit-workflow/fix-first";
import { confidenceFromFindings } from "@/lib/audit-workflow/rubric/confidence";
import { loadGoldenFixtures, runGoldenFixture } from "./goldens/runner";

/**
 * Fix First eligibility is `fail` + `high` confidence. That combination has to
 * be reachable for the locked severity classes to mean anything — decision #12
 * puts `phone_cta_visibility` and `quote_booking_cta_visibility` in the
 * second-highest class, so an absence-based fail must be able to reach `high`.
 *
 * These tests pin that down against real pipeline output rather than
 * hand-built rows, so a future change to the confidence model that silently
 * makes contact-path failures ineligible will fail here.
 */
const fixtures = loadGoldenFixtures();

describe("confidence on failing checks", () => {
  it("rates a definitive absence as high confidence", async () => {
    const roofer = fixtures.find((row) => row.name === "weak-godaddy-roofer");
    if (!roofer) throw new Error("weak-godaddy-roofer fixture missing");
    const actual = await runGoldenFixture(roofer);
    const criteria = actual.store.criteria.filter(
      (row) => row.auditId === roofer.input.auditId,
    );

    const failing = criteria.filter((row) => row.findings.outcome === "fail");
    expect(failing.length).toBeGreaterThan(0);
    for (const row of failing) {
      expect(confidenceFromFindings(row.findings)).toBe("high");
      expect(isFixFirstEligible(row)).toBe(true);
    }
  });

  it("still discounts an interpreted positive signal below high", async () => {
    // A `partial` comes from a signal we matched and had to interpret, so it
    // keeps its heuristic discount and stays out of Fix First.
    const landscaper = fixtures.find(
      (row) => row.name === "squarespace-landscaper",
    );
    if (!landscaper) throw new Error("squarespace-landscaper fixture missing");
    const actual = await runGoldenFixture(landscaper);
    const criteria = actual.store.criteria.filter(
      (row) => row.auditId === landscaper.input.auditId,
    );

    const partials = criteria.filter(
      (row) => row.findings.outcome === "partial" && row.findings.mock !== true,
    );
    expect(partials.length).toBeGreaterThan(0);
    for (const row of partials) {
      expect(isFixFirstEligible(row)).toBe(false);
    }
  });

  it("rates an unassessed check as not_assessed, never high", async () => {
    const timeout = fixtures.find((row) => row.name === "performance-timeout");
    if (!timeout) throw new Error("performance-timeout fixture missing");
    const actual = await runGoldenFixture(timeout);
    const performance = actual.store.criteria.find(
      (row) =>
        row.auditId === timeout.input.auditId &&
        row.criterion_key === "website_performance",
    );

    expect(performance?.findings.outcome).toBe("not_assessed");
    expect(confidenceFromFindings(performance!.findings)).toBe("not_assessed");
    expect(isFixFirstEligible(performance!)).toBe(false);
  });
});
