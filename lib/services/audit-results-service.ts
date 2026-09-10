import { criterionOutcome } from "@/lib/audit-workflow/criterion-outcome";
import type { CheckOutcome } from "@/lib/audit-workflow/rubric/model";
import {
  buildResultsView,
  isKnownCheckOutcome,
  isResultsAuditState,
  type ResultsAuditState,
  type ResultsCheckInput,
  type ResultsRecommendationInput,
  type ResultsView,
} from "@/lib/copy/audit-results";
import { getAuditStatus } from "@/lib/services/audit-status-service";
import { createAdminClient } from "@/lib/supabase/admin";

export type LoadedAuditResults = {
  view: ResultsView;
  auditId: string;
  leadId: string | null;
  auditState: ResultsAuditState;
};

export type LoadAuditResultsResult =
  | ({ ok: true; statusToken: string } & LoadedAuditResults)
  | { ok: false; code: "NOT_FOUND" | "SERVER_ERROR" };

export type LoadAuditResultsByIdResult =
  | ({ ok: true } & LoadedAuditResults)
  | { ok: false; code: "NOT_FOUND" | "SERVER_ERROR" };

function outcomeFromFindings(
  findings: Record<string, unknown>,
  score: number,
): CheckOutcome {
  const raw = findings.outcome;
  if (typeof raw === "string" && raw.length > 0 && !isKnownCheckOutcome(raw)) {
    throw new Error(`Unknown criterion outcome: ${raw}`);
  }
  return (
    criterionOutcome({
      criterion_key: "",
      criterion_name: "",
      pillar: "",
      score,
      weight: 0,
      findings,
    }) ?? "not_assessed"
  );
}

/**
 * Token-independent core: once `audit_id` is known, recommendations,
 * criterion outcomes, and the lead name come from the same tables the
 * results screen already reads. Ranking is not re-run.
 */
export async function loadAuditResultsByAuditId(
  auditId: string,
): Promise<LoadAuditResultsByIdResult> {
  try {
    const supabase = createAdminClient();
    const [auditResult, pillarsResult] = await Promise.all([
      supabase
        .from("audits")
        .select("id, website_url, lead_id, current_state, leads ( first_name )")
        .eq("id", auditId)
        .maybeSingle<{
          id: string;
          website_url: string;
          lead_id: string;
          current_state: string;
          leads: { first_name: string } | { first_name: string }[];
        }>(),
      supabase
        .from("pillar_results")
        .select("pillar_key, pillar_name, score")
        .eq("audit_id", auditId),
    ]);

    if (!auditResult.data) {
      return { ok: false, code: "NOT_FOUND" };
    }

    const lead = Array.isArray(auditResult.data.leads)
      ? auditResult.data.leads[0]
      : auditResult.data.leads;

    const loaded = await loadViewForAudit(
      auditId,
      auditResult.data.website_url,
      (pillarsResult.data ?? []).map((row) => ({
        key: row.pillar_key,
        name: row.pillar_name,
        score: row.score == null ? null : Number(row.score),
      })),
      lead?.first_name ?? null,
      auditResult.data.lead_id,
      auditResult.data.current_state,
    );
    return { ok: true, ...loaded };
  } catch (error) {
    console.error("Error loading audit results:", error);
    return { ok: false, code: "SERVER_ERROR" };
  }
}

function auditStateFromRow(currentState: string): ResultsAuditState {
  return isResultsAuditState(currentState) ? currentState : "complete";
}

async function loadViewForAudit(
  auditId: string,
  websiteUrl: string,
  pillars: Array<{ key: string; name: string; score: number | null }>,
  firstName: string | null,
  leadId: string | null,
  currentState: string,
): Promise<LoadedAuditResults> {
  const supabase = createAdminClient();
  const [criteriaResult, revisionResult] = await Promise.all([
    supabase
      .from("criterion_results")
      .select("criterion_key, pillar, score, findings")
      .eq("audit_id", auditId),
    supabase
      .from("report_revisions")
      .select("id")
      .eq("audit_id", auditId)
      .order("revision_number", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>(),
  ]);

  const recsResult = revisionResult.data
    ? await supabase
        .from("recommendations")
        .select("priority, title, description, pillar, sort_order")
        .eq("report_revision_id", revisionResult.data.id)
        .order("sort_order")
    : { data: [], error: null };

  if (criteriaResult.error) {
    throw new Error(`Failed to load criterion results: ${criteriaResult.error.message}`);
  }
  if (recsResult.error) {
    throw new Error(`Failed to load recommendations: ${recsResult.error.message}`);
  }

  const criteria: ResultsCheckInput[] = (criteriaResult.data ?? []).map(
    (row) => ({
      key: row.criterion_key,
      pillar: row.pillar,
      outcome: outcomeFromFindings(
        (row.findings ?? {}) as Record<string, unknown>,
        Number(row.score),
      ),
    }),
  );

  const recommendations: ResultsRecommendationInput[] = (
    recsResult.data ?? []
  ).map((row) => ({
    title: row.title,
    description: row.description,
    pillar: row.pillar,
    priority: row.priority,
    sortOrder: row.sort_order ?? 0,
  }));

  const auditState = auditStateFromRow(currentState);
  return {
    auditId,
    leadId,
    auditState,
    view: buildResultsView({
      firstName,
      websiteUrl,
      pillars,
      criteria,
      recommendations,
      auditState,
    }),
  };
}

/**
 * Results-screen payload for the live session.
 *
     * Token lookup and pillar scores reuse `getAuditStatus` (the M6 session
     * report path). Criterion outcomes and the lead first name are loaded from
     * the same audit — they are not on the public status payload because that
     * endpoint is polled by the loading screen and must stay free of PII.
     *
     * Recommendations are the Fix First set already ranked at report assembly
     * (`selectRecommendations` / `selectFixFirst` in
     * `lib/audit-workflow/recommendations.ts`) and persisted on the
     * `recommendations` table. This loader reads those rows in `sort_order`;
     * it does not re-run ranking.
 */
export async function loadAuditResults(
  publicStatusToken: string,
): Promise<LoadAuditResultsResult> {
  try {
    const status = await getAuditStatus(publicStatusToken);
    if ("error" in status) {
      return { ok: false, code: status.code === "NOT_FOUND" ? "NOT_FOUND" : "SERVER_ERROR" };
    }
    const terminalWithoutReport =
      status.status === "failed" || status.status === "unsupported";
    if (!status.report && !terminalWithoutReport) {
      return { ok: false, code: "NOT_FOUND" };
    }

    const loaded = await loadAuditResultsByAuditId(status.auditId);
    if (!loaded.ok) return loaded;
    return { ...loaded, statusToken: publicStatusToken };
  } catch (error) {
    console.error("Error loading audit results:", error);
    return { ok: false, code: "SERVER_ERROR" };
  }
}
