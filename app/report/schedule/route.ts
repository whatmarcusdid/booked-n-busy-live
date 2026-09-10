import { NextRequest, NextResponse } from "next/server";
import { resolveCalendarHandoffFromReportCookie } from "@/lib/booking/calendar-handoff";
import { SCHEDULE_PATH } from "@/lib/copy/pre-call";
import { REPORT_ACCESS_COOKIE } from "@/lib/reports/access-cookie";

/**
 * Cookie-authenticated Calendar handoff. Lives under /report so the
 * Path=/report access cookie is sent. Does not mint a status token.
 */
export async function GET(request: NextRequest) {
  const result = await resolveCalendarHandoffFromReportCookie(
    request.cookies.get(REPORT_ACCESS_COOKIE)?.value,
  );
  if (result.ok) {
    return NextResponse.redirect(result.url, 302);
  }
  return NextResponse.redirect(new URL(SCHEDULE_PATH, request.url), 302);
}
