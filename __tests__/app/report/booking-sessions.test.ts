import { POST } from "@/app/report/booking-sessions/route";
import { createBookingSession } from "@/lib/booking/session";
import { REPORT_BOOKING_SESSIONS_PATH } from "@/lib/copy/pre-call";
import { resetRateLimitForTests } from "@/lib/http/rate-limit";
import { loadPrepareFromReportCookie } from "@/lib/pre-call/report-prepare";
import {
  REPORT_ACCESS_COOKIE,
  signReportAccess,
} from "@/lib/reports/access-cookie";
import { NextRequest } from "next/server";

jest.mock("@/lib/pre-call/report-prepare", () => {
  const actual = jest.requireActual("@/lib/pre-call/report-prepare");
  return { ...actual, loadPrepareFromReportCookie: jest.fn() };
});

jest.mock("@/lib/booking/session", () => {
  const actual = jest.requireActual("@/lib/booking/session");
  return {
    ...actual,
    createBookingSession: jest.fn(),
    createSupabaseBookingSessionStore: jest.fn(() => ({})),
  };
});

const mockLoadPrepare = loadPrepareFromReportCookie as jest.MockedFunction<
  typeof loadPrepareFromReportCookie
>;
const mockCreateBookingSession = createBookingSession as jest.MockedFunction<
  typeof createBookingSession
>;

const REPORT_TOKEN_HASH = "report-token-hash-for-cookie";

function signedCookie() {
  return signReportAccess({
    tokenHash: REPORT_TOKEN_HASH,
    expired: false,
  });
}

function postWithCookieHeader(cookieHeader: string | null) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (cookieHeader) headers.Cookie = cookieHeader;
  return new NextRequest(`http://localhost:3000${REPORT_BOOKING_SESSIONS_PATH}`, {
    method: "POST",
    headers,
    body: "{}",
  });
}

describe("POST /report/booking-sessions", () => {
  beforeEach(() => {
    resetRateLimitForTests();
    mockLoadPrepare.mockReset();
    mockCreateBookingSession.mockReset();
  });

  it("reads the report cookie from the Cookie header and wraps createBookingSession", async () => {
    const value = signedCookie();
    mockLoadPrepare.mockResolvedValue({
      ok: true,
      auditId: "audit-report-1",
      leadId: "lead-report-1",
      view: {
        firstName: "Alex",
        websiteHost: "bookednbusy.app",
        headline: "",
        pillars: [],
        overallRecommendations: [],
        overallNoIssuesCopy: "",
      },
    });
    mockCreateBookingSession.mockResolvedValue({
      ok: true,
      duplicate: false,
      session: {
        id: "session-1",
        auditId: "audit-report-1",
        leadId: "lead-report-1",
        customerEmailHash: "email-hash-1",
        createdAt: "2026-09-09T00:00:00.000Z",
      },
    });

    const response = await POST(
      postWithCookieHeader(`${REPORT_ACCESS_COOKIE}=${value}`),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({
      bookingSessionId: "session-1",
      scheduleUrl: "/schedule",
    });
    expect(mockLoadPrepare).toHaveBeenCalledWith(value);
    expect(mockCreateBookingSession).toHaveBeenCalledWith(
      { reportTokenHash: REPORT_TOKEN_HASH },
      expect.anything(),
    );
  });

  it("returns 404 when the Cookie header is missing — no hash argument is supplied", async () => {
    mockLoadPrepare.mockResolvedValue({ ok: false, code: "NOT_FOUND" });

    const response = await POST(postWithCookieHeader(null));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "Not available" });
    expect(mockLoadPrepare).toHaveBeenCalledWith(undefined);
    expect(mockCreateBookingSession).not.toHaveBeenCalled();
  });

  it("does not accept a status token in the body as a substitute for the cookie", async () => {
    mockLoadPrepare.mockResolvedValue({ ok: false, code: "NOT_FOUND" });

    const request = new NextRequest(
      `http://localhost:3000${REPORT_BOOKING_SESSIONS_PATH}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statusToken: "s".repeat(64) }),
      },
    );
    const response = await POST(request);

    expect(response.status).toBe(404);
    expect(mockCreateBookingSession).not.toHaveBeenCalled();
  });
});
