import { createAdminClient } from "../supabase/admin";
import { describeDatabaseError } from "../supabase/errors";
import { hashEmail, normalizeEmail } from "../crypto";
import { generateSecureToken, hmacSha256 } from "../crypto";
import type { AuditSubmission } from "../schemas/audit-submission";
import { startAuditWorkflow } from "../audit-workflow/start";
import { hashIdempotencyKey } from "../audit-workflow/store";

export interface CreateAuditResult {
  auditId: string;
  status: "submitted";
  statusUrl: string;
  duplicate: boolean;
}

export interface CreateAuditError {
  error: string;
  details?: unknown;
}

function issueStatusUrl(): { token: string; tokenHash: string; statusUrl: string } {
  const token = generateSecureToken(32);
  return {
    token,
    tokenHash: hmacSha256(token),
    statusUrl: `/audit/status/${token}`,
  };
}

/**
 * Create an audit with lead information.
 * Uses create_audit_with_lead so lead + audit + first transition are atomic.
 * Idempotency is enforced by audits.idempotency_key_hash (unique when present).
 */
export async function createAudit(
  data: AuditSubmission,
  normalizedUrl: string,
  options?: { idempotencyKey?: string },
): Promise<CreateAuditResult | CreateAuditError> {
  try {
    const idempotencyKey = options?.idempotencyKey?.trim();
    const idempotencyKeyHash = idempotencyKey
      ? hashIdempotencyKey(idempotencyKey)
      : null;

    const supabase = createAdminClient();
    const issued = issueStatusUrl();
    const emailHash = hashEmail(data.email);

    const { data: result, error } = await supabase.rpc(
      "create_audit_with_lead",
      {
        p_email_hash: emailHash,
        // Plaintext alongside the hash: Calendar reconciliation matches
        // attendees by address and cannot match a hash. Same normalization as
        // the hash, so the two always describe one address.
        p_email: normalizeEmail(data.email),
        p_first_name: data.firstName,
        p_business_name: data.businessName,
        p_phone: data.phone || null,
        p_trade: data.trade ?? null,
        p_service_area: data.serviceArea ?? null,
        p_website_url: normalizedUrl,
        p_primary_concern: data.primaryConcern || null,
        p_team_size: data.teamSize || null,
        p_platform: data.platform || null,
        p_referral_source: data.referralSource || null,
        p_consent_report_delivery: data.consent.reportDelivery,
        p_consent_follow_up: data.consent.followUp || false,
        p_utm_source: data.attribution?.utmSource || null,
        p_utm_medium: data.attribution?.utmMedium || null,
        p_utm_campaign: data.attribution?.utmCampaign || null,
        p_utm_term: data.attribution?.utmTerm || null,
        p_utm_content: data.attribution?.utmContent || null,
        p_landing_variant: data.attribution?.landingVariant || null,
        p_public_status_token_hash: issued.tokenHash,
        p_idempotency_key_hash: idempotencyKeyHash,
      },
    );

    if (error) {
      console.error(
        "Database error creating audit:",
        describeDatabaseError(error),
      );
      return {
        error: "Failed to create audit",
        details: process.env.NODE_ENV === "development" ? error : undefined,
      };
    }

    if (!result || result.length === 0) {
      return {
        error: "Failed to create audit",
      };
    }

    const auditRecord = result[0];

    if (auditRecord.is_new_audit === false) {
      const replay = issueStatusUrl();
      const { error: rotateError } = await supabase
        .from("audits")
        .update({ public_status_token_hash: replay.tokenHash })
        .eq("id", auditRecord.audit_id);

      if (rotateError) {
        console.error(
          "Failed to rotate status token hash:",
          describeDatabaseError(rotateError),
        );
        return {
          error: "Failed to create audit",
          details:
            process.env.NODE_ENV === "development" ? rotateError : undefined,
        };
      }

      return {
        auditId: auditRecord.audit_id,
        status: "submitted",
        statusUrl: replay.statusUrl,
        duplicate: true,
      };
    }

    try {
      await startAuditWorkflow({
        auditId: auditRecord.audit_id,
        websiteUrl: normalizedUrl,
      });
    } catch (workflowError) {
      console.error(
        "Failed to start audit workflow:",
        describeDatabaseError(workflowError),
      );
    }

    return {
      auditId: auditRecord.audit_id,
      status: "submitted",
      statusUrl: issued.statusUrl,
      duplicate: !auditRecord.is_new_lead,
    };
  } catch (error) {
    console.error(
      "Unexpected error creating audit:",
      describeDatabaseError(error),
    );
    return {
      error: "Internal server error",
      details: process.env.NODE_ENV === "development" ? error : undefined,
    };
  }
}
