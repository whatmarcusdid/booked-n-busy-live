import { NextRequest, NextResponse } from "next/server";
import { resolveCalendarHandoffFromReportCookie } from "@/lib/booking/calendar-handoff";
import { scheduleExpiredPath } from "@/lib/copy/schedule-expired";
import { REPORT_ACCESS_COOKIE } from "@/lib/reports/access-cookie";

/**
 * Cookie-authenticated Calendar handoff. Lives under /report so the
 * Path=/report access cookie is sent. Does not mint a token from client
 * input — identity for the dead-end comes only from that cookie, as a
 * short-lived signed handoff (not a write to public_status_token_hash).
 */
export async function GET(request: NextRequest) {
  const result = await resolveCalendarHandoffFromReportCookie(
    request.cookies.get(REPORT_ACCESS_COOKIE)?.value,
  );
  if (result.ok) {
    return NextResponse.redirect(result.url, 302);
  }
  return NextResponse.redirect(
    new URL(scheduleExpiredPath(result.statusToken), request.url),
    302,
  );
}
