/**
 * Compatibility wrapper around the durable mock pipeline.
 * POST /api/v1/audits is the real trigger. Prefer startAuditWorkflow().
 */

import { runAuditPipeline } from "../audit-workflow/pipeline";

export async function processMockAudit(auditId: string): Promise<void> {
  const { createSupabaseAuditStore } = await import("../audit-workflow/store");
  const store = createSupabaseAuditStore();
  const audit = await store.getAudit(auditId);
  if (!audit) {
    throw new Error(`Audit not found: ${auditId}`);
  }

  await runAuditPipeline({
    auditId,
    websiteUrl: audit.website_url,
    delayMs: 0,
  });
}
