import { runAuditPipeline } from "./pipeline";
import { createSupabaseAuditStore } from "./store";
import type { AuditWorkflowStore } from "./store";
import {
  isAuditWorkflowState,
  WORKFLOW_START_FAILED_EVENT,
  WORKFLOW_START_FAILED_REASON,
} from "./types";
import { describeDatabaseError } from "../supabase/errors";

export type StartAuditWorkflowResult =
  | { started: true; mode: "workflow" | "inline" }
  | { started: false; reason: "already_active" };

/**
 * Claim one active execution per audit, then enqueue the durable workflow.
 * Jest runs the pipeline inline so durability tests do not need the WDK transform.
 */
export async function startAuditWorkflow(input: {
  auditId: string;
  websiteUrl: string;
}): Promise<StartAuditWorkflowResult> {
  const store = createSupabaseAuditStore();
  const claimed = await store.claimWorkflow(input.auditId);
  if (!claimed) {
    return { started: false, reason: "already_active" };
  }

  try {
    if (process.env.JEST_WORKER_ID) {
      await runAuditPipeline({
        auditId: input.auditId,
        websiteUrl: input.websiteUrl,
        delayMs: 0,
      });
      return { started: true, mode: "inline" };
    }

    const { start } = await import("workflow/api");
    const { runAuditWorkflow } = await import(
      "@/app/workflows/run-audit-workflow"
    );
    await start(runAuditWorkflow, [input.auditId, input.websiteUrl]);
    return { started: true, mode: "workflow" };
  } catch (error) {
    await store.releaseWorkflowClaim(input.auditId);
    await failAuditAtStart(store, input.auditId, error);
    throw error;
  }
}

/**
 * Terminate an audit whose durable execution could never be enqueued.
 *
 * Without this the audit sits in `submitted` forever: the customer is told the
 * scan is running, no stage ever executes, and nothing re-drives it. Failed is
 * the state that already exists for "this audit will not produce a report",
 * and it is the one with a customer-facing manual retry.
 *
 * Best effort by design. If the database is what failed, marking the audit is
 * expected to fail too, and the original error must still reach the caller
 * rather than being replaced by a bookkeeping error.
 */
async function failAuditAtStart(
  store: AuditWorkflowStore,
  auditId: string,
  cause: unknown,
): Promise<void> {
  try {
    await store.recordEvent(auditId, WORKFLOW_START_FAILED_EVENT, {
      reason_code: WORKFLOW_START_FAILED_REASON,
      failure_type: WORKFLOW_START_FAILED_REASON,
      error: describeDatabaseError(cause),
    });

    const audit = await store.getAudit(auditId);
    const fromState =
      audit && isAuditWorkflowState(audit.current_state)
        ? audit.current_state
        : "submitted";

    await store.recordTransition(auditId, fromState, "failed");
  } catch (markError) {
    console.error(
      `Could not mark audit ${auditId} failed after workflow start failed:`,
      describeDatabaseError(markError),
    );
  }
}
