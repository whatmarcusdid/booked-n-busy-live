import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import {
  createSupabaseRetentionStore,
  runArtifactPurge,
  runStructuredDataPurge,
} from "@/lib/retention/purge";

const LOCAL_URL = "http://127.0.0.1:54321";
const LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const OLD = "2024-01-01T00:00:00.000Z";
const RECENT = "2026-09-10T00:00:00.000Z";
/** Cutoff ~ 2025-04-28 — old 2024 rows match, 2026 local fixtures do not. */
const DAYS = 500;

describe("retention purge against local Supabase", () => {
  const supabase = createClient(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  it("adds artifacts.created_at and retention_purge_runs in the migration", () => {
    const sql = readFileSync(
      "supabase/migrations/20260910020000_retention_purge.sql",
      "utf8",
    );
    expect(sql).toContain("ALTER TABLE artifacts");
    expect(sql).toContain("created_at");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS retention_purge_runs");
    expect(sql).toContain("'artifacts'");
    expect(sql).toContain("'structured_data'");
    expect(sql).not.toMatch(/DELETE FROM (criterion_results|pillar_results|leads|meetings|admin_reviews)/);
  });

  async function seedAudit() {
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .insert({
        email_hash: `ret-email-${randomUUID()}`,
        first_name: "Retention",
        business_name: "Retention Co",
      })
      .select("id")
      .single();
    if (leadError || !lead) {
      throw new Error(
        `Local Supabase is required for this test: ${leadError?.message ?? "no lead"}`,
      );
    }

    const { data: audit, error: auditError } = await supabase
      .from("audits")
      .insert({
        lead_id: lead.id,
        website_url: "https://example.com",
        business_name: "Retention Co",
        current_state: "submitted",
        public_status_token_hash: `ret-tok-${randomUUID()}`,
      })
      .select("id")
      .single();
    if (auditError || !audit) {
      throw new Error(
        `Local Supabase is required for this test: ${auditError?.message ?? "no audit"}`,
      );
    }
    return { leadId: lead.id as string, auditId: audit.id as string };
  }

  it("deletes old artifacts and keeps recent ones, then no-ops on a second run", async () => {
    const { auditId } = await seedAudit();
    const oldKey = `audits/${auditId}/old.png`;
    const newKey = `audits/${auditId}/new.png`;

    const { error: insertError } = await supabase.from("artifacts").insert([
      {
        audit_id: auditId,
        storage_key: oldKey,
        mime_type: "image/png",
        size: 10,
        checksum: "old",
        viewport: "desktop",
        created_at: OLD,
      },
      {
        audit_id: auditId,
        storage_key: newKey,
        mime_type: "image/png",
        size: 10,
        checksum: "new",
        viewport: "desktop",
        created_at: RECENT,
      },
    ]);
    if (insertError) {
      throw new Error(
        `Local Supabase is required for this test: ${insertError.message}`,
      );
    }

    const store = createSupabaseRetentionStore(supabase);
    const removed: string[] = [];
    const objects = {
      async remove(keys: string[]) {
        removed.push(...keys);
        return { removed: keys.length, failed: 0 };
      },
    };

    const first = await runArtifactPurge({
      store,
      objects,
      days: DAYS,
      now: NOW,
    });
    expect(first.status).toBe("success");
    expect(first.rowsDeleted).toBeGreaterThanOrEqual(1);
    expect(removed).toContain(oldKey);

    const { data: remaining } = await supabase
      .from("artifacts")
      .select("storage_key")
      .eq("audit_id", auditId);
    expect(remaining?.map((row) => row.storage_key)).toEqual([newKey]);

    const second = await runArtifactPurge({
      store,
      objects,
      days: DAYS,
      now: NOW,
    });
    expect(second.status).toBe("success");
    expect(second.rowsDeleted).toBe(0);

    const { data: runs } = await supabase
      .from("retention_purge_runs")
      .select("id, rows_deleted, status")
      .eq("job_name", "artifacts")
      .eq("status", "success");
    expect(runs?.length).toBeGreaterThanOrEqual(2);
    expect(runs?.some((run) => run.rows_deleted === 0)).toBe(true);
    expect(runs?.some((run) => (run.rows_deleted ?? 0) >= 1)).toBe(true);
  });

  it("deletes old structured rows and never touches scores, leads, or admin notes", async () => {
    const { leadId, auditId } = await seedAudit();

    const { error: seedError } = await supabase.from("evidence").insert({
      audit_id: auditId,
      evidence_type: "screenshot",
      description: "old evidence",
      created_at: OLD,
    });
    if (seedError) {
      throw new Error(
        `Local Supabase is required for this test: ${seedError.message}`,
      );
    }

    await supabase.from("evidence").insert({
      audit_id: auditId,
      evidence_type: "screenshot",
      description: "recent evidence",
      created_at: RECENT,
    });

    const { data: oldRevision, error: revError } = await supabase
      .from("report_revisions")
      .insert({
        audit_id: auditId,
        revision_number: 1,
        overall_score: 0.5,
        publication_status: "published",
        created_at: OLD,
      })
      .select("id")
      .single();
    if (revError || !oldRevision) {
      throw new Error(
        `Local Supabase is required for this test: ${revError?.message ?? "no revision"}`,
      );
    }

    await supabase.from("recommendations").insert({
      audit_id: auditId,
      report_revision_id: oldRevision.id,
      priority: "high",
      title: "Fix CTA",
      description: "Add one",
      pillar: "lead_conversion",
      created_at: OLD,
    });

    await supabase.from("audit_state_transitions").insert({
      audit_id: auditId,
      to_state: "complete",
      transitioned_at: OLD,
    });
    await supabase.from("audit_events").insert({
      audit_id: auditId,
      event_type: "report_published",
      created_at: OLD,
    });

    const { error: criterionError } = await supabase.from("criterion_results").insert({
      audit_id: auditId,
      criterion_key: "cta_above_fold",
      criterion_name: "CTA",
      pillar: "lead_conversion",
      score: 0.5,
      weight: 1,
      created_at: OLD,
    });
    if (criterionError) {
      throw new Error(
        `Local Supabase is required for this test: ${criterionError.message}`,
      );
    }
    const { error: pillarError } = await supabase.from("pillar_results").insert({
      audit_id: auditId,
      pillar_key: "lead_conversion",
      pillar_name: "Lead Conversion",
      score: 0.5,
      criteria_count: 1,
      created_at: OLD,
    });
    if (pillarError) {
      throw new Error(
        `Local Supabase is required for this test: ${pillarError.message}`,
      );
    }
    const { error: reviewError } = await supabase.from("admin_reviews").insert({
      audit_id: auditId,
      decision: "approve",
      note: "keep forever",
      reviewer_email_hash: `ret-admin-${randomUUID()}`,
      created_at: OLD,
    });
    if (reviewError) {
      throw new Error(
        `Local Supabase is required for this test: ${reviewError.message}`,
      );
    }

    const store = createSupabaseRetentionStore(supabase);
    const result = await runStructuredDataPurge({
      store,
      days: DAYS,
      now: NOW,
    });
    expect(result.status).toBe("success");
    expect(result.rowsDeleted).toBeGreaterThanOrEqual(4);

    const { count: evidenceCount } = await supabase
      .from("evidence")
      .select("id", { count: "exact", head: true })
      .eq("audit_id", auditId);
    expect(evidenceCount).toBe(1);

    const { count: revisionCount } = await supabase
      .from("report_revisions")
      .select("id", { count: "exact", head: true })
      .eq("audit_id", auditId);
    expect(revisionCount).toBe(0);

    const { count: recCount } = await supabase
      .from("recommendations")
      .select("id", { count: "exact", head: true })
      .eq("audit_id", auditId);
    expect(recCount).toBe(0);

    const { count: criterionCount } = await supabase
      .from("criterion_results")
      .select("id", { count: "exact", head: true })
      .eq("audit_id", auditId);
    expect(criterionCount).toBe(1);

    const { count: pillarCount } = await supabase
      .from("pillar_results")
      .select("id", { count: "exact", head: true })
      .eq("audit_id", auditId);
    expect(pillarCount).toBe(1);

    const { count: leadCount } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("id", leadId);
    expect(leadCount).toBe(1);

    const { count: reviewCount } = await supabase
      .from("admin_reviews")
      .select("id", { count: "exact", head: true })
      .eq("audit_id", auditId);
    expect(reviewCount).toBe(1);

    const zero = await runStructuredDataPurge({
      store,
      days: DAYS,
      now: NOW,
    });
    expect(zero.status).toBe("success");
    expect(zero.rowsDeleted).toBe(0);
  });
});
