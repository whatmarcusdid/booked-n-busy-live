import { NextRequest } from "next/server";
import { POST as recordAttendance } from "@/app/api/v1/admin/meetings/[id]/attendance/route";
import { ADMIN_SESSION_COOKIE, signAdminSession } from "@/lib/admin/auth";
import { recordMeetingAttendance } from "@/lib/booking/attendance";

jest.mock("@/lib/booking/attendance", () => {
  const actual = jest.requireActual("@/lib/booking/attendance");
  return {
    ...actual,
    recordMeetingAttendance: jest.fn(),
    createSupabaseMeetingAttendanceStore: () => ({}),
  };
});

const mockRecord = recordMeetingAttendance as jest.MockedFunction<
  typeof recordMeetingAttendance
>;

function authed(url: string, body: unknown) {
  const request = new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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

describe("POST /api/v1/admin/meetings/[id]/attendance", () => {
  const previous = process.env.ADMIN_ALLOWED_EMAILS;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_ALLOWED_EMAILS = "marcus@example.com";
  });

  afterAll(() => {
    process.env.ADMIN_ALLOWED_EMAILS = previous;
  });

  it("rejects callers without an admin session", async () => {
    const response = await recordAttendance(
      new NextRequest(
        "http://localhost:3000/api/v1/admin/meetings/meeting-1/attendance",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "attended" }),
        },
      ),
      { params: Promise.resolve({ id: "meeting-1" }) },
    );
    expect(response.status).toBe(401);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("marks a booked meeting as attended", async () => {
    mockRecord.mockResolvedValue({
      ok: true,
      meeting: {
        id: "meeting-1",
        auditId: "audit-1",
        leadId: "lead-1",
        bookingSessionId: "session-1",
        googleEventId: null,
        status: "attended",
        scheduledStart: "2026-09-09T18:00:00.000Z",
        scheduledEnd: "2026-09-09T18:30:00.000Z",
        createdAt: "2026-09-09T18:00:00.000Z",
        updatedAt: "2026-09-09T18:00:00.000Z",
      },
    });
    const response = await recordAttendance(
      authed(
        "http://localhost:3000/api/v1/admin/meetings/meeting-1/attendance",
        { status: "attended" },
      ),
      { params: Promise.resolve({ id: "meeting-1" }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      meetingId: "meeting-1",
      bookingSessionId: "session-1",
      auditId: "audit-1",
      leadId: "lead-1",
      status: "attended",
    });
    expect(mockRecord).toHaveBeenCalledWith(
      "meeting-1",
      "attended",
      expect.anything(),
    );
  });

  it("rejects attendance on a cancelled meeting", async () => {
    mockRecord.mockResolvedValue({ ok: false, reason: "cancelled" });
    const response = await recordAttendance(
      authed(
        "http://localhost:3000/api/v1/admin/meetings/meeting-1/attendance",
        { status: "attended" },
      ),
      { params: Promise.resolve({ id: "meeting-1" }) },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Cancelled meetings cannot be marked attended or no-show",
    });
  });
});
