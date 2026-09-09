import { CRITERIA_BY_PILLAR, PILLARS, type PillarKey } from "./types";

/**
 * Group-level progress for the three scoring pillars.
 *
 * Two things are true about how the audit actually runs, and this module is
 * shaped by both:
 *
 * 1. The twelve checks are pure functions over data collected earlier. They
 *    resolve in one synchronous pass and their rows are written in a single
 *    batch, so there is no per-check start to observe and no window in which
 *    one pillar is running while another waits.
 * 2. The time a customer actually spends waiting is capture — screenshots and
 *    Lighthouse — which happens before any check runs.
 *
 * So group completion is *derived* from the check rows rather than tracked
 * alongside them, and the capture milestones are recorded separately. Nothing
 * here changes what the pipeline executes or in what order.
 */

/** Membership comes from the scoring catalog, so it cannot drift from it. */
export function criterionKeysForGroup(group: PillarKey): readonly string[] {
  return CRITERIA_BY_PILLAR[group].map((criterion) => criterion.key);
}

export function groupForCriterion(criterionKey: string): PillarKey | null {
  for (const pillar of PILLARS) {
    if (criterionKeysForGroup(pillar.key).includes(criterionKey)) {
      return pillar.key;
    }
  }
  return null;
}

export type GroupProgress = "pending" | "in_progress" | "complete";

export interface PillarGroupProgress {
  key: PillarKey;
  progress: GroupProgress;
  /** Checks in this group that have returned a result, of any outcome. */
  returned: number;
  total: number;
}

/**
 * Derives each group's progress from the checks that have returned.
 *
 * A check has returned exactly when its row exists — the row *is* the result,
 * whatever the outcome. Deriving from that rather than from a separate
 * counter is what makes "never complete before every check returned" true by
 * construction: there is no second source that could disagree.
 *
 * `signalsStarted` covers the honest gap in the other direction. Once the
 * audit reaches the scoring phase every group's checks are underway, but none
 * of their rows exist yet, so without it a running group would read as
 * pending.
 */
export function resolvePillarGroupProgress(input: {
  returnedCriterionKeys: Iterable<string>;
  signalsStarted: boolean;
}): PillarGroupProgress[] {
  const returned = new Set(input.returnedCriterionKeys);

  return PILLARS.map(({ key }) => {
    const keys = criterionKeysForGroup(key);
    const done = keys.filter((criterionKey) => returned.has(criterionKey));

    const progress: GroupProgress =
      done.length === keys.length
        ? "complete"
        : done.length > 0 || input.signalsStarted
          ? "in_progress"
          : "pending";

    return { key, progress, returned: done.length, total: keys.length };
  });
}

/**
 * The single group to present as active.
 *
 * Groups can genuinely be underway at once, so "first incomplete" alone would
 * report a nearly-finished group while a barely-started one is also running.
 * Among those actually in progress this picks the one furthest from
 * completion; pillar order breaks ties. With nothing in progress it falls back
 * to the first group that has not finished, and returns null once all have.
 */
export function activePillarGroup(
  groups: readonly PillarGroupProgress[],
): PillarKey | null {
  const running = groups.filter((group) => group.progress === "in_progress");

  if (running.length > 0) {
    return running.reduce((furthest, group) =>
      group.returned / group.total < furthest.returned / furthest.total
        ? group
        : furthest,
    ).key;
  }

  return groups.find((group) => group.progress !== "complete")?.key ?? null;
}

/**
 * Writes criterion rows one pillar at a time, in catalog order.
 *
 * The twelve checks themselves are already computed by this point — this is
 * only the persist. Splitting the write is what lets a status poll observe a
 * finished group while another is still outstanding, which a single batch
 * cannot. It does not wait, sleep, or change which checks ran.
 */
export async function persistCriteriaByGroup<T extends { pillar: string }>(
  items: readonly T[],
  upsert: (rows: T[]) => Promise<void>,
): Promise<void> {
  for (const pillar of PILLARS) {
    const rows = items.filter((row) => row.pillar === pillar.key);
    if (rows.length > 0) await upsert(rows);
  }
}
