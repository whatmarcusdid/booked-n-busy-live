import { createAdminClient } from "../supabase/admin";
import { generateSecureToken, hmacSha256 } from "../crypto";
import { startAuditWorkflow } from "../audit-workflow/start";

/**
 * Customer-facing manual retry (PRD decision #11 rule 10).
 *
 * After the single bounded automatic retry, a transient failure terminates as
 * Failed and the customer is offered a manual retry. A manual retry must start
 * a GENUINELY NEW execution, not resume the stuck one:
 *
 *   - `audit_state_transitions` has a unique index on `(audit_id, to_state)`,
 *     so a terminal audit physically cannot re-traverse its own states.
 *   - `audit_events` has a unique index on one `workflow_started` per audit,
 *     so the original audit's workflow claim can never be re-taken.
 *
 * So the retry inserts a NEW audits row for the same lead, carries the
 * intake fields forward, links back via `retry_of_audit_id`, and starts a
 * fresh workflow. The failed audit stays terminal and immutable.
 *
 * Only `failed` audits are retryable. `unsupported` is a policy terminal state
 * (login wall, homepage 401/403, prohibited content, robots disallow) where a
 * retry cannot change the outcome, so it is never offered.
 */

export const MANUAL_RETRY_EVENT = "audit_manual_retry_started";

export type RetryAuditResult =
  | {
      ok: true;
      auditId: string;
      sourceAuditId: string;
      statusUrl: string;
      retryAttempt: number;
    }
  | {
      ok: false;
      reason: "not_found" | "not_retryable" | "already_retried" | "start_failed";
    };

const RETRYABLE_STATES = new Set(["failed"]);

interface AuditRetryRow {
  id: string;
  lead_id: string;
  website_url: string;
  business_name: string;
  primary_concern: string | null;
  team_size: string | null;
  platform: string | null;
  referral_source: string | null;
  consent_report_delivery: boolean;
  consent_follow_up: boolean;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  landing_variant: string | null;
  current_state: string;
  retry_attempt: number | null;
}

const AUDIT_RETRY_COLUMNS =
  "id, lead_id, website_url, business_name, primary_concern, team_size, platform, referral_source, consent_report_delivery, consent_follow_up, utm_source, utm_medium, utm_campaign, utm_term, utm_content, landing_variant, current_state, retry_attempt";

export async function retryAuditByStatusToken(
  statusToken: string,
): Promise<RetryAuditResult> {
  const supabase = createAdminClient();
  const tokenHash = hmacSha256(statusToken);

  const { data: source, error } = await supabase
    .from("audits")
    .select(AUDIT_RETRY_COLUMNS)
    .eq("public_status_token_hash", tokenHash)
    .maybeSingle<AuditRetryRow>();

  if (error || !source) {
    return { ok: false, reason: "not_found" };
  }

  if (!RETRYABLE_STATES.has(source.current_state)) {
    return { ok: false, reason: "not_retryable" };
  }

  const token = generateSecureToken(32);
  const retryAttempt = (source.retry_attempt ?? 0) + 1;

  const { data: created, error: insertError } = await supabase
    .from("audits")
    .insert({
      lead_id: source.lead_id,
      website_url: source.website_url,
      business_name: source.business_name,
      primary_concern: source.primary_concern,
      team_size: source.team_size,
      platform: source.platform,
      referral_source: source.referral_source,
      consent_report_delivery: source.consent_report_delivery,
      consent_follow_up: source.consent_follow_up,
      utm_source: source.utm_source,
      utm_medium: source.utm_medium,
      utm_campaign: source.utm_campaign,
      utm_term: source.utm_term,
      utm_content: source.utm_content,
      landing_variant: source.landing_variant,
      public_status_token_hash: hmacSha256(token),
      current_state: "submitted",
      retry_of_audit_id: source.id,
      retry_attempt: retryAttempt,
    })
    .select("id")
    .single();

  if (insertError || !created) {
    // The partial unique index on retry_of_audit_id makes a double-submitted
    // retry a conflict rather than a second parallel execution.
    if (insertError?.code === "23505") {
      return { ok: false, reason: "already_retried" };
    }
    return { ok: false, reason: "start_failed" };
  }

  await supabase.from("audit_state_transitions").insert({
    audit_id: created.id,
    from_state: null,
    to_state: "submitted",
  });

  await supabase.from("audit_events").insert({
    audit_id: created.id,
    event_type: MANUAL_RETRY_EVENT,
    event_data: {
      retry_of_audit_id: source.id,
      retry_attempt: retryAttempt,
      source_state: source.current_state,
      trigger: "customer_manual_retry",
    },
  });

  try {
    await startAuditWorkflow({
      auditId: created.id,
      websiteUrl: source.website_url,
    });
  } catch (workflowError) {
    console.error("Failed to start manual retry workflow:", workflowError);
    return { ok: false, reason: "start_failed" };
  }

  return {
    ok: true,
    auditId: created.id,
    sourceAuditId: source.id,
    statusUrl: `/audit/status/${token}`,
    retryAttempt,
  };
}
