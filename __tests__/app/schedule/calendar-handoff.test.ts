import { NextRequest } from "next/server";
import { GET as scheduleByToken } from "@/app/schedule/[token]/route";
import { GET as scheduleByCookie } from "@/app/report/schedule/route";
import {
  GOOGLE_CALENDAR_BOOKING_URL,
  resolveCalendarHandoffFromReportCookie,
  resolveCalendarHandoffFromStatusToken,
} from "@/lib/booking/calendar-handoff";
import { REPORT_ACCESS_COOKIE } from "@/lib/reports/access-cookie";

jest.mock("@/lib/booking/calendar-handoff", () => {
  const actual = jest.requireActual("@/lib/booking/calendar-handoff");
  return {
    ...actual,
    resolveCalendarHandoffFromStatusToken: jest.fn(),
    resolveCalendarHandoffFromReportCookie: jest.fn(),
  };
});

const mockFromToken = resolveCalendarHandoffFromStatusToken as jest.MockedFunction<
  typeof resolveCalendarHandoffFromStatusToken
>;
const mockFromCookie = resolveCalendarHandoffFromReportCookie as jest.MockedFunction<
  typeof resolveCalendarHandoffFromReportCookie
>;

describe("GET /schedule/[token]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("302s a valid session to the bare Calendar URL", async () => {
    mockFromToken.mockResolvedValue({
      ok: true,
      url: GOOGLE_CALENDAR_BOOKING_URL,
    });
    const response = await scheduleByToken(
      new NextRequest("http://localhost:3000/schedule/status-token"),
      { params: Promise.resolve({ token: "status-token" }) },
    );
    expect(mockFromToken).toHaveBeenCalledWith("status-token");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(GOOGLE_CALENDAR_BOOKING_URL);
    expect(new URL(response.headers.get("location") ?? "").search).toBe("");
    expect(response.headers.get("location")).not.toContain("status-token");
    expect(response.headers.get("location")).not.toContain("?");
    expect(response.headers.get("location")).not.toContain("name=");
    expect(response.headers.get("location")).not.toContain("email=");
  });

  it("does not send a consumed or expired session to Google", async () => {
    mockFromToken.mockResolvedValue({ ok: false, reason: "unavailable" });
    const response = await scheduleByToken(
      new NextRequest("http://localhost:3000/schedule/status-token"),
      { params: Promise.resolve({ token: "status-token" }) },
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost:3000/schedule");
    expect(response.headers.get("location")).not.toContain("calendar.app.google");
  });
});

describe("GET /report/schedule", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("302s a valid cookie session to the bare Calendar URL", async () => {
    mockFromCookie.mockResolvedValue({
      ok: true,
      url: GOOGLE_CALENDAR_BOOKING_URL,
    });
    const response = await scheduleByCookie(
      new NextRequest("http://localhost:3000/report/schedule", {
        headers: { Cookie: `${REPORT_ACCESS_COOKIE}=signed` },
      }),
    );
    expect(mockFromCookie).toHaveBeenCalledWith("signed");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(GOOGLE_CALENDAR_BOOKING_URL);
    expect(new URL(response.headers.get("location") ?? "").search).toBe("");
  });

  it("shows the fallback instead of Google when the session is unavailable", async () => {
    mockFromCookie.mockResolvedValue({ ok: false, reason: "unavailable" });
    const response = await scheduleByCookie(
      new NextRequest("http://localhost:3000/report/schedule"),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost:3000/schedule");
  });
});
