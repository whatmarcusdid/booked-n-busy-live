import { describeDatabaseError } from "../supabase/errors";
import type { AuditWorkflowStore } from "./store";
import { isAuditWorkflowState } from "./types";

/**
 * Best-effort terminal Failed. The start-failure path and a mid-stage store
 * error both use this: record the reason, then transition from whatever
 * `current_state` is now, so the audit is never left in a processing state.
 *
 * If the database is what failed, marking is expected to fail too. The caller
 * still owns the original error; this function never throws.
 */
export async function failAuditFromCurrentState(
  store: AuditWorkflowStore,
  auditId: string,
  cause: unknown,
  input: {
    eventType: string;
    reasonCode: string;
    markFailedLogContext: string;
  },
): Promise<void> {
  try {
    await store.recordEvent(auditId, input.eventType, {
      reason_code: input.reasonCode,
      failure_type: input.reasonCode,
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
      `Could not mark audit ${auditId} failed after ${input.markFailedLogContext}:`,
      describeDatabaseError(markError),
    );
  }
}
