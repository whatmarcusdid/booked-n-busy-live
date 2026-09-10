/**
 * Admin review console (Loop 3).
 *
 * Covers the four properties the Definition of Done turns on: priority-flagged
 * audits surface first, queue health is accurate, an override cannot be
 * recorded without a reason, and a human decision is appended beside the
 * machine result rather than overwriting it.
 */
import {
  assembleReviewQueue,
  buildQueueItem,
  criteriaFromRows,
  formatAge,
  latestRevisionPerAudit,
  orderQueue,
  outcomeOf,
  PENDING_PUBLICATION_STATUS,
  summarizeQueue,
  type QueueAuditInput,
} from "@/lib/admin/review-queue";
import {
  isReasonAcceptable,
  requiresReason,
  REVIEW_DECISION_BY_ACTION,
  toReviewRecord,
} from "@/lib/admin/review-history";
import {
  groupEvidenceForReview,
  toEvidenceView,
  type EvidenceRow,
} from "@/lib/admin/evidence";
import type { CriterionInput } from "@/lib/audit-workflow/store";

const NOW = new Date("2026-09-08T12:00:00.000Z").getTime();
const HOUR = 3_600_000;

function check(
  key: string,
  outcome: "pass" | "fail" | "needs_review",
  extra: Record<string, unknown> = {},
): CriterionInput {
  // Score is kept consistent with the outcome so the fixtures do not trip the
  // separate `contradictory_outcome` reason, which is not a priority trigger.
  const score = outcome === "pass" ? 1 : 0;
  return {
    criterion_key: key,
    criterion_name: key.replace(/_/g, " "),
    pillar: "conversion",
    score,
    weight: 0.1,
    findings:
      outcome === "needs_review"
        ? { outcome, ...extra }
        : { outcome, assessed: true, ...extra },
  };
}

/** Eight passing checks, so `insufficient_assessed_checks` never confounds. */
function passingBaseline(count = 8): CriterionInput[] {
  return Array.from({ length: count }, (_, index) =>
    check(`baseline_check_${index}`, "pass"),
  );
}

function audit(
  overrides: Partial<QueueAuditInput> & Pick<QueueAuditInput, "id">,
): QueueAuditInput {
  return {
    businessName: `Business ${overrides.id}`,
    websiteUrl: `https://${overrides.id}.example.com`,
    currentState: "complete",
    createdAt: new Date(NOW - HOUR).toISOString(),
    revisionNumber: 1,
    overallScore: 0.7,
    criteria: passingBaseline(),
    ...overrides,
  };
}

describe("priority flagging", () => {
  it("flags a needs_review on a high-severity check, even alone", () => {
    // phone_cta_visibility is severity tier 2 — the direct contact path.
    const item = buildQueueItem(
      audit({
        id: "a",
        criteria: [...passingBaseline(), check("phone_cta_visibility", "needs_review")],
      }),
      NOW,
    );

    expect(item.priority).toBe(true);
    expect(item.priorityReasons).toContain("high_severity_needs_review");
    expect(item.highSeverityNeedsReviewKeys).toEqual(["phone_cta_visibility"]);
  });

  it("does not flag a single needs_review on a low-severity check", () => {
    // faq_common_concerns is tier 4: uncertainty there only matters combined
    // with a second needs_review or an audit-level Partial.
    const item = buildQueueItem(
      audit({
        id: "b",
        criteria: [...passingBaseline(), check("faq_common_concerns", "needs_review")],
      }),
      NOW,
    );

    expect(item.priority).toBe(false);
    expect(item.priorityReasons).toEqual([]);
    expect(item.needsReviewCount).toBe(1);
  });

  it("flags two or more needs_review checks regardless of severity", () => {
    const item = buildQueueItem(
      audit({
        id: "c",
        criteria: [
          ...passingBaseline(),
          check("faq_common_concerns", "needs_review"),
          check("offer_differentiation", "needs_review"),
        ],
      }),
      NOW,
    );

    expect(item.priority).toBe(true);
    expect(item.priorityReasons).toContain("needs_review_count");
  });

  it("flags needs_review co-occurring with an audit-level partial", () => {
    const item = buildQueueItem(
      audit({
        id: "d",
        currentState: "partial",
        criteria: [...passingBaseline(), check("faq_common_concerns", "needs_review")],
      }),
      NOW,
    );

    expect(item.priority).toBe(true);
    expect(item.priorityReasons).toContain("needs_review_with_partial");
  });

  it("does not treat a thin audit as priority, only as ineligible", () => {
    // insufficient_assessed_checks blocks auto-publication but is not a
    // reason to jump ahead of a flagged audit.
    const item = buildQueueItem(
      audit({ id: "e", criteria: passingBaseline(3) }),
      NOW,
    );

    expect(item.priority).toBe(false);
    expect(item.priorityReasons).toEqual([]);
  });
});

describe("queue ordering", () => {
  it("puts flagged audits ahead of routine ones, however new", () => {
    const queue = assembleReviewQueue(
      [
        audit({
          id: "routine-ancient",
          createdAt: new Date(NOW - 200 * HOUR).toISOString(),
        }),
        audit({
          id: "flagged-fresh",
          createdAt: new Date(NOW - 1 * HOUR).toISOString(),
          criteria: [
            ...passingBaseline(),
            check("quote_booking_cta_visibility", "needs_review"),
          ],
        }),
      ],
      NOW,
    );

    expect(queue.items.map((item) => item.id)).toEqual([
      "flagged-fresh",
      "routine-ancient",
    ]);
  });

  it("orders oldest first inside each group", () => {
    const flagged = (id: string, hoursAgo: number) =>
      audit({
        id,
        createdAt: new Date(NOW - hoursAgo * HOUR).toISOString(),
        criteria: [
          ...passingBaseline(),
          check("phone_cta_visibility", "needs_review"),
        ],
      });

    const queue = assembleReviewQueue(
      [
        flagged("flagged-new", 2),
        audit({ id: "routine-new", createdAt: new Date(NOW - HOUR).toISOString() }),
        flagged("flagged-old", 50),
        audit({
          id: "routine-old",
          createdAt: new Date(NOW - 90 * HOUR).toISOString(),
        }),
      ],
      NOW,
    );

    expect(queue.items.map((item) => item.id)).toEqual([
      "flagged-old",
      "flagged-new",
      "routine-old",
      "routine-new",
    ]);
  });

  it("is a pure sort — the input array is not mutated", () => {
    const items = [
      buildQueueItem(audit({ id: "z" }), NOW),
      buildQueueItem(
        audit({
          id: "a",
          criteria: [
            ...passingBaseline(),
            check("phone_cta_visibility", "needs_review"),
          ],
        }),
        NOW,
      ),
    ];

    orderQueue(items);

    expect(items.map((item) => item.id)).toEqual(["z", "a"]);
  });
});

describe("queue health", () => {
  it("reports pending, flagged, and the longest wait", () => {
    const queue = assembleReviewQueue(
      [
        audit({ id: "one", createdAt: new Date(NOW - 3 * HOUR).toISOString() }),
        audit({
          id: "two",
          businessName: "Oldest Roofing",
          createdAt: new Date(NOW - 26 * HOUR).toISOString(),
          criteria: [
            ...passingBaseline(),
            check("phone_cta_visibility", "needs_review"),
          ],
        }),
        audit({
          id: "three",
          createdAt: new Date(NOW - HOUR).toISOString(),
          criteria: [
            ...passingBaseline(),
            check("faq_common_concerns", "needs_review"),
            check("offer_differentiation", "needs_review"),
          ],
        }),
      ],
      NOW,
    );

    expect(queue.health.pendingCount).toBe(3);
    expect(queue.health.flaggedCount).toBe(2);
    expect(queue.health.oldestPendingAgeMs).toBe(26 * HOUR);
    expect(queue.health.oldestPendingBusinessName).toBe("Oldest Roofing");
  });

  it("distinguishes an empty queue from a zero-age one", () => {
    const health = summarizeQueue([]);

    expect(health.pendingCount).toBe(0);
    expect(health.flaggedCount).toBe(0);
    expect(health.oldestPendingAgeMs).toBeNull();
    expect(health.oldestPendingBusinessName).toBeNull();
  });

  it("never reports a negative age for a clock skew", () => {
    const item = buildQueueItem(
      audit({ id: "future", createdAt: new Date(NOW + HOUR).toISOString() }),
      NOW,
    );

    expect(item.ageMs).toBe(0);
  });

  it("formats ages a reviewer can read", () => {
    expect(formatAge(null)).toBe("—");
    expect(formatAge(30_000)).toBe("under a minute");
    expect(formatAge(45 * 60_000)).toBe("45m");
    expect(formatAge(2 * HOUR + 15 * 60_000)).toBe("2h 15m");
    expect(formatAge(50 * HOUR)).toBe("2d 2h");
  });
});

describe("pending detection", () => {
  it("reads publication status from the latest revision only", () => {
    const latest = latestRevisionPerAudit([
      { audit_id: "x", revision_number: 1, publication_status: "review_required" },
      { audit_id: "x", revision_number: 2, publication_status: "published" },
      { audit_id: "y", revision_number: 1, publication_status: "review_required" },
    ]);

    // An audit already published is not pending just because revision 1 was.
    expect(latest.get("x")?.publication_status).toBe("published");
    expect(latest.get("y")?.publication_status).toBe(
      PENDING_PUBLICATION_STATUS,
    );
  });

  it("maps database rows into scoreable criteria", () => {
    const criteria = criteriaFromRows([
      {
        criterion_key: "phone_cta_visibility",
        criterion_name: "Phone CTA",
        pillar: "conversion",
        score: "0.00",
        weight: "0.10",
        findings: { outcome: "needs_review" },
      },
    ]);

    expect(criteria[0].score).toBe(0);
    expect(outcomeOf(criteria[0])).toBe("needs_review");
  });

  it("falls back to not_assessed when a row records no outcome", () => {
    const [criterion] = criteriaFromRows([
      {
        criterion_key: "orphan",
        criterion_name: "Orphan",
        pillar: "conversion",
        score: 0,
        weight: 0.1,
        findings: null,
      },
    ]);

    expect(outcomeOf(criterion)).toBe("not_assessed");
  });
});

describe("override reason gate", () => {
  it("requires a reason for override and not for publish or hold", () => {
    expect(requiresReason("override")).toBe(true);
    expect(requiresReason("publish")).toBe(false);
    expect(requiresReason("hold")).toBe(false);
  });

  it("rejects an empty or whitespace-only reason", () => {
    expect(isReasonAcceptable(undefined)).toBe(false);
    expect(isReasonAcceptable("")).toBe(false);
    expect(isReasonAcceptable("   \n\t ")).toBe(false);
    expect(isReasonAcceptable("Phone number is visible in the header.")).toBe(
      true,
    );
  });

  it("maps the three console actions onto the existing decision enum", () => {
    // admin_reviews.decision has a CHECK constraint allowing only these
    // three values, so the console cannot invent a fourth.
    expect(Object.values(REVIEW_DECISION_BY_ACTION).sort()).toEqual([
      "approve",
      "needs_changes",
      "reject",
    ]);
  });
});

describe("decision records", () => {
  it("keeps the override reason readable and marks it as an override", () => {
    const record = toReviewRecord({
      id: "review-1",
      decision: "reject",
      note: "Phone CTA was visible; the check misread the header.",
      reviewer_email_hash: "unresolvable-hash",
      created_at: "2026-09-08T11:00:00.000Z",
    });

    expect(record.isOverride).toBe(true);
    expect(record.note).toBe(
      "Phone CTA was visible; the check misread the header.",
    );
    // No allow-list entry matches, so the hash stands in rather than leaking.
    expect(record.reviewer).toBe("unresolvable-hash");
  });

  it("does not mark an approval as an override", () => {
    const record = toReviewRecord({
      id: "review-2",
      decision: "approve",
      note: null,
      reviewer_email_hash: "hash",
      created_at: "2026-09-08T11:00:00.000Z",
    });

    expect(record.isOverride).toBe(false);
  });
});

describe("evidence viewer", () => {
  const rows: EvidenceRow[] = [
    {
      id: "ev-1",
      evidence_type: "phone_cta_visibility",
      url: "https://example.com/",
      description: '<a href="tel:5551234">Call now</a>',
      metadata: {
        criterion_key: "phone_cta_visibility",
        locator: "header a[href^='tel:']",
        confidence: 0.4,
        collection_method: "dom",
        outcome: "needs_review",
        reason_code: "AMBIGUOUS_SELECTOR",
      },
      artifact_id: "art-1",
    },
    {
      id: "ev-2",
      evidence_type: "lighthouse_report",
      url: null,
      description: "raw lighthouse output",
      metadata: { mock: false },
      artifact_id: null,
    },
  ];

  it("groups evidence under the criterion it supports", () => {
    const grouped = groupEvidenceForReview(rows, [], {});

    expect(grouped.byCriterion.phone_cta_visibility).toHaveLength(1);
    expect(grouped.byCriterion.phone_cta_visibility[0].snippet).toContain(
      "tel:5551234",
    );
    expect(grouped.byCriterion.phone_cta_visibility[0].locator).toBe(
      "header a[href^='tel:']",
    );
  });

  it("keeps evidence with no criterion attributed separately", () => {
    const grouped = groupEvidenceForReview(rows, [], {});

    expect(grouped.unattributed.map((item) => item.evidenceType)).toEqual([
      "lighthouse_report",
    ]);
  });

  it("collects reason codes for the viewer", () => {
    const grouped = groupEvidenceForReview(rows, [], {});

    expect(grouped.reasonCodes).toEqual(["AMBIGUOUS_SELECTOR"]);
  });

  it("pairs screenshots with their signed URL, and survives without one", () => {
    const artifacts = [
      {
        id: "art-1",
        storage_key: "audits/a/home/desktop.png",
        mime_type: "image/png",
        viewport: "desktop",
        audit_page_id: null,
      },
      {
        id: "art-2",
        storage_key: "audits/a/home/mobile.png",
        mime_type: "image/png",
        viewport: "mobile",
        audit_page_id: null,
      },
    ];

    const grouped = groupEvidenceForReview(rows, artifacts, {
      "audits/a/home/desktop.png": "https://signed.example/desktop.png",
    });

    expect(grouped.screenshots[0].signedUrl).toBe(
      "https://signed.example/desktop.png",
    );
    // A bucket that refused to sign leaves the row visible, not missing.
    expect(grouped.screenshots[1].signedUrl).toBeNull();
    expect(grouped.screenshots[1].viewport).toBe("mobile");
  });

  it("does not invent fields the evidence row never recorded", () => {
    const view = toEvidenceView({
      id: "ev-3",
      evidence_type: "seo_ai_search_readiness",
      url: null,
      description: null,
      metadata: {},
      artifact_id: null,
    });

    expect(view.snippet).toBeNull();
    expect(view.locator).toBeNull();
    expect(view.confidence).toBeNull();
    expect(view.reasonCode).toBeNull();
  });
});
