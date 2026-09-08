import { createAdminClient } from "../supabase/admin";
import { hmacSha256 } from "../crypto";
import { WORKFLOW_STARTED_EVENT, type AuditWorkflowState } from "./types";

export interface AuditRecord {
  id: string;
  website_url: string;
  current_state: string;
}

export interface StateTransitionRow {
  from_state: string | null;
  to_state: string;
  transitioned_at: string;
}

export interface CriterionInput {
  criterion_key: string;
  criterion_name: string;
  pillar: string;
  score: number;
  weight: number;
  findings: Record<string, unknown>;
  evidence_ids?: string[];
  rule_version?: string;
}

export interface PillarInput {
  pillar_key: string;
  pillar_name: string;
  /** Null when the pillar has zero assessed criteria (not a numeric 0). */
  score: number | null;
  criteria_count: number;
  summary: string;
  rule_version?: string;
}

export interface PageInput {
  url: string;
  page_type: string;
  title: string;
  meta_description: string;
  metadata?: Record<string, unknown>;
}

export interface EvidenceInput {
  mock_key: string;
  evidence_type: string;
  description: string;
  metadata: Record<string, unknown>;
  artifact_id?: string | null;
  url?: string | null;
}

export interface ArtifactInput {
  audit_id: string;
  audit_page_id: string | null;
  storage_key: string;
  mime_type: string;
  size: number;
  checksum: string;
  viewport: string;
  retention_class: string;
}

export interface StoredPage {
  id: string;
  url: string;
  page_type: string;
  metadata?: Record<string, unknown>;
}

export interface ReportInput {
  overall_score: number | null;
  executive_summary: string;
  publication_status: string;
  metadata?: Record<string, unknown>;
}

export interface RecommendationInput {
  priority: string;
  title: string;
  description: string;
  pillar: string;
  estimated_impact: string;
  implementation_difficulty: string;
  sort_order: number;
  /** Catalog key that produced this recommendation. Not a DB column. */
  criterion_key?: string;
  /** Evidence rows that justified the recommendation (junction + legacy array). */
  evidence_ids?: string[];
}

export interface AuditWorkflowStore {
  getAudit(auditId: string): Promise<AuditRecord | null>;
  recordTransition(
    auditId: string,
    fromState: AuditWorkflowState | null,
    toState: AuditWorkflowState,
  ): Promise<"inserted" | "exists">;
  listTransitions(auditId: string): Promise<StateTransitionRow[]>;
  upsertPages(auditId: string, pages: PageInput[]): Promise<void>;
  findPage(auditId: string, pageType: string): Promise<StoredPage | null>;
  mergePageMetadata(
    auditId: string,
    pageId: string,
    patch: Record<string, unknown>,
  ): Promise<void>;
  insertArtifact(input: ArtifactInput): Promise<string>;
  hasEvidence(auditId: string, mockKey: string): Promise<boolean>;
  upsertEvidence(auditId: string, items: EvidenceInput[]): Promise<string[]>;
  upsertCriteria(auditId: string, items: CriterionInput[]): Promise<void>;
  listCriteria(auditId: string): Promise<CriterionInput[]>;
  upsertPillars(auditId: string, items: PillarInput[]): Promise<void>;
  listPillars(auditId: string): Promise<PillarInput[]>;
  upsertReport(auditId: string, report: ReportInput): Promise<string>;
  upsertRecommendations(
    auditId: string,
    reportRevisionId: string,
    items: RecommendationInput[],
  ): Promise<void>;
  recordEvent(
    auditId: string,
    eventType: string,
    eventData: Record<string, unknown>,
  ): Promise<void>;
  claimWorkflow(auditId: string): Promise<boolean>;
  releaseWorkflowClaim(auditId: string): Promise<void>;
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

async function linkRecommendationEvidence(
  supabase: ReturnType<typeof createAdminClient>,
  recommendationId: string,
  evidenceIds: string[],
): Promise<void> {
  for (const evidenceId of evidenceIds) {
    const { error } = await supabase.from("recommendation_evidence").insert({
      recommendation_id: recommendationId,
      evidence_id: evidenceId,
    });
    if (error && !isUniqueViolation(error)) {
      throw new Error(
        `Failed to link recommendation evidence: ${error.message}`,
      );
    }
  }
}

export function createSupabaseAuditStore(): AuditWorkflowStore {
  return {
    async getAudit(auditId) {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from("audits")
        .select("id, website_url, current_state")
        .eq("id", auditId)
        .single();

      if (error || !data) return null;
      return data;
    },

    async recordTransition(auditId, fromState, toState) {
      const supabase = createAdminClient();
      const { error } = await supabase.from("audit_state_transitions").insert({
        audit_id: auditId,
        from_state: fromState,
        to_state: toState,
      });

      if (isUniqueViolation(error)) {
        return "exists";
      }
      if (error) {
        throw new Error(`Failed to insert state transition: ${error.message}`);
      }

      const { error: updateError } = await supabase
        .from("audits")
        .update({ current_state: toState })
        .eq("id", auditId);

      if (updateError) {
        throw new Error(`Failed to update audit state: ${updateError.message}`);
      }

      await supabase.from("audit_events").insert({
        audit_id: auditId,
        event_type: `state_changed_to_${toState}`,
        event_data: {
          from_state: fromState,
          to_state: toState,
          timestamp: new Date().toISOString(),
        },
      });

      return "inserted";
    },

    async listTransitions(auditId) {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from("audit_state_transitions")
        .select("from_state, to_state, transitioned_at")
        .eq("audit_id", auditId)
        .order("transitioned_at", { ascending: true });

      if (error) {
        throw new Error(`Failed to list transitions: ${error.message}`);
      }
      return data ?? [];
    },

    async upsertPages(auditId, pages) {
      const supabase = createAdminClient();
      const { error } = await supabase.from("audit_pages").upsert(
        pages.map((page) => ({
          audit_id: auditId,
          ...page,
          metadata: page.metadata ?? { mock: true },
        })),
        { onConflict: "audit_id,url" },
      );
      if (error) {
        throw new Error(`Failed to upsert pages: ${error.message}`);
      }
    },

    async findPage(auditId, pageType) {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from("audit_pages")
        .select("id, url, page_type, metadata")
        .eq("audit_id", auditId)
        .eq("page_type", pageType)
        .limit(1)
        .maybeSingle();
      if (error || !data) return null;
      return data;
    },

    async mergePageMetadata(auditId, pageId, patch) {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from("audit_pages")
        .select("metadata")
        .eq("id", pageId)
        .eq("audit_id", auditId)
        .single();
      if (error) {
        throw new Error(`Failed to load page metadata: ${error.message}`);
      }
      const metadata = {
        ...((data?.metadata as Record<string, unknown> | null) ?? {}),
        ...patch,
      };
      const { error: updateError } = await supabase
        .from("audit_pages")
        .update({ metadata })
        .eq("id", pageId);
      if (updateError) {
        throw new Error(`Failed to merge page metadata: ${updateError.message}`);
      }
    },

    async insertArtifact(input) {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from("artifacts")
        .insert(input)
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to insert artifact: ${error?.message}`);
      }
      return data.id;
    },

    async hasEvidence(auditId, mockKey) {
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("evidence")
        .select("id")
        .eq("audit_id", auditId)
        .contains("metadata", { mock_key: mockKey })
        .maybeSingle();
      return Boolean(data);
    },

    async upsertEvidence(auditId, items) {
      const supabase = createAdminClient();
      const ids: string[] = [];
      for (const item of items) {
        const { data: existing } = await supabase
          .from("evidence")
          .select("id")
          .eq("audit_id", auditId)
          .contains("metadata", { mock_key: item.mock_key })
          .maybeSingle();

        if (existing) {
          ids.push(existing.id);
          continue;
        }

        const { data, error } = await supabase
          .from("evidence")
          .insert({
            audit_id: auditId,
            evidence_type: item.evidence_type,
            url: item.url ?? null,
            description: item.description,
            artifact_id: item.artifact_id ?? null,
            metadata: {
              ...item.metadata,
              mock: item.metadata.mock === false ? false : true,
              mock_key: item.mock_key,
            },
          })
          .select("id")
          .single();
        if (error && !isUniqueViolation(error)) {
          throw new Error(`Failed to insert evidence: ${error.message}`);
        }
        if (data?.id) ids.push(data.id);
      }
      return ids;
    },

    async upsertCriteria(auditId, items) {
      const supabase = createAdminClient();
      const { error } = await supabase.from("criterion_results").upsert(
        items.map((item) => ({
          audit_id: auditId,
          ...item,
          rule_version: item.rule_version ?? "v2",
          findings: {
            ...item.findings,
            rule_version: item.rule_version ?? item.findings.rule_version ?? "v2",
          },
        })),
        { onConflict: "audit_id,criterion_key" },
      );
      if (error) {
        throw new Error(`Failed to upsert criteria: ${error.message}`);
      }
    },

    async listCriteria(auditId) {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from("criterion_results")
        .select(
          "criterion_key, criterion_name, pillar, score, weight, findings, evidence_ids, rule_version",
        )
        .eq("audit_id", auditId);

      if (error) {
        throw new Error(`Failed to list criteria: ${error.message}`);
      }
      return (data ?? []).map((row) => ({
        criterion_key: row.criterion_key,
        criterion_name: row.criterion_name,
        pillar: row.pillar,
        score: row.score,
        weight: row.weight,
        findings: (row.findings ?? {}) as Record<string, unknown>,
        evidence_ids: row.evidence_ids ?? undefined,
        rule_version: row.rule_version ?? undefined,
      }));
    },

    async upsertPillars(auditId, items) {
      const supabase = createAdminClient();
      const { error } = await supabase.from("pillar_results").upsert(
        items.map((item) => ({
          audit_id: auditId,
          ...item,
          rule_version: item.rule_version ?? "v2",
        })),
        { onConflict: "audit_id,pillar_key" },
      );
      if (error) {
        throw new Error(`Failed to upsert pillars: ${error.message}`);
      }
    },

    async listPillars(auditId) {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from("pillar_results")
        .select(
          "pillar_key, pillar_name, score, criteria_count, summary, rule_version",
        )
        .eq("audit_id", auditId);
      if (error) {
        throw new Error(`Failed to list pillars: ${error.message}`);
      }
      return (data ?? []).map((row) => ({
        pillar_key: row.pillar_key,
        pillar_name: row.pillar_name,
        score: row.score == null ? null : Number(row.score),
        criteria_count: row.criteria_count,
        summary: row.summary ?? "",
        rule_version: row.rule_version ?? undefined,
      }));
    },

    async upsertReport(auditId, report) {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from("report_revisions")
        .upsert(
          {
            audit_id: auditId,
            revision_number: 1,
            overall_score: report.overall_score,
            executive_summary: report.executive_summary,
            publication_status: report.publication_status,
            metadata: report.metadata ?? { mock: true },
          },
          { onConflict: "audit_id,revision_number" },
        )
        .select("id")
        .single();

      if (error || !data) {
        throw new Error(`Failed to upsert report: ${error?.message}`);
      }
      return data.id;
    },

    async upsertRecommendations(auditId, reportRevisionId, items) {
      const supabase = createAdminClient();
      for (const item of items) {
        const { criterion_key: _criterionKey, evidence_ids, ...row } = item;
        const { data: existing } = await supabase
          .from("recommendations")
          .select("id")
          .eq("audit_id", auditId)
          .eq("title", item.title)
          .maybeSingle();

        if (existing) {
          await linkRecommendationEvidence(
            supabase,
            existing.id,
            evidence_ids ?? [],
          );
          continue;
        }

        const { data, error } = await supabase
          .from("recommendations")
          .insert({
            audit_id: auditId,
            report_revision_id: reportRevisionId,
            ...row,
            evidence_ids: evidence_ids ?? [],
          })
          .select("id")
          .single();
        if (error && !isUniqueViolation(error)) {
          throw new Error(`Failed to insert recommendation: ${error.message}`);
        }
        if (data?.id) {
          await linkRecommendationEvidence(
            supabase,
            data.id,
            evidence_ids ?? [],
          );
        }
      }
    },

    async recordEvent(auditId, eventType, eventData) {
      const supabase = createAdminClient();
      const { error } = await supabase.from("audit_events").insert({
        audit_id: auditId,
        event_type: eventType,
        event_data: eventData,
      });
      if (error) {
        throw new Error(`Failed to insert audit event: ${error.message}`);
      }
    },

    async claimWorkflow(auditId) {
      const supabase = createAdminClient();
      const { error } = await supabase.from("audit_events").insert({
        audit_id: auditId,
        event_type: WORKFLOW_STARTED_EVENT,
        event_data: { claimed_at: new Date().toISOString() },
      });

      if (isUniqueViolation(error)) return false;
      if (error) {
        throw new Error(`Failed to claim workflow: ${error.message}`);
      }
      return true;
    },

    async releaseWorkflowClaim(auditId) {
      const supabase = createAdminClient();
      await supabase
        .from("audit_events")
        .delete()
        .eq("audit_id", auditId)
        .eq("event_type", WORKFLOW_STARTED_EVENT);
    },
  };
}

export function hashIdempotencyKey(key: string): string {
  return hmacSha256(`idempotency:${key}`);
}

export function createMemoryAuditStore(
  seed: AuditRecord[] = [],
): AuditWorkflowStore & {
  audits: Map<string, AuditRecord>;
  transitions: Array<StateTransitionRow & { auditId: string }>;
  criteria: Array<CriterionInput & { auditId: string }>;
  pillars: Array<PillarInput & { auditId: string }>;
  pages: Array<PageInput & { auditId: string; id: string }>;
  evidence: Array<EvidenceInput & { auditId: string; id: string }>;
  artifacts: Array<ArtifactInput & { id: string }>;
  events: Array<{
    auditId: string;
    event_type: string;
    event_data: Record<string, unknown>;
  }>;
  reports: Array<ReportInput & { id: string; auditId: string }>;
  recommendations: Array<
    RecommendationInput & { auditId: string; id: string }
  >;
  recommendationEvidence: Array<{
    recommendationId: string;
    evidenceId: string;
  }>;
  workflowClaims: Set<string>;
} {
  const audits = new Map(seed.map((audit) => [audit.id, { ...audit }]));
  const transitions: Array<StateTransitionRow & { auditId: string }> = [];
  const pages: Array<PageInput & { auditId: string; id: string }> = [];
  const evidence: Array<EvidenceInput & { auditId: string; id: string }> = [];
  const artifacts: Array<ArtifactInput & { id: string }> = [];
  const events: Array<{
    auditId: string;
    event_type: string;
    event_data: Record<string, unknown>;
  }> = [];
  const criteria: Array<CriterionInput & { auditId: string }> = [];
  const pillars: Array<PillarInput & { auditId: string }> = [];
  const reports: Array<ReportInput & { id: string; auditId: string }> = [];
  const recommendations: Array<
    RecommendationInput & { auditId: string; id: string }
  > = [];
  const recommendationEvidence: Array<{
    recommendationId: string;
    evidenceId: string;
  }> = [];
  const workflowClaims = new Set<string>();

  return {
    audits,
    transitions,
    criteria,
    pillars,
    pages,
    evidence,
    artifacts,
    events,
    reports,
    recommendations,
    recommendationEvidence,
    workflowClaims,
    async getAudit(auditId) {
      return audits.get(auditId) ?? null;
    },
    async recordTransition(auditId, fromState, toState) {
      if (transitions.some((row) => row.auditId === auditId && row.to_state === toState)) {
        return "exists";
      }
      transitions.push({
        auditId,
        from_state: fromState,
        to_state: toState,
        transitioned_at: new Date().toISOString(),
      });
      const audit = audits.get(auditId);
      if (audit) audit.current_state = toState;
      return "inserted";
    },
    async listTransitions(auditId) {
      return transitions
        .filter((row) => row.auditId === auditId)
        .map(({ from_state, to_state, transitioned_at }) => ({
          from_state,
          to_state,
          transitioned_at,
        }));
    },
    async upsertPages(auditId, items) {
      for (const page of items) {
        const index = pages.findIndex(
          (row) => row.auditId === auditId && row.url === page.url,
        );
        const id =
          index >= 0 ? pages[index].id : `page-${auditId}-${page.page_type}`;
        if (index >= 0) pages[index] = { ...page, auditId, id };
        else pages.push({ ...page, auditId, id });
      }
    },
    async findPage(auditId, pageType) {
      const page = pages.find(
        (row) => row.auditId === auditId && row.page_type === pageType,
      );
      if (!page) return null;
      return {
        id: page.id,
        url: page.url,
        page_type: page.page_type,
        metadata: page.metadata,
      };
    },
    async mergePageMetadata(auditId, pageId, patch) {
      const page = pages.find(
        (row) => row.auditId === auditId && row.id === pageId,
      );
      if (!page) return;
      page.metadata = { ...(page.metadata ?? {}), ...patch };
    },
    async insertArtifact(input) {
      const existing = artifacts.find(
        (row) => row.storage_key === input.storage_key,
      );
      if (existing) return existing.id;
      const created = { ...input, id: `artifact-${artifacts.length + 1}` };
      artifacts.push(created);
      return created.id;
    },
    async hasEvidence(auditId, mockKey) {
      return evidence.some(
        (row) => row.auditId === auditId && row.mock_key === mockKey,
      );
    },
    async upsertEvidence(auditId, items) {
      const ids: string[] = [];
      for (const item of items) {
        const existing = evidence.find(
          (row) => row.auditId === auditId && row.mock_key === item.mock_key,
        );
        if (existing) {
          ids.push(existing.id);
          continue;
        }
        const created = {
          ...item,
          auditId,
          id: `evidence-${auditId}-${item.mock_key}`,
        };
        evidence.push(created);
        ids.push(created.id);
      }
      return ids;
    },
    async upsertCriteria(auditId, items) {
      for (const item of items) {
        const index = criteria.findIndex(
          (row) =>
            row.auditId === auditId && row.criterion_key === item.criterion_key,
        );
        if (index >= 0) criteria[index] = { ...item, auditId };
        else criteria.push({ ...item, auditId });
      }
    },
    async listCriteria(auditId) {
      return criteria
        .filter((row) => row.auditId === auditId)
        .map(({ auditId: _auditId, ...row }) => row);
    },
    async upsertPillars(auditId, items) {
      for (const item of items) {
        const index = pillars.findIndex(
          (row) => row.auditId === auditId && row.pillar_key === item.pillar_key,
        );
        if (index >= 0) pillars[index] = { ...item, auditId };
        else pillars.push({ ...item, auditId });
      }
    },
    async listPillars(auditId) {
      return pillars
        .filter((row) => row.auditId === auditId)
        .map(({ auditId: _auditId, ...row }) => row);
    },
    async upsertReport(auditId, report) {
      const existing = reports.find((row) => row.auditId === auditId);
      if (existing) {
        Object.assign(existing, report);
        return existing.id;
      }
      const created = { ...report, id: `report-${auditId}`, auditId };
      reports.push(created);
      return created.id;
    },
    async upsertRecommendations(auditId, _reportRevisionId, items) {
      for (const item of items) {
        const existing = recommendations.find(
          (row) => row.auditId === auditId && row.title === item.title,
        );
        if (existing) {
          for (const evidenceId of item.evidence_ids ?? []) {
            if (
              !recommendationEvidence.some(
                (row) =>
                  row.recommendationId === existing.id &&
                  row.evidenceId === evidenceId,
              )
            ) {
              recommendationEvidence.push({
                recommendationId: existing.id,
                evidenceId,
              });
            }
          }
          continue;
        }
        const created = {
          ...item,
          auditId,
          id: `rec-${auditId}-${item.sort_order}`,
        };
        recommendations.push(created);
        for (const evidenceId of item.evidence_ids ?? []) {
          recommendationEvidence.push({
            recommendationId: created.id,
            evidenceId,
          });
        }
      }
    },
    async recordEvent(auditId, eventType, eventData) {
      events.push({
        auditId,
        event_type: eventType,
        event_data: eventData,
      });
    },
    async claimWorkflow(auditId) {
      if (workflowClaims.has(auditId)) return false;
      workflowClaims.add(auditId);
      return true;
    },
    async releaseWorkflowClaim(auditId) {
      workflowClaims.delete(auditId);
    },
  };
}
