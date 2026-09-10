/**
 * The original automated result must survive a human decision.
 *
 * The console's Override action posts to the existing reviews endpoint, which
 * calls `insertReview`. This asserts at the database-call level that the path
 * only ever appends: no UPDATE, no UPSERT, no DELETE, and nothing touching the
 * tables that hold the machine's own conclusions. That is the property decision
 * #12's future Selective Automation Expansion analysis depends on — an
 * override that quietly rewrote the score would destroy its own evidence.
 */
jest.mock("@/lib/supabase/admin", () => {
  const operations: Array<{
    table: string;
    op: string;
    payload?: unknown;
  }> = [];

  function query(table: string) {
    const chain: Record<string, unknown> = {};
    const record = (op: string) => (payload?: unknown) => {
      operations.push({ table, op, payload });
      return chain;
    };
    const passthrough = () => chain;

    Object.assign(chain, {
      insert: record("insert"),
      update: record("update"),
      upsert: record("upsert"),
      delete: record("delete"),
      select: passthrough,
      eq: passthrough,
      in: passthrough,
      is: passthrough,
      or: passthrough,
      order: passthrough,
      limit: passthrough,
      range: passthrough,
      single: async () => ({ data: { id: "row-1" }, error: null }),
      maybeSingle: async () => ({
        data: { id: "row-1", revision_number: 1 },
        error: null,
      }),
    });

    return chain;
  }

  return {
    createAdminClient: () => ({ from: (table: string) => query(table) }),
    __operations: operations,
  };
});

import { createSupabaseAdminStore } from "@/lib/admin/service";
import type { AssembledReport } from "@/lib/reports/schema";

const { __operations: operations } = jest.requireMock(
  "@/lib/supabase/admin",
) as { __operations: Array<{ table: string; op: string; payload?: unknown }> };

/** Tables holding the machine's own conclusions. */
const MACHINE_RESULT_TABLES = [
  "criterion_results",
  "pillar_results",
  "evidence",
  "artifacts",
  "audit_pages",
];

const AUDIT_ID = "11111111-1111-1111-1111-111111111111";

describe("override preserves the automated result", () => {
  beforeEach(() => {
    operations.length = 0;
  });

  it("appends a review row and mutates nothing", async () => {
    await createSupabaseAdminStore().insertReview({
      auditId: AUDIT_ID,
      decision: "reject",
      note: "Phone CTA was visible; the check misread the header.",
      reviewerEmailHash: "hash",
    });

    expect(operations).toEqual([
      {
        table: "admin_reviews",
        op: "insert",
        payload: {
          audit_id: AUDIT_ID,
          decision: "reject",
          note: "Phone CTA was visible; the check misread the header.",
          reviewer_email_hash: "hash",
        },
      },
    ]);
  });

  it("records the reason on the row, so it can be read back", async () => {
    const reason = "Screenshot shows the booking CTA above the fold.";
    await createSupabaseAdminStore().insertReview({
      auditId: AUDIT_ID,
      decision: "reject",
      note: reason,
      reviewerEmailHash: "hash",
    });

    const [insert] = operations;
    expect((insert.payload as { note: string }).note).toBe(reason);
  });

  it("never issues an update, upsert, or delete when recording a decision", async () => {
    const store = createSupabaseAdminStore();
    await store.insertReview({
      auditId: AUDIT_ID,
      decision: "reject",
      note: "reason",
      reviewerEmailHash: "hash",
    });
    await store.recordEvent(AUDIT_ID, "admin_review", { decision: "reject" });

    const mutating = operations.filter((operation) =>
      ["update", "upsert", "delete"].includes(operation.op),
    );
    expect(mutating).toEqual([]);
  });

  it("never writes to the tables holding the machine's conclusions", async () => {
    const store = createSupabaseAdminStore();
    await store.insertReview({
      auditId: AUDIT_ID,
      decision: "reject",
      note: "reason",
      reviewerEmailHash: "hash",
    });
    await store.recordEvent(AUDIT_ID, "admin_review", {});

    const touched = operations
      .filter((operation) => operation.op !== "select")
      .map((operation) => operation.table);
    for (const table of MACHINE_RESULT_TABLES) {
      expect(touched).not.toContain(table);
    }
  });

  it("adds a corrected revision beside the original rather than editing it", async () => {
    // Not reachable from this loop's UI (manual re-scoring is out of scope),
    // but it is the other append-only path an override could take, so its
    // shape is pinned here too.
    await createSupabaseAdminStore().insertRevision({
      auditId: AUDIT_ID,
      revisionNumber: 2,
      assembled: { placeholder: true } as unknown as AssembledReport,
      executiveSummary: "Corrected after review.",
      overallScore: 0.82,
    });

    expect(operations).toHaveLength(1);
    const [insert] = operations;
    expect(insert.table).toBe("report_revisions");
    expect(insert.op).toBe("insert");

    const payload = insert.payload as {
      revision_number: number;
      publication_status: string;
      metadata: { corrected: boolean };
    };
    // A new revision number, so revision 1 is still there to compare against.
    expect(payload.revision_number).toBe(2);
    expect(payload.metadata.corrected).toBe(true);
    // A corrected revision re-enters review; it is not published implicitly.
    expect(payload.publication_status).toBe("review_required");
  });
});
