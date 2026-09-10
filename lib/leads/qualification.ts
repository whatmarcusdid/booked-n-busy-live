import { createAdminClient } from "../supabase/admin";

/**
 * Lead qualification (PRD decision #11 rule 8).
 *
 * "Non-home-service business → Unqualified lead, not unsupported site. Scan
 * and score the site normally. Track qualification separately from
 * scan-capability state; do not overload the audit state machine."
 *
 * This lives on `leads` precisely so that nothing reads qualification out of
 * `audits.current_state`. An unqualified lead still gets a full audit: the two
 * concepts are orthogonal and must stay that way.
 */
export const LEAD_QUALIFICATION_STATUSES = [
  "pending",
  "qualified",
  "unqualified",
] as const;

export type LeadQualificationStatus =
  (typeof LEAD_QUALIFICATION_STATUSES)[number];

export function isLeadQualificationStatus(
  value: string,
): value is LeadQualificationStatus {
  return (LEAD_QUALIFICATION_STATUSES as readonly string[]).includes(value);
}

/** Ring 1 ICP is plumbing-led home service (decision #2). */
export const NOT_HOME_SERVICE_REASON = "not_home_service";

export interface LeadQualification {
  status: LeadQualificationStatus;
  reason: string | null;
  qualifiedAt: string | null;
}

export async function setLeadQualification(
  leadId: string,
  status: LeadQualificationStatus,
  reason?: string | null,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("leads")
    .update({
      qualification_status: status,
      qualification_reason: reason ?? null,
      qualified_at: status === "pending" ? null : new Date().toISOString(),
    })
    .eq("id", leadId);

  if (error) {
    throw new Error(`Failed to set lead qualification: ${error.message}`);
  }
}

export async function getLeadQualification(
  leadId: string,
): Promise<LeadQualification | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("leads")
    .select("qualification_status, qualification_reason, qualified_at")
    .eq("id", leadId)
    .maybeSingle();

  if (error || !data) return null;

  const status = isLeadQualificationStatus(data.qualification_status)
    ? data.qualification_status
    : "pending";

  return {
    status,
    reason: data.qualification_reason ?? null,
    qualifiedAt: data.qualified_at ?? null,
  };
}
