import { hmacSha256 } from "../crypto";
import {
  fieldsForServiceMixSelection,
  isServiceMixSelectionId,
  type ServiceMixFields,
  type ServiceMixSelectionId,
} from "../copy/audit-service-mix";
import { createAdminClient } from "../supabase/admin";

/** Append-only log of which wait-screen chip was tapped. */
export const SERVICE_MIX_SELECTED_EVENT = "service_mix_selected";

export type SaveLeadServiceMixResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "invalid_option" | "server_error" };

export type OwnedServiceMixTarget = {
  auditId: string;
  leadId: string;
};

export interface ServiceMixLookup {
  findOwnedLead(token: string): Promise<OwnedServiceMixTarget | null>;
  writeServiceMix(leadId: string, fields: ServiceMixFields): Promise<void>;
  recordSelection(
    auditId: string,
    selection: ServiceMixSelectionId,
    fields: ServiceMixFields,
  ): Promise<void>;
}

/**
 * Persist one of the five wait-screen chip combinations onto the lead
 * owned by this status token. The client never supplies a lead id; last
 * tap overwrites the three lead columns. Each tap also appends an
 * audit_events row with the chip id, separate from those derived fields.
 */
export async function saveLeadServiceMix(
  statusToken: string,
  selection: string,
  deps: { lookup?: ServiceMixLookup } = {},
): Promise<SaveLeadServiceMixResult> {
  if (!isServiceMixSelectionId(selection)) {
    return { ok: false, reason: "invalid_option" };
  }
  const fields = fieldsForServiceMixSelection(selection);
  if (!fields) return { ok: false, reason: "invalid_option" };

  const lookup = deps.lookup ?? createSupabaseServiceMixLookup();
  const owned = await lookup.findOwnedLead(statusToken);
  if (!owned) return { ok: false, reason: "not_found" };

  try {
    await lookup.writeServiceMix(owned.leadId, fields);
  } catch (error) {
    console.error("Failed to save lead service mix:", error);
    return { ok: false, reason: "server_error" };
  }

  try {
    await lookup.recordSelection(owned.auditId, selection, fields);
  } catch (error) {
    console.error("Failed to record service-mix selection event:", error);
  }

  return { ok: true };
}

export function createSupabaseServiceMixLookup(): ServiceMixLookup {
  return {
    async findOwnedLead(token) {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from("audits")
        .select("id, lead_id")
        .eq("public_status_token_hash", hmacSha256(token))
        .maybeSingle<{ id: string; lead_id: string }>();
      if (error || !data) return null;
      return { auditId: data.id, leadId: data.lead_id };
    },
    async writeServiceMix(leadId, fields) {
      const supabase = createAdminClient();
      const { error } = await supabase
        .from("leads")
        .update({
          primary_trade: fields.primaryTrade,
          secondary_trades: fields.secondaryTrades,
          business_model: fields.businessModel,
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadId);
      if (error) {
        throw new Error(error.message);
      }
    },
    async recordSelection(auditId, selection, fields) {
      const supabase = createAdminClient();
      const { error } = await supabase.from("audit_events").insert({
        audit_id: auditId,
        event_type: SERVICE_MIX_SELECTED_EVENT,
        event_data: {
          selection,
          primary_trade: fields.primaryTrade,
          secondary_trades: fields.secondaryTrades,
          business_model: fields.businessModel,
        },
      });
      if (error) {
        throw new Error(error.message);
      }
    },
  };
}
