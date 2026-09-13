import { readFileSync } from "fs";
import { AUDIT_WALL_CLOCK_CEILING_MS } from "@/lib/audit-workflow/budget";
import { SLOW_AUDIT_THRESHOLD_MS } from "@/lib/copy/timing";
import type { CriterionInput } from "@/lib/audit-workflow/store";
import {
  assembleObservabilityDashboard,
  classifyCompletion,
  durationFromTransitions,
  parseDashboardRange,
  rangeStart,
  type ObservabilityAudit,
} from "@/lib/admin/observability";

const NOW = new Date("2026-09-10T12:00:00.000Z");

function audit(
  id: string,
  state: string,
  createdAt = "2026-09-10T11:00:00.000Z",
  extras: { costUsd?: number | null; killSwitchReason?: string | null } = {},
): ObservabilityAudit {
  return {
    id,
    currentState: state,
    createdAt,
    costUsd: extras.costUsd,
    killSwitchReason: extras.killSwitchReason,
  };
}

function check(
  key: string,
  outcome: "pass" | "fail" | "needs_review",
): CriterionInput {
  const score = outcome === "pass" ? 1 : 0;
  return {
    criterion_key: key,
    criterion_name: key,
    pillar: "lead_conversion",
    score,
    weight: 0.1,
    findings:
      outcome === "needs_review"
        ? { outcome }
        : { outcome, assessed: true },
  };
}

function passingBaseline(count = 8): CriterionInput[] {
  return Array.from({ length: count }, (_, index) =>
    check(`baseline_check_${index}`, "pass"),
  );
}

describe("observability range parsing", () => {
  it("defaults to 7 days and accepts the four locked windows", () => {
    expect(parseDashboardRange(undefined)).toBe("7d");
    expect(parseDashboardRange("today")).toBe("today");
    expect(parseDashboardRange("garbage")).toBe("7d");
    expect(rangeStart("today", NOW)?.toISOString()).toBe(
      "2026-09-10T00:00:00.000Z",
    );
    expect(rangeStart("7d", NOW)?.toISOString()).toBe(
      "2026-09-03T12:00:00.000Z",
    );
    expect(rangeStart("all", NOW)).toBeNull();
  });
});

describe("state distribution", () => {
  it("counts seeded audits per terminal state and ignores in-flight rows", () => {
    const dashboard = assembleObservabilityDashboard({
      range: "all",
      now: NOW,
      audits: [
        audit("a", "complete"),
        audit("b", "complete"),
        audit("c", "partial"),
        audit("d", "needs_review"),
        audit("e", "unsupported"),
        audit("f", "failed"),
        audit("g", "submitted"),
        audit("h", "scoring"),
      ],
      transitions: [],
      criteriaByAudit: {},
    });

    expect(dashboard.totalSubmitted).toBe(8);
    expect(dashboard.stateDistribution).toEqual([
      { state: "complete", count: 2 },
      { state: "partial", count: 1 },
      { state: "needs_review", count: 1 },
      { state: "unsupported", count: 1 },
      { state: "failed", count: 1 },
    ]);
  });
});

describe("completion-time bucketing", () => {
  it("classifies under 90s, fallback-then-complete, and 15-minute kill switch", () => {
    expect(classifyCompletion(45_000)).toBe("before_90s");
    expect(classifyCompletion(SLOW_AUDIT_THRESHOLD_MS - 1)).toBe("before_90s");
    expect(classifyCompletion(SLOW_AUDIT_THRESHOLD_MS)).toBe("after_fallback");
    expect(classifyCompletion(120_000)).toBe("after_fallback");
    expect(classifyCompletion(AUDIT_WALL_CLOCK_CEILING_MS)).toBe(
      "kill_switch_15m",
    );
    expect(classifyCompletion(AUDIT_WALL_CLOCK_CEILING_MS + 1_000)).toBe(
      "kill_switch_15m",
    );
  });

  it("measures submitted → first terminal transition", () => {
    const start = "2026-09-10T11:00:00.000Z";
    expect(
      durationFromTransitions(
        [
          { toState: "submitted", transitionedAt: start },
          { toState: "complete", transitionedAt: "2026-09-10T11:00:45.000Z" },
        ],
        start,
      ),
    ).toBe(45_000);
  });

  it("buckets seeded terminal audits from their transitions", () => {
    const start = "2026-09-10T11:00:00.000Z";
    const dashboard = assembleObservabilityDashboard({
      range: "all",
      now: NOW,
      audits: [
        audit("fast", "complete", start),
        audit("slow", "complete", start),
        audit("killed", "failed", start),
      ],
      transitions: [
        {
          auditId: "fast",
          toState: "submitted",
          transitionedAt: start,
        },
        {
          auditId: "fast",
          toState: "complete",
          transitionedAt: "2026-09-10T11:00:45.000Z",
        },
        {
          auditId: "slow",
          toState: "submitted",
          transitionedAt: start,
        },
        {
          auditId: "slow",
          toState: "complete",
          transitionedAt: "2026-09-10T11:02:00.000Z",
        },
        {
          auditId: "killed",
          toState: "submitted",
          transitionedAt: start,
        },
        {
          auditId: "killed",
          toState: "failed",
          transitionedAt: "2026-09-10T11:15:00.000Z",
        },
      ],
      criteriaByAudit: {},
    });

    expect(dashboard.completion.classified).toBe(3);
    expect(dashboard.completion.buckets).toEqual([
      {
        bucket: "before_90s",
        label: "Completed before 90 seconds",
        count: 1,
        percent: 1 / 3,
      },
      {
        bucket: "after_fallback",
        label: "Fallback shown, then completed",
        count: 1,
        percent: 1 / 3,
      },
      {
        bucket: "kill_switch_15m",
        label: "Terminated by the 15-minute kill switch",
        count: 1,
        percent: 1 / 3,
      },
    ]);
  });
});

describe("needs-review rate", () => {
  it("is needs_review count over total submitted, with decision #12 trigger counts", () => {
    const dashboard = assembleObservabilityDashboard({
      range: "all",
      now: NOW,
      audits: [
        audit("clean-1", "complete"),
        audit("clean-2", "complete"),
        audit("clean-3", "complete"),
        audit("nr-high", "needs_review"),
        audit("nr-count", "needs_review"),
      ],
      transitions: [],
      criteriaByAudit: {
        "nr-high": [
          ...passingBaseline(),
          check("phone_cta_visibility", "needs_review"),
        ],
        "nr-count": [
          ...passingBaseline(),
          check("faq_common_concerns", "needs_review"),
          check("offer_differentiation", "needs_review"),
        ],
      },
    });

    expect(dashboard.needsReview.count).toBe(2);
    expect(dashboard.needsReview.rate).toBe(2 / 5);
    expect(dashboard.needsReview.triggers.map((row) => row.reason)).toEqual([
      "high_severity_needs_review",
      "needs_review_count",
      "needs_review_with_partial",
    ]);
    expect(
      dashboard.needsReview.triggers.find(
        (row) => row.reason === "high_severity_needs_review",
      )?.count,
    ).toBe(1);
    expect(
      dashboard.needsReview.triggers.find(
        (row) => row.reason === "needs_review_count",
      )?.count,
    ).toBe(1);
    expect(
      dashboard.needsReview.triggers.find(
        (row) => row.reason === "needs_review_with_partial",
      )?.count,
    ).toBe(0);
    expect(dashboard.needsReview.triggers.map((row) => row.label)).toEqual([
      "a high-severity check needs review",
      "2 or more checks need review",
      "needs review on a partial audit",
    ]);
  });
});

describe("observability is read-only", () => {
  it("does not write and does not invent tables or jobs", () => {
    const source = readFileSync("lib/admin/observability.ts", "utf8");
    expect(source).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
    expect(source).not.toContain("CREATE TABLE");
    expect(source).not.toContain("crons");
    expect(source).not.toContain('.from("audit_cost_entries")');
  });
});

describe("cost and kill-switch panel", () => {
  it("renders zeros when the window has no audits", () => {
    const dashboard = assembleObservabilityDashboard({
      range: "all",
      now: NOW,
      audits: [],
      transitions: [],
      criteriaByAudit: {},
    });

    expect(dashboard.cost).toEqual({
      totalSpendUsd: 0,
      averageUsd: 0,
      medianUsd: 0,
      byState: [
        { state: "complete", spendUsd: 0, auditCount: 0 },
        { state: "partial", spendUsd: 0, auditCount: 0 },
        { state: "needs_review", spendUsd: 0, auditCount: 0 },
        { state: "unsupported", spendUsd: 0, auditCount: 0 },
        { state: "failed", spendUsd: 0, auditCount: 0 },
        { state: "in_flight", spendUsd: 0, auditCount: 0 },
      ],
      killSwitches: [
        {
          reason: "COST_CEILING_EXCEEDED",
          label: "Cost ceiling exceeded",
          count: 0,
        },
        {
          reason: "WALL_CLOCK_CEILING_EXCEEDED",
          label: "Wall-clock ceiling exceeded",
          count: 0,
        },
      ],
    });
  });

  it("totals average and median cost and breaks spend out by final state", () => {
    const dashboard = assembleObservabilityDashboard({
      range: "all",
      now: NOW,
      audits: [
        audit("a", "complete", undefined, { costUsd: 0.04 }),
        audit("b", "complete", undefined, { costUsd: 0.06 }),
        audit("c", "failed", undefined, { costUsd: 0.10 }),
        audit("d", "unsupported", undefined, { costUsd: 0.02 }),
        audit("e", "scoring", undefined, { costUsd: 0.01 }),
        audit("f", "needs_review", undefined, { costUsd: null }),
      ],
      transitions: [],
      criteriaByAudit: {},
    });

    expect(dashboard.cost.totalSpendUsd).toBeCloseTo(0.23);
    expect(dashboard.cost.averageUsd).toBeCloseTo(0.23 / 6);
    expect(dashboard.cost.medianUsd).toBeCloseTo(0.03);
    expect(dashboard.cost.byState).toEqual([
      { state: "complete", spendUsd: 0.1, auditCount: 2 },
      { state: "partial", spendUsd: 0, auditCount: 0 },
      { state: "needs_review", spendUsd: 0, auditCount: 1 },
      { state: "unsupported", spendUsd: 0.02, auditCount: 1 },
      { state: "failed", spendUsd: 0.1, auditCount: 1 },
      { state: "in_flight", spendUsd: 0.01, auditCount: 1 },
    ]);
  });

  it("counts kill-switch triggers by persisted reason", () => {
    const dashboard = assembleObservabilityDashboard({
      range: "all",
      now: NOW,
      audits: [
        audit("a", "failed", undefined, {
          costUsd: 1,
          killSwitchReason: "COST_CEILING_EXCEEDED",
        }),
        audit("b", "failed", undefined, {
          costUsd: 1,
          killSwitchReason: "COST_CEILING_EXCEEDED",
        }),
        audit("c", "failed", undefined, {
          costUsd: 0.5,
          killSwitchReason: "WALL_CLOCK_CEILING_EXCEEDED",
        }),
        audit("d", "complete", undefined, { costUsd: 0.2 }),
      ],
      transitions: [],
      criteriaByAudit: {},
    });

    expect(dashboard.cost.killSwitches).toEqual([
      {
        reason: "COST_CEILING_EXCEEDED",
        label: "Cost ceiling exceeded",
        count: 2,
      },
      {
        reason: "WALL_CLOCK_CEILING_EXCEEDED",
        label: "Wall-clock ceiling exceeded",
        count: 1,
      },
    ]);
  });
});
