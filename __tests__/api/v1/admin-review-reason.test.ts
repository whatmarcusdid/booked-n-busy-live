/**
 * Server-side enforcement of "no override without a reason".
 *
 * These call the route handler directly, with no client code in the path, so
 * they hold against a hand-rolled request that never touches the console.
 * `isReasonAcceptable` is deliberately not consulted here — the assertions are
 * on the HTTP response and on whether a row was written.
 */
import { NextRequest } from "next/server";
import { POST } from "@/app/api/v1/admin/audits/[id]/reviews/route";
import { ADMIN_SESSION_COOKIE, signAdminSession } from "@/lib/admin/auth";
import { createSupabaseAdminStore } from "@/lib/admin/service";

jest.mock("@/lib/admin/service", () => {
  const actual = jest.requireActual("@/lib/admin/service");
  const insertReview = jest.fn(async () => "review-1");
  const recordEvent = jest.fn(async () => undefined);
  const currentRevisionNumber = jest.fn(async () => 1);
  return {
    ...actual,
    createSupabaseAdminStore: () => ({
      insertReview,
      recordEvent,
      currentRevisionNumber,
    }),
  };
});

const store = createSupabaseAdminStore() as unknown as {
  insertReview: jest.Mock;
  recordEvent: jest.Mock;
  currentRevisionNumber: jest.Mock;
};

const AUDIT_ID = "11111111-1111-1111-1111-111111111111";
const REVIEWER = "marcus@example.com";

function post(body: unknown) {
  const request = new NextRequest(
    `http://localhost/api/v1/admin/audits/${AUDIT_ID}/reviews`,
    { method: "POST", body: JSON.stringify(body) },
  );
  request.cookies.set(
    ADMIN_SESSION_COOKIE,
    signAdminSession({ email: REVIEWER, exp: Date.now() + 60_000 }),
  );
  return POST(request, { params: Promise.resolve({ id: AUDIT_ID }) });
}

describe("reviews endpoint rejects a reasonless override", () => {
  const previousAllowList = process.env.ADMIN_ALLOWED_EMAILS;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_ALLOWED_EMAILS = REVIEWER;
  });

  afterAll(() => {
    process.env.ADMIN_ALLOWED_EMAILS = previousAllowList;
  });

  it("rejects decision=reject with no note at all", async () => {
    const response = await post({ decision: "reject" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "An override needs a reason before it can be recorded.",
    });
    // The decisive assertion: nothing was recorded.
    expect(store.insertReview).not.toHaveBeenCalled();
    expect(store.recordEvent).not.toHaveBeenCalled();
  });

  it("rejects decision=reject with an empty-string note", async () => {
    const response = await post({ decision: "reject", note: "" });

    expect(response.status).toBe(400);
    expect(store.insertReview).not.toHaveBeenCalled();
  });

  it("rejects decision=reject with a whitespace-only note", async () => {
    const response = await post({ decision: "reject", note: "   \n\t  " });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "An override needs a reason before it can be recorded.",
    });
    expect(store.insertReview).not.toHaveBeenCalled();
  });

  it("accepts decision=reject with a real note, as before", async () => {
    const reason = "Phone CTA was visible; the check misread the header.";
    const response = await post({ decision: "reject", note: reason });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ reviewId: "review-1" });
    expect(store.insertReview).toHaveBeenCalledWith({
      auditId: AUDIT_ID,
      decision: "reject",
      note: reason,
      reviewerEmailHash: expect.any(String),
    });
  });

  it("stores the reason trimmed", async () => {
    await post({ decision: "reject", note: "  Booking CTA is above the fold. " });

    expect(store.insertReview).toHaveBeenCalledWith(
      expect.objectContaining({ note: "Booking CTA is above the fold." }),
    );
  });

  it("still allows approve and needs_changes without a note", async () => {
    for (const decision of ["approve", "needs_changes"]) {
      jest.clearAllMocks();
      const response = await post({ decision });

      expect(response.status).toBe(201);
      expect(store.insertReview).toHaveBeenCalledWith(
        expect.objectContaining({ decision, note: null }),
      );
    }
  });

  it("normalises a whitespace-only note to null on decisions that allow one", async () => {
    // A padded note is not a reason, so it must not be stored as one.
    await post({ decision: "approve", note: "   " });

    expect(store.insertReview).toHaveBeenCalledWith(
      expect.objectContaining({ note: null }),
    );
  });

  it("rejects an unauthenticated reject outright, reason or not", async () => {
    const request = new NextRequest(
      `http://localhost/api/v1/admin/audits/${AUDIT_ID}/reviews`,
      {
        method: "POST",
        body: JSON.stringify({ decision: "reject", note: "a real reason" }),
      },
    );
    const response = await POST(request, {
      params: Promise.resolve({ id: AUDIT_ID }),
    });

    expect(response.status).toBe(401);
    expect(store.insertReview).not.toHaveBeenCalled();
  });

  it("keeps reporting a revision conflict rather than the reason error", async () => {
    // The reason check must not mask the optimistic-concurrency guard.
    store.currentRevisionNumber.mockResolvedValueOnce(7);
    const response = await post({
      decision: "reject",
      note: "a real reason",
      expectedRevisionNumber: 3,
    });

    expect(response.status).toBe(409);
    expect(store.insertReview).not.toHaveBeenCalled();
  });
});
