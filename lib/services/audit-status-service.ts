import { createAdminClient } from "../supabase/admin";
import { sha256Hash } from "../crypto";
import {
  getProgressInfo,
  type AuditStatusResponse,
} from "../schemas/audit-status";

export interface AuditStatusError {
  error: string;
  code: "NOT_FOUND" | "INVALID_TOKEN" | "SERVER_ERROR";
}

/**
 * Get audit status by public status token
 * Returns customer-safe information only (no PII)
 */
export async function getAuditStatus(
  publicStatusToken: string,
): Promise<AuditStatusResponse | AuditStatusError> {
  try {
    const supabase = createAdminClient();

    // Hash the token to find the audit
    const tokenHash = sha256Hash(publicStatusToken);

    // Get audit with related data
    const { data: audit, error: auditError } = await supabase
      .from("audits")
      .select(
        `
        id,
        website_url,
        business_name,
        current_state,
        created_at,
        updated_at
      `,
      )
      .eq("public_status_token_hash", tokenHash)
      .single();

    if (auditError || !audit) {
      return {
        error: "Audit not found",
        code: "NOT_FOUND",
      };
    }

    // Build base response
    const response: AuditStatusResponse = {
      auditId: audit.id,
      status: audit.current_state as AuditStatusResponse["status"],
      progress: getProgressInfo(audit.current_state),
      websiteUrl: audit.website_url,
      businessName: audit.business_name,
      submittedAt: audit.created_at,
    };

    // If complete, add report data
    if (audit.current_state === "complete") {
      response.completedAt = audit.updated_at;

      // Get report revision
      const { data: report } = await supabase
        .from("report_revisions")
        .select(
          `
          id,
          overall_score,
          publication_status
        `,
        )
        .eq("audit_id", audit.id)
        .order("revision_number", { ascending: false })
        .limit(1)
        .single();

      if (report) {
        // Get pillar results
        const { data: pillars } = await supabase
          .from("pillar_results")
          .select("pillar_key, pillar_name, score")
          .eq("audit_id", audit.id)
          .order("pillar_key");

        // Get top recommendations
        const { data: recommendations } = await supabase
          .from("recommendations")
          .select("priority, title, description")
          .eq("report_revision_id", report.id)
          .order("sort_order")
          .limit(3);

        response.report = {
          overallScore: Number(report.overall_score),
          publicationStatus: report.publication_status as AuditStatusResponse["report"]["publicationStatus"],
          pillars: pillars?.map((p) => ({
            key: p.pillar_key,
            name: p.pillar_name,
            score: Number(p.score),
          })),
          topRecommendations: recommendations?.map((r) => ({
            priority: r.priority,
            title: r.title,
            description: r.description,
          })),
        };
      }
    }

    return response;
  } catch (error) {
    console.error("Error fetching audit status:", error);
    return {
      error: "Internal server error",
      code: "SERVER_ERROR",
    };
  }
}
