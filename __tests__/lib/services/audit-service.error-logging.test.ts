import { createAudit } from "@/lib/services/audit-service";
import { describeDatabaseError } from "@/lib/supabase/errors";
import type { AuditSubmission } from "@/lib/schemas/audit-submission";

const startAuditWorkflow = jest.fn();
const rpc = jest.fn();

jest.mock("@/lib/audit-workflow/start", () => ({
  startAuditWorkflow: (...args: unknown[]) => startAuditWorkflow(...args),
}));

jest.mock("@/lib/audit-workflow/store", () => ({
  hashIdempotencyKey: (key: string) => `hash:${key}`,
}));

jest.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (name: string, params: Record<string, unknown>) => rpc(name, params),
    from: () => ({
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}));

jest.mock("@/lib/crypto", () => ({
  generateSecureToken: () => "raw-token",
  hmacSha256: (value: string) => `hmac:${value}`,
  hashEmail: (value: string) => `email:${value}`,
  normalizeEmail: (value: string) => value.toLowerCase().trim(),
}));

const payload: AuditSubmission = {
  websiteUrl: "https://example.com",
  businessName: "Test Business",
  firstName: "John",
  email: "john@example.com",
  trade: "Plumbing",
  serviceArea: "New York, NY",
  consent: { reportDelivery: true, followUp: false },
  attribution: {},
};

/**
 * The exact object @supabase/postgrest-js returns when the database is not
 * reachable. Captured from a live run against a dead port.
 */
const CONNECTION_REFUSED = {
  message: "TypeError: fetch failed",
  details:
    "TypeError: fetch failed\n\nCaused by: Error: connect ECONNREFUSED 127.0.0.1:54321 (ECONNREFUSED)",
  hint: "",
  code: "",
};

/** A genuine PostgREST rejection: the function is missing from the schema. */
const MISSING_FUNCTION = {
  code: "PGRST202",
  details:
    "Searched for the function public.create_audit_with_lead, but no matches were found in the schema cache.",
  hint: null,
  message:
    "Could not find the function public.create_audit_with_lead in the schema cache",
};

describe("describeDatabaseError", () => {
  it("keeps the cause of a connection refusal", () => {
    const described = describeDatabaseError(CONNECTION_REFUSED);
    expect(described).toContain("fetch failed");
    expect(described).toContain("ECONNREFUSED");
  });

  it("keeps the code and message of a PostgREST rejection", () => {
    const described = describeDatabaseError(MISSING_FUNCTION);
    expect(described).toContain("PGRST202");
    expect(described).toContain("schema cache");
  });

  it("distinguishes the two failures from each other", () => {
    expect(describeDatabaseError(CONNECTION_REFUSED)).not.toBe(
      describeDatabaseError(MISSING_FUNCTION),
    );
  });

  it("never renders a populated error as an empty object", () => {
    for (const error of [CONNECTION_REFUSED, MISSING_FUNCTION]) {
      const described = describeDatabaseError(error);
      expect(described).not.toBe("{}");
      expect(described.trim().length).toBeGreaterThan(0);
    }
  });

  it("describes an Error instance and a thrown non-object", () => {
    expect(describeDatabaseError(new Error("boom"))).toContain("boom");
    expect(describeDatabaseError("plain string")).toBe("plain string");
    expect(describeDatabaseError(null)).toBe("no error object");
  });
});

describe("createAudit failure logging", () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    startAuditWorkflow.mockResolvedValue({ started: true, mode: "inline" });
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  /**
   * The regression this guards: the dev server's logger serializes an object
   * argument to `{}`, so logging the raw error erased every cause. Passing
   * only strings is what makes the log survive the logger.
   */
  it("logs the underlying cause as a string, not an object", async () => {
    rpc.mockResolvedValue({ data: null, error: CONNECTION_REFUSED });

    const result = await createAudit(payload, "https://example.com");

    expect(result).toMatchObject({ error: "Failed to create audit" });
    expect(errorSpy).toHaveBeenCalled();

    const loggedArgs = errorSpy.mock.calls.flat();
    for (const arg of loggedArgs) {
      expect(typeof arg).toBe("string");
    }

    const logged = loggedArgs.join(" ");
    expect(logged).toContain("ECONNREFUSED");
    expect(logged).not.toContain("[object Object]");
  });

  it("logs a schema mismatch distinguishably from a dead database", async () => {
    rpc.mockResolvedValue({ data: null, error: MISSING_FUNCTION });

    await createAudit(payload, "https://example.com");

    const logged = errorSpy.mock.calls.flat().join(" ");
    expect(logged).toContain("PGRST202");
    expect(logged).not.toContain("ECONNREFUSED");
  });

  it("still surfaces a cause when the workflow fails to start", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          audit_id: "audit-1",
          lead_id: "lead-1",
          is_new_lead: true,
          is_new_audit: true,
        },
      ],
      error: null,
    });
    startAuditWorkflow.mockRejectedValue(
      new Error("relation \"audit_cost_entries\" does not exist"),
    );

    const result = await createAudit(payload, "https://example.com");

    // Intake still reports success; only the log carries the workflow failure.
    expect(result).toMatchObject({ auditId: "audit-1", status: "submitted" });

    const logged = errorSpy.mock.calls.flat().join(" ");
    expect(logged).toContain("audit_cost_entries");
    for (const arg of errorSpy.mock.calls.flat()) {
      expect(typeof arg).toBe("string");
    }
  });
});
