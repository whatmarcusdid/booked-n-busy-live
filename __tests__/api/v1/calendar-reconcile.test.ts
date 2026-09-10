import { NextRequest } from "next/server";
import { POST } from "@/app/api/v1/internal/calendar-reconcile/route";
import { ADMIN_SESSION_COOKIE, signAdminSession } from "@/lib/admin/auth";
import { reconcileCalendar } from "@/lib/calendar/reconcile";

jest.mock("@/lib/calendar/reconcile", () => {
  const actual = jest.requireActual("@/lib/calendar/reconcile");
  return { ...actual, reconcileCalendar: jest.fn() };
});

const mockReconcile = reconcileCalendar as jest.MockedFunction<
  typeof reconcileCalendar
>;

function authed(url: string, body?: unknown) {
  const request = new NextRequest(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  request.cookies.set(
    ADMIN_SESSION_COOKIE,
    signAdminSession({
      email: "marcus@example.com",
      exp: Date.now() + 60_000,
    }),
  );
  return request;
}

describe("POST /api/v1/internal/calendar-reconcile", () => {
  const previous = process.env.ADMIN_ALLOWED_EMAILS;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_ALLOWED_EMAILS = "marcus@example.com";
  });

  afterAll(() => {
    process.env.ADMIN_ALLOWED_EMAILS = previous;
  });

  it("rejects callers without an admin session", async () => {
    const response = await POST(
      new NextRequest("http://localhost:3000/api/v1/internal/calendar-reconcile", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(401);
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("returns matched, unmatched, and ambiguous groups", async () => {
    mockReconcile.mockResolvedValue({
      ok: true,
      strategy: "updatedMin",
      windowStart: "2026-09-07T18:00:00.000Z",
      eventsFetched: 3,
      actions: [
        {
          kind: "created",
          bookingSessionId: "session-1",
          googleEventId: "evt-1",
          meeting: {
            id: "meeting-1",
            auditId: "audit-1",
            leadId: "lead-1",
            bookingSessionId: "session-1",
            googleEventId: "evt-1",
            status: "booked",
            scheduledStart: "2026-09-10T19:00:00.000Z",
            scheduledEnd: "2026-09-10T19:30:00.000Z",
            createdAt: "2026-09-09T18:00:00.000Z",
            updatedAt: "2026-09-09T18:00:00.000Z",
          },
        },
        { kind: "unmatched", googleEventId: "evt-2", reason: "no_match" },
        {
          kind: "ambiguous",
          googleEventId: "evt-3",
          bookingSessionIds: ["session-a", "session-b"],
        },
      ],
    });

    const response = await POST(
      authed("http://localhost:3000/api/v1/internal/calendar-reconcile"),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({
      ok: true,
      strategy: "updatedMin",
      eventsFetched: 3,
      matched: [
        {
          action: "created",
          meetingId: "meeting-1",
          bookingSessionId: "session-1",
          googleEventId: "evt-1",
          status: "booked",
        },
      ],
      unmatched: [{ googleEventId: "evt-2", reason: "no_match" }],
      ambiguous: [
        {
          googleEventId: "evt-3",
          bookingSessionIds: ["session-a", "session-b"],
        },
      ],
    });
    expect(JSON.stringify(json)).not.toContain("access_token");
    expect(JSON.stringify(json)).not.toContain("refresh_token");
  });

  it("returns a generic error when the refresh token is revoked", async () => {
    mockReconcile.mockResolvedValue({ ok: false, reason: "unauthorized" });
    const response = await POST(
      authed("http://localhost:3000/api/v1/internal/calendar-reconcile"),
    );
    expect(response.status).toBe(502);
    const json = await response.json();
    expect(json).toEqual({ error: "Calendar authorization failed" });
    expect(JSON.stringify(json)).not.toContain("invalid_grant");
    expect(JSON.stringify(json)).not.toContain("GOOGLE_");
  });
});
