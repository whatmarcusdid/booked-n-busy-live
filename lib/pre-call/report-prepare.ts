import { readReportAccess } from "@/lib/reports/access-cookie";
import {
  resolveReportAccessByHash,
  type ReportAccess,
} from "@/lib/reports/access";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  loadAuditResultsByAuditId,
  type LoadAuditResultsByIdResult,
} from "@/lib/services/audit-results-service";

/**
 * Cookie-authenticated Prepare loader. Resolves the audit from the
 * report-access cookie hash — never a status token.
 */

export interface ReportPrepareDeps {
  resolveAccess?: (tokenHash: string) => Promise<ReportAccess>;
  findAuditId?: (tokenHash: string) => Promise<string | null>;
  loadByAuditId?: typeof loadAuditResultsByAuditId;
}

export async function findAuditIdByReportTokenHash(
  tokenHash: string,
): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("report_revisions")
    .select("audit_id")
    .eq("public_report_token_hash", tokenHash)
    .maybeSingle<{ audit_id: string }>();
  return data?.audit_id ?? null;
}

export async function loadPrepareFromReportCookie(
  cookieValue: string | undefined,
  deps: ReportPrepareDeps = {},
): Promise<LoadAuditResultsByIdResult> {
  const claim = readReportAccess(cookieValue);
  if (!claim) return { ok: false, code: "NOT_FOUND" };

  const resolveAccess = deps.resolveAccess ?? resolveReportAccessByHash;
  const access = await resolveAccess(claim.tokenHash);
  if (access.outcome !== "granted") {
    return { ok: false, code: "NOT_FOUND" };
  }

  const findAuditId = deps.findAuditId ?? findAuditIdByReportTokenHash;
  const auditId = await findAuditId(claim.tokenHash);
  if (!auditId) return { ok: false, code: "NOT_FOUND" };

  const loadByAuditId = deps.loadByAuditId ?? loadAuditResultsByAuditId;
  return loadByAuditId(auditId);
}
