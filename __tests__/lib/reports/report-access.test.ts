import { readFileSync } from "fs";
import { GET as exchange } from "@/app/report/[reportToken]/route";
import type { ReportAccessRow, ReportAccessStore } from "@/lib/reports/access";
import {
  readReportAccess,
  REPORT_ACCESS_COOKIE,
  REPORT_ACCESS_COOKIE_PATH,
  signReportAccess,
} from "@/lib/reports/access-cookie";
import { getPublicReport } from "@/lib/reports/public-report";
import { resolveReRequest } from "@/lib/reports/re-request";
import {
  hashReportToken,
  isWithinRetention,
  REPORT_RETENTION_MS,
  REPORT_TOKEN_TTL_MS,
} from "@/lib/reports/tokens";
import { hashEmail } from "@/lib/crypto";
import { NextRequest } from "next/server";

const TOKEN = "a".repeat(64);
const PUBLISHED_AT = "2026-01-01T00:00:00.000Z";

// The exchange route resolves access against Supabase. Mocked so the route's
// own behaviour — cookie shape and clean redirect — can be asserted without
// a database.
jest.mock("@/lib/reports/access", () => {
  const actual = jest.requireActual("@/lib/reports/access");
  return { ...actual, resolveReportAccess: jest.fn() };
});

const mockResolve = jest.requireMock("@/lib/reports/access")
  .resolveReportAccess as jest.Mock;

function row(overrides: Partial<ReportAccessRow> = {}): ReportAccessRow {
  return {
    publication_status: "published",
    published_at: PUBLISHED_AT,
    public_report_token_expires_at: "2026-01-31T00:00:00.000Z",
    overall_score: 0.72,
    executive_summary: "Solid foundation.",
    website_url: "https://acmeplumbing.com",
    business_name: "Acme Plumbing",
    audit_created_at: PUBLISHED_AT,
    pillars: [],
    recommendations: [],
    ...overrides,
  };
}

function store(value: ReportAccessRow | null): ReportAccessStore {
  return { async findByTokenHash() { return value; } };
}

function exchangeRequest(): NextRequest {
  return new NextRequest("http://localhost:3000/report/" + TOKEN);
}

async function runExchange(token: string) {
  return await exchange(exchangeRequest(), {
    params: Promise.resolve({ reportToken: token }),
  });
}

describe("token lifetime and retention are reconciled", () => {
  it("keeps the link window strictly inside the data window", () => {
    // The invariant that makes "a valid link pointing at purged data"
    // impossible. `tokens.ts` throws at import time if this inverts.
    expect(REPORT_TOKEN_TTL_MS).toBeLessThan(REPORT_RETENTION_MS);
    expect(REPORT_TOKEN_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(REPORT_RETENTION_MS).toBe(365 * 24 * 60 * 60 * 1000);
  });

  it("treats data as retained for a year from publication", () => {
    const justInside = new Date(
      Date.parse(PUBLISHED_AT) + REPORT_RETENTION_MS - 1,
    );
    const justOutside = new Date(Date.parse(PUBLISHED_AT) + REPORT_RETENTION_MS);
    expect(isWithinRetention({ published_at: PUBLISHED_AT }, justInside)).toBe(true);
    expect(isWithinRetention({ published_at: PUBLISHED_AT }, justOutside)).toBe(false);
  });

  it("a report whose link has expired is still within retention", () => {
    // The whole reason the re-send branch exists.
    const dayAfterLinkDies = new Date(
      Date.parse(PUBLISHED_AT) + REPORT_TOKEN_TTL_MS + 1,
    );
    expect(isWithinRetention({ published_at: PUBLISHED_AT }, dayAfterLinkDies)).toBe(true);
  });

  it("refuses to treat undated data as retained", () => {
    expect(isWithinRetention({}, new Date())).toBe(false);
    expect(isWithinRetention({ published_at: "not-a-date" })).toBe(false);
  });
});

describe("token-to-cookie exchange", () => {
  it("redirects to a clean URL with the raw token removed", async () => {
    mockResolve.mockResolvedValue({
      outcome: "granted",
      tokenHash: hashReportToken(TOKEN),
      report: {
        websiteUrl: "https://acmeplumbing.com",
        businessName: "Acme Plumbing",
        overallScore: 0.72,
        executiveSummary: "Solid foundation.",
        publicationStatus: "published",
        publishedAt: PUBLISHED_AT,
        expiresAt: null,
        pillars: [],
        recommendations: [],
      },
    });

    const response = await runExchange(TOKEN);
    const location = response.headers.get("location") ?? "";

    expect(response.status).toBe(303);
    expect(new URL(location).pathname).toBe("/report");
    expect(location).not.toContain(TOKEN);

  });

  it("sets an httpOnly cookie scoped to the report path", async () => {
    mockResolve.mockResolvedValue({
      outcome: "expired",
      tokenHash: hashReportToken(TOKEN),
      retained: true,
    });

    const response = await runExchange(TOKEN);
    const cookie = response.cookies.get(REPORT_ACCESS_COOKIE);

    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.path).toBe(REPORT_ACCESS_COOKIE_PATH);
    expect(cookie?.sameSite).toBe("lax");
    // The cookie carries the hash, never the raw token, so removing the
    // token from the URL is not undone by storing it in the browser.
    expect(cookie?.value).not.toContain(TOKEN);
    expect(readReportAccess(cookie?.value)?.tokenHash).toBe(
      hashReportToken(TOKEN),
    );

  });

  it("sets no cookie for a token that does not resolve", async () => {
    mockResolve.mockResolvedValue({ outcome: "unavailable" });

    const response = await runExchange("nope");
    expect(response.status).toBe(303);
    expect(response.cookies.get(REPORT_ACCESS_COOKIE)).toBeUndefined();

  });

  it("rejects a tampered cookie", () => {
    const valid = signReportAccess({ tokenHash: "abc", expired: false });
    expect(readReportAccess(valid)).toEqual({ tokenHash: "abc", expired: false });

    // Flipping the expired flag or the hash must invalidate the signature,
    // otherwise a visitor could grant themselves another report.
    expect(readReportAccess(valid.replace(".0.", ".1."))).toBeNull();
    expect(readReportAccess(`def.0.${valid.split(".")[2]}`)).toBeNull();
    expect(readReportAccess("garbage")).toBeNull();
    expect(readReportAccess(undefined)).toBeNull();
  });
});

describe("expired report resolution", () => {
  const afterExpiry = new Date("2026-02-15T00:00:00.000Z");
  // The real implementation, not the route-level mock above.
  const resolveReportAccess = jest.requireActual("@/lib/reports/access")
    .resolveReportAccess as typeof import("@/lib/reports/access").resolveReportAccess;

  it("distinguishes expired for a token we actually issued", async () => {
    const access = await resolveReportAccess(
      TOKEN,
      store(row()),
      afterExpiry,
    );
    expect(access.outcome).toBe("expired");
    if (access.outcome === "expired") expect(access.retained).toBe(true);
  });

  it("says only 'unavailable' for a token that matches nothing", async () => {
    const access = await resolveReportAccess(TOKEN, store(null), afterExpiry);
    expect(access).toEqual({ outcome: "unavailable" });
  });

  it("hides revoked and unpublished reports behind the generic answer", async () => {
    for (const status of ["revoked", "review_required", "draft", "approved"]) {
      const access = await resolveReportAccess(
        TOKEN,
        store(row({ publication_status: status })),
        afterExpiry,
      );
      expect(access).toEqual({ outcome: "unavailable" });
    }
  });

  it("reports data past retention as no longer retained", async () => {
    const access = await resolveReportAccess(
      TOKEN,
      store(row()),
      new Date(Date.parse(PUBLISHED_AT) + REPORT_RETENTION_MS + 1),
    );
    expect(access.outcome).toBe("expired");
    if (access.outcome === "expired") expect(access.retained).toBe(false);
  });

  it("leaves the public JSON API indistinguishable, as it was", async () => {
    // The exchange path distinguishes expired; the API must not.
    const expired = await getPublicReport(
      TOKEN,
      store(row()),
      afterExpiry,
    );
    const unknown = await getPublicReport(TOKEN, store(null), afterExpiry);
    expect(expired).toEqual({ ok: false });
    expect(unknown).toEqual({ ok: false });
  });
});

describe("re-request branches on retention, not on link age", () => {
  const EMAIL = "owner@acmeplumbing.com";
  const base = {
    auditId: "audit-1",
    leadId: "lead-1",
    websiteUrl: "https://acmeplumbing.com",
    reportRevisionId: "rev-1",
    leadEmailHash: hashEmail(EMAIL),
    publishedAt: PUBLISHED_AT,
    auditCreatedAt: PUBLISHED_AT,
  };

  const reRequestStore = (
    row: (Omit<typeof base, "reportRevisionId"> & {
      reportRevisionId: string | null;
    }) | null,
  ) => ({
    async findByReportTokenHash() { return row; },
    async findLatestByEmailHash() { return row; },
  });

  it("re-sends access when the data is still on file", async () => {
    const outcome = await resolveReRequest(
      { email: EMAIL, tokenHash: "hash" },
      reRequestStore(base),
      new Date(Date.parse(PUBLISHED_AT) + REPORT_TOKEN_TTL_MS + 1),
    );
    expect(outcome).toEqual({
      action: "resend",
      auditId: "audit-1",
      reportRevisionId: "rev-1",
    });
  });

  it("starts a fresh scan once retention has passed", async () => {
    const outcome = await resolveReRequest(
      { email: EMAIL, tokenHash: "hash" },
      reRequestStore(base),
      new Date(Date.parse(PUBLISHED_AT) + REPORT_RETENTION_MS + 1),
    );
    expect(outcome).toEqual({
      action: "rescan",
      websiteUrl: "https://acmeplumbing.com",
      leadId: "lead-1",
    });
  });

  it("rescans when retention holds but no report was ever produced", async () => {
    const outcome = await resolveReRequest(
      { email: EMAIL },
      reRequestStore({ ...base, reportRevisionId: null }),
      new Date(Date.parse(PUBLISHED_AT) + 1000),
    );
    expect(outcome.action).toBe("rescan");
  });

  it("refuses an email that does not own the report", async () => {
    const outcome = await resolveReRequest(
      { email: "stranger@example.com", tokenHash: "hash" },
      reRequestStore(base),
      new Date(Date.parse(PUBLISHED_AT) + 1000),
    );
    // Otherwise an expired link would let anyone redirect a report to
    // their own inbox.
    expect(outcome).toEqual({ action: "none" });
  });

  it("does nothing when there is nothing to act on", async () => {
    const outcome = await resolveReRequest(
      { email: EMAIL },
      reRequestStore(null),
    );
    expect(outcome).toEqual({ action: "none" });
  });
});

describe("no raw token survives the exchange", () => {
  it("the report page and its content never receive a token", () => {
    for (const path of [
      "app/report/page.tsx",
      "app/report/report-content.tsx",
    ]) {
      const source = readFileSync(path, "utf8");
      expect(source).not.toContain("reportToken");
      expect(source).not.toMatch(/params/);
    }
  });

  it("the expired flow asks only for an email", () => {
    const form = readFileSync("app/report/expired-report-request.tsx", "utf8");
    const fields = form.match(/name="[^"]+"/g) ?? [];
    expect(fields).toEqual(['name="email"']);
  });
});
