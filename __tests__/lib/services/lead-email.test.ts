import { createAudit } from "@/lib/services/audit-service";
import { hashEmail, normalizeEmail } from "@/lib/crypto";
import {
  REQUIRED_RPC_PARAMETERS,
  REQUIRED_TABLE_COLUMNS,
} from "@/lib/supabase/schema-contract";
import type { AuditSubmission } from "@/lib/schemas/audit-submission";
import { readFileSync } from "fs";

/**
 * `leads` carries the customer's address twice, for two jobs that cannot be
 * served by one column:
 *
 *   - `email_hash` — the unique dedupe key and the lookup path. Unchanged.
 *   - `email` — plaintext, because Google Calendar reconciliation matches
 *     attendees by address and cannot match a hash.
 *
 * Deliberately does NOT mock @/lib/crypto: the property under test is that
 * the two columns describe the same address, which a stubbed hash cannot
 * show.
 */

const rpc = jest.fn();

jest.mock("@/lib/audit-workflow/start", () => ({
  startAuditWorkflow: jest.fn().mockResolvedValue({
    started: true,
    mode: "inline",
  }),
}));

jest.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, params: Record<string, unknown>) =>
      rpc(name, params),
  }),
}));

const payload: AuditSubmission = {
  websiteUrl: "https://example.com",
  businessName: "Test Business",
  firstName: "John",
  email: "John@Example.COM",
  consent: { reportDelivery: true, followUp: false },
  attribution: {},
};

function rpcParams(): Record<string, unknown> {
  expect(rpc).toHaveBeenCalledTimes(1);
  return rpc.mock.calls[0][1] as Record<string, unknown>;
}

describe("a new lead is written both hashed and in plaintext", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
  });

  it("sends the hash for lookup and the address for Calendar matching", async () => {
    await createAudit(payload, "https://example.com");
    const params = rpcParams();

    expect(params.p_email_hash).toBe(hashEmail(payload.email));
    expect(params.p_email).toBe("john@example.com");
  });

  it("normalizes both forms identically, so they cannot disagree", async () => {
    // Submitted mixed-case and padded. If only one form were normalized, the
    // hash would describe an address the plaintext does not.
    await createAudit(
      { ...payload, email: "  MiXeD.Case@Example.com  " },
      "https://example.com",
    );
    const params = rpcParams();

    const plaintext = params.p_email as string;
    expect(plaintext).toBe("mixed.case@example.com");
    expect(params.p_email_hash).toBe(hashEmail(plaintext));
    expect(plaintext).toBe(normalizeEmail(plaintext));
  });

  it("still hashes, rather than sending plaintext in place of the hash", async () => {
    // The hash is the unique key and the lookup path. Adding the plaintext
    // must not have turned it into a second copy of the address.
    await createAudit(payload, "https://example.com");
    const params = rpcParams();

    expect(params.p_email_hash).not.toBe(params.p_email);
    expect(params.p_email_hash).not.toMatch(/@/);
  });

  it("keeps the plaintext out of every other field on the request", async () => {
    // Only p_email may carry it. A copy anywhere else would put the address
    // somewhere no retention or deletion path knows to look.
    await createAudit(payload, "https://example.com");
    const params = rpcParams();

    const carrying = Object.entries(params)
      .filter(([, value]) => String(value).includes("john@example.com"))
      .map(([key]) => key);
    expect(carrying).toEqual(["p_email"]);
  });
});

describe("the plaintext column is covered by the boot contract", () => {
  it("asserts p_email on the RPC and email on leads", () => {
    // The RPC gained a parameter, which in PostgREST is a different function.
    // Without both of these a drifted environment would fail per-request
    // instead of at boot.
    expect(REQUIRED_RPC_PARAMETERS).toContain("p_email");
    expect(REQUIRED_TABLE_COLUMNS.leads).toContain("email");
    expect(REQUIRED_TABLE_COLUMNS.leads).toContain("email_hash");
  });

  it("drops the pre-p_email overload in the same migration", () => {
    // Adding a parameter creates a second function rather than replacing the
    // first, and PostgREST resolves on the exact parameter set. This database
    // has already had duplicate overloads once.
    const sql = readFileSync(
      "supabase/migrations/20260909000000_leads_plaintext_email.sql",
      "utf8",
    );
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.create_audit_with_lead/);
    expect(sql).toMatch(/INSERT INTO leads \([\s\S]*?\bemail\b/);
    // A returning lead must keep the address already on file.
    expect(sql).toContain("email = COALESCE(EXCLUDED.email, leads.email)");
  });
});
