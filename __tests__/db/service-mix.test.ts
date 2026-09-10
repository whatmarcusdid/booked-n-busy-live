import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { REQUIRED_RPC_PARAMETERS, REQUIRED_TABLE_COLUMNS } from "@/lib/supabase/schema-contract";

const LOCAL_URL = "http://127.0.0.1:54321";
const LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

function rpcBase() {
  return {
    p_email_hash: `mix-email-${randomUUID()}`,
    p_email: `mix-${randomUUID()}@example.com`,
    p_first_name: "Mix",
    p_business_name: "Mix Co",
    p_phone: null,
    p_trade: null,
    p_service_area: null,
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
    p_public_status_token_hash: `mix-tok-${randomUUID()}`,
  };
}

describe("Decision #2 service-mix schema", () => {
  const supabase = createClient(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  it("is named on the boot contract so a skipped migration fails at boot", () => {
    expect(REQUIRED_RPC_PARAMETERS).toEqual(
      expect.arrayContaining([
        "p_primary_trade",
        "p_secondary_trades",
        "p_business_model",
        "p_audit_focus",
      ]),
    );
    expect(REQUIRED_TABLE_COLUMNS.leads).toEqual(
      expect.arrayContaining([
        "primary_trade",
        "secondary_trades",
        "business_model",
      ]),
    );
    expect(REQUIRED_TABLE_COLUMNS.audits).toContain("audit_focus");
  });

  it("drops the pre-service-mix RPC overload in the same migration", () => {
    const sql = readFileSync(
      "supabase/migrations/20260910010000_leads_service_mix.sql",
      "utf8",
    );
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.create_audit_with_lead/);
    expect(sql).toContain("leads_business_model_allowed");
    expect(sql).toContain("audits_audit_focus_allowed");
    expect(sql).toContain("single_trade");
    expect(sql).toContain("overall_website_conversion");
  });

  it("persists supplied service-mix fields on lead and audit", async () => {
    const { data, error } = await supabase.rpc("create_audit_with_lead", {
      ...rpcBase(),
      p_primary_trade: "Plumbing",
      p_secondary_trades: ["HVAC", "Electrical"],
      p_business_model: "dual_trade",
      p_audit_focus: "plumbing",
    });

    if (error || !data?.[0]) {
      throw new Error(
        `Local Supabase is required for this test: ${error?.message ?? "no row"}`,
      );
    }

    const row = data[0];
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("primary_trade, secondary_trades, business_model")
      .eq("id", row.lead_id)
      .single();
    const { data: audit, error: auditError } = await supabase
      .from("audits")
      .select("audit_focus")
      .eq("id", row.audit_id)
      .single();

    expect(leadError).toBeNull();
    expect(auditError).toBeNull();
    expect(lead).toEqual({
      primary_trade: "Plumbing",
      secondary_trades: ["HVAC", "Electrical"],
      business_model: "dual_trade",
    });
    expect(audit?.audit_focus).toBe("plumbing");
  });

  it("leaves all four columns null when the fields are omitted", async () => {
    const { data, error } = await supabase.rpc("create_audit_with_lead", {
      ...rpcBase(),
    });

    if (error || !data?.[0]) {
      throw new Error(
        `Local Supabase is required for this test: ${error?.message ?? "no row"}`,
      );
    }

    const row = data[0];
    const { data: lead } = await supabase
      .from("leads")
      .select("primary_trade, secondary_trades, business_model")
      .eq("id", row.lead_id)
      .single();
    const { data: audit } = await supabase
      .from("audits")
      .select("audit_focus")
      .eq("id", row.audit_id)
      .single();

    expect(lead).toEqual({
      primary_trade: null,
      secondary_trades: null,
      business_model: null,
    });
    expect(audit?.audit_focus).toBeNull();
  });

  it("rejects an invalid business_model via CHECK", async () => {
    const { error } = await supabase.from("leads").insert({
      email_hash: `mix-check-${randomUUID()}`,
      first_name: "Mix",
      business_model: "franchise",
    });

    expect(error?.code).toBe("23514");
  });

  it("rejects an invalid audit_focus via CHECK", async () => {
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .insert({
        email_hash: `mix-check-${randomUUID()}`,
        first_name: "Mix",
      })
      .select("id")
      .single();

    if (leadError || !lead) {
      throw new Error(
        `Local Supabase is required for this test: ${leadError?.message ?? "no lead"}`,
      );
    }

    const { error } = await supabase.from("audits").insert({
      lead_id: lead.id,
      website_url: "https://example.com",
      business_name: "Mix Co",
      current_state: "submitted",
      public_status_token_hash: `mix-tok-${randomUUID()}`,
      audit_focus: "roofing",
    });

    expect(error?.code).toBe("23514");
  });
});
