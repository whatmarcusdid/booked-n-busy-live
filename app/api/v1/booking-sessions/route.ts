import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PUBLIC_TOKEN_HEADERS } from "@/lib/http/public-headers";
import { clientKeyFromRequest, consumeRateLimit } from "@/lib/http/rate-limit";
import {
  createBookingSession,
  createSupabaseBookingSessionStore,
} from "@/lib/booking/session";
import {
  REPORT_ACCESS_COOKIE,
  readReportAccess,
} from "@/lib/reports/access-cookie";

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

const bodySchema = z.object({ statusToken: z.string().min(1).optional() });

function json(body: unknown, status: number, extra: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: { ...PUBLIC_TOKEN_HEADERS, ...extra },
  });
}

export async function POST(request: NextRequest) {
  const limit = consumeRateLimit(
    clientKeyFromRequest(request.headers, "booking-session"),
    RATE_LIMIT,
    RATE_WINDOW_MS,
  );
  if (!limit.ok) {
    return json({ error: "Too many requests" }, 429, { "Retry-After": "60" });
  }

  let parsed;
  try {
    parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  if (!parsed.success) {
    return json({ error: "Invalid request" }, 400);
  }

  const claim = readReportAccess(
    request.cookies.get(REPORT_ACCESS_COOKIE)?.value,
  );

  try {
    const result = await createBookingSession(
      {
        statusToken: parsed.data.statusToken,
        reportTokenHash: claim?.tokenHash,
      },
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
