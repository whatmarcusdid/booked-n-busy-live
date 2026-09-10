import type { WorkflowTerminalState } from "./types";

/**
 * The state an audit starts out heading for.
 *
 * Terminal state is no longer chosen up front. `unsupported` and `failed`
 * come from aborts during discovery/rendering, and `complete` / `partial` /
 * `needs_review` are resolved at report finalization from actual page
 * coverage and check outcomes — see `resolveTerminalState` in `coverage.ts`.
 *
 * This replaced a mock router that read the terminal state off the submitted
 * hostname (`partial.example.test`) or a `?mockOutcome=` query param. That
 * was test scaffolding standing in for decision #11 rule 5, and it is gone:
 * a real audit's outcome must come from what the scanner actually observed,
 * not from the shape of the URL someone typed.
 */
export const PROVISIONAL_TERMINAL_STATE: WorkflowTerminalState = "complete";

export function writesScores(outcome: WorkflowTerminalState): boolean {
  return (
    outcome === "complete" ||
    outcome === "partial" ||
    outcome === "needs_review"
  );
}

export function writesReport(outcome: WorkflowTerminalState): boolean {
  return writesScores(outcome);
}
