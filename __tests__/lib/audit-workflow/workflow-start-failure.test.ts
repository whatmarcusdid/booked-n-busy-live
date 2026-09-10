import { createMemoryAuditStore } from "@/lib/audit-workflow/store";
import {
  WORKFLOW_START_FAILED_EVENT,
  WORKFLOW_START_FAILED_REASON,
} from "@/lib/audit-workflow/types";
import { getProgressInfo, isTerminalState } from "@/lib/schemas/audit-status";

const AUDIT_ID = "audit-stranded-1";

const runAuditPipeline = jest.fn();
let store: ReturnType<typeof createMemoryAuditStore>;

jest.mock("@/lib/audit-workflow/pipeline", () => ({
  runAuditPipeline: (...args: unknown[]) => runAuditPipeline(...args),
}));

jest.mock("@/lib/audit-workflow/store", () => {
  const actual = jest.requireActual("@/lib/audit-workflow/store");
  return {
    ...actual,
    createSupabaseAuditStore: () => store,
  };
});

// Imported after the mocks so `startAuditWorkflow` binds to them.
import { startAuditWorkflow } from "@/lib/audit-workflow/start";

function seedSubmittedAudit() {
  return createMemoryAuditStore([
    {
      id: AUDIT_ID,
      website_url: "https://example.com",
      current_state: "submitted",
    },
  ]);
}

describe("a workflow that never starts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    store = seedSubmittedAudit();
  });

  /**
   * The defect this guards: the audit stayed in `submitted` forever. The
   * customer polled a scan that was never going to run, and nothing re-drove
   * it. 109 rows were stranded this way before the fix.
   */
  it("terminates the audit as failed instead of stranding it in submitted", async () => {
    runAuditPipeline.mockRejectedValue(
      new Error('relation "audit_cost_entries" does not exist'),
    );

    await expect(
      startAuditWorkflow({ auditId: AUDIT_ID, websiteUrl: "https://example.com" }),
    ).rejects.toThrow("audit_cost_entries");

    expect(store.audits.get(AUDIT_ID)?.current_state).toBe("failed");
    expect(store.audits.get(AUDIT_ID)?.current_state).not.toBe("submitted");

    expect(
      store.transitions.some(
        (row) => row.auditId === AUDIT_ID && row.to_state === "failed",
      ),
    ).toBe(true);
  });

  it("records a reason code that names the cause", async () => {
    runAuditPipeline.mockRejectedValue(new Error("enqueue refused"));

    await expect(
      startAuditWorkflow({ auditId: AUDIT_ID, websiteUrl: "https://example.com" }),
    ).rejects.toThrow("enqueue refused");

    const event = store.events.find(
      (row) => row.event_type === WORKFLOW_START_FAILED_EVENT,
    );

    expect(event).toBeDefined();
    expect(event?.event_data).toMatchObject({
      reason_code: WORKFLOW_START_FAILED_REASON,
      failure_type: WORKFLOW_START_FAILED_REASON,
    });
    // The cause is preserved rather than reduced to an empty object.
    expect(String(event?.event_data.error)).toContain("enqueue refused");
  });

  /**
   * `failed` is what the status API serves from `audits.current_state`, so a
   * terminal failed state is what the live session and the retry path see.
   */
  it("is visible through the status API as a terminal failed state", async () => {
    runAuditPipeline.mockRejectedValue(new Error("enqueue refused"));

    await expect(
      startAuditWorkflow({ auditId: AUDIT_ID, websiteUrl: "https://example.com" }),
    ).rejects.toThrow();

    const served = store.audits.get(AUDIT_ID)!.current_state;

    expect(isTerminalState(served)).toBe(true);
    const progress = getProgressInfo(served);
    expect(progress.percentage).toBe(100);
    expect(progress.currentStep.toLowerCase()).not.toContain("processing");
  });

  it("releases the workflow claim so a manual retry is possible", async () => {
    runAuditPipeline.mockRejectedValue(new Error("enqueue refused"));

    await expect(
      startAuditWorkflow({ auditId: AUDIT_ID, websiteUrl: "https://example.com" }),
    ).rejects.toThrow();

    expect(store.workflowClaims.has(AUDIT_ID)).toBe(false);
  });

  it("still surfaces the original error when the audit cannot be marked", async () => {
    runAuditPipeline.mockRejectedValue(new Error("original cause"));
    jest.spyOn(console, "error").mockImplementation(() => {});
    store.recordTransition = jest
      .fn()
      .mockRejectedValue(new Error("database also unreachable"));

    // Bookkeeping failure must not replace the real cause.
    await expect(
      startAuditWorkflow({ auditId: AUDIT_ID, websiteUrl: "https://example.com" }),
    ).rejects.toThrow("original cause");
  });

  it("leaves a healthy audit alone", async () => {
    runAuditPipeline.mockResolvedValue("complete");

    const result = await startAuditWorkflow({
      auditId: AUDIT_ID,
      websiteUrl: "https://example.com",
    });

    expect(result).toEqual({ started: true, mode: "inline" });
    expect(
      store.events.some(
        (row) => row.event_type === WORKFLOW_START_FAILED_EVENT,
      ),
    ).toBe(false);
    expect(store.audits.get(AUDIT_ID)?.current_state).not.toBe("failed");
  });
});
