import type {
  CaptureScreenshot,
  FetchPagePerformance,
  FetchRenderedPage,
} from "../browserless";
import type { FetchRobotsTxt } from "../crawler/robots";
import { applyMockStageWork } from "./mock-stages";
import { PROVISIONAL_TERMINAL_STATE } from "./outcome";
import {
  COST_KILL_REASON_SENTINEL,
  createAuditBudget,
  type AuditBudget,
} from "./budget";
import type { ArtifactStorage } from "../storage/audit-artifacts";
import type { UrlSafetyDeps } from "../url-safety";
import type { ProbeHttpsHop } from "./https-probe";
import { failAuditFromCurrentState } from "./fail-audit";
import {
  createSupabaseAuditStore,
  type AuditWorkflowStore,
} from "./store";
import {
  STAGE_SEQUENCE,
  WORKFLOW_STAGE_FAILED_EVENT,
  WORKFLOW_STAGE_FAILED_REASON,
  type AuditWorkflowState,
  type WorkflowTerminalState,
} from "./types";

export interface RunAuditPipelineInput {
  auditId: string;
  websiteUrl: string;
  store?: AuditWorkflowStore;
  delayMs?: number;
  outcome?: WorkflowTerminalState;
  safetyDeps?: UrlSafetyDeps;
  realScanEnabled?: boolean;
  fetchHomePage?: FetchRenderedPage;
  fetchRobots?: FetchRobotsTxt;
  probeHttpsHop?: ProbeHttpsHop;
  captureScreenshot?: CaptureScreenshot;
  fetchPerformance?: FetchPagePerformance;
  artifactStorage?: ArtifactStorage;
  /** Cost/wall-clock kill switches. Built from the store when omitted. */
  budget?: AuditBudget;
}

export interface ApplyStageResult {
  transition: "inserted" | "exists";
  abortTo?: WorkflowTerminalState;
  reasonCode?: string;
  resolveTo?: WorkflowTerminalState;
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function applyStage(input: {
  store: AuditWorkflowStore;
  auditId: string;
  websiteUrl: string;
  fromState: AuditWorkflowState;
  toState: AuditWorkflowState;
  outcome: WorkflowTerminalState;
  safetyDeps?: UrlSafetyDeps;
  realScanEnabled?: boolean;
  fetchHomePage?: FetchRenderedPage;
  fetchRobots?: FetchRobotsTxt;
  probeHttpsHop?: ProbeHttpsHop;
  captureScreenshot?: CaptureScreenshot;
  fetchPerformance?: FetchPagePerformance;
  artifactStorage?: ArtifactStorage;
  budget?: AuditBudget;
}): Promise<ApplyStageResult> {
  try {
    const result = await input.store.recordTransition(
      input.auditId,
      input.fromState,
      input.toState,
    );

    const work = await applyMockStageWork({
      store: input.store,
      auditId: input.auditId,
      websiteUrl: input.websiteUrl,
      toState: input.toState,
      outcome: input.outcome,
      safetyDeps: input.safetyDeps,
      realScanEnabled: input.realScanEnabled,
      fetchHomePage: input.fetchHomePage,
      fetchRobots: input.fetchRobots,
      probeHttpsHop: input.probeHttpsHop,
      captureScreenshot: input.captureScreenshot,
      fetchPerformance: input.fetchPerformance,
      artifactStorage: input.artifactStorage,
      budget: input.budget,
    });

    return {
      transition: result,
      abortTo: work.abortTo,
      reasonCode: work.reasonCode,
      resolveTo: work.resolveTo,
    };
  } catch (error) {
    // Do not rethrow: the durable `"use step"` wrapper would retry, and a
    // mid-stage store error must fail cleanly the same way start-failure does.
    await failAuditFromCurrentState(input.store, input.auditId, error, {
      eventType: WORKFLOW_STAGE_FAILED_EVENT,
      reasonCode: WORKFLOW_STAGE_FAILED_REASON,
      markFailedLogContext: "workflow stage failed",
    });
    return {
      transition: "exists",
      abortTo: "failed",
      reasonCode: WORKFLOW_STAGE_FAILED_REASON,
    };
  }
}

/**
 * Builds the kill-switch budget for an execution, anchoring the wall clock to
 * durable execution start rather than to this call. A replayed or resumed
 * step therefore inherits the original 15-minute deadline instead of getting
 * a fresh one, which is what keeps the ceiling from being reset by retries.
 */
export async function resolveAuditBudget(
  store: AuditWorkflowStore,
  auditId: string,
  provided?: AuditBudget,
): Promise<AuditBudget> {
  if (provided) return provided;
  const startedAtMs = await store.getWorkflowStartedAtMs(auditId);
  return createAuditBudget({
    store,
    auditId,
    startedAtMs: startedAtMs ?? Date.now(),
  });
}

/**
 * Durable-friendly mock pipeline. The Vercel Workflow wrapper calls this
 * one stage at a time from `"use step"` functions. Tests call it directly.
 */
export async function runAuditPipeline(
  input: RunAuditPipelineInput,
): Promise<WorkflowTerminalState> {
  const store = input.store ?? createSupabaseAuditStore();
  const audit = await store.getAudit(input.auditId);
  if (!audit) {
    throw new Error(`Audit not found: ${input.auditId}`);
  }

  try {
    return await runAuditPipelineStages(input, store);
  } catch (error) {
    await failAuditFromCurrentState(store, input.auditId, error, {
      eventType: WORKFLOW_STAGE_FAILED_EVENT,
      reasonCode: WORKFLOW_STAGE_FAILED_REASON,
      markFailedLogContext: "workflow stage failed",
    });
    return "failed";
  }
}

async function runAuditPipelineStages(
  input: RunAuditPipelineInput,
  store: AuditWorkflowStore,
): Promise<WorkflowTerminalState> {
  const budget = await resolveAuditBudget(store, input.auditId, input.budget);

  // Provisional until report finalization resolves the real terminal state
  // from page coverage and check outcomes. `input.outcome` lets a caller
  // force a non-reporting state (`failed` / `unsupported`) for tests; a
  // reporting state is still subject to the coverage rule.
  let outcome = input.outcome ?? PROVISIONAL_TERMINAL_STATE;
  const delayMs = input.delayMs ?? 0;

  const stageDeps = {
    store,
    auditId: input.auditId,
    websiteUrl: input.websiteUrl,
    safetyDeps: input.safetyDeps,
    realScanEnabled: input.realScanEnabled,
    fetchHomePage: input.fetchHomePage,
    fetchRobots: input.fetchRobots,
    probeHttpsHop: input.probeHttpsHop,
    captureScreenshot: input.captureScreenshot,
    fetchPerformance: input.fetchPerformance,
    artifactStorage: input.artifactStorage,
    budget,
  };

  /**
   * Terminates the audit at a ceiling. Runs no stage work: the point of a
   * kill switch is to stop doing things, so this only records the reason and
   * the terminal transition. `recordTransition` dedupes on (audit, state) and
   * `recordKill` is a no-op after the first call, so a retriggered kill
   * cannot double-process.
   */
  async function killAt(
    fromState: AuditWorkflowState,
    reasonCode: string,
  ): Promise<WorkflowTerminalState> {
    await budget.recordKill(reasonCode);
    await store.recordTransition(input.auditId, fromState, "failed");
    return "failed";
  }

  for (let i = 1; i < STAGE_SEQUENCE.length; i += 1) {
    const fromState = STAGE_SEQUENCE[i - 1];
    const toState = STAGE_SEQUENCE[i];

    // Checked at every stage boundary as well as before each paid call, so a
    // stage that hangs or loops without spending is still caught.
    const preStage = await budget.verdict();
    if (preStage.tripped) {
      return await killAt(fromState, preStage.reasonCode!);
    }

    await delay(delayMs);
    const stage = await applyStage({
      ...stageDeps,
      fromState,
      toState,
      outcome,
    });

    if (stage.abortTo) {
      await delay(delayMs);
      await applyStage({
        ...stageDeps,
        fromState: toState,
        toState: stage.abortTo,
        outcome: stage.abortTo,
      });
      await recordFinalTelemetry(store, input.auditId, budget);
      return stage.abortTo;
    }

    if (stage.reasonCode === COST_KILL_REASON_SENTINEL) {
      // A paid operation inside the stage hit a ceiling.
      const verdict = await budget.verdict();
      return await killAt(toState, verdict.reasonCode ?? "KILL_SWITCH");
    }

    if (stage.resolveTo) {
      outcome = stage.resolveTo;
    }
  }

  const preFinal = await budget.verdict();
  if (preFinal.tripped) {
    return await killAt("validating_report", preFinal.reasonCode!);
  }

  await delay(delayMs);
  await applyStage({
    ...stageDeps,
    fromState: "validating_report",
    toState: outcome,
    outcome,
  });

  await recordFinalTelemetry(store, input.auditId, budget);
  return outcome;
}

async function recordFinalTelemetry(
  store: AuditWorkflowStore,
  auditId: string,
  budget: AuditBudget,
): Promise<void> {
  const { costUsd, elapsedMs } = await budget.telemetry();
  await store.recordAuditTelemetry(auditId, {
    cost_usd: costUsd,
    elapsed_ms: elapsedMs,
  });
}
