import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { ScheduleExpiredScreen } from "@/app/schedule/expired-screen";
import { resolveScheduleExpiredView } from "@/lib/booking/schedule-expired";
import {
  SCHEDULE_CONSUMED_BODY,
  SCHEDULE_EXPIRED_BODY_WITHOUT_REPORT,
  supportConsumedRebookLabel,
} from "@/lib/copy/schedule-expired";
import { hmacSha256 } from "@/lib/crypto";
import { SUPPORT_EMAIL } from "@/lib/identity";

const LOCAL_URL = "http://127.0.0.1:54321";
const LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

describe("schedule dead-end consumed vs expired against local Supabase", () => {
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

  async function seedAudit(session: {
    expiresAt: string;
    consumedAt: string | null;
  }) {
    const originalStatusToken = `sched-${randomUUID()}`;
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .insert({
        email_hash: `sched-email-${randomUUID()}`,
        first_name: "Schedule",
        business_name: "Schedule Co",
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
        website_url: "https://schedule.example",
        business_name: "Schedule Co",
        current_state: "complete",
        public_status_token_hash: hmacSha256(originalStatusToken),
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
        public_report_token_hash: `rpt-${randomUUID()}`,
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
        customer_email_hash: `sched-email-${randomUUID()}`,
        created_at: "2026-08-30T00:00:00.000Z",
        expires_at: session.expiresAt,
        consumed_at: session.consumedAt,
      });
    if (sessionError) {
      throw new Error(
        `Local Supabase is required for this test: ${sessionError.message}`,
      );
    }

    return originalStatusToken;
  }

  it("is already-booked when consumed_at is set, even if expires_at is still in the future", async () => {
    const token = await seedAudit({
      expiresAt: "2027-01-01T00:00:00.000Z",
      consumedAt: "2026-09-01T12:00:00.000Z",
    });
    const view = await resolveScheduleExpiredView(token);
    expect(view).toEqual({ kind: "booked" });
    const html = renderToStaticMarkup(
      createElement(ScheduleExpiredScreen, { view }),
    ).replace(/&#x27;/g, "'");
    expect(html).toContain(SCHEDULE_CONSUMED_BODY);
    expect(html).toContain(supportConsumedRebookLabel(SUPPORT_EMAIL));
    expect(html).toContain("Email us at support@bookednbusy.app to reschedule");
    expect(html).not.toContain(SCHEDULE_EXPIRED_BODY_WITHOUT_REPORT);
    expect(html).not.toContain("not able to pull up your report");
  });

  it("stays expired-never-booked when consumed_at is null and expires_at has passed", async () => {
    const token = await seedAudit({
      expiresAt: "2026-09-01T00:00:00.000Z",
      consumedAt: null,
    });
    await expect(resolveScheduleExpiredView(token)).resolves.toEqual({
      kind: "report",
      reportHref: `/audit/results/${token}`,
    });
  });

  it("stays Branch B when the report cannot resolve", async () => {
    await expect(
      resolveScheduleExpiredView(`missing-${randomUUID()}`),
    ).resolves.toEqual({ kind: "support" });
  });
});
