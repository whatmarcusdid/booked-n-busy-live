import { ANALYTICS_EVENTS } from "../analytics/events";
import type { AuditWorkflowStore } from "./store";

/**
 * Per-audit cost and wall-clock kill switches (PRD "Per-audit cost ceiling").
 *
 * Two independent ceilings, each able to terminate an audit on its own:
 *
 *   - $1.00 cumulative cost across every paid operation the audit performs.
 *   - 15 minutes of wall clock, measured from durable execution start.
 *
 * The time ceiling exists because cost alone cannot catch a stuck audit: a
 * stage that hangs waiting on a provider spends no more money while it burns
 * hours. The cost ceiling exists because time alone cannot catch a cheap-
 * looking loop that quietly runs up spend. Neither subsumes the other, so
 * both are checked before every paid operation.
 */

export const AUDIT_COST_CEILING_USD = 1.0;
export const AUDIT_WALL_CLOCK_CEILING_MS = 15 * 60 * 1000;

export const COST_CEILING_REASON_CODE = "COST_CEILING_EXCEEDED";
export const WALL_CLOCK_CEILING_REASON_CODE = "WALL_CLOCK_CEILING_EXCEEDED";
export const KILL_SWITCH_EVENT = "audit_kill_switch_triggered";
/**
 * Reason a stage returns when a ceiling stopped its paid work mid-stage. The
 * pipeline re-reads the verdict to learn which ceiling it was.
 */
export const COST_KILL_REASON_SENTINEL = "KILL_SWITCH_TRIPPED";
export const AUDIT_COST_RECORDED_EVENT = "audit_cost_recorded";

export const COST_CATEGORIES = [
  "browserless_content",
  "browserless_screenshot",
  "browserless_performance",
  "ai_narration",
  "storage_upload",
  "email_send",
] as const;

export type CostCategory = (typeof COST_CATEGORIES)[number];

export type PricingSource = "provider_metadata" | "configured_estimate";

/**
 * Conservative per-unit estimates in USD, used when a provider does not
 * report what a call actually cost.
 *
 * Deliberately rounded UP. The ceiling exists to stop runaway spend, so an
 * estimate that is a little high fails safe; one that is a little low defeats
 * the purpose. Retries are not a separate category — a retried fetch is
 * simply charged again, which is what makes retry loops visible to the
 * ceiling.
 */
export const CONFIGURED_UNIT_COSTS_USD: Record<CostCategory, number> = {
  browserless_content: 0.01,
  browserless_screenshot: 0.01,
  browserless_performance: 0.05,
  // Overridden by real token usage whenever the AI call reports it.
  ai_narration: 0.02,
  storage_upload: 0.001,
  email_send: 0.001,
};

export interface CostCharge {
  category: CostCategory;
  /**
   * Idempotency key for this charge, unique within the audit. Charging the
   * same key twice is a no-op, so a retriggered or replayed step cannot
   * inflate the total.
   */
  operationKey: string;
  quantity?: number;
  /** Actual cost, when the provider reported it. Overrides the estimate. */
  amountUsd?: number;
}

export interface KillSwitchVerdict {
  tripped: boolean;
  reasonCode?: string;
  spentUsd: number;
  elapsedMs: number;
}

export interface AuditBudget {
  /**
   * Records a paid operation. Idempotent on `operationKey`.
   * Charging does NOT itself abort — callers check `verdict()` before
   * spending, so a charge always corresponds to work already done.
   */
  charge(charge: CostCharge): Promise<void>;
  /** Are we still allowed to spend? Checked before every paid operation. */
  verdict(): Promise<KillSwitchVerdict>;
  /**
   * Cost-only verdict, ignoring the wall clock.
   *
   * For spend recorded after the execution has already finished — a report
   * email sent days later is legitimately outside the 15-minute window, and
   * checking elapsed time there would report a wall-clock kill for an audit
   * that completed normally.
   */
  costVerdict(): Promise<KillSwitchVerdict>;
  spentUsd(): number;
  elapsedMs(): number;
  /**
   * Persists the kill-switch terminal reason. Idempotent: triggering twice
   * records one event, so a retried abort cannot double-process.
   */
  recordKill(reasonCode: string): Promise<void>;
  /** Cost and elapsed time for the observability surfaces. */
  telemetry(): Promise<{ costUsd: number; elapsedMs: number }>;
}

export interface CreateAuditBudgetInput {
  store: AuditWorkflowStore;
  auditId: string;
  /** Durable execution start. Falls back to now when unknown. */
  startedAtMs?: number;
  costCeilingUsd?: number;
  wallClockCeilingMs?: number;
  /** Injectable clock so the time ceiling is testable without waiting. */
  now?: () => number;
}

/**
 * Claude Haiku 4.5 list price, USD per million tokens. The token counts come
 * from the provider's own usage report; only the rate is configured here, so
 * a charge built from these is attributed to `provider_metadata`.
 */
export const AI_NARRATION_RATE_USD_PER_MTOK = { input: 1.0, output: 5.0 };

export interface AiTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export function aiNarrationCostUsd(usage: AiTokenUsage): number {
  const input = (usage.inputTokens ?? 0) / 1_000_000;
  const output = (usage.outputTokens ?? 0) / 1_000_000;
  return (
    input * AI_NARRATION_RATE_USD_PER_MTOK.input +
    output * AI_NARRATION_RATE_USD_PER_MTOK.output
  );
}

export function amountForCharge(charge: CostCharge): {
  amountUsd: number;
  pricingSource: PricingSource;
} {
  if (charge.amountUsd != null) {
    return { amountUsd: charge.amountUsd, pricingSource: "provider_metadata" };
  }
  const quantity = charge.quantity ?? 1;
  return {
    amountUsd: CONFIGURED_UNIT_COSTS_USD[charge.category] * quantity,
    pricingSource: "configured_estimate",
  };
}

export function createAuditBudget(
  input: CreateAuditBudgetInput,
): AuditBudget {
  const now = input.now ?? Date.now;
  const costCeiling = input.costCeilingUsd ?? AUDIT_COST_CEILING_USD;
  const timeCeiling = input.wallClockCeilingMs ?? AUDIT_WALL_CLOCK_CEILING_MS;
  const startedAtMs = input.startedAtMs ?? now();

  let spent = 0;
  let loaded = false;
  let killRecorded = false;

  async function load(): Promise<void> {
    if (loaded) return;
    // Pick up spend from earlier steps of the same durable execution. A
    // workflow step can be replayed on a different instance, so in-process
    // accumulation alone would under-count.
    spent = await input.store.getAuditCostTotal(input.auditId);
    loaded = true;
  }

  const elapsedMs = () => Math.max(0, now() - startedAtMs);

  return {
    async charge(charge) {
      await load();
      const { amountUsd, pricingSource } = amountForCharge(charge);
      const total = await input.store.chargeAuditCost(input.auditId, {
        operation_key: charge.operationKey,
        category: charge.category,
        quantity: charge.quantity ?? 1,
        amount_usd: amountUsd,
        pricing_source: pricingSource,
      });
      spent = total;
    },

    async verdict() {
      await load();
      const elapsed = elapsedMs();

      // Time is checked first: an audit past 15 minutes must stop even if it
      // has spent nothing at all.
      if (elapsed >= timeCeiling) {
        return {
          tripped: true,
          reasonCode: WALL_CLOCK_CEILING_REASON_CODE,
          spentUsd: spent,
          elapsedMs: elapsed,
        };
      }
      if (spent >= costCeiling) {
        return {
          tripped: true,
          reasonCode: COST_CEILING_REASON_CODE,
          spentUsd: spent,
          elapsedMs: elapsed,
        };
      }
      return { tripped: false, spentUsd: spent, elapsedMs: elapsed };
    },

    async costVerdict() {
      await load();
      return {
        tripped: spent >= costCeiling,
        ...(spent >= costCeiling
          ? { reasonCode: COST_CEILING_REASON_CODE }
          : {}),
        spentUsd: spent,
        elapsedMs: elapsedMs(),
      };
    },

    spentUsd: () => spent,
    elapsedMs,

    async recordKill(reasonCode) {
      if (killRecorded) return;
      killRecorded = true;
      await load();
      const elapsed = elapsedMs();
      await input.store.recordEvent(input.auditId, KILL_SWITCH_EVENT, {
        reason_code: reasonCode,
        failure_type: "KILL_SWITCH",
        cost_usd: Number(spent.toFixed(6)),
        cost_ceiling_usd: costCeiling,
        elapsed_ms: elapsed,
        wall_clock_ceiling_ms: timeCeiling,
        started_at: new Date(startedAtMs).toISOString(),
      });
      await input.store.recordAuditTelemetry(input.auditId, {
        cost_usd: Number(spent.toFixed(6)),
        elapsed_ms: elapsed,
        kill_switch_reason: reasonCode,
      });
      // Recorded server-side because a killed audit's live session may
      // already be gone; the analytics event has to come from the pipeline,
      // not the browser.
      await input.store.recordEvent(
        input.auditId,
        ANALYTICS_EVENTS.auditTerminatedByKillSwitch,
        { reason_code: reasonCode, elapsed_ms: elapsed },
      );
    },

    async telemetry() {
      await load();
      return {
        costUsd: Number(spent.toFixed(6)),
        elapsedMs: elapsedMs(),
      };
    },
  };
}
