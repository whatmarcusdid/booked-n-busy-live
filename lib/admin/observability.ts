/**
 * M8 observability (PRD 18.16): state distribution, completion times,
 * needs-review rate, and cost / kill-switch totals. Provider-error rates
 * remain out of scope — those events are not stored with a provider key.
 *
 * Read-only. No inserts, updates, or new tables.
 *
 * `admin_reviews` is not a source here: it records the human decision
 * (approve / hold / override), not which priority-review trigger flagged
 * the audit. Flag causes come from decision #12's existing evaluator.
 *
 * Cost uses the denormalized `audits.cost_usd` / `kill_switch_reason`
 * columns written at terminal (and on kill), not a per-row ledger aggregate.
 */
import {
  AUDIT_WALL_CLOCK_CEILING_MS,
  COST_CEILING_REASON_CODE,
  WALL_CLOCK_CEILING_REASON_CODE,
} from "../audit-workflow/budget";
import { WORKFLOW_TERMINAL_STATES } from "../audit-workflow/types";
import { SLOW_AUDIT_THRESHOLD_MS } from "../copy/timing";
import { createAdminClient } from "../supabase/admin";
import {
  evaluateAutoPublicationEligibility,
  type IneligibilityReason,
} from "../reports/auto-publication";
import {
  PRIORITY_REASON_LABELS,
  PRIORITY_REASONS,
  criteriaFromRows,
} from "./review-queue";
import type { CriterionInput } from "../audit-workflow/store";

export const DASHBOARD_RANGES = ["today", "7d", "30d", "all"] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export const DASHBOARD_RANGE_LABELS: Record<DashboardRange, string> = {
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
  all: "All time",
};

export const DISTRIBUTION_STATES = [
  "complete",
  "partial",
  "needs_review",
  "unsupported",
  "failed",
] as const;

export type DistributionState = (typeof DISTRIBUTION_STATES)[number];

export const COMPLETION_BUCKETS = [
  "before_90s",
  "after_fallback",
  "kill_switch_15m",
] as const;

export type CompletionBucket = (typeof COMPLETION_BUCKETS)[number];

export const COMPLETION_BUCKET_LABELS: Record<CompletionBucket, string> = {
  before_90s: "Completed before 90 seconds",
  after_fallback: "Fallback shown, then completed",
  kill_switch_15m: "Terminated by the 15-minute kill switch",
};

export const KILL_SWITCH_REASONS = [
  COST_CEILING_REASON_CODE,
  WALL_CLOCK_CEILING_REASON_CODE,
] as const;

export type KillSwitchReason = (typeof KILL_SWITCH_REASONS)[number];

export const KILL_SWITCH_REASON_LABELS: Record<KillSwitchReason, string> = {
  COST_CEILING_EXCEEDED: "Cost ceiling exceeded",
  WALL_CLOCK_CEILING_EXCEEDED: "Wall-clock ceiling exceeded",
};

const TERMINAL = new Set<string>(WORKFLOW_TERMINAL_STATES);
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SCAN_LIMIT = 5000;
const ID_CHUNK = 200;
const IN_FLIGHT_STATE = "in_flight";

function numericCost(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return value;
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function assembleCostKillSwitchPanel(
  audits: ObservabilityAudit[],
): CostKillSwitchPanel {
  const costs = audits.map((audit) => numericCost(audit.costUsd));
  const totalSpendUsd = costs.reduce((sum, value) => sum + value, 0);
  const total = audits.length;

  const spendByState = Object.fromEntries(
    DISTRIBUTION_STATES.map((state) => [state, { spendUsd: 0, auditCount: 0 }]),
  ) as Record<DistributionState, { spendUsd: number; auditCount: number }>;
  let inFlightSpend = 0;
  let inFlightCount = 0;

  for (const audit of audits) {
    const spend = numericCost(audit.costUsd);
    if ((DISTRIBUTION_STATES as readonly string[]).includes(audit.currentState)) {
      const bucket = spendByState[audit.currentState as DistributionState];
      bucket.spendUsd += spend;
      bucket.auditCount += 1;
    } else {
      inFlightSpend += spend;
      inFlightCount += 1;
    }
  }

  const killCounts = new Map<string, number>();
  for (const reason of KILL_SWITCH_REASONS) {
    killCounts.set(reason, 0);
  }
  for (const audit of audits) {
    const reason = audit.killSwitchReason?.trim();
    if (!reason) continue;
    killCounts.set(reason, (killCounts.get(reason) ?? 0) + 1);
  }

  const knownReasons = new Set<string>(KILL_SWITCH_REASONS);
  const extraReasons = [...killCounts.keys()]
    .filter((reason) => !knownReasons.has(reason))
    .sort((a, b) => a.localeCompare(b));

  return {
    totalSpendUsd,
    averageUsd: total === 0 ? 0 : totalSpendUsd / total,
    medianUsd: medianOf(costs),
    byState: [
      ...DISTRIBUTION_STATES.map((state) => ({
        state,
        spendUsd: spendByState[state].spendUsd,
        auditCount: spendByState[state].auditCount,
      })),
      {
        state: IN_FLIGHT_STATE,
        spendUsd: inFlightSpend,
        auditCount: inFlightCount,
      },
    ],
    killSwitches: [
      ...KILL_SWITCH_REASONS.map((reason) => ({
        reason,
        label: KILL_SWITCH_REASON_LABELS[reason],
        count: killCounts.get(reason) ?? 0,
      })),
      ...extraReasons.map((reason) => ({
        reason,
        label: reason,
        count: killCounts.get(reason) ?? 0,
      })),
    ],
  };
}

export function parseDashboardRange(
  raw: string | null | undefined,
): DashboardRange {
  if (raw && (DASHBOARD_RANGES as readonly string[]).includes(raw)) {
    return raw as DashboardRange;
  }
  return "7d";
}

export function rangeStart(range: DashboardRange, now: Date): Date | null {
  if (range === "all") return null;
  if (range === "today") {
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
  }
  const days = range === "7d" ? 7 : 30;
  return new Date(now.getTime() - days * MS_PER_DAY);
}

export function classifyCompletion(durationMs: number): CompletionBucket {
  if (durationMs >= AUDIT_WALL_CLOCK_CEILING_MS) return "kill_switch_15m";
  if (durationMs >= SLOW_AUDIT_THRESHOLD_MS) return "after_fallback";
  return "before_90s";
}

export function durationFromTransitions(
  transitions: Array<{ toState: string; transitionedAt: string }>,
  createdAt: string,
): number | null {
  const submitted = transitions.find((row) => row.toState === "submitted");
  const startMs = Date.parse(submitted?.transitionedAt ?? createdAt);
  const terminals = transitions
    .filter((row) => TERMINAL.has(row.toState))
    .map((row) => Date.parse(row.transitionedAt))
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b);
  if (!Number.isFinite(startMs) || terminals.length === 0) return null;
  return Math.max(0, terminals[0] - startMs);
}

export interface StateDistributionRow {
  state: DistributionState;
  count: number;
}

export interface CompletionBucketRow {
  bucket: CompletionBucket;
  label: string;
  count: number;
  percent: number;
}

export interface PriorityTriggerRow {
  reason: IneligibilityReason;
  label: string;
  count: number;
}

export interface CostByStateRow {
  state: string;
  spendUsd: number;
  auditCount: number;
}

export interface KillSwitchReasonRow {
  reason: string;
  label: string;
  count: number;
}

export interface CostKillSwitchPanel {
  totalSpendUsd: number;
  averageUsd: number;
  medianUsd: number;
  byState: CostByStateRow[];
  killSwitches: KillSwitchReasonRow[];
}

export interface ObservabilityDashboard {
  range: DashboardRange;
  rangeStartedAt: string | null;
  totalSubmitted: number;
  stateDistribution: StateDistributionRow[];
  completion: {
    classified: number;
    buckets: CompletionBucketRow[];
  };
  needsReview: {
    count: number;
    rate: number;
    triggers: PriorityTriggerRow[];
  };
  cost: CostKillSwitchPanel;
}

export interface ObservabilityAudit {
  id: string;
  currentState: string;
  createdAt: string;
  costUsd?: number | null;
  killSwitchReason?: string | null;
}

export interface ObservabilityTransition {
  auditId: string;
  toState: string;
  transitionedAt: string;
}

export function assembleObservabilityDashboard(input: {
  audits: ObservabilityAudit[];
  transitions: ObservabilityTransition[];
  criteriaByAudit: Record<string, CriterionInput[]>;
  range: DashboardRange;
  now?: Date;
}): ObservabilityDashboard {
  const now = input.now ?? new Date();
  const start = rangeStart(input.range, now);

  const counts = Object.fromEntries(
    DISTRIBUTION_STATES.map((state) => [state, 0]),
  ) as Record<DistributionState, number>;
  for (const audit of input.audits) {
    if ((DISTRIBUTION_STATES as readonly string[]).includes(audit.currentState)) {
      counts[audit.currentState as DistributionState] += 1;
    }
  }

  const byAudit = new Map<string, ObservabilityTransition[]>();
  for (const row of input.transitions) {
    const held = byAudit.get(row.auditId) ?? [];
    held.push(row);
    byAudit.set(row.auditId, held);
  }

  const bucketCounts: Record<CompletionBucket, number> = {
    before_90s: 0,
    after_fallback: 0,
    kill_switch_15m: 0,
  };
  let classified = 0;
  for (const audit of input.audits) {
    if (!TERMINAL.has(audit.currentState)) continue;
    const duration = durationFromTransitions(
      byAudit.get(audit.id) ?? [],
      audit.createdAt,
    );
    if (duration == null) continue;
    classified += 1;
    bucketCounts[classifyCompletion(duration)] += 1;
  }

  const needsReviewAudits = input.audits.filter(
    (audit) => audit.currentState === "needs_review",
  );
  const triggerCounts = Object.fromEntries(
    PRIORITY_REASONS.map((reason) => [reason, 0]),
  ) as Record<(typeof PRIORITY_REASONS)[number], number>;

  for (const audit of needsReviewAudits) {
    const eligibility = evaluateAutoPublicationEligibility({
      criteria: input.criteriaByAudit[audit.id] ?? [],
      auditState: audit.currentState,
    });
    for (const reason of PRIORITY_REASONS) {
      if (eligibility.reasons.includes(reason)) {
        triggerCounts[reason] += 1;
      }
    }
  }

  const total = input.audits.length;
  const needsReviewCount = needsReviewAudits.length;

  return {
    range: input.range,
    rangeStartedAt: start ? start.toISOString() : null,
    totalSubmitted: total,
    stateDistribution: DISTRIBUTION_STATES.map((state) => ({
      state,
      count: counts[state],
    })),
    completion: {
      classified,
      buckets: COMPLETION_BUCKETS.map((bucket) => ({
        bucket,
        label: COMPLETION_BUCKET_LABELS[bucket],
        count: bucketCounts[bucket],
        percent: classified === 0 ? 0 : bucketCounts[bucket] / classified,
      })),
    },
    needsReview: {
      count: needsReviewCount,
      rate: total === 0 ? 0 : needsReviewCount / total,
      triggers: [...PRIORITY_REASONS]
        .sort((a, b) => triggerCounts[b] - triggerCounts[a] || a.localeCompare(b))
        .map((reason) => ({
          reason,
          label: PRIORITY_REASON_LABELS[reason],
          count: triggerCounts[reason],
        })),
    },
    cost: assembleCostKillSwitchPanel(input.audits),
  };
}

export function formatDashboardPercent(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return "0%";
  const pct = rate * 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
}

export function formatDashboardUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) return "$0.0000";
  return `$${amount.toFixed(4)}`;
}

export async function loadObservabilityDashboard(
  range: DashboardRange,
  now: Date = new Date(),
): Promise<ObservabilityDashboard> {
  const supabase = createAdminClient();
  const start = rangeStart(range, now);

  let query = supabase
    .from("audits")
    .select("id, current_state, created_at, cost_usd, kill_switch_reason")
    .order("created_at", { ascending: false })
    .limit(SCAN_LIMIT);
  if (start) {
    query = query.gte("created_at", start.toISOString());
  }

  const { data: auditRows, error } = await query;
  if (error) {
    throw new Error(`Failed to load audits for dashboard: ${error.message}`);
  }

  const audits: ObservabilityAudit[] = (auditRows ?? []).map((row) => ({
    id: String(row.id),
    currentState: String(row.current_state),
    createdAt: String(row.created_at),
    costUsd: row.cost_usd == null ? null : Number(row.cost_usd),
    killSwitchReason:
      row.kill_switch_reason == null || row.kill_switch_reason === ""
        ? null
        : String(row.kill_switch_reason),
  }));

  const ids = audits.map((audit) => audit.id);
  const transitions: ObservabilityTransition[] = [];
  const criteriaByAudit: Record<string, CriterionInput[]> = {};

  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const [{ data: transitionRows }, { data: criterionRows }] =
      await Promise.all([
        supabase
          .from("audit_state_transitions")
          .select("audit_id, to_state, transitioned_at")
          .in("audit_id", chunk),
        supabase
          .from("criterion_results")
          .select(
            "audit_id, criterion_key, criterion_name, pillar, score, weight, findings",
          )
          .in("audit_id", chunk),
      ]);

    for (const row of transitionRows ?? []) {
      transitions.push({
        auditId: String(row.audit_id),
        toState: String(row.to_state),
        transitionedAt: String(row.transitioned_at),
      });
    }

    const grouped = new Map<string, unknown[]>();
    for (const row of criterionRows ?? []) {
      const key = String((row as { audit_id: string }).audit_id);
      const held = grouped.get(key) ?? [];
      held.push(row);
      grouped.set(key, held);
    }
    for (const [auditId, rows] of grouped) {
      criteriaByAudit[auditId] = criteriaFromRows(rows);
    }
  }

  return assembleObservabilityDashboard({
    audits,
    transitions,
    criteriaByAudit,
    range,
    now,
  });
}
