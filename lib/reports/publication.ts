import { createAdminClient } from "../supabase/admin";
import { assembledReportSchema, type AssembledReport } from "./schema";
import {
  issueReportToken,
  reportTokenExpiresAt,
} from "./tokens";

export interface PublicationValidation {
  ok: boolean;
  errors: string[];
}

/**
 * Structural + honesty checks before a report may be published.
 * Passing this does NOT publish. Only publishReportRevision() does that.
 */
export function validateReportForPublication(
  report: AssembledReport | null | undefined,
): PublicationValidation {
  const errors: string[] = [];
  if (!report) {
    return { ok: false, errors: ["Report is missing."] };
  }

  const parsed = assembledReportSchema.safeParse(report);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      ),
    };
  }

  const value = parsed.data;
  const fixFirst = value.recommendations.filter(
    (row) => row.priority === "fix_first",
  );
  if (fixFirst.length > 1) {
    errors.push("Only one recommendation may be fix_first.");
  }
  if (value.recommendations.length === 0 && !value.noMajorIssues) {
    errors.push("Zero recommendations must be marked noMajorIssues.");
  }
  if (value.recommendations.length > 0 && value.noMajorIssues) {
    errors.push("noMajorIssues cannot be true when recommendations exist.");
  }
  if (value.recommendations.length > 3) {
    errors.push("At most three recommendations may be published.");
  }

  for (const pillar of value.pillars) {
    if (pillar.assessedCount === 0) {
      if (pillar.score != null || pillar.display !== "not_measured") {
        errors.push(
          `Pillar ${pillar.key} has no assessed checks and must be not_measured.`,
        );
      }
    }
    if (pillar.score == null && pillar.display !== "not_measured") {
      errors.push(`Pillar ${pillar.key} has a null score but is not marked not_measured.`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export interface PublicationRecord {
  id: string;
  audit_id: string;
  publication_status: string;
  assembled: AssembledReport | null;
}

export interface PublicationStore {
  loadRevision(
    auditId: string,
    revisionId?: string,
  ): Promise<PublicationRecord | null>;
  markPublished(input: {
    revisionId: string;
    tokenHash: string;
    publishedAt: string;
    expiresAt: string;
    expectedStatus: string;
  }): Promise<"updated" | "conflict" | "missing">;
}

export function createSupabasePublicationStore(): PublicationStore {
  return {
    async loadRevision(auditId, revisionId) {
      const supabase = createAdminClient();
      let query = supabase
        .from("report_revisions")
        .select("id, audit_id, publication_status, metadata")
        .eq("audit_id", auditId)
        .order("revision_number", { ascending: false })
        .limit(1);
      if (revisionId) {
        query = supabase
          .from("report_revisions")
          .select("id, audit_id, publication_status, metadata")
          .eq("audit_id", auditId)
          .eq("id", revisionId)
          .limit(1);
      }
      const { data, error } = await query.maybeSingle();
      if (error || !data) return null;
      const metadata = (data.metadata ?? {}) as { assembled?: AssembledReport };
      return {
        id: data.id,
        audit_id: data.audit_id,
        publication_status: data.publication_status,
        assembled: metadata.assembled ?? null,
      };
    },
    async markPublished(input) {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from("report_revisions")
        .update({
          publication_status: "published",
          published_at: input.publishedAt,
          public_report_token_hash: input.tokenHash,
          public_report_token_expires_at: input.expiresAt,
        })
        .eq("id", input.revisionId)
        .eq("publication_status", input.expectedStatus)
        .select("id")
        .maybeSingle();
      if (error) {
        throw new Error(`Failed to publish report: ${error.message}`);
      }
      if (!data) return "conflict";
      return "updated";
    },
  };
}

export type PublishResult =
  | { ok: true; token: string; expiresAt: string; revisionId: string }
  | { ok: false; errors: string[] };

/**
 * The only function that may set publication_status to published.
 * Do not call this from the audit workflow.
 */
export async function publishReportRevision(input: {
  auditId: string;
  revisionId?: string;
  now?: Date;
  store?: PublicationStore;
}): Promise<PublishResult> {
  const store = input.store ?? createSupabasePublicationStore();
  const now = input.now ?? new Date();
  const revision = await store.loadRevision(input.auditId, input.revisionId);
  if (!revision) {
    return { ok: false, errors: ["Report revision not found."] };
  }
  if (revision.publication_status === "published") {
    return { ok: false, errors: ["Report is already published."] };
  }
  if (revision.publication_status === "revoked") {
    return { ok: false, errors: ["Revoked reports cannot be published."] };
  }

  const validation = validateReportForPublication(revision.assembled);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }

  const issued = issueReportToken();
  const expires = reportTokenExpiresAt(now);
  const marked = await store.markPublished({
    revisionId: revision.id,
    tokenHash: issued.tokenHash,
    publishedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    expectedStatus: revision.publication_status,
  });
  if (marked !== "updated") {
    return { ok: false, errors: ["Publish conflict. Reload and try again."] };
  }

  return {
    ok: true,
    token: issued.token,
    expiresAt: expires.toISOString(),
    revisionId: revision.id,
  };
}
