import { NextRequest, NextResponse } from "next/server";
import { clientKeyFromRequest, consumeRateLimit } from "@/lib/http/rate-limit";
import { resolveReportAccess } from "@/lib/reports/access";
import {
  REPORT_ACCESS_COOKIE,
  reportAccessCookieOptions,
  signReportAccess,
} from "@/lib/reports/access-cookie";
import { REPORT_TOKEN_TTL_MS } from "@/lib/reports/tokens";

const EXCHANGE_RATE_LIMIT = 30;
const EXCHANGE_RATE_WINDOW_MS = 60_000;

/**
 * Token-to-cookie exchange. This is a route handler rather than a page so it
 * can set a cookie and redirect in one hop — a page render cannot set
 * cookies, and a client-side redirect would leave the raw token in browser
 * history, which is what this exchange exists to prevent.
 *
 * The emailed link shape is unchanged: /report/{token} still works, it just
 * now redirects to /report and reads the cookie from then on.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ reportToken: string }> },
) {
  const clean = new URL("/report", request.url);

  const limit = consumeRateLimit(
    clientKeyFromRequest(request.headers, "report-exchange"),
    EXCHANGE_RATE_LIMIT,
    EXCHANGE_RATE_WINDOW_MS,
  );
  if (!limit.ok) {
    return NextResponse.redirect(clean, { status: 303 });
  }

  const { reportToken } = await context.params;

  let access;
  try {
    access = await resolveReportAccess(reportToken);
  } catch (error) {
    console.error("Report access exchange failed:", error);
    return NextResponse.redirect(clean, { status: 303 });
  }

  // 303 so the browser replaces the tokened URL rather than keeping it as a
  // resubmittable entry.
  const response = NextResponse.redirect(clean, { status: 303 });

  if (access.outcome === "unavailable") {
    // No cookie: /report will render the generic unavailable state. An
    // unknown token must not be able to tell itself apart from a revoked one.
    return response;
  }

  response.cookies.set(
    REPORT_ACCESS_COOKIE,
    signReportAccess({
      tokenHash: access.tokenHash,
      expired: access.outcome === "expired",
    }),
    // An expired link still gets a short-lived cookie so /report can offer
    // the re-request flow instead of a dead end.
    reportAccessCookieOptions(
      new Date(
        Date.now() +
          (access.outcome === "expired" ? 60 * 60 * 1000 : REPORT_TOKEN_TTL_MS),
      ),
    ),
  );

  return response;
}
