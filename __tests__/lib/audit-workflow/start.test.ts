import { startAuditWorkflow } from "@/lib/audit-workflow/start";

const claimWorkflow = jest.fn();
const releaseWorkflowClaim = jest.fn();
const runAuditPipeline = jest.fn();

jest.mock("@/lib/audit-workflow/store", () => ({
  createSupabaseAuditStore: () => ({
    claimWorkflow,
    releaseWorkflowClaim,
  }),
}));

jest.mock("@/lib/audit-workflow/pipeline", () => ({
  runAuditPipeline: (...args: unknown[]) => runAuditPipeline(...args),
}));

describe("startAuditWorkflow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    runAuditPipeline.mockResolvedValue("complete");
  });

  it("claims once and refuses a second active execution", async () => {
    claimWorkflow.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const first = await startAuditWorkflow({
      auditId: "audit-1",
      websiteUrl: "https://example.com",
    });
    const second = await startAuditWorkflow({
      auditId: "audit-1",
      websiteUrl: "https://example.com",
    });

    expect(first).toEqual({ started: true, mode: "inline" });
    expect(second).toEqual({ started: false, reason: "already_active" });
    expect(runAuditPipeline).toHaveBeenCalledTimes(1);
  });
});
