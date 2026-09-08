import { sha256Hex } from "@/lib/crypto";
import {
  getPublicReport,
  projectPublicReport,
  REPORT_NOT_AVAILABLE_BODY,
  type PublicReportLookupRow,
  type PublicReportStore,
} from "@/lib/reports/public-report";
import { issueReportToken, isReportExpired } from "@/lib/reports/tokens";

function row(
  overrides: Partial<PublicReportLookupRow> = {},
): PublicReportLookupRow {
  return {
    publication_status: "published",
    published_at: "2026-09-01T00:00:00.000Z",
    public_report_token_expires_at: "2026-10-01T00:00:00.000Z",
    overall_score: 0.8,
    executive_summary: "Summary",
    website_url: "https://example.com",
    business_name: "Example",
    pillars: [
      {
        key: "trust_signals",
        name: "Trust Signals",
        score: 0.8,
        measured: true,
        criteriaCount: 4,
      },
    ],
    recommendations: [],
    ...overrides,
  };
}

function storeOf(record: PublicReportLookupRow | null): PublicReportStore {
  return {
    async findByTokenHash() {
      return record;
    },
  };
}

describe("public report token lookup", () => {
  const now = new Date("2026-09-08T00:00:00.000Z");

  it("returns the sanitized projection for a published unexpired token", () => {
    const result = projectPublicReport(row(), now);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.publicationStatus).toBe("published");
      expect(result.report.websiteUrl).toBe("https://example.com");
      expect(result.report).not.toHaveProperty("auditId");
      expect(result.report).not.toHaveProperty("tokenHash");
    }
  });

  it.each([
    "review_required",
    "approved",
    "revoked",
    "draft",
    "expired",
  ] as const)("refuses publication_status=%s", (status) => {
    expect(projectPublicReport(row({ publication_status: status }), now)).toEqual(
      { ok: false },
    );
  });

  it("refuses an expired token the same as an unknown one", async () => {
    const issued = issueReportToken();
    const expired = await getPublicReport(
      issued.token,
      storeOf(
        row({
          public_report_token_expires_at: "2026-09-01T00:00:00.000Z",
        }),
      ),
      now,
    );
    const missing = await getPublicReport(issued.token, storeOf(null), now);
    expect(expired).toEqual({ ok: false });
    expect(missing).toEqual({ ok: false });
    expect(REPORT_NOT_AVAILABLE_BODY).toEqual({ error: "Report not available" });
  });

  it("stores SHA-256(token), never the raw token", () => {
    const issued = issueReportToken();
    expect(issued.tokenHash).toBe(sha256Hex(issued.token));
    expect(issued.tokenHash).not.toBe(issued.token);
    expect(issued.token).not.toContain(issued.tokenHash);
  });

  it("treats missing published_at as expired", () => {
    expect(
      isReportExpired({
        published_at: null,
        public_report_token_expires_at: null,
      }),
    ).toBe(true);
  });

  it("renders an unmeasured pillar as score null, not 0", () => {
    const result = projectPublicReport(
      row({
        pillars: [
          {
            key: "lead_conversion",
            name: "Lead Conversion",
            score: null,
            measured: false,
            criteriaCount: 0,
          },
        ],
      }),
      now,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.pillars[0].score).toBeNull();
      expect(result.report.pillars[0].measured).toBe(false);
    }
  });
});
