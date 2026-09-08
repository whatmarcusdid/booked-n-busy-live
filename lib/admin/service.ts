import { createAdminClient } from "../supabase/admin";
import { publishReportRevision } from "../reports/publication";
import type { AssembledReport } from "../reports/schema";
import { validateReportForPublication } from "../reports/publication";
import { hashAdminEmail, hashMagicLinkToken, issueMagicLinkToken } from "./auth";
import type { TransactionalEmailProvider } from "../email/provider";

export interface AdminAuditSummary {
  id: string;
  websiteUrl: string;
  businessName: string;
  currentState: string;
  publicationStatus: string | null;
  createdAt: string;
}

export interface AdminReviewInput {
  decision: "approve" | "reject" | "needs_changes";
  note?: string;
  expectedRevisionNumber?: number;
}

export interface AdminStore {
  insertMagicLink(input: {
    emailHash: string;
    tokenHash: string;
    expiresAt: string;
  }): Promise<void>;
  consumeMagicLink(tokenHash: string, now: Date): Promise<{ emailHash: string } | null>;
  listAudits(input: {
    q?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: AdminAuditSummary[]; total: number }>;
  getAudit(id: string): Promise<Record<string, unknown> | null>;
  currentRevisionNumber(auditId: string): Promise<number | null>;
  insertReview(input: {
    auditId: string;
    decision: string;
    note: string | null;
    reviewerEmailHash: string;
  }): Promise<string>;
  insertRevision(input: {
    auditId: string;
    revisionNumber: number;
    assembled: AssembledReport;
    executiveSummary: string;
    overallScore: number | null;
  }): Promise<string>;
  revoke(auditId: string, expectedRevisionNumber?: number): Promise<"updated" | "conflict" | "missing">;
  recordEvent(
    auditId: string,
    eventType: string,
    eventData: Record<string, unknown>,
  ): Promise<void>;
}

export function createSupabaseAdminStore(): AdminStore {
  return {
    async insertMagicLink(input) {
      const supabase = createAdminClient();
      const { error } = await supabase.from("admin_magic_links").insert({
        email_hash: input.emailHash,
        token_hash: input.tokenHash,
        expires_at: input.expiresAt,
      });
      if (error) throw new Error(`Failed to insert magic link: ${error.message}`);
    },
    async consumeMagicLink(tokenHash, now) {
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("admin_magic_links")
        .select("email_hash, expires_at, used_at")
        .eq("token_hash", tokenHash)
        .maybeSingle();
      if (!data || data.used_at || new Date(data.expires_at) <= now) return null;
      const { data: updated } = await supabase
        .from("admin_magic_links")
        .update({ used_at: now.toISOString() })
        .eq("token_hash", tokenHash)
        .is("used_at", null)
        .select("email_hash")
        .maybeSingle();
      return updated ? { emailHash: updated.email_hash } : null;
    },
    async listAudits(input) {
      const supabase = createAdminClient();
      let query = supabase
        .from("audits")
        .select("id, website_url, business_name, current_state, created_at", {
          count: "exact",
        })
        .order("created_at", { ascending: false })
        .range(input.offset, input.offset + input.limit - 1);
      if (input.q) {
        query = query.or(
          `business_name.ilike.%${input.q}%,website_url.ilike.%${input.q}%`,
        );
      }
      const { data, count, error } = await query;
      if (error) throw new Error(`Failed to list audits: ${error.message}`);
      const items: AdminAuditSummary[] = [];
      for (const row of data ?? []) {
        const { data: report } = await supabase
          .from("report_revisions")
          .select("publication_status")
          .eq("audit_id", row.id)
          .order("revision_number", { ascending: false })
          .limit(1)
          .maybeSingle();
        items.push({
          id: row.id,
          websiteUrl: row.website_url,
          businessName: row.business_name,
          currentState: row.current_state,
          publicationStatus: report?.publication_status ?? null,
          createdAt: row.created_at,
        });
      }
      return { items, total: count ?? items.length };
    },
    async getAudit(id) {
      const supabase = createAdminClient();
      const { data: audit } = await supabase
        .from("audits")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (!audit) return null;
      const [pages, evidence, criteria, pillars, reports, events, transitions] =
        await Promise.all([
          supabase.from("audit_pages").select("*").eq("audit_id", id),
          supabase.from("evidence").select("*").eq("audit_id", id),
          supabase.from("criterion_results").select("*").eq("audit_id", id),
          supabase.from("pillar_results").select("*").eq("audit_id", id),
          supabase
            .from("report_revisions")
            .select("*")
            .eq("audit_id", id)
            .order("revision_number", { ascending: false }),
          supabase.from("audit_events").select("*").eq("audit_id", id),
          supabase.from("audit_state_transitions").select("*").eq("audit_id", id),
        ]);
      return {
        audit,
        pages: pages.data ?? [],
        evidence: evidence.data ?? [],
        criteria: criteria.data ?? [],
        pillars: pillars.data ?? [],
        reports: reports.data ?? [],
        events: events.data ?? [],
        transitions: transitions.data ?? [],
      };
    },
    async currentRevisionNumber(auditId) {
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("report_revisions")
        .select("revision_number")
        .eq("audit_id", auditId)
        .order("revision_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.revision_number ?? null;
    },
    async insertReview(input) {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from("admin_reviews")
        .insert({
          audit_id: input.auditId,
          decision: input.decision,
          note: input.note,
          reviewer_email_hash: input.reviewerEmailHash,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to insert review: ${error?.message}`);
      }
      return data.id;
    },
    async insertRevision(input) {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from("report_revisions")
        .insert({
          audit_id: input.auditId,
          revision_number: input.revisionNumber,
          overall_score: input.overallScore,
          executive_summary: input.executiveSummary,
          publication_status: "review_required",
          metadata: { assembled: input.assembled, corrected: true },
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to insert revision: ${error?.message}`);
      }
      return data.id;
    },
    async revoke(auditId, expectedRevisionNumber) {
      const supabase = createAdminClient();
      let query = supabase
        .from("report_revisions")
        .update({
          publication_status: "revoked",
          public_report_token_hash: null,
        })
        .eq("audit_id", auditId)
        .eq("publication_status", "published");
      if (expectedRevisionNumber != null) {
        query = query.eq("revision_number", expectedRevisionNumber);
      }
      const { data, error } = await query.select("id").maybeSingle();
      if (error) throw new Error(`Failed to revoke report: ${error.message}`);
      if (!data) return expectedRevisionNumber != null ? "conflict" : "missing";
      return "updated";
    },
    async recordEvent(auditId, eventType, eventData) {
      const supabase = createAdminClient();
      await supabase.from("audit_events").insert({
        audit_id: auditId,
        event_type: eventType,
        event_data: eventData,
      });
    },
  };
}

export async function requestAdminMagicLink(input: {
  email: string;
  allowed: boolean;
  provider: TransactionalEmailProvider;
  store: Pick<AdminStore, "insertMagicLink">;
  origin: string;
  now?: Date;
}): Promise<void> {
  if (!input.allowed) return;
  const issued = issueMagicLinkToken();
  const now = input.now ?? new Date();
  await input.store.insertMagicLink({
    emailHash: hashAdminEmail(input.email),
    tokenHash: issued.tokenHash,
    expiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
  });
  await input.provider.send({
    to: input.email,
    subject: "Booked N Busy admin sign-in",
    text: `Sign in: ${input.origin}/api/v1/admin/auth/callback?token=${issued.token}`,
    html: `<p><a href="${input.origin}/api/v1/admin/auth/callback?token=${issued.token}">Sign in</a></p>`,
    idempotencyKey: `admin-login:${issued.tokenHash}`,
  });
}

export async function consumeAdminMagicLink(
  token: string,
  store: Pick<AdminStore, "consumeMagicLink">,
  now: Date = new Date(),
): Promise<{ emailHash: string } | null> {
  return store.consumeMagicLink(hashMagicLinkToken(token), now);
}

export async function publishAdminReport(input: {
  auditId: string;
  reviewerEmail: string;
  expectedRevisionNumber?: number;
  store: AdminStore;
}): Promise<
  | { ok: true; token: string; expiresAt: string }
  | { ok: false; error: string; status: number }
> {
  const current = await input.store.currentRevisionNumber(input.auditId);
  if (current == null) {
    return { ok: false, error: "Report not found", status: 404 };
  }
  if (
    input.expectedRevisionNumber != null &&
    input.expectedRevisionNumber !== current
  ) {
    return { ok: false, error: "Revision conflict", status: 409 };
  }
  const published = await publishReportRevision({ auditId: input.auditId });
  if (!published.ok) {
    return { ok: false, error: published.errors.join(" "), status: 400 };
  }
  await input.store.recordEvent(input.auditId, "admin_published", {
    reviewer_email_hash: hashAdminEmail(input.reviewerEmail),
    revision_id: published.revisionId,
  });
  return { ok: true, token: published.token, expiresAt: published.expiresAt };
}

export { validateReportForPublication };
