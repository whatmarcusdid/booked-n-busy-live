import { createAdminClient } from "../supabase/admin";
import {
  projectPublicReport,
  type PublicReport,
  type PublicReportLookupRow,
} from "./public-report";
import {
  hashReportToken,
  isReportExpired,
  isWithinRetention,
} from "./tokens";

/**
 * Report access resolution for the token-to-cookie exchange.
 *
 * This is deliberately separate from `getPublicReport`, which answers the
 * public JSON API and must stay indistinguishable across every kind of miss.
 * Here we do distinguish "expired" — but only for a token that actually
 * matched a stored hash, i.e. a link we really issued to this customer. A
 * guessed token still gets the generic answer, so the anti-enumeration
 * property survives while the expired-report experience becomes possible.
 */

export type ReportAccess =
  | { outcome: "granted"; tokenHash: string; report: PublicReport }
  | {
      outcome: "expired";
      tokenHash: string;
      /** Whether the data is still retained, deciding the re-request branch. */
      retained: boolean;
    }
  | { outcome: "unavailable" };

export interface ReportAccessRow extends PublicReportLookupRow {
  audit_created_at?: string | null;
}

export interface ReportAccessStore {
  findByTokenHash(tokenHash: string): Promise<ReportAccessRow | null>;
}

export async function resolveReportAccess(
  token: string,
  store: ReportAccessStore = createSupabaseReportAccessStore(),
  now: Date = new Date(),
): Promise<ReportAccess> {
  if (!token) return { outcome: "unavailable" };
  const tokenHash = hashReportToken(token);
  return await resolveReportAccessByHash(tokenHash, store, now);
}

/**
 * Cookie-bound access. A signed cookie proves we issued the link, so a
 * missing revision (12-month purge) is a fresh-scan case rather than the
 * generic unavailable dead-end used for guessed tokens.
 *
 * Revoked / unpublished rows still exist and stay `unavailable`.
 */
export async function resolveCookieReportAccess(
  tokenHash: string,
  store: ReportAccessStore = createSupabaseReportAccessStore(),
  now: Date = new Date(),
): Promise<ReportAccess> {
  return resolveReportAccessByHash(tokenHash, store, now, {
    onMissing: "purged",
  });
}

export async function resolveReportAccessByHash(
  tokenHash: string,
  store: ReportAccessStore = createSupabaseReportAccessStore(),
  now: Date = new Date(),
  options: { onMissing?: "unavailable" | "purged" } = {},
): Promise<ReportAccess> {
  const row = await store.findByTokenHash(tokenHash);
  if (!row) {
    if (options.onMissing === "purged") {
      return { outcome: "expired", tokenHash, retained: false };
    }
    return { outcome: "unavailable" };
  }

  // Revoked and never-published reports get the generic answer: those are
  // states the customer is not entitled to learn about.
  if (row.publication_status !== "published" || !row.published_at) {
    return { outcome: "unavailable" };
  }

  if (isReportExpired(row, now)) {
    return {
      outcome: "expired",
      tokenHash,
      retained: isWithinRetention(
        { published_at: row.published_at, created_at: row.audit_created_at },
        now,
      ),
    };
  }

  const projected = projectPublicReport(row, now);
  if (!projected.ok) return { outcome: "unavailable" };
  return { outcome: "granted", tokenHash, report: projected.report };
}

export function createSupabaseReportAccessStore(): ReportAccessStore {
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
        .select("website_url, business_name, created_at")
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
        audit_created_at: audit.created_at,
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
