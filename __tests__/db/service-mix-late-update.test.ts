import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { SERVICE_MIX_CHIPS } from "@/lib/copy/audit-service-mix";
import { hmacSha256 } from "@/lib/crypto";
import {
  saveLeadServiceMix,
  SERVICE_MIX_SELECTED_EVENT,
} from "@/lib/leads/service-mix";

const LOCAL_URL = "http://127.0.0.1:54321";
const LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

describe("saveLeadServiceMix against local Supabase", () => {
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

  async function seedProcessingAudit() {
    const statusToken = `mix-${randomUUID()}`;
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .insert({
        email_hash: `mix-email-${randomUUID()}`,
        first_name: "Mix",
        business_name: "Mix Co",
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
        website_url: "https://mix.example",
        business_name: "Mix Co",
        current_state: "discovering",
        public_status_token_hash: hmacSha256(statusToken),
      })
      .select("id, current_state")
      .single();
    if (auditError || !audit) {
      throw new Error(
        `Local Supabase is required for this test: ${auditError?.message ?? "no audit"}`,
      );
    }

    return {
      statusToken,
      leadId: lead.id as string,
      auditId: audit.id as string,
      auditState: audit.current_state as string,
    };
  }

  async function readMix(leadId: string) {
    const { data, error } = await supabase
      .from("leads")
      .select("primary_trade, secondary_trades, business_model")
      .eq("id", leadId)
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? "no lead");
    }
    return data;
  }

  it.each(SERVICE_MIX_CHIPS)(
    "persists $id onto a still-processing audit's lead",
    async (chip) => {
      const seeded = await seedProcessingAudit();
      expect(seeded.auditState).toBe("discovering");

      const result = await saveLeadServiceMix(seeded.statusToken, chip.id);
      expect(result).toEqual({ ok: true });
      expect(await readMix(seeded.leadId)).toEqual({
        primary_trade: chip.fields.primaryTrade,
        secondary_trades: chip.fields.secondaryTrades,
        business_model: chip.fields.businessModel,
      });
    },
  );

  it("overwrites a previous chip with the latest tap", async () => {
    const seeded = await seedProcessingAudit();
    await saveLeadServiceMix(seeded.statusToken, "plumbing_hvac_electrical");
    await saveLeadServiceMix(seeded.statusToken, "plumbing_electrical");
    expect(await readMix(seeded.leadId)).toEqual({
      primary_trade: "plumbing",
      secondary_trades: ["electrical"],
      business_model: "dual_trade",
    });
  });

  it("leaves all three fields null when nothing is selected", async () => {
    const seeded = await seedProcessingAudit();
    expect(await readMix(seeded.leadId)).toEqual({
      primary_trade: null,
      secondary_trades: null,
      business_model: null,
    });
  });

  it("cannot write to a lead the current status token does not own", async () => {
    const owned = await seedProcessingAudit();
    const other = await seedProcessingAudit();
    await saveLeadServiceMix(other.statusToken, "plumbing_hvac");
    const result = await saveLeadServiceMix(owned.statusToken, "plumbing");
    expect(result).toEqual({ ok: true });
    expect(await readMix(other.leadId)).toEqual({
      primary_trade: "plumbing",
      secondary_trades: ["hvac"],
      business_model: "dual_trade",
    });
    expect(await readMix(owned.leadId)).toEqual({
      primary_trade: "plumbing",
      secondary_trades: null,
      business_model: "single_trade",
    });
  });

  it("appends a service_mix_selected event with the chip id", async () => {
    const seeded = await seedProcessingAudit();
    await saveLeadServiceMix(seeded.statusToken, "plumbing_hvac");
    await saveLeadServiceMix(seeded.statusToken, "other_home_service");

    const { data, error } = await supabase
      .from("audit_events")
      .select("event_type, event_data")
      .eq("audit_id", seeded.auditId)
      .eq("event_type", SERVICE_MIX_SELECTED_EVENT)
      .order("created_at", { ascending: true });

    if (error || !data) {
      throw new Error(error?.message ?? "no events");
    }
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual({
      event_type: SERVICE_MIX_SELECTED_EVENT,
      event_data: {
        selection: "plumbing_hvac",
        primary_trade: "plumbing",
        secondary_trades: ["hvac"],
        business_model: "dual_trade",
      },
    });
    expect(data[1].event_data).toEqual({
      selection: "other_home_service",
      primary_trade: "other_home_service",
      secondary_trades: null,
      business_model: "single_trade",
    });
  });
});
