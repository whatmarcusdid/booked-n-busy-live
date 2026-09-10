import { NextRequest, NextResponse } from "next/server";
import { resolveCalendarHandoffFromStatusToken } from "@/lib/booking/calendar-handoff";
import { SCHEDULE_PATH } from "@/lib/copy/pre-call";

/**
 * Live-session Calendar handoff. The status token authorizes lookup of the
 * booking session created by the results CTA. The Google URL is the bare
 * booking page — no query string.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const result = await resolveCalendarHandoffFromStatusToken(token);
  if (result.ok) {
    return NextResponse.redirect(result.url, 302);
  }
  return NextResponse.redirect(new URL(SCHEDULE_PATH, request.url), 302);
}
