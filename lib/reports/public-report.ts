import { createAdminClient } from "../supabase/admin";
import { hashReportToken, isReportExpired } from "./tokens";

/**
 * Same body for every miss: unknown token, unpublished, revoked, expired,
 * review_required, or approved-but-not-published. Callers must not add a
 * distinguishing error code.
 */
export const REPORT_NOT_AVAILABLE_BODY = {
  error: "Report not available",
} as const;

export const REPORT_NOT_AVAILABLE_STATUS = 404;

export interface PublicReportPillar {
  key: string;
  name: string;
  score: number | null;
  measured: boolean;
  criteriaCount: number;
}

export interface PublicReportRecommendation {
  priority: string;
  title: string;
  description: string;
  pillar: string;
}

export interface PublicReport {
  websiteUrl: string;
  businessName: string;
  overallScore: number | null;
  executiveSummary: string;
  publicationStatus: "published";
  publishedAt: string;
  expiresAt: string | null;
  pillars: PublicReportPillar[];
  recommendations: PublicReportRecommendation[];
}

export type GetPublicReportResult =
  | { ok: true; report: PublicReport }
  | { ok: false };

export interface PublicReportLookupRow {
  publication_status: string;
  published_at: string | null;
  public_report_token_expires_at: string | null;
  overall_score: number | null;
  executive_summary: string | null;
  website_url: string;
  business_name: string;
  pillars: PublicReportPillar[];
  recommendations: PublicReportRecommendation[];
}

export interface PublicReportStore {
  findByTokenHash(tokenHash: string): Promise<PublicReportLookupRow | null>;
}

export function projectPublicReport(
  row: PublicReportLookupRow,
  now: Date = new Date(),
): GetPublicReportResult {
  if (row.publication_status !== "published") {
    return { ok: false };
  }
  if (isReportExpired(row, now)) {
    return { ok: false };
  }
  if (!row.published_at) {
    return { ok: false };
  }
  return {
    ok: true,
    report: {
      websiteUrl: row.website_url,
      businessName: row.business_name,
      overallScore: row.overall_score,
      executiveSummary: row.executive_summary ?? "",
      publicationStatus: "published",
      publishedAt: row.published_at,
      expiresAt: row.public_report_token_expires_at,
      pillars: row.pillars.map((pillar) => ({
        ...pillar,
        measured: pillar.score != null,
      })),
      recommendations: row.recommendations,
    },
  };
}

export function createSupabasePublicReportStore(): PublicReportStore {
  return {
    async findByTokenHash(tokenHash) {
      const supabase = createAdminClient();
      const { data: revision, error } = await supabase
        .from("report_revisions")
        .select(
          "id, audit_id, overall_score, executive_summary, publication_status, published_at, public_report_token_expires_at",
        )
        .eq("public_report_token_hash", tokenHash)
        .maybeSingle();

      if (error || !revision) return null;

      const { data: audit } = await supabase
        .from("audits")
        .select("website_url, business_name")
        .eq("id", revision.audit_id)
        .maybeSingle();

      if (!audit) return null;

      const { data: pillars } = await supabase
        .from("pillar_results")
        .select("pillar_key, pillar_name, score, criteria_count")
        .eq("audit_id", revision.audit_id)
        .order("pillar_key");

      const { data: recommendations } = await supabase
        .from("recommendations")
        .select("priority, title, description, pillar")
        .eq("report_revision_id", revision.id)
        .order("sort_order");

      return {
        publication_status: revision.publication_status,
        published_at: revision.published_at,
        public_report_token_expires_at: revision.public_report_token_expires_at,
        overall_score:
          revision.overall_score == null ? null : Number(revision.overall_score),
        executive_summary: revision.executive_summary,
        website_url: audit.website_url,
        business_name: audit.business_name,
        pillars: (pillars ?? []).map((pillar) => ({
          key: pillar.pillar_key,
          name: pillar.pillar_name,
          score: pillar.score == null ? null : Number(pillar.score),
          measured: pillar.score != null,
          criteriaCount: pillar.criteria_count,
        })),
        recommendations: (recommendations ?? []).map((row) => ({
          priority: row.priority,
          title: row.title,
          description: row.description,
          pillar: row.pillar,
        })),
      };
    },
  };
}

export async function getPublicReport(
  token: string,
  store: PublicReportStore = createSupabasePublicReportStore(),
  now: Date = new Date(),
): Promise<GetPublicReportResult> {
  if (!token) return { ok: false };
  const row = await store.findByTokenHash(hashReportToken(token));
  if (!row) return { ok: false };
  return projectPublicReport(row, now);
}
