import { fieldsForServiceMixSelection, SERVICE_MIX_CHIPS } from "@/lib/copy/audit-service-mix";
import {
  saveLeadServiceMix,
  SERVICE_MIX_SELECTED_EVENT,
  type OwnedServiceMixTarget,
  type ServiceMixLookup,
} from "@/lib/leads/service-mix";
import type { ServiceMixFields } from "@/lib/copy/audit-service-mix";
import type { ServiceMixSelectionId } from "@/lib/copy/audit-service-mix";

function memoryLookup(owned: OwnedServiceMixTarget | null) {
  const writes: Array<{ leadId: string; fields: ServiceMixFields }> = [];
  const events: Array<{
    auditId: string;
    selection: ServiceMixSelectionId;
    fields: ServiceMixFields;
  }> = [];
  const lookup: ServiceMixLookup & { writes: typeof writes; events: typeof events } =
    {
      writes,
      events,
      async findOwnedLead(token) {
        return token === "owned-token" ? owned : null;
      },
      async writeServiceMix(id, fields) {
        writes.push({ leadId: id, fields });
      },
      async recordSelection(auditId, selection, fields) {
        events.push({ auditId, selection, fields });
      },
    };
  return lookup;
}

const OWNED = { auditId: "audit-owned", leadId: "lead-owned" };

describe("fieldsForServiceMixSelection", () => {
  it("maps each of the five chips to the locked three-field combination", () => {
    expect(fieldsForServiceMixSelection("plumbing")).toEqual({
      primaryTrade: "plumbing",
      secondaryTrades: null,
      businessModel: "single_trade",
    });
    expect(fieldsForServiceMixSelection("plumbing_hvac")).toEqual({
      primaryTrade: "plumbing",
      secondaryTrades: ["hvac"],
      businessModel: "dual_trade",
    });
    expect(fieldsForServiceMixSelection("plumbing_electrical")).toEqual({
      primaryTrade: "plumbing",
      secondaryTrades: ["electrical"],
      businessModel: "dual_trade",
    });
    expect(fieldsForServiceMixSelection("plumbing_hvac_electrical")).toEqual({
      primaryTrade: "plumbing",
      secondaryTrades: ["hvac", "electrical"],
      businessModel: "multi_trade_home_services",
    });
    expect(fieldsForServiceMixSelection("other_home_service")).toEqual({
      primaryTrade: "other_home_service",
      secondaryTrades: null,
      businessModel: "single_trade",
    });
    expect(SERVICE_MIX_CHIPS).toHaveLength(5);
  });

  it("rejects a tampered selection before any write", () => {
    expect(fieldsForServiceMixSelection("franchise")).toBeNull();
    expect(fieldsForServiceMixSelection("Plumbing")).toBeNull();
    expect(fieldsForServiceMixSelection("other")).toBeNull();
  });
});

describe("saveLeadServiceMix", () => {
  it("writes the mapped fields onto the lead owned by the status token", async () => {
    const lookup = memoryLookup(OWNED);
    const result = await saveLeadServiceMix("owned-token", "plumbing_hvac", {
      lookup,
    });
    expect(result).toEqual({ ok: true });
    expect(lookup.writes).toEqual([
      {
        leadId: "lead-owned",
        fields: {
          primaryTrade: "plumbing",
          secondaryTrades: ["hvac"],
          businessModel: "dual_trade",
        },
      },
    ]);
  });

  it("records the chip id on the audit as a separate event", async () => {
    const lookup = memoryLookup(OWNED);
    await saveLeadServiceMix("owned-token", "plumbing_hvac", { lookup });
    expect(lookup.events).toEqual([
      {
        auditId: "audit-owned",
        selection: "plumbing_hvac",
        fields: {
          primaryTrade: "plumbing",
          secondaryTrades: ["hvac"],
          businessModel: "dual_trade",
        },
      },
    ]);
    expect(SERVICE_MIX_SELECTED_EVENT).toBe("service_mix_selected");
  });

  it("overwrites the lead fields but appends another selection event", async () => {
    const lookup = memoryLookup(OWNED);
    await saveLeadServiceMix("owned-token", "plumbing_hvac", { lookup });
    await saveLeadServiceMix("owned-token", "plumbing", { lookup });
    expect(lookup.writes).toHaveLength(2);
    expect(lookup.writes[1]).toEqual({
      leadId: "lead-owned",
      fields: {
        primaryTrade: "plumbing",
        secondaryTrades: null,
        businessModel: "single_trade",
      },
    });
    expect(lookup.events.map((event) => event.selection)).toEqual([
      "plumbing_hvac",
      "plumbing",
    ]);
  });

  it("does not write when the selection is invalid", async () => {
    const lookup = memoryLookup(OWNED);
    const result = await saveLeadServiceMix("owned-token", "roofing", {
      lookup,
    });
    expect(result).toEqual({ ok: false, reason: "invalid_option" });
    expect(lookup.writes).toEqual([]);
    expect(lookup.events).toEqual([]);
  });

  it("does not write when the token does not own a lead", async () => {
    const lookup = memoryLookup(OWNED);
    const result = await saveLeadServiceMix("other-token", "plumbing", {
      lookup,
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(lookup.writes).toEqual([]);
    expect(lookup.events).toEqual([]);
  });

  it("does not mention audit_focus", () => {
    const source = [
      require("node:fs").readFileSync("lib/leads/service-mix.ts", "utf8"),
      require("node:fs").readFileSync("lib/copy/audit-service-mix.ts", "utf8"),
      require("node:fs").readFileSync(
        "app/api/v1/audits/[token]/service-mix/route.ts",
        "utf8",
      ),
    ].join("\n");
    expect(source).not.toMatch(/audit_focus|auditFocus/);
  });
});
