import { runAuditPipeline } from "@/lib/audit-workflow/pipeline";
import { assessedCriteriaForOutcome } from "@/lib/audit-workflow/mock-stages";
import { createMemoryAuditStore } from "@/lib/audit-workflow/store";
import { WORKFLOW_TERMINAL_STATES } from "@/lib/audit-workflow/types";

function seedStore(auditId: string, websiteUrl: string) {
  return createMemoryAuditStore([
    {
      id: auditId,
      website_url: websiteUrl,
      current_state: "submitted",
    },
  ]);
}

describe("runAuditPipeline", () => {
  // `complete`, `partial` and `needs_review` are no longer selectable: they
  // are resolved from page coverage and check outcomes at report
  // finalization. See coverage.test.ts for those. Only the non-reporting
  // states can still be driven directly, and they come from stage aborts.
  it.each(["failed", "unsupported"] as const)(
    "reaches terminal state %s",
    async (outcome) => {
      const auditId = `audit-${outcome}`;
      const store = seedStore(auditId, "https://example.com/");

      const result = await runAuditPipeline({
        auditId,
        websiteUrl: "https://example.com/",
        store,
        delayMs: 0,
        outcome,
      });

      expect(result).toBe(outcome);
      expect(store.audits.get(auditId)?.current_state).toBe(outcome);
    },
  );

  it("no longer reads the terminal state off the submitted URL", async () => {
    // The old mock router returned `partial` for a `partial.` hostname and
    // for `?mockOutcome=partial`. Both must now be inert.
    for (const websiteUrl of [
      "https://partial.example.test/",
      "https://example.com/?mockOutcome=needs_review",
      "https://unsupported.example.test/",
    ]) {
      const auditId = `audit-inert-${websiteUrl}`;
      const store = seedStore(auditId, websiteUrl);
      const result = await runAuditPipeline({
        auditId,
        websiteUrl,
        store,
        delayMs: 0,
      });
      expect(result).toBe("complete");
    }
  });

  it("writes a complete ordered transition history for a full run", async () => {
    const auditId = "audit-history";
    const store = seedStore(auditId, "https://example.com");
    store.transitions.push({
      auditId,
      from_state: null,
      to_state: "submitted",
      transitioned_at: "2026-09-07T00:00:00.000Z",
    });

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
    });

    const toStates = store.transitions
      .filter((row) => row.auditId === auditId)
      .map((row) => row.to_state);

    expect(toStates).toEqual([
      "submitted",
      "validating",
      "discovering",
      "rendering",
      "collecting_signals",
      "scoring",
      "generating_report",
      "validating_report",
      "complete",
    ]);

    const fromStates = store.transitions
      .filter((row) => row.auditId === auditId)
      .map((row) => row.from_state);
    expect(fromStates).toEqual([
      null,
      "submitted",
      "validating",
      "discovering",
      "rendering",
      "collecting_signals",
      "scoring",
      "generating_report",
      "validating_report",
    ]);
  });

  it("attempts every check rather than pre-selecting by outcome", async () => {
    // Coverage used to be decided by the pre-set outcome, which sliced two
    // checks per pillar for `partial`. The outcome is no longer known at
    // scoring time, so all 12 are attempted and each check reports its own
    // assessability.
    const auditId = "audit-coverage";
    const store = seedStore(auditId, "https://example.com/");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com/",
      store,
      delayMs: 0,
    });

    expect(assessedCriteriaForOutcome("complete")).toHaveLength(12);
    expect(assessedCriteriaForOutcome("partial")).toHaveLength(12);
    expect(assessedCriteriaForOutcome("failed")).toHaveLength(0);

    expect(store.criteria).toHaveLength(12);
    expect(
      store.criteria.some((row) => row.criterion_key === "website_performance"),
    ).toBe(true);
  });

  it("writes no scores or report for failed and unsupported", async () => {
    for (const outcome of ["failed", "unsupported"] as const) {
      const auditId = `audit-${outcome}-empty`;
      const store = seedStore(
        auditId,
        `https://example.com/?mockOutcome=${outcome}`,
      );

      await runAuditPipeline({
        auditId,
        websiteUrl: `https://example.com/?mockOutcome=${outcome}`,
        store,
        delayMs: 0,
        outcome,
      });

      expect(store.criteria.filter((row) => row.auditId === auditId)).toEqual([]);
      expect(store.pillars.filter((row) => row.auditId === auditId)).toEqual([]);
      expect(store.reports.filter((row) => row.auditId === auditId)).toEqual([]);
    }
  });

  it("reaches a terminal state without any status polling (disconnect)", async () => {
    const auditId = "audit-disconnect";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
    });

    expect(store.audits.get(auditId)?.current_state).toBe("complete");
  });

  it("routes a blocked URL to unsupported at discovering", async () => {
    const auditId = "audit-ssrf";
    const store = seedStore(auditId, "http://127.0.0.1");

    const result = await runAuditPipeline({
      auditId,
      websiteUrl: "http://127.0.0.1",
      store,
      delayMs: 0,
      outcome: "complete",
    });

    expect(result).toBe("unsupported");
    expect(store.audits.get(auditId)?.current_state).toBe("unsupported");
    expect(store.pages.filter((row) => row.auditId === auditId)).toEqual([]);
    expect(store.criteria.filter((row) => row.auditId === auditId)).toEqual([]);
    expect(
      store.transitions
        .filter((row) => row.auditId === auditId)
        .map((row) => row.to_state),
    ).toEqual(["validating", "discovering", "unsupported"]);
  });

  it("does not duplicate transitions or criteria when replayed", async () => {
    const auditId = "audit-replay";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
    });
    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
    });

    const completeTransitions = store.transitions.filter(
      (row) => row.auditId === auditId && row.to_state === "complete",
    );
    expect(completeTransitions).toHaveLength(1);
    expect(
      store.criteria.filter((row) => row.auditId === auditId),
    ).toHaveLength(12);
  });
});
