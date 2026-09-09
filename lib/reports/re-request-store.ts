import { createAdminClient } from "../supabase/admin";
import { startAuditWorkflow } from "../audit-workflow/start";
import { issueReportToken, reportTokenExpiresAt } from "./tokens";
import {
  resolveReRequest as resolveOutcome,
  type ReRequestOutcome,
  type ReRequestRow,
  type ReRequestStore,
} from "./re-request";

export type { ReRequestOutcome, ReRequestRow, ReRequestStore };

const ROW_SELECT = `
  id,
  lead_id,
  website_url,
  created_at,
  leads!inner ( id, email_hash )
`;

interface RawAuditRow {
  id: string;
  lead_id: string;
  website_url: string;
  created_at: string | null;
  leads: { id: string; email_hash: string } | { id: string; email_hash: string }[];
}

function leadOf(row: RawAuditRow) {
  return Array.isArray(row.leads) ? row.leads[0] : row.leads;
}

async function latestRevision(auditId: string) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("report_revisions")
    .select("id, published_at")
    .eq("audit_id", auditId)
    .order("revision_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export function createSupabaseReRequestStore(): ReRequestStore {
  return {
    async findByReportTokenHash(tokenHash) {
      const supabase = createAdminClient();
      const { data: revision } = await supabase
        .from("report_revisions")
        .select("id, audit_id, published_at")
        .eq("public_report_token_hash", tokenHash)
        .maybeSingle();
      if (!revision) return null;

      const { data: audit } = await supabase
        .from("audits")
        .select(ROW_SELECT)
        .eq("id", revision.audit_id)
        .maybeSingle<RawAuditRow>();
      if (!audit) return null;

      const lead = leadOf(audit);
      return {
        auditId: audit.id,
        leadId: audit.lead_id,
        websiteUrl: audit.website_url,
        reportRevisionId: revision.id,
        leadEmailHash: lead?.email_hash ?? "",
        publishedAt: revision.published_at,
        auditCreatedAt: audit.created_at,
      };
    },

    async findLatestByEmailHash(emailHash) {
      const supabase = createAdminClient();
      const { data: lead } = await supabase
        .from("leads")
        .select("id")
        .eq("email_hash", emailHash)
        .maybeSingle();
      if (!lead) return null;

      const { data: audit } = await supabase
        .from("audits")
        .select(ROW_SELECT)
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<RawAuditRow>();
      if (!audit) return null;

      const revision = await latestRevision(audit.id);
      const leadRow = leadOf(audit);
      return {
        auditId: audit.id,
        leadId: audit.lead_id,
        websiteUrl: audit.website_url,
        reportRevisionId: revision?.id ?? null,
        leadEmailHash: leadRow?.email_hash ?? "",
        publishedAt: revision?.published_at ?? null,
        auditCreatedAt: audit.created_at,
      };
    },
  };
}

/**
 * Mints a replacement report token for a report still within retention.
 *
 * The old token's hash is overwritten, so the expired link stays dead rather
 * than being silently revived — the customer gets a genuinely new 30-day
 * window and the old URL, which may be sitting in a forwarded email, does
 * not start working again.
 */
export async function reissueReportAccess(
  reportRevisionId: string,
  now: Date = new Date(),
): Promise<{ token: string } | null> {
  const supabase = createAdminClient();
  const issued = issueReportToken();
  const { error } = await supabase
    .from("report_revisions")
    .update({
      public_report_token_hash: issued.tokenHash,
      public_report_token_expires_at: reportTokenExpiresAt(now).toISOString(),
    })
    .eq("id", reportRevisionId)
    .eq("publication_status", "published");
  if (error) return null;
  return { token: issued.token };
}

export interface ExecuteReRequestResult {
  outcome: ReRequestOutcome;
  /** Raw token for the replacement link, when one was minted. */
  reportToken?: string;
  /** New audit id, when a fresh scan was started. */
  auditId?: string;
}

/**
 * Resolves and then performs the re-request. Kept separate from
 * `resolveReRequest` so the branch decision stays unit-testable without a
 * database or a workflow runtime.
 */
export async function resolveReRequest(
  input: { email: string; tokenHash?: string },
  store: ReRequestStore,
  now: Date = new Date(),
): Promise<ExecuteReRequestResult> {
  const outcome = await resolveOutcome(input, store, now);

  if (outcome.action === "resend") {
    const reissued = await reissueReportAccess(outcome.reportRevisionId, now);
    return { outcome, reportToken: reissued?.token };
  }

  if (outcome.action === "rescan") {
    const started = await startFreshScan(outcome.leadId, outcome.websiteUrl);
    return { outcome, auditId: started ?? undefined };
  }

  return { outcome };
}

async function startFreshScan(
  leadId: string,
  websiteUrl: string,
): Promise<string | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("audits")
    .insert({
      lead_id: leadId,
      website_url: websiteUrl,
      current_state: "submitted",
      public_status_token_hash: issueReportToken().tokenHash,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) return null;
  await startAuditWorkflow({ auditId: data.id, websiteUrl });
  return data.id;
}
