import { NextRequest } from "next/server";
import { POST as createSession } from "@/app/api/v1/audits/[token]/booking-session/route";
import { POST as markBooked } from "@/app/api/v1/admin/booking-sessions/[id]/mark-booked/route";
import { ADMIN_SESSION_COOKIE, signAdminSession } from "@/lib/admin/auth";
import {
  createBookingSessionForAudit,
  markBookingSessionBooked,
} from "@/lib/booking/linkage";

jest.mock("@/lib/booking/linkage", () => {
  const actual = jest.requireActual("@/lib/booking/linkage");
  return {
    ...actual,
    createBookingSessionForAudit: jest.fn(),
    markBookingSessionBooked: jest.fn(),
    createSupabaseBookingLinkageStore: () => ({}),
  };
});

const mockCreate = createBookingSessionForAudit as jest.MockedFunction<
  typeof createBookingSessionForAudit
>;
const mockMark = markBookingSessionBooked as jest.MockedFunction<
  typeof markBookingSessionBooked
>;

function authed(url: string) {
  const request = new NextRequest(url, { method: "POST" });
  request.cookies.set(
    ADMIN_SESSION_COOKIE,
    signAdminSession({
      email: "marcus@example.com",
      exp: Date.now() + 60_000,
    }),
  );
  return request;
}

describe("admin booking-session HTTP", () => {
  const previous = process.env.ADMIN_ALLOWED_EMAILS;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_ALLOWED_EMAILS = "marcus@example.com";
  });

  afterAll(() => {
    process.env.ADMIN_ALLOWED_EMAILS = previous;
  });

  it("rejects create without an admin session", async () => {
    const response = await createSession(
      new NextRequest(
        "http://localhost:3000/api/v1/audits/audit-1/booking-session",
        { method: "POST" },
      ),
      { params: Promise.resolve({ token: "audit-1" }) },
    );
    expect(response.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects mark-booked without an admin session", async () => {
    const response = await markBooked(
      new NextRequest(
        "http://localhost:3000/api/v1/admin/booking-sessions/session-1/mark-booked",
        { method: "POST" },
      ),
      { params: Promise.resolve({ id: "session-1" }) },
    );
    expect(response.status).toBe(401);
    expect(mockMark).not.toHaveBeenCalled();
  });

  it("returns 409 when the audit state is ineligible", async () => {
    mockCreate.mockResolvedValue({
      ok: false,
      reason: "ineligible",
      currentState: "submitted",
    });
    const response = await createSession(
      authed("http://localhost:3000/api/v1/audits/audit-1/booking-session"),
      { params: Promise.resolve({ token: "audit-1" }) },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Audit is not eligible for a findings call",
      currentState: "submitted",
    });
  });

  it("creates a session for an eligible audit", async () => {
    mockCreate.mockResolvedValue({
      ok: true,
      duplicate: false,
      session: {
        id: "session-1",
        auditId: "audit-1",
        leadId: "lead-1",
        customerEmail: "owner@example.com",
        customerEmailHash: "hash",
        createdAt: "2026-09-09T18:00:00.000Z",
        expiresAt: "2026-09-11T18:00:00.000Z",
        consumedAt: null,
      },
    });
    const response = await createSession(
      authed("http://localhost:3000/api/v1/audits/audit-1/booking-session"),
      { params: Promise.resolve({ token: "audit-1" }) },
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      bookingSessionId: "session-1",
      auditId: "audit-1",
      leadId: "lead-1",
      customerEmail: "owner@example.com",
      expiresAt: "2026-09-11T18:00:00.000Z",
    });
  });

  it("mark-booked returns the linked meeting", async () => {
    mockMark.mockResolvedValue({
      ok: true,
      session: {
        id: "session-1",
        auditId: "audit-1",
        leadId: "lead-1",
        customerEmail: "owner@example.com",
        customerEmailHash: "hash",
        createdAt: "2026-09-09T18:00:00.000Z",
        expiresAt: "2026-09-11T18:00:00.000Z",
        consumedAt: "2026-09-09T18:00:00.000Z",
      },
      meeting: {
        id: "meeting-1",
        auditId: "audit-1",
        leadId: "lead-1",
        bookingSessionId: "session-1",
        googleEventId: null,
        status: "booked",
        scheduledStart: "2026-09-09T18:00:00.000Z",
        scheduledEnd: "2026-09-09T18:30:00.000Z",
        createdAt: "2026-09-09T18:00:00.000Z",
        updatedAt: "2026-09-09T18:00:00.000Z",
      },
    });
    const response = await markBooked(
      authed(
        "http://localhost:3000/api/v1/admin/booking-sessions/session-1/mark-booked",
      ),
      { params: Promise.resolve({ id: "session-1" }) },
    );
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json).toMatchObject({
      meetingId: "meeting-1",
      bookingSessionId: "session-1",
      auditId: "audit-1",
      leadId: "lead-1",
      status: "booked",
      googleEventId: null,
    });
  });
});
