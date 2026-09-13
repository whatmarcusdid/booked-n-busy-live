import { createAdminClient } from "../supabase/admin";
import { FINDINGS_CALL_BOOKED_PREP_QUESTIONS } from "../copy/findings-call-booked";
import type { MeetingStatus } from "./linkage";

/** Statuses that mean the customer still has a findings call on the books. */
export const FINDINGS_CALL_BOOKED_STATUSES = [
  "booked",
  "rescheduled",
] as const satisfies readonly MeetingStatus[];

export type FindingsCallPrepAnswer = {
  question: string;
  answer: string;
};

export type FindingsCallBookedView = {
  scheduledStart: string;
  scheduledEnd: string;
  prepAnswers: FindingsCallPrepAnswer[] | null;
};

export interface FindingsCallBookedLookup {
  findActiveMeeting(auditId: string): Promise<{
    scheduledStart: string;
    scheduledEnd: string;
  } | null>;
  findPrepAnswers(auditId: string): Promise<{
    findingAnswer: string | null;
    resultAnswer: string | null;
    timingAnswer: string | null;
  } | null>;
}

/**
 * Read-only booked-state payload for the results/report CTA slot.
 * Returns null when no booked/rescheduled meeting exists.
 */
export async function loadFindingsCallBooked(
  auditId: string,
  deps: { lookup?: FindingsCallBookedLookup } = {},
): Promise<FindingsCallBookedView | null> {
  const lookup = deps.lookup ?? createSupabaseFindingsCallBookedLookup();
  const meeting = await lookup.findActiveMeeting(auditId);
  if (!meeting) return null;

  const prep = await lookup.findPrepAnswers(auditId);
  const prepAnswers = prepAnswersFromRow(prep);

  return {
    scheduledStart: meeting.scheduledStart,
    scheduledEnd: meeting.scheduledEnd,
    prepAnswers,
  };
}

export async function findAuditIdByReportTokenHash(
  tokenHash: string,
): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("report_revisions")
    .select("audit_id")
    .eq("public_report_token_hash", tokenHash)
    .maybeSingle<{ audit_id: string }>();
  return data?.audit_id ?? null;
}

export function createSupabaseFindingsCallBookedLookup(): FindingsCallBookedLookup {
  return {
    async findActiveMeeting(auditId) {
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("meetings")
        .select("scheduled_start, scheduled_end")
        .eq("audit_id", auditId)
        .in("status", [...FINDINGS_CALL_BOOKED_STATUSES])
        .order("scheduled_start", { ascending: false })
        .limit(1)
        .maybeSingle<{
          scheduled_start: string;
          scheduled_end: string;
        }>();
      if (!data) return null;
      return {
        scheduledStart: data.scheduled_start,
        scheduledEnd: data.scheduled_end,
      };
    },

    async findPrepAnswers(auditId) {
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("pre_call_answers")
        .select("finding_answer, result_answer, timing_answer")
        .eq("audit_id", auditId)
        .order("submitted_at", { ascending: false })
        .limit(1)
        .maybeSingle<{
          finding_answer: string | null;
          result_answer: string | null;
          timing_answer: string | null;
        }>();
      if (!data) return null;
      return {
        findingAnswer: data.finding_answer,
        resultAnswer: data.result_answer,
        timingAnswer: data.timing_answer,
      };
    },
  };
}

function prepAnswersFromRow(
  row: {
    findingAnswer: string | null;
    resultAnswer: string | null;
    timingAnswer: string | null;
  } | null,
): FindingsCallPrepAnswer[] | null {
  if (!row) return null;
  const values = [
    row.findingAnswer,
    row.resultAnswer,
    row.timingAnswer,
  ];
  const answers = FINDINGS_CALL_BOOKED_PREP_QUESTIONS.flatMap((question, i) => {
    const answer = values[i]?.trim() ?? "";
    return answer.length > 0 ? [{ question, answer }] : [];
  });
  return answers.length > 0 ? answers : null;
}
