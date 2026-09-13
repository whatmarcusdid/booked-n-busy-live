import { resultsPathForStatusToken } from "@/lib/copy/schedule-expired";
import {
  loadAuditResults,
  loadAuditResultsByAuditId,
} from "@/lib/services/audit-results-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { readScheduleHandoffToken } from "./schedule-handoff-token";

/**
 * Chooses the `/schedule` dead-end branch from a status token.
 *
 * Report reachability is decided first and independently: a miss is
 * Branch B regardless of booking-session state. When the report
 * resolves, `booking_sessions.consumed_at` splits already-booked from
 * expired-never-booked. Death of the session is determined upstream;
 * this only refines the dead-end screen.
 */

export type ScheduleExpiredView =
  | { kind: "report"; reportHref: string }
  | { kind: "booked" }
  | { kind: "support" }
  | { kind: "error" };

type ResultsLookup = (
  token: string,
) => Promise<
  | { ok: true; auditId?: string }
  | { ok: false; code: "NOT_FOUND" | "SERVER_ERROR" }
>;

type AuditIdLookup = (
  auditId: string,
) => Promise<{ ok: true } | { ok: false; code: "NOT_FOUND" | "SERVER_ERROR" }>;

export interface ScheduleSessionLookup {
  findByAuditId(
    auditId: string,
  ): Promise<{ consumedAt: string | null } | null>;
}

export function createSupabaseScheduleSessionLookup(): ScheduleSessionLookup {
  return {
    async findByAuditId(auditId) {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from("booking_sessions")
        .select("consumed_at")
        .eq("audit_id", auditId)
        .order("created_at", { ascending: false });
      if (error || !data?.length) return null;
      const consumed = data.find((row) => row.consumed_at != null);
      return {
        consumedAt: (consumed?.consumed_at ?? data[0].consumed_at) as
          | string
          | null,
      };
    },
  };
}

async function viewForResolvedReport(
  token: string,
  auditId: string | undefined,
  deps: {
    sessionLookup?: ScheduleSessionLookup;
  },
): Promise<ScheduleExpiredView> {
  const reportHref = resultsPathForStatusToken(token);
  if (!auditId) return { kind: "report", reportHref };
  const sessionLookup =
    deps.sessionLookup ?? createSupabaseScheduleSessionLookup();
  const session = await sessionLookup.findByAuditId(auditId);
  if (session?.consumedAt) return { kind: "booked" };
  return { kind: "report", reportHref };
}

export async function resolveScheduleExpiredView(
  token: string | undefined,
  deps: {
    loadResults?: ResultsLookup;
    loadByAuditId?: AuditIdLookup;
    readHandoff?: typeof readScheduleHandoffToken;
    sessionLookup?: ScheduleSessionLookup;
    now?: Date;
  } = {},
): Promise<ScheduleExpiredView> {
  const trimmed = token?.trim();
  if (!trimmed) return { kind: "support" };

  const loadResults = deps.loadResults ?? loadAuditResults;
  try {
    const loaded = await loadResults(trimmed);
    if (loaded.ok) {
      return viewForResolvedReport(trimmed, loaded.auditId, deps);
    }
    if (loaded.code === "SERVER_ERROR") return { kind: "error" };

    const readHandoff = deps.readHandoff ?? readScheduleHandoffToken;
    const claim = readHandoff(trimmed, deps.now);
    if (!claim) return { kind: "support" };

    const loadByAuditId = deps.loadByAuditId ?? loadAuditResultsByAuditId;
    const byId = await loadByAuditId(claim.auditId);
    if (!byId.ok) {
      return { kind: byId.code === "SERVER_ERROR" ? "error" : "support" };
    }
    return viewForResolvedReport(trimmed, claim.auditId, deps);
  } catch {
    return { kind: "error" };
  }
}
