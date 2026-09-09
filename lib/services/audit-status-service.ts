import { createAdminClient } from "../supabase/admin";
import { hmacSha256 } from "../crypto";
import {
  getProgressInfo,
  isTerminalState,
  type AuditStatusResponse,
  type ProgressDiagnosticHint,
  type ProgressSignals,
} from "../schemas/audit-status";
import {
  CAPTURE_MILESTONES,
  furthestCaptureMilestone,
  isCaptureMilestone,
  PROGRESS_MILESTONE_EVENT,
} from "../audit-workflow/capture-milestones";

type AuditReport = NonNullable<AuditStatusResponse["report"]>;
type AdminClient = ReturnType<typeof createAdminClient>;

async function loadUnsupportedProgressHint(
  supabase: AdminClient,
  auditId: string,
): Promise<ProgressDiagnosticHint | undefined> {
  const { data: homePage } = await supabase
    .from("audit_pages")
    .select("metadata")
    .eq("audit_id", auditId)
    .eq("page_type", "home")
    .maybeSingle();

  const metadata = homePage?.metadata as Record<string, unknown> | null;
  if (!metadata) return undefined;

  return {
    failureType:
      typeof metadata.failure_type === "string"
        ? metadata.failure_type
        : undefined,
    httpStatus:
      typeof metadata.http_status === "number"
        ? metadata.http_status
        : undefined,
  };
}

/**
 * Reads the two facts that describe how far an in-flight audit has actually
 * got: which checks have returned rows, and how far capture reached.
 *
 * Both are read from what the pipeline already writes, so progress cannot
 * claim work the audit did not do. Only called for non-terminal audits, since
 * a finished audit has no in-flight work to describe.
 */
async function loadProgressSignals(
  supabase: AdminClient,
  auditId: string,
): Promise<ProgressSignals> {
  const [criteria, events] = await Promise.all([
    supabase.from("criterion_results").select("criterion_key").eq("audit_id", auditId),
    supabase
      .from("audit_events")
      .select("event_data")
      .eq("audit_id", auditId)
      .eq("event_type", PROGRESS_MILESTONE_EVENT),
  ]);

  const milestones = (events.data ?? [])
    .map((row) => (row.event_data as Record<string, unknown> | null)?.milestone)
    .filter(isCaptureMilestone);
  const furthest = furthestCaptureMilestone(milestones);

  return {
    returnedCriterionKeys: (criteria.data ?? []).map((row) => row.criterion_key),
    captureMilestone: furthest >= 0 ? CAPTURE_MILESTONES[furthest] : null,
  };
}

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
    const tokenHash = hmacSha256(publicStatusToken);

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
        updated_at,
        workflow_started_at
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

    const progressHint =
      audit.current_state === "unsupported"
        ? await loadUnsupportedProgressHint(supabase, audit.id)
        : undefined;

    const progressSignals = isTerminalState(audit.current_state)
      ? undefined
      : await loadProgressSignals(supabase, audit.id);

    // Build base response
    const response: AuditStatusResponse = {
      auditId: audit.id,
      status: audit.current_state as AuditStatusResponse["status"],
      progress: getProgressInfo(
        audit.current_state,
        progressHint,
        progressSignals,
      ),
      websiteUrl: audit.website_url,
      businessName: audit.business_name,
      submittedAt: audit.created_at,
    };

    // Elapsed processing time, measured from durable execution start so the
    // live session's slow-audit threshold survives a page reload. Falls back
    // to submission time for audits claimed before this column existed.
    const startedAt = audit.workflow_started_at ?? audit.created_at;
    if (startedAt) {
      response.startedAt = startedAt;
      const startedMs = Date.parse(startedAt);
      if (!Number.isNaN(startedMs)) {
        const endMs = isTerminalState(audit.current_state)
          ? Date.parse(audit.updated_at)
          : Date.now();
        response.elapsedMs = Math.max(
          0,
          (Number.isNaN(endMs) ? Date.now() : endMs) - startedMs,
        );
      }
    }

    // If complete, add report data
    if (isTerminalState(audit.current_state)) {
      response.completedAt = audit.updated_at;
    }

    if (
      audit.current_state === "complete" ||
      audit.current_state === "partial" ||
      audit.current_state === "needs_review"
    ) {

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
          overallScore:
            report.overall_score == null ? null : Number(report.overall_score),
          publicationStatus:
            report.publication_status as AuditReport["publicationStatus"],
          pillars: pillars?.map((p) => ({
            key: p.pillar_key,
            name: p.pillar_name,
            score: p.score == null ? null : Number(p.score),
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
