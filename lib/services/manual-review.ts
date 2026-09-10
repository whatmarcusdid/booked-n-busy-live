import { hmacSha256 } from "../crypto";
import { displayWebsiteHost } from "../copy/audit-results";
import type { TransactionalEmailProvider } from "../email/provider";
import { BRAND_NAME, SUPPORT_EMAIL } from "../identity";
import { createAdminClient } from "../supabase/admin";

export const MANUAL_REVIEW_REQUESTED_EVENT = "manual_review_requested";

export type ManualReviewAudit = {
  id: string;
  currentState: string;
  websiteUrl: string;
};

export interface ManualReviewStore {
  findAuditByStatusToken(statusToken: string): Promise<ManualReviewAudit | null>;
  hasManualReviewEvent(auditId: string): Promise<boolean>;
  insertManualReviewEvent(
    auditId: string,
    eventData: Record<string, unknown>,
  ): Promise<void>;
}

export type RequestManualReviewResult =
  | { ok: true; alreadyRequested: boolean }
  | { ok: false; reason: "not_found" | "not_failed" | "send_failed" };

export function createSupabaseManualReviewStore(): ManualReviewStore {
  return {
    async findAuditByStatusToken(statusToken) {
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("audits")
        .select("id, current_state, website_url")
        .eq("public_status_token_hash", hmacSha256(statusToken))
        .maybeSingle<{
          id: string;
          current_state: string;
          website_url: string;
        }>();
      if (!data) return null;
      return {
        id: data.id,
        currentState: data.current_state,
        websiteUrl: data.website_url,
      };
    },
    async hasManualReviewEvent(auditId) {
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("audit_events")
        .select("id")
        .eq("audit_id", auditId)
        .eq("event_type", MANUAL_REVIEW_REQUESTED_EVENT)
        .limit(1)
        .maybeSingle();
      return Boolean(data);
    },
    async insertManualReviewEvent(auditId, eventData) {
      const supabase = createAdminClient();
      const { error } = await supabase.from("audit_events").insert({
        audit_id: auditId,
        event_type: MANUAL_REVIEW_REQUESTED_EVENT,
        event_data: eventData,
      });
      if (error) {
        throw new Error(`Failed to insert audit event: ${error.message}`);
      }
    },
  };
}

export async function requestManualReview(input: {
  statusToken: string;
  store: ManualReviewStore;
  provider: TransactionalEmailProvider;
}): Promise<RequestManualReviewResult> {
  const audit = await input.store.findAuditByStatusToken(input.statusToken);
  if (!audit) return { ok: false, reason: "not_found" };
  if (audit.currentState !== "failed") {
    return { ok: false, reason: "not_failed" };
  }

  if (await input.store.hasManualReviewEvent(audit.id)) {
    return { ok: true, alreadyRequested: true };
  }

  const domain = displayWebsiteHost(audit.websiteUrl);
  const sent = await input.provider.send({
    to: SUPPORT_EMAIL,
    subject: `${BRAND_NAME}: manual review requested`,
    text: [
      `A customer requested a manual review of a Failed audit.`,
      `Audit ID: ${audit.id}`,
      `Domain: ${domain}`,
    ].join("\n"),
    html: `<p>A customer requested a manual review of a Failed audit.</p><p>Audit ID: ${audit.id}<br>Domain: ${domain}</p>`,
    idempotencyKey: `manual-review:${audit.id}`,
  });
  if (!sent.ok) {
    console.error("manual-review: provider send failed", {
      auditId: audit.id,
      error: sent.error,
    });
    return { ok: false, reason: "send_failed" };
  }

  await input.store.insertManualReviewEvent(audit.id, {
    domain,
    trigger: "customer_failed_results",
  });
  return { ok: true, alreadyRequested: false };
}
