import { createAdminClient } from "../supabase/admin";
import { hashEmail } from "../crypto";
import { generateSecureToken, sha256Hash } from "../crypto";
import type { AuditSubmission } from "../schemas/audit-submission";

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

/**
 * Create an audit with lead information
 * Uses database RPC function to ensure atomicity
 */
export async function createAudit(
  data: AuditSubmission,
  normalizedUrl: string,
): Promise<CreateAuditResult | CreateAuditError> {
  try {
    const supabase = createAdminClient();

    // Generate secure token and hash it
    const publicStatusToken = generateSecureToken(32);
    const publicStatusTokenHash = sha256Hash(publicStatusToken);

    // Hash email for deduplication
    const emailHash = hashEmail(data.email);

    // Call database function to create audit atomically
    const { data: result, error } = await supabase.rpc(
      "create_audit_with_lead",
      {
        p_email_hash: emailHash,
        p_first_name: data.firstName,
        p_business_name: data.businessName,
        p_phone: data.phone || null,
        p_trade: data.trade,
        p_service_area: data.serviceArea,
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
        p_public_status_token_hash: publicStatusTokenHash,
      },
    );

    if (error) {
      console.error("Database error creating audit:", error);
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

    // TODO: Initiate Vercel Workflow here
    // This is where we would trigger the diagnostic workflow
    // Example: await triggerDiagnosticWorkflow(auditRecord.audit_id, normalizedUrl);

    // Development-only: Auto-trigger mock processor (optional)
    // Uncomment to automatically process audits in development:
    // if (process.env.NODE_ENV === "development") {
    //   const { processMockAudit } = await import("./mock-audit-processor");
    //   processMockAudit(auditRecord.audit_id).catch(console.error);
    // }

    return {
      auditId: auditRecord.audit_id,
      status: "submitted",
      statusUrl: `/audit/status/${publicStatusToken}`,
      duplicate: !auditRecord.is_new_lead,
    };
  } catch (error) {
    console.error("Unexpected error creating audit:", error);
    return {
      error: "Internal server error",
      details: process.env.NODE_ENV === "development" ? error : undefined,
    };
  }
}
