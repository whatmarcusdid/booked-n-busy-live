import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const LOCAL_URL = "http://127.0.0.1:54321";
const LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

describe("audits.idempotency_key_hash unique constraint", () => {
  const supabase = createClient(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function seedLead() {
    const { data, error } = await supabase
      .from("leads")
      .insert({
        email_hash: `email-${randomUUID()}`,
        first_name: "Constraint",
        business_name: "Constraint Co",
        trade: "Plumbing",
        service_area: "Test",
      })
      .select("id")
      .single();

    if (error || !data) {
      throw new Error(
        `Local Supabase is required for this test: ${error?.message ?? "no lead"}`,
      );
    }
    return data.id as string;
  }

  it("allows only one audit row for the same hash under concurrent inserts", async () => {
    const leadId = await seedLead();
    const hash = `idem-${randomUUID()}`;
    const base = {
      lead_id: leadId,
      website_url: "https://example.com",
      business_name: "Constraint Co",
      current_state: "submitted",
      idempotency_key_hash: hash,
    };

    const [first, second] = await Promise.all([
      supabase
        .from("audits")
        .insert({
          ...base,
          public_status_token_hash: `tok-a-${randomUUID()}`,
        })
        .select("id")
        .single(),
      supabase
        .from("audits")
        .insert({
          ...base,
          public_status_token_hash: `tok-b-${randomUUID()}`,
        })
        .select("id")
        .single(),
    ]);

    const succeeded = [first, second].filter((result) => result.data?.id);
    const conflicts = [first, second].filter(
      (result) => result.error?.code === "23505",
    );

    expect(succeeded).toHaveLength(1);
    expect(conflicts).toHaveLength(1);

    const { data: rows, error } = await supabase
      .from("audits")
      .select("id")
      .eq("idempotency_key_hash", hash);

    expect(error).toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.id).toBe(succeeded[0]?.data?.id);

    const existing = await supabase
      .from("audits")
      .select("id")
      .eq("idempotency_key_hash", hash)
      .single();

    expect(existing.data?.id).toBe(succeeded[0]?.data?.id);
  });

  it("create_audit_with_lead returns the same audit for concurrent identical keys", async () => {
    const keyHash = `rpc-${randomUUID()}`;
    const shared = {
      p_email_hash: `rpc-email-${randomUUID()}`,
      // Required since 20260909000000. PostgREST resolves on the exact
      // parameter set, so omitting it is a "function not found", not a null.
      p_email: `rpc-email-${randomUUID()}@example.com`,
      p_first_name: "Concurrent",
      p_business_name: "Concurrent Co",
      p_phone: null,
      p_trade: "Plumbing",
      p_service_area: "Test",
      p_website_url: "https://example.com",
      p_primary_concern: null,
      p_team_size: null,
      p_platform: null,
      p_referral_source: null,
      p_consent_report_delivery: true,
      p_consent_follow_up: false,
      p_utm_source: null,
      p_utm_medium: null,
      p_utm_campaign: null,
      p_utm_term: null,
      p_utm_content: null,
      p_landing_variant: null,
      p_idempotency_key_hash: keyHash,
    };

    const [first, second] = await Promise.all([
      supabase.rpc("create_audit_with_lead", {
        ...shared,
        p_public_status_token_hash: `rpc-tok-a-${randomUUID()}`,
      }),
      supabase.rpc("create_audit_with_lead", {
        ...shared,
        p_public_status_token_hash: `rpc-tok-b-${randomUUID()}`,
      }),
    ]);

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();

    const firstRow = first.data?.[0];
    const secondRow = second.data?.[0];
    expect(firstRow?.audit_id).toBeDefined();
    expect(secondRow?.audit_id).toBe(firstRow.audit_id);

    const createdFlags = [firstRow.is_new_audit, secondRow.is_new_audit];
    expect(createdFlags.filter(Boolean)).toHaveLength(1);
    expect(createdFlags.filter((value) => value === false)).toHaveLength(1);

    const { data: rows } = await supabase
      .from("audits")
      .select("id")
      .eq("idempotency_key_hash", keyHash);

    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.id).toBe(firstRow.audit_id);
  });
});
