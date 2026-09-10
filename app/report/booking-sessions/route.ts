import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_TOKEN_HEADERS } from "@/lib/http/public-headers";
import { clientKeyFromRequest, consumeRateLimit } from "@/lib/http/rate-limit";
import {
  createBookingSession,
  createSupabaseBookingSessionStore,
} from "@/lib/booking/session";
import { loadPrepareFromReportCookie } from "@/lib/pre-call/report-prepare";
import {
  REPORT_ACCESS_COOKIE,
  readReportAccess,
} from "@/lib/reports/access-cookie";

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

function json(body: unknown, status: number, extra: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: { ...PUBLIC_TOKEN_HEADERS, ...extra },
  });
}

/**
 * Cookie-reachable booking-session create for /report visitors.
 *
 * Path=/report is the only prefix the report-access cookie is sent with.
 * This wrapper exists so that cookie actually arrives; it reuses Prepare's
 * cookie resolution and createBookingSession — it does not mint a status
 * token or change cookie scope.
 */
export async function POST(request: NextRequest) {
  const limit = consumeRateLimit(
    clientKeyFromRequest(request.headers, "report-booking-session"),
    RATE_LIMIT,
    RATE_WINDOW_MS,
  );
  if (!limit.ok) {
    return json({ error: "Too many requests" }, 429, { "Retry-After": "60" });
  }

  const cookieValue = request.cookies.get(REPORT_ACCESS_COOKIE)?.value;

  try {
    const loaded = await loadPrepareFromReportCookie(cookieValue);
    if (!loaded.ok) {
      return json({ error: "Not available" }, 404);
    }

    const claim = readReportAccess(cookieValue);
    if (!claim) {
      return json({ error: "Not available" }, 404);
    }

    const result = await createBookingSession(
      { reportTokenHash: claim.tokenHash },
      createSupabaseBookingSessionStore(),
    );

    if (!result.ok) {
      return json({ error: "Not available" }, 404);
    }

    return json(
      { bookingSessionId: result.session.id, scheduleUrl: "/schedule" },
      result.duplicate ? 200 : 201,
    );
  } catch (error) {
    console.error("Failed to create booking session:", error);
    return json({ error: "Could not start booking." }, 500);
  }
}
