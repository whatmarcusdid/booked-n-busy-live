import { runAuditPipeline } from "./pipeline";
import { createSupabaseAuditStore } from "./store";

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

  if (process.env.JEST_WORKER_ID) {
    await runAuditPipeline({
      auditId: input.auditId,
      websiteUrl: input.websiteUrl,
      delayMs: 0,
    });
    return { started: true, mode: "inline" };
  }

  try {
    const { start } = await import("workflow/api");
    const { runAuditWorkflow } = await import(
      "@/app/workflows/run-audit-workflow"
    );
    await start(runAuditWorkflow, [input.auditId, input.websiteUrl]);
    return { started: true, mode: "workflow" };
  } catch (error) {
    await store.releaseWorkflowClaim(input.auditId);
    throw error;
  }
}
