import { SLOW_AUDIT_MESSAGE, SLOW_AUDIT_THRESHOLD_MS } from "./timing";

/**
 * The audit loading screen: three states, one resolver.
 *
 * Everything the screen shows is decided here from a status response and
 * nothing else — no client clock, no local timers, no remembered state. That
 * is what makes "refresh resumes the correct state" true by construction
 * rather than by careful component code: the same status response always
 * produces the same view, so a reload, a second tab, and a reconnect all
 * agree.
 *
 * The two thresholds in this system are 90 seconds (presentational, here) and
 * 15 minutes (the wall-clock kill switch, elsewhere). There is no five-minute
 * transition and no third time-based state.
 */

/**
 * PRD Section 5.3 progress stages, in order.
 *
 * These are customer-facing paraphrases of the durable workflow's states, not
 * a second state machine. `activeStageIndices` below is the only mapping.
 */
export const PROGRESS_STAGES = [
  { key: "reachable", label: "Confirming your website is reachable." },
  { key: "trust", label: "Reviewing trust and credibility signals." },
  {
    key: "contact",
    label: "Checking how customers can call or request a quote.",
  },
  {
    key: "foundations",
    label: "Checking speed, security, and growth foundations.",
  },
  { key: "scorecard", label: "Preparing your scorecard." },
] as const;

export type ProgressStageKey = (typeof PROGRESS_STAGES)[number]["key"];
export type StageProgress = "done" | "active" | "pending";

/**
 * Which customer stages a workflow state is actually working on.
 *
 * `collecting_signals` maps to three stages because it genuinely does all
 * three pillars under one state — the workflow does not expose finer
 * granularity. Showing all three as active is the honest reading; picking one
 * would leave two stages that never appear, and cycling them on a timer would
 * claim a check is running on no evidence at all.
 */
const ACTIVE_STAGES: Record<string, readonly number[]> = {
  submitted: [0],
  validating: [0],
  discovering: [0],
  rendering: [0],
  collecting_signals: [1, 2, 3],
  scoring: [4],
  generating_report: [4],
  validating_report: [4],
};

export interface ProgressStageView {
  key: ProgressStageKey;
  label: string;
  progress: StageProgress;
}

/**
 * Resolves each stage to done / active / pending.
 *
 * `anyActive: false` means nothing is claimed to be running. Used for Needs
 * Review, where processing has finished and the audit is waiting on a person:
 * marking a stage "active" there would be the exact false claim the PRD
 * forbids.
 */
export function resolveStages(input: {
  status: string;
  anyActive: boolean;
}): ProgressStageView[] {
  const active = ACTIVE_STAGES[input.status];

  return PROGRESS_STAGES.map((stage, index) => {
    if (!active || !input.anyActive) {
      // No known in-flight stage: everything the workflow got through is
      // done, and nothing is presented as running.
      return { ...stage, progress: "done" as const };
    }
    const first = active[0];
    const last = active[active.length - 1];
    const progress: StageProgress =
      index < first ? "done" : index > last ? "pending" : "active";
    return { ...stage, progress };
  });
}

export type LoadingStateKey = "normal" | "slow" | "needs_review";

/** Hourglass row. Split so the emphasised span can be bolded, per Figma. */
export interface StatusLine {
  lead: string;
  emphasis?: string;
  /** Which hourglass asset the row uses. */
  tone: "normal" | "slow" | "review";
}

export interface WaitCard {
  heading: string;
  body: string;
}

export interface LoadingView {
  state: LoadingStateKey;
  headline: string;
  statusLine: StatusLine;
  stages: ProgressStageView[];
  /** Present once the customer is better off leaving the page. */
  waitCard: WaitCard | null;
  /** Whether to keep polling for a state change. */
  keepPolling: boolean;
}

export const HEADLINES: Record<LoadingStateKey, string> = {
  normal: "We\u2019re reviewing your website",
  slow: "This website is taking a little longer to review",
  needs_review: "We need more time to verify your results",
};

/**
 * Shown for both the slow and review states. The customer's next action is
 * identical in each — close the tab, wait for the email — so the guidance is
 * too, even though the reasons differ.
 */
export const WAIT_CARD: WaitCard = {
  heading: "You don\u2019t have to wait here",
  body: "We\u2019ll email your audit report as soon as it\u2019s ready. You can safely leave this page while we finish reviewing your website.",
};

export const DID_YOU_KNOW_HEADING = "Did you know?";

export const DID_YOU_KNOW_FACTS = [
  "Visible licensing and insurance can reduce the perceived risk of contacting an unfamiliar business.",
  "Website speed shapes a customer\u2019s first impression before they read a single word.",
  "FAQs can answer objections that might otherwise prevent someone from contacting you.",
] as const;

/**
 * Resolves the whole screen for one status response.
 *
 * Returns null when the audit is in a state this screen does not own —
 * `complete`/`partial` route to results, `failed`/`unsupported` have their
 * own separate treatment. Keeping those out of here means this screen cannot
 * accidentally become the place failure copy lives.
 */
export function resolveLoadingView(input: {
  status: string;
  elapsedMs: number;
}): LoadingView | null {
  // Checked before elapsed time, and never combined with it. Needs Review is
  // a statement about the audit's findings; how long the audit took has no
  // bearing on it, in either direction.
  if (input.status === "needs_review") {
    return {
      state: "needs_review",
      headline: HEADLINES.needs_review,
      statusLine: {
        lead: "Some checks require ",
        emphasis: "additional review\u2026",
        tone: "review",
      },
      stages: resolveStages({ status: input.status, anyActive: false }),
      waitCard: WAIT_CARD,
      // Terminal. The report arrives by email once a human has approved it.
      keepPolling: false,
    };
  }

  if (!(input.status in ACTIVE_STAGES)) return null;

  const slow = input.elapsedMs >= SLOW_AUDIT_THRESHOLD_MS;
  const stages = resolveStages({ status: input.status, anyActive: true });

  if (slow) {
    return {
      state: "slow",
      headline: HEADLINES.slow,
      // The locked slow-audit sentence, used verbatim and unsplit.
      statusLine: { lead: SLOW_AUDIT_MESSAGE, tone: "slow" },
      stages,
      waitCard: WAIT_CARD,
      // Polling continues past the threshold, which is what lets a session
      // that stays open land on results instead of waiting for the email.
      keepPolling: true,
    };
  }

  return {
    state: "normal",
    headline: HEADLINES.normal,
    statusLine: {
      lead: "Usually ready within ",
      emphasis: "2 mins",
      tone: "normal",
    },
    stages,
    waitCard: null,
    keepPolling: true,
  };
}

export { SLOW_AUDIT_THRESHOLD_MS };
