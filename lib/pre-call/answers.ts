import {
  findingDiscussionOptions,
  isAllowedOption,
  RESULT_OPTIONS,
  TIMING_OPTIONS,
} from "@/lib/copy/pre-call";
import { loadAuditResults } from "@/lib/services/audit-results-service";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Persist a submitted prepare-screen answer set.
 *
 * Q1 options are resolved through `loadAuditResults` — the same Fix First
 * read path as the results screen — not re-ranked here. This module does
 * not import booking sessions or any calendar construct.
 */

export interface PreCallAnswersInput {
  statusToken: string;
  findingAnswer?: string | null;
  resultAnswer?: string | null;
  timingAnswer?: string | null;
}

export interface PreCallAnswerRow {
  auditId: string;
  leadId: string;
  findingAnswer: string | null;
  resultAnswer: string | null;
  timingAnswer: string | null;
  submittedAt: string;
}

export interface PreCallAnswerStore {
  insert(row: PreCallAnswerRow): Promise<{ id: string }>;
}

export type SubmitPreCallAnswersResult =
  | { ok: true; id: string }
  | { ok: false; reason: "not_found" | "invalid_option" | "server_error" };

export interface SubmitPreCallAnswersDeps {
  loadResults?: typeof loadAuditResults;
  store?: PreCallAnswerStore;
  now?: () => Date;
}

export function blankToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function persistPreCallAnswers(
  loaded: {
    auditId: string;
    leadId: string;
    view: { overallRecommendations: { title: string }[] };
  },
  answers: Omit<PreCallAnswersInput, "statusToken">,
  deps: Pick<SubmitPreCallAnswersDeps, "store" | "now"> = {},
): Promise<SubmitPreCallAnswersResult> {
  const store = deps.store ?? createSupabasePreCallAnswerStore();
  const now = deps.now ?? (() => new Date());

  const findingAnswer = blankToNull(answers.findingAnswer);
  const resultAnswer = blankToNull(answers.resultAnswer);
  const timingAnswer = blankToNull(answers.timingAnswer);

  const findingOptions = findingDiscussionOptions(
    loaded.view.overallRecommendations,
  );
  if (findingAnswer && !isAllowedOption(findingAnswer, findingOptions)) {
    return { ok: false, reason: "invalid_option" };
  }
  if (resultAnswer && !isAllowedOption(resultAnswer, RESULT_OPTIONS)) {
    return { ok: false, reason: "invalid_option" };
  }
  if (timingAnswer && !isAllowedOption(timingAnswer, TIMING_OPTIONS)) {
    return { ok: false, reason: "invalid_option" };
  }

  try {
    const { id } = await store.insert({
      auditId: loaded.auditId,
      leadId: loaded.leadId,
      findingAnswer,
      resultAnswer,
      timingAnswer,
      submittedAt: now().toISOString(),
    });
    return { ok: true, id };
  } catch (error) {
    console.error("Failed to save pre-call answers:", error);
    return { ok: false, reason: "server_error" };
  }
}

export async function submitPreCallAnswers(
  input: PreCallAnswersInput,
  deps: SubmitPreCallAnswersDeps = {},
): Promise<SubmitPreCallAnswersResult> {
  const loadResults = deps.loadResults ?? loadAuditResults;

  const loaded = await loadResults(input.statusToken);
  if (!loaded.ok) {
    return {
      ok: false,
      reason: loaded.code === "NOT_FOUND" ? "not_found" : "server_error",
    };
  }
  if (!loaded.leadId) {
    return { ok: false, reason: "server_error" };
  }

  return persistPreCallAnswers(
    { auditId: loaded.auditId, leadId: loaded.leadId, view: loaded.view },
    input,
    deps,
  );
}

export function createSupabasePreCallAnswerStore(): PreCallAnswerStore {
  return {
    async insert(row) {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from("pre_call_answers")
        .insert({
          audit_id: row.auditId,
          lead_id: row.leadId,
          finding_answer: row.findingAnswer,
          result_answer: row.resultAnswer,
          timing_answer: row.timingAnswer,
          submitted_at: row.submittedAt,
        })
        .select("id")
        .maybeSingle<{ id: string }>();

      if (error || !data) {
        throw new Error(error?.message ?? "Failed to save pre-call answers");
      }
      return { id: data.id };
    },
  };
}
