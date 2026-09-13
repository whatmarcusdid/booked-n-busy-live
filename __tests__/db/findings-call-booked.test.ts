import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { loadFindingsCallBooked } from "@/lib/booking/findings-call-booked";
import { FINDING_QUESTION } from "@/lib/copy/pre-call";

const LOCAL_URL = "http://127.0.0.1:54321";
const LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

describe("loadFindingsCallBooked against local Supabase", () => {
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

  async function seedAudit() {
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .insert({
        email_hash: `booked-email-${randomUUID()}`,
        first_name: "Booked",
        business_name: "Booked Co",
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
        website_url: "https://booked.example",
        business_name: "Booked Co",
        current_state: "complete",
        public_status_token_hash: `booked-token-${randomUUID()}`,
      })
      .select("id")
      .single();
    if (auditError || !audit) {
      throw new Error(
        `Local Supabase is required for this test: ${auditError?.message ?? "no audit"}`,
      );
    }

    const { data: session, error: sessionError } = await supabase
      .from("booking_sessions")
      .insert({
        audit_id: audit.id,
        lead_id: lead.id,
        customer_email_hash: `booked-email-${randomUUID()}`,
        created_at: "2026-09-01T00:00:00.000Z",
        expires_at: "2026-09-03T00:00:00.000Z",
        consumed_at: "2026-09-02T12:00:00.000Z",
      })
      .select("id")
      .single();
    if (sessionError || !session) {
      throw new Error(
        `Local Supabase is required for this test: ${sessionError?.message ?? "no session"}`,
      );
    }

    return { auditId: audit.id as string, leadId: lead.id as string, sessionId: session.id as string };
  }

  it("returns the module when a booked meeting and prep answers exist", async () => {
    const seeded = await seedAudit();
    const { error: meetingError } = await supabase.from("meetings").insert({
      audit_id: seeded.auditId,
      lead_id: seeded.leadId,
      booking_session_id: seeded.sessionId,
      status: "booked",
      scheduled_start: "2026-09-18T18:00:00.000Z",
      scheduled_end: "2026-09-18T18:30:00.000Z",
    });
    if (meetingError) {
      throw new Error(
        `Local Supabase is required for this test: ${meetingError.message}`,
      );
    }
    const { error: prepError } = await supabase.from("pre_call_answers").insert({
      audit_id: seeded.auditId,
      lead_id: seeded.leadId,
      finding_answer: "Make the phone number obvious",
      result_answer: "More phone calls",
      timing_answer: "Right away",
      submitted_at: "2026-09-02T11:00:00.000Z",
    });
    if (prepError) {
      throw new Error(
        `Local Supabase is required for this test: ${prepError.message}`,
      );
    }

    const view = await loadFindingsCallBooked(seeded.auditId);
    expect(new Date(view!.scheduledStart).toISOString()).toBe(
      "2026-09-18T18:00:00.000Z",
    );
    expect(new Date(view!.scheduledEnd).toISOString()).toBe(
      "2026-09-18T18:30:00.000Z",
    );
    expect(view).not.toHaveProperty("whenLabel");
    expect(view?.prepAnswers).toEqual(
      expect.arrayContaining([
        {
          question: FINDING_QUESTION,
          answer: "Make the phone number obvious",
        },
      ]),
    );
  });

  it("omits prep answers when none were captured", async () => {
    const seeded = await seedAudit();
    const { error: meetingError } = await supabase.from("meetings").insert({
      audit_id: seeded.auditId,
      lead_id: seeded.leadId,
      booking_session_id: seeded.sessionId,
      status: "rescheduled",
      scheduled_start: "2026-09-18T18:00:00.000Z",
      scheduled_end: "2026-09-18T18:30:00.000Z",
    });
    if (meetingError) {
      throw new Error(
        `Local Supabase is required for this test: ${meetingError.message}`,
      );
    }

    const view = await loadFindingsCallBooked(seeded.auditId);
    expect(new Date(view!.scheduledStart).toISOString()).toBe(
      "2026-09-18T18:00:00.000Z",
    );
    expect(new Date(view!.scheduledEnd).toISOString()).toBe(
      "2026-09-18T18:30:00.000Z",
    );
    expect(view!.prepAnswers).toBeNull();
  });

  it("returns null when the only meeting is cancelled", async () => {
    const seeded = await seedAudit();
    const { error: meetingError } = await supabase.from("meetings").insert({
      audit_id: seeded.auditId,
      lead_id: seeded.leadId,
      booking_session_id: seeded.sessionId,
      status: "cancelled",
      scheduled_start: "2026-09-18T18:00:00.000Z",
      scheduled_end: "2026-09-18T18:30:00.000Z",
    });
    if (meetingError) {
      throw new Error(
        `Local Supabase is required for this test: ${meetingError.message}`,
      );
    }

    await expect(loadFindingsCallBooked(seeded.auditId)).resolves.toBeNull();
  });

  it("returns null when no meeting exists", async () => {
    const seeded = await seedAudit();
    await expect(loadFindingsCallBooked(seeded.auditId)).resolves.toBeNull();
  });
});
