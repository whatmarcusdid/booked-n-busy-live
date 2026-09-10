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
): ObservabilityAudit {
  return { id, currentState: state, createdAt };
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
  });
});
