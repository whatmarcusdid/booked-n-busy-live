import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PUBLIC_TOKEN_HEADERS } from "@/lib/http/public-headers";
import { clientKeyFromRequest, consumeRateLimit } from "@/lib/http/rate-limit";
import {
  REPORT_ACCESS_COOKIE,
  readReportAccess,
} from "@/lib/reports/access-cookie";
import {
  createSupabaseReRequestStore,
  resolveReRequest,
} from "@/lib/reports/re-request-store";

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

const bodySchema = z.object({ email: z.string().email() });

/**
 * Deliberately uniform response.
 *
 * Whether the email matched, whether data is retained, and whether a scan was
 * started are all invisible to the caller — otherwise this endpoint becomes a
 * way to test which email addresses have run an audit.
 */
const ACCEPTED = {
  message:
    "If that email has a report with us, we'll send a new link shortly. Otherwise we'll start a fresh scan and email the results.",
} as const;

function json(body: unknown, status: number, extra: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: { ...PUBLIC_TOKEN_HEADERS, ...extra },
  });
}

export async function POST(request: NextRequest) {
  const limit = consumeRateLimit(
    clientKeyFromRequest(request.headers, "report-re-request"),
    RATE_LIMIT,
    RATE_WINDOW_MS,
  );
  if (!limit.ok) {
    return json({ error: "Too many requests" }, 429, { "Retry-After": "60" });
  }

  let parsed;
  try {
    parsed = bodySchema.safeParse(await request.json());
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  if (!parsed.success) {
    return json({ error: "Enter a valid email address." }, 400);
  }

  const claim = readReportAccess(
    request.cookies.get(REPORT_ACCESS_COOKIE)?.value,
  );

  try {
    await resolveReRequest(
      { email: parsed.data.email, tokenHash: claim?.tokenHash },
      createSupabaseReRequestStore(),
    );
  } catch (error) {
    console.error("Report re-request failed:", error);
  }

  return json(ACCEPTED, 202);
}
