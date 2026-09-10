export const PROCESSING_STATES = [
  "validating",
  "discovering",
  "rendering",
  "collecting_signals",
  "scoring",
  "generating_report",
  "validating_report",
] as const;

export const WORKFLOW_TERMINAL_STATES = [
  "complete",
  "partial",
  "needs_review",
  "unsupported",
  "failed",
] as const;

export type ProcessingState = (typeof PROCESSING_STATES)[number];
export type WorkflowTerminalState = (typeof WORKFLOW_TERMINAL_STATES)[number];
export type AuditWorkflowState =
  | "submitted"
  | ProcessingState
  | WorkflowTerminalState;

export const STAGE_SEQUENCE: AuditWorkflowState[] = [
  "submitted",
  ...PROCESSING_STATES,
];

export const PILLARS = [
  { key: "trust_signals", name: "Trust Signals" },
  { key: "lead_conversion", name: "Lead Conversion" },
  { key: "growth_infrastructure", name: "Growth Infrastructure" },
] as const;

export type PillarKey = (typeof PILLARS)[number]["key"];

/** PRD Section 7 catalog (rule_version v2). */
export const CRITERIA_BY_PILLAR: Record<
  PillarKey,
  ReadonlyArray<{ key: string; name: string; weight: number }>
> = {
  trust_signals: [
    { key: "license_insurance", name: "License and Insurance Visibility", weight: 0.25 },
    { key: "service_area_clarity", name: "Service-Area Clarity", weight: 0.25 },
    { key: "reviews_above_fold", name: "Reviews Above the Fold", weight: 0.25 },
    { key: "key_person_credibility", name: "Key-Person / Local Credibility", weight: 0.25 },
  ],
  lead_conversion: [
    { key: "phone_cta_visibility", name: "Phone CTA Visibility", weight: 0.25 },
    { key: "quote_booking_cta_visibility", name: "Quote/Booking CTA Visibility", weight: 0.25 },
    { key: "website_performance", name: "Website Performance", weight: 0.25 },
    { key: "process_clarity", name: "Process Clarity", weight: 0.25 },
  ],
  growth_infrastructure: [
    { key: "seo_ai_search_readiness", name: "SEO / AI Search Readiness", weight: 0.25 },
    { key: "security_health", name: "Security Health", weight: 0.25 },
    { key: "faq_common_concerns", name: "FAQ / Common Concerns", weight: 0.25 },
    { key: "offer_differentiation", name: "Offer Differentiation", weight: 0.25 },
  ],
};

export const WORKFLOW_STARTED_EVENT = "workflow_started";

/**
 * The durable execution could not be enqueued, so no stage will ever run.
 * This terminates the audit as Failed instead of leaving it in `submitted`,
 * where it would poll forever against work that does not exist.
 */
export const WORKFLOW_START_FAILED_EVENT = "workflow_start_failed";
export const WORKFLOW_START_FAILED_REASON = "WORKFLOW_START_FAILED";

export function isWorkflowTerminalState(
  value: string,
): value is WorkflowTerminalState {
  return (WORKFLOW_TERMINAL_STATES as readonly string[]).includes(value);
}

export function isAuditWorkflowState(
  value: string,
): value is AuditWorkflowState {
  return (
    value === "submitted" ||
    (PROCESSING_STATES as readonly string[]).includes(value) ||
    isWorkflowTerminalState(value)
  );
}
