/**
 * Capture milestones inside the `rendering` state.
 *
 * `rendering` is where a real audit spends most of its wall clock — screenshot
 * and Lighthouse calls against the customer's site — and it is a single state,
 * so the status API cannot otherwise tell a just-started render from an almost
 * finished one.
 *
 * These milestones are recorded at boundaries the pipeline already awaits in
 * order. Nothing is reordered, parallelised, or serialised to produce them:
 * each is an append after work that had already finished at that point.
 *
 * They describe the capture that ran, not the pillar it will later feed. The
 * mapping from a milestone to a customer-facing stage is a copy decision and
 * lives in the copy layer.
 */

export const PROGRESS_MILESTONE_EVENT = "progress_milestone";

export const CAPTURE_MILESTONES = [
  /** Home page rendered and its screenshot stored. */
  "capture_home",
  /** Home page performance metrics collected. */
  "capture_performance",
  /** Category page screenshots stored. */
  "capture_pages",
] as const;

export type CaptureMilestone = (typeof CAPTURE_MILESTONES)[number];

export function isCaptureMilestone(value: unknown): value is CaptureMilestone {
  return (
    typeof value === "string" &&
    (CAPTURE_MILESTONES as readonly string[]).includes(value)
  );
}

/**
 * How far capture got, as an index into `CAPTURE_MILESTONES`, or -1 for none.
 *
 * Takes the furthest milestone reached rather than the most recent row so that
 * a retried step, which re-records an earlier milestone, cannot walk the
 * customer's progress backwards.
 */
export function furthestCaptureMilestone(
  milestones: Iterable<CaptureMilestone>,
): number {
  let furthest = -1;
  for (const milestone of milestones) {
    furthest = Math.max(furthest, CAPTURE_MILESTONES.indexOf(milestone));
  }
  return furthest;
}
