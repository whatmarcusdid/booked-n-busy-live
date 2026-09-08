import {
  isWorkflowTerminalState,
  type WorkflowTerminalState,
} from "./types";

/**
 * Deterministic mock routing for the five terminal states.
 * Production M4 will replace this with real site-policy / crawl outcomes.
 *
 * Examples:
 *   https://example.com?mockOutcome=failed
 *   https://unsupported.example.test
 */
export function resolveMockTerminalState(
  websiteUrl: string,
): WorkflowTerminalState {
  try {
    const url = new URL(websiteUrl);
    const fromQuery = url.searchParams.get("mockOutcome");
    if (fromQuery && isWorkflowTerminalState(fromQuery)) {
      return fromQuery;
    }

    const host = url.hostname.toLowerCase();
    if (host.startsWith("unsupported.")) return "unsupported";
    if (host.startsWith("failed.")) return "failed";
    if (host.startsWith("partial.")) return "partial";
    if (host.startsWith("needs-review.")) return "needs_review";
  } catch {
    // Invalid URL already rejected by the submission API; default complete.
  }

  return "complete";
}

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
