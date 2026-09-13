import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { GET as scheduleByCookie } from "@/app/report/schedule/route";
import { ScheduleExpiredScreen } from "@/app/schedule/expired-screen";
import { resolveScheduleExpiredView } from "@/lib/booking/schedule-expired";
import { resolveCalendarHandoffFromReportCookie } from "@/lib/booking/calendar-handoff";
import {
  readScheduleHandoffToken,
  signScheduleHandoffToken,
} from "@/lib/booking/schedule-handoff-token";
import {
  BACK_TO_REPORT_LABEL,
  SCHEDULE_EXPIRED_BODY_WITHOUT_REPORT,
} from "@/lib/copy/schedule-expired";
import { hmacSha256 } from "@/lib/crypto";
import {
  REPORT_ACCESS_COOKIE,
  signReportAccess,
} from "@/lib/reports/access-cookie";
import { loadAuditResults } from "@/lib/services/audit-results-service";

const LOCAL_URL = "http://127.0.0.1:54321";
const LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

describe("cookie-authenticated /report/schedule dead-session handoff", () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = createClient(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = LOCAL_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = LOCAL_SERVICE_ROLE_KEY;
  });

  afterAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  });

  async function seedPublishedAuditWithDeadSession() {
    const reportTokenHash = `rpt-${randomUUID()}`;
    const originalStatusToken = `orig-${randomUUID()}`;
    const originalStatusTokenHash = hmacSha256(originalStatusToken);
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .insert({
        email_hash: `handoff-email-${randomUUID()}`,
        first_name: "Cookie",
        business_name: "Handoff Co",
        trade: "Plumbing",
        service_area: "Test",
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
        website_url: "https://handoff.example",
        business_name: "Handoff Co",
        current_state: "complete",
        public_status_token_hash: originalStatusTokenHash,
      })
      .select("id")
      .single();
    if (auditError || !audit) {
      throw new Error(
        `Local Supabase is required for this test: ${auditError?.message ?? "no audit"}`,
      );
    }

    const { error: revisionError } = await supabase
      .from("report_revisions")
      .insert({
        audit_id: audit.id,
        revision_number: 1,
        overall_score: 0.72,
        executive_summary: "Solid foundation.",
        publication_status: "published",
        published_at: "2026-09-01T00:00:00.000Z",
        public_report_token_hash: reportTokenHash,
        public_report_token_expires_at: "2026-12-01T00:00:00.000Z",
      });
    if (revisionError) {
      throw new Error(
        `Local Supabase is required for this test: ${revisionError.message}`,
      );
    }

    const { error: sessionError } = await supabase
      .from("booking_sessions")
      .insert({
        audit_id: audit.id,
        lead_id: lead.id,
        customer_email_hash: `handoff-email-${randomUUID()}`,
        created_at: "2026-08-30T00:00:00.000Z",
        expires_at: "2026-09-01T00:00:00.000Z",
        consumed_at: null,
      });
    if (sessionError) {
      throw new Error(
        `Local Supabase is required for this test: ${sessionError.message}`,
      );
    }

    return {
      auditId: audit.id as string,
      originalStatusToken,
      originalStatusTokenHash,
      cookie: signReportAccess({ tokenHash: reportTokenHash, expired: false }),
    };
  }

  it("redirects a cookie visitor with a dead session to Branch A without rotating the original status token", async () => {
    const seeded = await seedPublishedAuditWithDeadSession();
    const resolved = await resolveCalendarHandoffFromReportCookie(seeded.cookie);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    const claim = readScheduleHandoffToken(resolved.statusToken);
    expect(claim?.auditId).toBe(seeded.auditId);

    const response = await scheduleByCookie(
      new NextRequest("http://localhost:3000/report/schedule", {
        headers: { Cookie: `${REPORT_ACCESS_COOKIE}=${seeded.cookie}` },
      }),
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/schedule");
    const forwarded = location.searchParams.get("token");
    expect(forwarded).toBeTruthy();
    expect(readScheduleHandoffToken(forwarded ?? undefined)?.auditId).toBe(
      seeded.auditId,
    );

    const view = await resolveScheduleExpiredView(forwarded ?? undefined);
    expect(view.kind).toBe("report");
    if (view.kind !== "report") return;
    expect(view.reportHref).toBe(`/audit/results/${forwarded}`);
    const html = renderToStaticMarkup(
      createElement(ScheduleExpiredScreen, { view }),
    ).replace(/&#x27;/g, "'");
    expect(html).toContain(BACK_TO_REPORT_LABEL);
    expect(html).toContain(`href="/audit/results/${forwarded}"`);
    expect(html).not.toContain(SCHEDULE_EXPIRED_BODY_WITHOUT_REPORT);

    const { data: after, error } = await supabase
      .from("audits")
      .select("public_status_token_hash")
      .eq("id", seeded.auditId)
      .single();
    expect(error).toBeNull();
    expect(after?.public_status_token_hash).toBe(seeded.originalStatusTokenHash);

    const original = await loadAuditResults(seeded.originalStatusToken);
    expect(original.ok).toBe(true);
    if (!original.ok) return;
    expect(original.auditId).toBe(seeded.auditId);
    expect(original.statusToken).toBe(seeded.originalStatusToken);
  });

  it("falls back to bare /schedule Branch B when the cookie cannot resolve an audit", async () => {
    const cookie = signReportAccess({
      tokenHash: `missing-${randomUUID()}`,
      expired: false,
    });
    const resolved = await resolveCalendarHandoffFromReportCookie(cookie);
    expect(resolved).toEqual({ ok: false, reason: "unavailable" });

    const response = await scheduleByCookie(
      new NextRequest("http://localhost:3000/report/schedule", {
        headers: { Cookie: `${REPORT_ACCESS_COOKIE}=${cookie}` },
      }),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/schedule",
    );

    const view = await resolveScheduleExpiredView(undefined);
    expect(view).toEqual({ kind: "support" });
    const html = renderToStaticMarkup(
      createElement(ScheduleExpiredScreen, { view }),
    ).replace(/&#x27;/g, "'");
    expect(html).toContain(SCHEDULE_EXPIRED_BODY_WITHOUT_REPORT);
    expect(html).not.toContain(BACK_TO_REPORT_LABEL);
  });

  it("falls through to Branch B when the signed handoff token has expired", async () => {
    const seeded = await seedPublishedAuditWithDeadSession();
    const expired = signScheduleHandoffToken({
      auditId: seeded.auditId,
      now: new Date(Date.now() - 10 * 60 * 1000),
    });
    const view = await resolveScheduleExpiredView(expired);
    expect(view).toEqual({ kind: "support" });
  });
});
