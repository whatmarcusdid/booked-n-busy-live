import {
  FIX_FIRST_SEVERITY_CLASSES,
  fixFirstSeverityKey,
  fixFirstSeverityRank,
  isFixFirstEligible,
  selectFixFirst,
} from "@/lib/audit-workflow/fix-first";
import { stableCatalogIndex } from "@/lib/audit-workflow/criterion-outcome";
import { selectRecommendations } from "@/lib/audit-workflow/recommendations";
import { RULE_VERSION } from "@/lib/audit-workflow/rubric/model";
import type { CheckOutcome } from "@/lib/audit-workflow/rubric/model";
import type { ConfidenceLabel } from "@/lib/audit-workflow/rubric/confidence";
import type { CriterionInput } from "@/lib/audit-workflow/store";
import { CATALOG_KEYS } from "./goldens/types";

const PILLAR_OF: Record<string, string> = {
  license_insurance: "trust_signals",
  service_area_clarity: "trust_signals",
  reviews_above_fold: "trust_signals",
  key_person_credibility: "trust_signals",
  phone_cta_visibility: "lead_conversion",
  quote_booking_cta_visibility: "lead_conversion",
  website_performance: "lead_conversion",
  process_clarity: "lead_conversion",
  seo_ai_search_readiness: "growth_infrastructure",
  security_health: "growth_infrastructure",
  faq_common_concerns: "growth_infrastructure",
  offer_differentiation: "growth_infrastructure",
};

function check(
  key: string,
  outcome: CheckOutcome,
  confidence: ConfidenceLabel,
  extra: Record<string, unknown> = {},
): CriterionInput {
  return {
    criterion_key: key,
    criterion_name: key,
    pillar: PILLAR_OF[key] ?? "growth_infrastructure",
    score: outcome === "pass" ? 1 : 0,
    weight: 1,
    rule_version: RULE_VERSION,
    evidence_ids: [],
    findings: {
      assessed: outcome !== "not_assessed" && outcome !== "needs_review",
      outcome,
      confidence,
      mock: false,
      ...extra,
    },
  };
}

const select = (rows: CriterionInput[]) =>
  selectFixFirst(rows, (row) => stableCatalogIndex(row.criterion_key)).map(
    (item) => item.row.criterion_key,
  );

describe("Fix First eligibility", () => {
  it("requires a fail outcome — partial is not eligible", () => {
    expect(isFixFirstEligible(check("phone_cta_visibility", "fail", "high"))).toBe(
      true,
    );
    expect(
      isFixFirstEligible(check("phone_cta_visibility", "partial", "high")),
    ).toBe(false);
    expect(
      isFixFirstEligible(check("phone_cta_visibility", "pass", "high")),
    ).toBe(false);
  });

  it("requires high confidence", () => {
    for (const confidence of ["medium", "low", "not_assessed"] as const) {
      expect(
        isFixFirstEligible(check("phone_cta_visibility", "fail", confidence)),
      ).toBe(false);
    }
  });

  it("excludes needs_review and not_assessed regardless of confidence", () => {
    expect(
      isFixFirstEligible(check("phone_cta_visibility", "needs_review", "high")),
    ).toBe(false);
    expect(
      isFixFirstEligible(check("phone_cta_visibility", "not_assessed", "high")),
    ).toBe(false);
  });
});

describe("Fix First severity classes", () => {
  it("assigns every catalog check to exactly one class", () => {
    const named = FIX_FIRST_SEVERITY_CLASSES.flatMap((cls) => [...cls.checks]);
    expect(new Set(named).size).toBe(named.length);

    for (const key of CATALOG_KEYS) {
      const rank = fixFirstSeverityRank(check(key, "fail", "high"));
      expect(rank).toBeGreaterThanOrEqual(1);
      expect(rank).toBeLessThanOrEqual(4);
    }
  });

  it("orders the classes as locked", () => {
    expect(
      FIX_FIRST_SEVERITY_CLASSES.map((cls) => [cls.rank, cls.key]),
    ).toEqual([
      [1, "active_misconfiguration"],
      [2, "direct_contact_path"],
      [3, "trust_establishment"],
      [4, "growth_discovery"],
    ]);

    expect(fixFirstSeverityKey(check("phone_cta_visibility", "fail", "high"))).toBe(
      "direct_contact_path",
    );
    expect(fixFirstSeverityKey(check("license_insurance", "fail", "high"))).toBe(
      "trust_establishment",
    );
    expect(
      fixFirstSeverityKey(check("seo_ai_search_readiness", "fail", "high")),
    ).toBe("growth_discovery");
  });

  it("gives an active misconfiguration the rank-1 override regardless of pillar", () => {
    const noindex = check("seo_ai_search_readiness", "fail", "high", {
      noindex: true,
      active_misconfiguration: true,
    });
    expect(fixFirstSeverityRank(noindex)).toBe(1);
    expect(fixFirstSeverityKey(noindex)).toBe("active_misconfiguration");

    // It outranks a direct-contact-path failure from a different pillar.
    expect(
      select([noindex, check("phone_cta_visibility", "fail", "high")]),
    ).toEqual(["seo_ai_search_readiness"]);
  });

  it("ranks an HTTPS downgrade above plain HTTPS absence", () => {
    const downgrade = check("security_health", "fail", "high", {
      reason_code: "https_downgrade_redirect",
      active_misconfiguration: true,
    });
    const absent = check("security_health", "fail", "high", {
      reason_code: "https_absent",
    });

    expect(fixFirstSeverityKey(downgrade)).toBe("active_misconfiguration");
    expect(fixFirstSeverityRank(downgrade)).toBe(1);
    expect(fixFirstSeverityKey(absent)).toBe("growth_discovery");
    expect(fixFirstSeverityRank(absent)).toBe(4);
    expect(
      selectFixFirst([absent, downgrade], () => 0)[0]?.row.findings.reason_code,
    ).toBe("https_downgrade_redirect");
  });

  it("does not rank by pillar", () => {
    // Trust Signals is the first pillar, but a contact-path failure in the
    // second pillar must still win. This is the exact case the old
    // pillar-order ranking got wrong.
    expect(
      select([
        check("license_insurance", "fail", "high"),
        check("phone_cta_visibility", "fail", "high"),
      ]),
    ).toEqual(["phone_cta_visibility"]);
  });

  it("breaks ties inside one class by stable catalog order only", () => {
    const forward = select([
      check("quote_booking_cta_visibility", "fail", "high"),
      check("phone_cta_visibility", "fail", "high"),
    ]);
    const reversed = select([
      check("phone_cta_visibility", "fail", "high"),
      check("quote_booking_cta_visibility", "fail", "high"),
    ]);
    expect(forward).toEqual(reversed);
    expect(forward).toEqual([
      "phone_cta_visibility",
      "quote_booking_cta_visibility",
    ]);
  });
});

describe("Fix First surfacing", () => {
  it("surfaces exactly one primary when no other check shares the top class", () => {
    expect(
      select([
        check("phone_cta_visibility", "fail", "high"),
        check("license_insurance", "fail", "high"),
        check("seo_ai_search_readiness", "fail", "high"),
      ]),
    ).toEqual(["phone_cta_visibility"]);
  });

  it("adds a second only when a distinct eligible check shares the top class", () => {
    expect(
      select([
        check("phone_cta_visibility", "fail", "high"),
        check("quote_booking_cta_visibility", "fail", "high"),
        check("license_insurance", "fail", "high"),
      ]),
    ).toEqual(["phone_cta_visibility", "quote_booking_cta_visibility"]);
  });

  it("never surfaces more than two, even with every check failing", () => {
    const all = CATALOG_KEYS.map((key) => check(key, "fail", "high"));
    expect(select(all).length).toBeLessThanOrEqual(2);
  });

  it("surfaces nothing when no check is eligible", () => {
    expect(
      select([
        check("phone_cta_visibility", "partial", "high"),
        check("license_insurance", "fail", "medium"),
        check("website_performance", "not_assessed", "not_assessed"),
      ]),
    ).toEqual([]);
  });
});

describe("selectRecommendations", () => {
  it("labels the primary fix_first and a qualifying second fix_next", () => {
    const recs = selectRecommendations([
      check("phone_cta_visibility", "fail", "high"),
      check("quote_booking_cta_visibility", "fail", "high"),
      check("license_insurance", "fail", "high"),
    ]);
    expect(recs.map((row) => [row.criterion_key, row.priority])).toEqual([
      ["phone_cta_visibility", "fix_first"],
      ["quote_booking_cta_visibility", "fix_next"],
    ]);
    expect(recs.every((row) => row.severity_class === "direct_contact_path")).toBe(
      true,
    );
  });

  it("never emits improve_later, since a third slot no longer exists", () => {
    const recs = selectRecommendations(
      CATALOG_KEYS.map((key) => check(key, "fail", "high")),
    );
    expect(recs.length).toBeLessThanOrEqual(2);
    expect(recs.some((row) => row.priority === "improve_later")).toBe(false);
  });

  it("emits only fail outcomes", () => {
    const recs = selectRecommendations([
      check("phone_cta_visibility", "partial", "high"),
      check("process_clarity", "fail", "high"),
    ]);
    expect(recs.map((row) => row.outcome)).toEqual(["fail"]);
  });
});
