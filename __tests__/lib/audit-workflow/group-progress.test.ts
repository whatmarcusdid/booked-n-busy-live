import {
  CAPTURE_MILESTONES,
  furthestCaptureMilestone,
  PROGRESS_MILESTONE_EVENT,
  type CaptureMilestone,
} from "@/lib/audit-workflow/capture-milestones";
import {
  activePillarGroup,
  criterionKeysForGroup,
  groupForCriterion,
  persistCriteriaByGroup,
  resolvePillarGroupProgress,
} from "@/lib/audit-workflow/progress-groups";
import { runAuditPipeline } from "@/lib/audit-workflow/pipeline";
import { createMemoryAuditStore } from "@/lib/audit-workflow/store";
import { CRITERIA_BY_PILLAR, PILLARS } from "@/lib/audit-workflow/types";
import { resolveLoadingView } from "@/lib/copy/audit-progress";
import { getProgressInfo } from "@/lib/schemas/audit-status";

const TRUST = criterionKeysForGroup("trust_signals");
const LEAD = criterionKeysForGroup("lead_conversion");
const GROWTH = criterionKeysForGroup("growth_infrastructure");

describe("pillar grouping", () => {
  it("groups the twelve checks exactly as the PRD defines them", () => {
    expect([...TRUST].sort()).toEqual([
      "key_person_credibility",
      "license_insurance",
      "reviews_above_fold",
      "service_area_clarity",
    ]);
    expect([...LEAD].sort()).toEqual([
      "phone_cta_visibility",
      "process_clarity",
      "quote_booking_cta_visibility",
      "website_performance",
    ]);
    expect([...GROWTH].sort()).toEqual([
      "faq_common_concerns",
      "offer_differentiation",
      "security_health",
      "seo_ai_search_readiness",
    ]);
  });

  it("takes membership from the scoring catalog rather than a second list", () => {
    // A check added to the catalog must appear in a group automatically, or
    // group progress could report complete while that check is outstanding.
    for (const pillar of PILLARS) {
      for (const criterion of CRITERIA_BY_PILLAR[pillar.key]) {
        expect(groupForCriterion(criterion.key)).toBe(pillar.key);
      }
    }
    expect(groupForCriterion("not_a_real_check")).toBeNull();
  });
});

describe("group progress under mixed completion order", () => {
  /**
   * A realistic interleaving: checks from all three pillars land out of
   * order, one group finishes early, another finishes last.
   */
  const arrival = [
    "license_insurance",
    "security_health",
    "phone_cta_visibility",
    "service_area_clarity",
    "seo_ai_search_readiness",
    "reviews_above_fold",
    "website_performance",
    "faq_common_concerns",
    "key_person_credibility",
    "quote_booking_cta_visibility",
    "offer_differentiation",
    "process_clarity",
  ];

  it("never reports a group complete while one of its checks is pending", () => {
    for (let i = 0; i <= arrival.length; i += 1) {
      const returned = new Set(arrival.slice(0, i));
      const groups = resolvePillarGroupProgress({
        returnedCriterionKeys: returned,
        signalsStarted: true,
      });

      for (const group of groups) {
        const outstanding = criterionKeysForGroup(group.key).filter(
          (key) => !returned.has(key),
        );
        if (group.progress === "complete") {
          expect(outstanding).toEqual([]);
        } else {
          expect(outstanding.length).toBeGreaterThan(0);
        }
        expect(group.returned).toBe(group.total - outstanding.length);
      }
    }
  });

  it("counts every terminal outcome as the check having returned", () => {
    // The row exists whatever the verdict was, including needs_review and
    // not_assessed, so all four shapes must count toward completion.
    const groups = resolvePillarGroupProgress({
      returnedCriterionKeys: TRUST,
      signalsStarted: true,
    });
    expect(groups.find((g) => g.key === "trust_signals")?.progress).toBe(
      "complete",
    );
  });

  it("never presents a finished group as the active one", () => {
    for (let i = 0; i <= arrival.length; i += 1) {
      const groups = resolvePillarGroupProgress({
        returnedCriterionKeys: arrival.slice(0, i),
        signalsStarted: true,
      });
      const active = activePillarGroup(groups);
      if (active === null) {
        expect(groups.every((g) => g.progress === "complete")).toBe(true);
      } else {
        expect(groups.find((g) => g.key === active)?.progress).not.toBe(
          "complete",
        );
      }
    }
  });

  it("reports the group furthest from completion when several are running", () => {
    // Trust has three of four, growth has one of four, lead has not started.
    // Growth is the running group furthest from done, so it is the one to
    // report — "first incomplete" would have picked nearly-finished trust.
    const groups = resolvePillarGroupProgress({
      returnedCriterionKeys: [...TRUST.slice(0, 3), GROWTH[0]],
      signalsStarted: false,
    });
    expect(activePillarGroup(groups)).toBe("growth_infrastructure");
  });

  it("treats a started-but-empty group as furthest from completion", () => {
    // Once the scoring phase begins every group is underway. A group with no
    // rows yet is further from done than one with three of four.
    const groups = resolvePillarGroupProgress({
      returnedCriterionKeys: TRUST.slice(0, 3),
      signalsStarted: true,
    });
    expect(activePillarGroup(groups)).toBe("lead_conversion");
  });

  it("falls back to the first unfinished group when none has started", () => {
    const groups = resolvePillarGroupProgress({
      returnedCriterionKeys: [],
      signalsStarted: false,
    });
    expect(groups.map((g) => g.progress)).toEqual([
      "pending",
      "pending",
      "pending",
    ]);
    expect(activePillarGroup(groups)).toBe("trust_signals");
  });

  it("goes quiet once every group has returned", () => {
    const groups = resolvePillarGroupProgress({
      returnedCriterionKeys: [...TRUST, ...LEAD, ...GROWTH],
      signalsStarted: true,
    });
    expect(activePillarGroup(groups)).toBeNull();
  });
});

describe("capture milestones", () => {
  it("takes the furthest milestone reached, not the latest recorded", () => {
    // A retried step re-records an earlier milestone; progress must not walk
    // backwards for the customer watching the screen.
    expect(
      furthestCaptureMilestone(["capture_pages", "capture_home"]),
    ).toBe(CAPTURE_MILESTONES.indexOf("capture_pages"));
    expect(furthestCaptureMilestone([])).toBe(-1);
  });

  it("records each milestone once, in order, during a real pipeline run", async () => {
    const auditId = "audit-milestones";
    const store = createMemoryAuditStore([
      { id: auditId, website_url: "https://example.com/", current_state: "submitted" },
    ]);

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com/",
      store,
      delayMs: 0,
    });

    const recorded = store.events
      .filter((event) => event.event_type === PROGRESS_MILESTONE_EVENT)
      .map((event) => event.event_data.milestone);

    expect(recorded).toEqual([...CAPTURE_MILESTONES]);
  });
});

describe("status API exposure", () => {
  it("carries group state and the active group for in-flight audits", () => {
    const info = getProgressInfo("scoring", undefined, {
      returnedCriterionKeys: TRUST,
    });

    expect(info.groups).toHaveLength(3);
    expect(info.groups?.find((g) => g.key === "trust_signals")?.progress).toBe(
      "complete",
    );
    expect(info.activeGroup).toBe("lead_conversion");
    expect(info.currentStep).toBe("Checking lead conversion");
  });

  it("claims no group is active once the audit is terminal", () => {
    // Including needs_review, where the audit has stopped and is waiting on a
    // person. Reporting a running group there would be a false claim.
    for (const status of ["complete", "partial", "needs_review", "failed", "unsupported"]) {
      const info = getProgressInfo(status, undefined, {
        returnedCriterionKeys: [...TRUST, ...LEAD],
      });
      expect(info.groups).toBeUndefined();
      expect(info.activeGroup).toBeUndefined();
    }
  });
});

describe("the loading screen shows one stage at a time", () => {
  /** Every poll a customer could make across one audit's real progress. */
  const timeline: Array<{
    status: string;
    activeGroup?: ReturnType<typeof activePillarGroup>;
    captureMilestone?: CaptureMilestone | null;
  }> = [
    { status: "submitted" },
    { status: "validating" },
    { status: "discovering" },
    { status: "rendering", captureMilestone: null },
    { status: "rendering", captureMilestone: "capture_home" },
    { status: "rendering", captureMilestone: "capture_performance" },
    { status: "rendering", captureMilestone: "capture_pages" },
    { status: "collecting_signals", activeGroup: "trust_signals" },
    { status: "scoring", activeGroup: "trust_signals" },
    { status: "scoring", activeGroup: "lead_conversion" },
    { status: "scoring", activeGroup: "growth_infrastructure" },
    { status: "scoring", activeGroup: null },
    { status: "generating_report" },
    { status: "validating_report" },
  ];

  it("holds the scorecard back until every check has returned", () => {
    // The load-bearing guarantee: while any group is outstanding the screen
    // stays on the previous stage, whatever else the workflow reports.
    for (const group of [
      "trust_signals",
      "lead_conversion",
      "growth_infrastructure",
    ] as const) {
      const view = resolveLoadingView({
        status: "scoring",
        elapsedMs: 0,
        activeGroup: group,
      });
      const active = view!.stages.filter((s) => s.progress === "active");
      expect(active).toHaveLength(1);
      expect(active[0].key).not.toBe("scorecard");
    }

    const done = resolveLoadingView({
      status: "scoring",
      elapsedMs: 0,
      activeGroup: null,
    });
    expect(
      done!.stages.filter((s) => s.progress === "active")[0].key,
    ).toBe("scorecard");
  });

  it("marks exactly one stage running at every point in the sequence", () => {
    for (const point of timeline) {
      const view = resolveLoadingView({ ...point, elapsedMs: 0 });
      const active = view!.stages.filter((s) => s.progress === "active");
      expect(active).toHaveLength(1);
    }
  });

  it("never moves the active stage backwards", () => {
    const indexOf = (point: (typeof timeline)[number]) =>
      resolveLoadingView({ ...point, elapsedMs: 0 })!.stages.findIndex(
        (s) => s.progress === "active",
      );

    const seen = timeline.map(indexOf);
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    }
    // And it actually walks all five, rather than sitting on one throughout.
    expect(new Set(seen)).toEqual(new Set([0, 1, 2, 3, 4]));
  });

  it("keeps showing one stage past the slow threshold", () => {
    // Slower-Than-Usual changes the headline and adds the wait card. The
    // audit is still processing, so stage progress remains true and shown.
    const view = resolveLoadingView({
      status: "scoring",
      elapsedMs: 120_000,
      activeGroup: "lead_conversion",
    });
    expect(view?.state).toBe("slow");
    expect(view?.stages.filter((s) => s.progress === "active")).toHaveLength(1);
  });

  it("drops stage progress entirely on the Needs Review screen", () => {
    // Processing has finished and the audit is waiting on a person. Group
    // progress is no longer relevant, and a running stage would be a lie.
    const view = resolveLoadingView({
      status: "needs_review",
      elapsedMs: 0,
      activeGroup: "growth_infrastructure",
      captureMilestone: "capture_pages",
    });
    expect(view?.state).toBe("needs_review");
    expect(view?.stages.every((s) => s.progress === "done")).toBe(true);
  });
});

describe("persisting group progress does not serialize the checks", () => {
  it("writes one pillar at a time after the rows already exist", async () => {
    const writes: string[][] = [];
    await persistCriteriaByGroup(
      [
        { criterion_key: "faq_common_concerns", pillar: "growth_infrastructure" as const },
        { criterion_key: "license_insurance", pillar: "trust_signals" as const },
        { criterion_key: "phone_cta_visibility", pillar: "lead_conversion" as const },
        { criterion_key: "service_area_clarity", pillar: "trust_signals" as const },
      ],
      async (rows) => {
        writes.push(rows.map((row) => row.pillar));
      },
    );

    expect(writes).toEqual([
      ["trust_signals", "trust_signals"],
      ["lead_conversion"],
      ["growth_infrastructure"],
    ]);
  });

  it("a representative pipeline stays fast, proving no display-only waits", async () => {
    // The mock pipeline with delayMs: 0 is the representative case: same
    // stage sequence as production, no network. A per-group sleep of even
    // 250ms would push this over the bound.
    const auditId = "audit-latency";
    const store = createMemoryAuditStore([
      { id: auditId, website_url: "https://example.com/", current_state: "submitted" },
    ]);

    const started = process.hrtime.bigint();
    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com/",
      store,
      delayMs: 0,
    });
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    expect(store.audits.get(auditId)?.current_state).toBe("complete");
    expect(elapsedMs).toBeLessThan(1500);
  });

  it("never reports a group complete while a check is still pending, mid-pipeline", async () => {
    const auditId = "audit-live-groups";
    const store = createMemoryAuditStore([
      { id: auditId, website_url: "https://example.com/", current_state: "submitted" },
    ]);

    const observations: ReturnType<typeof resolvePillarGroupProgress>[] = [];
    const write = store.upsertCriteria.bind(store);
    store.upsertCriteria = async (id, items) => {
      await write(id, items);
      const returned = (await store.listCriteria(id)).map(
        (row) => row.criterion_key,
      );
      const groups = resolvePillarGroupProgress({
        returnedCriterionKeys: returned,
        signalsStarted: true,
      });
      for (const group of groups) {
        const outstanding = criterionKeysForGroup(group.key).filter(
          (key) => !returned.includes(key),
        );
        if (group.progress === "complete") expect(outstanding).toEqual([]);
      }
      observations.push(groups);
    };

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com/",
      store,
      delayMs: 0,
    });

    // One write per pillar, so a poll sitting between them would see real
    // group-level progress rather than a single all-or-nothing batch.
    expect(observations.length).toBeGreaterThanOrEqual(3);
    expect(
      observations.some((groups) =>
        groups.some((g) => g.progress === "complete") &&
        groups.some((g) => g.progress !== "complete"),
      ),
    ).toBe(true);
  });

  it("drives the loading screen from those backend writes, one stage at a time", async () => {
    const auditId = "audit-live-screen";
    const store = createMemoryAuditStore([
      { id: auditId, website_url: "https://example.com/", current_state: "submitted" },
    ]);

    const activeKeys: string[][] = [];

    const snapshot = async (status: string) => {
      const returned = (await store.listCriteria(auditId)).map(
        (row) => row.criterion_key,
      );
      const milestones = store.events
        .filter((event) => event.event_type === PROGRESS_MILESTONE_EVENT)
        .map((event) => event.event_data.milestone)
        .filter(Boolean);
      const info = getProgressInfo(status, undefined, {
        returnedCriterionKeys: returned,
        captureMilestone:
          furthestCaptureMilestone(milestones as CaptureMilestone[]) >= 0
            ? CAPTURE_MILESTONES[
                furthestCaptureMilestone(milestones as CaptureMilestone[])
              ]
            : null,
      });
      const view = resolveLoadingView({
        status,
        elapsedMs: 0,
        activeGroup: info.activeGroup,
        captureMilestone: info.captureMilestone,
      });
      if (!view) return;
      activeKeys.push(
        view.stages.filter((s) => s.progress === "active").map((s) => s.key),
      );
    };

    const transition = store.recordTransition.bind(store);
    store.recordTransition = async (id, from, to) => {
      const result = await transition(id, from, to);
      await snapshot(to);
      return result;
    };
    const write = store.upsertCriteria.bind(store);
    store.upsertCriteria = async (id, items) => {
      await write(id, items);
      await snapshot(store.audits.get(id)?.current_state ?? "scoring");
    };

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com/",
      store,
      delayMs: 0,
    });

    expect(activeKeys.length).toBeGreaterThan(0);
    for (const active of activeKeys) {
      expect(active).toHaveLength(1);
    }
    expect(activeKeys.some((active) => active[0] === "trust")).toBe(true);
    expect(activeKeys.some((active) => active[0] === "contact")).toBe(true);
    expect(activeKeys.some((active) => active[0] === "foundations")).toBe(true);
  });
});
