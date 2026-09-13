import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { GET as scheduleByToken } from "@/app/schedule/[token]/route";
import { GET as scheduleByCookie } from "@/app/report/schedule/route";
import { ScheduleExpiredScreen } from "@/app/schedule/expired-screen";
import { resolveScheduleExpiredView } from "@/lib/booking/schedule-expired";
import {
  GOOGLE_CALENDAR_BOOKING_URL,
  resolveCalendarHandoffFromReportCookie,
  resolveCalendarHandoffFromStatusToken,
} from "@/lib/booking/calendar-handoff";
import {
  BACK_TO_REPORT_LABEL,
  SCHEDULE_EXPIRED_BODY_WITHOUT_REPORT,
} from "@/lib/copy/schedule-expired";
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
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/schedule?token=status-token",
    );
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

  it("forwards the cookie-resolved status token so Branch A can render", async () => {
    mockFromCookie.mockResolvedValue({
      ok: false,
      reason: "unavailable",
      statusToken: "handoff-token",
    });
    const response = await scheduleByCookie(
      new NextRequest("http://localhost:3000/report/schedule", {
        headers: { Cookie: `${REPORT_ACCESS_COOKIE}=signed` },
      }),
    );
    expect(mockFromCookie).toHaveBeenCalledWith("signed");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/schedule?token=handoff-token",
    );

    const location = new URL(response.headers.get("location") ?? "");
    const view = await resolveScheduleExpiredView(
      location.searchParams.get("token") ?? undefined,
      { loadResults: async () => ({ ok: true }) },
    );
    expect(view).toEqual({
      kind: "report",
      reportHref: "/audit/results/handoff-token",
    });
    const html = renderToStaticMarkup(
      createElement(ScheduleExpiredScreen, { view }),
    );
    expect(html).toContain(BACK_TO_REPORT_LABEL);
    expect(html).toContain('href="/audit/results/handoff-token"');
    expect(html).not.toContain(SCHEDULE_EXPIRED_BODY_WITHOUT_REPORT);
  });

  it("falls back to Branch B when the cookie or identity cannot be resolved", async () => {
    mockFromCookie.mockResolvedValue({ ok: false, reason: "unavailable" });
    const response = await scheduleByCookie(
      new NextRequest("http://localhost:3000/report/schedule"),
    );
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/schedule",
    );

    const location = new URL(response.headers.get("location") ?? "");
    const view = await resolveScheduleExpiredView(
      location.searchParams.get("token") ?? undefined,
      {
        loadResults: async () => {
          throw new Error("must not look up a report without a token");
        },
      },
    );
    expect(view).toEqual({ kind: "support" });
    const html = renderToStaticMarkup(
      createElement(ScheduleExpiredScreen, { view }),
    ).replace(/&#x27;/g, "'");
    expect(html).toContain(SCHEDULE_EXPIRED_BODY_WITHOUT_REPORT);
    expect(html).not.toContain(BACK_TO_REPORT_LABEL);
  });

  it("ignores a query token and only uses the report cookie", async () => {
    mockFromCookie.mockResolvedValue({
      ok: false,
      reason: "unavailable",
      statusToken: "from-cookie",
    });
    const response = await scheduleByCookie(
      new NextRequest(
        "http://localhost:3000/report/schedule?token=attacker-token",
        { headers: { Cookie: `${REPORT_ACCESS_COOKIE}=signed` } },
      ),
    );
    expect(mockFromCookie).toHaveBeenCalledWith("signed");
    expect(mockFromCookie).toHaveBeenCalledTimes(1);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/schedule?token=from-cookie",
    );
    expect(response.headers.get("location")).not.toContain("attacker-token");
    const source = readFileSync(
      join(process.cwd(), "app/report/schedule/route.ts"),
      "utf8",
    );
    expect(source).not.toContain("searchParams");
  });
});
