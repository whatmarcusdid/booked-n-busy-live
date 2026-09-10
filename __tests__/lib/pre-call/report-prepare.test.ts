import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildResultsView, RESULTS_PILLARS } from "@/lib/copy/audit-results";
import {
  findingDiscussionOptions,
  REPORT_PREPARE_PATH,
} from "@/lib/copy/pre-call";
import {
  persistPreCallAnswers,
  type PreCallAnswerRow,
  type PreCallAnswerStore,
} from "@/lib/pre-call/answers";
import { loadPrepareFromReportCookie } from "@/lib/pre-call/report-prepare";
import {
  readReportAccess,
  REPORT_ACCESS_COOKIE_PATH,
  signReportAccess,
} from "@/lib/reports/access-cookie";
import type { ReportAccess } from "@/lib/reports/access";

const PAGE = join(process.cwd(), "app/report/prepare/page.tsx");
const TOKEN_PAGE = join(
  process.cwd(),
  "app/audit/prepare/[token]/page.tsx",
);
const COOKIE = join(process.cwd(), "lib/reports/access-cookie.ts");
const CTA = join(process.cwd(), "app/book-findings-call.tsx");

const REPORT_TOKEN_HASH = "report-token-hash-1";

function viewWithRecommendations(titles: string[]) {
  return buildResultsView({
    firstName: "Alex",
    websiteUrl: "https://bookednbusy.app",
    pillars: RESULTS_PILLARS.map((pillar) => ({
      key: pillar.key,
      name: pillar.name,
      score: 0.8,
    })),
    criteria: [],
    recommendations: titles.map((title, index) => ({
      title,
      description: "Show this first.",
      pillar: "lead_conversion",
      priority: "fix_first",
      sortOrder: index,
    })),
  });
}

function grantedAccess(tokenHash: string): ReportAccess {
  return {
    outcome: "granted",
    tokenHash,
    report: {
      websiteUrl: "https://bookednbusy.app",
      businessName: "Acme Plumbing",
      overallScore: 0.72,
      executiveSummary: "Solid foundation.",
      publicationStatus: "published",
      publishedAt: "2026-09-01T00:00:00.000Z",
      expiresAt: null,
      pillars: [],
      recommendations: [],
    },
  };
}

function memoryStore() {
  const rows: PreCallAnswerRow[] = [];
  const store: PreCallAnswerStore & { rows: typeof rows } = {
    rows,
    async insert(row) {
      rows.push(row);
      return { id: `row-${rows.length}` };
    },
  };
  return store;
}

describe("cookie-authenticated /report/prepare", () => {
  it("resolves the audit via the report cookie and uses that audit's Q1 recs", async () => {
    const cookie = signReportAccess({
      tokenHash: REPORT_TOKEN_HASH,
      expired: false,
    });
    expect(readReportAccess(cookie)?.tokenHash).toBe(REPORT_TOKEN_HASH);

    const loaded = await loadPrepareFromReportCookie(cookie, {
      resolveAccess: async (tokenHash) => {
        expect(tokenHash).toBe(REPORT_TOKEN_HASH);
        return grantedAccess(tokenHash);
      },
      findAuditId: async (tokenHash) => {
        expect(tokenHash).toBe(REPORT_TOKEN_HASH);
        return "audit-report-1";
      },
      loadByAuditId: async (auditId) => {
        expect(auditId).toBe("audit-report-1");
        return {
          ok: true,
          auditId: "audit-report-1",
          leadId: "lead-report-1",
          view: viewWithRecommendations([
            "Make the phone number obvious above the fold",
          ]),
        };
      },
    });

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.auditId).toBe("audit-report-1");
    expect(loaded.leadId).toBe("lead-report-1");
    expect(findingDiscussionOptions(loaded.view.overallRecommendations)).toEqual([
      "Make the phone number obvious above the fold",
    ]);
  });

  it("falls back to pillar names when that audit has no recommendations", async () => {
    const cookie = signReportAccess({
      tokenHash: REPORT_TOKEN_HASH,
      expired: false,
    });
    const loaded = await loadPrepareFromReportCookie(cookie, {
      resolveAccess: async () => grantedAccess(REPORT_TOKEN_HASH),
      findAuditId: async () => "audit-report-1",
      loadByAuditId: async () => ({
        ok: true,
        auditId: "audit-report-1",
        leadId: "lead-report-1",
        view: viewWithRecommendations([]),
      }),
    });

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(findingDiscussionOptions(loaded.view.overallRecommendations)).toEqual(
      ["Trust Signals", "Lead Conversion", "Growth Infrastructure"],
    );
  });

  it("persists a submitted answer with the cookie-resolved audit_id and lead_id", async () => {
    const cookie = signReportAccess({
      tokenHash: REPORT_TOKEN_HASH,
      expired: false,
    });
    const store = memoryStore();
    const loaded = await loadPrepareFromReportCookie(cookie, {
      resolveAccess: async () => grantedAccess(REPORT_TOKEN_HASH),
      findAuditId: async () => "audit-report-1",
      loadByAuditId: async () => ({
        ok: true,
        auditId: "audit-report-1",
        leadId: "lead-report-1",
        view: viewWithRecommendations([
          "Make the phone number obvious above the fold",
        ]),
      }),
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok || !loaded.leadId) return;

    const result = await persistPreCallAnswers(
      {
        auditId: loaded.auditId,
        leadId: loaded.leadId,
        view: loaded.view,
      },
      {
        findingAnswer: "Make the phone number obvious above the fold",
        resultAnswer: "More phone calls",
        timingAnswer: "Right away",
      },
      {
        store,
        now: () => new Date("2026-09-09T17:00:00.000Z"),
      },
    );

    expect(result).toEqual({ ok: true, id: "row-1" });
    expect(store.rows).toEqual([
      {
        auditId: "audit-report-1",
        leadId: "lead-report-1",
        findingAnswer: "Make the phone number obvious above the fold",
        resultAnswer: "More phone calls",
        timingAnswer: "Right away",
        submittedAt: "2026-09-09T17:00:00.000Z",
      },
    ]);
  });

  it("refuses a missing or ungranted cookie without loading an audit", async () => {
    const loaded = await loadPrepareFromReportCookie(undefined, {
      loadByAuditId: async () => {
        throw new Error("must not load");
      },
    });
    expect(loaded).toEqual({ ok: false, code: "NOT_FOUND" });

    const expired = signReportAccess({
      tokenHash: REPORT_TOKEN_HASH,
      expired: false,
    });
    const denied = await loadPrepareFromReportCookie(expired, {
      resolveAccess: async () => ({
        outcome: "expired",
        tokenHash: REPORT_TOKEN_HASH,
        retained: true,
      }),
      loadByAuditId: async () => {
        throw new Error("must not load");
      },
    });
    expect(denied).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("is a /report child route that reuses PrepareScreen and the cookie helper", () => {
    const page = readFileSync(PAGE, "utf8");
    expect(REPORT_PREPARE_PATH).toBe("/report/prepare");
    expect(page).toContain("loadPrepareFromReportCookie");
    expect(page).toContain("REPORT_ACCESS_COOKIE");
    expect(page).toContain("PrepareScreen");
    expect(page).toContain('submitUrl="/report/prepare/answers"');
    expect(page).toContain('homeHref="/report"');
    expect(page).not.toContain("statusToken");
    expect(page).not.toContain("public_status_token");
    expect(page).not.toContain("loadAuditResults(");
  });

  it("does not change the report cookie's path, contents, or hashing", () => {
    const cookie = readFileSync(COOKIE, "utf8");
    expect(REPORT_ACCESS_COOKIE_PATH).toBe("/report");
    expect(cookie).toContain('path: REPORT_ACCESS_COOKIE_PATH');
    expect(cookie).toContain("Holds the report token's HASH, never the raw token");
    expect(cookie).not.toContain("public_status_token");
  });

  it("leaves the token-based prepare route on loadAuditResults", () => {
    const tokenPage = readFileSync(TOKEN_PAGE, "utf8");
    expect(tokenPage).toContain("loadAuditResults");
    expect(tokenPage).toContain("token={token}");
    expect(tokenPage).not.toContain("loadPrepareFromReportCookie");
    expect(tokenPage).not.toContain("REPORT_ACCESS_COOKIE");
  });

  it("does not mint or return a status token from the report CTA", () => {
    const cta = readFileSync(CTA, "utf8");
    expect(cta).toContain("REPORT_PREPARE_PATH");
    expect(cta).not.toContain("statusToken:");
    expect(cta).not.toMatch(/json\.statusToken/);
  });
});
