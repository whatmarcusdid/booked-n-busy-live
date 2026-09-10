import { createHook, sleep } from "workflow";
import { applyStage, resolveAuditBudget } from "@/lib/audit-workflow/pipeline";
import { COST_KILL_REASON_SENTINEL } from "@/lib/audit-workflow/budget";
import { PROVISIONAL_TERMINAL_STATE } from "@/lib/audit-workflow/outcome";
import { createSupabaseAuditStore } from "@/lib/audit-workflow/store";
import {
  STAGE_SEQUENCE,
  type AuditWorkflowState,
  type WorkflowTerminalState,
} from "@/lib/audit-workflow/types";

const STAGE_DELAY = "800ms";

export async function runAuditWorkflow(auditId: string, websiteUrl: string) {
  "use workflow";

  const hook = createHook({ token: `audit-workflow:${auditId}` });
  const conflict = await hook.getConflict();
  if (conflict) {
    return { skipped: true, ownerRunId: conflict.runId };
  }

  // Provisional; report finalization resolves the real terminal state from
  // page coverage and check outcomes.
  let outcome: WorkflowTerminalState = PROVISIONAL_TERMINAL_STATE;

  for (let i = 1; i < STAGE_SEQUENCE.length; i += 1) {
    // Checked at every stage boundary so a stage that hangs without spending
    // is still terminated. The budget is rebuilt from durable state on each
    // step, so its deadline survives replays instead of restarting.
    const ceiling = await checkCeilingsStep(auditId);
    if (ceiling.tripped) {
      await killAtCeilingStep(auditId, STAGE_SEQUENCE[i - 1]);
      return { auditId, terminalState: "failed" as const };
    }

    await sleep(STAGE_DELAY);
    const stage = await runStageStep(
      auditId,
      websiteUrl,
      STAGE_SEQUENCE[i - 1],
      STAGE_SEQUENCE[i],
      outcome,
    );

    if (stage.abortTo) {
      await sleep(STAGE_DELAY);
      await runStageStep(
        auditId,
        websiteUrl,
        STAGE_SEQUENCE[i],
        stage.abortTo,
        stage.abortTo,
      );
      await recordTelemetryStep(auditId);
      return { auditId, terminalState: stage.abortTo };
    }

    if (stage.reasonCode === COST_KILL_REASON_SENTINEL) {
      await killAtCeilingStep(auditId, STAGE_SEQUENCE[i]);
      return { auditId, terminalState: "failed" as const };
    }

    if (stage.resolveTo) {
      outcome = stage.resolveTo;
    }
  }

  const finalCeiling = await checkCeilingsStep(auditId);
  if (finalCeiling.tripped) {
    await killAtCeilingStep(auditId, "validating_report");
    return { auditId, terminalState: "failed" as const };
  }

  await sleep(STAGE_DELAY);
  await runStageStep(
    auditId,
    websiteUrl,
    "validating_report",
    outcome,
    outcome,
  );

  await recordTelemetryStep(auditId);
  return { auditId, terminalState: outcome };
}

async function runStageStep(
  auditId: string,
  websiteUrl: string,
  fromState: AuditWorkflowState,
  toState: AuditWorkflowState,
  outcome: WorkflowTerminalState,
) {
  "use step";

  const store = createSupabaseAuditStore();
  return applyStage({
    store,
    auditId,
    websiteUrl,
    fromState,
    toState,
    outcome,
    budget: await resolveAuditBudget(store, auditId),
  });
}

async function checkCeilingsStep(auditId: string) {
  "use step";

  const store = createSupabaseAuditStore();
  const budget = await resolveAuditBudget(store, auditId);
  const verdict = await budget.verdict();
  return { tripped: verdict.tripped, reasonCode: verdict.reasonCode ?? null };
}

/**
 * Terminates the audit at a ceiling. Performs no audit work — the point of a
 * kill switch is to stop doing things. Safe to re-run: the kill event is
 * written once and `recordTransition` dedupes on (audit, state).
 */
async function killAtCeilingStep(
  auditId: string,
  fromState: AuditWorkflowState,
) {
  "use step";

  const store = createSupabaseAuditStore();
  const budget = await resolveAuditBudget(store, auditId);
  const verdict = await budget.verdict();
  await budget.recordKill(verdict.reasonCode ?? "KILL_SWITCH");
  await store.recordTransition(auditId, fromState, "failed");
}

async function recordTelemetryStep(auditId: string) {
  "use step";

  const store = createSupabaseAuditStore();
  const budget = await resolveAuditBudget(store, auditId);
  const { costUsd, elapsedMs } = await budget.telemetry();
  await store.recordAuditTelemetry(auditId, {
    cost_usd: costUsd,
    elapsed_ms: elapsedMs,
  });
}
