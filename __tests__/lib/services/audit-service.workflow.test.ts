import { createAudit } from "@/lib/services/audit-service";
import type { AuditSubmission } from "@/lib/schemas/audit-submission";

const startAuditWorkflow = jest.fn();
const rpc = jest.fn();
const updateEq = jest.fn();
const writtenPayloads: unknown[] = [];
let tokenSerial = 0;

jest.mock("@/lib/audit-workflow/start", () => ({
  startAuditWorkflow: (...args: unknown[]) => startAuditWorkflow(...args),
}));

jest.mock("@/lib/audit-workflow/store", () => ({
  hashIdempotencyKey: (key: string) => `hash:${key}`,
}));

jest.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, params: Record<string, unknown>) => {
      writtenPayloads.push({ type: "rpc", name, params });
      return rpc(name, params);
    },
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => {
        writtenPayloads.push({ type: "update", table, values });
        return {
          eq: (...args: unknown[]) => updateEq(...args),
        };
      },
    }),
  }),
}));

jest.mock("@/lib/crypto", () => ({
  generateSecureToken: () => `raw-token-${++tokenSerial}`,
  hmacSha256: (value: string) => `hmac:${value}`,
  hashEmail: (value: string) => `email:${value}`,
}));

const payload: AuditSubmission = {
  websiteUrl: "https://example.com",
  businessName: "Test Business",
  firstName: "John",
  email: "john@example.com",
  trade: "Plumbing",
  serviceArea: "New York, NY",
  consent: {
    reportDelivery: true,
    followUp: false,
  },
  attribution: {},
};

describe("createAudit workflow trigger", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    writtenPayloads.length = 0;
    tokenSerial = 0;
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
    updateEq.mockResolvedValue({ error: null });
    startAuditWorkflow.mockResolvedValue({ started: true, mode: "inline" });
  });

  it("starts one workflow after a successful submission", async () => {
    const result = await createAudit(payload, "https://example.com");

    expect(result).toEqual({
      auditId: "audit-1",
      status: "submitted",
      statusUrl: "/audit/status/raw-token-1",
      duplicate: false,
    });
    expect(startAuditWorkflow).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "create_audit_with_lead",
      expect.objectContaining({
        p_public_status_token_hash: "hmac:raw-token-1",
        p_idempotency_key_hash: null,
      }),
    );
  });

  it("does not start a second workflow and returns a fresh statusUrl on replay", async () => {
    rpc
      .mockResolvedValueOnce({
        data: [
          {
            audit_id: "audit-1",
            lead_id: "lead-1",
            is_new_lead: true,
            is_new_audit: true,
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            audit_id: "audit-1",
            lead_id: "lead-1",
            is_new_lead: false,
            is_new_audit: false,
          },
        ],
        error: null,
      });

    const first = await createAudit(payload, "https://example.com", {
      idempotencyKey: "key-1",
    });
    const second = await createAudit(payload, "https://example.com", {
      idempotencyKey: "key-1",
    });

    expect(first).toMatchObject({
      auditId: "audit-1",
      statusUrl: "/audit/status/raw-token-1",
      duplicate: false,
    });
    expect(second).toMatchObject({
      auditId: "audit-1",
      duplicate: true,
    });
    if ("error" in first || "error" in second) {
      throw new Error("expected successful createAudit results");
    }
    expect(second.statusUrl).toBe("/audit/status/raw-token-3");
    expect(second.statusUrl).not.toBe(first.statusUrl);
    expect(startAuditWorkflow).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(writtenPayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "update",
          table: "audits",
          values: { public_status_token_hash: "hmac:raw-token-3" },
        }),
      ]),
    );
  });

  it("never writes a raw status token to rpc or update payloads", async () => {
    rpc
      .mockResolvedValueOnce({
        data: [
          {
            audit_id: "audit-1",
            lead_id: "lead-1",
            is_new_lead: true,
            is_new_audit: true,
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            audit_id: "audit-1",
            lead_id: "lead-1",
            is_new_lead: false,
            is_new_audit: false,
          },
        ],
        error: null,
      });

    const first = await createAudit(payload, "https://example.com", {
      idempotencyKey: "key-1",
    });
    const second = await createAudit(payload, "https://example.com", {
      idempotencyKey: "key-1",
    });

    if ("error" in first || "error" in second) {
      throw new Error("expected successful createAudit results");
    }

    const firstToken = first.statusUrl.replace("/audit/status/", "");
    const secondToken = second.statusUrl.replace("/audit/status/", "");
    const rawValues = collectStringValues(writtenPayloads);

    expect(firstToken.startsWith("raw-token-")).toBe(true);
    expect(secondToken.startsWith("raw-token-")).toBe(true);
    expect(rawValues).not.toContain(firstToken);
    expect(rawValues).not.toContain(secondToken);
    expect(rawValues.some((value) => value.includes("/audit/status/"))).toBe(
      false,
    );
    expect(rawValues).toContain("hmac:raw-token-1");
    expect(rawValues).toContain("hmac:raw-token-3");
  });
});

function collectStringValues(value: unknown, found: string[] = []): string[] {
  if (typeof value === "string") {
    found.push(value);
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, found);
    return found;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStringValues(item, found);
  }
  return found;
}
