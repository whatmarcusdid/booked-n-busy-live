import { createHook, sleep } from "workflow";
import { applyStage } from "@/lib/audit-workflow/pipeline";
import { resolveMockTerminalState } from "@/lib/audit-workflow/outcome";
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

  const outcome = resolveMockTerminalState(websiteUrl);

  for (let i = 1; i < STAGE_SEQUENCE.length; i += 1) {
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
      return { auditId, terminalState: stage.abortTo };
    }
  }

  await sleep(STAGE_DELAY);
  await runStageStep(
    auditId,
    websiteUrl,
    "validating_report",
    outcome,
    outcome,
  );

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

  return applyStage({
    store: createSupabaseAuditStore(),
    auditId,
    websiteUrl,
    fromState,
    toState,
    outcome,
  });
}
