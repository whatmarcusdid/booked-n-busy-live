import { assembleReport } from "@/lib/reports/assemble";
import {
  publishReportRevision,
  validateReportForPublication,
  type PublicationStore,
} from "@/lib/reports/publication";
import { getPublicReport } from "@/lib/reports/public-report";
import { hashReportToken } from "@/lib/reports/tokens";
import { GOOD_SHAPE_EXECUTIVE_SUMMARY } from "@/lib/audit-workflow/recommendations";
import { runAuditPipeline } from "@/lib/audit-workflow/pipeline";
import { createMemoryAuditStore } from "@/lib/audit-workflow/store";
import type { AssembledReport } from "@/lib/reports/schema";

function seed(auditId: string, url = "https://example.com") {
  return createMemoryAuditStore([
    { id: auditId, website_url: url, current_state: "submitted" },
  ]);
}

describe("validateReportForPublication + publishReportRevision", () => {
  it("accepts a no-major-issues assembled report", () => {
    const report = assembleReport({
      websiteUrl: "https://example.com",
      criteria: [],
      pillars: [],
      recommendations: [],
      executiveSummary: GOOD_SHAPE_EXECUTIVE_SUMMARY,
    });
    expect(validateReportForPublication(report)).toEqual({
      ok: true,
      errors: [],
    });
  });

  it("rejects a zero-assessed pillar that carries a numeric 0", () => {
    const report = assembleReport({
      websiteUrl: "https://example.com",
      criteria: [],
      pillars: [
        {
          pillar_key: "lead_conversion",
          pillar_name: "Lead Conversion",
          score: null,
          criteria_count: 0,
          summary: "none",
        },
      ],
      recommendations: [],
    });
    const tampered = {
      ...report,
      pillars: report.pillars.map((pillar) =>
        pillar.key === "lead_conversion"
          ? { ...pillar, score: 0, display: "score" as const, measured: true }
          : pillar,
      ),
    };
    const result = validateReportForPublication(tampered as AssembledReport);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/not_measured/);
  });

  it("lands generated reports at review_required and does not auto-publish", async () => {
    const auditId = "audit-review-required";
    const store = seed(auditId);
    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
    });
    expect(store.reports[0]?.publication_status).toBe("review_required");
    expect(store.reports[0]?.publication_status).not.toBe("published");
  });

  it("publishReportRevision is the only path to published and issues a hashed token", async () => {
    const auditId = "audit-publish";
    const store = seed(auditId);
    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
    });
    const assembled = store.reports[0]?.metadata?.assembled as AssembledReport;
    expect(validateReportForPublication(assembled).ok).toBe(true);

    let publishedHash: string | null = null;
    let publishedStatus = "review_required";
    const publicationStore: PublicationStore = {
      async loadRevision() {
        return {
          id: store.reports[0].id,
          audit_id: auditId,
          publication_status: publishedStatus,
          assembled,
        };
      },
      async markPublished(input) {
        if (publishedStatus !== input.expectedStatus) return "conflict";
        publishedStatus = "published";
        publishedHash = input.tokenHash;
        return "updated";
      },
    };

    const published = await publishReportRevision({
      auditId,
      store: publicationStore,
      now: new Date("2026-09-08T00:00:00.000Z"),
    });
    expect(published.ok).toBe(true);
    if (!published.ok) throw new Error("expected publish");
    expect(publishedHash).toBe(hashReportToken(published.token));
    expect(publishedHash).not.toBe(published.token);

    const stillReview = await getPublicReport(published.token, {
      async findByTokenHash() {
        return {
          publication_status: "review_required",
          published_at: "2026-09-08T00:00:00.000Z",
          public_report_token_expires_at: "2026-10-08T00:00:00.000Z",
          overall_score: 0.8,
          executive_summary: assembled.executiveSummary,
          website_url: "https://example.com",
          business_name: "Example",
          pillars: [],
          recommendations: [],
        };
      },
    });
    expect(stillReview).toEqual({ ok: false });
  });
});
