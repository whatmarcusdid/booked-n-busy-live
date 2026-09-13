import type { BusinessModel } from "../schemas/audit-submission";

/**
 * Wait-screen optional service-mix chips (Figma 5:2587 default, 132:1542
 * selected). Chip tap is the complete action — there is no Submit, and
 * Figma has no Skip control.
 *
 * Stored values are the five combinations below. The per-audit requested
 * focus column is not part of this feature and is never written here.
 */

export const SERVICE_MIX_HEADING = "Quick optional question";

export const SERVICE_MIX_QUESTION = "What's your primary trade?";

export const SERVICE_MIX_SELECTION_IDS = [
  "plumbing",
  "plumbing_hvac",
  "plumbing_electrical",
  "plumbing_hvac_electrical",
  "other_home_service",
] as const;

export type ServiceMixSelectionId = (typeof SERVICE_MIX_SELECTION_IDS)[number];

export type ServiceMixFields = {
  primaryTrade: string;
  secondaryTrades: string[] | null;
  businessModel: BusinessModel;
};

export const SERVICE_MIX_CHIPS: ReadonlyArray<{
  id: ServiceMixSelectionId;
  label: string;
  fields: ServiceMixFields;
}> = [
  {
    id: "plumbing",
    label: "Plumbing",
    fields: {
      primaryTrade: "plumbing",
      secondaryTrades: null,
      businessModel: "single_trade",
    },
  },
  {
    id: "plumbing_hvac",
    label: "Plumbing + HVAC",
    fields: {
      primaryTrade: "plumbing",
      secondaryTrades: ["hvac"],
      businessModel: "dual_trade",
    },
  },
  {
    id: "plumbing_electrical",
    label: "Plumbing + Electrical",
    fields: {
      primaryTrade: "plumbing",
      secondaryTrades: ["electrical"],
      businessModel: "dual_trade",
    },
  },
  {
    id: "plumbing_hvac_electrical",
    label: "Plumbing + HVAC + Electrical",
    fields: {
      primaryTrade: "plumbing",
      secondaryTrades: ["hvac", "electrical"],
      businessModel: "multi_trade_home_services",
    },
  },
  {
    id: "other_home_service",
    label: "Other home service",
    fields: {
      primaryTrade: "other_home_service",
      secondaryTrades: null,
      businessModel: "single_trade",
    },
  },
];

export function isServiceMixSelectionId(
  value: string,
): value is ServiceMixSelectionId {
  return (SERVICE_MIX_SELECTION_IDS as readonly string[]).includes(value);
}

export function fieldsForServiceMixSelection(
  selection: string,
): ServiceMixFields | null {
  const chip = SERVICE_MIX_CHIPS.find((item) => item.id === selection);
  return chip ? chip.fields : null;
}
